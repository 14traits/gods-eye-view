/**
 * The card compositor (DESIGN.md §11.2 sensor cards): thumbnail(situation)
 * renders a still in an offscreen 2D canvas, never the Cesium viewer.
 *
 *   base imagery  → Esri World Imagery tiles (CORS-clean) or NASA GIBS
 *                   Black Marble for orbit cards; camera frame for eye cards
 *   real overlays → the data that describes the situation (NOAA IR with a
 *                   cold-top enhancement, radar, lightning by age, NHC cone,
 *                   track and wind radii, aircraft with velocity leaders,
 *                   quake rings, fire + wind-blown smoke, SGP4 ground tracks,
 *                   jet-stream streamlines, transit vehicles, GNSS hex heat)
 *   grade         → per altitude band (orbit violet night, sky cool, ground
 *                   warm amber) and a vignette. No text, no brackets: the
 *                   shell draws framing in HTML so it stays crisp.
 *
 * Results are object URLs, cached in memory and (when available) the Cache
 * API; tiles are shared across cards; at most three cards render at once.
 */
import { twoline2satrec } from 'satellite.js';
import { satPosition } from './layers/orbit.js';
import { radiiRing, RADII_COLORS } from './layers/hazards.js';
import { SCENES, EYE_FRAMES, dbzOf } from './situations.js';
import { cctvFrameUrl } from './feeds.js';
import { aqiColor, sampleField } from './feedsWeather.js';
import { strikeLevel } from './layers/weather.js';
import { BLACK_MARBLE_URL } from './imagery.js';
import { cachedThumbnail, rememberThumbnail } from './cache.js';

const D2R = Math.PI / 180;
const ESRI_TILE = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const BLACK_MARBLE_TILE = (z, x, y) =>
  BLACK_MARBLE_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x);
const GIBS_TILE = (layer, day, ext, level) => (z, x, y) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${day}/GoogleMapsCompatible_Level${level}/${z}/${y}/${x}.${ext}`;
const CACHE_NAME = 'gev-thumbs-v2';
const VERSION = 'v2';

/* ───────────────────────── Projection ───────────────────────── */

function mercY(lat) {
  const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * D2R);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** A Web Mercator view of `spanKm` across the card's shorter side. */
export function makeView(lon, lat, spanKm, W, H) {
  const mpp = (spanKm * 1000) / Math.min(W, H);
  const zf = Math.max(
    0.6,
    Math.min(19, Math.log2((156543.03392 * Math.cos(lat * D2R)) / mpp)),
  );
  const scale = 256 * 2 ** zf;
  const cx = ((lon + 180) / 360) * scale;
  const cy = mercY(lat) * scale;
  const view = {
    lon,
    lat,
    W,
    H,
    zf,
    scale,
    cx,
    cy,
    /** Canvas px for lon/lat, wrapping longitude toward the centre. */
    project(lo, la) {
      let x = ((lo + 180) / 360) * scale - cx;
      if (x > scale / 2) x -= scale;
      if (x < -scale / 2) x += scale;
      return [x + W / 2, mercY(la) * scale - cy + H / 2];
    },
    unproject(x, y) {
      const wx = x - W / 2 + cx;
      const wy = y - H / 2 + cy;
      const lo = (wx / scale) * 360 - 180;
      const n = Math.PI - (2 * Math.PI * wy) / scale;
      return [
        ((lo + 540) % 360) - 180,
        (Math.atan(Math.sinh(n)) * 180) / Math.PI,
      ];
    },
    /** Pixels per km at the view centre. */
    pxPerKm: Math.min(W, H) / spanKm,
  };
  return view;
}

/* ───────────────────────── Fetching ───────────────────────── */

const tileCache = new Map();
const TILE_CACHE_MAX = 400;

function loadImage(url, { cors = true } = {}) {
  let p = tileCache.get(url);
  if (p) {
    tileCache.delete(url);
    tileCache.set(url, p);
    return p;
  }
  p = fetch(url, { mode: cors ? 'cors' : 'same-origin' })
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => (b && b.size > 0 ? createImageBitmap(b) : null))
    .catch(() => null);
  tileCache.set(url, p);
  while (tileCache.size > TILE_CACHE_MAX)
    tileCache.delete(tileCache.keys().next().value);
  return p;
}

/** Draw slippy-map tiles for the view. Returns how many tiles drew. */
async function drawTiles(g, view, urlFor, { maxZ = 18, minZ = 0 } = {}) {
  const z = Math.max(minZ, Math.min(maxZ, Math.round(view.zf)));
  const k = 2 ** (view.zf - z);
  const n = 2 ** z;
  const cxz = view.cx / k;
  const cyz = view.cy / k;
  const x0 = Math.floor((cxz - view.W / 2 / k) / 256);
  const x1 = Math.floor((cxz + view.W / 2 / k) / 256);
  const y0 = Math.max(0, Math.floor((cyz - view.H / 2 / k) / 256));
  const y1 = Math.min(n - 1, Math.floor((cyz + view.H / 2 / k) / 256));
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const wx = ((tx % n) + n) % n;
      jobs.push(loadImage(urlFor(z, wx, ty)).then((img) => ({ img, tx, ty })));
    }
  let drawn = 0;
  for (const { img, tx, ty } of await Promise.all(jobs)) {
    if (!img) continue;
    const dx = (tx * 256 - cxz) * k + view.W / 2;
    const dy = (ty * 256 - cyz) * k + view.H / 2;
    g.drawImage(img, dx, dy, 256 * k + 0.6, 256 * k + 0.6);
    drawn++;
  }
  return drawn;
}

/** Weather detail window (2:1, 0.25° grid) around the view, inside bounds. */
function detailBbox(view, bounds, minWidthDeg = 1) {
  const [w0, n0] = view.unproject(0, 0);
  const [e0, s0] = view.unproject(view.W, view.H);
  const lonSpan = (e0 - w0 + 360) % 360 || 360;
  let width = Math.max(minWidthDeg, lonSpan * 1.05, (n0 - s0) * 2 * 1.05);
  width = Math.ceil(width / 0.5) * 0.5;
  const height = width / 2;
  if (width > bounds.east - bounds.west || height > bounds.north - bounds.south)
    return null;
  const snap = (v) => Math.round(v / 0.25) * 0.25;
  let west = snap(view.lon - width / 2);
  let south = snap(view.lat - height / 2);
  west = Math.max(
    Math.ceil(bounds.west / 0.25) * 0.25,
    Math.min(west, Math.floor((bounds.east - width) / 0.25) * 0.25),
  );
  south = Math.max(
    Math.ceil(bounds.south / 0.25) * 0.25,
    Math.min(south, Math.floor((bounds.north - height) / 0.25) * 0.25),
  );
  return { west, south, east: west + width, north: south + height };
}

async function weatherDetail(product, time, bbox, size = 1024) {
  const url = `/api/weather/image?product=${product}&time=${encodeURIComponent(time)}&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&size=${size}x${size / 2}`;
  return loadImage(url, { cors: false });
}

async function weatherWhole(product, time, width = 2048) {
  const size = width === 4096 ? '' : `&size=${width}x${width / 2}`;
  return loadImage(
    `/api/weather/image?product=${product}&time=${encodeURIComponent(time)}${size}`,
    { cors: false },
  );
}

/** A geographic (plate carrée) raster reprojected into the Mercator view. */
function drawGeoRaster(g, view, src, b, { step = 2 } = {}) {
  if (!src) return;
  const sw = src.width;
  const sh = src.height;
  const [lonL] = view.unproject(0, 0);
  const [lonR] = view.unproject(view.W, 0);
  let left = lonL;
  let right = lonR;
  if (right <= left) right += 360;
  const geoW = b.east - b.west;
  const clampL = Math.max(left, b.west);
  const clampR = Math.min(right, b.east);
  if (clampR <= clampL) return;
  const dx0 = ((clampL - left) / (right - left)) * view.W;
  const dx1 = ((clampR - left) / (right - left)) * view.W;
  const sx0 = ((clampL - b.west) / geoW) * sw;
  const sx1 = ((clampR - b.west) / geoW) * sw;
  for (let y = 0; y < view.H; y += step) {
    const [, lat] = view.unproject(view.W / 2, y + step / 2);
    if (lat > b.north || lat < b.south) continue;
    const sy = ((b.north - lat) / (b.north - b.south)) * sh;
    g.drawImage(
      src,
      sx0,
      Math.max(0, sy - 0.5),
      sx1 - sx0,
      1,
      dx0,
      y,
      dx1 - dx0,
      step + 0.3,
    );
  }
}

/** Pixels of an image (ImageBitmap/canvas) as RGBA. */
function pixelsOf(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { canvas: c, g, data: g.getImageData(0, 0, c.width, c.height) };
}

/* ───────────────────────── Colour helpers ───────────────────────── */

const IR_STOPS = [
  [0, [0, 0, 0, 0]],
  [120, [0, 0, 0, 0]],
  [150, [170, 180, 195, 110]],
  [172, [235, 240, 248, 200]],
  [186, [90, 215, 255, 225]],
  [198, [40, 110, 255, 235]],
  [208, [60, 220, 130, 240]],
  [218, [255, 228, 77, 245]],
  [228, [255, 140, 50, 250]],
  [236, [255, 45, 70, 255]],
  [244, [255, 110, 235, 255]],
  [252, [255, 255, 255, 255]],
];

/** Classic cold-cloud-top enhancement for an IR brightness value. */
function irColor(l) {
  for (let i = 1; i < IR_STOPS.length; i++) {
    const [b, cb] = IR_STOPS[i];
    if (l <= b) {
      const [a, ca] = IR_STOPS[i - 1];
      const t = (l - a) / Math.max(1, b - a);
      return ca.map((v, k) => v + (cb[k] - v) * t);
    }
  }
  return IR_STOPS.at(-1)[1];
}

function enhanceIr(img, { cool = false } = {}) {
  const { canvas, g, data } = pixelsOf(img);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a < 10) {
      px[i + 3] = 0;
      continue;
    }
    const c = cool
      ? [150, 175, 215, Math.max(0, Math.min(220, (px[i] - 140) * 2))]
      : irColor(px[i]);
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = (c[3] * a) / 255;
  }
  g.putImageData(data, 0, 0);
  return canvas;
}

const SPEED_RAMP = [
  [0, [40, 90, 200]],
  [15, [40, 190, 255]],
  [35, [120, 255, 220]],
  [55, [255, 255, 255]],
  [75, [255, 120, 230]],
  [100, [255, 60, 120]],
];
function speedRgb(mps) {
  for (let i = 1; i < SPEED_RAMP.length; i++) {
    const [b, cb] = SPEED_RAMP[i];
    if (mps <= b) {
      const [a, ca] = SPEED_RAMP[i - 1];
      const t = (mps - a) / (b - a);
      return ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
    }
  }
  return SPEED_RAMP.at(-1)[1];
}

const DBZ_RAMP = [
  [5, [70, 110, 255]],
  [18, [40, 200, 255]],
  [28, [60, 240, 130]],
  [38, [255, 232, 70]],
  [48, [255, 110, 50]],
  [56, [255, 40, 90]],
  [64, [255, 70, 230]],
  [72, [255, 255, 255]],
];
function dbzRgb(z) {
  if (z <= DBZ_RAMP[0][0]) return DBZ_RAMP[0][1];
  for (let i = 1; i < DBZ_RAMP.length; i++) {
    const [b, cb] = DBZ_RAMP[i];
    if (z <= b) {
      const [a, ca] = DBZ_RAMP[i - 1];
      const t = (z - a) / (b - a);
      return ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
    }
  }
  return DBZ_RAMP.at(-1)[1];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const glowCache = new Map();
/** A soft round sprite in a colour (for additive glows). */
function glowSprite(css, size = 64) {
  const key = `${css}:${size}`;
  let c = glowCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  r.addColorStop(0, css);
  r.addColorStop(
    0.25,
    css.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * 0.6})`),
  );
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  glowCache.set(key, c);
  return c;
}

/* ───────────────────────── Grade ───────────────────────── */

const BASE_FILTER = {
  orbit: 'saturate(0.85) contrast(1.18) brightness(0.78)',
  sky: 'saturate(0.55) contrast(1.15) brightness(0.68)',
  ground: 'saturate(0.9) contrast(1.12) brightness(0.86) sepia(0.12)',
  inside: 'saturate(0.9) contrast(1.1) brightness(0.9)',
};
const BAND_TINT = {
  orbit: '#6A4CFF',
  sky: '#3F8CFF',
  ground: '#FF9C42',
  inside: '#FFC857',
};

function tint(g, W, H, band, alpha = 0.32) {
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = alpha;
  g.fillStyle = BAND_TINT[band] || BAND_TINT.ground;
  g.fillRect(0, 0, W, H);
  g.restore();
}

function vignette(g, W, H, strength = 0.62) {
  g.save();
  const r = g.createRadialGradient(
    W / 2,
    H * 0.46,
    Math.min(W, H) * 0.32,
    W / 2,
    H / 2,
    Math.hypot(W, H) * 0.62,
  );
  r.addColorStop(0, 'rgba(0,0,0,0)');
  r.addColorStop(1, `rgba(2,4,8,${strength})`);
  g.fillStyle = r;
  g.fillRect(0, 0, W, H);
  // A whisper of top/bottom falloff for the shell's text.
  const lin = g.createLinearGradient(0, 0, 0, H);
  lin.addColorStop(0, 'rgba(2,4,8,0.28)');
  lin.addColorStop(0.18, 'rgba(2,4,8,0)');
  lin.addColorStop(0.72, 'rgba(2,4,8,0)');
  lin.addColorStop(1, 'rgba(2,4,8,0.42)');
  g.fillStyle = lin;
  g.fillRect(0, 0, W, H);
  g.restore();
}

async function base(g, view, band, { night = false, filter } = {}) {
  g.fillStyle = '#05070B';
  g.fillRect(0, 0, view.W, view.H);
  g.save();
  g.filter = filter || BASE_FILTER[band] || 'none';
  const drawn = night
    ? await drawTiles(g, view, BLACK_MARBLE_TILE, { maxZ: 8 })
    : await drawTiles(g, view, ESRI_TILE, { maxZ: 18 });
  g.restore();
  if (!drawn) throw new Error('base imagery unavailable');
}

/* ───────────────────────── Overlay primitives ───────────────────────── */

function pathLonLat(g, view, pts) {
  let prev = null;
  g.beginPath();
  for (const [lo, la] of pts) {
    const [x, y] = view.project(lo, la);
    if (!prev || Math.abs(x - prev[0]) > view.W * 1.5) g.moveTo(x, y);
    else g.lineTo(x, y);
    prev = [x, y];
  }
}

function glowStroke(g, css, width, blur) {
  g.save();
  g.shadowColor = css;
  g.shadowBlur = blur;
  g.strokeStyle = css;
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.stroke();
  g.restore();
}

function planeGlyph(g, x, y, headingDeg, size, css, { ring = false } = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(headingDeg * D2R);
  g.beginPath();
  const s = size / 24;
  g.moveTo(0, -12 * s);
  g.lineTo(2 * s, -5 * s);
  g.lineTo(11 * s, 1 * s);
  g.lineTo(11 * s, 3.5 * s);
  g.lineTo(2 * s, 1 * s);
  g.lineTo(1.6 * s, 7 * s);
  g.lineTo(4.5 * s, 10 * s);
  g.lineTo(4.5 * s, 11.5 * s);
  g.lineTo(0, 10.2 * s);
  g.lineTo(-4.5 * s, 11.5 * s);
  g.lineTo(-4.5 * s, 10 * s);
  g.lineTo(-1.6 * s, 7 * s);
  g.lineTo(-2 * s, 1 * s);
  g.lineTo(-11 * s, 3.5 * s);
  g.lineTo(-11 * s, 1 * s);
  g.lineTo(-2 * s, -5 * s);
  g.closePath();
  g.shadowColor = css;
  g.shadowBlur = size * 0.6;
  g.fillStyle = css;
  g.fill();
  g.restore();
  if (ring) {
    for (const [r, a] of [
      [size * 1.3, 0.9],
      [size * 2.2, 0.5],
      [size * 3.3, 0.25],
    ]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.strokeStyle = css.replace(/[\d.]+\)$/, `${a})`);
      g.lineWidth = size * 0.09;
      g.stroke();
    }
  }
}

function heliGlyph(g, x, y, size, css) {
  g.save();
  g.translate(x, y);
  g.shadowColor = css;
  g.shadowBlur = size * 0.6;
  g.strokeStyle = css;
  g.fillStyle = css;
  g.lineWidth = size * 0.1;
  g.beginPath();
  g.arc(0, 0, size * 0.22, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(-size * 0.55, -size * 0.55);
  g.lineTo(size * 0.55, size * 0.55);
  g.moveTo(size * 0.55, -size * 0.55);
  g.lineTo(-size * 0.55, size * 0.55);
  g.stroke();
  g.restore();
}

/** Destination point (deg) from lon/lat along a bearing for km. */
function dest(lon, lat, bearingDeg, km) {
  const d = km / 6371;
  const b = bearingDeg * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return [((l2 / D2R + 540) % 360) - 180, p2 / D2R];
}

function circleLonLat(lon, lat, km, step = 4) {
  const pts = [];
  for (let a = 0; a <= 360; a += step) pts.push(dest(lon, lat, a, km));
  return pts;
}

/* ───────────────────────── Scenes ───────────────────────── */

const SCENE_DRAW = {
  async cyclone(g, view, sc, dpr) {
    await base(g, view, 'orbit', {
      filter: 'saturate(0.6) contrast(1.2) brightness(0.5)',
    });
    tint(g, view.W, view.H, 'orbit', 0.28);
    // IR: a detail window when it fits, else the global mosaic.
    if (sc.irTime && sc.irBounds) {
      const bb = detailBbox(view, sc.irBounds, 4);
      const img = bb
        ? await weatherDetail('clouds', sc.irTime, bb, 1024)
        : await weatherWhole('clouds', sc.irTime, 2048);
      if (img) drawGeoRaster(g, view, enhanceIr(img), bb || sc.irBounds);
    }
    const s = sc.storm;
    const lw = 1.6 * dpr;
    // Cone of uncertainty.
    const cone =
      s.cone?.type === 'Polygon'
        ? s.cone.coordinates[0]
        : s.cone?.type === 'MultiPolygon'
          ? s.cone.coordinates[0][0]
          : null;
    if (cone) {
      pathLonLat(g, view, cone);
      g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.fill();
      g.setLineDash([6 * dpr, 5 * dpr]);
      glowStroke(g, 'rgba(255,255,255,0.85)', lw, 6 * dpr);
      g.setLineDash([]);
    }
    // Wind radii (34/50/64 kt quadrants).
    for (const r of [...(s.radii || [])].sort((a, b) => a.kt - b.kt)) {
      if (!r.quadrantsKm.some((k) => k > 0)) continue;
      pathLonLat(g, view, radiiRing(s.lon, s.lat, r.quadrantsKm, 4));
      g.closePath();
      const col = RADII_COLORS[r.kt] || '#FFD84D';
      g.globalAlpha = r.kt === 64 ? 0.42 : r.kt === 50 ? 0.32 : 0.22;
      g.fillStyle = col;
      g.fill();
      g.globalAlpha = 0.9;
      g.strokeStyle = col;
      g.lineWidth = 1.2 * dpr;
      g.stroke();
      g.globalAlpha = 1;
    }
    // Past track (EONET) and forecast track with intensity dots.
    if (s.pastTrack?.length > 1) {
      pathLonLat(
        g,
        view,
        s.pastTrack.map((p) => [p.lon, p.lat]),
      );
      glowStroke(g, 'rgba(255,255,255,0.8)', lw, 4 * dpr);
    }
    const fc = [{ lon: s.lon, lat: s.lat, windKt: s.windKt }, ...s.forecast];
    if (fc.length > 1) {
      pathLonLat(
        g,
        view,
        fc.map((p) => [p.lon, p.lat]),
      );
      glowStroke(g, 'rgba(255,255,255,0.95)', lw * 1.2, 8 * dpr);
      for (const p of fc.slice(1)) {
        const [x, y] = view.project(p.lon, p.lat);
        const kt = p.windKt || 0;
        const col =
          kt >= 96
            ? '#FF4FD8'
            : kt >= 64
              ? '#FF4D4D'
              : kt >= 34
                ? '#FFD84D'
                : '#7CC4FF';
        g.beginPath();
        g.arc(x, y, (3 + Math.min(5, kt / 25)) * dpr, 0, Math.PI * 2);
        g.fillStyle = col;
        g.shadowColor = col;
        g.shadowBlur = 8 * dpr;
        g.fill();
        g.shadowBlur = 0;
        g.lineWidth = 1 * dpr;
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.stroke();
      }
    }
    // The storm symbol.
    const [cx, cy] = view.project(s.lon, s.lat);
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = 10 * dpr;
    g.lineWidth = 2.6 * dpr;
    const R = 11 * dpr;
    g.beginPath();
    g.arc(0, 0, R * 0.45, 0, Math.PI * 2);
    g.stroke();
    for (const sgn of [1, -1]) {
      g.beginPath();
      g.arc(
        sgn * R * 0.45,
        0,
        R,
        sgn > 0 ? Math.PI : 0,
        sgn > 0 ? Math.PI * 1.55 : Math.PI * 0.55,
      );
      g.stroke();
    }
    g.restore();
    vignette(g, view.W, view.H, 0.55);
  },

  async lightning(g, view, sc, dpr) {
    await base(g, view, 'sky', {
      filter: 'saturate(0.45) contrast(1.15) brightness(0.45)',
    });
    tint(g, view.W, view.H, 'sky', 0.4);
    if (sc.irTime && sc.irBounds) {
      const bb = detailBbox(view, sc.irBounds, 2);
      const img = bb
        ? await weatherDetail('clouds', sc.irTime, bb, 1024)
        : null;
      if (img) {
        g.globalAlpha = 0.32;
        drawGeoRaster(g, view, enhanceIr(img, { cool: true }), bb);
        g.globalAlpha = 1;
      }
    }
    if (sc.radar) {
      const bb = detailBbox(view, sc.radar.bounds, 1);
      const img = bb
        ? await weatherDetail('radar', sc.radar.time, bb, 1024)
        : null;
      if (img) {
        g.globalAlpha = 0.75;
        drawGeoRaster(g, view, img, bb);
        g.globalAlpha = 1;
      }
    }
    // Strikes by age: oldest violet and faint → newest white-hot.
    const bb = detailBbox(view, sc.bounds, 1);
    const times = sc.times.slice(-6);
    const frames = await Promise.all(
      times.map((t) =>
        bb
          ? weatherDetail('lightning', t, bb, 1024)
          : weatherWhole('lightning', t, 2048),
      ),
    );
    const box = bb || sc.bounds;
    const colors = [
      'rgba(255,255,255,1)',
      'rgba(255,226,122,0.75)',
      'rgba(255,150,70,0.6)',
      'rgba(255,85,150,0.5)',
      'rgba(176,107,255,0.42)',
      'rgba(106,107,255,0.34)',
    ];
    // Sample at the product's native ~8 km grid, one dot per cell.
    const kmPerPx =
      ((box.east - box.west) * 111.32 * Math.cos(view.lat * D2R)) / 1024;
    const step = Math.max(1, Math.round(8 / kmPerPx));
    const spacing = 8 * view.pxPerKm;
    const dotR = Math.max(1.4 * dpr, Math.min(4.5 * dpr, spacing * 0.42));
    g.save();
    frames.forEach((img, i) => {
      if (!img) return;
      const age = frames.length - 1 - i; // 0 = newest
      g.globalCompositeOperation = age === 0 ? 'lighter' : 'source-over';
      const { data } = pixelsOf(img);
      const px = data.data;
      const w = img.width;
      const h = img.height;
      const sprite = glowSprite(colors[Math.min(colors.length - 1, age)], 48);
      const jitter = mulberry32(hashStr(times[i]));
      for (let y = 0; y < h; y += step)
        for (let x = 0; x < w; x += step) {
          const k = (y * w + x) * 4;
          if (px[k + 3] < 40) continue;
          const lon =
            box.west + ((x + jitter() * step) / w) * (box.east - box.west);
          const lat =
            box.north - ((y + jitter() * step) / h) * (box.north - box.south);
          const [sx, sy] = view.project(lon, lat);
          if (sx < -20 || sy < -20 || sx > view.W + 20 || sy > view.H + 20)
            continue;
          const lvl = strikeLevel(px[k], px[k + 1], px[k + 2]);
          const r =
            dotR * (age === 0 ? 0.85 : 1.6 - age * 0.1) * (0.75 + lvl * 0.2);
          g.drawImage(sprite, sx - r, sy - r, r * 2, r * 2);
        }
    });
    g.restore();
    vignette(g, view.W, view.H, 0.6);
  },

  async radar(g, view, sc, dpr) {
    await base(g, view, 'sky');
    tint(g, view.W, view.H, 'sky', 0.38);
    const bb = detailBbox(view, sc.bounds, 1);
    const img = bb
      ? await weatherDetail('radar', sc.time, bb, 1024)
      : await weatherWhole('radar', sc.time, 4096);
    if (img) {
      // A soft bloom under crisp echoes; heavier echoes glow hotter.
      const { canvas, g: rg, data } = pixelsOf(img);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const z = dbzOf(px[i], px[i + 1], px[i + 2], px[i + 3]);
        if (z == null) {
          px[i + 3] = 0;
          continue;
        }
        const [r, gg, b] = dbzRgb(z);
        px[i] = r;
        px[i + 1] = gg;
        px[i + 2] = b;
        px[i + 3] = Math.min(255, 110 + z * 2.8);
      }
      rg.putImageData(data, 0, 0);
      g.save();
      g.filter = `blur(${4 * dpr}px)`;
      g.globalAlpha = 0.55;
      drawGeoRaster(g, view, canvas, bb || sc.bounds);
      g.restore();
      g.globalAlpha = 0.92;
      drawGeoRaster(g, view, canvas, bb || sc.bounds, { step: 1 });
      g.globalAlpha = 1;
    }
    // City reticle: a hairline 45 km radius ring (the analysis radius).
    pathLonLat(g, view, circleLonLat(sc.lon, sc.lat, 45));
    g.setLineDash([3 * dpr, 4 * dpr]);
    g.strokeStyle = 'rgba(200,230,255,0.55)';
    g.lineWidth = 1 * dpr;
    g.stroke();
    g.setLineDash([]);
    vignette(g, view.W, view.H);
  },

  async jet(g, view, sc, dpr, feeds) {
    await base(g, view, 'orbit', {
      night: true,
      filter: 'brightness(1.1) contrast(1.15) saturate(0.8)',
    });
    tint(g, view.W, view.H, 'sky', 0.3);
    const field = feeds.jet.data?.field;
    if (!field) throw new Error('jet grid unavailable');
    const rnd = mulberry32(7);
    const spacing = 11 * dpr;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (let y0 = spacing / 2; y0 < view.H; y0 += spacing)
      for (let x0 = spacing / 2; x0 < view.W; x0 += spacing) {
        let x = x0 + (rnd() - 0.5) * spacing;
        let y = y0 + (rnd() - 0.5) * spacing;
        let [lon, lat] = view.unproject(x, y);
        if (Math.abs(lat) > 68) continue; // beyond the grid: no data
        let { u, v } = sampleField(field, lon, lat);
        let sp = Math.hypot(u, v);
        if (sp < 12) continue;
        const [r, gg, b] = speedRgb(sp);
        const steps = 10 + Math.round(sp / 6);
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < steps; k++) {
          // Pixel step along the wind, normalised so long streaks = fast.
          const dpx = (sp / 40) * 2.2 * dpr;
          const norm = Math.hypot(u, v) || 1;
          x += (u / norm) * dpx;
          y -= (v / norm) * dpx;
          g.lineTo(x, y);
          [lon, lat] = view.unproject(x, y);
          ({ u, v } = sampleField(field, lon, lat));
          sp = Math.hypot(u, v);
        }
        const a = Math.min(0.85, 0.15 + sp / 90);
        g.strokeStyle = `rgba(${r},${gg},${b},${a})`;
        g.lineWidth = (0.6 + Math.min(1.6, sp / 40)) * dpr;
        g.stroke();
      }
    g.restore();
    vignette(g, view.W, view.H, 0.5);
  },

  async quake(g, view, sc, dpr) {
    await base(g, view, 'ground');
    tint(g, view.W, view.H, 'ground', 0.3);
    const q = sc.quake;
    const [cx, cy] = view.project(q.lon, q.lat);
    // Shaking falls off with distance: rings at 10–200 km, hotter inside.
    const rings = [
      [200, 'rgba(255,214,90,0.30)'],
      [120, 'rgba(255,170,60,0.38)'],
      [70, 'rgba(255,120,50,0.48)'],
      [35, 'rgba(255,70,50,0.6)'],
      [15, 'rgba(255,40,60,0.75)'],
    ];
    const grad = g.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      view.pxPerKm * 60 * Math.max(1, q.mag - 3),
    );
    grad.addColorStop(0, 'rgba(255,60,50,0.45)');
    grad.addColorStop(1, 'rgba(255,60,50,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, view.W, view.H);
    for (const [km, css] of rings) {
      pathLonLat(g, view, circleLonLat(q.lon, q.lat, km));
      glowStroke(g, css, 1.6 * dpr, 6 * dpr);
    }
    for (const n of sc.nearby || []) {
      const [x, y] = view.project(n.lon, n.lat);
      g.beginPath();
      g.arc(x, y, (1.5 + Math.max(0, n.mag - 2.5) * 1.6) * dpr, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,220,150,0.85)';
      g.lineWidth = 1.2 * dpr;
      g.stroke();
    }
    g.drawImage(
      glowSprite('rgba(255,250,240,1)', 64),
      cx - 14 * dpr,
      cy - 14 * dpr,
      28 * dpr,
      28 * dpr,
    );
    g.beginPath();
    g.moveTo(cx - 18 * dpr, cy);
    g.lineTo(cx + 18 * dpr, cy);
    g.moveTo(cx, cy - 18 * dpr);
    g.lineTo(cx, cy + 18 * dpr);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1 * dpr;
    g.stroke();
    vignette(g, view.W, view.H);
  },

  async 'quake-world'(g, view, sc, dpr) {
    await base(g, view, 'ground', {
      filter: 'saturate(0.35) contrast(1.25) brightness(0.42)',
    });
    tint(g, view.W, view.H, 'ground', 0.4);
    const now = Date.now();
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const q of sc.quakes.slice().sort((a, b) => a.mag - b.mag)) {
      const [x, y] = view.project(q.lon, q.lat);
      if (x < -30 || y < -30 || x > view.W + 30 || y > view.H + 30) continue;
      const fresh = Math.max(0.25, 1 - (now - q.time) / 86_400_000);
      const r = (6 + Math.max(0, q.mag - 2.5) * 9) * dpr;
      const col =
        q.mag >= 5
          ? `rgba(255,70,60,${fresh})`
          : q.mag >= 4
            ? `rgba(255,150,60,${fresh})`
            : `rgba(255,215,120,${fresh})`;
      g.drawImage(glowSprite(col, 64), x - r, y - r, r * 2, r * 2);
      if (q.mag >= 4.5) {
        g.beginPath();
        g.arc(x, y, r * 0.9, 0, Math.PI * 2);
        g.strokeStyle = col;
        g.lineWidth = 1.2 * dpr;
        g.stroke();
      }
    }
    g.restore();
    vignette(g, view.W, view.H, 0.5);
  },

  async fire(g, view, sc, dpr) {
    await base(g, view, 'ground');
    tint(g, view.W, view.H, 'ground', 0.36);
    const rnd = mulberry32(hashStr(`${sc.lon},${sc.lat}`));
    const f0 = sc.fires[0] || { lon: sc.lon, lat: sc.lat };
    if (sc.wind) {
      // Smoke plume: downwind of the fire for ~2 h of travel at the
      // reported wind, widening with distance (direction is real; the
      // plume's texture is drawn).
      const lenKm = Math.min(
        view.W / view.pxPerKm,
        Math.max(12, sc.wind.speedKmh * 2),
      );
      g.save();
      for (let i = 0; i < 70; i++) {
        const t = i / 70;
        const wobble = Math.sin(t * 7 + rnd() * 2) * 6 * t;
        const [lon, lat] = dest(
          f0.lon,
          f0.lat,
          sc.wind.toDeg + wobble,
          lenKm * t,
        );
        const [x, y] = view.project(lon, lat);
        const r = (6 + t * lenKm * 0.35 * view.pxPerKm) * (0.7 + rnd() * 0.6);
        const a = 0.11 * (1 - t) + 0.025;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(215,205,190,${a})`);
        grad.addColorStop(1, 'rgba(215,205,190,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.restore();
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const f of sc.fires) {
      const [x, y] = view.project(f.lon, f.lat);
      const big = (f.frp ?? 0) > 50 || (f.acres ?? 0) > 5000;
      const r = (big ? 26 : 16) * dpr;
      g.drawImage(
        glowSprite('rgba(255,110,30,1)', 64),
        x - r,
        y - r,
        r * 2,
        r * 2,
      );
      g.drawImage(
        glowSprite('rgba(255,230,160,1)', 64),
        x - r / 3,
        y - r / 3,
        (r * 2) / 3,
        (r * 2) / 3,
      );
    }
    g.restore();
    vignette(g, view.W, view.H);
  },

  async aircraft(g, view, sc, dpr) {
    await base(g, view, 'sky');
    tint(g, view.W, view.H, 'sky', 0.4);
    if (sc.airport) {
      const [x, y] = view.project(sc.airport.lon, sc.airport.lat);
      for (const km of [10, 25, 50]) {
        g.beginPath();
        g.arc(x, y, km * view.pxPerKm, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(160,210,255,0.35)';
        g.setLineDash([2 * dpr, 5 * dpr]);
        g.lineWidth = 1 * dpr;
        g.stroke();
      }
      g.setLineDash([]);
    }
    const list = sc.aircraft || [];
    const glyph =
      Math.max(9, Math.min(16, 4200 / Math.max(60, view.W / view.pxPerKm))) *
      dpr;
    for (const a of list) {
      if (!a.speed || a.onGround) continue;
      const [x, y] = view.project(a.lon, a.lat);
      // Velocity leader: where the aircraft will be in 2 minutes.
      const [lo, la] = dest(
        a.lon,
        a.lat,
        a.heading || 0,
        (a.speed * 120) / 1000,
      );
      const [x2, y2] = view.project(lo, la);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.strokeStyle = a.emergency
        ? 'rgba(255,80,90,0.9)'
        : 'rgba(140,210,255,0.55)';
      g.lineWidth = 1.1 * dpr;
      g.stroke();
    }
    for (const a of list) {
      const [x, y] = view.project(a.lon, a.lat);
      if (x < -20 || y < -20 || x > view.W + 20 || y > view.H + 20) continue;
      const css = a.military
        ? 'rgba(255,209,102,1)'
        : a.helicopter
          ? 'rgba(155,225,93,1)'
          : a.onGround
            ? 'rgba(160,190,220,0.6)'
            : 'rgba(190,230,255,1)';
      if (a.helicopter) heliGlyph(g, x, y, glyph * 1.1, css);
      else planeGlyph(g, x, y, a.heading || 0, glyph, css);
    }
    if (sc.focus) {
      const [x, y] = view.project(sc.focus.lon, sc.focus.lat);
      const [lo, la] = dest(
        sc.focus.lon,
        sc.focus.lat,
        sc.focus.heading || 0,
        ((sc.focus.speed || 0) * 600) / 1000,
      );
      const [x2, y2] = view.project(lo, la);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.setLineDash([5 * dpr, 4 * dpr]);
      glowStroke(g, 'rgba(255,70,80,0.95)', 2 * dpr, 8 * dpr);
      g.setLineDash([]);
      planeGlyph(
        g,
        x,
        y,
        sc.focus.heading || 0,
        26 * dpr,
        'rgba(255,72,82,1)',
        { ring: true },
      );
    }
    vignette(g, view.W, view.H);
  },

  async orbit(g, view, sc, dpr) {
    await base(g, view, 'orbit', {
      night: true,
      filter: 'brightness(1.15) contrast(1.2) saturate(0.9)',
    });
    tint(g, view.W, view.H, 'orbit', 0.34);
    const at = sc.at || Date.now();
    const sats = sc.sats.map((s) => ({
      ...s,
      rec: twoline2satrec(s.line1, s.line2),
    }));
    const main = sats.find((s) => s.main) || sats[0];
    // Ground track of the main satellite: −50 → +50 min.
    const track = [];
    for (let m = -50; m <= 50; m += 1) {
      const p = satPosition(main.rec, at + m * 60_000);
      if (p) track.push([p.lon, p.lat, m]);
    }
    const past = track.filter((p) => p[2] <= 0);
    const future = track.filter((p) => p[2] >= 0);
    pathLonLat(g, view, past);
    glowStroke(g, 'rgba(201,167,255,0.85)', 2 * dpr, 10 * dpr);
    pathLonLat(g, view, future);
    g.setLineDash([6 * dpr, 6 * dpr]);
    glowStroke(g, 'rgba(201,167,255,0.6)', 1.6 * dpr, 6 * dpr);
    g.setLineDash([]);
    if (sc.train) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const s of sats) {
        const p = satPosition(s.rec, at);
        if (!p) continue;
        const [x, y] = view.project(p.lon, p.lat);
        const r = 7 * dpr;
        g.drawImage(
          glowSprite('rgba(235,225,255,1)', 48),
          x - r,
          y - r,
          r * 2,
          r * 2,
        );
      }
      g.restore();
    }
    const p = satPosition(main.rec, at);
    if (p) {
      const [x, y] = view.project(p.lon, p.lat);
      // Visibility footprint (horizon circle).
      const footKm = Math.acos(6371 / (6371 + p.altM / 1000)) * 6371;
      pathLonLat(g, view, circleLonLat(p.lon, p.lat, footKm, 3));
      g.fillStyle = 'rgba(160,120,255,0.08)';
      g.fill();
      g.setLineDash([3 * dpr, 5 * dpr]);
      g.strokeStyle = 'rgba(201,167,255,0.6)';
      g.lineWidth = 1 * dpr;
      g.stroke();
      g.setLineDash([]);
      if (!sc.train) {
        g.drawImage(
          glowSprite('rgba(255,255,255,1)', 64),
          x - 18 * dpr,
          y - 18 * dpr,
          36 * dpr,
          36 * dpr,
        );
        g.save();
        g.translate(x, y);
        g.fillStyle = '#fff';
        g.fillRect(-11 * dpr, -2.2 * dpr, 22 * dpr, 4.4 * dpr);
        g.fillRect(-1.6 * dpr, -6 * dpr, 3.2 * dpr, 12 * dpr);
        g.restore();
      }
    }
    if (sc.observer) {
      const [x, y] = view.project(sc.observer.lon, sc.observer.lat);
      g.beginPath();
      g.arc(x, y, 4 * dpr, 0, Math.PI * 2);
      g.fillStyle = '#FFC857';
      g.fill();
    }
    vignette(g, view.W, view.H, 0.45);
  },

  async constellation(g, view, sc, dpr) {
    await base(g, view, 'orbit', {
      night: true,
      filter: 'brightness(1.1) contrast(1.2) saturate(0.85)',
    });
    tint(g, view.W, view.H, 'orbit', 0.34);
    const at = sc.at || Date.now();
    g.save();
    g.globalCompositeOperation = 'lighter';
    const dot = glowSprite('rgba(220,205,255,0.95)', 32);
    const head = glowSprite('rgba(255,255,255,1)', 32);
    for (const s of sc.sats) {
      let rec;
      try {
        rec = twoline2satrec(s.line1, s.line2);
      } catch {
        continue;
      }
      const p = satPosition(rec, at);
      if (!p) continue;
      const [x, y] = view.project(p.lon, p.lat);
      if (x < -10 || y < -10 || x > view.W + 10 || y > view.H + 10) continue;
      // A 90-second streak behind each satellite shows the shells' motion.
      const q = satPosition(rec, at - 90_000);
      if (q) {
        const [x0, y0] = view.project(q.lon, q.lat);
        if (Math.abs(x0 - x) < view.W / 3) {
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x, y);
          g.strokeStyle = 'rgba(170,140,255,0.35)';
          g.lineWidth = 0.8 * dpr;
          g.stroke();
        }
      }
      const r = 2.6 * dpr;
      g.drawImage(
        hashStr(s.line1) % 50 === 0 ? head : dot,
        x - r,
        y - r,
        r * 2,
        r * 2,
      );
    }
    g.restore();
    vignette(g, view.W, view.H, 0.45);
  },

  async launch(g, view, sc, dpr) {
    await base(g, view, 'orbit', {
      filter: 'saturate(0.7) contrast(1.15) brightness(0.62)',
    });
    tint(g, view.W, view.H, 'orbit', 0.42);
    const pad = sc.pad;
    const orbit = String(sc.orbit || '').toUpperCase();
    // Indicative ascent azimuth from the pad and target orbit.
    let az = 90;
    if (/SSO|POLAR|PO\b/.test(orbit))
      az = pad.lat > 0 ? (pad.lon < -100 ? 190 : 160) : 200;
    else if (/ISS|LEO/.test(orbit) && pad.lon > -82 && pad.lon < -79) az = 44;
    else if (/GTO|GEO|MEO|HEO/.test(orbit)) az = 95;
    const pts = [];
    for (let km = 0; km <= 600; km += 10) {
      const bend = Math.min(1, km / 600) ** 2 * 6;
      pts.push(dest(pad.lon, pad.lat, az + bend, km));
    }
    pathLonLat(g, view, pts);
    glowStroke(g, 'rgba(255,240,255,0.95)', 2.4 * dpr, 14 * dpr);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const km of [100, 200, 300, 400]) {
      const [x, y] = view.project(
        ...dest(pad.lon, pad.lat, az + (km / 600) ** 2 * 6, km),
      );
      g.drawImage(
        glowSprite('rgba(201,167,255,1)', 48),
        x - 8 * dpr,
        y - 8 * dpr,
        16 * dpr,
        16 * dpr,
      );
    }
    const [px, py] = view.project(pad.lon, pad.lat);
    g.drawImage(
      glowSprite('rgba(255,200,120,1)', 64),
      px - 22 * dpr,
      py - 22 * dpr,
      44 * dpr,
      44 * dpr,
    );
    g.restore();
    vignette(g, view.W, view.H);
  },

  async gnss(g, view, sc, dpr) {
    await base(g, view, 'sky', {
      filter: 'saturate(0.3) contrast(1.2) brightness(0.42)',
    });
    tint(g, view.W, view.H, 'sky', 0.35);
    // Hex heat: percentage of aircraft with degraded integrity per hex.
    const R = 26 * dpr;
    const hexW = Math.sqrt(3) * R;
    const bins = new Map();
    for (const r of sc.rows) {
      const [x, y] = view.project(r.lon, r.lat);
      const row = Math.round(y / (1.5 * R));
      const col = Math.round((x - (row % 2) * (hexW / 2)) / hexW);
      const key = `${row}:${col}`;
      let b = bins.get(key);
      if (!b) bins.set(key, (b = { row, col, n: 0, bad: 0 }));
      b.n++;
      if (r.degraded || r.gpsLost) b.bad++;
    }
    for (const b of bins.values()) {
      if (b.n < 2) continue;
      const frac = Math.max(0, b.bad - 1) / b.n;
      const x = b.col * hexW + (b.row % 2) * (hexW / 2);
      const y = b.row * 1.5 * R;
      const col =
        frac >= 0.1
          ? [255, 59, 107]
          : frac >= 0.02
            ? [255, 177, 61]
            : [74, 222, 128];
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        g.lineTo(x + R * 0.94 * Math.cos(a), y + R * 0.94 * Math.sin(a));
      }
      g.closePath();
      g.fillStyle = `rgba(${col},${0.18 + Math.min(0.5, frac * 1.2)})`;
      g.fill();
      g.strokeStyle = `rgba(${col},0.6)`;
      g.lineWidth = 1 * dpr;
      g.stroke();
    }
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const r of sc.rows) {
      const [x, y] = view.project(r.lon, r.lat);
      const bad = r.degraded || r.gpsLost;
      const rr = (bad ? 6 : 3.5) * dpr;
      g.drawImage(
        glowSprite(bad ? 'rgba(255,70,130,1)' : 'rgba(140,220,255,0.9)', 32),
        x - rr,
        y - rr,
        rr * 2,
        rr * 2,
      );
    }
    g.restore();
    vignette(g, view.W, view.H);
  },

  async transit(g, view, sc, dpr) {
    await base(g, view, 'ground', {
      filter: 'saturate(0.7) contrast(1.15) brightness(0.62) sepia(0.1)',
    });
    tint(g, view.W, view.H, 'ground', 0.34);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const v of sc.vehicles) {
      const [x, y] = view.project(v.lon, v.lat);
      if (x < -10 || y < -10 || x > view.W + 10 || y > view.H + 10) continue;
      const h = hashStr(v.routeId) % 360;
      const moving = (v.speedMps ?? 0) > 1;
      const r = (moving ? 7 : 5) * dpr;
      g.drawImage(
        glowSprite(`hsla(${h},90%,65%,1)`, 32),
        x - r,
        y - r,
        r * 2,
        r * 2,
      );
      if (moving && v.bearing != null) {
        const [x2, y2] = view.project(
          ...dest(v.lon, v.lat, v.bearing, (v.speedMps * 60) / 1000),
        );
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x2, y2);
        g.strokeStyle = `hsla(${h},90%,70%,0.8)`;
        g.lineWidth = 1.4 * dpr;
        g.stroke();
      }
    }
    g.restore();
    vignette(g, view.W, view.H);
  },

  async aq(g, view, sc, dpr) {
    // Yesterday's VIIRS true colour (dust and smoke are visible in it) with
    // MODIS aerosol optical depth over it: observed aerosol, not the model.
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    g.fillStyle = '#05070B';
    g.fillRect(0, 0, view.W, view.H);
    g.save();
    g.filter = 'contrast(1.12) saturate(1.05) brightness(0.92)';
    const drawn = await drawTiles(
      g,
      view,
      GIBS_TILE('VIIRS_NOAA20_CorrectedReflectance_TrueColor', day, 'jpg', 9),
      { maxZ: 9 },
    );
    g.restore();
    if (!drawn) await base(g, view, 'ground');
    tint(g, view.W, view.H, 'ground', 0.22);
    const aod = document.createElement('canvas');
    aod.width = view.W;
    aod.height = view.H;
    const ag = aod.getContext('2d');
    if (
      await drawTiles(
        ag,
        view,
        GIBS_TILE('MODIS_Terra_Aerosol_Optical_Depth_3km', day, 'png', 6),
        { maxZ: 6 },
      )
    ) {
      g.save();
      g.globalAlpha = 0.5;
      g.filter = `blur(${2 * dpr}px)`;
      g.drawImage(aod, 0, 0);
      g.restore();
    }
    const [x, y] = view.project(sc.lon, sc.lat);
    const css = aqiColor(sc.aqi);
    for (const [r, a] of [
      [10, 1],
      [22, 0.55],
      [38, 0.25],
    ]) {
      g.beginPath();
      g.arc(x, y, r * dpr, 0, Math.PI * 2);
      g.globalAlpha = a;
      g.strokeStyle = css;
      g.lineWidth = 1.6 * dpr;
      g.stroke();
    }
    g.globalAlpha = 1;
    g.drawImage(
      glowSprite('rgba(255,255,255,1)', 32),
      x - 5 * dpr,
      y - 5 * dpr,
      10 * dpr,
      10 * dpr,
    );
    vignette(g, view.W, view.H);
  },

  async volcano(g, view, sc, dpr) {
    await base(g, view, 'ground');
    tint(g, view.W, view.H, 'ground', 0.36);
    const [x, y] = view.project(sc.lon, sc.lat);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.drawImage(
      glowSprite('rgba(255,80,30,0.9)', 64),
      x - 40 * dpr,
      y - 40 * dpr,
      80 * dpr,
      80 * dpr,
    );
    g.drawImage(
      glowSprite('rgba(255,220,150,1)', 64),
      x - 10 * dpr,
      y - 10 * dpr,
      20 * dpr,
      20 * dpr,
    );
    g.restore();
    vignette(g, view.W, view.H);
  },

  async flood(g, view, sc, dpr) {
    await base(g, view, 'ground');
    tint(g, view.W, view.H, 'ground', 0.3);
    if (sc.path?.length > 1) {
      pathLonLat(g, view, sc.path);
      glowStroke(g, 'rgba(94,200,255,0.9)', 3 * dpr, 12 * dpr);
    }
    if (sc.corridor?.length > 1) {
      pathLonLat(
        g,
        view,
        sc.corridor.map((c) => [c[0], c[1]]),
      );
      glowStroke(g, 'rgba(190,240,255,1)', 4 * dpr, 16 * dpr);
    }
    for (const a of sc.anchors || []) {
      const [x, y] = view.project(a.lon, a.lat);
      g.drawImage(
        glowSprite('rgba(255,200,87,1)', 32),
        x - 8 * dpr,
        y - 8 * dpr,
        16 * dpr,
        16 * dpr,
      );
    }
    vignette(g, view.W, view.H);
  },

  async vessels(g, view, sc, dpr) {
    await base(g, view, 'ground', {
      filter: 'saturate(0.6) contrast(1.15) brightness(0.6)',
    });
    tint(g, view.W, view.H, 'ground', 0.25);
    for (const v of sc.vessels) {
      const [x, y] = view.project(v.lon, v.lat);
      planeGlyph(g, x, y, v.heading || 0, 8 * dpr, 'rgba(56,225,198,1)');
    }
    vignette(g, view.W, view.H);
  },

  async eye(g, view, sc, dpr, feeds) {
    let blob = EYE_FRAMES.get(sc.cameraId);
    if (!blob || Date.now() - blob.at > 60_000) {
      const cam = feeds.cctv.data?.records.find((c) => c.id === sc.cameraId);
      if (!cam) throw new Error('camera not in catalog');
      const r = await fetch(cctvFrameUrl(cam), { cache: 'no-store' });
      if (!r.ok || r.headers.get('x-cctv-source') !== 'upstream-image')
        throw new Error('no live frame');
      blob = { blob: await r.blob(), at: Date.now() };
      EYE_FRAMES.set(sc.cameraId, blob);
    }
    const img = await createImageBitmap(blob.blob);
    const { W, H } = view;
    const s = Math.max(W / img.width, H / img.height);
    const w = img.width * s;
    const h = img.height * s;
    g.fillStyle = '#05070B';
    g.fillRect(0, 0, W, H);
    g.save();
    g.filter = 'contrast(1.12) saturate(1.05) brightness(0.95)';
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    g.restore();
    img.close?.();
    tint(g, W, H, 'ground', 0.18);
    vignette(g, W, H, 0.5);
  },

  /** Detected circling: each aircraft's real recorded orbit track. */
  async circling(g, view, sc, dpr) {
    await base(g, view, 'sky');
    tint(g, view.W, view.H, 'sky', 0.38);
    const colors = [
      'rgba(94,200,255,1)',
      'rgba(255,209,102,1)',
      'rgba(255,159,107,1)',
      'rgba(155,225,93,1)',
      'rgba(201,167,255,1)',
    ];
    const [cx, cy] = view.project(sc.lon, sc.lat);
    for (const km of [0.5, 1, 1.5]) {
      g.beginPath();
      g.arc(cx, cy, km * view.pxPerKm, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(160,210,255,0.28)';
      g.setLineDash([2 * dpr, 5 * dpr]);
      g.lineWidth = 1 * dpr;
      g.stroke();
    }
    g.setLineDash([]);
    (sc.tracks || []).forEach((tr, i) => {
      const css = colors[i % colors.length];
      if (tr.points?.length > 1) {
        pathLonLat(g, view, tr.points);
        glowStroke(g, css.replace(',1)', ',0.85)'), 2.2 * dpr, 10 * dpr);
      }
      const last = tr.points?.at(-1);
      if (last) {
        const [x, y] = view.project(last[0], last[1]);
        if (tr.helicopter) heliGlyph(g, x, y, 15 * dpr, css);
        else planeGlyph(g, x, y, tr.heading || 0, 13 * dpr, css);
      }
    });
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.drawImage(
      glowSprite('rgba(255,209,102,0.9)', 64),
      cx - 14 * dpr,
      cy - 14 * dpr,
      28 * dpr,
      28 * dpr,
    );
    g.restore();
    vignette(g, view.W, view.H);
  },

  async plain(g, view, sc) {
    await base(g, view, sc.band || 'ground');
    tint(g, view.W, view.H, sc.band || 'ground');
    vignette(g, view.W, view.H);
  },
};

/* ───────────────────────── Compositor ───────────────────────── */

function semaphore(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

export function createCompositor({ feeds }) {
  const mem = new Map();
  const urls = new Set();
  const run = semaphore(3);
  const cacheApi = typeof caches !== 'undefined' && globalThis.isSecureContext;

  function keyFor(situation, W, H, dpr) {
    const bucket =
      situation.archetype === 'eye'
        ? Math.floor(Date.now() / 30_000)
        : Math.floor((situation.updatedAt || 0) / 300_000);
    return `${VERSION}/${encodeURIComponent(situation.id)}/${W}x${H}@${dpr}/${bucket}`;
  }

  async function render(situation, W, H, dpr) {
    const scene = SCENES.get(situation.id) || { band: situation.band };
    const type = scene.type && SCENE_DRAW[scene.type] ? scene.type : 'plain';
    const spanKm =
      scene.spanKm ||
      (situation.camera?.height ? situation.camera.height / 1500 : 120);
    const view = makeView(
      Number.isFinite(scene.lon) ? scene.lon : situation.lon,
      Number.isFinite(scene.lat) ? scene.lat : situation.lat,
      spanKm,
      W,
      H,
    );
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    const sc = { band: situation.band, ...scene, lon: view.lon, lat: view.lat };
    try {
      await SCENE_DRAW[type](g, view, sc, dpr, feeds);
    } catch (error) {
      if (type === 'eye' || type === 'plain') throw error;
      // An overlay failing must not cost the card its picture.
      console.warn(`[globe:thumbnail] ${situation.id}`, error);
      g.clearRect(0, 0, W, H);
      await SCENE_DRAW.plain(g, view, sc, dpr, feeds);
    }
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
        'image/jpeg',
        0.86,
      ),
    );
  }

  return {
    thumbnail(situation, { width = 360, height = 480, dpr = 2 } = {}) {
      if (!situation?.id)
        return Promise.reject(new TypeError('thumbnail needs a situation'));
      const d = Math.max(1, Math.min(3, dpr));
      const W = Math.round(width * d);
      const H = Math.round(height * d);
      // A cached first-frame card has no scene: hand back its stored JPEG.
      if (situation.cached && !SCENES.has(situation.id)) {
        const url = cachedThumbnail(situation);
        if (url) return Promise.resolve(url);
      }
      const key = keyFor(situation, W, H, d);
      let p = mem.get(key);
      if (p) return p;
      p = run(async () => {
        const reqUrl = `${location.origin}/__gev-thumb/${key}`;
        if (cacheApi) {
          try {
            const c = await caches.open(CACHE_NAME);
            const hit = await c.match(reqUrl);
            if (hit) return URL.createObjectURL(await hit.blob());
          } catch {
            /* no Cache API (private mode) */
          }
        }
        const blob = await render(situation, W, H, d);
        rememberThumbnail(situation.id, blob);
        if (cacheApi)
          caches
            .open(CACHE_NAME)
            .then((c) =>
              c.put(
                reqUrl,
                new Response(blob, {
                  headers: { 'Content-Type': 'image/jpeg' },
                }),
              ),
            )
            .catch(() => {});
        const url = URL.createObjectURL(blob);
        urls.add(url);
        return url;
      });
      p.catch(() => mem.delete(key));
      mem.set(key, p);
      while (mem.size > 120) mem.delete(mem.keys().next().value);
      return p;
    },
    destroy() {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
      mem.clear();
    },
  };
}
