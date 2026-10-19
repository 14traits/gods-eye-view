/* Painters — procedural sensor frames. Every feed card, room attachment and capture scene is drawn
   here as the instrument that saw it would show it: IR cloud tops with an enhancement table, radar
   reflectivity in dBZ bins over a street grid, CCTV frames with burned-in OSD, SAR speckle, shake maps,
   long-exposure launch arcs. Geography comes from the bundled NASA masks; weather and people are
   synthetic (Concept · illustrative data). */
const PT = (GE.paint = {});
const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
PT.MONO = MONO;
const hexrgb = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
PT.mk = mk;

/* ---------- value noise + fbm ---------- */
function noiseGen(seed) {
  const r = rng(seed * 7919 + 13); const p = new Uint8Array(512); const v = new Float32Array(256);
  for (let i = 0; i < 256; i++) { p[i] = i; v[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v[p[p[X] + Y]], b = v[p[p[X + 1] + Y]], c = v[p[p[X] + Y + 1]], d = v[p[p[X + 1] + Y + 1]];
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  n.fbm = (x, y, o = 5, g = 0.5, l = 2.03) => { let s = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < o; i++) { s += a * n(x * f + i * 17.3, y * f - i * 9.1); t += a; a *= g; f *= l; } return s / t; };
  n.ridge = (x, y, o = 5) => { let s = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < o; i++) { const q = 1 - Math.abs(n(x * f + i * 5.2, y * f + i * 1.7) * 2 - 1); s += a * q * q; t += a; a *= 0.5; f *= 2.1; } return s / t; };
  return n;
}
PT.noise = noiseGen;

/* ---------- colour ramps → 256 LUT ---------- */
function lut(stops) {
  const L = new Uint8ClampedArray(256 * 3); const S = stops.map(([t, c]) => [t, hexrgb(c)]);
  for (let i = 0; i < 256; i++) { const t = i / 255; let k = 1; while (k < S.length - 1 && S[k][0] < t) k++; const a = S[k - 1], b = S[k]; const f = clamp((t - a[0]) / (b[0] - a[0] || 1), 0, 1); for (let j = 0; j < 3; j++) L[i * 3 + j] = a[1][j] + (b[1][j] - a[1][j]) * f; }
  return L;
}
const LUT = {
  inferno: lut([[0, '#000004'], [0.15, '#1f0c48'], [0.3, '#550f6d'], [0.45, '#88226a'], [0.6, '#ba3655'], [0.72, '#e35933'], [0.84, '#f98e09'], [0.94, '#f6d746'], [1, '#fcffa4']]),
  mmi: lut([[0, '#bfccff'], [0.14, '#a0e6ff'], [0.28, '#80ffff'], [0.42, '#7aff93'], [0.56, '#ffff00'], [0.7, '#ffc800'], [0.84, '#ff6a00'], [1, '#c80000']]),
};
PT.LUT = LUT;
// IR enhancement (BD-style): warm = dark grey; cold cloud tops step through cyan, blue, green, yellow, red, black, white
function irColor(T, out) {
  if (T > -30) { const g = clamp(lerp(28, 196, (30 - T) / 60), 0, 255); out[0] = g; out[1] = g; out[2] = g + 4; return; }
  const st = [[-30, [150, 222, 245]], [-38, [52, 150, 225]], [-44, [28, 70, 200]], [-50, [40, 190, 70]], [-56, [235, 232, 70]], [-61, [246, 150, 40]], [-66, [226, 46, 30]], [-71, [120, 14, 18]], [-75, [12, 12, 14]], [-79, [96, 96, 100]], [-83, [236, 236, 240]], [-95, [255, 255, 255]]];
  for (let i = 1; i < st.length; i++) if (T >= st[i][0]) { const a = st[i - 1], b = st[i]; const f = (a[0] - T) / (a[0] - b[0]); for (let j = 0; j < 3; j++) out[j] = a[1][j] + (b[1][j] - a[1][j]) * f; return; }
  out[0] = out[1] = out[2] = 255;
}
const DBZ = [[18, '#03b33a'], [25, '#02d802'], [30, '#019a00'], [35, '#f4ec00'], [40, '#e4b800'], [45, '#fd8e00'], [50, '#fb0d00'], [55, '#cf0000'], [60, '#a80000'], [65, '#f400f6'], [70, '#9a52cc'], [75, '#ffffff']].map(([d, c]) => [d, hexrgb(c)]);
function dbzColor(z, out) { if (z < 18) { out[3] = 0; return; } let k = 0; while (k < DBZ.length - 1 && DBZ[k + 1][0] <= z) k++; const c = DBZ[k][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = 225; }

/* ---------- raster helpers ---------- */
// fn(u, v, out, x, y) fills out[0..3] for each cell of a w/k × h/k field; drawn scaled onto ctx
function field(ctx, w, h, k, fn, smoothOn = true, comp) {
  const fw = Math.max(1, Math.round(w / k)), fh = Math.max(1, Math.round(h / k));
  const c = mk(fw, fh), cx = c.getContext('2d'); const id = cx.createImageData(fw, fh); const d = id.data; const out = [0, 0, 0, 255];
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { out[3] = 255; fn(x / fw, y / fh, out, x, y, fw, fh); const o = (y * fw + x) * 4; d[o] = out[0]; d[o + 1] = out[1]; d[o + 2] = out[2]; d[o + 3] = out[3]; }
  cx.putImageData(id, 0, 0);
  ctx.save(); if (comp) ctx.globalCompositeOperation = comp; ctx.imageSmoothingEnabled = smoothOn; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, 0, 0, w, h); ctx.restore();
}
PT.field = field;
let GRAIN = null;
function grain(ctx, w, h, a = 0.07) {
  if (!GRAIN) { GRAIN = mk(192, 192); const g = GRAIN.getContext('2d'); const id = g.createImageData(192, 192); const r = rng(99); for (let i = 0; i < id.data.length; i += 4) { const v = r() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); }
  ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = ctx.createPattern(GRAIN, 'repeat'); const ox = (Math.random() * 192) | 0, oy = (Math.random() * 192) | 0; ctx.translate(-ox, -oy); ctx.fillRect(0, 0, w + 192, h + 192); ctx.restore();
}
function vignette(ctx, w, h, a = 0.55, inner = 0.35) { const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.hypot(w, h) * 0.6); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
function scan(ctx, w, h, a = 0.08, step = 3) { ctx.save(); ctx.fillStyle = `rgba(0,0,0,${a})`; for (let y = 0; y < h; y += step) ctx.fillRect(0, y, w, 1); ctx.restore(); }
function glow(ctx, x, y, r, col, a = 1) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col.replace('A', a)); g.addColorStop(0.35, col.replace('A', a * 0.35)); g.addColorStop(1, col.replace('A', 0)); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
// OSD text, camera style
function osd(ctx, txt, x, y, px, align = 'left', col = 'rgba(255,255,255,.92)', base = 'top') {
  ctx.save(); ctx.font = `600 ${px}px ${MONO}`; ctx.textAlign = align; ctx.textBaseline = base; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, px / 3.4); ctx.strokeStyle = 'rgba(0,0,0,.72)'; ctx.strokeText(txt, x, y); ctx.fillStyle = col; ctx.fillText(txt, x, y); ctx.restore();
}
function label(ctx, txt, x, y, px, col = 'rgba(235,240,248,.75)', align = 'left') { ctx.save(); ctx.font = `600 ${px}px ${MONO}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 4; ctx.fillText(txt, x, y); ctx.restore(); }
Object.assign(PT, { grain, vignette, scan, glow, osd, label, lut, irColor });
const z2 = (n) => String(n).padStart(2, '0');
PT.stamp = (ms, sep = ' ') => { const d = new Date(ms); return `${d.getUTCFullYear()}-${z2(d.getUTCMonth() + 1)}-${z2(d.getUTCDate())}${sep}${z2(d.getUTCHours())}:${z2(d.getUTCMinutes())}:${z2(d.getUTCSeconds())}`; };

/* ---------- maps (equirectangular, square km pixels) ---------- */
function mapView(lat0, lon0, spanLon, w, h) {
  const spanLat = spanLon * Math.cos(lat0 * D2R) * (h / w);
  return { lat0, lon0, spanLon, spanLat, w, h, X: (lon) => ((((lon - lon0) + 540) % 360) - 180) / spanLon * w + w / 2, Y: (lat) => h / 2 - ((lat - lat0) / spanLat) * h, lon: (x) => lon0 + ((x - w / 2) / w) * spanLon, lat: (y) => lat0 + ((h / 2 - y) / h) * spanLat, kmPx: (spanLon * 111.32 * Math.cos(lat0 * D2R)) / w };
}
PT.mapView = mapView;
const cropCache = new Map();
function cropData(name, mv, w, h) {
  const key = [name, mv.lat0.toFixed(3), mv.lon0.toFixed(3), mv.spanLon.toFixed(3), w, h].join('|');
  if (cropCache.has(key)) return cropCache.get(key);
  const img = GE.world.img && GE.world.img[name]; const c = mk(w, h), cx = c.getContext('2d', { willReadFrequently: true });
  if (img) { cx.imageSmoothingQuality = 'high'; const iw = img.width, ih = img.height; const sx = ((mv.lon0 - mv.spanLon / 2 + 180) / 360) * iw, sy = ((90 - (mv.lat0 + mv.spanLat / 2)) / 180) * ih; cx.drawImage(img, sx, sy, (mv.spanLon / 360) * iw, (mv.spanLat / 180) * ih, 0, 0, w, h); }
  const d = cx.getImageData(0, 0, w, h).data; if (cropCache.size > 40) cropCache.clear(); cropCache.set(key, d); return d;
}
PT.cropData = cropData;
// dark instrument map: land/sea from the water mask, optional relief (topo) and night lights
function mapBase(ctx, mv, o = {}) {
  const { w, h } = mv; const k = o.k || 1; const fw = Math.round(w / k), fh = Math.round(h / k);
  const wm = cropData('water', mv, fw, fh); const tp = o.relief ? cropData('topo', mv, fw, fh) : null; const nl = o.lights ? cropData('night', mv, fw, fh) : null;
  const land = hexrgb(o.land || '#121922'), sea = hexrgb(o.sea || '#05080c'), coast = hexrgb(o.coast || '#46566c');
  field(ctx, w, h, k, (u, v, out, x, y) => {
    const i = (y * fw + x) * 4; const m = wm[i] / 255; const l = smooth(0.62, 0.38, m);
    let r = lerp(sea[0], land[0], l), g = lerp(sea[1], land[1], l), b = lerp(sea[2], land[2], l);
    if (tp && l > 0.3) { const e0 = tp[i], ex = tp[Math.min(i + 4, tp.length - 4)] - tp[Math.max(i - 4, 0)], ey = tp[Math.min(i + fw * 4, tp.length - 4)] - tp[Math.max(i - fw * 4, 0)]; const s = clamp(1 + (ey - ex) * 0.035 * (o.relief || 1) + e0 / 255 * 0.5, 0.55, 1.9); r *= s; g *= s; b *= s; }
    if (nl) { const L = Math.max(0, nl[i + 1] - 10) / 245 * o.lights; r += L * 255; g += L * 190; b += L * 110; }
    const e = smooth(0.6, 0.95, 1 - Math.abs(m - 0.5) * 2) * (o.coastA ?? 1); r = lerp(r, coast[0], e); g = lerp(g, coast[1], e); b = lerp(b, coast[2], e);
    out[0] = r; out[1] = g; out[2] = b;
  });
}
PT.mapBase = mapBase;
function graticule(ctx, mv, step, col = 'rgba(160,190,230,.10)') {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
  for (let lo = Math.ceil((mv.lon0 - mv.spanLon / 2) / step) * step; lo < mv.lon0 + mv.spanLon / 2; lo += step) { const x = mv.X(lo); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mv.h); ctx.stroke(); }
  for (let la = Math.ceil((mv.lat0 - mv.spanLat / 2) / step) * step; la < mv.lat0 + mv.spanLat / 2; la += step) { const y = mv.Y(la); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mv.w, y); ctx.stroke(); }
  ctx.restore();
}
function scaleBar(ctx, mv, km, x, y, col = 'rgba(235,240,248,.8)') { const px = km / mv.kmPx; ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 4); ctx.stroke(); ctx.restore(); label(ctx, km + ' KM', x + px + 5, y - 2, Math.max(8, mv.w / 42), col); }
function plane(ctx, x, y, hdg, s, col) { ctx.save(); ctx.translate(x, y); ctx.rotate(hdg); ctx.scale(s / 24, s / 24); ctx.translate(-12, -12); ctx.fillStyle = col; ctx.fill(new Path2D('M12 2.8c.9 0 1.4.9 1.4 2v4.6l7.1 4.2v1.9l-7.1-2.1v4.4l2.2 1.7v1.6L12 20.2l-3.6.9v-1.6l2.2-1.7v-4.4l-7.1 2.1v-1.9l7.1-4.2V4.8c0-1.1.5-2 1.4-2Z')); ctx.restore(); }
function cross(ctx, x, y, r, col, lw = 1.4) { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); ctx.restore(); }
function poly(ctx, pts, close) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); }
Object.assign(PT, { graticule, scaleBar, plane, cross, poly });

/* =====================================================================================
   ORBIT
   ===================================================================================== */
// IR cloud tops of a tropical cyclone with eyewall lightning and the advisory track
PT.ir = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const N = noiseGen(o.seed || 3);
  const C = GE.CYCLONE.at(0); const mv = mapView(C.lat + (o.dy ?? 0.6), C.lon + (o.dx ?? -0.8), o.span || 13, w, h);
  const k = 2, fw = Math.round(w / k), fh = Math.round(h / k); const wm = cropData('water', mv, fw, fh); const col = [0, 0, 0];
  const cl = Math.cos(C.lat * D2R);
  field(ctx, w, h, k, (u, v, out, x, y) => {
    const lat = mv.lat(v * h), lon = mv.lon(u * w); const dx = (lon - C.lon) * cl / 1.7, dy = (lat - C.lat) / 1.7; const r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    const wn = N.fbm(dx * 0.8 + 11, dy * 0.8 + 3, 4);
    const arms = 0.5 + 0.5 * Math.sin(3 * (th - 2.1 * Math.log(r + 0.15)) + wn * 5.5);
    const conv = N.fbm(dx * 1.9 + 4, dy * 1.9 - 2, 5);
    const cdo = smooth(2.3, 0.9, r + (wn - 0.5) * 0.9), eye = smooth(0.16, 0.34, r), wall = Math.exp(-(((r - 0.4) / 0.15) ** 2));
    let c = Math.max(cdo * (0.8 + 0.22 * conv), arms * smooth(7.5, 1.8, r) * (0.3 + 0.7 * conv) * smooth(0.28, 0.62, conv));
    c = Math.max(c, wall * 0.97) * eye;
    const bg = smooth(0.64, 0.86, N.fbm(dx * 0.55 + 40, dy * 0.55 + 9, 5)) * 0.62; c = Math.max(c, bg * (1 - cdo) * smooth(1.5, 4, r));
    c += wall * smooth(0.6, 0.95, N(dx * 8, dy * 8)) * 0.12 + cdo * smooth(0.72, 0.98, N(dx * 5 + 3, dy * 5)) * 0.08;
    const i = (y * fw + x) * 4; const land = 1 - wm[i] / 255;
    irColor(26 - c * 114 + (c < 0.2 ? land * -10 : 0), col);
    const edge = smooth(0.62, 0.95, 1 - Math.abs(wm[i] / 255 - 0.5) * 2) * (c < 0.55 ? 0.9 : 0.35);
    out[0] = lerp(col[0], 236, edge); out[1] = lerp(col[1], 214, edge); out[2] = lerp(col[2], 96, edge);
  });
  graticule(ctx, mv, 5, 'rgba(255,255,255,.16)');
  // advisory track: past (solid dots), forecast (dashed + cone)
  const tr = GE.CYCLONE.track; ctx.save(); ctx.lineWidth = Math.max(1.2, w / 260);
  const P = (q) => [mv.X(q[2]), mv.Y(q[1])];
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; poly(ctx, tr.filter((q) => q[0] <= 0).map(P)); ctx.stroke();
  ctx.setLineDash([4, 4]); poly(ctx, tr.filter((q) => q[0] >= 0).map(P)); ctx.stroke(); ctx.setLineDash([]);
  const fut = tr.filter((q) => q[0] >= 0); const L = [], Rr = [];
  for (let i = 0; i < fut.length; i++) { const q = fut[i], n = fut[Math.min(i + 1, fut.length - 1)], p0 = fut[Math.max(i - 1, 0)]; const b = geo.bearing(p0[1], p0[2], n[1], n[2]); const km = GE.CYCLONE.cone(q[0]); const a = geo.dest(q[1], q[2], b - Math.PI / 2, km), c2 = geo.dest(q[1], q[2], b + Math.PI / 2, km); L.push([mv.X(a[1]), mv.Y(a[0])]); Rr.push([mv.X(c2[1]), mv.Y(c2[0])]); }
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; poly(ctx, [...L, ...Rr.reverse()], true); ctx.stroke();
  for (const q of tr) { const [x, y] = P(q); ctx.beginPath(); ctx.arc(x, y, q[0] === 0 ? w / 70 : w / 150, 0, TAU); ctx.fillStyle = q[0] < 0 ? '#fff' : q[0] === 0 ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,.4)'; ctx.fill(); if (q[0] === 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); } }
  ctx.restore();
  // lightning in the eyewall and bands
  const R = rng(o.seed || 5); const cx0 = mv.X(C.lon), cy0 = mv.Y(C.lat); const pxDeg = w / mv.spanLon;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < (o.flashes ?? 34); i++) { const rr = (i < 12 ? 0.35 + R() * 0.25 : 0.7 + R() * 3.2) * 1.7, a = R() * TAU; const x = cx0 + Math.cos(a) * rr * pxDeg, y = cy0 - Math.sin(a) * rr * pxDeg; glow(ctx, x, y, w / (i < 4 ? 9 : 26), 'rgba(200,230,255,A)', i < 4 ? 0.55 : 0.4); cross(ctx, x, y, w / 90, 'rgba(255,255,255,.95)', 1.2); }
  ctx.restore();
  label(ctx, 'IR 10.4 µm', w * 0.05, h * PT.topY, Math.max(9, w / 34), 'rgba(255,255,255,.85)');
  // enhancement legend
  const lx = w * 0.6, ly = h * PT.botY, lw = w * 0.34, lh = Math.max(4, h / 90);
  for (let i = 0; i < 60; i++) { irColor(10 - (i / 59) * 100, col); ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; ctx.fillRect(lx + (i / 60) * lw, ly, lw / 60 + 0.5, lh); }
  label(ctx, '+10', lx, ly - lh, Math.max(7, w / 48), 'rgba(255,255,255,.7)'); label(ctx, '−90 °C', lx + lw, ly - lh, Math.max(7, w / 48), 'rgba(255,255,255,.7)', 'right');
};

// ISS external camera: the night side raycast from 418 km, airglow on the limb, truss in frame
PT.isscam = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const lat0 = o.lat ?? 25.5, lon0 = o.lon ?? 31.0; const altKm = 418;
  const reg = mapView(lat0 + 14, lon0 + 2, 46, 900, 900 * 0.75);
  const RW = 900, RH = Math.round(900 * 0.75); const night = cropData('night', reg, RW, RH), clouds = cropData('clouds', reg, RW, RH), day = cropData('day', reg, RW, RH);
  const en = geo.enu(lat0, lon0); const eye = geo.vec(lat0, lon0, altKm); const hd = (o.hdg ?? 8) * D2R, pitch = (o.pitch ?? 24) * D2R;
  const fwdH = v3.add(v3.scale(en.north, Math.cos(hd)), v3.scale(en.east, Math.sin(hd)));
  const fwd = v3.norm(v3.add(v3.scale(fwdH, Math.cos(pitch)), v3.scale(en.up, -Math.sin(pitch))));
  const right = v3.norm(v3.cross(fwd, en.up)), up = v3.cross(right, fwd); const tanF = Math.tan((o.fov ?? 64) * D2R / 2), asp = w / h;
  const N = noiseGen(31); const R2 = rng(4);
  const samp = (D, lat, lon) => { const x = clamp(Math.round(((lon - (reg.lon0 - reg.spanLon / 2)) / reg.spanLon) * RW), 0, RW - 1), y = clamp(Math.round((((reg.lat0 + reg.spanLat / 2) - lat) / reg.spanLat) * RH), 0, RH - 1); return (y * RW + x) * 4; };
  field(ctx, w, h, 2, (u, v, out) => {
    const sx = (u * 2 - 1) * tanF * asp, sy = (1 - v * 2) * tanF; const d = v3.norm(v3.add(fwd, v3.add(v3.scale(right, sx), v3.scale(up, sy))));
    const b = v3.dot(eye, d), c = v3.dot(eye, eye) - 1, disc = b * b - c;
    if (disc > 0 && -b - Math.sqrt(disc) > 0) {
      const t = -b - Math.sqrt(disc); const p = v3.madd(eye, d, t); const [la, lo] = geo.ll(p); const i = samp(null, la, lo);
      const graz = clamp(-v3.dot(d, v3.norm(p)), 0, 1); const haze = Math.pow(1 - graz, 3);
      const L = Math.pow(night[i + 1] / 255, 1.25) * 1.5; const cl = clouds[i] / 255;
      out[0] = clamp(L * 255 * 1.05 + day[i] * 0.03 + cl * 14 + haze * 24, 0, 255); out[1] = clamp(L * 190 + day[i + 1] * 0.035 + cl * 18 + haze * 34, 0, 255); out[2] = clamp(L * 95 + day[i + 2] * 0.05 + cl * 26 + haze * 56, 0, 255);
      const lit = (1 - cl * 0.6); out[0] *= lit; out[1] *= lit; out[2] *= lit; out[0] += cl * 10; out[1] += cl * 12; out[2] += cl * 20;
    } else {
      const tc = Math.max(0, -b); const cp = v3.madd(eye, d, tc); const a = (v3.len(cp) - 1) * EARTH_KM;
      const glowG = Math.exp(-(((a - 92) / 9) ** 2)) * 0.95, glowR = Math.exp(-(((a - 110) / 14) ** 2)) * 0.35, sc = Math.exp(-Math.max(0, a) / 18) * 0.55;
      out[0] = clamp(glowR * 150 + sc * 40, 0, 255); out[1] = clamp(glowG * 150 + sc * 70, 0, 255); out[2] = clamp(glowG * 70 + sc * 120 + 6, 0, 255);
      if (a > 140 && R2() < 0.006) { const s = 120 + R2() * 135; out[0] = s; out[1] = s; out[2] = s + 10; }
    }
  });
  // a lightning flash under cloud near the horizon
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, w * 0.28, h * 0.36, w * 0.12, 'rgba(170,200,255,A)', 0.7); glow(ctx, w * 0.31, h * 0.37, w * 0.05, 'rgba(240,248,255,A)', 0.8); ctx.restore();
  // truss & solar array in the corner, rim-lit
  ctx.save(); ctx.translate(w * 0.98, h * 0.02); ctx.rotate(0.42); ctx.fillStyle = '#07080b';
  ctx.fillRect(-w * 0.62, -h * 0.07, w * 0.9, h * 0.1); ctx.strokeStyle = 'rgba(214,170,90,.55)'; ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.moveTo(-w * 0.62 + i * w * 0.056, -h * 0.07); ctx.lineTo(-w * 0.62 + i * w * 0.056, h * 0.03); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,214,140,.7)'; ctx.beginPath(); ctx.moveTo(-w * 0.62, h * 0.03); ctx.lineTo(w * 0.3, h * 0.03); ctx.stroke(); ctx.restore();
  vignette(ctx, w, h, 0.45, 0.4); grain(ctx, w, h, 0.09);
  osd(ctx, `ISS EXT CAM 2 · ${altKm} KM`, w * 0.05, h * PT.topY, Math.max(9, w / 36));
};

// your sky: the station's pass drawn as an arc on an alt-az chart
PT.skychart = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const cx = w / 2, cy = h * 0.47, R = Math.min(w, h) * 0.4;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h)); g.addColorStop(0, '#0d1430'); g.addColorStop(0.55, '#070a18'); g.addColorStop(1, '#020308'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const r = rng(o.seed || 12); ctx.save();
  for (let i = 0; i < 420; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 1.35; const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d; const m = Math.pow(r(), 6); ctx.fillStyle = `rgba(${220 + m * 35},${225 + m * 30},255,${0.25 + m * 0.75})`; ctx.fillRect(x, y, 1 + m * 2, 1 + m * 2); }
  // a dipper-shaped asterism
  const ast = [[-0.62, 0.3], [-0.48, 0.25], [-0.34, 0.29], [-0.22, 0.37], [-0.18, 0.51], [-0.02, 0.53], [0.02, 0.39]].map(([a, b]) => [cx + a * R, cy + b * R]);
  ctx.strokeStyle = 'rgba(160,190,255,.22)'; ctx.lineWidth = 1; poly(ctx, ast); ctx.stroke(); for (const [x, y] of ast) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, w / 200 + 0.8, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = 'rgba(183,156,255,.28)'; ctx.setLineDash([2, 4]);
  for (const k of [1, 2 / 3, 1 / 3]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, TAU); ctx.stroke(); }
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(183,156,255,.6)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
  const fs = Math.max(9, w / 30); for (const [t, a] of [['N', -90], ['E', 0], ['S', 90], ['W', 180]]) label(ctx, t, cx + Math.cos(a * D2R) * (R + fs * 0.9), cy + Math.sin(a * D2R) * (R + fs * 0.9), fs, t === 'N' ? '#FF6A3D' : 'rgba(220,210,255,.8)', 'center');
  label(ctx, '30°', cx + 3, cy - R * 2 / 3 + 7, fs * 0.72, 'rgba(183,156,255,.6)'); label(ctx, '60°', cx + 3, cy - R / 3 + 7, fs * 0.72, 'rgba(183,156,255,.6)');
  // the pass: rises WSW, culminates ~54°, sets ENE
  const az0 = 245 * D2R, az1 = 62 * D2R, maxEl = (o.max ?? 54) * D2R; const pts = [];
  for (let i = 0; i <= 60; i++) { const f = i / 60; let az = az0 + (((az1 - az0 + TAU * 1.5) % TAU) - Math.PI) * 0 + f * (((az1 - az0 + 3 * Math.PI) % TAU) - Math.PI); const el = Math.sin(f * Math.PI) * maxEl; const rr = R * (1 - el / (Math.PI / 2)); pts.push([cx + Math.sin(az) * rr, cy - Math.cos(az) * rr, f]); }
  ctx.lineWidth = Math.max(2, w / 120); const gr = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[60][0], pts[60][1]); gr.addColorStop(0, 'rgba(201,167,255,.25)'); gr.addColorStop(0.5, 'rgba(230,214,255,1)'); gr.addColorStop(1, 'rgba(201,167,255,.25)'); ctx.strokeStyle = gr; poly(ctx, pts); ctx.stroke();
  const p0 = o.at ?? Date.now() + 3.2 * 3600000;
  for (const k of [0, 20, 30, 40, 60]) { const [x, y] = pts[k]; ctx.fillStyle = '#E6D6FF'; ctx.beginPath(); ctx.arc(x, y, k === 30 ? w / 60 : w / 120, 0, TAU); ctx.fill(); if (k % 20 === 0 || k === 30) label(ctx, fmt.hm(p0 + (k / 60) * 6.5 * 60000), x + 7, y - 9, fs * 0.8, 'rgba(240,232,255,.9)'); }
  ctx.globalCompositeOperation = 'lighter'; glow(ctx, pts[30][0], pts[30][1], w / 10, 'rgba(200,170,255,A)', 0.55); ctx.restore();
  // moon
  ctx.save(); ctx.translate(cx + R * 0.62, cy + R * 0.45); ctx.fillStyle = '#E8E4D8'; ctx.beginPath(); ctx.arc(0, 0, w / 40, 0, TAU); ctx.fill(); ctx.fillStyle = '#070a18'; ctx.beginPath(); ctx.arc(w / 110, -w / 160, w / 42, 0, TAU); ctx.fill(); ctx.restore();
  label(ctx, `MAX ${Math.round(maxEl * R2D)}°`, pts[30][0], pts[30][1] + fs * 1.6, fs * 0.85, '#E6D6FF', 'center');
};

// long-range tracking camera: launch arc + sunlit "jellyfish" plume in twilight
PT.plume = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const r = rng(o.seed || 21); const N = noiseGen(8);
  const hz = h * 0.78; const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#02040c'); sky.addColorStop(0.45, '#0a1638'); sky.addColorStop(0.78, '#1d3a6a'); sky.addColorStop(0.93, '#5a5e7a'); sky.addColorStop(1, '#c47b4a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz);
  for (let i = 0; i < 260; i++) { const y = r() * hz * 0.7; ctx.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.6 * (1 - y / hz)})`; ctx.fillRect(r() * w, y, 1, 1); }
  // arc: pad at lower left, pitching over to the right
  const pad = [w * 0.16, hz - 2]; const top = [w * 0.66, h * 0.22]; const ctrl = [w * 0.2, h * 0.18];
  const B = (t) => [(1 - t) ** 2 * pad[0] + 2 * (1 - t) * t * ctrl[0] + t * t * top[0], (1 - t) ** 2 * pad[1] + 2 * (1 - t) * t * ctrl[1] + t * t * top[1]];
  // sunlit plume (behind the arc): dome expanding up/right, iridescent rim
  const pc = B(0.86); ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) { const t = 0.55 + (i / 90) * 0.45; const p = B(t); const s = (t - 0.55) * w * 0.95; const a = (0.022 + 0.02 * N(i * 0.3, 2)) * (t > 0.7 ? 1 : (t - 0.55) / 0.15);
    const g = ctx.createRadialGradient(p[0] + s * 0.25, p[1] - s * 0.2, s * 0.05, p[0] + s * 0.25, p[1] - s * 0.2, s * 0.85); g.addColorStop(0, `rgba(210,235,255,${a * 1.2})`); g.addColorStop(0.55, `rgba(120,190,255,${a * 0.7})`); g.addColorStop(0.85, `rgba(255,160,120,${a * 0.35})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
  // jellyfish tendrils
  ctx.strokeStyle = 'rgba(190,225,255,.22)'; ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) { const a = -0.3 + (i / 25) * 2.2; ctx.beginPath(); ctx.moveTo(pc[0], pc[1]); for (let k = 1; k <= 12; k++) { const d = k * w * 0.028; ctx.lineTo(pc[0] + Math.cos(a) * d + N(i, k * 0.4) * 10, pc[1] + Math.sin(a) * d * 0.6 + k * k * 0.5); } ctx.stroke(); }
  ctx.restore();
  // the long-exposure streak
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (const [lw, col] of [[w / 22, 'rgba(255,120,40,.10)'], [w / 50, 'rgba(255,150,60,.35)'], [w / 120, 'rgba(255,220,170,.95)'], [w / 300, 'rgba(255,255,255,1)']]) {
    ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.beginPath(); for (let i = 0; i <= 80; i++) { const t = i / 80; const p = B(t * 0.88); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.stroke(); }
  glow(ctx, pad[0], pad[1], w * 0.2, 'rgba(255,150,70,A)', 0.55); ctx.restore();
  // coast: land silhouette with lights, water reflecting the streak
  ctx.fillStyle = '#040508'; ctx.beginPath(); ctx.moveTo(0, hz); for (let x = 0; x <= w; x += 6) ctx.lineTo(x, hz - 3 - N.fbm(x / 60, 1, 3) * 12 * (x < w * 0.5 ? 1 : 0.4)); ctx.lineTo(w, hz + 8); ctx.lineTo(0, hz + 8); ctx.fill();
  for (let i = 0; i < 70; i++) { const x = r() * w; ctx.fillStyle = `rgba(255,${190 + r() * 50},${120 + r() * 60},${0.5 + r() * 0.5})`; ctx.fillRect(x, hz - 2 - r() * 6, 1.4, 1.4); }
  const wg = ctx.createLinearGradient(0, hz, 0, h); wg.addColorStop(0, '#0d1424'); wg.addColorStop(1, '#030407'); ctx.fillStyle = wg; ctx.fillRect(0, hz + 6, w, h - hz);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let y = hz + 8; y < h; y += 2) { const f = (y - hz) / (h - hz); const jit = (N(y * 0.2, 3) - 0.5) * 18 * f; ctx.fillStyle = `rgba(255,140,60,${0.35 * (1 - f)})`; ctx.fillRect(pad[0] - 4 - f * 10 + jit, y, 8 + f * 22, 1.4); ctx.fillStyle = `rgba(150,190,255,${0.08 * (1 - f)})`; ctx.fillRect(w * 0.5 + jit * 2, y, w * 0.3, 1); } ctx.restore();
  vignette(ctx, w, h, 0.4); grain(ctx, w, h, 0.1);
  osd(ctx, 'TRK CAM 3 · 400 MM · LONG EXPOSURE', w * 0.05, h * PT.topY, Math.max(8, w / 40), 'rgba(255,255,255,.8)');
};

// active fire seen from orbit: hillshaded terrain, burn scar, front, hotspot pixels, smoke plume
PT.firesat = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const N = noiseGen(o.seed || 17); const s = 2.1 / w;
  const scarC = [w * 0.62, h * 0.6], scarR = w * 0.26; const front = [];
  const H = (x, y) => N.ridge(x * s, y * s, 5) * 0.9 + N.fbm(x * s * 0.4 + 5, y * s * 0.4, 3) * 0.6;
  const scarAt = (x, y) => { const dx = x - scarC[0], dy = (y - scarC[1]) * 1.35; const a = Math.atan2(dy, dx); const rr = scarR * (0.75 + 0.45 * N(Math.cos(a) * 1.4 + 3, Math.sin(a) * 1.4 + 7)); return Math.hypot(dx, dy) / rr; };
  field(ctx, w, h, 2, (u, v, out) => {
    const x = u * w, y = v * h; const e = 2.2; const hc = H(x, y), hx = H(x + e, y), hy = H(x, y + e); const shade = clamp(0.82 + (hc - hx) * 15 - (hc - hy) * 11, 0.45, 1.35);
    const veg = smooth(0.42, 0.7, N.fbm(x * s * 1.8 + 30, y * s * 1.8, 4));
    let r = lerp(150, 62, veg), g = lerp(132, 82, veg), b = lerp(88, 48, veg);
    const fld = N(x * s * 6 + 70, y * s * 6) > 0.72 && hc < 0.55 ? 1 : 0; if (fld) { r = 168; g = 150; b = 98; }
    r *= shade; g *= shade; b *= shade;
    const sc = scarAt(x, y); const burnt = smooth(1.02, 0.94, sc); const rim = Math.exp(-(((sc - 1) / 0.05) ** 2));
    r = lerp(r, 34 + hc * 18, burnt); g = lerp(g, 30 + hc * 14, burnt); b = lerp(b, 28 + hc * 12, burnt);
    r = lerp(r, 92, rim * 0.6); g = lerp(g, 60, rim * 0.6); b = lerp(b, 40, rim * 0.6);
    out[0] = r; out[1] = g; out[2] = b;
  });
  // river & roads & a village
  ctx.save(); ctx.strokeStyle = 'rgba(40,70,90,.9)'; ctx.lineWidth = w / 120; ctx.beginPath(); for (let i = 0; i <= 40; i++) { const t = i / 40; const x = t * w, y = h * 0.18 + Math.sin(t * 5) * h * 0.05 + N(t * 4, 9) * h * 0.08; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  ctx.strokeStyle = 'rgba(225,215,190,.45)'; ctx.lineWidth = w / 260; for (const k of [0, 1, 2]) { ctx.beginPath(); for (let i = 0; i <= 30; i++) { const t = i / 30; const x = t * w, y = h * (0.35 + k * 0.28) + Math.sin(t * 3 + k) * h * 0.06 + N(t * 3, k * 5) * 20; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  const vr = rng(3); for (let i = 0; i < 55; i++) { ctx.fillStyle = `rgba(${200 + vr() * 40},${190 + vr() * 30},${170 + vr() * 30},.8)`; ctx.fillRect(w * 0.2 + vr.gauss() * w * 0.04, h * 0.42 + vr.gauss() * h * 0.03, 2, 2); }
  ctx.restore();
  // fire front on the downwind (west) edge + hotspot pixels
  const R = rng(9); ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 160; i++) { const a = Math.PI * (0.55 + R() * 0.95); let lo = 0.5, hi = 1.6; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; const x = scarC[0] + Math.cos(a) * scarR * m, y = scarC[1] + (Math.sin(a) * scarR * m) / 1.35; if (scarAt(x, y) < 1) lo = m; else hi = m; } const x = scarC[0] + Math.cos(a) * scarR * lo, y = scarC[1] + (Math.sin(a) * scarR * lo) / 1.35; front.push([x, y]); glow(ctx, x, y, w / 36, 'rgba(255,90,20,A)', 0.4); }
  for (const [x, y] of front) { const q = R(); const ps = Math.max(2, w / 110); ctx.fillStyle = q > 0.8 ? 'rgba(255,240,150,.95)' : q > 0.4 ? 'rgba(255,140,30,.9)' : 'rgba(230,40,20,.85)'; ctx.fillRect(Math.round(x / ps) * ps, Math.round(y / ps) * ps, ps, ps); }
  ctx.restore();
  // smoke: drifts WNW from the front
  const src = [scarC[0] - scarR * 0.85, scarC[1] - scarR * 0.1], dir = v3.norm([-1, -0.55, 0]);
  field(ctx, w, h, 3, (u, v, out) => {
    const x = u * w - src[0], y = v * h - src[1]; const al = x * dir[0] + y * dir[1], ac = -x * dir[1] + y * dir[0]; if (al < -20) { out[3] = 0; return; }
    const wd = 16 + Math.max(0, al) * 0.5; const n = N.fbm(al / 46 + 4, ac / 22, 5); const dn = Math.exp(-((ac / wd) ** 2) * (1.4 - n)) * smooth(-20, 30, al) * Math.exp(-Math.max(0, al) / (w * 2.6)) * (0.5 + 0.8 * n);
    const a = clamp(dn * 1.1, 0, 0.92); out[0] = lerp(215, 160, n); out[1] = lerp(212, 160, n); out[2] = lerp(206, 170, n); out[3] = a * 255;
  }, true);
  label(ctx, 'VIIRS-CLASS 375 M · FRP 840 MW', w * 0.05, h * PT.topY, Math.max(8, w / 40), 'rgba(255,255,255,.85)');
  const mv = { kmPx: 18 / w, w }; scaleBar(ctx, mv, 5, w * 0.06, h * PT.botY);
  // wind arrow
  ctx.save(); ctx.translate(w * 0.86, h * PT.botY - 6); ctx.rotate(Math.atan2(dir[1], dir[0])); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.lineTo(8, -5); ctx.moveTo(14, 0); ctx.lineTo(8, 5); ctx.stroke(); ctx.restore();
};

// synthetic-aperture radar pass over an anchorage: speckle, bright hull returns with sidelobes
PT.sar = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const N = noiseGen(o.seed || 23); const R = rng(o.seed || 23);
  const coast = (v) => w * (0.3 + 0.08 * Math.sin(v * 5) + 0.06 * N(v * 4, 2));
  field(ctx, w, h, 1.5, (u, v, out) => {
    const x = u * w, cxl = coast(v); const sea = smooth(cxl - 3, cxl + 3, x); const sp = -Math.log(Math.max(1e-4, R())) * 0.55;
    const fieldsTex = N(u * 26, v * 26) > 0.55 ? 0.22 : 0; const town = Math.exp(-(((u - 0.12) / 0.08) ** 2 + ((v - 0.62) / 0.12) ** 2)) * (N(u * 90, v * 90) > 0.5 ? 0.9 : 0.25);
    const land = (0.26 + N.fbm(u * 10, v * 10, 5) * 0.36 + fieldsTex + town) * (0.55 + sp * 0.6);
    const wave = (0.035 + N.fbm(u * 24 + 2, v * 6, 3) * 0.05) * (0.3 + sp * 1.3) + Math.exp(-(((x - cxl) / 7) ** 2)) * 0.25;
    const g = clamp(lerp(land, wave, sea), 0, 1) * 255; out[0] = g * 0.93; out[1] = g * 0.97; out[2] = g;
  }, false);
  // dredged channel + breakwater
  ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = w / 60; ctx.beginPath(); ctx.moveTo(coast(0.05) + 4, 0); ctx.lineTo(w * 0.42, h * 0.45); ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(coast(0.5), h * 0.5); ctx.lineTo(w * 0.5, h * 0.47); ctx.stroke(); ctx.restore();
  // anchorage: hull returns with cross-shaped sidelobes
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; const n = o.ships || 48;
  for (let i = 0; i < n; i++) { const cl = i % 3; const x = w * ([0.62, 0.78, 0.56][cl] + R.gauss() * 0.08), y = h * ([0.3, 0.55, 0.78][cl] + R.gauss() * 0.07); const L = w / 30 * (0.6 + R() * 0.9); const a = 0.4 + R() * 0.5; ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fillRect(-L / 2, -1.6, L, 3.2); ctx.restore(); ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(x - L * 1.6, y - 0.5, L * 3.2, 1); ctx.fillRect(x - 0.5, y - L * 1.3, 1, L * 2.6); glow(ctx, x, y, L * 0.7, 'rgba(255,255,255,A)', 0.22); }
  // one moving ship with a wake and Doppler offset
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(w * 0.44, h * 0.18, w / 22, 3); ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * 0.44, h * 0.18 + 1); ctx.lineTo(w * 0.3, h * 0.12); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(w * 0.47, h * 0.24, w / 22, 2);
  ctx.restore();
  label(ctx, 'SAR · C-BAND · VV · 10 M', w * 0.05, h * PT.topY, Math.max(8, w / 40), 'rgba(255,255,255,.85)');
  scaleBar(ctx, { kmPx: 22 / w, w }, 5, w * 0.06, h * PT.botY);
};

/* =====================================================================================
   SKY
   ===================================================================================== */
// radar reflectivity: a bowing squall line crossing a city's street grid, lightning, warning box
PT.radar = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const N = noiseGen(o.seed || 41); const R = rng(o.seed || 41);
  ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, w, h);
  const cores = [[w * 0.62, h * 0.5, w * 0.34], [w * 0.22, h * 0.56, w * 0.22]];
  const urb = (x, y) => Math.max(...cores.map(([cx, cy, r]) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r))));
  field(ctx, w, h, 2, (u, v, out) => { const x = u * w, y = v * h; const k = urb(x, y) * (0.6 + 0.5 * N.fbm(u * 9, v * 9, 3)); out[0] = 10 + k * 22; out[1] = 14 + k * 24; out[2] = 20 + k * 30; });
  // street grid
  ctx.save(); ctx.lineWidth = 1; const step = Math.max(5, w / 60);
  for (let x = 0; x < w; x += step) for (let y = 0; y < h; y += step) { const k = urb(x, y); if (R() > k * 1.3) continue; ctx.strokeStyle = `rgba(170,190,220,${0.06 + k * 0.1})`; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + step, y); ctx.moveTo(x, y); ctx.lineTo(x, y + step); ctx.stroke(); }
  // lakes, river, highways
  ctx.fillStyle = '#0f2236'; for (const [x, y, rx, ry] of [[0.42, 0.22, 0.05, 0.03], [0.86, 0.3, 0.04, 0.06], [0.1, 0.8, 0.05, 0.025]]) { ctx.beginPath(); ctx.ellipse(x * w, y * h, rx * w, ry * h, 0.4, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = 'rgba(70,120,170,.6)'; ctx.lineWidth = w / 200; ctx.beginPath(); for (let i = 0; i <= 50; i++) { const t = i / 50; const x = t * w, y = h * 0.62 + Math.sin(t * 9) * h * 0.03 + N(t * 5, 2) * h * 0.06; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  ctx.strokeStyle = 'rgba(190,205,230,.32)'; ctx.lineWidth = w / 170;
  for (const [x1, y1, x2, y2] of [[0, 0.5, 1, 0.47], [0.62, 0, 0.6, 1], [0.22, 0, 0.25, 1], [0, 0.15, 1, 0.92], [0, 0.9, 1, 0.12]]) { ctx.beginPath(); ctx.moveTo(x1 * w, y1 * h); ctx.lineTo(x2 * w, y2 * h); ctx.stroke(); }
  ctx.beginPath(); ctx.ellipse(w * 0.62, h * 0.5, w * 0.16, h * 0.13, 0, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.ellipse(w * 0.22, h * 0.56, w * 0.1, h * 0.08, 0, 0, TAU); ctx.stroke(); ctx.restore();
  // reflectivity: bowing line (arc), trailing stratiform, isolated cells ahead
  const ac = [w * 0.05, h * 0.5], AR = w * 0.58;
  const col = [0, 0, 0, 0];
  field(ctx, w, h, 3, (u, v, out) => {
    const x = u * w, y = v * h; const dx = x - ac[0], dy = y - ac[1]; const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const span = smooth(1.25, 0.75, Math.abs(a)); const d = (r - AR - Math.cos(a * 2) * w * 0.05) / w;
    const n = N.fbm(x / 26, y / 26, 4), n2 = N(x / 9, y / 9);
    const core = Math.exp(-((d / 0.035) ** 2)) * span * (0.65 + 0.6 * n) * (1 + 0.5 * Math.exp(-((a / 0.22) ** 2)));
    const strat = Math.exp(-(((d + 0.12) / 0.11) ** 2)) * span * (0.5 + 0.7 * n);
    let cell = 0; for (const [cx, cy, cr] of [[0.82, 0.25, 0.04], [0.9, 0.62, 0.03], [0.76, 0.82, 0.035]]) cell = Math.max(cell, Math.exp(-((x - cx * w) ** 2 + (y - cy * h) ** 2) / (cr * w) ** 2) * (0.7 + 0.4 * n2));
    const z = 8 + Math.max(core * 58, strat * 28, cell * 52) + (n2 - 0.5) * 6; dbzColor(z, col); out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = col[3];
  }, false);
  // tornado-warning polygon at the bow apex (harm → hazard red)
  const ap = [ac[0] + AR + w * 0.05, ac[1]]; ctx.save(); ctx.strokeStyle = '#FF3B30'; ctx.lineWidth = Math.max(1.5, w / 160); poly(ctx, [[ap[0] - w * 0.06, ap[1] - h * 0.09], [ap[0] + w * 0.13, ap[1] - h * 0.06], [ap[0] + w * 0.12, ap[1] + h * 0.07], [ap[0] - w * 0.05, ap[1] + h * 0.08]], true); ctx.stroke(); ctx.restore();
  // lightning
  for (let i = 0; i < 40; i++) { const a = (R() - 0.5) * 1.6, rr = AR + (R() - 0.6) * w * 0.07; const x = ac[0] + Math.cos(a) * rr, y = ac[1] + Math.sin(a) * rr; cross(ctx, x, y, w / 110, i % 5 ? 'rgba(255,255,255,.9)' : 'rgba(255,230,0,1)', 1.2); }
  // storm motion
  ctx.save(); ctx.translate(ap[0] + w * 0.16, ap[1] + h * 0.17); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(16, 0); ctx.lineTo(10, -5); ctx.moveTo(16, 0); ctx.lineTo(10, 5); ctx.stroke(); ctx.restore();
  label(ctx, '72 KM/H', ap[0] + w * 0.16, ap[1] + h * 0.21, Math.max(8, w / 44), 'rgba(255,255,255,.85)', 'center');
  for (const [t, x, y] of [['FORT WORTH', 0.22, 0.6], ['DALLAS', 0.62, 0.55], ['ARLINGTON', 0.43, 0.66]]) label(ctx, t, x * w, y * h, Math.max(7, w / 50), 'rgba(220,230,245,.55)', 'center');
  label(ctx, '0.5° REFLECTIVITY · dBZ', w * 0.05, h * PT.topY, Math.max(8, w / 40), 'rgba(255,255,255,.85)');
  const lx = w * 0.05, ly = h * PT.botY; DBZ.forEach(([d, c], i) => { ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(lx + i * (w * 0.035), ly, w * 0.035, Math.max(4, h / 90)); }); label(ctx, '20', lx, ly - 6, Math.max(7, w / 52), 'rgba(255,255,255,.7)'); label(ctx, '75', lx + DBZ.length * w * 0.035, ly - 6, Math.max(7, w / 52), 'rgba(255,255,255,.7)', 'right');
};

// one aircraft squawking 7700: the track turns red where it declared, diverts and descends
PT.track = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const T = o.track;
  const lats = T.pts.map((p) => p[0]).concat(T.div.lat), lons = T.pts.map((p) => p[1]).concat(T.div.lon);
  const la0 = (Math.min(...lats) + Math.max(...lats)) / 2, lo0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const span = Math.max(8, (Math.max(...lons) - Math.min(...lons)) * 1.5, ((Math.max(...lats) - Math.min(...lats)) * 1.6 * w) / h / Math.cos(la0 * D2R));
  const mv = mapView(la0, lo0, span, w, h);
  mapBase(ctx, mv, { lights: 0.9, relief: 0.6, land: '#151c26', sea: '#04070b', coast: '#3a4a60' });
  graticule(ctx, mv, 5);
  const P = T.pts.map(([la, lo]) => [mv.X(lo), mv.Y(la)]); const k = T.sqAt;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, w / 200); ctx.strokeStyle = 'rgba(190,215,240,.75)'; poly(ctx, P.slice(0, k + 1)); ctx.stroke();
  ctx.lineWidth = Math.max(2.2, w / 130); ctx.strokeStyle = '#FF3B30'; ctx.shadowColor = 'rgba(255,59,48,.8)'; ctx.shadowBlur = 10; poly(ctx, P.slice(k)); ctx.stroke(); ctx.shadowBlur = 0;
  // remaining leg to the diversion field
  const cur = P[P.length - 1]; const dv = [mv.X(T.div.lon), mv.Y(T.div.lat)]; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,120,110,.8)'; ctx.beginPath(); ctx.moveTo(cur[0], cur[1]); ctx.quadraticCurveTo((cur[0] + dv[0]) / 2 + w * 0.05, (cur[1] + dv[1]) / 2, dv[0], dv[1]); ctx.stroke(); ctx.setLineDash([]);
  for (const r of [w / 30, w / 18]) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(dv[0], dv[1], r, 0, TAU); ctx.stroke(); }
  ctx.restore();
  label(ctx, T.div.iata, dv[0] + w / 16, dv[1], Math.max(9, w / 30), '#fff');
  const p0 = P[P.length - 2] || P[0]; plane(ctx, cur[0], cur[1], Math.atan2(cur[0] - p0[0], -(cur[1] - p0[1])), Math.max(14, w / 14), '#fff');
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, cur[0], cur[1], w / 6, 'rgba(255,59,48,A)', 0.55); ctx.restore();
  // squawk tag
  const tx = clamp(cur[0] + w * 0.04, 4, w - w * 0.36), ty = clamp(cur[1] - h * 0.12, 4, h * 0.7); ctx.fillStyle = '#FF3B30'; ctx.fillRect(tx, ty, w * 0.3, h * 0.065); label(ctx, 'SQ 7700', tx + w * 0.15, ty + h * 0.034, Math.max(9, w / 26), '#fff', 'center');
  // descent profile inset
  const ix = w * 0.05, iy = h * 0.6, iw = w * 0.42, ih = h * 0.14; ctx.fillStyle = 'rgba(5,8,12,.72)'; ctx.fillRect(ix, iy, iw, ih); ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
  const prof = T.alt; const mx = Math.max(...prof); ctx.beginPath(); prof.forEach((a, i) => { const x = ix + 4 + (i / (prof.length - 1)) * (iw - 8), y = iy + ih - 5 - (a / mx) * (ih - 14); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = '#FF6B61'; ctx.lineWidth = 1.6; ctx.stroke();
  label(ctx, 'ALT ↓ FL370 → FL' + Math.round(prof[prof.length - 1] / 100), ix + 5, iy + 8, Math.max(7, w / 50), 'rgba(255,255,255,.8)');
};

// lightning density over a basin (number card backdrop)
PT.strikes = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const mv = mapView(o.lat ?? 26.5, o.lon ?? -89, o.span ?? 22, w, h);
  mapBase(ctx, mv, { lights: 0.7, land: '#10161e', sea: '#04070b', coast: '#2c3a4c' }); const R = rng(o.seed || 77);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const cells = [[25.6, -88.2, 1.4], [27.4, -91.5, 1.0], [24.4, -84.9, 0.9], [28.6, -86.4, 0.7], [23.2, -92.8, 1.1]];
  for (const [la, lo, s] of cells) for (let i = 0; i < 260 * s; i++) { const x = mv.X(lo + R.gauss() * s), y = mv.Y(la + R.gauss() * s * 0.7); const age = R(); ctx.fillStyle = age < 0.15 ? 'rgba(255,255,255,.95)' : age < 0.5 ? 'rgba(255,230,90,.75)' : 'rgba(255,140,40,.45)'; ctx.fillRect(x, y, age < 0.15 ? 2.2 : 1.6, age < 0.15 ? 2.2 : 1.6); }
  for (const [la, lo] of cells) glow(ctx, mv.X(lo), mv.Y(la), w / 5, 'rgba(255,200,80,A)', 0.18);
  ctx.restore();
};

// GNSS interference: hex bins of degraded integrity, tracks with gaps
PT.gnss = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const mv = mapView(o.lat ?? 56.8, o.lon ?? 21.5, o.span ?? 17, w, h);
  mapBase(ctx, mv, { lights: 0.8, land: '#121821', sea: '#05080c', coast: '#33425a' }); const R = rng(o.seed || 5);
  const hot = [[55.0, 20.5, 1.6], [59.3, 24.2, 1.2], [57.2, 19.0, 0.8]]; const hs = w / 16;
  ctx.save();
  for (let row = 0; row * hs * 0.87 < h + hs; row++) for (let col = 0; col * hs < w + hs; col++) {
    const x = col * hs + (row % 2 ? hs / 2 : 0), y = row * hs * 0.87; const la = mv.lat(y), lo = mv.lon(x);
    let k = 0; for (const [a, b, s] of hot) k = Math.max(k, Math.exp(-(((la - a) / s) ** 2 + ((lo - b) / (s * 1.8)) ** 2)));
    if (k < 0.12) continue; ctx.beginPath(); for (let i = 0; i < 6; i++) { const an = Math.PI / 6 + (i * Math.PI) / 3; ctx.lineTo(x + Math.cos(an) * hs * 0.5, y + Math.sin(an) * hs * 0.5); } ctx.closePath();
    ctx.fillStyle = `rgba(255,${Math.round(150 - k * 110)},${Math.round(60 - k * 40)},${0.12 + k * 0.5})`; ctx.fill(); ctx.strokeStyle = `rgba(255,140,90,${k * 0.5})`; ctx.stroke();
  }
  // airliner tracks: dashed where position integrity drops
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) { const y0 = R() * h, y1 = R() * h; let prevBad = null; for (let s = 0; s < 40; s++) { const t0 = s / 40, t1 = (s + 1) / 40; const x0 = t0 * w, x1 = t1 * w, ya = lerp(y0, y1, t0), yb = lerp(y0, y1, t1); const la = mv.lat(ya), lo = mv.lon(x0); let k = 0; for (const [a, b, sd] of hot) k = Math.max(k, Math.exp(-(((la - a) / sd) ** 2 + ((lo - b) / (sd * 1.8)) ** 2))); const bad = k > 0.4; ctx.strokeStyle = bad ? 'rgba(255,120,90,.0)' : 'rgba(150,205,255,.55)'; if (!bad) { ctx.beginPath(); ctx.moveTo(x0, ya); ctx.lineTo(x1, yb); ctx.stroke(); } if (bad && s % 2 === 0) { ctx.fillStyle = 'rgba(255,170,140,.7)'; ctx.fillRect(x0, ya + (R() - 0.5) * 6, 1.5, 1.5); } } }
  ctx.restore();
  label(ctx, 'NIC/NACp ≤ 4', w * 0.05, h * PT.topY, Math.max(8, w / 40), 'rgba(255,255,255,.85)');
};

// helicopter school: the circuit flown again and again over the field
PT.heli = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const N = noiseGen(11);
  field(ctx, w, h, 2, (u, v, out) => { const n = N.fbm(u * 7, v * 7, 4), f = N(u * 22, v * 22); const g = f > 0.6 ? 1 : 0; out[0] = lerp(58, 92, n) + g * 18; out[1] = lerp(72, 98, n) + g * 22; out[2] = lerp(42, 60, n); });
  // tree lines & roads
  ctx.save(); ctx.fillStyle = 'rgba(25,40,22,.55)'; const R = rng(3); for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.ellipse(R() * w, R() * h, w * 0.06 * R(), h * 0.012, R() * 3, 0, TAU); ctx.fill(); } ctx.restore();
  ctx.save(); ctx.translate(w * 0.5, h * 0.5); ctx.rotate(0.06);
  ctx.fillStyle = '#6d6f70'; ctx.fillRect(-w * 0.36, -h * 0.025, w * 0.72, h * 0.05); ctx.save(); ctx.rotate(1.1); ctx.fillStyle = '#6a6c6d'; ctx.fillRect(-w * 0.3, -h * 0.02, w * 0.6, h * 0.04); ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(-w * 0.34, 0); ctx.lineTo(w * 0.34, 0); ctx.stroke(); ctx.setLineDash([]);
  for (let i = 0; i < 12; i++) { ctx.fillStyle = '#7d7f80'; ctx.fillRect(-w * 0.3 + i * w * 0.05, h * 0.08, w * 0.035, w * 0.035); }
  // circuit laps (oldest faint)
  const n = o.laps ?? 14; const cw = w * 0.62, ch = h * 0.42;
  for (let i = 0; i < n; i++) { const j = i / n; const off = (hash01(i + 1) - 0.5) * w * 0.03; ctx.strokeStyle = `rgba(155,240,150,${0.12 + j * 0.65})`; ctx.lineWidth = i === n - 1 ? 2.4 : 1.1; const r = w * 0.06; const x = -cw / 2 + off, y = -ch / 2 - h * 0.02 + off; ctx.beginPath(); ctx.roundRect(x, y, cw, ch, r); ctx.stroke(); }
  // helicopter
  const hx = cw / 2 - w * 0.02, hy = -ch * 0.1; ctx.fillStyle = '#E8FFE4'; ctx.beginPath(); ctx.arc(hx, hy, w / 60, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(232,255,228,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hx, hy, w / 22, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy + w / 14); ctx.stroke();
  ctx.restore();
  const fs = Math.max(7, w / 44); for (const [t, x, y] of [['UPWIND', 0.5, 0.25], ['DOWNWIND', 0.5, 0.79], ['BASE', 0.12, 0.52], ['CROSSWIND', 0.88, 0.48]]) label(ctx, t, x * w, y * h, fs, 'rgba(225,255,220,.75)', 'center');
  vignette(ctx, w, h, 0.35);
};

/* =====================================================================================
   GROUND
   ===================================================================================== */
// shake map: intensity bands over the coast, epicentre, stations
PT.shake = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const Q = GE.BIGQ; const mv = mapView(Q.lat + 0.6, Q.lon - 1.6, o.span ?? 6.5, w, h);
  mapBase(ctx, mv, { relief: 1.1, land: '#161d26', sea: '#05080c', coast: '#5a6e88', lights: 0.6 });
  const fw = Math.round(w / 2); const wm = cropData('water', mv, fw, Math.round(h / 2)); const strike = 0.35;
  const mmi = (la, lo) => { const dx = (lo - Q.lon) * Math.cos(Q.lat * D2R), dy = la - Q.lat; const a = dx * Math.cos(strike) + dy * Math.sin(strike), b = -dx * Math.sin(strike) + dy * Math.cos(strike); const d = Math.hypot(a / 1.7, b) * 111; return clamp(8.2 - 2.1 * Math.log10(1 + d / 9) * 1.55, 1, 9); };
  field(ctx, w, h, 2, (u, v, out, x, y) => { const la = mv.lat(v * h), lo = mv.lon(u * w); const I = mmi(la, lo); const band = Math.floor(I); const t = clamp((band - 1) / 7, 0, 1); const j = Math.round(t * 255) * 3; const sea = wm[(y * fw + x) * 4] / 255 > 0.5; out[0] = LUT.mmi[j]; out[1] = LUT.mmi[j + 1]; out[2] = LUT.mmi[j + 2]; out[3] = I < 4 ? 0 : (sea ? 50 : 120) + (I - 4) * 26; }, true);
  // contour lines
  ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.35)';
  for (const I of [4, 5, 6, 7]) { const d = 9 * (Math.pow(10, (8.2 - I) / (2.1 * 1.55)) - 1) / 111; ctx.beginPath(); for (let k = 0; k <= 72; k++) { const an = (k / 72) * TAU; const a = Math.cos(an) * d * 1.7, b = Math.sin(an) * d; const dx = a * Math.cos(strike) - b * Math.sin(strike), dy = a * Math.sin(strike) + b * Math.cos(strike); const x = mv.X(Q.lon + dx / Math.cos(Q.lat * D2R)), y = mv.Y(Q.lat + dy); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  ctx.restore();
  // rupture
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; const e = 0.45; ctx.beginPath(); ctx.moveTo(mv.X(Q.lon - Math.cos(strike) * e), mv.Y(Q.lat - Math.sin(strike) * e)); ctx.lineTo(mv.X(Q.lon + Math.cos(strike) * e), mv.Y(Q.lat + Math.sin(strike) * e)); ctx.stroke(); ctx.restore();
  // stations
  const R = rng(14); for (let i = 0; i < 46; i++) { const la = Q.lat + R.gauss() * 1.3 + 0.5, lo = Q.lon - 1.2 + R.gauss() * 1.2; const m = cropData('water', mv, fw, Math.round(h / 2)); const x = mv.X(lo), y = mv.Y(la); if (x < 0 || y < 0 || x >= w || y >= h) continue; if (m[(Math.floor(y / 2) * fw + Math.floor(x / 2)) * 4] > 128) continue; const I = mmi(la, lo) + R.gauss() * 0.4; const j = Math.round(clamp((I - 1) / 7, 0, 1) * 255) * 3; ctx.fillStyle = `rgb(${LUT.mmi[j]},${LUT.mmi[j + 1]},${LUT.mmi[j + 2]})`; ctx.strokeStyle = 'rgba(0,0,0,.7)'; const s = w / 70; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.9, y + s * 0.6); ctx.lineTo(x - s * 0.9, y + s * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  // epicentre star
  const ex = mv.X(Q.lon), ey = mv.Y(Q.lat); ctx.save(); ctx.translate(ex, ey); ctx.fillStyle = '#FF3B30'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? w / 50 : w / 22; const a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  for (const [t, la, lo] of [['SENDAI', 38.27, 140.87], ['FUKUSHIMA', 37.75, 140.47], ['MITO', 36.37, 140.47], ['TOKYO', 35.68, 139.69]]) { const x = mv.X(lo), y = mv.Y(la); ctx.fillStyle = '#fff'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); label(ctx, t, x - 5, y, Math.max(7, w / 48), 'rgba(235,240,248,.85)', 'right'); }
  const lx = w * 0.05, ly = h * PT.botY; for (let i = 2; i <= 8; i++) { const j = Math.round(((i - 1) / 7) * 255) * 3; ctx.fillStyle = `rgb(${LUT.mmi[j]},${LUT.mmi[j + 1]},${LUT.mmi[j + 2]})`; ctx.fillRect(lx + (i - 2) * w * 0.05, ly, w * 0.05, Math.max(4, h / 90)); label(ctx, ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][i], lx + (i - 2) * w * 0.05 + w * 0.025, ly - 7, Math.max(6, w / 60), 'rgba(255,255,255,.7)', 'center'); }
  label(ctx, 'MMI · INSTRUMENTAL INTENSITY', w * 0.05, h * PT.topY, Math.max(8, w / 42), 'rgba(255,255,255,.85)');
};

// crowd density inside and around a stadium, top-down, with an egress crush point
PT.stadium = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const R = rng(o.seed || 66); const N = noiseGen(66);
  ctx.fillStyle = '#0b0e12'; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.fillStyle = '#12161c'; for (let i = 0; i < 70; i++) { const x = R() * w, y = R() * h; if (Math.hypot((x - w / 2) / w, (y - h / 2) / h) < 0.36) continue; ctx.fillRect(x, y, w * (0.04 + R() * 0.07), h * (0.03 + R() * 0.05)); } ctx.restore();
  const cx = w / 2, cy = h * 0.48, RX = w * 0.36, RY = h * 0.3;
  ctx.fillStyle = '#1b2028'; ctx.beginPath(); ctx.ellipse(cx, cy, RX * 1.08, RY * 1.08, 0, 0, TAU); ctx.fill();
  // intensity buffer of people
  const k = 2, fw = Math.round(w / k), fh = Math.round(h / k); const I = new Float32Array(fw * fh);
  const splat = (x, y, s, a) => { const r = Math.ceil(s * 2.5), x0 = Math.round(x / k), y0 = Math.round(y / k); for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const X = x0 + i, Y = y0 + j; if (X < 0 || Y < 0 || X >= fw || Y >= fh) continue; I[Y * fw + X] += a * Math.exp(-(i * i + j * j) / (s * s)); } };
  for (let n = 0; n < 2600; n++) { const a = R() * TAU, t = 0.55 + R() * 0.45; splat(cx + Math.cos(a) * RX * t, cy + Math.sin(a) * RY * t, 1.6, 0.35 + 0.5 * N(Math.cos(a) * 3, Math.sin(a) * 3)); }
  const gates = [[-0.25, 'A'], [1.2, 'B'], [Math.PI * 0.62, 'C'], [Math.PI * 1.25, 'D']];
  for (const [ga, gl] of gates) { const gx = cx + Math.cos(ga) * RX * 1.08, gy = cy + Math.sin(ga) * RY * 1.08; const crush = gl === 'C'; for (let n = 0; n < (crush ? 900 : 260); n++) { const d = Math.pow(R(), crush ? 1.8 : 1) * w * (crush ? 0.2 : 0.3); const sp = R.gauss() * (crush ? 0.18 : 0.12); splat(gx + Math.cos(ga + sp) * d, gy + Math.sin(ga + sp) * d, 1.8, crush ? 0.6 : 0.3); } }
  const c2 = mk(fw, fh), cx2 = c2.getContext('2d'); const id = cx2.createImageData(fw, fh);
  for (let i = 0; i < fw * fh; i++) { const v = clamp(I[i] / 3.2, 0, 1); const j = Math.round(v * 255) * 3; id.data[i * 4] = LUT.inferno[j]; id.data[i * 4 + 1] = LUT.inferno[j + 1]; id.data[i * 4 + 2] = LUT.inferno[j + 2]; id.data[i * 4 + 3] = v < 0.04 ? 0 : clamp(v * 900, 0, 235); }
  cx2.putImageData(id, 0, 0); ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c2, 0, 0, w, h); ctx.restore();
  // pitch
  ctx.save(); ctx.fillStyle = '#16301e'; ctx.fillRect(cx - RX * 0.42, cy - RY * 0.42, RX * 0.84, RY * 0.84); ctx.strokeStyle = 'rgba(220,255,220,.35)'; ctx.lineWidth = 1; ctx.strokeRect(cx - RX * 0.42, cy - RY * 0.42, RX * 0.84, RY * 0.84); ctx.beginPath(); ctx.moveTo(cx, cy - RY * 0.42); ctx.lineTo(cx, cy + RY * 0.42); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, RY * 0.12, 0, TAU); ctx.stroke(); ctx.restore();
  for (const [ga, gl] of gates) { const gx = cx + Math.cos(ga) * RX * 1.16, gy = cy + Math.sin(ga) * RY * 1.16; label(ctx, 'GATE ' + gl, gx, gy, Math.max(7, w / 46), gl === 'C' ? '#fff' : 'rgba(230,236,245,.6)', 'center'); }
  const ga = gates[2][0]; const hx = cx + Math.cos(ga) * RX * 1.3, hy = cy + Math.sin(ga) * RY * 1.3; ctx.save(); ctx.strokeStyle = '#FF3B30'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, w / 13, 0, TAU); ctx.stroke(); ctx.restore();
  label(ctx, '4.6 P/M²', hx, hy + w / 9, Math.max(9, w / 30), '#FF6B61', 'center');
  label(ctx, 'CROWD DENSITY · P/M²', w * 0.05, h * PT.topY, Math.max(8, w / 42), 'rgba(255,255,255,.85)');
};

/* ---------- CCTV-style scenes (animated: static base cached, dynamic layer per frame) ---------- */
const SCN = (PT.scenes = {});
function cctvOSD(ctx, w, h, t, o) {
  const fs = Math.max(8, Math.round(w / 34)); const y0 = h * (o.osdY ?? PT.osdY), y1 = h * (o.osdB ?? PT.osdB);
  osd(ctx, o.cam || 'CAM 0412', w * 0.045, y0, fs); osd(ctx, PT.stamp(o.at ?? Date.now()), w * 0.955, y0, fs, 'right');
  if (o.place) osd(ctx, o.place, w * 0.045, y1 - fs, fs * 0.9);
  if (o.rec !== false && Math.floor(t * 1.2) % 2 === 0) { ctx.fillStyle = '#FF3B30'; ctx.beginPath(); ctx.arc(w * 0.955 - fs * 0.3, y1 - fs * 0.5, fs * 0.32, 0, TAU); ctx.fill(); osd(ctx, 'REC', w * 0.955 - fs * 0.9, y1 - fs, fs * 0.9, 'right'); }
}
PT.osdY = 0.115; PT.osdB = 0.87; PT.topY = 0.125; PT.botY = 0.86;
PT.cctvOSD = cctvOSD;

// harbour at night: gantry cranes, a lit ship, fog, reflections, rain before a typhoon
SCN.harbour = {
  base(w, h, o) {
    const c = mk(w, h), ctx = c.getContext('2d'); const R = rng(o.seed || 8); const N = noiseGen(8); const hz = h * 0.56;
    const sky = ctx.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#0b0d12'); sky.addColorStop(0.7, '#2a2522'); sky.addColorStop(1, '#5a4430'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz);
    // far shore: city lights band
    ctx.fillStyle = '#121010'; ctx.fillRect(0, hz - h * 0.035, w, h * 0.04);
    for (let i = 0; i < 260; i++) { const x = R() * w, y = hz - R() * h * 0.05; ctx.fillStyle = `rgba(255,${170 + R() * 70},${90 + R() * 80},${0.4 + R() * 0.6})`; ctx.fillRect(x, y, 1.3, 1.3); }
    for (let i = 0; i < 9; i++) { const x = R() * w, bw = w * (0.02 + R() * 0.03), bh = h * (0.05 + R() * 0.12); ctx.fillStyle = '#0d0c0d'; ctx.fillRect(x, hz - bh, bw, bh); for (let k = 0; k < 18; k++) { if (R() < 0.5) continue; ctx.fillStyle = `rgba(255,220,160,${0.3 + R() * 0.5})`; ctx.fillRect(x + R() * bw, hz - R() * bh, 1.4, 1.4); } }
    // gantry cranes
    for (let i = 0; i < 4; i++) {
      const x = w * (0.08 + i * 0.2) + R() * w * 0.04, s = h * (0.34 - i * 0.03), top = hz - s; ctx.strokeStyle = '#08080a'; ctx.fillStyle = '#08080a'; ctx.lineWidth = Math.max(2, w / 160);
      ctx.beginPath(); ctx.moveTo(x, hz + h * 0.04); ctx.lineTo(x + w * 0.012, top); ctx.moveTo(x + w * 0.07, hz + h * 0.04); ctx.lineTo(x + w * 0.058, top); ctx.stroke();
      ctx.fillRect(x - w * 0.09, top - h * 0.012, w * 0.26, h * 0.016); ctx.fillRect(x + w * 0.01, top - h * 0.06, w * 0.05, h * 0.05);
      ctx.lineWidth = 1; for (let k = 0; k < 8; k++) { ctx.beginPath(); ctx.moveTo(x + w * 0.012 * (k / 8) + 1, hz + h * 0.04 - (k * s) / 8); ctx.lineTo(x + w * 0.07 - w * 0.012 * ((k + 1) / 8), hz + h * 0.04 - ((k + 1) * s) / 8); ctx.stroke(); }
      for (let k = 0; k < 6; k++) { ctx.fillStyle = 'rgba(255,236,200,.85)'; ctx.fillRect(x - w * 0.08 + k * w * 0.045, top - h * 0.002, 2, 2); }
    }
    // container ship
    const sy = hz + h * 0.02; ctx.fillStyle = '#0d0f12'; ctx.beginPath(); ctx.moveTo(w * 0.12, sy); ctx.lineTo(w * 0.92, sy); ctx.lineTo(w * 0.88, sy + h * 0.07); ctx.lineTo(w * 0.15, sy + h * 0.07); ctx.closePath(); ctx.fill();
    const cols = ['#3b2420', '#1f2d3b', '#2b3326', '#3a3324', '#2a2a30', '#3a1f2a'];
    for (let i = 0; i < 46; i++) for (let j = 0; j < 4; j++) { if (R() < 0.12) continue; ctx.fillStyle = cols[R.int(cols.length)]; ctx.fillRect(w * 0.18 + i * w * 0.0145, sy - (j + 1) * h * 0.014, w * 0.013, h * 0.012); }
    ctx.fillStyle = '#16181c'; ctx.fillRect(w * 0.8, sy - h * 0.1, w * 0.07, h * 0.1); for (let k = 0; k < 14; k++) { ctx.fillStyle = 'rgba(255,230,180,.85)'; ctx.fillRect(w * 0.805 + (k % 7) * w * 0.009, sy - h * 0.09 + Math.floor(k / 7) * h * 0.02, 2, 2); }
    // water
    const wg = ctx.createLinearGradient(0, hz, 0, h); wg.addColorStop(0, '#15120f'); wg.addColorStop(1, '#050506'); ctx.fillStyle = wg; ctx.fillRect(0, sy + h * 0.07, w, h);
    // quay & lamps in the foreground
    ctx.fillStyle = '#0a0a0b'; ctx.beginPath(); ctx.moveTo(0, h * 0.86); ctx.lineTo(w, h * 0.8); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    for (let i = 0; i < 4; i++) { const x = w * (0.1 + i * 0.28), y = h * (0.86 - i * 0.015); ctx.fillStyle = '#060606'; ctx.fillRect(x, y - h * 0.16, 2, h * 0.16); }
    // fog
    for (let y = 0; y < h; y += 4) { const f = Math.exp(-(((y - hz) / (h * 0.12)) ** 2)) * 0.18; ctx.fillStyle = `rgba(150,130,110,${f})`; ctx.fillRect(0, y, w, 4); }
    c.lights = []; for (let i = 0; i < 4; i++) c.lights.push([w * (0.1 + i * 0.28) + 1, h * (0.86 - i * 0.015) - h * 0.16]);
    c.hz = hz; c.sy = sy + h * 0.07; return c;
  },
  frame(ctx, w, h, t, o, B) {
    ctx.drawImage(B, 0, 0); const N = this._n || (this._n = noiseGen(4)); const R = rng(Math.floor(t * 8));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // reflections shimmer
    for (let y = B.sy; y < h * 0.86; y += 2) { const f = (y - B.sy) / (h * 0.86 - B.sy); for (const [lx, a] of [[0.83, 0.35], [0.3, 0.12], [0.55, 0.1], [0.12, 0.08]]) { const j = (N(y * 0.15, t * 2 + lx * 9) - 0.5) * 16 * (0.5 + f); ctx.fillStyle = `rgba(255,170,90,${a * (1 - f * 0.7)})`; ctx.fillRect(lx * w + j - 3 - f * 8, y, 6 + f * 16, 1.3); } }
    for (const [x, y] of B.lights) glow(ctx, x, y, w * 0.06, 'rgba(255,170,80,A)', 0.55);
    for (let i = 0; i < 4; i++) { const on = Math.sin(t * 3 + i * 1.7) > 0; if (!on) continue; glow(ctx, w * (0.1 + i * 0.2) + w * 0.035, B.hz - h * (0.34 - i * 0.03) - h * 0.065, w * 0.025, 'rgba(255,40,30,A)', 0.9); }
    ctx.restore();
    // light rain
    ctx.save(); ctx.strokeStyle = 'rgba(200,200,210,.18)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < 90; i++) { const x = (R() * w + t * 60) % w, y = R() * h; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + h * 0.03); } ctx.stroke(); ctx.restore();
    scan(ctx, w, h, 0.06); vignette(ctx, w, h, 0.5); grain(ctx, w, h, 0.12);
    cctvOSD(ctx, w, h, t, o);
  },
};

// scramble crossing at night in the rain: umbrellas from a high camera, neon on wet asphalt
SCN.crossing = {
  // high camera over a scramble: ground plane in perspective, crowds waiting and crossing in the rain
  map(w, h) { const top = h * 0.25, zF = 2.3, zN = 1; return (u, v) => { const z = lerp(zF, zN, v); const y = top + (h - top) * ((1 / z - 1 / zF) / (1 / zN - 1 / zF)); return [w / 2 + ((u - 0.5) * w * 1.3) / z, y, 1 / z]; }; },
  base(w, h, o) {
    const c = mk(w, h), ctx = c.getContext('2d'); const R = rng(o.seed || 31); const M = this.map(w, h); const top = h * 0.25;
    // facades, video screens and signs (abstract, no marks)
    const fg = ctx.createLinearGradient(0, 0, 0, top); fg.addColorStop(0, '#060609'); fg.addColorStop(1, '#141218'); ctx.fillStyle = fg; ctx.fillRect(0, 0, w, top + 2);
    for (let i = 0; i < 7; i++) { const x = (i / 7) * w + R() * 10, bw = w / 7 - 4; ctx.fillStyle = `rgb(${12 + R() * 10},${12 + R() * 8},${16 + R() * 10})`; ctx.fillRect(x, R() * top * 0.2, bw, top); for (let k = 0; k < 40; k++) { if (R() < 0.5) continue; ctx.fillStyle = `rgba(255,${210 + R() * 40},${160 + R() * 70},${0.25 + R() * 0.4})`; ctx.fillRect(x + R() * bw, R() * top, 2, 1.5); } }
    const neon = ['255,70,130', '70,200,255', '255,190,70', '170,110,255', '90,255,190'];
    const screens = []; for (let i = 0; i < 4; i++) { const x = w * (0.05 + i * 0.25) + R() * 10, y = top * (0.14 + R() * 0.3), sw = w * (0.09 + R() * 0.05), sh = top * (0.22 + R() * 0.16); screens.push([x, y, sw, sh, neon[R.int(5)], neon[R.int(5)]]); }
    for (const [x, y, sw, sh, a, b] of screens) { ctx.fillStyle = '#050507'; ctx.fillRect(x - 3, y - 3, sw + 6, sh + 6); const g = ctx.createLinearGradient(x, y, x + sw, y + sh); g.addColorStop(0, `rgba(${a},.75)`); g.addColorStop(0.6, `rgba(${b},.55)`); g.addColorStop(1, `rgba(${a},.35)`); ctx.fillStyle = g; ctx.fillRect(x, y, sw, sh); ctx.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 0; k < 3; k++) ctx.fillRect(x + sw * 0.1, y + sh * (0.55 + k * 0.12), sw * (0.3 + R() * 0.5), Math.max(1, sh * 0.05)); ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let yy = y; yy < y + sh; yy += 2) ctx.fillRect(x, yy, sw, 1); ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, x + sw / 2, y + sh / 2, sw * 0.8, `rgba(${a},A)`, 0.18); ctx.restore(); }
    for (let i = 0; i < 9; i++) { const x = R() * w, y = R() * top * 0.7; ctx.fillStyle = `rgba(${neon[R.int(5)]},.6)`; ctx.fillRect(x, y, w * 0.008, top * (0.15 + R() * 0.25)); }
    // asphalt
    ctx.fillStyle = '#121117'; ctx.beginPath(); const q = [M(0, 0), M(1, 0), M(1, 1), M(0, 1)]; ctx.moveTo(-w, top); ctx.lineTo(w * 2, top); ctx.lineTo(w * 2, h); ctx.lineTo(-w, h); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, sw, sh, a] of screens) { const g = ctx.createLinearGradient(0, top, 0, h); g.addColorStop(0, `rgba(${a},.30)`); g.addColorStop(0.6, `rgba(${a},.05)`); g.addColorStop(1, `rgba(${a},0)`); ctx.fillStyle = g; for (let k = 0; k < 6; k++) ctx.fillRect(x + sw * (0.1 + k * 0.15) + R.gauss() * 3, top, sw * 0.08, h - top); }
    ctx.restore();
    // crosswalk stripes as quads on the ground plane
    const zebra = (u1, v1, u2, v2, n, wd) => { const du = u2 - u1, dv = v2 - v1, L = Math.hypot(du, dv); const nu = -dv / L * wd, nv = du / L * wd; ctx.fillStyle = 'rgba(205,208,218,.26)'; for (let i = 0; i < n; i++) { const t0 = (i + 0.15) / n, t1 = (i + 0.62) / n; const a = M(u1 + du * t0 + nu, v1 + dv * t0 + nv), b = M(u1 + du * t1 + nu, v1 + dv * t1 + nv), cc = M(u1 + du * t1 - nu, v1 + dv * t1 - nv), d = M(u1 + du * t0 - nu, v1 + dv * t0 - nv); poly(ctx, [a, b, cc, d], true); ctx.fill(); } };
    zebra(0.1, 0.14, 0.9, 0.14, 26, 0.06); zebra(0.08, 0.9, 0.92, 0.9, 26, 0.07); zebra(0.08, 0.2, 0.08, 0.84, 20, 0.055); zebra(0.92, 0.2, 0.92, 0.84, 20, 0.055); zebra(0.17, 0.22, 0.83, 0.82, 30, 0.028); zebra(0.83, 0.22, 0.17, 0.82, 30, 0.028);
    // kerbs/corner pavements
    ctx.fillStyle = '#1d1c22'; for (const [u0, v0] of [[-0.3, -0.2], [1.0, -0.2], [-0.3, 1.0], [1.0, 1.0]]) { poly(ctx, [M(u0, v0), M(u0 + 0.3, v0), M(u0 + 0.3, v0 + 0.2), M(u0, v0 + 0.2)], true); ctx.fill(); }
    // vehicles waiting, lights on
    for (const [u, v, d] of [[-0.05, 0.4, 1], [-0.05, 0.55, 1], [-0.05, 0.7, 1], [1.05, 0.35, -1], [1.05, 0.5, -1], [0.35, -0.05, 0], [0.55, 1.08, 0]]) { const [x, y, s] = M(u, v); ctx.fillStyle = '#18181d'; ctx.fillRect(x - 22 * s, y - 9 * s, 44 * s, 18 * s); ctx.save(); ctx.globalCompositeOperation = 'lighter'; if (d >= 0) { glow(ctx, x + 22 * s, y - 5 * s, 26 * s, 'rgba(255,248,225,A)', 0.8); glow(ctx, x + 22 * s, y + 5 * s, 26 * s, 'rgba(255,248,225,A)', 0.8); } else { glow(ctx, x + 22 * s, y, 18 * s, 'rgba(255,40,40,A)', 0.7); } ctx.restore(); }
    // people
    const P = []; const corners = [[0.06, 0.08], [0.94, 0.08], [0.06, 0.94], [0.94, 0.94]]; const cols = ['214,220,232', '214,220,232', '214,220,232', '200,206,220', '26,28,36', '34,40,58', '22,22,28', '44,46,56', '226,60,72', '56,134,228', '248,188,44', '240,120,170'];
    for (let i = 0; i < 520; i++) { const wait = i < 170; const ci = i % 4; const a = corners[ci], b = wait ? a : corners[[3, 2, 1, 0, 1, 0, 3, 2][(i >> 2) % 8] ?? 3 - ci]; const umb = R() < 0.72; P.push({ a, b, wait, off: R(), sp: 0.035 + R() * 0.03, jx: R.gauss() * (wait ? 0.035 : 0.03), jy: R.gauss() * (wait ? 0.03 : 0.022), umb, col: cols[R.int(cols.length)], s: 0.8 + R() * 0.45 }); }
    c.P = P; c.M = M; return c;
  },
  frame(ctx, w, h, t, o, B) {
    ctx.drawImage(B, 0, 0); const M = B.M; const list = [];
    for (const p of B.P) { const u = p.wait ? 0 : (p.off + t * p.sp) % 1; const [x, y, s] = M(lerp(p.a[0], p.b[0], u) + p.jx, lerp(p.a[1], p.b[1], u) + p.jy); list.push([y, x, s * (w / 46) * p.s, p]); }
    list.sort((a, b) => a[0] - b[0]);
    for (const [y, x, s, p] of list) { if (p.umb) { ctx.fillStyle = `rgba(${p.col},${p.col.startsWith('2') && p.col.length > 9 && +p.col.split(',')[0] > 190 ? 0.62 : 0.95})`; ctx.beginPath(); ctx.ellipse(x, y, s * 1.1, s * 0.82, 0, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.ellipse(x - s * 0.25, y - s * 0.22, s * 0.5, s * 0.32, 0, 0, TAU); ctx.fill(); } else { ctx.fillStyle = '#17161b'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.2, s * 0.55, s * 0.4, 0, 0, TAU); ctx.fill(); ctx.fillStyle = '#2b2622'; ctx.beginPath(); ctx.arc(x, y - s * 0.1, s * 0.33, 0, TAU); ctx.fill(); } }
    ctx.save(); ctx.strokeStyle = 'rgba(210,215,230,.15)'; ctx.lineWidth = 1; const R = rng(Math.floor(t * 10)); ctx.beginPath(); for (let i = 0; i < 160; i++) { const x = R() * w, y = R() * h; ctx.moveTo(x, y); ctx.lineTo(x - 2, y + h * 0.025); } ctx.stroke(); ctx.restore();
    vignette(ctx, w, h, 0.45); scan(ctx, w, h, 0.05); grain(ctx, w, h, 0.1);
    if (!o.noOSD) cctvOSD(ctx, w, h, t, o);
  },
};

// waterfront in a storm at night: looking along the wall, swells breaking over it, sodium lamps on a
// flooded road, a town behind; handheld when a person films it
SCN.seawall = {
  base(w, h, o) {
    const c = mk(w, h), ctx = c.getContext('2d'); const R = rng(o.seed || 51); const N = noiseGen(o.seed || 51); const hz = h * 0.4;
    const sky = ctx.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#06070a'); sky.addColorStop(1, o.skyline ? '#2a2129' : '#191a20'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz + 2);
    field(ctx, w, hz, 3, (u, v, out) => { const n = N.fbm(u * 2.5 + v, v * 4, 5); out[0] = 34 + n * 40; out[1] = 32 + n * 38; out[2] = 38 + n * 40; out[3] = 150 * smooth(0.35, 0.8, n); });
    // town / skyline on the right half, beyond the road
    const town = (x0, x1, tall) => { for (let i = 0; i < (tall ? 26 : 34); i++) { const x = lerp(x0, x1, R()), bw = w * (tall ? 0.02 + R() * 0.035 : 0.025 + R() * 0.04), bh = h * (tall ? 0.04 + Math.pow(R(), 2) * 0.24 : 0.02 + R() * 0.05); ctx.fillStyle = '#0b0a0d'; ctx.fillRect(x, hz - bh, bw, bh + 2); const n = Math.floor(bw * bh * 0.012); for (let k = 0; k < n; k++) { if (R() < 0.5) continue; ctx.fillStyle = `rgba(255,${190 + R() * 60},${120 + R() * 90},${0.3 + R() * 0.6})`; ctx.fillRect(x + R() * bw, hz - R() * bh, 1.4, 1.4); } } };
    town(w * 0.5, w * 1.0, !!o.skyline);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, w * 0.8, hz, w * 0.5, 'rgba(255,140,60,A)', o.skyline ? 0.22 : 0.12); ctx.restore();
    // sea on the left: dark swells with streaked foam, perspective-compressed toward the horizon
    field(ctx, w, h, 2, (u, v, out) => { const y = v * h; if (y < hz) { out[3] = 0; return; } const d = (y - hz) / (h - hz); const z = 1 / (0.05 + d); const n = N.fbm(u * 3 * z * 0.25 + 3, d * 9 + z * 0.15, 5); const sw = Math.sin(z * 1.6 + n * 4); const crest = smooth(0.7, 0.98, sw) * smooth(0.45, 0.7, n); const foam = smooth(0.68, 0.82, N(u * 30 * z * 0.1, d * 60)) * 0.35 * smooth(0.5, 0.75, n);
      out[0] = 10 + n * 22 + (crest + foam) * 170; out[1] = 13 + n * 25 + (crest + foam) * 172; out[2] = 18 + n * 28 + (crest + foam) * 178; out[3] = 255; });
    // the wall: a parapet running from bottom-left toward the horizon; road + puddles on its right
    const vp = [w * 0.56, hz + h * 0.005]; const L0 = [w * -0.02, h * 1.0], L1 = [w * 0.22, h * 1.0];
    ctx.fillStyle = '#1e1d1f'; poly(ctx, [L0, vp, [vp[0] + 2, vp[1]], L1], true); ctx.fill(); // wall top
    const road = [[w * 0.22, h], [vp[0] + 2, vp[1]], [w * 0.9, vp[1] + h * 0.02], [w * 1.2, h]]; const rg = ctx.createLinearGradient(0, hz, 0, h); rg.addColorStop(0, '#141316'); rg.addColorStop(1, '#0a0a0b'); ctx.fillStyle = rg; poly(ctx, road, true); ctx.fill();
    ctx.strokeStyle = 'rgba(200,190,170,.18)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(L1[0], L1[1]); ctx.lineTo(vp[0] + 2, vp[1]); ctx.stroke();
    // lamps along the road edge
    const lamps = []; for (let i = 0; i < 8; i++) { const f = Math.pow(i / 8, 0.75); const bx = lerp(w * 1.0, vp[0] + w * 0.035, f), by = lerp(h * 1.04, vp[1] + h * 0.006, f); const lh = Math.max(2, (by - hz) * 1.9); ctx.fillStyle = '#050506'; ctx.fillRect(bx, by - lh, Math.max(1.2, 7 * (1 - f)), lh); ctx.fillRect(bx - lh * 0.16, by - lh, lh * 0.18, Math.max(1, 5 * (1 - f))); lamps.push([bx - lh * 0.13, by - lh + 4 * (1 - f), 1 - f, by]); }
    // kerb line along the road edge, wet sheen
    ctx.strokeStyle = 'rgba(210,200,180,.16)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w * 0.95, h); ctx.lineTo(vp[0] + w * 0.03, vp[1] + h * 0.006); ctx.stroke();
    if (o.palm) { ctx.save(); ctx.translate(w * 0.8, hz + h * 0.06); ctx.strokeStyle = '#030303'; ctx.lineWidth = w / 160; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-w * 0.01, -h * 0.12, -w * 0.05, -h * 0.2); ctx.stroke(); for (let k = 0; k < 9; k++) { const a = -2.9 + k * 0.32; ctx.lineWidth = w / 420; ctx.beginPath(); ctx.moveTo(-w * 0.05, -h * 0.2); ctx.quadraticCurveTo(-w * 0.05 + Math.cos(a) * w * 0.03, -h * 0.2 + Math.sin(a) * h * 0.02, -w * 0.05 + Math.cos(a) * w * 0.06 - w * 0.02, -h * 0.2 + Math.sin(a) * h * 0.03 + h * 0.03); ctx.stroke(); } ctx.restore(); }
    c.lamps = lamps; c.hz = hz; c.vp = vp; return c;
  },
  frame(ctx, w, h, t, o, B) {
    const shake = o.handheld ? [Math.sin(t * 7.1) * w * 0.004 + Math.sin(t * 2.3) * w * 0.006, Math.cos(t * 6.3) * h * 0.003] : [0, 0];
    ctx.save(); ctx.translate(shake[0], shake[1]); ctx.drawImage(B, -4, -4, w + 8, h + 8);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, f, gy] of B.lamps) { glow(ctx, x, y, w * 0.07 * (0.3 + f), 'rgba(255,150,50,A)', 0.5 + 0.1 * Math.sin(t * 13 + x)); glow(ctx, x, y, w * 0.012 * (0.4 + f), 'rgba(255,230,180,A)', 0.9); const g = ctx.createLinearGradient(0, gy - h * 0.01, 0, gy + h * 0.16 * f); g.addColorStop(0, 'rgba(255,150,60,.0)'); g.addColorStop(0.2, 'rgba(255,150,60,.3)'); g.addColorStop(1, 'rgba(255,150,60,0)'); ctx.fillStyle = g; ctx.fillRect(x - w * 0.012 * (0.5 + f), gy - h * 0.01, w * 0.024 * (0.5 + f) + 1.5, h * 0.17 * f); }
    // breaking swells: spray sheets rise off the wall and blow right with the wind
    const R0 = rng(7); for (let b = 0; b < 3; b++) { const per = 3.6 + b * 1.3; const tt = t + b * 1.7; const ph = (tt % per) / per; if (ph > 0.6) continue; const k = Math.sin((ph / 0.6) * Math.PI); const f = [0.18, 0.42, 0.68][b]; const bx = lerp(w * 0.08, B.vp[0], f), by = lerp(h * 0.98, B.vp[1], f); const sz = (1 - f * 0.85) * h * 0.55; const R = rng(b * 97 + Math.floor(tt / per));
      for (let i = 0; i < 90; i++) { const up = Math.pow(R(), 0.7) * sz * k, side = (R() - 0.35) * sz * 0.35 + up * 0.6 * ph; const x = bx + side, y = by - up; const r = (0.002 + R() * 0.007) * w * (1 - f * 0.6) * (0.6 + k); ctx.fillStyle = `rgba(214,222,234,${(0.06 + R() * 0.14) * k})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = `rgba(220,226,236,${0.08 * k})`; ctx.lineWidth = Math.max(1, w / 400); ctx.beginPath(); for (let i = 0; i < 40; i++) { const up = R() * sz * k; const x = bx + (R() - 0.3) * sz * 0.3, y = by - up * 0.3; ctx.moveTo(x, y); ctx.lineTo(x + sz * 0.12 * ph + R() * 6, y - up * 0.7); } ctx.stroke();
      const g = ctx.createRadialGradient(bx + sz * 0.25 * ph, by - sz * 0.35 * k, 0, bx + sz * 0.25 * ph, by - sz * 0.35 * k, sz * 0.55); g.addColorStop(0, `rgba(190,198,212,${0.13 * k})`); g.addColorStop(1, 'rgba(190,198,212,0)'); ctx.fillStyle = g; ctx.fillRect(bx - sz, by - sz * 1.2, sz * 2.2, sz * 1.4); }
    ctx.restore();
    // rain, wind-driven, brighter near the lamps
    const R = rng(Math.floor(t * 24)); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(205,212,228,.26)'; ctx.beginPath(); for (let i = 0; i < 320; i++) { const x = R() * w * 1.25, y = R() * h; ctx.moveTo(x, y); ctx.lineTo(x - w * 0.035, y + h * 0.05); } ctx.stroke();
    ctx.strokeStyle = 'rgba(255,190,120,.35)'; ctx.beginPath(); for (const [x, y, f] of B.lamps) for (let i = 0; i < 10 * f; i++) { const xx = x + (R() - 0.5) * w * 0.2 * f, yy = y + (R() - 0.3) * h * 0.2 * f; ctx.moveTo(xx, yy); ctx.lineTo(xx - w * 0.02, yy + h * 0.03); } ctx.stroke();
    ctx.restore();
    vignette(ctx, w, h, 0.55); grain(ctx, w, h, 0.12);
    if (!o.noOSD) cctvOSD(ctx, w, h, t, o);
  },
};

// a quiet volcano webcam by day: ash column over the bay
SCN.volcano = {
  base(w, h, o) {
    const c = mk(w, h), ctx = c.getContext('2d'); const N = noiseGen(12); const R = rng(12); const hz = h * 0.66;
    const sky = ctx.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#6f8fb0'); sky.addColorStop(1, '#c9cfd2'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hz);
    // ash plume
    const vx = w * 0.46, vy = hz - h * 0.3;
    field(ctx, w, h, 2, (u, v, out) => { const x = u * w - vx, y = v * h - vy; if (y > 4) { out[3] = 0; return; } const up = -y; const drift = up * 0.55; const wd = 10 + up * 0.32; const n = N.fbm((x - drift) / 40, up / 40, 5); const d = Math.exp(-(((x - drift) / wd) ** 2) * (1.2 - n)) * smooth(0, 20, up) * (0.4 + 0.9 * n) * Math.exp(-up / (h * 1.2)); const a = clamp(d * 1.3, 0, 0.95); const sh = 0.6 + (x - drift) / wd * 0.15; out[0] = (120 + n * 70) * sh; out[1] = (108 + n * 62) * sh; out[2] = (98 + n * 58) * sh; out[3] = a * 255; });
    // cone
    const prof = (x) => { const d = Math.abs(x - vx) / w; return vy + (d < 0.035 ? (0.035 - d) * h * 0.25 : 0) + Math.pow(d, 1.35) * h * 0.95 + N(x / 22, 0) * 5; };
    field(ctx, w, h, 1.5, (u, v, out) => { const x = u * w, y = v * h; const top = prof(x); if (y < top || y > hz + 2) { out[3] = 0; return; } const d = (x - vx) / w; const n = N.fbm(u * 14, v * 6, 4); const gul = Math.pow(Math.abs(Math.sin(d * 60 + n * 3)), 6); const shade = 0.75 + d * 1.1 - gul * 0.25; const veg = smooth(0.08, 0.22, (y - top) / h) * smooth(0.4, 0.7, n); out[0] = (78 + n * 30) * shade - veg * 20; out[1] = (72 + n * 26) * shade + veg * 6; out[2] = (66 + n * 22) * shade - veg * 10; out[3] = 255; });
    // bay
    const wg = ctx.createLinearGradient(0, hz, 0, h); wg.addColorStop(0, '#7f9aa8'); wg.addColorStop(1, '#3d5664'); ctx.fillStyle = wg; ctx.fillRect(0, hz, w, h - hz);
    for (let y = hz; y < h; y += 2) { ctx.fillStyle = `rgba(255,255,255,${0.04 + R() * 0.05})`; ctx.fillRect(R() * w, y, w * 0.2 * R(), 1); }
    // town on the near shore
    ctx.fillStyle = '#2f3438'; ctx.fillRect(0, h * 0.86, w, h * 0.14); for (let i = 0; i < 60; i++) { const x = R() * w, bw = w * (0.02 + R() * 0.04), bh = h * (0.02 + R() * 0.06); ctx.fillStyle = ['#d8d4cc', '#b9b4aa', '#8e8a84', '#6c6a68'][R.int(4)]; ctx.fillRect(x, h * 0.88 - bh, bw, bh); }
    return c;
  },
  frame(ctx, w, h, t, o, B) { ctx.drawImage(B, 0, 0); vignette(ctx, w, h, 0.25); grain(ctx, w, h, 0.07); if (!o.noOSD) cctvOSD(ctx, w, h, t, o); },
};

/* =====================================================================================
   INSIDE — what a person saw
   ===================================================================================== */
PT.aurora = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const R = rng(o.seed || 61); const N = noiseGen(61); const hz = h * 0.66;
  const sky = ctx.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#02030a'); sky.addColorStop(1, '#0b1a22'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(255,255,255,${R() * 0.8})`; ctx.fillRect(R() * w, R() * hz, 1, 1); }
  // curtains (per-pixel: base line, height and ray striation per column)
  const curtains = [[0.42, 0.06, 1.3, [170, 80, 255]], [0.55, 0.04, 4.2, [200, 90, 255]]];
  field(ctx, w, h, 3, (u, v, out) => { let r = 0, g = 0, b = 0; const y = v * h; for (const [yb, amp, sd, top] of curtains) { const base = h * yb + Math.sin(u * 5 + sd) * amp * h + N(u * 6, sd) * amp * h * 1.4; const ht = h * (0.18 + 0.28 * N.fbm(u * 9 + sd, sd, 3)); const f = (base - y) / ht; if (f < -0.03 || f > 1) continue; const ray = 0.35 + 0.65 * Math.pow(N(u * 70, sd * 3), 2); const low = f < 0 ? smooth(-0.03, 0, f) : 1; const gk = Math.exp(-f * 3.2) * low * ray, pk = smooth(0.25, 0.9, f) * (1 - f) * ray * 0.6; r += gk * 60 + pk * top[0]; g += gk * 255 + pk * top[1] * 0.3; b += gk * 140 + pk * top[2]; } out[0] = r * 0.7; out[1] = g * 0.7; out[2] = b * 0.7; out[3] = 255; }, true, 'lighter');
  // mountains + fjord reflection
  ctx.fillStyle = '#05070a'; ctx.beginPath(); ctx.moveTo(0, hz); for (let x = 0; x <= w; x += 3) ctx.lineTo(x, hz - h * 0.05 - N.ridge(x / w * 3, 2, 4) * h * 0.16); ctx.lineTo(w, hz); ctx.fill();
  const img = ctx.getImageData(0, 0, w, Math.floor(hz)); const ref = mk(w, Math.floor(hz)); ref.getContext('2d').putImageData(img, 0, 0);
  ctx.save(); ctx.translate(0, hz * 2); ctx.scale(1, -1); ctx.globalAlpha = 0.45; for (let y = 0; y < hz; y += 3) { const j = Math.sin(y * 0.4) * 2; ctx.drawImage(ref, 0, y, w, 3, j, y, w, 3); } ctx.restore();
  ctx.fillStyle = 'rgba(2,4,8,.35)'; ctx.fillRect(0, hz, w, h - hz);
  ctx.fillStyle = '#020305'; ctx.fillRect(0, h * 0.9, w, h * 0.1); for (let i = 0; i < 26; i++) { const x = R() * w, th = h * (0.06 + R() * 0.1); ctx.beginPath(); ctx.moveTo(x, h * 0.9 - th); ctx.lineTo(x - th * 0.22, h * 0.91); ctx.lineTo(x + th * 0.22, h * 0.91); ctx.fill(); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, w * 0.7, h * 0.885, w * 0.05, 'rgba(255,190,110,A)', 0.8); ctx.restore();
  vignette(ctx, w, h, 0.45); grain(ctx, w, h, 0.12);
};

// a hillside on fire, from the road
PT.firewit = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const R = rng(o.seed || 71); const N = noiseGen(71);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7); sky.addColorStop(0, '#07060a'); sky.addColorStop(0.7, '#3a1a10'); sky.addColorStop(1, '#8a3a12'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  // smoke lit from below
  field(ctx, w, h * 0.7, 3, (u, v, out) => { const n = N.fbm(u * 3 + 0.5 * v, v * 4, 5); const lit = smooth(0.2, 0.95, v); out[0] = 40 + n * 90 * lit + 60 * lit; out[1] = 25 + n * 45 * lit; out[2] = 20 + n * 25 * lit; out[3] = 255 * smooth(0.35, 0.75, n) * 0.85; });
  const ridge = (x) => h * 0.52 - N.fbm(x / w * 2.4, 3, 4) * h * 0.22 + (x / w) * h * 0.06;
  ctx.fillStyle = '#060404'; ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += 3) ctx.lineTo(x, ridge(x)); ctx.lineTo(w, h); ctx.fill();
  // flames along the ridge
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let x = 0; x < w; x += 2) { const y = ridge(x); const k = smooth(0.25, 0.6, N(x / 40, 7)); if (k < 0.05) continue; const fh = h * (0.02 + 0.07 * N(x / 9, 2)) * k; const g = ctx.createLinearGradient(0, y, 0, y - fh); g.addColorStop(0, `rgba(255,220,120,${0.9 * k})`); g.addColorStop(0.4, `rgba(255,120,30,${0.7 * k})`); g.addColorStop(1, 'rgba(200,40,10,0)'); ctx.fillStyle = g; ctx.fillRect(x, y - fh, 2.4, fh + 2); }
  for (let x = 0; x < w; x += w / 14) { const y = ridge(x); glow(ctx, x, y, w * 0.12, 'rgba(255,100,20,A)', 0.25 * smooth(0.25, 0.6, N(x / 40, 7))); }
  for (let i = 0; i < 120; i++) { const x = R() * w, y = R() * h * 0.55; ctx.fillStyle = `rgba(255,${150 + R() * 80},60,${R() * 0.8})`; ctx.fillRect(x, y, 1.6, 1.6); }
  ctx.restore();
  // road & tail lights
  ctx.fillStyle = '#0b0b0c'; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * 0.42, h * 0.74); ctx.lineTo(w * 0.52, h * 0.74); ctx.lineTo(w, h); ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,120,.4)'; ctx.setLineDash([8, 10]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * 0.62, h); ctx.lineTo(w * 0.475, h * 0.745); ctx.stroke(); ctx.setLineDash([]);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (const [x, y, s] of [[0.36, 0.86, 1], [0.44, 0.8, 0.6], [0.47, 0.77, 0.4]]) { glow(ctx, x * w, y * h, w * 0.04 * s, 'rgba(255,30,30,A)', 0.8); glow(ctx, x * w + w * 0.06 * s, y * h, w * 0.04 * s, 'rgba(255,30,30,A)', 0.8); } ctx.restore();
  vignette(ctx, w, h, 0.5); grain(ctx, w, h, 0.13);
};

// inside the cabin of a diverting airliner: masks down, emergency floor lighting, a calm crew
PT.cabin = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const R = rng(o.seed || 81); const vx = w * 0.52, vy = h * 0.42;
  const bg = ctx.createRadialGradient(vx, vy, 0, vx, vy, h); bg.addColorStop(0, '#5a5040'); bg.addColorStop(0.35, '#2a2620'); bg.addColorStop(1, '#0c0b0a'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const P = (x, y, z) => [vx + (x - vx) * z, vy + (y - vy) * z];
  // ceiling & bins
  ctx.fillStyle = '#1e1c1a'; poly(ctx, [[0, 0], [w, 0], P(w, 0, 0.12), P(0, 0, 0.12)], true); ctx.fill();
  for (const side of [0, 1]) { const x0 = side ? w : 0; ctx.fillStyle = '#2c2a27'; poly(ctx, [[x0, h * 0.05], P(x0, h * 0.05, 0.12), P(x0, h * 0.3, 0.12), [x0, h * 0.3]], true); ctx.fill();
    ctx.strokeStyle = 'rgba(255,236,200,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, h * 0.3); const e = P(x0, h * 0.3, 0.12); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
  // windows (dark night outside, faint blue)
  for (let i = 0; i < 9; i++) { const z = 1 / (1 + i * 0.55); for (const side of [0, 1]) { const x0 = side ? w : 0; const [x, y] = P(x0, h * 0.36, z); const ww = w * 0.05 * z, wh = h * 0.08 * z; ctx.fillStyle = '#0b1424'; ctx.beginPath(); ctx.ellipse(x + (side ? -ww : ww), y, ww * 0.5, wh * 0.5, 0, 0, TAU); ctx.fill(); } }
  // seat rows receding
  for (let i = 9; i >= 0; i--) { const z = 1 / (1 + i * 0.55); for (const side of [0, 1]) { for (let k = 0; k < 3; k++) { const sx = side ? lerp(w * 0.62, w * 1.05, k / 2.4) : lerp(w * 0.42, -w * 0.05, k / 2.4); const [x, y] = P(sx, h * 0.6, z); const sw = w * 0.13 * z, sh = h * 0.3 * z; ctx.fillStyle = `rgb(${18 + i * 2},${24 + i * 2},${44 + i * 2})`; ctx.beginPath(); ctx.roundRect(x - sw / 2, y - sh * 0.55, sw * 0.92, sh, sw * 0.18); ctx.fill(); ctx.fillStyle = `rgba(210,205,190,${0.5 - i * 0.03})`; ctx.fillRect(x - sw * 0.38, y - sh * 0.52, sw * 0.7, sh * 0.12); if (R() < 0.75) { ctx.fillStyle = `rgba(${40 + R() * 40},${30 + R() * 30},${25 + R() * 20},.95)`; ctx.beginPath(); ctx.arc(x - sw * 0.05, y - sh * 0.62, sw * 0.2, 0, TAU); ctx.fill(); } } } }
  // oxygen masks hanging on their tubes
  for (let i = 0; i < 26; i++) { const z = 1 / (1 + R() * 5); const side = R() < 0.5; const sx = side ? lerp(w * 0.62, w * 1.0, R()) : lerp(w * 0.42, 0, R()); const [x, y0] = P(sx, h * 0.3, z); const L = h * (0.12 + R() * 0.16) * z; const sway = (R() - 0.5) * 10 * z; ctx.strokeStyle = 'rgba(240,240,230,.7)'; ctx.lineWidth = Math.max(0.6, 1.4 * z); ctx.beginPath(); ctx.moveTo(x, y0); ctx.quadraticCurveTo(x + sway, y0 + L * 0.6, x + sway * 0.6, y0 + L); ctx.stroke(); ctx.fillStyle = '#F4C21A'; ctx.beginPath(); ctx.ellipse(x + sway * 0.6, y0 + L + 5 * z, 7 * z * (w / 400), 9 * z * (w / 400), 0, 0, TAU); ctx.fill(); }
  // aisle with emergency floor path lighting
  ctx.fillStyle = '#161412'; poly(ctx, [[w * 0.36, h], [w * 0.68, h], P(w * 0.56, h, 0.1), P(w * 0.48, h, 0.1)], true); ctx.fill();
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 18; i++) { const z = 1 / (1 + i * 0.4); for (const xx of [w * 0.38, w * 0.66]) { const [x, y] = P(xx, h * 0.99, z); glow(ctx, x, y, 10 * z * (w / 300), 'rgba(255,170,70,A)', 0.9); } } glow(ctx, vx, vy - h * 0.05, w * 0.3, 'rgba(255,220,170,A)', 0.25); ctx.restore();
  // a crew member down the aisle
  const [cx, cy] = P(w * 0.52, h * 0.66, 0.42); ctx.fillStyle = '#0d0c10'; ctx.beginPath(); ctx.roundRect(cx - w * 0.03, cy - h * 0.16, w * 0.06, h * 0.17, 6); ctx.fill(); ctx.beginPath(); ctx.arc(cx, cy - h * 0.18, w * 0.022, 0, TAU); ctx.fill();
  // motion blur feel + grain
  ctx.save(); ctx.globalAlpha = 0.18; ctx.drawImage(cv, 3, 1); ctx.restore();
  vignette(ctx, w, h, 0.6); grain(ctx, w, h, 0.16);
};

// a city block after the power went out: one building on generator light
PT.blackout = function (cv, o = {}) {
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height; const R = rng(o.seed || 91);
  const sky = ctx.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#05060a'); sky.addColorStop(1, '#10121a'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 7; i++) { const x = i * w / 6 - 10, bw = w / 6 + 10, bh = h * (0.25 + R() * 0.3); ctx.fillStyle = '#08090c'; ctx.fillRect(x, h * 0.72 - bh, bw, bh); }
  const hx = w * 0.56, hy = h * 0.38; ctx.fillStyle = '#121418'; ctx.fillRect(hx - w * 0.16, hy, w * 0.32, h * 0.34);
  for (let r = 0; r < 7; r++) for (let c = 0; c < 10; c++) { if (R() < 0.45) continue; ctx.fillStyle = `rgba(255,${225 + R() * 30},${180 + R() * 50},${0.45 + R() * 0.5})`; ctx.fillRect(hx - w * 0.145 + c * w * 0.03, hy + h * 0.025 + r * h * 0.042, w * 0.016, h * 0.022); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, hx, hy + h * 0.15, w * 0.4, 'rgba(255,230,190,A)', 0.18); glow(ctx, w * 0.2, h * 0.86, w * 0.1, 'rgba(255,40,40,A)', 0.6); ctx.restore();
  const rg = ctx.createLinearGradient(0, h * 0.72, 0, h); rg.addColorStop(0, '#0b0c10'); rg.addColorStop(1, '#030304'); ctx.fillStyle = rg; ctx.fillRect(0, h * 0.72, w, h * 0.28);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25; for (let y = h * 0.74; y < h; y += 2) { ctx.fillStyle = 'rgba(255,220,170,.5)'; ctx.fillRect(hx - w * 0.08 + Math.sin(y) * 4, y, w * 0.16, 1); } ctx.restore();
  ctx.strokeStyle = 'rgba(200,210,230,.2)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < 160; i++) { const x = R() * w, y = R() * h; ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 14); } ctx.stroke();
  vignette(ctx, w, h, 0.55); grain(ctx, w, h, 0.15);
};

/* ---------- registry: id → draw(canvas, opts); scenes are drawn at t ---------- */
PT.draw = function (id, cv, o = {}) {
  if (SCN[id]) { const sc = SCN[id]; const key = id + '|' + cv.width + 'x' + cv.height + '|' + (o.seed || 0) + '|' + (o.skyline ? 1 : 0) + (o.palm ? 1 : 0); PT._bases = PT._bases || new Map(); let B = PT._bases.get(key); if (!B) { B = sc.base(cv.width, cv.height, o); PT._bases.set(key, B); } sc.frame(cv.getContext('2d'), cv.width, cv.height, o.t ?? performance.now() / 1000, o, B); return true; }
  const f = PT[id]; if (typeof f !== 'function') return false; f(cv, o); return true;
};
PT.animated = (id) => !!SCN[id];
