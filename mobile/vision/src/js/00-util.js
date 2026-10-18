/* God's Eye — vision mockup. Utilities: math, geo, sun, rng, DOM, formatting. */
const GE = (window.GE = window.GE || {});
const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;
const EARTH_KM = 6371.0, EARTH_M = 6371000.0;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const prefersReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/* ---------- vec3 / mat4 (Float64 arrays for CPU precision) ---------- */
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  madd: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
};
const m4 = {
  ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) { // column-major a*b
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  persp(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
  },
  // rotation-only view from basis (right, up, back) rows
  viewRot(right, up, back) {
    return [right[0], up[0], back[0], 0, right[1], up[1], back[1], 0, right[2], up[2], back[2], 0, 0, 0, 0, 1];
  },
  invert(m) {
    const a = m, o = new Array(16);
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return m4.ident();
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  xform(m, p) { // returns clip vec4
    const x = p[0], y = p[1], z = p[2];
    return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];
  },
};

/* ---------- geo (unit sphere, x→(0,0), y→(0,90E), z→north) ---------- */
const geo = {
  vec(lat, lon, altKm = 0) {
    const r = 1 + altKm / EARTH_KM, la = lat * D2R, lo = lon * D2R, c = Math.cos(la);
    return [r * c * Math.cos(lo), r * c * Math.sin(lo), r * Math.sin(la)];
  },
  ll(v) { const r = v3.len(v); return [Math.asin(clamp(v[2] / r, -1, 1)) * R2D, Math.atan2(v[1], v[0]) * R2D, (r - 1) * EARTH_KM]; },
  enu(lat, lon) { // east, north, up
    const la = lat * D2R, lo = lon * D2R;
    const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const east = [-Math.sin(lo), Math.cos(lo), 0];
    const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    return { east, north, up };
  },
  dist(lat1, lon1, lat2, lon2) { // radians
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  },
  bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  },
  slerp(a, b, t) {
    const d = clamp(v3.dot(a, b), -1, 1), om = Math.acos(d);
    if (om < 1e-9) return a.slice();
    const s = Math.sin(om);
    return v3.add(v3.scale(a, Math.sin((1 - t) * om) / s), v3.scale(b, Math.sin(t * om) / s));
  },
  // destination from lat/lon, bearing (rad), distance (km)
  dest(lat, lon, brg, km) {
    const d = km / EARTH_KM, p1 = lat * D2R, l1 = lon * D2R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg));
    const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * R2D, ((l2 * R2D + 540) % 360) - 180];
  },
  // local ENU meters offset -> lat/lon
  offset(lat, lon, eM, nM) { return [lat + (nM / EARTH_M) * R2D, lon + (eM / (EARTH_M * Math.cos(lat * D2R))) * R2D]; },
};

/* ---------- sun & sidereal time ---------- */
const astro = {
  jd: (ms) => ms / 86400000 + 2440587.5,
  // returns { lat, lon, dir:[x,y,z], gmst(rad) }
  sun(ms) {
    const d = astro.jd(ms) - 2451545.0;
    const g = (357.529 + 0.98560028 * d) * D2R;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
    const e = (23.439 - 0.00000036 * d) * D2R;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 * D2R;
    let lon = (ra - gmst) * R2D;
    lon = ((lon % 360) + 540) % 360 - 180;
    const lat = dec * R2D;
    return { lat, lon, dir: geo.vec(lat, lon), gmst: ((gmst % TAU) + TAU) % TAU };
  },
  // sun elevation (deg) at a place
  elev(ms, lat, lon) { const s = astro.sun(ms); return 90 - geo.dist(lat, lon, s.lat, s.lon) * R2D; },
};

/* ---------- seeded rng ---------- */
function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (a0, b0) => a0 + (b0 - a0) * f();
  f.int = (n) => Math.floor(f() * n);
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.gauss = () => { let u = 0, v = 0; while (!u) u = f(); while (!v) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  f.wpick = (arr, w) => { let s = 0; for (const x of arr) s += w(x); let r = f() * s; for (const x of arr) { r -= w(x); if (r <= 0) return x; } return arr[arr.length - 1]; };
  return f;
}
const hash01 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ---------- DOM ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- formatting ---------- */
const fmt = {
  n(x, d = 0) { return Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); },
  k(x) { return x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e4 ? Math.round(x / 1e3) + 'k' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'k' : String(Math.round(x)); },
  ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'now';
    if (s < 60) return s + ' s ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  },
  utc(ms, withDay = true) {
    const d = new Date(ms);
    const dd = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const tt = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    return withDay ? `${dd} · ${tt} UTC` : tt;
  },
  hm(ms) { const d = new Date(ms); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); },
  rel(h) { // hours offset → "−26 h" / "+4 h 30 m"
    const sign = h < 0 ? '−' : '+', a = Math.abs(h), H = Math.floor(a), M = Math.round((a - H) * 60);
    if (a < 1 / 60) return 'Live';
    return `${sign}${H ? H + ' h' : ''}${M && H < 24 ? (H ? ' ' : '') + M + ' m' : ''}`;
  },
  ll(lat, lon, d = 3) { return `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(d)}°${lon >= 0 ? 'E' : 'W'}`; },
  dur(s) { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; },
  hex: (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''),
};

/* ---------- tiny event bus ---------- */
const bus = {
  m: new Map(),
  on(e, f) { if (!this.m.has(e)) this.m.set(e, new Set()); this.m.get(e).add(f); return () => this.m.get(e).delete(f); },
  off(e, f) { this.m.get(e)?.delete(f); },
  emit(e, d) { this.m.get(e)?.forEach((f) => { try { f(d); } catch (err) { console.warn(err); } }); },
};

/* ---------- storage (conveniences only) ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('ge.v1.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ge.v1.' + k, JSON.stringify(v)); } catch {} },
};
const haptic = (p = 8) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

/* ---------- hashing ---------- */
// SHA-256 fallback (only used if crypto.subtle is unavailable)
function sha256js(bytes) {
  const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb);
  m.set(bytes); m[l] = 0x80; const dv = new DataView(m.buffer); dv.setUint32(nb - 4, l * 8); dv.setUint32(nb - 8, Math.floor((l * 8) / 4294967296));
  const W = new Uint32Array(64); const r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < nb; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = r(W[i-15],7)^r(W[i-15],18)^(W[i-15]>>>3), s1 = r(W[i-2],17)^r(W[i-2],19)^(W[i-2]>>>10); W[i] = (W[i-16]+s0+W[i-7]+s1)|0; }
    let [a,b,c,d,e,f,g,hh] = H;
    for (let i = 0; i < 64; i++) { const S1=r(e,6)^r(e,11)^r(e,25), ch=(e&f)^(~e&g), t1=(hh+S1+ch+K[i]+W[i])|0, S0=r(a,2)^r(a,13)^r(a,22), mj=(a&b)^(a&c)^(b&c), t2=(S0+mj)|0; hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0; }
    H[0]+=a; H[1]+=b; H[2]+=c; H[3]+=d; H[4]+=e; H[5]+=f; H[6]+=g; H[7]+=hh;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]); return out.buffer;
}
const hasSubtle = () => { try { return !!(window.crypto && crypto.subtle && crypto.subtle.digest); } catch { return false; } };
async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  if (hasSubtle()) { try { return fmt.hex(await crypto.subtle.digest('SHA-256', bytes)); } catch {} }
  return fmt.hex(sha256js(bytes));
}
// canonical JSON (sorted keys) for hashing
function canon(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
}

Object.assign(GE, { D2R, R2D, TAU, EARTH_KM, clamp, lerp, smooth, ease, v3, m4, geo, astro, rng, fmt, bus, store, sha256, canon });
