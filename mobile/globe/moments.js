/**
 * Moments (DESIGN.md §12.4): 4D reconstructions on one clock.
 *
 *   bundled   the hero, "Climbers on the Empire State Building"
 *             (mobile/demo/moments/empire-state.json, illustrative: true)
 *   live      built on demand from the recorder for every detection
 *             (circling, emergency squawk): real tracks, illustrative: false
 */
import { localPlace } from './gazetteer.js';

const HERO_URL = new URL('../demo/moments/empire-state.json', import.meta.url)
  .href;
const BUILDINGS_URL = new URL('../demo/midtown-buildings.json', import.meta.url)
  .href;
const D2R = Math.PI / 180;

let heroPromise = null;
let buildingsPromise = null;

export function loadHero() {
  if (!heroPromise)
    heroPromise = fetch(HERO_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .catch((error) => {
        heroPromise = null;
        throw error;
      });
  return heroPromise;
}

const WATER_URL = new URL('../demo/midtown-water.json', import.meta.url).href;
let waterPromise = null;

/** River surfaces drawn over the imagery seam (see build-midtown-water.mjs). */
export function loadWater(name) {
  if (name !== 'midtown-water.json') return Promise.resolve(null);
  if (!waterPromise)
    waterPromise = fetch(WATER_URL)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => {
        waterPromise = null;
        return null;
      });
  return waterPromise;
}

export function loadBuildings(name) {
  if (name !== 'midtown-buildings.json') return Promise.resolve(null);
  if (!buildingsPromise)
    buildingsPromise = fetch(BUILDINGS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => {
        buildingsPromise = null;
        return null;
      });
  return buildingsPromise;
}

/** A slow orbit of camera keys around a point (for live Moments). */
export function orbitCameraPath(
  lon,
  lat,
  start,
  end,
  { rangeM = 2600, heightM = 1100, lookAltM = 250, startBearing = 200 } = {},
) {
  const keys = [];
  const n = 9;
  const kx = 111_320 * Math.cos(lat * D2R);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const b = (startBearing + 140 * f) % 360;
    const r = rangeM * (1.2 - 0.35 * Math.sin(Math.PI * f));
    const h = heightM * (1.15 - 0.3 * Math.sin(Math.PI * f));
    const x = Math.sin(b * D2R) * r;
    const y = Math.cos(b * D2R) * r;
    keys.push({
      t: Math.round(start + (end - start) * f),
      lon: lon + x / kx,
      lat: lat + y / 110_574,
      height: Math.round(h),
      heading: (b + 180) % 360,
      pitch: (Math.atan2(lookAltM - h, r) * 180) / Math.PI,
    });
  }
  return keys;
}

/**
 * A live Moment from a circling detection, from the recorder's samples.
 * @param {object} det detector output
 * @param {object} recorder
 */
export function momentFromCircling(det, recorder) {
  const start = Math.max(det.since - 4 * 60_000, Date.now() - 45 * 60_000);
  const end = Math.max(det.updatedAt, Date.now());
  const tracks = [];
  for (const m of det.members) {
    const pts = recorder
      .samples(m.key, start, end)
      .map((p) => ({ t: p.t, lon: p.lon, lat: p.lat, altM: p.altM }));
    if (pts.length < 2) continue;
    const meta = recorder.meta(m.key) || {};
    tracks.push({
      id: m.key,
      entityId: `${meta.layer || 'flights'}:${m.key}`,
      kind: meta.helicopter ? 'helicopter' : 'aircraft',
      label: meta.callsign || m.key.toUpperCase(),
      callsign: meta.callsign || null,
      registration: meta.registration || null,
      type: meta.type || null,
      operator: '',
      points: pts,
    });
  }
  let maxAlt = 0;
  for (const tr of tracks)
    for (const p of tr.points) maxAlt = Math.max(maxAlt, p.altM);
  const place = localPlace(det.lat, det.lon).name;
  return {
    id: `live-${det.id}`,
    title: det.title,
    place,
    lon: det.lon,
    lat: det.lat,
    time: { start, end },
    illustrative: false,
    live: true,
    situationId: det.id,
    recommendedSpeed: 30,
    subject: { lon: det.lon, lat: det.lat, altM: 0, label: place },
    cameraPath: orbitCameraPath(det.lon, det.lat, start, end, {
      rangeM: 2000,
      heightM: Math.max(1400, maxAlt * 3),
      lookAltM: maxAlt * 0.4,
    }),
    beats: [{ t: det.since, title: 'First complete orbit in the record' }],
    tracks,
    captures: [],
    chat: [],
    posts: [],
    sources: [
      {
        name: 'God’s Eye recorder',
        detail:
          'Positions recorded from live ADS-B polls (OpenSky Network / adsb.lol, ODbL) in this browser.',
      },
      {
        name: 'Circling detector',
        detail: `${det.members.length} aircraft each completed at least one orbit within 1.5 km of a common centre.`,
      },
    ],
  };
}

/** A live Moment for one aircraft (an emergency squawk) from its track. */
export function momentFromAircraft({ id, title, key, points, meta, place }) {
  if (!points?.length) return null;
  const start = points[0].t;
  const end = Math.max(points.at(-1).t, start + 60_000);
  const last = points.at(-1);
  return {
    id,
    title,
    place: place || localPlace(last.lat, last.lon).name,
    lon: last.lon,
    lat: last.lat,
    time: { start, end },
    illustrative: false,
    live: true,
    recommendedSpeed: 60,
    subject: null,
    follow: { trackId: key, rangeM: 22_000, heightM: 7_000 },
    cameraPath: [],
    beats: [],
    tracks: [
      {
        id: key,
        entityId: `${meta?.layer || 'flights'}:${key}`,
        kind: meta?.helicopter ? 'helicopter' : 'aircraft',
        label: meta?.callsign || key.toUpperCase(),
        operator: '',
        points,
      },
    ],
    captures: [],
    chat: [],
    posts: [],
    sources: [
      {
        name: 'God’s Eye recorder',
        detail: 'Positions recorded from live ADS-B polls in this browser.',
      },
    ],
  };
}
