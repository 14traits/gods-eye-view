#!/usr/bin/env node
/**
 * Builds mobile/demo/midtown-water.json: the Hudson and East River around
 * the Empire State Moment, from OpenStreetMap water polygons (OpenFreeMap
 * vector tiles, OpenMapTiles schema, ODbL).
 *
 * Why: Esri World Imagery stitches two different water sources across the
 * Hudson, and from a low oblique camera the seam reads as a black-and-olive
 * staircase. The stage paints these real water polygons over the imagery so
 * the rivers read as one calm dark surface.
 *
 *   node mobile/demo/build-midtown-water.mjs
 *
 * Output: { origin:[lon,lat], source, fetchedAt, polys:[[[x0,y0,…], hole…]] }
 * with integer metres east/north of `origin`.
 */
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, '..', '..', 'package.json'));
const vt = await import(require.resolve('@mapbox/vector-tile'));
const VectorTile = vt.VectorTile || vt.default?.VectorTile;
const pbfMod = await import(require.resolve('pbf'));
const Pbf = pbfMod.default?.default || pbfMod.default || pbfMod.PbfReader;

const ORIGIN = [-73.9857, 40.7484];
const BBOX = { west: -74.08, east: -73.88, south: 40.68, north: 40.82 };
const Z = 13;
const kx = 111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180);
const ky = 110_574;

async function prettyJson(value) {
  const text = JSON.stringify(value);
  try {
    const prettier = await import('prettier');
    return await prettier.format(text, { parser: 'json' });
  } catch {
    return `${text}\n`;
  }
}

const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tileY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z,
  );
};

const meta = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const template = meta.tiles[0];
const polys = [];
for (let x = tileX(BBOX.west); x <= tileX(BBOX.east); x++)
  for (let y = tileY(BBOX.north); y <= tileY(BBOX.south); y++) {
    const url = template.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`tile ${x}/${y} HTTP ${r.status}`);
    const tile = new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer())));
    const water = tile.layers.water;
    if (!water) continue;
    for (let i = 0; i < water.length; i++) {
      const gj = water.feature(i).toGeoJSON(x, y, Z);
      const list =
        gj.geometry.type === 'Polygon'
          ? [gj.geometry.coordinates]
          : gj.geometry.type === 'MultiPolygon'
            ? gj.geometry.coordinates
            : [];
      for (const rings of list) {
        const out = rings.map((ring) => {
          const flat = [];
          let px = null;
          let py = null;
          for (const [lon, lat] of ring) {
            const mx = Math.round((lon - ORIGIN[0]) * kx);
            const my = Math.round((lat - ORIGIN[1]) * ky);
            if (px !== null && Math.abs(mx - px) < 8 && Math.abs(my - py) < 8)
              continue;
            flat.push(mx, my);
            px = mx;
            py = my;
          }
          return flat;
        });
        // Drop ponds: only rivers, bays and harbour (big outer rings).
        const o = out[0];
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < o.length; k += 2) {
          minX = Math.min(minX, o[k]);
          maxX = Math.max(maxX, o[k]);
          minY = Math.min(minY, o[k + 1]);
          maxY = Math.max(maxY, o[k + 1]);
        }
        if (o.length >= 6 && maxX - minX + (maxY - minY) > 600)
          polys.push(out.filter((ring) => ring.length >= 6));
      }
    }
  }

const doc = {
  origin: ORIGIN,
  source:
    'OpenStreetMap contributors (ODbL) via OpenFreeMap vector tiles, water layer',
  fetchedAt: new Date().toISOString(),
  count: polys.length,
  polys,
};
const file = path.join(HERE, 'midtown-water.json');
await writeFile(file, await prettyJson(doc));
console.log(`wrote ${polys.length} water polygons → ${file}`);
