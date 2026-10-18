// The film's clock. Everything visual and audible keys off these numbers, so the
// renderer and the score (audio/score.py reads cues.json, exported from here)
// stay frame-locked. Pure module: no DOM, safe to import from Node.

export const FPS = 30;
export const DURATION = 72;
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

  // ACT 1 — the culture grows; the growth turns out to be drawing the planet
  growStart: 8.7,
  coastReached: 13.4,
  growEnd: 15.6,
  substrate: 16.0,

  // ACT 2 — indexing the surface
  indexStart: 17.0,
  zWave: [17.0, 19.0, 20.8], // z3, z4, z5 quadtree waves
  capStart: 18.3,
  capRapid: 23.4,
  capFull: 26.6,
  indexed: 30.0,

  // ACT 3 — ingestion, one feed at a time, accelerating
  air: 30.6,
  sea: 32.2,
  mil: 34.2,
  orbit: 37.0,
  quake: 40.2,
  fire: 42.2,
  wind: 44.0,
  cable: 45.9,
  cctv: 47.4,
  cctvWall: 49.0,
  rapid: 50.4,
  cctvOut: 52.4,

  // ACT 4 — saturation; the twin outgrows the dish
  saturate: 52.6,
  arcs: 53.4,
  twin: 55.2,
  dishBreak: 58.4,
  omni: 59.0,
  cut: 60.5,

  // ACT 5 — resolve
  title: 61.2,
  eyeOpen: 62.0,
  wordmark: 63.3,
  tagline: 65.0,
  online: 66.6,
  fadeOut: 70.0,
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
  { key: 'cctv', t: T.cctv, code: 'OPT', label: 'PUBLIC CAMERAS', src: '18 AGENCIES' },
];

// Synthetic captures in ACT 2: the first few take the slow "enhance" path, the
// rest fire rapidly into the contact sheet, then one blows up full frame.
export const CAPTURE_SLOW = 3;
export function captureTimes(count) {
  const out = [];
  const slot = [T.capStart, T.capStart + 1.75, T.capStart + 3.35];
  for (let i = 0; i < Math.min(CAPTURE_SLOW, count); i++) out.push(slot[i]);
  const rapidN = count - CAPTURE_SLOW;
  // Accelerating rapid-fire: intervals shrink from ~0.32 s to ~0.11 s.
  let t = T.capRapid;
  for (let i = 0; i < rapidN; i++) {
    out.push(t);
    const k = i / Math.max(1, rapidN - 1);
    t += 0.32 - 0.21 * k;
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
