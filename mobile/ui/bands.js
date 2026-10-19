/**
 * Altitude bands (DESIGN.md §11.1): the app's subject is where the sensor is
 * and how high it is, from orbit to sky to ground to inside (you).
 * Shared helpers for band, archetype, telemetry strips, MGRS and distance.
 */

export const BANDS = [
  { id: 'orbit', name: 'Orbit', range: '400–36,000 km', short: 'ORB' },
  { id: 'sky', name: 'Sky', range: '0–15 km', short: 'SKY' },
  { id: 'ground', name: 'Ground', range: '0 m', short: 'GND' },
  { id: 'inside', name: 'Inside', range: 'you', short: 'INS' },
];
export const BAND_NAME = Object.fromEntries(BANDS.map((b) => [b.id, b.name]));
export const BAND_COLOR = {
  orbit: '#b39dff',
  sky: '#a3d8ff',
  ground: '#ffb547',
  inside: '#ebc777',
};

const KIND_BAND = [
  [
    /iss|station|satellite|starlink|launch|pass|orbit|cyclone|typhoon|hurricane|aurora|cloud|ir\b/i,
    'orbit',
  ],
  [
    /flight|aircraft|squawk|military|heli|airport|holding|lightning|radar|storm|rain|gnss|jam|jet|wind/i,
    'sky',
  ],
  [/reconstruction|witness|capture|live|room|hologram/i, 'inside'],
];

/** The altitude band of the sensor that sees a situation. */
export function bandOf(s) {
  if (!s) return 'ground';
  if (s.band && BAND_NAME[s.band]) return s.band;
  const k = `${s.kind || ''}`;
  for (const [re, b] of KIND_BAND) if (re.test(k)) return b;
  if (s.family === 'orbit') return 'orbit';
  if (s.family === 'sky' || s.family === 'weather') return 'sky';
  return 'ground';
}

/** Card archetype: engine-provided, else inferred honestly from the data. */
export function archetypeOf(s) {
  if (s.archetype) return s.archetype;
  if (s.media?.url || s.media?.frameUrl) return 'eye';
  const k = `${s.kind || ''}`;
  if (/squawk|track|heli|iss|pass|launch/.test(k)) return 'track';
  if (realSeries(s).length >= 4 && /gnss|lightning|queue|count|strait/.test(k))
    return 'number';
  return 'sensor';
}

/** A series is drawn only when it is real: [{t,v}] from the engine or numbers. */
export function realSeries(s) {
  const raw = Array.isArray(s?.series) ? s.series : [];
  return raw
    .map((p) => (typeof p === 'number' ? p : Number(p?.v)))
    .filter(Number.isFinite);
}

/** The one big number for track/number cards. */
export function headlineOf(s) {
  if (s.headline && s.headline.value != null) return s.headline;
  const m = s.metrics?.[0];
  return m ? { value: m.value, unit: m.unit || '', label: m.label } : null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 14:02:11Z */
export function utc(d = new Date(), { seconds = true } = {}) {
  const t = d instanceof Date ? d : new Date(d);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}${seconds ? `:${pad(t.getUTCSeconds())}` : ''}Z`;
}

/** 37.77N 122.42W */
export function llShort(lat, lon, d = 2) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${Math.abs(lat).toFixed(d)}${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(d)}${lon >= 0 ? 'E' : 'W'}`;
}

const CARD16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];
export const cardinal = (deg) =>
  Number.isFinite(deg)
    ? CARD16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]
    : '';

/* ---------------- MGRS (WGS84, no Norway/Svalbard exceptions) ------------- */

export function mgrs(lat, lon, digits = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -80 || lat > 84)
    return '';
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  const T = Math.tan(φ) ** 2;
  const C = ep2 * Math.cos(φ) ** 2;
  const A = Math.cos(φ) * (λ - lon0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * φ -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) *
        Math.sin(2 * φ) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * φ) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * φ));
  const E =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000;
  let Nn =
    k0 *
    (M +
      N *
        Math.tan(φ) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) Nn += 10000000;
  const bandL = 'CDEFGHJKLMNPQRSTUVWXX'[Math.floor((lat + 80) / 8)];
  const set = ((zone - 1) % 6) + 1;
  const cols = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'][(set - 1) % 3];
  const rows = 'ABCDEFGHJKLMNPQRSTUV';
  const col = cols[Math.floor(E / 100000) - 1] || '?';
  const row =
    rows[(Math.floor(Nn / 100000) + (set % 2 === 0 ? 5 : 0)) % 20] || '?';
  const div = 10 ** (5 - digits);
  const e = pad(Math.floor((E % 100000) / div), digits);
  const n = pad(Math.floor((Nn % 100000) / div), digits);
  return `${zone}${bandL} ${col}${row} ${e} ${n}`;
}

/* ---------------- Distance ---------------- */

export function distKm(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat))
    return NaN;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** "180 m", "3.4 km", "1,240 km" */
export function fmtKm(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

/** Radius inside which a person counts as "there" for a situation. */
export function presenceRadiusKm(s) {
  const k = `${s?.kind || ''}`;
  if (/cyclone|typhoon|hurricane/.test(k)) return 400;
  if (/quake/.test(k)) return 150;
  if (/aurora|gnss|military|lightning|storm|rain/.test(k)) return 120;
  if (/fire/.test(k)) return 40;
  if (archetypeOf(s) === 'eye' || /cam|cctv/.test(k)) return 1.5;
  if (/airport|port|transit|strait|queue/.test(k)) return 20;
  return 30;
}

/** Telemetry strip for a situation (the engine's when present). */
export function telemetryOf(s) {
  if (s.telemetry) return String(s.telemetry).toUpperCase();
  const band = bandOf(s);
  const ll = llShort(s.lat, s.lon, 2);
  const hl = headlineOf(s);
  const hv =
    hl && typeof hl.value !== 'object'
      ? `${hl.value}${hl.unit ? ` ${hl.unit}` : ''}`.toUpperCase()
      : '';
  if (band === 'orbit') return ['ORBIT', hv, ll].filter(Boolean).join(' · ');
  if (band === 'sky') return ['SKY', hv, ll].filter(Boolean).join(' · ');
  if (band === 'inside') return ['INSIDE', hv, ll].filter(Boolean).join(' · ');
  return ['GROUND', hv, mgrs(s.lat, s.lon, 3) || ll]
    .filter(Boolean)
    .join(' · ');
}

/** Sensor id-ish label for the top-right of a frame. */
export function sensorId(s) {
  if (s.media?.cameraId) return `CAM ${String(s.media.cameraId).slice(-6)}`;
  const band = bandOf(s);
  const h = Math.abs(
    [...String(s.id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7),
  );
  const tag = { orbit: 'SAT', sky: 'ADS', ground: 'GND', inside: 'WIT' }[band];
  return `${tag} ${String(h % 10000).padStart(4, '0')}`;
}
