#!/usr/bin/env node
/**
 * Captures a bundled flight-history recording for the time machine
 * (DESIGN.md §12.5). For N minutes it polls the real feeds the engine uses
 * (adsb.lol point snapshots around each region's anchors, the dev server's
 * /api/flights as a fallback and its /api/military), keeps the busiest
 * regions, and writes one file per region to mobile/demo/history/<region>.json.
 *
 *   npx vite --port 4191 --strictPort      # a dev server, for the fallbacks
 *   node mobile/demo/capture-history.mjs [--base http://localhost:4191]
 *        [--minutes 150] [--poll 20] [--budget 4000000] [--out dir]
 *   (behind an HTTPS proxy: NODE_USE_ENV_PROXY=1 node …)
 *
 * The engine's normalisation (flightFromState, classifyAircraft) is used, and the
 * same sampling as the recorder's persisted history: one fix per 30 s for
 * low traffic, one per 120 s for cruise. The file keeps the real capture
 * timestamps; the engine never shifts them.
 *
 * File format (quantised, delta-encoded):
 *   { format: 'gev-history/1', region, label, bbox, capturedAt: { start, end },
 *     source, t0 (epoch s), tracks: [{ k, m, p }] }
 *   k: recorder key (icao24 / hex)        m: recorder meta (callsign, type…)
 *   p: comma-separated ints, 6 per sample, deltas from the previous sample:
 *      dt (s) · dlon (1e-4°) · dlat (1e-4°) · dalt (10 m) · heading (°, absolute)
 *      · speed (m/s, absolute)
 * Written every 5 minutes, so an interrupted run still leaves a usable file.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flightFromState } from '../globe/feeds.js';
import { classifyAircraft } from '../../src/data/aircraftClass.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((kv) => {
      const [k, ...v] = kv.trim().split(/\s+/);
      return [k, v.join(' ') || true];
    }),
);
const BASE = args.base || 'http://localhost:4191';
const MINUTES = Number(args.minutes || 150);
const POLL_S = Number(args.poll || 20);
const BUDGET = Number(args.budget || 4_000_000);
const OUT = args.out ? path.resolve(args.out) : path.join(HERE, 'history');

const REGIONS = [
  {
    id: 'nyc',
    label: 'New York area',
    bbox: { west: -76.5, south: 39.4, east: -71.2, north: 42.2 },
    anchors: [{ lat: 40.75, lon: -73.98 }],
  },
  {
    id: 'london',
    label: 'London and the North Sea approaches',
    bbox: { west: -2.6, south: 50.2, east: 5.6, north: 53.6 },
    anchors: [
      { lat: 51.51, lon: -0.12 },
      { lat: 52.2, lon: 4.2 },
    ],
  },
  {
    id: 'gulf',
    label: 'Gulf of Mexico',
    bbox: { west: -98.5, south: 23.5, east: -81.5, north: 31.2 },
    anchors: [
      { lat: 27.5, lon: -90 },
      { lat: 29.6, lon: -95.2 },
      { lat: 27.9, lon: -83.5 },
    ],
  },
];

const CRUISE_ALT_M = 6000;
const LOW_GAP_S = 30;
const CRUISE_GAP_S = 120;

const inBox = (b, lon, lat) =>
  lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

/** region id → Map(key → { meta, pts: [[t, lon, lat, alt, hdg, spd]] }) */
const store = new Map(REGIONS.map((r) => [r.id, new Map()]));
let firstAt = Infinity;
let lastAt = -Infinity;
const sources = new Set();

function add(region, key, meta, s) {
  const tracks = store.get(region.id);
  let tr = tracks.get(key);
  if (!tr) {
    tr = { meta, pts: [] };
    tracks.set(key, tr);
  } else tr.meta = { ...tr.meta, ...meta };
  const last = tr.pts[tr.pts.length - 1];
  const gap = s[3] > CRUISE_ALT_M ? CRUISE_GAP_S : LOW_GAP_S;
  if (last && s[0] - last[0] < gap) return;
  tr.pts.push(s);
  if (s[0] < firstAt) firstAt = s[0];
  if (s[0] > lastAt) lastAt = s[0];
}

function ingest(records) {
  const nowS = Date.now() / 1000;
  for (const r of records) {
    if (!Number.isFinite(r.lon) || !Number.isFinite(r.lat)) continue;
    if (r.onGround && (r.speed ?? 0) < 8) continue;
    const t = Math.floor(
      Math.min(r.seenAt ?? Date.now(), Date.now() + 5000) / 1000,
    );
    if (nowS - t > 15 * 60) continue;
    const region = REGIONS.find((g) => inBox(g.bbox, r.lon, r.lat));
    if (!region) continue;
    const meta = {
      kind: r.military ? 'military' : r.helicopter ? 'helicopter' : 'aircraft',
      layer: r.military ? 'military' : 'flights',
      callsign: r.callsign || undefined,
      ...(r.registration ? { registration: r.registration } : {}),
      ...(r.type ? { type: r.type } : {}),
      ...(r.country ? { country: r.country } : {}),
      ...(r.squawk ? { squawk: r.squawk } : {}),
      ...(r.helicopter ? { helicopter: true } : {}),
      ...(r.military ? { military: true } : {}),
      ...(r.ga ? { ga: true } : {}),
      ...(r.pia ? { pia: true } : {}),
      ...(r.ladd ? { ladd: true } : {}),
    };
    add(region, String(r.id), meta, [
      t,
      r.lon,
      r.lat,
      Math.round(r.altM ?? 0),
      Math.round(r.heading ?? 0),
      Math.round(r.speed ?? 0),
    ]);
  }
}

async function getJson(url, headers = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { json: await res.json(), headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

const ADSBLOL = 'https://api.adsb.lol/v2';
const UA = { 'User-Agent': 'gods-eye-view-history-capture/1.0' };

/** adsb.lol v2 aircraft → the engine's flight record shape. */
function fromAdsbLol(a, nowMs) {
  if (!Number.isFinite(a.lon) || !Number.isFinite(a.lat)) return null;
  const onGround = a.alt_baro === 'ground';
  const altFt = Number.isFinite(a.alt_geom) ? a.alt_geom : a.alt_baro;
  const cls = classifyAircraft({ typeCode: a.t, category: a.category });
  const military = Boolean(a.dbFlags & 1);
  return {
    id: String(a.hex).replace(/^~/, ''),
    callsign: String(a.flight || a.r || a.hex).trim(),
    registration: a.r || '',
    type: a.t || '',
    lon: a.lon,
    lat: a.lat,
    altM: onGround
      ? 0
      : Math.max(0, (Number.isFinite(altFt) ? altFt : 15000) * 0.3048),
    onGround,
    speed: Number.isFinite(a.gs) ? a.gs * 0.514444 : 0,
    heading: a.track ?? a.true_heading ?? 0,
    squawk: a.squawk || null,
    helicopter: cls === 'helicopter',
    military,
    pia: Boolean(a.dbFlags & 4),
    ladd: Boolean(a.dbFlags & 8),
    seenAt: nowMs - (a.seen_pos ?? a.seen ?? 0) * 1000,
  };
}

/**
 * Each region's anchors straight from adsb.lol (250 nm point queries, the
 * same source the dev server falls back to); an anchor that fails is asked
 * through the dev server instead.
 */
async function pollFlights() {
  let n = 0;
  for (const g of REGIONS) {
    for (const a of g.anchors) {
      // Polite spacing: adsb.lol answers 429 to bursts.
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const { json } = await getJson(
          `${ADSBLOL}/lat/${a.lat}/lon/${a.lon}/dist/250`,
          UA,
        );
        const now = Number.isFinite(json.now) ? json.now : Date.now();
        const recs = (json.ac || [])
          .map((x) => fromAdsbLol(x, now))
          .filter(Boolean);
        ingest(recs);
        n += recs.length;
        sources.add('adsb.lol (ODbL)');
        continue;
      } catch (error) {
        console.warn(`[adsb.lol ${g.id}]`, error.message);
      }
      try {
        const { json } = await getJson(
          `${BASE}/api/flights?lat=${a.lat}&lon=${a.lon}`,
        );
        const recs = (json.states || []).map(flightFromState).filter(Boolean);
        ingest(recs);
        n += recs.length;
        sources.add('God’s Eye dev server (OpenSky / adsb.lol)');
      } catch (error) {
        console.warn(`[flights ${g.id}]`, error.message);
      }
    }
  }
  return n;
}

async function pollMilitary() {
  try {
    const { json } = await getJson(`${BASE}/api/military`);
    const recs = [];
    for (const a of json.ac || []) {
      if (!Number.isFinite(a.lon) || !Number.isFinite(a.lat)) continue;
      const altFt = Number.isFinite(a.alt_geom) ? a.alt_geom : a.alt_baro;
      recs.push({
        id: String(a.hex),
        callsign: String(a.flight || a.r || a.hex).trim(),
        registration: a.r || '',
        type: a.t || '',
        lon: a.lon,
        lat: a.lat,
        altM:
          a.alt_baro === 'ground' ? 0 : Math.max(0, (altFt ?? 15000) * 0.3048),
        onGround: a.alt_baro === 'ground',
        speed: Number.isFinite(a.gs) ? a.gs * 0.514444 : 0,
        heading: a.track ?? a.true_heading ?? 0,
        squawk: a.squawk || null,
        military: true,
        pia: Boolean(a.dbFlags & 4),
        ladd: Boolean(a.dbFlags & 8),
        seenAt: Date.now() - (a.seen_pos ?? a.seen ?? 0) * 1000,
      });
    }
    ingest(recs);
    sources.add('adsb.lol military (ODbL)');
    return recs.length;
  } catch (error) {
    console.warn('[military]', error.message);
    return 0;
  }
}

function encode(region, cruiseGap) {
  const tracks = [];
  const t0 = Number.isFinite(firstAt) ? firstAt : Math.floor(Date.now() / 1000);
  for (const [k, tr] of store.get(region.id)) {
    if (tr.pts.length < 2) continue;
    const p = [];
    let prev = [t0, 0, 0, 0];
    let keptT = -Infinity;
    tr.pts.forEach((s, i) => {
      const isLast = i === tr.pts.length - 1;
      if (
        cruiseGap > CRUISE_GAP_S &&
        s[3] > CRUISE_ALT_M &&
        !isLast &&
        s[0] - keptT < cruiseGap
      )
        return;
      keptT = s[0];
      const lon = Math.round(s[1] * 1e4);
      const lat = Math.round(s[2] * 1e4);
      const alt = Math.round(s[3] / 10);
      p.push(
        s[0] - prev[0],
        lon - prev[1],
        lat - prev[2],
        alt - prev[3],
        s[4],
        s[5],
      );
      prev = [s[0], lon, lat, alt];
    });
    // A string, so the file stays compact under Prettier.
    tracks.push({ k, m: tr.meta, p: p.join(',') });
  }
  return {
    format: 'gev-history/1',
    region: region.id,
    label: region.label,
    bbox: region.bbox,
    capturedAt: {
      start: new Date(firstAt * 1000).toISOString(),
      end: new Date(lastAt * 1000).toISOString(),
    },
    source: [...sources].join(' · '),
    note: 'Real recorded positions, captured through the God’s Eye dev server. Timestamps are the true capture times and are never shifted.',
    t0,
    tracks,
  };
}

/** Prettier-clean JSON (the repo checks mobile/ with Prettier). */
async function pretty(text) {
  try {
    const prettier = await import('prettier');
    return await prettier.format(text, { parser: 'json' });
  } catch {
    return text + '\n';
  }
}

async function save() {
  await mkdir(OUT, { recursive: true });
  let gap = CRUISE_GAP_S;
  for (;;) {
    const files = REGIONS.map((g) => [g, JSON.stringify(encode(g, gap))]);
    const bytes = files.reduce((n, [, s]) => n + s.length, 0);
    if (bytes > BUDGET && gap < 300) {
      gap += 60;
      continue;
    }
    for (const [g, text] of files)
      await writeFile(path.join(OUT, `${g.id}.json`), await pretty(text));
    const index = {
      format: 'gev-history-index/1',
      capturedAt: {
        start: new Date(firstAt * 1000).toISOString(),
        end: new Date(lastAt * 1000).toISOString(),
      },
      regions: REGIONS.map((g, i) => ({
        id: g.id,
        label: g.label,
        bbox: g.bbox,
        file: `${g.id}.json`,
        tracks: JSON.parse(files[i][1]).tracks.length,
      })),
    };
    await writeFile(
      path.join(OUT, 'index.json'),
      await pretty(JSON.stringify(index)),
    );
    console.log(
      `[save] ${new Date().toISOString()} span ${Math.round((lastAt - firstAt) / 60)} min, ${Math.round(bytes / 1024)} KB (cruise gap ${gap}s)`,
    );
    return;
  }
}

const until = Date.now() + MINUTES * 60_000;
let polls = 0;
let lastSave = Date.now();
let lastMil = 0;
console.log(`capturing ${MINUTES} min from ${BASE} → ${OUT}`);
while (Date.now() < until) {
  const started = Date.now();
  const n = await pollFlights();
  if (Date.now() - lastMil > 40_000) {
    lastMil = Date.now();
    await pollMilitary();
  }
  polls++;
  if (polls % 15 === 1)
    console.log(
      `[poll ${polls}] ${n} aircraft; tracks ${REGIONS.map((g) => `${g.id}:${store.get(g.id).size}`).join(' ')}`,
    );
  if (Date.now() - lastSave > 5 * 60_000) {
    lastSave = Date.now();
    await save().catch((e) => console.warn('[save]', e.message));
  }
  const wait = POLL_S * 1000 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
await save();
console.log('done');
