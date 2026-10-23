#!/usr/bin/env node
/**
 * Builds mobile/demo/midtown-buildings.json: real building massing for the
 * Empire State Moment, from NYC Open Data "Building Footprints" (DoITT,
 * dataset 5zhs-2jue, roof heights from photogrammetry). Every building
 * within 1.6 km of the Empire State Building whose roof is over 60 ft, and
 * towers over 200 ft out to 2.6 km (so the massing thins out instead of
 * ending at a hard circle).
 *
 *   node mobile/demo/build-midtown.mjs [path/to/cached.json]
 *
 * Output: { origin:[lon,lat], source, fetchedAt, b:[[roofM, groundM, x0,y0,x1,y1,…]] }
 * where x/y are integer metres east/north of `origin` (outer ring only,
 * Douglas-Peucker simplified to 1 m).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** JSON as the repo's Prettier would write it (so `prettier --check` passes). */
async function prettyJson(value) {
  const text = JSON.stringify(value);
  try {
    const prettier = await import('prettier');
    return await prettier.format(text, { parser: 'json' });
  } catch {
    return `${text}\n`;
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = [-73.9857, 40.7484];
const FT = 0.3048;

async function load() {
  const cached = process.argv[2];
  if (cached) return JSON.parse(await readFile(cached, 'utf8'));
  const url = new URL('https://data.cityofnewyork.us/resource/5zhs-2jue.json');
  url.searchParams.set(
    '$select',
    'the_geom,height_roof,ground_elevation,bin,construction_year',
  );
  url.searchParams.set(
    '$where',
    `within_circle(the_geom,${ORIGIN[1]},${ORIGIN[0]},2600) AND height_roof > 60`,
  );
  url.searchParams.set('$limit', '20000');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`NYC Open Data HTTP ${r.status}`);
  return r.json();
}

const kx = 111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180);
const ky = 110_574;
const toXY = ([lon, lat]) => [(lon - ORIGIN[0]) * kx, (lat - ORIGIN[1]) * ky];

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const rows = await load();
const out = [];
for (const row of rows) {
  const roof = Number(row.height_roof) * FT;
  if (!Number.isFinite(roof) || roof < 18) continue;
  const ground = Number(row.ground_elevation) * FT;
  const polys = row.the_geom?.coordinates || [];
  // The largest outer ring stands for the building.
  let ring = null;
  for (const poly of polys) {
    const r = poly[0];
    if (r && (!ring || r.length > ring.length)) ring = r;
  }
  if (!ring || ring.length < 4) continue;
  let pts = ring.map(toXY);
  const [fx, fy] = pts[0];
  const dist = Math.hypot(fx, fy);
  if (dist > 2600) continue;
  // Beyond 1.6 km only towers, thinning out with distance.
  if (dist > 1600 && roof < 61 + ((dist - 1600) / 1000) * 60) continue;
  // Open ring: split at the farthest vertex so both halves simplify cleanly.
  pts = pts.slice(0, -1);
  let far = 1;
  for (let i = 1; i < pts.length; i++)
    if (
      Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) >
      Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])
    )
      far = i;
  pts = [
    ...simplify(pts.slice(0, far + 1), 1.0),
    ...simplify([...pts.slice(far), pts[0]], 1.0).slice(1, -1),
  ];
  if (pts.length < 3) continue;
  const flat = [];
  for (const [x, y] of pts) flat.push(Math.round(x), Math.round(y));
  out.push([
    Math.round(roof * 10) / 10,
    Number.isFinite(ground) ? Math.round(ground * 10) / 10 : 15,
    ...flat,
  ]);
}
out.sort((a, b) => a[0] - b[0]);
const doc = {
  origin: ORIGIN,
  source:
    'NYC Open Data · Building Footprints (NYC OTI/DoITT, 5zhs-2jue), roof heights from photogrammetry',
  fetchedAt: new Date().toISOString(),
  count: out.length,
  b: out,
};
const file = path.join(HERE, 'midtown-buildings.json');
await writeFile(file, await prettyJson(doc));
console.log(`wrote ${out.length} buildings → ${file}`);
