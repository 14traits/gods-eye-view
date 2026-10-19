// The film's clock. Everything visual and audible keys off these numbers, so the
// renderer and the score (audio/score.py reads cues.json, exported from here)
// stay frame-locked. Pure module: no DOM, safe to import from Node.

export const FPS = 30;
export const DURATION = 95;
export const FRAMES = FPS * DURATION;

export const T = {
  // ACT 0 — the void
  cursor: 0.9,
  boot: 1.4,
  collapse: 4.9,
  seed: 5.35,
  beat1: 6.1,
  beat2: 7.35,
  dishDraw: 6.3,
  dishDone: 8.3,
  aperture: 7.35,

  // ACT 1 — the eye opens; the culture grows and turns out to be drawing the planet
  growStart: 8.7,
  coastReached: 13.4,
  growEnd: 15.6,
  substrate: 16.0,

  // ACT 2 — indexing the surface, accelerating until it is whipping round the world
  indexStart: 17.0,
  zWave: [17.0, 18.5, 19.8], // z3, z4, z5 quadtree waves
  capStart: 18.0,
  capRapid: 22.6,
  flurry: 23.6,
  flurryEnd: 29.4,
  capFull: 999, // v1's full-frame extraction now lives in the city act
  indexed: 30.0,

  // ACT 3 — global ingestion
  air: 30.6,
  sea: 32.0,
  mil: 33.4,
  orbit: 34.6,
  quake: 36.6,
  fire: 38.0,
  wind: 39.4,
  cable: 41.0,
  descend: 42.6,

  // ACT 4 — down into the world
  terrain: 43.6,
  nyc: 49.0,
  boston: 57.0,
  lax: 61.8,
  bragg: 66.4,
  cctv: 71.4,
  cctvWall: 71.4,
  rapid: 72.8,
  cctvOut: 76.4,

  // ACT 5 — saturation; the twin outgrows the dish
  saturate: 76.6,
  arcs: 77.3,
  twin: 79.1,
  dishBreak: 82.3,
  omni: 82.9,
  cut: 84.4,

  // ACT 6 — resolve
  title: 85.1,
  eyeOpen: 85.9,
  wordmark: 87.2,
  tagline: 88.9,
  online: 999,
  fadeOut: 93.0,
};

// Feeds as they register in the stack (ACT 3). `key` matches a layer.
export const FEEDS = [
  { key: 'air', t: T.air, code: 'ADS-B', label: 'AIRCRAFT', src: 'OPENSKY NETWORK' },
  { key: 'sea', t: T.sea, code: 'AIS', label: 'VESSELS', src: 'KYSTVERKET · DIGITRAFFIC' },
  { key: 'mil', t: T.mil, code: 'ADS-B', label: 'MILITARY', src: 'ADSB.LOL · ADSB.FI' },
  { key: 'orbit', t: T.orbit, code: 'TLE', label: 'SATELLITES', src: 'CELESTRAK' },
  { key: 'quake', t: T.quake, code: 'SEIS', label: 'EARTHQUAKES', src: 'USGS' },
  { key: 'fire', t: T.fire, code: 'IR', label: 'ACTIVE FIRES', src: 'NASA FIRMS' },
  { key: 'wind', t: T.wind, code: 'NWP', label: 'WIND · CLOUD', src: 'NOAA GFS · GIBS' },
  { key: 'cable', t: T.cable, code: 'GEO', label: 'SUBSEA CABLES', src: 'TELEGEOGRAPHY' },
];

// ACT 4 — the cities, in order
export const CITIES = [
  { slug: 'everest', t0: T.terrain, t1: T.nyc, name: 'MOUNT EVEREST', sub: 'KHUMBU · NEPAL / TIBET', lat: 27.9881, lon: 86.925 },
  { slug: 'nyc', t0: T.nyc, t1: T.boston, name: 'NEW YORK', sub: 'MIDTOWN · MANHATTAN', lat: 40.74, lon: -73.99 },
  { slug: 'boston', t0: T.boston, t1: T.lax, name: 'BOSTON', sub: 'MBTA · GTFS REALTIME', lat: 42.3555, lon: -71.0605 },
  { slug: 'lax', t0: T.lax, t1: T.bragg, name: 'LOS ANGELES INTL', sub: 'KLAX · AIRSIDE', lat: 33.9425, lon: -118.4081 },
  { slug: 'bragg', t0: T.bragg, t1: T.cctv, name: 'FORT BRAGG', sub: 'NORTH CAROLINA · POPE FIELD', lat: 35.158, lon: -79.009 },
];

// Synthetic captures in ACT 2: the first few take the slow "enhance" path, the
// rest fire rapidly into the contact sheet, then one blows up full frame.
export const CAPTURE_SLOW = 3;
export function captureTimes(count) {
  const out = [];
  const slot = [T.capStart, T.capStart + 1.6, T.capStart + 3.1];
  for (let i = 0; i < Math.min(CAPTURE_SLOW, count); i++) out.push(slot[i]);
  const rapidN = count - CAPTURE_SLOW;
  // Accelerating rapid-fire: intervals shrink from ~0.32 s to ~0.11 s.
  let t = T.capRapid;
  for (let i = 0; i < rapidN; i++) {
    out.push(t);
    const k = i / Math.max(1, rapidN - 1);
    t += 0.12 - 0.08 * k;
  }
  return out;
}

// ------------------------------------------------------------------ helpers
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ramp = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = (t, a, b) => {
  const x = ramp(t, a, b);
  return x * x * (3 - 2 * x);
};
export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x) => 1 - Math.pow(1 - x, 3);
export const easeIn = (x) => x * x * x;
export const expoOut = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const expoInOut = (x) =>
  x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;

// Window: 0 before a, ramps up over `inDur`, holds, ramps down to 0 ending at b.
export function win(t, a, b, inDur = 0.3, outDur = 0.3) {
  return Math.min(smooth(t, a, a + inDur), 1 - smooth(t, b - outDur, b));
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Counter that eases toward `to` and keeps visibly ticking while it does.
export function count(t, a, b, from, to, curve = expoOut) {
  return Math.round(lerp(from, to, curve(ramp(t, a, b))));
}
