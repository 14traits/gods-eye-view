/* Local 3D scenes for the low-altitude "photoreal city" treatment: procedural extruded city blocks
   aligned with the globe shader's street grid, stadium bowl, airfields, launch pad, and a Himalayan
   valley heightfield for the Bhote Koshi reconstruction (river carved along the real corridor). */
const SC = (GE.scenes = {});
const VSTR = 12; // pos3 nor3 uv2 attr4
SC.list = [
  { id: 'nyc', name: 'Midtown Manhattan', lat: 40.7549, lon: -73.9840, block: 88, rot: 29 * D2R, urban: 0.55, radiusKm: 16, kind: 'city', R: 3000, maxH: 240, tower: { lat: 40.7553, lon: -73.9838, h: 412, w: 46 } },
  { id: 'chi', name: 'Chicago Loop', lat: 41.8789, lon: -87.6359, block: 100, rot: 0, urban: 0.45, radiusKm: 18, kind: 'city', R: 2600, maxH: 260, water: [0.94, 0.342, 1824, 1], downtown: [41.8807, -87.6293] },
  { id: 'wembley', name: 'Wembley', lat: 51.5560, lon: -0.2796, block: 74, rot: 0.21, urban: 0.25, radiusKm: 10, kind: 'stadium', R: 1500, maxH: 40 },
  { id: 'novosel', name: 'Cairns Army Airfield', lat: 31.2760, lon: -85.7130, block: 140, rot: 0.06, urban: -0.2, radiusKm: 28, kind: 'airfield', R: 0 },
  { id: 'koshi', name: 'Bhote Koshi corridor', lat: 28.2150, lon: 85.3450, block: 100, rot: 0, urban: -1, radiusKm: 32, kind: 'terrain', R: 0 },
  { id: 'cape', name: 'SLC-40', lat: 28.5618, lon: -80.5772, block: 120, rot: 0, urban: -0.5, radiusKm: 14, kind: 'pad', R: 0 },
  { id: 'drone', name: 'Drone corridor', lat: 30.5880, lon: -96.2900, block: 62, rot: 0.12, urban: 0.3, radiusKm: 12, kind: 'suburb', R: 2200, maxH: 9 },
  { id: 'atl', name: 'ATL', lat: 33.6407, lon: -84.4277, block: 120, rot: 0, urban: 0.0, radiusKm: 10, kind: 'airport', R: 0 },
];
SC.byId = Object.fromEntries(SC.list.map((s) => [s.id, s]));
// Bhote Koshi corridor (approximate public geography): Rasuwagadhi → Timure → Syaphrubesi → Trishuli
const KOSHI = [[28.2860, 85.3815], [28.2802, 85.3797], [28.2700, 85.3752], [28.2555, 85.3705], [28.2400, 85.3650], [28.2250, 85.3600], [28.2100, 85.3550], [28.1950, 85.3500], [28.1800, 85.3460], [28.1660, 85.3420], [28.1600, 85.3380], [28.1500, 85.3230], [28.1400, 85.3060], [28.1300, 85.2900]];
SC.KOSHI = KOSHI;
SC.FLOOD = { startMs: Date.UTC(2026, 7, 26, 7, 45), speedMH: 18000, crest: 9 };

function Mesh() { this.v = []; this.i = []; }
Mesh.prototype.vert = function (p, n, uv, at) { this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], at[0], at[1], at[2], at[3]); return this.v.length / VSTR - 1; };
Mesh.prototype.quad = function (a, b, c, d, n, uvs, at) { const i0 = this.vert(a, n, uvs[0], at), i1 = this.vert(b, n, uvs[1], at), i2 = this.vert(c, n, uvs[2], at), i3 = this.vert(d, n, uvs[3], at); this.i.push(i0, i1, i2, i0, i2, i3); };
// oriented box: center (x,y) in ENU m, size w×d, height h from z0, rotation rot
Mesh.prototype.box = function (x, y, w, d, h, rot, at, z0 = 0) {
  if (at[0] === 4) at = [4, at[1], at[2], d];
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (u, v) => [x + u * c - v * s, y + u * s + v * c];
  const pts = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
  const z1 = z0 + h;
  for (let k = 0; k < 4; k++) {
    const a = pts[k], b = pts[(k + 1) % 4];
    const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
    const n = [ey / L, -ex / L, 0];
    this.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], n, [[0, 0], [L, 0], [L, h], [0, h]], at);
  }
  this.quad([pts[0][0], pts[0][1], z1], [pts[1][0], pts[1][1], z1], [pts[2][0], pts[2][1], z1], [pts[3][0], pts[3][1], z1], [0, 0, 1], [[0, 0], [w, 0], [w, d], [0, d]], at);
};

const enuOf = (sc, lat, lon) => { const e = geo.enu(sc.lat, sc.lon); const d = v3.sub(geo.vec(lat, lon), geo.vec(sc.lat, sc.lon)); return [v3.dot(d, e.east) * EARTH_M, v3.dot(d, e.north) * EARTH_M]; };
SC.enuOf = enuOf;
const llOf = (sc, x, y) => geo.offset(sc.lat, sc.lon, x, y);

function genCity(sc, M, R0) {
  const B = sc.block, c = Math.cos(sc.rot), s = Math.sin(sc.rot);
  const rr = rng(sc.id.length * 991 + 7);
  const R = sc.R, n = Math.ceil(R / B) + 1;
  const dt = sc.downtown ? enuOf(sc, sc.downtown[0], sc.downtown[1]) : [0, 0];
  const twr = sc.tower ? enuOf(sc, sc.tower.lat, sc.tower.lon) : null;
  const hsh = (i, j) => hash01(i * 157.31 + j * 311.7 + sc.id.length);
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const pcx = (i + 0.5) * B, pcy = (j + 0.5) * B;
    const qx = c * pcx - s * pcy, qy = s * pcx + c * pcy;
    const rd = Math.hypot(qx, qy); if (rd > R) continue;
    if (sc.water && qx * sc.water[0] + qy * sc.water[1] > sc.water[2] - 40) continue;
    if (sc.kind === 'stadium' && Math.hypot(qx, qy) < 280) continue;
    if (twr && Math.hypot(qx - twr[0], qy - twr[1]) < 40) continue;
    const [la, lo] = llOf(sc, qx, qy);
    if (GE.world.waterAt(la, lo) > 0.6 && !sc.water) continue;
    const dens = clamp(GE.world.lightsAt(la, lo) * 0.9 + sc.urban, 0, 1) * smooth(R, R * 0.6, rd);
    if (hsh(i, j) > dens * 1.25 + 0.05) continue;
    const rw = (0.085 + ((((i % 5) + 5) % 5) === 4 ? 0.05 : 0)) * B + 3;
    const inner = B - 2 * rw;
    const kx = inner > 50 && rr() < 0.6 ? 2 : 1, ky = inner > 50 && rr() < 0.6 ? 2 : 1;
    const ddt = Math.hypot(qx - dt[0], qy - dt[1]);
    for (let a = 0; a < kx; a++) for (let b = 0; b < ky; b++) {
      const lw = inner / kx, ld = inner / ky;
      const lpx = i * B + rw + lw * (a + 0.5), lpy = j * B + rw + ld * (b + 0.5);
      const x = c * lpx - s * lpy, y = s * lpx + c * lpy;
      const hh = hash01(lpx * 0.37 + lpy * 0.71);
      const core = Math.exp(-ddt / (sc.R * 0.28));
      let h = sc.kind === 'suburb' ? 5 + hh * 4 : 9 + Math.pow(dens, 1.6) * (sc.maxH * (0.15 + 0.85 * core)) * Math.exp(rr.gauss() * 0.45);
      h = clamp(h, 6, sc.maxH * (sc.tower ? 1.0 : 1.4));
      const inset = 2 + hh * 3;
      const type = sc.kind === 'suburb' ? 6 : 0;
      M.box(x, y, lw - inset * 2, ld - inset * 2, h, sc.rot, [type, hh, h, 0]);
      if (type === 0 && h > 60 && hh > 0.5) M.box(x, y, (lw - inset * 2) * 0.6, (ld - inset * 2) * 0.6, h * 0.25, sc.rot, [0, hh, h * 1.25, 0], h);
    }
  }
  if (twr) { // the fictional tower (skyscraper climb reconstruction)
    const T = sc.tower; M.box(twr[0], twr[1], T.w, T.w, T.h * 0.62, sc.rot, [0, 0.8, T.h, 0]); M.box(twr[0], twr[1], T.w * 0.72, T.w * 0.72, T.h * 0.3, sc.rot, [0, 0.8, T.h, 0], T.h * 0.62); M.box(twr[0], twr[1], 3, 3, T.h * 0.08, sc.rot, [5, 0.5, T.h, 0], T.h * 0.92); M.box(twr[0], twr[1], T.w * 0.76, T.w * 0.76, 5, sc.rot, [5, 0.5, T.h, 0], T.h * 0.9);
  }
}
function genStadium(sc, M) {
  const N = 72; const rings = [[64, 46, 4], [92, 74, 20], [128, 108, 44]];
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU;
    for (let r = 0; r < rings.length - 1; r++) {
      const [ax, ay, az] = rings[r], [bx, by, bz] = rings[r + 1];
      const p = (A, ex, ey, ez) => [Math.cos(A) * ex, Math.sin(A) * ey, ez];
      const p0 = p(a0, ax, ay, az), p1 = p(a1, ax, ay, az), p2 = p(a1, bx, by, bz), p3 = p(a0, bx, by, bz);
      const e1 = v3.sub(p1, p0), e2 = v3.sub(p3, p0); const n = v3.norm(v3.cross(e1, e2));
      M.quad(p0, p1, p2, p3, n[2] < 0 ? v3.scale(n, -1) : n, [[k * 4, r * 20], [k * 4 + 4, r * 20], [k * 4 + 4, r * 20 + 20], [k * 4, r * 20 + 20]], [3, 0.5, 40, 0]);
    }
    // outer facade
    const [ox, oy] = [134, 114]; const o0 = [Math.cos(a0) * ox, Math.sin(a0) * oy], o1 = [Math.cos(a1) * ox, Math.sin(a1) * oy];
    const L = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]); const nn = v3.norm([o0[0] + o1[0], o0[1] + o1[1], 0]);
    M.quad([o0[0], o0[1], 0], [o1[0], o1[1], 0], [o1[0], o1[1], 50], [o0[0], o0[1], 50], nn, [[0, 0], [L, 0], [L, 50], [0, 50]], [0, 0.75, 50, 0]);
    // roof ring
    const r0 = [Math.cos(a0) * 104, Math.sin(a0) * 86], r1 = [Math.cos(a1) * 104, Math.sin(a1) * 86];
    M.quad([r0[0], r0[1], 52], [r1[0], r1[1], 52], [o1[0] * 1.02, o1[1] * 1.02, 52], [o0[0] * 1.02, o0[1] * 1.02, 52], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0.6, 52, 0]);
  }
  M.quad([-55, -36, 0.6], [55, -36, 0.6], [55, 36, 0.6], [-55, 36, 0.6], [0, 0, 1], [[0, 0], [110, 0], [110, 72], [0, 72]], [4, 1, 0, 0]);
  M.box(-40, 0, 14, 30, 13, 0, [5, 0.5, 13, 0], 0.6);
  for (let k = 0; k < 6; k++) M.box(-40, -12 + k * 5, 1.2, 1.2, 22, 0, [5, 0.5, 22, 0], 13);
}
function genAirfield(sc, M) {
  const rw = (x, y, L, W, rot) => M.box(x, y, L, W, 0.4, rot, [4, 0, 0.4, 0]);
  rw(0, 0, 1550, 46, 0.06); rw(150, 100, 1500, 46, 0.06 + 1.1); rw(-300, -420, 900, 30, 0.06 + Math.PI / 2);
  for (let i = 0; i < 26; i++) { const x = -600 + (i % 13) * 95, y = 260 + Math.floor(i / 13) * 70; M.box(x, y, 28, 28, 0.35, 0.06, [4, 0, 0.3, 0]); }
  for (let i = 0; i < 6; i++) M.box(-500 + i * 120, 420, 80, 48, 14, 0.06, [0, 0.4 + i * 0.05, 14, 0]);
  M.box(260, -180, 14, 14, 26, 0.06, [0, 0.9, 26, 0]);
  // stagefields
  for (const [la, lo] of [[31.36, -85.63], [31.20, -85.81], [31.42, -85.79]]) { const [x, y] = enuOf(sc, la, lo); M.box(x, y, 700, 40, 0.4, 0.4, [4, 0, 0.4, 0]); for (let k = 0; k < 6; k++) M.box(x - 250 + k * 100, y + 80, 26, 26, 0.35, 0.4, [4, 0, 0.3, 0]); }
}
function genPad(sc, M) {
  M.box(0, 0, 220, 160, 0.5, 0, [4, 0, 0.5, 0]);
  M.box(-14, 0, 12, 12, 88, 0, [7, 0.35, 88, 0]);
  M.box(4, 0, 4.2, 4.2, 70, 0, [7, 1.0, 70, 0]);
  M.box(4, 0, 4.4, 4.4, 2, 0, [5, 0.5, 2, 0], 70);
  for (const [x, y, w, d, h] of [[300, 180, 60, 40, 22], [-260, 220, 90, 30, 12], [400, -260, 30, 30, 14]]) M.box(x, y, w, d, h, 0, [0, 0.4, h, 0]);
}
function genAirport(sc, M) {
  const rw = [[-1000, 1200, 3700], [-1100, 950, 2700], [-900, -300, 2700], [-1000, -560, 3000], [-1150, -1200, 2900]];
  for (const [x, y, L] of rw) M.box(x + L / 2 - 1000, y, L, 46, 0.4, 0, [4, 0, 0.4, 0]);
  for (let k = 0; k < 7; k++) M.box(-1100 + k * 420, 330, 46, 620, 16, 0, [0, 0.35, 16, 0]);
  M.box(-1500, 330, 260, 220, 22, 0, [0, 0.6, 22, 0]);
  M.box(1400, 1400, 14, 14, 70, 0, [0, 0.9, 70, 0]);
}
// Bhote Koshi valley heightfield
function koshiRiverXY(sc) { return KOSHI.map(([la, lo]) => enuOf(sc, la, lo)); }
function genTerrain(sc, M) {
  const riv = koshiRiverXY(sc);
  const cum = [0]; for (let i = 1; i < riv.length; i++) cum.push(cum[i - 1] + Math.hypot(riv[i][0] - riv[i - 1][0], riv[i][1] - riv[i - 1][1]));
  sc.riverLen = cum[cum.length - 1];
  const nearest = (x, y) => { let bd = 1e12, bs = 0; for (let i = 1; i < riv.length; i++) { const [ax, ay] = riv[i - 1], [bx, by] = riv[i]; const ex = bx - ax, ey = by - ay; const L2 = ex * ex + ey * ey; const t = clamp(((x - ax) * ex + (y - ay) * ey) / L2, 0, 1); const px = ax + ex * t - x, py = ay + ey * t - y; const d = px * px + py * py; if (d < bd) { bd = d; bs = cum[i - 1] + t * Math.sqrt(L2); } } return [Math.sqrt(bd), bs]; };
  const bed = (s) => 1880 - s * 0.021;
  const ridged = (x, y) => { let a = 0.5, f = 1 / 5200, sum = 0; for (let o = 0; o < 6; o++) { const n = 1 - Math.abs(vn2(x * f + o * 13.1, y * f + o * 7.7) * 2 - 1); sum += n * n * a; a *= 0.5; f *= 2.05; } return sum; };
  const height = (x, y) => {
    const [d, s] = nearest(x, y);
    const base = 1750 + ridged(x, y) * 2900 + y * 0.03 + Math.max(0, x) * 0.035;
    const b = bed(s);
    const k = Math.pow(clamp(d / 2600, 0, 1), 0.72);
    return [b + (base - b) * k + Math.min(d, 60) * 0.05, d, s];
  };
  sc.height = (x, y) => height(x, y)[0];
  const N = 180, HALF = 19000; const step = (2 * HALF) / N;
  const H = new Float32Array((N + 1) * (N + 1)), Dd = new Float32Array((N + 1) * (N + 1)), Ss = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const x = -HALF + i * step, y = -HALF + j * step; const [h, d, s] = height(x, y); const k = j * (N + 1) + i; H[k] = h; Dd[k] = d; Ss[k] = s; }
  const base = M.v.length / VSTR;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i; const x = -HALF + i * step, y = -HALF + j * step;
    const hl = H[j * (N + 1) + Math.max(0, i - 1)], hr = H[j * (N + 1) + Math.min(N, i + 1)], hd = H[Math.max(0, j - 1) * (N + 1) + i], hu = H[Math.min(N, j + 1) * (N + 1) + i];
    const n = v3.norm([(hl - hr) / (2 * step), (hd - hu) / (2 * step), 1]);
    const edge = Math.min(i, j, N - i, N - j); const z = edge === 0 ? 0 : H[k];
    M.vert([x, y, z], n, [Ss[k], 0], [1, hash01(k), H[k], smooth(260, 40, Dd[k])]);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; M.i.push(a, b, d, a, d, c); }
  // river / flood water strip
  const wbase = M.v.length / VSTR; const pts = [];
  for (let s = 0; s <= sc.riverLen; s += 70) { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1]); const x = lerp(riv[i - 1][0], riv[i][0], f), y = lerp(riv[i - 1][1], riv[i][1], f); const tx = riv[i][0] - riv[i - 1][0], ty = riv[i][1] - riv[i - 1][1], tl = Math.hypot(tx, ty); pts.push([x, y, -ty / tl, tx / tl, s]); }
  for (const [x, y, nx, ny, s] of pts) { const W2 = 210; const z = bed(s) + 4; M.vert([x - nx * W2, y - ny * W2, z], [0, 0, 1], [s, -1], [2, 0, 0, 0]); M.vert([x + nx * W2, y + ny * W2, z], [0, 0, 1], [s, 1], [2, 0, 0, 0]); }
  for (let k = 0; k < pts.length - 1; k++) { const a = wbase + k * 2; M.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  // villages & bridge
  const village = (la, lo, n, spread) => { const [cx, cy] = enuOf(sc, la, lo); const r = rng(Math.round(la * 1000)); for (let k = 0; k < n; k++) { const x = cx + r.gauss() * spread, y = cy + r.gauss() * spread; const z = sc.height(x, y); M.box(x, y, 7 + r() * 6, 8 + r() * 6, 5 + r() * 4, r() * 3, [6, r(), 6, 0], z - 1); } };
  village(28.1600, 85.3395, 70, 130); village(28.2560, 85.3690, 22, 80); village(28.2790, 85.3770, 14, 60); village(28.2050, 85.3520, 10, 60);
  const [bx, by] = enuOf(sc, 28.2802, 85.3797); M.box(bx, by, 6, 120, 2.5, 0.6, [0, 0.9, 3, 0], bed(sc.riverLen * 0.03) + 18);
  const [bx2, by2] = enuOf(sc, 28.1625, 85.3405); M.box(bx2, by2, 5, 110, 2.5, 1.0, [0, 0.9, 3, 0], bed(sc.riverLen * 0.83) + 16);
  sc.riverPts = pts; sc.bed = bed;
}
function vn2(x, y) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j; const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const h = (a, b) => hash01(a * 12.9898 + b * 78.233); return lerp(lerp(h(i, j), h(i + 1, j), u), lerp(h(i, j + 1), h(i + 1, j + 1), u), v); }

SC.ensure = function (sc) {
  if (sc.mesh || sc.building) return;
  sc.building = true;
  const M = new Mesh();
  if (sc.kind === 'city' || sc.kind === 'suburb' || sc.kind === 'stadium') genCity(sc, M);
  if (sc.kind === 'stadium') genStadium(sc, M);
  if (sc.kind === 'airfield') genAirfield(sc, M);
  if (sc.kind === 'pad') genPad(sc, M);
  if (sc.kind === 'airport') genAirport(sc, M);
  if (sc.kind === 'terrain') genTerrain(sc, M);
  if (sc.kind === 'suburb') M.box(0, 0, 130, 60, 12, sc.rot, [0, 0.3, 12, 0]);
  const gl = GL.gl, P = GL.progs.mesh;
  const vb = GL.buffer(new Float32Array(M.v));
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(M.i), gl.STATIC_DRAW);
  sc.vao = GL.vao(P, { aPos: [vb, 3, VSTR, 0], aNor: [vb, 3, VSTR, 3], aUV: [vb, 2, VSTR, 6], aAttr: [vb, 4, VSTR, 8] }, ib);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  sc.count = M.i.length; sc.mesh = true; sc.building = false;
  sc.enu = geo.enu(sc.lat, sc.lon); sc.origin = geo.vec(sc.lat, sc.lon);
};

/* ---------- JS atmosphere (matches the shader) for mesh lighting & fog ---------- */
const HR = 0.0021, HM = 0.0006, RA = 1.0165, BR = [22.1, 51.5, 126.3], BMk = 42.0;
function odH(r, mu, H) { const c = Math.sqrt(Math.PI * 0.5 * r / H), h = (r - 1) / H; if (mu >= 0) return H * Math.exp(-h) * c / (c * mu + 1); const r0 = r * Math.sqrt(Math.max(0, 1 - mu * mu)); if (r0 < 1) return 1e4; const h0 = (r0 - 1) / H, c0 = Math.sqrt(Math.PI * 0.5 * r0 / H); return H * (2 * Math.exp(-h0) * c0 - Math.exp(-h) * c / (-c * mu + 1)); }
function sunTransJS(x, sun) { const r = v3.len(x), mu = v3.dot(x, sun) / r; const oR = odH(r, mu, HR), oM = odH(r, mu, HM); return BR.map((b) => Math.exp(-(b * oR + BMk * 1.11 * oM))); }
function atmoJS(ro, rd, tEnd, sun, steps = 10) {
  const b = v3.dot(ro, rd), c = v3.dot(ro, ro) - RA * RA, d = b * b - c; if (d < 0) return [0, 0, 0];
  const sq = Math.sqrt(d); const t0 = Math.max(-b - sq, 0), t1 = Math.min(-b + sq, tEnd); if (t1 <= t0) return [0, 0, 0];
  const mu = v3.dot(rd, sun), pR = (3 / (16 * Math.PI)) * (1 + mu * mu), g = 0.76, pM = (3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  let sR = [0, 0, 0], sM = [0, 0, 0], oR = 0, oM = 0; const L = t1 - t0;
  for (let i = 0; i < steps; i++) { const fa = i / steps, fb = (i + 1) / steps; const ta = fa * fa, tb = fb * fb; const ds = (tb - ta) * L; const t = t0 + (ta + tb) * 0.5 * L; const x = v3.madd(ro, rd, t); const r = v3.len(x), h = r - 1; const dR = Math.exp(-h / HR), dM = Math.exp(-h / HM); oR += dR * ds; oM += dM * ds; const muS = v3.dot(x, sun) / r; const lR = odH(r, muS, HR), lM = odH(r, muS, HM); for (let k = 0; k < 3; k++) { const att = Math.exp(-(BR[k] * (oR + lR) + BMk * 1.11 * (oM + lM))); sR[k] += dR * att * ds; sM[k] += dM * att * ds; } }
  return [0, 1, 2].map((k) => 20 * (sR[k] * BR[k] * pR + sM[k] * BMk * pM));
}
SC.atmoJS = atmoJS; SC.sunTransJS = sunTransJS;

SC.draw = function (sc, view, { sun, t, eye, opts }) {
  const gl = GL.gl, P = GL.progs.mesh; if (!sc.vao) return;
  const e = sc.enu, o = sc.origin, R = EARTH_M;
  const d = v3.sub(o, eye);
  const M = [e.east[0] / R, e.east[1] / R, e.east[2] / R, 0, e.north[0] / R, e.north[1] / R, e.north[2] / R, 0, e.up[0] / R, e.up[1] / R, e.up[2] / R, 0, d[0], d[1], d[2], 1];
  const MVP = m4.mul(view.VP, M);
  gl.useProgram(P.p);
  gl.uniformMatrix4fv(P.u.uMVP, false, MVP);
  const sd = sun.dir; const sunL = [v3.dot(sd, e.east), v3.dot(sd, e.north), v3.dot(sd, e.up)];
  gl.uniform3fv(P.u.uSunL, sunL);
  const tr = sunTransJS(v3.scale(o, 1.0002), sd);
  const k = 20 / Math.PI; const night = opts.nightForce ? 1 : 1 - smooth(-0.14, 0.06, sunL[2]);
  const clear = (opts.lens || GE.world.lens) === 'clear';
  gl.uniform3fv(P.u.uSunCol, clear ? [2.2, 2.2, 2.2] : tr.map((x) => x * k * (opts.nightForce ? 0.03 : 1)));
  const amb = smooth(-0.25, 0.5, sunL[2]);
  gl.uniform3fv(P.u.uSkyCol, clear ? [1.2, 1.25, 1.35] : [0.03 * 20 / Math.PI * 0.9 * amb + 0.014, 0.045 * 20 / Math.PI * 0.9 * amb + 0.02, 0.085 * 20 / Math.PI * 0.9 * amb + 0.04]);
  // fog colour: inscatter along the horizon in the camera's look direction
  const fwd = v3.scale(view.back, -1); const fh = v3.norm(v3.madd(fwd, e.up, -v3.dot(fwd, e.up))); const ro = v3.madd(o, e.up, 0.0003);
  let fog = atmoJS(ro, fh, 0.012, sd, 8); fog = fog.map((x) => x * 0.8 + 0.0015);
  gl.uniform3fv(P.u.uFogCol, fog);
  const el = [v3.dot(v3.scale(d, -1), e.east) * R, v3.dot(v3.scale(d, -1), e.north) * R, v3.dot(v3.scale(d, -1), e.up) * R];
  gl.uniform3fv(P.u.uEyeL, el);
  gl.uniform1f(P.u.uNight, night); gl.uniform1f(P.u.uT, t);
  gl.uniform1f(P.u.uVis, sc.kind === 'terrain' ? 110000 : 26000);
  const fl = SC.FLOOD; const simMs = opts.simMs ?? GE.world.simMs;
  gl.uniform4f(P.u.uFlood, (simMs - fl.startMs) / 3600000, 0, fl.speedMH, fl.crest);
  gl.uniform1f(P.u.uClear, clear ? 1 : 0);
  gl.bindVertexArray(sc.vao);
  gl.drawElements(gl.TRIANGLES, sc.count, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);
};
// ground height (m) at lat/lon for scenes with terrain
SC.groundAt = function (lat, lon) { const sc = SC.byId.koshi; if (!sc.height) return 0; const [x, y] = enuOf(sc, lat, lon); return sc.height(x, y); };
