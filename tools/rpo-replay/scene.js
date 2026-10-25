/* global Cesium */
// Deterministic frame renderer for the Cosmos 2612 / ICEYE-X36 replay.
// window.rpo.frame(seconds) sets every piece of state for one video instant,
// renders, and resolves once imagery and models have settled.

import { createHud } from './hud.js';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') || 1920);
const H = Number(params.get('h') || 1080);
const PORTRAIT = H > W;
const U = PORTRAIT ? W / 1080 : W / 1920;
document.documentElement.style.setProperty('--u', `${U}px`);
if (PORTRAIT) document.body.classList.add('portrait');

const D = await (await fetch('data.json')).json();
const T0 = Date.parse(D.t0);
const DT = D.dt;
const NS = D.sep_km.length;
const sec = (iso) => (Date.parse(iso) - T0) / 1000;
const DUR = 45;
const SETTLE = Number(params.get('settle') || 4);

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------
function cr(arr, t, out, scale = 1) {
  const x = Math.min(Math.max(t / DT, 1), NS - 3);
  const i = Math.floor(x);
  const u = x - i;
  const u2 = u * u;
  const u3 = u2 * u;
  for (let k = 0; k < 3; k++) {
    const p0 = arr[(i - 1) * 3 + k];
    const p1 = arr[i * 3 + k];
    const p2 = arr[(i + 1) * 3 + k];
    const p3 = arr[(i + 2) * 3 + k];
    out[k] =
      0.5 * scale *
      (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    if (out.length > 3) {
      out[3 + k] = (0.5 * scale * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u2)) / DT;
    }
  }
  return out;
}
const v3 = Cesium.Cartesian3;
const tmp6 = new Float64Array(6);
function x36Teme(t) {
  cr(D.x36, t, tmp6, 1000);
  return { r: new v3(tmp6[0], tmp6[1], tmp6[2]), v: new v3(tmp6[3], tmp6[4], tmp6[5]) };
}
const tmp3 = new Float64Array(3);
function relAt(t) {
  cr(D.rel, t, tmp3, 1);
  return [tmp3[0], tmp3[1], tmp3[2]];
}
function sepAt(t) {
  const x = Math.min(Math.max(t / DT, 0), NS - 2);
  const i = Math.floor(x);
  return D.sep_km[i] + (D.sep_km[i + 1] - D.sep_km[i]) * (x - i);
}
function litAt(t) {
  return D.lit[Math.round(Math.min(Math.max(t / DT, 0), NS - 1))] === '1';
}
function basis(r, v) {
  const R = v3.normalize(r, new v3());
  const N = v3.normalize(v3.cross(r, v, new v3()), new v3());
  const T = v3.cross(N, R, new v3());
  return { R, T, N };
}
// Curvilinear placement: along-track offset is an arc on the anchor orbit.
function place(anchor, B, rel) {
  const rm = v3.magnitude(anchor);
  const th = rel[1] / rm;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const Rp = new v3(B.R.x * c + B.T.x * s, B.R.y * c + B.T.y * s, B.R.z * c + B.T.z * s);
  const out = v3.multiplyByScalar(Rp, rm + rel[0], new v3());
  return v3.add(out, v3.multiplyByScalar(B.N, rel[2], new v3()), out);
}

// ---------------------------------------------------------------------------
// Time maps. tau(s): simulation clock. b(s): backdrop/anchor clock (Earth and
// lighting), equal to tau around closest approach.
// ---------------------------------------------------------------------------
const CA_T = sec(D.ca.t);
const VANTOR_T = sec(D.vantor.t);
const TAU_KEYS = [
  [0.0, '2026-09-30T07:30:00Z'],
  [4.0, '2026-09-30T10:20:00Z'],
  [7.0, '2026-09-30T13:00:00Z'],
  [12.5, '2026-10-11T23:20:00Z'],
  [15.0, '2026-10-12T03:20:00Z'],
  [17.0, '2026-10-15T01:30:00Z'],
  [18.6, '2026-10-15T04:40:00Z'],
  [20.6, '2026-10-16T04:40:00Z'],
  [22.2, '2026-10-16T07:40:00Z'],
  [25.8, '2026-10-17T15:40:00Z'],
  [27.6, '2026-10-17T18:10:00Z'],
  [29.8, D.ca.t, -14 * 60],
  [35.0, D.ca.t, 11 * 60],
  [36.4, '2026-10-18T07:00:00Z'],
  [40.6, '2026-10-21T10:00:00Z'],
  [45.0, '2026-10-21T13:00:00Z'],
].map(([s, iso, off = 0]) => [s, sec(iso) + off]);

function monotone(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  // Geometric-mean slopes keep huge rate swings smooth in log-space.
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(Math.sqrt(d[i - 1] * d[i]));
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const f = (s) => {
    let i = 0;
    while (i < n - 2 && s > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i];
    const t = Math.min(Math.max((s - xs[i]) / hh, 0), 1);
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1]
    );
  };
  return f;
}
const tau = monotone(TAU_KEYS);
const rate = (s) => (tau(s + 0.01) - tau(s - 0.01)) / 0.02;

const S_SYNC0 = 29.8;
const S_SYNC1 = 35.0;
function hermite(s, s0, y0, m0, s1, y1, m1) {
  const h = s1 - s0;
  const t = (s - s0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}
const BG_RATE = 110;
function bclock(s) {
  if (s >= S_SYNC0 && s <= S_SYNC1) return tau(s);
  if (s < S_SYNC0) {
    const y1 = tau(S_SYNC0);
    return hermite(s, 0, y1 - S_SYNC0 * BG_RATE * 1.15, BG_RATE, S_SYNC0, y1, rate(S_SYNC0));
  }
  const y0 = tau(S_SYNC1);
  return hermite(s, S_SYNC1, y0, rate(S_SYNC1), DUR, y0 + (DUR - S_SYNC1) * BG_RATE * 1.2, BG_RATE);
}
function sOfTau(t) {
  let lo = 0;
  let hi = DUR;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (tau(mid) < t) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Story: captions, events, camera
// ---------------------------------------------------------------------------
const BURNS = D.burns.map((b) => ({ ...b, t: sec(b.t) }));

// Camera keys, in X36's local frame (R up, T velocity, N orbit normal).
// dist: metres (or auto = f * separation, floored at min). az: 0 = behind X36
// looking forward. look: 0 = X36, 1 = Cosmos. earth: pull aim to Earth centre.
const WIDE = { f: 0, look: 0, earth: 0.86, fov: 40, mag: 0, sun: 0.55 };
const CAM = [
  { s: 0.0, ...WIDE, dist: 5.4e7, az: 82, el: 36, trail: 2 },
  { s: 6.0, ...WIDE, dist: 4.6e7, az: 96, el: 34, trail: 20 },
  { s: 12.5, ...WIDE, dist: 4.4e7, az: 118, el: 30, trail: 30 },
  { s: 12.5, cut: true, dist: 6.0e5, f: 2.8, az: 50, el: 38, look: 0.5, earth: 0, fov: 34, mag: 0, trail: 3 },
  { s: 15.4, dist: 1.6e6, f: 2.8, az: 32, el: 36, look: 0.5, earth: 0, fov: 34, mag: 0, trail: 8 },
  { s: 18.0, dist: 1.4e6, f: 2.8, az: 26, el: 34, look: 0.5, earth: 0, fov: 34, mag: 0, trail: 12 },
  { s: 20.4, dist: 4.0e4, f: 2.8, az: 40, el: 32, look: 0.5, earth: 0, fov: 34, mag: 0, trail: 10 },
  { s: 22.4, dist: 6.5e3, f: 2.4, az: 58, el: 34, look: 0.45, earth: 0, fov: 36, mag: 1, mx: 40, trail: 9 },
  { s: 26.0, dist: 4.6e3, f: 2.4, az: 76, el: 30, look: 0.5, earth: 0, fov: 36, mag: 1, mx: 40, trail: 9 },
  { s: 29.7, dist: 2.0e3, f: 2.2, az: 104, el: 24, look: 0.5, earth: 0, fov: 36, mag: 1, mx: 25, trail: 4 },
  { s: 31.9, dist: 1.0e3, f: 2.2, az: 116, el: 22, look: 0.5, earth: 0, fov: 36, mag: 1, mx: 25, trail: 3 },
  { s: 31.9, cut: true, dist: 26, f: 0, az: 160, el: 0, look: 0.0, earth: 0, fov: 34, mag: 0, trail: 0.5, comp: 0, pairD: 26, pairTh: 22 },
  { s: 33.9, dist: 22, f: 0, az: 163, el: 0, look: 0.0, earth: 0, fov: 34, mag: 0, trail: 0.5, comp: 0, pairD: 22, pairTh: 18 },
  { s: 33.9, cut: true, dist: 1.3e3, f: 2.2, az: 96, el: 18, look: 0.5, earth: 0, fov: 36, mag: 1, mx: 25, trail: 1.6 },
  { s: 35.6, dist: 1.6e3, f: 2.4, az: 100, el: 22, look: 0.5, earth: 0, fov: 36, mag: 1, mx: 25, trail: 2 },
  { s: 37.0, dist: 1.2e4, f: 2.8, az: 110, el: 30, look: 0.4, earth: 0, fov: 36, mag: 1, mx: 40, trail: 4 },
  { s: 39.0, dist: 9.0e5, f: 2.8, az: 60, el: 30, look: 0.5, earth: 0, fov: 34, mag: 0, trail: 30 },
  { s: 41.2, dist: 2.0e6, f: 2.8, az: 44, el: 30, look: 0.5, earth: 0, fov: 34, mag: 0, trail: 60 },
  { s: 41.2, cut: true, ...WIDE, dist: 4.8e7, az: 80, el: 34, trail: 60 },
  { s: 45.0, ...WIDE, dist: 4.2e7, az: 96, el: 32, trail: 60 },
];
const CUTS = CAM.filter((k) => k.cut).map((k) => k.s);
const smooth = (x) => x * x * x * (x * (x * 6 - 15) + 10);
function camAt(s) {
  // Keys are grouped into shots at cut keys; interpolation never crosses a cut.
  let start = 0;
  for (let k = 1; k < CAM.length; k++) if (CAM[k].cut && s >= CAM[k].s) start = k;
  let end = CAM.length - 1;
  for (let k = start + 1; k < CAM.length; k++) if (CAM[k].cut) { end = k - 1; break; }
  let i = start;
  while (i < end - 1 && s > CAM[i + 1].s) i++;
  const a = CAM[i];
  const b = CAM[Math.min(i + 1, end)];
  const u = b === a ? 0 : smooth(Math.min(Math.max((s - a.s) / (b.s - a.s), 0), 1));
  const lerp = (x, y) => x + (y - x) * u;
  const ar = a.aimRel || [0, 0, 0];
  const br = b.aimRel || [0, 0, 0];
  return {
    dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist))),
    f: lerp(a.f, b.f),
    az: lerp(a.az, b.az),
    el: lerp(a.el, b.el),
    look: lerp(a.look, b.look),
    earth: lerp(a.earth, b.earth),
    fov: lerp(a.fov, b.fov),
    mag: lerp(a.mag, b.mag),
    comp: lerp(a.comp ?? 1, b.comp ?? 1),
    pairD: lerp(a.pairD || 0, b.pairD || 0),
    pairTh: lerp(a.pairTh || 0, b.pairTh || 0),
    mx: Math.exp(lerp(Math.log(a.mx || 1), Math.log(b.mx || 1))),
    trail: Math.exp(lerp(Math.log(a.trail), Math.log(b.trail))),
    aimRel: [0, 1, 2].map((k) => lerp(ar[k], br[k])),
    sun: lerp(a.sun || 0, b.sun || 0),
  };
}

// ---------------------------------------------------------------------------
// Cesium scene
// ---------------------------------------------------------------------------
const esri = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
  { enablePickFeatures: false, maximumLevel: 9 },
);
const viewer = new Cesium.Viewer('globe', {
  baseLayer: new Cesium.ImageryLayer(esri, { brightness: 0.92, contrast: 1.08, gamma: 1.05 }),
  animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
  selectionIndicator: false, useDefaultRenderLoop: false, shouldAnimate: false,
  contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: false } },
  msaaSamples: 1,
});
const scene = viewer.scene;
// Night side: NASA Black Marble city lights (keyless GIBS tiles).
const nightLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
  url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
  maximumLevel: 8, credit: 'NASA Black Marble',
}));
nightLayer.dayAlpha = 0.0;
nightLayer.nightAlpha = 1.0;
nightLayer.brightness = 1.6;
viewer.imageryLayers.get(0).nightAlpha = 0.0;
// Sky: ESO Milky Way cube (stars removed) + Yale Bright Star Catalogue points.
scene.skyBox = new Cesium.SkyBox({ sources: Object.fromEntries(
  [['positiveX', 'px'], ['negativeX', 'nx'], ['positiveY', 'py'], ['negativeY', 'ny'], ['positiveZ', 'pz'], ['negativeZ', 'nz']]
    .map(([k, f]) => [k, `/sky/milkyway_${f}.webp`])) });
const starData = await (await fetch('/sky/bright_stars.json')).json();
const starArr = Array.isArray(starData) ? starData : starData.stars || starData.data;
const stars = scene.primitives.add(new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT }));
const starDirs = [];
for (let i = 0; i + 3 < starArr.length; i += 4) {
  const [ra, dec, vm, bv] = [starArr[i], starArr[i + 1], starArr[i + 2], starArr[i + 3]];
  const r = Cesium.Math.toRadians(ra);
  const d = Cesium.Math.toRadians(dec);
  const dir = new Cesium.Cartesian3(Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d));
  const b = Math.min(1, Math.sqrt(10 ** (-0.4 * ((Number.isFinite(vm) ? vm : 6.5) - 6.5))) / 9);
  const t = Math.min(Math.max(((Number.isFinite(bv) ? bv : 0.6) + 0.3) / 2.0, 0), 1);
  const col = new Cesium.Color(0.78 + 0.22 * t, 0.84 + 0.06 * (1 - Math.abs(t - 0.4)), 1.0 - 0.3 * t, 0.25 + 0.75 * b);
  starDirs.push(dir);
  stars.add({ position: dir, color: col, pixelSize: 0.9 + 2.6 * b });
}

const globe = scene.globe;
globe.enableLighting = true;
globe.dynamicAtmosphereLighting = true;
globe.dynamicAtmosphereLightingFromSun = true;
globe.showGroundAtmosphere = true;
globe.atmosphereLightIntensity = 9;
globe.lightingFadeOutDistance = 1;
globe.lightingFadeInDistance = 2;
globe.nightFadeOutDistance = 1e10;
globe.nightFadeInDistance = 1e10;
globe.maximumScreenSpaceError = 2.2;
globe.tileCacheSize = 1500;
globe.preloadSiblings = false;
globe.baseColor = Cesium.Color.fromCssColorString('#04070d');
scene.fog.enabled = false;
scene.skyAtmosphere.show = true;
scene.skyAtmosphere.atmosphereLightIntensity = 10;
scene.highDynamicRange = false;
scene.sun.glowFactor = 1.6;
scene.moon.show = true;
scene.postProcessStages.fxaa.enabled = true;
scene.backgroundColor = Cesium.Color.BLACK;
scene.screenSpaceCameraController.enableInputs = false;
scene.camera.frustum.near = 0.5;
scene.camera.frustum.far = 1e9;
viewer.resolutionScale = Number(params.get('rs') || 1);
const bloom = scene.postProcessStages.bloom;
bloom.enabled = false;
bloom.uniforms.contrast = 119;
bloom.uniforms.brightness = -0.42;
bloom.uniforms.glowOnly = false;
bloom.uniforms.delta = 1.0;
bloom.uniforms.sigma = 3.2;
bloom.uniforms.stepSize = 1.0;

const COL_X36 = Cesium.Color.fromCssColorString('#5ce1e6');
const COL_COS = Cesium.Color.fromCssColorString('#ff5a3c');
const COL_BURN = Cesium.Color.fromCssColorString('#ffb547');

const modelOpts = { upAxis: Cesium.Axis.Z, forwardAxis: Cesium.Axis.X, shadows: Cesium.ShadowMode.DISABLED };
const mX36 = await Cesium.Model.fromGltfAsync({ url: 'iceye-x36.glb', ...modelOpts });
const mCos = await Cesium.Model.fromGltfAsync({ url: 'cosmos-2612.glb', ...modelOpts });
scene.primitives.add(mX36);
scene.primitives.add(mCos);
for (const m of [mX36, mCos]) {
  m.environmentMapOptions = { enabled: false };
  m.imageBasedLighting.sphericalHarmonicCoefficients = undefined;
}

function glowCanvas(color, core = 0.18) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(core, color.withAlpha(1).toCssColorString());
  grd.addColorStop(0.45, color.withAlpha(0.28).toCssColorString());
  grd.addColorStop(1, color.withAlpha(0).toCssColorString());
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return c;
}
const billboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
const bX36 = billboards.add({ image: glowCanvas(COL_X36), scale: 0.3 * U, disableDepthTestDistance: 0 });
const bCos = billboards.add({ image: glowCanvas(COL_COS), scale: 0.3 * U, disableDepthTestDistance: 0 });
const bBurn = billboards.add({ image: glowCanvas(COL_BURN, 0.08), scale: 0, disableDepthTestDistance: 0 });

let dynamic = [];
function clearDynamic() {
  for (const p of dynamic) scene.primitives.remove(p);
  dynamic = [];
}
function polyline(positions, colors, width) {
  if (positions.length < 2) return;
  const p = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions, colors, colorsPerVertex: true, width: width * U, arcType: Cesium.ArcType.NONE,
      }),
    }),
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
  });
  scene.primitives.add(p);
  dynamic.push(p);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function project(world) {
  const p = Cesium.SceneTransforms.worldToWindowCoordinates(scene, world);
  if (!p) return null;
  // Behind-camera / occluded test
  const cam = scene.camera;
  const d = v3.subtract(world, cam.positionWC, new v3());
  if (v3.dot(d, cam.directionWC) <= 0) return null;
  const ray = v3.normalize(d, new v3());
  const hit = Cesium.IntersectionTests.rayEllipsoid(new Cesium.Ray(cam.positionWC, ray), Cesium.Ellipsoid.WGS84);
  if (hit && hit.start * 1.0005 < v3.magnitude(d)) return { ...p, hidden: true };
  return p;
}
const hud = createHud({
  D, W, H, U, PORTRAIT, sec, rate, sOfTau, sepAt, CA_T, VANTOR_T, BURNS, CUTS, project,
});

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------
const M = new Cesium.Matrix3();
function toWorld(teme, jd) {
  return Cesium.Matrix3.multiplyByVector(M, teme, new v3());
}

function modelMatrix(pos, X, Y, scale) {
  const Z = v3.cross(X, Y, new v3());
  const m = new Cesium.Matrix4(
    X.x * scale, Y.x * scale, Z.x * scale, pos.x,
    X.y * scale, Y.y * scale, Z.y * scale, pos.y,
    X.z * scale, Y.z * scale, Z.z * scale, pos.z,
    0, 0, 0, 1,
  );
  return m;
}

function eclipseLight(worldPos, sunW) {
  // Cylindrical shadow with a soft edge.
  const p = v3.dot(worldPos, sunW);
  if (p > 0) return 1;
  const perp = v3.magnitude(v3.subtract(worldPos, v3.multiplyByScalar(sunW, p, new v3()), new v3()));
  const e = (perp - 6.371e6) / 6e4;
  return Math.min(1, Math.max(0, 0.5 + e));
}

async function frame(s) {
  const t = tau(s);
  const b = bclock(s);
  const jd = Cesium.JulianDate.addSeconds(Cesium.JulianDate.fromIso8601(D.t0), b, new Cesium.JulianDate());
  Cesium.Transforms.computeTemeToPseudoFixedMatrix(jd, M);
  const cam = camAt(s);

  // Anchor (X36 at backdrop time) and relative state at simulation time.
  const A = x36Teme(b);
  const B = basis(A.r, A.v);
  const rel = relAt(t);
  const x36W = toWorld(A.r);
  const cosW = toWorld(place(A.r, B, rel));
  const RW = toWorld(B.R);
  const TW = toWorld(B.T);
  const NW = toWorld(B.N);
  const sep = v3.distance(x36W, cosW);

  // Camera
  const sunW = v3.normalize(Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(jd, new v3()), new v3());
  Cesium.Matrix3.multiplyByVector(Cesium.Transforms.computeIcrfToFixedMatrix(jd) || M, sunW, sunW);
  v3.normalize(sunW, sunW);
  // Camera orbits a pivot on the X36 -> Cosmos line; aimRel only tilts the gaze.
  const pivot = v3.lerp(x36W, cosW, cam.look, new v3());
  v3.lerp(pivot, v3.ZERO, cam.earth, pivot);
  const aim = v3.clone(pivot);
  v3.add(aim, v3.multiplyByScalar(RW, cam.aimRel[0], new v3()), aim);
  v3.add(aim, v3.multiplyByScalar(TW, cam.aimRel[1], new v3()), aim);
  v3.add(aim, v3.multiplyByScalar(NW, cam.aimRel[2], new v3()), aim);
  const dist = Math.max(cam.dist, cam.f * sep) * (PORTRAIT && cam.earth > 0.5 ? 0.74 : 1);
  const az = Cesium.Math.toRadians(cam.az);
  const el = Cesium.Math.toRadians(cam.el);
  const off = new v3();
  v3.add(off, v3.multiplyByScalar(TW, -Math.cos(el) * Math.cos(az), new v3()), off);
  v3.add(off, v3.multiplyByScalar(NW, Math.cos(el) * Math.sin(az), new v3()), off);
  v3.add(off, v3.multiplyByScalar(RW, Math.sin(el), new v3()), off);
  if (cam.sun > 0) {
    v3.normalize(v3.add(v3.multiplyByScalar(off, 1 - cam.sun, off), v3.multiplyByScalar(sunW, cam.sun, new v3()), off), off);
  }
  const camPos = v3.add(pivot, v3.multiplyByScalar(off, dist, new v3()), new v3());
  if (cam.pairD > 0) {
    // Pair-locked: camera just off X36, angled pairTh from the X36->Cosmos line
    // (sideways, in the orbit's horizontal), aimed at the bisector of the two.
    const u = v3.normalize(v3.subtract(cosW, x36W, new v3()), new v3());
    const perp = v3.normalize(v3.subtract(NW, v3.multiplyByScalar(u, v3.dot(NW, u), new v3()), new v3()), new v3());
    const th = Cesium.Math.toRadians(cam.pairTh);
    v3.add(x36W, v3.multiplyByScalar(u, -cam.pairD * Math.cos(th), new v3()), camPos);
    v3.add(camPos, v3.multiplyByScalar(perp, cam.pairD * Math.sin(th), new v3()), camPos);
    const a1 = v3.normalize(v3.subtract(x36W, camPos, new v3()), new v3());
    const a2 = v3.normalize(v3.subtract(cosW, camPos, new v3()), new v3());
    v3.add(camPos, v3.add(a1, a2, new v3()), aim);
  }
  const minR = 6.371e6 + 1.2e5;
  if (v3.magnitude(camPos) < minR) v3.multiplyByScalar(v3.normalize(camPos, camPos), minR, camPos);
  const dir = v3.normalize(v3.subtract(aim, camPos, new v3()), new v3());
  let right = v3.normalize(v3.cross(dir, RW, new v3()), new v3());
  let up = v3.cross(right, dir, new v3());
  {
    // Composition: put the aim point right of centre in 16:9 (the caption
    // column is on the left); portrait keeps it centred between the text bands.
    const fovR = Cesium.Math.toRadians(PORTRAIT ? cam.fov * 1.55 : cam.fov);
    const aspect = W / H;
    const tanH = PORTRAIT ? Math.tan(fovR / 2) * aspect : Math.tan(fovR / 2);
    const tanV = PORTRAIT ? Math.tan(fovR / 2) : Math.tan(fovR / 2) / aspect;
    const ndcX = (PORTRAIT ? 0 : 0.2) * cam.comp;
    const ndcY = (PORTRAIT ? -0.02 : -0.06) * cam.comp;
    v3.normalize(v3.add(v3.add(dir, v3.multiplyByScalar(right, -ndcX * tanH, new v3()), new v3()),
      v3.multiplyByScalar(up, -ndcY * tanV, new v3()), new v3()), dir);
    right = v3.normalize(v3.cross(dir, RW, new v3()), new v3());
    up = v3.cross(right, dir, new v3());
  }
  scene.camera.setView({ destination: camPos, orientation: { direction: dir, up } });
  scene.camera.frustum.fov = Cesium.Math.toRadians(PORTRAIT ? cam.fov * 1.55 : cam.fov);
  {
    const icrf = Cesium.Transforms.computeIcrfToFixedMatrix(jd) || M;
    const tmp = new v3();
    for (let i = 0; i < starDirs.length; i++) {
      Cesium.Matrix3.multiplyByVector(icrf, starDirs[i], tmp);
      stars.get(i).position = v3.add(camPos, v3.multiplyByScalar(tmp, 3e8, tmp), new v3());
    }
  }
  scene.camera.frustum.near = Math.max(0.2, Math.min(dist * 0.02, 1000));

  // Models: attitude, magnification, lighting
  const camDistX = v3.distance(camPos, x36W);
  const camDistC = v3.distance(camPos, cosW);
  const pxPerRad = (PORTRAIT ? W : W) / (2 * Math.tan(scene.camera.frustum.fov / 2));
  const targetPx = 110 * U; // magnified apparent size
  const magFor = (d, size) => Math.max(1, (targetPx * d) / (pxPerRad * size));
  // One fixed enlargement per beat (keyed), so the on-screen factor holds still.
  const rawMag = cam.mag > 0.5 ? cam.mx : 1;
  const MAG_MAX = 150;
  const mag = rawMag;
  void magFor;
  const nearScale = Math.min(1, Math.max(0, cam.mag * 2));
  mX36.show = (cam.mag > 0.01 && rawMag <= MAG_MAX) || camDistX < 3000;
  mCos.show = (cam.mag > 0.01 && rawMag <= MAG_MAX) || camDistC < 6000;
  mX36.modelMatrix = modelMatrix(x36W, TW, RW, mag);
  // Cosmos points its sensor at X36 when close, otherwise flies prograde.
  const toX = v3.normalize(v3.subtract(x36W, cosW, new v3()), new v3());
  const w = Math.min(1, Math.max(0, (60e3 - sep) / 40e3));
  const cx = v3.normalize(v3.lerp(TW, toX, w, new v3()), new v3());
  const cy = v3.normalize(v3.subtract(RW, v3.multiplyByScalar(cx, v3.dot(RW, cx), new v3()), new v3()), new v3());
  mCos.modelMatrix = modelMatrix(cosW, cx, cy, mag);
  const lx = eclipseLight(x36W, sunW);
  const lc = eclipseLight(cosW, sunW);
  // In Earth's shadow a dim blue fill keeps the shapes legible.
  const lightFor = (l) => new v3(0.6 + (2.3 - 0.6) * l, 0.66 + (2.3 - 0.66) * l, 0.92 + (2.3 - 0.92) * l);
  mX36.lightColor = lightFor(lx);
  mCos.lightColor = lightFor(lc);

  // Glows: shown when the model is too small to read.
  const pxX = (3.25 * mag * pxPerRad) / camDistX;
  const pxC = (3.6 * mag * pxPerRad) / camDistC;
  bX36.position = x36W;
  bCos.position = cosW;
  bX36.scale = (pxX > 24 ? 0.14 : 0.42) * U;
  bCos.scale = (pxC > 24 ? 0.14 : 0.42) * U;
  bX36.color = Cesium.Color.WHITE.withAlpha(pxX > 40 ? 0 : 1);
  bCos.color = Cesium.Color.WHITE.withAlpha(pxC > 40 ? 0 : 1);

  // Burn flare
  let flare = 0;
  for (const bn of BURNS) {
    const sb = sOfTauCached(bn.t);
    const k = (s - sb) / 0.9;
    if (k > -0.08 && k < 1) flare = Math.max(flare, k < 0 ? 1 + k / 0.08 : (1 - k) ** 1.6);
  }
  bBurn.position = cosW;
  bBurn.scale = flare * 0.9 * U;
  bBurn.color = Cesium.Color.WHITE.withAlpha(flare);

  // Trails and reference geometry
  clearDynamic();
  // X36 orbit ring (inertial, at the anchor epoch); fades out up close.
  const ringA = Math.min(1, Math.max(0, (camDistX - 1.5e4) / 6e4));
  if (ringA > 0.01) {
    const P = 5730;
    const pts = [];
    const cols = [];
    const n = 240;
    for (let k = 0; k <= n; k++) {
      const tt = b - P + (k / n) * P;
      pts.push(toWorld(x36Teme(tt).r));
      const a = 0.06 + 0.5 * (k / n) ** 3;
      cols.push(COL_X36.withAlpha(a * ringA));
    }
    polyline(pts, cols, 1.6);
  }
  // Cosmos relative trail, expressed in the current anchor frame
  {
    const span = cam.trail * 3600;
    const n = Math.min(900, Math.max(60, Math.round(span / 45)));
    const pts = [];
    const cols = [];
    for (let k = 0; k <= n; k++) {
      const tt = t - span + (k / n) * span;
      if (tt < 0) continue;
      pts.push(toWorld(place(A.r, B, relAt(tt))));
      cols.push(COL_COS.withAlpha(0.04 + 0.92 * (k / n) ** 1.8));
    }
    pts.push(cosW);
    cols.push(COL_COS.withAlpha(1));
    polyline(pts, cols, 2.4);
  }
  // Separation line when the pair is within view range
  if (sep < 900e3) {
    const a = Math.min(1, (900e3 - sep) / 200e3) * 0.55;
    polyline([x36W, cosW], [Cesium.Color.WHITE.withAlpha(a * 0.25), Cesium.Color.WHITE.withAlpha(a * 0.25)], 1);
  }
  // RIC reference rings (orbital plane) during proximity
  const gridA = Math.min(1, Math.max(0, (8e3 - Math.max(sep, camDistX)) / 3e3)) * (cam.mag > 0.4 ? 1 : 0.35);
  if (gridA > 0.01) {
    for (const r of [500, 1000, 2000]) {
      const pts = [];
      const cols = [];
      for (let k = 0; k <= 120; k++) {
        const a = (k / 120) * Math.PI * 2;
        const p = v3.add(x36W, v3.multiplyByScalar(RW, r * Math.sin(a), new v3()), new v3());
        v3.add(p, v3.multiplyByScalar(TW, r * Math.cos(a), new v3()), p);
        pts.push(p);
        cols.push(Cesium.Color.WHITE.withAlpha(0.16 * gridA));
      }
      polyline(pts, cols, 1);
    }
    const ax = (vec, len, col) => polyline(
      [v3.add(x36W, v3.multiplyByScalar(vec, -len, new v3()), new v3()), v3.add(x36W, v3.multiplyByScalar(vec, len, new v3()), new v3())],
      [col.withAlpha(0), col.withAlpha(0)], 1,
    );
    polyline([x36W, v3.add(x36W, v3.multiplyByScalar(TW, 2600, new v3()), new v3())], [COL_X36.withAlpha(0.5 * gridA), COL_X36.withAlpha(0)], 1.5);
    polyline([x36W, v3.add(x36W, v3.multiplyByScalar(RW, 1400, new v3()), new v3())], [Cesium.Color.WHITE.withAlpha(0.4 * gridA), Cesium.Color.WHITE.withAlpha(0)], 1.5);
    void ax;
  }

  hud.update(s, t, b, { x36W, cosW, RW, TW, NW, rel, sep, mag, gridA, lx, camDistX, jd });
  // Render; re-render only while imagery is still streaming in.
  scene.render(jd);
  // Bounded: parents stand in for children still streaming; sequential frames converge.
  for (let k = 0; k < SETTLE && !(globe.tilesLoaded && mX36.ready && mCos.ready); k++) {
    await new Promise((r) => setTimeout(r, 60));
    scene.render(jd);
  }
  const gl = scene.context._gl;
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const dbg = { pX: Cesium.SceneTransforms.worldToWindowCoordinates(scene, x36W), dX: v3.distance(scene.camera.positionWC, x36W), ang: Cesium.Math.toDegrees(v3.angleBetween(scene.camera.directionWC, v3.subtract(x36W, scene.camera.positionWC, new v3()))), mshow: mX36.show, mm: Cesium.Matrix4.getTranslation(mX36.modelMatrix, new v3()), x36W };
  return { dbg, s, t, b, sep, mag, camR: v3.magnitude(camPos), dist, fov: scene.camera.frustum.fov, fovy: scene.camera.frustum.fovy, aspect: scene.camera.frustum.aspectRatio };
}

const sOfTauMemo = new Map();
function sOfTauCached(t) {
  if (!sOfTauMemo.has(t)) sOfTauMemo.set(t, sOfTau(t));
  return sOfTauMemo.get(t);
}

await document.fonts.ready;
window.rpo = { frame, tau, bclock, duration: DUR, ready: true, CAM };
