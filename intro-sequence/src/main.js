import * as THREE from 'three';
import * as satellite from 'satellite.js';
import { T, FPS, FEEDS, captureTimes, clamp, lerp, ramp, smooth, win, easeInOut, expoOut, mulberry32 } from './timeline.js';
import { llToVec, subsolar, angDist, D2R, R2D, EARTH_KM } from './geo.js';
import { createGlobe } from './globe.js';
import { createCoastline, createBorders, createMycelium, createCables, createArcs, createLattice } from './lines.js';
import { createMovers, createEvents, createSatellites, createOrbitRings, createWind, createStars } from './layers.js';
import { createPost } from './post.js';
import { createHUD } from './hud.js';

const qs = new URLSearchParams(location.search);
const W = +qs.get('w') || 1920;
const H = +qs.get('h') || 1080;
const PORTRAIT = H > W;
const SEED_LL = [0, 0]; // `seed --origin null` — Null Island

const status = (m) => {
  window.__status = m;
  console.log('[gev]', m);
};

async function json(path) {
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn('missing', path, e.message);
    return null;
  }
}
async function text(path) {
  try {
    const r = await fetch(path);
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}
function tex(path, { srgb = true, mips = true } = {}) {
  return new Promise((res) => {
    new THREE.TextureLoader().load(
      path,
      (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.generateMipmaps = mips;
        t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        t.wrapS = THREE.RepeatWrapping;
        res(t);
      },
      undefined,
      () => {
        console.warn('missing texture', path);
        const d = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        d.needsUpdate = true;
        res(d);
      },
    );
  });
}
function img(path) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = path;
  });
}

// ------------------------------------------------------------------ boot
async function init() {
  status('loading');
  const canvas = document.getElementById('c');
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  await document.fonts.ready;
  await Promise.all([
    document.fonts.load('400 20px "JetBrains Mono"'),
    document.fonts.load('500 20px "JetBrains Mono"'),
    document.fonts.load('200 20px Inter'),
    document.fonts.load('300 20px Inter'),
    document.fonts.load('500 20px Inter'),
  ]);

  const [flights, mil, vessels, quakes, fires, wind, cables, coast, borders, cities, airports, radio, bikes, tleText, tleGroups, heroIdx, camIdx, extra, plants, pads] =
    await Promise.all([
      json('data/flights.json'),
      json('data/military.json'),
      json('data/vessels.json'),
      json('data/quakes.json'),
      json('data/fires.json'),
      json('data/wind.json'),
      json('data/cables.json'),
      json('data/coastline.json'),
      json('data/borders.json'),
      json('data/cities.json'),
      json('data/airports.json'),
      json('data/radio.json'),
      json('data/bikes.json'),
      text('data/tle.txt'),
      json('data/tle_groups.json'),
      json('imagery/hero/index.json'),
      json('cctv/index.json'),
      json('data/extra_counts.json'),
      json('data/power_plants.json'),
      json('data/launch_sites.json'),
    ]);

  const [dayTex, nightTex, cloudTex] = await Promise.all([
    tex('imagery/earth_day.jpg'),
    tex('imagery/earth_night.jpg'),
    tex('imagery/clouds.jpg', { srgb: false }),
  ]);

  // Hero captures (Esri synthetic screenshots) and CCTV stills
  const heroes = [];
  for (const h of heroIdx || []) {
    const [wide, close] = await Promise.all([img(`imagery/hero/${h.slug}_wide.jpg`), img(`imagery/hero/${h.slug}_close.jpg`)]);
    if (wide && close) heroes.push({ ...h, wide, close });
  }
  const cams = [];
  for (const c of camIdx || []) {
    const im = await img(`cctv/${c.file}`);
    if (im) cams.push({ ...c, img: im });
  }
  status(`assets: ${heroes.length} heroes, ${cams.length} cams`);

  // ---------------------------------------------------------------- scene
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const FOV = 26;
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.005, 3000);

  const snapT = new Date((flights?.t || Date.now() / 1000) * 1000);
  const sunLL = subsolar(snapT);
  const sunV = new THREE.Vector3(...llToVec(sunLL[0], sunLL[1]));

  const globe = createGlobe({ dayTex, nightTex, cloudTex });
  globe.uniforms.uSeed.value.set(...llToVec(SEED_LL[0], SEED_LL[1]));
  globe.uniforms.uSun.value.copy(sunV);
  globe.uniforms.uWave.value.set(...T.zWave);
  scene.add(globe.group);

  const stars = createStars();
  scene.add(stars.group);

  const coastline = coast ? createCoastline(coast.lines, SEED_LL) : null;
  const borderL = borders ? createBorders(borders.lines, SEED_LL) : null;
  const myc = createMycelium(SEED_LL);
  [coastline, borderL, myc].forEach((o) => o && scene.add(o));

  const cableL = cables ? createCables(cables.cables) : null;
  if (cableL) scene.add(cableL);

  // live feeds
  const L = {};
  if (flights) L.air = createMovers(flights.rows, { color: '#e8fbff', trailColor: '#4fd8ff', size: 2.0, altScale: 10, seed: 2 });
  if (mil) L.mil = createMovers(mil.rows, { color: '#ffbf5a', trailColor: '#ff9a2a', size: 4.0, altScale: 10, revealSpread: 0.6, seed: 4 });
  if (vessels) L.sea = createMovers(vessels.rows.map((r) => [r[0], r[1], 0, r[3], (r[2] || 0) * 0.5144]), { color: '#52ffc8', trailColor: '#1fd6a0', size: 1.5, gain: 0.45, altScale: 0, seed: 6 });
  const quakeRowsX = (quakes?.rows || []).filter((r) => r[3] >= 2.5).map((r) => [r[0], r[1], r[3]]);
  const quakeRows = quakeRowsX;
  L.quake = createEvents(quakeRows, { color: '#ff3d3d', size: 1.6, mode: 'ring', weightFn: (m) => clamp((m - 2.4) / 4.5, 0.05, 1.3), spread: 1.6 });
  const fireRows = (fires?.rows || []).map((r) => [r[0], r[1], r[2]]);
  L.fire = createEvents(fireRows, { color: '#ff6a14', size: 1.15, gain: 0.32, mode: 'flicker', weightFn: (f) => clamp(Math.log10(1 + f) / 2.5, 0, 1.2), spread: 1.4 });
  if (wind) L.wind = createWind(wind, { count: PORTRAIT ? 6000 : 7000 });
  Object.values(L).forEach((l) => scene.add(l.group));

  // satellites
  const sats = [];
  if (tleText) {
    const lines = tleText.split(/\r?\n/).map((s) => s.trimEnd()).filter(Boolean);
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith('1 ') && lines[i + 1].startsWith('2 ')) {
        const name = i > 0 && !lines[i - 1].startsWith('2 ') && !lines[i - 1].startsWith('1 ') ? lines[i - 1].replace(/^0 /, '').trim() : '';
        try {
          const rec = satellite.twoline2satrec(lines[i], lines[i + 1]);
          sats.push({ rec, name, norad: +lines[i].slice(2, 7) || 0 });
        } catch {}
        i++;
      }
    }
  }
  const stationSet = new Set(tleGroups?.groups_norad?.stations || [25544]);
  const satL = createSatellites(Math.max(1, sats.length));
  sats.forEach((s, i) => (satL.kind[i] = stationSet.has(s.norad) ? 1 : 0));
  satL.group.geometry.getAttribute('aK').needsUpdate = true;
  scene.add(satL.group);
  const satByNorad = new Map(sats.map((s, i) => [s.norad, i]));

  // orbit rings in an ECI-aligned group, rotated by -GMST each frame
  const ringGroup = new THREE.Group();
  scene.add(ringGroup);
  // LEO rings for the orbital beat; GPS/GEO rings only once the camera is far out
  const ringIds = [25544, 20580, 48274, 41866, 51850, 40105, 28474, 43226];
  const ringPaths = [];
  const highPaths = [];
  for (const id of ringIds) {
    const i = satByNorad.get(id);
    if (i === undefined) continue;
    const rec = sats[i].rec;
    const period = (2 * Math.PI) / rec.no; // minutes
    const path = [];
    for (let k = 0; k <= 240; k++) {
      const d = new Date(snapT.getTime() + (k / 240) * period * 60000);
      const pv = satellite.propagate(rec, d);
      if (!pv.position) continue;
      const p = pv.position;
      path.push([p.x / EARTH_KM, p.z / EARTH_KM, -p.y / EARTH_KM]);
    }
    if (path.length > 10) (Math.hypot(...path[0]) < 1.3 ? ringPaths : highPaths).push(path);
  }
  const rings = createOrbitRings(ringPaths);
  const ringsHigh = createOrbitRings(highPaths, '#a9a2ff');
  ringGroup.add(rings, ringsHigh);

  // data arcs for saturation: between big cities, cameras and cable ends
  const arcPairs = [];
  {
    const r = mulberry32(42);
    const pool = (cities?.rows || []).slice(0, 400).map((c) => [c[0], c[1]]);
    for (let i = 0; i < 150 && pool.length > 2; i++) {
      const a = pool[Math.floor(Math.pow(r(), 1.6) * pool.length)];
      const b = pool[Math.floor(r() * pool.length)];
      if (angDist(a[0], a[1], b[0], b[1]) > 0.15) arcPairs.push([a, b]);
    }
  }
  const arcs = createArcs(arcPairs);
  scene.add(arcs);

  const lattice = createLattice();
  scene.add(lattice);

  const pxScale = Math.min(W, H) / 1080;
  for (const l of [...Object.values(L), satL, stars]) if (l.uniforms.uPx) l.uniforms.uPx.value = pxScale;

  // ---------------------------------------------------------------- HUD + post
  const hudCanvas = document.createElement('canvas');
  hudCanvas.width = W;
  hudCanvas.height = H;
  const post = createPost(renderer, W, H, hudCanvas);
  const hudCtx = hudCanvas.getContext('2d');

  const counts = {
    air: flights?.rows.length || 0,
    mil: mil?.rows.length || 0,
    sea: vessels?.rows.length || 0,
    orbit: sats.length,
    quake: quakes?.rows.length || 0,
    fire: fires?.rows.length || 0,
    wind: wind ? wind.nx * wind.ny : 0,
    cable: cables?.cables.length || 0,
    cctv: extra?.cctv_catalog || cams.length,
    cities: cities?.rows.length || 0,
    cctvCountries: extra?.cctv_countries || new Set(cams.map((c) => c.country)).size,
    cctvSources: extra?.cctv_sources ? Object.keys(extra.cctv_sources).length : new Set(cams.map((c) => c.source)).size,
  };
  const rapidList = [];
  if (airports) rapidList.push(['AIRPORTS', airports.rows.length]);
  if (radio) rapidList.push(['RADIO STATIONS', radio.rows.length]);
  if (bikes) rapidList.push(['BIKESHARE STATIONS', bikes.rows.length]);
  if (plants) rapidList.push(['POWER PLANTS', plants.rows.length]);
  if (pads) rapidList.push(['LAUNCH PADS', pads.rows.length]);
  rapidList.push(['POPULATED PLACES', counts.cities]);
  rapidList.push(['LAND BORDERS', borders?.lines.length || 0]);

  // notable callouts — real records picked from the feeds
  const pick = {
    flights: pickFlights(flights),
    mil: (mil?.rows || []).filter((r) => r[5] && r[7] && r[2] > 1500 && r[4] > 80).slice(0, 8),
    ships: (vessels?.rows || []).filter((r) => r[5] && r[2] > 6).slice(0, 40),
    quakeTop: (quakes?.rows || []).slice().sort((a, b) => b[3] - a[3]).slice(0, 4),
    fireTop: (fires?.rows || []).slice().sort((a, b) => b[2] - a[2]).slice(0, 3),
    cities: (cities?.rows || []).slice(0, 220),
  };

  const capT = captureTimes(heroes.length);
  const hud = createHUD({ W, H, PORTRAIT, heroes, cams, counts, rapidList, pick, capT, snapT, sunLL });

  // ---------------------------------------------------------------- camera director
  // Keys: [t, lon, lat, g (globe radius / half the short side), shiftX, shiftY, roll]
  const sx = PORTRAIT ? 0 : 0.26;
  const sy = PORTRAIT ? 0.2 : 0;
  const KEYS = [
    [0, 0, 0, 0.6, 0, 0, 0],
    [8.7, 0, 0, 0.6, 0, 0, 0],
    [16.6, -1.5, 1.5, 0.62, 0, 0, 0],
    [19.5, 4, 6, 0.7, 0, 0, -0.01],
    [24.5, 18, 16, 0.75, 0, 0, -0.02],
    [30.0, 24, 36, 0.98, sx * 0.5, sy * 0.5, -0.02],
    [32.5, 14, 58, 1.85, sx, sy, -0.03],
    [33.7, 8, 59, 1.9, sx, sy, -0.03],
    [35.9, -55, 43, 1.0, sx, sy, -0.01],
    [37.2, -82, 38, 0.92, sx, sy, 0.0],
    [40.0, -110, 26, 0.42, sx, sy, 0.02],
    [42.6, -150, 18, 0.62, sx, sy, 0.02],
    [44.4, -190, 2, 0.7, sx, sy, 0.01],
    [46.4, -215, 4, 0.78, sx, sy, 0.0],
    [49.0, -228, 14, 0.85, sx, sy, 0.0],
    [52.4, -236, 20, 0.85, sx * 0.4, sy * 0.4, 0.0],
    [56.0, -258, 24, 0.5, 0, 0, 0.0],
    [60.5, -288, 22, 0.16, 0, 0, 0.0],
  ];
  // Title framing: the planet becomes the iris of the logo.
  const eye = hud.eyeLayout;

  function camAt(t) {
    if (t >= T.title - 0.05) {
      const g = eye.irisR / (Math.min(W, H) / 2);
      const k = t - T.title;
      return { lon: 108 + k * 1.6, lat: 12, g, shiftX: 0, shiftY: (H / 2 - eye.cy) / (Math.min(W, H) / 2), roll: 0 };
    }
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const k0 = KEYS[Math.max(0, i - 1)];
    const k1 = KEYS[i];
    const k2 = KEYS[i + 1];
    const k3 = KEYS[Math.min(KEYS.length - 1, i + 2)];
    const u = clamp((t - k1[0]) / (k2[0] - k1[0]));
    const out = [];
    for (let c = 1; c < 7; c++) {
      const dt = k2[0] - k1[0];
      const m1 = ((k2[c] - k0[c]) / Math.max(1e-3, k2[0] - k0[0])) * dt;
      const m2 = ((k3[c] - k1[c]) / Math.max(1e-3, k3[0] - k1[0])) * dt;
      const u2 = u * u;
      const u3 = u2 * u;
      out[c] = (2 * u3 - 3 * u2 + 1) * k1[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[c] + (u3 - u2) * m2;
    }
    // breathing drift so the shot never feels locked off
    const drift = smooth(t, 8, 12);
    return {
      lon: out[1] + Math.sin(t * 0.21) * 0.6 * drift,
      lat: out[2] + Math.sin(t * 0.17 + 1.3) * 0.4 * drift,
      g: out[3],
      shiftX: out[4],
      shiftY: out[5],
      roll: out[6],
    };
  }

  const HITS = [
    [T.collapse, 0.5],
    [T.substrate, 0.7],
    [T.indexed, 0.9],
    [T.cctvWall, 0.5],
    [T.cctvOut, 0.6],
    [T.dishBreak, 1.0],
    [T.eyeOpen, 0.4],
  ];
  function impulse(t, decay = 6) {
    let v = 0;
    for (const [h, a] of HITS) if (t >= h) v += a * Math.exp(-(t - h) * decay);
    return v;
  }

  function placeCamera(t) {
    const c = camAt(t);
    const minDim = Math.min(W, H);
    const tanHalf = Math.tan((FOV * D2R) / 2);
    const tanA = (c.g * minDim) / H * tanHalf;
    const dist = 1 / Math.sin(Math.atan(tanA));
    const shake = impulse(t, 9) * 0.0025;
    const sh1 = Math.sin(t * 91.0) * shake;
    const sh2 = Math.cos(t * 77.0) * shake;
    camera.position.set(...llToVec(c.lon, c.lat, dist));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.rotateZ(c.roll + sh1 * 2);
    camera.near = Math.max(0.002, dist - 30);
    camera.far = dist + 2000;
    // shift the globe on screen without changing perspective
    const offX = -c.shiftX * (minDim / 2) + sh1 * W;
    const offY = c.shiftY * (minDim / 2) + sh2 * H;
    camera.setViewOffset(W, H, offX, offY, W, H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return { ...c, dist };
  }

  // ---------------------------------------------------------------- per-frame state
  const tmpV = new THREE.Vector3();
  function project(lon, lat, r = 1) {
    tmpV.set(...llToVec(lon, lat, r));
    const n = tmpV.clone().normalize();
    const toCam = camera.position.clone().sub(tmpV).normalize();
    const facing = r <= 1.2 ? n.dot(toCam) : 1;
    tmpV.project(camera);
    return { x: (tmpV.x * 0.5 + 0.5) * W, y: (-tmpV.y * 0.5 + 0.5) * H, vis: facing > 0.05 && tmpV.z < 1, facing };
  }
  function projectVec(v) {
    tmpV.set(v[0], v[1], v[2]);
    tmpV.project(camera);
    return { x: (tmpV.x * 0.5 + 0.5) * W, y: (-tmpV.y * 0.5 + 0.5) * H, z: tmpV.z };
  }

  function frontAngle(t) {
    if (t < T.growStart) return -1;
    const x = ramp(t, T.growStart, T.growEnd);
    const k = 3;
    const base = Math.PI * (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
    return base + Math.max(0, t - T.growEnd) * 0.6;
  }

  const satScratch = { idx: -1 };
  function updateSatellites(t, simDate) {
    const gmst = satellite.gstime(simDate);
    ringGroup.rotation.y = -gmst;
    if (satScratch.t === t) return gmst;
    satScratch.t = t;
    const p = satL.positions;
    for (let i = 0; i < sats.length; i++) {
      const pv = satellite.propagate(sats[i].rec, simDate);
      const e = pv && pv.position;
      if (!e || isNaN(e.x)) {
        p[i * 3] = p[i * 3 + 1] = p[i * 3 + 2] = 0;
        continue;
      }
      const ecf = satellite.eciToEcf(e, gmst);
      p[i * 3] = ecf.x / EARTH_KM;
      p[i * 3 + 1] = ecf.z / EARTH_KM;
      p[i * 3 + 2] = -ecf.y / EARTH_KM;
    }
    satL.attr.needsUpdate = true;
    return gmst;
  }

  function feedAlpha(t, start) {
    // everything stays on through saturation, then clears for the title
    return smooth(t, start, start + 0.25) * (1 - smooth(t, T.cut - 0.05, T.cut));
  }

  function renderFrame(frame) {
    const t = frame / FPS;
    const cam = placeCamera(t);
    const G = globe.uniforms;
    const front = frontAngle(t);
    const titleOn = t >= T.title - 0.05;

    G.uTime.value = t;
    G.uFront.value = titleOn ? 10 : front;
    G.uHolo.value = smooth(t, T.growStart - 0.4, T.growStart + 1.2) * (1 - smooth(t, T.indexed - 1, T.indexed + 1));
    G.uLights.value = smooth(t, T.growStart, T.growStart + 0.8);
    G.uImagery.value = titleOn ? 1 : smooth(t, 26.5, 29.5);
    G.uLit.value = titleOn ? 1 : smooth(t, 22.6, 26.0);
    G.uGridAmt.value = titleOn ? 0 : 1;
    G.uDim.value = 1 - 0.35 * win(t, T.cctvWall - 0.2, T.cctvOut + 0.3, 0.3, 0.3);
    globe.cloudU.uAmt.value = titleOn ? 0.6 : smooth(t, T.wind, T.wind + 1.6) * 0.62;
    globe.atmoU.uAmt.value = titleOn ? 1 : smooth(t, 21.0, 25.0);
    globe.group.children[1].visible = globe.cloudU.uAmt.value > 0.0005;
    globe.group.children[2].visible = globe.atmoU.uAmt.value > 0.0005;
    globe.group.visible = !(t >= T.cut && t < T.title - 0.05) && t >= T.seed - 0.1;

    stars.uniforms.uAlpha.value = titleOn ? 0.5 : smooth(t, T.substrate - 0.5, T.substrate + 2.5) * 0.85 * (t < T.cut ? 1 : 0);

    const vecFade = 1 - smooth(t, T.indexStart + 1.5, T.indexed - 2);
    if (coastline) {
      coastline.material.uniforms.uFront.value = front;
      coastline.material.uniforms.uAlpha.value = 0.95 * vecFade;
      coastline.visible = vecFade > 0.001 && !titleOn;
    }
    if (borderL) {
      borderL.material.uniforms.uFront.value = front - 0.25;
      borderL.material.uniforms.uAlpha.value = 0.7 * vecFade;
      borderL.visible = vecFade > 0.001 && !titleOn;
    }
    myc.material.uniforms.uFront.value = front;
    myc.material.uniforms.uAlpha.value = 0.85 * (1 - smooth(t, T.substrate, T.indexStart + 3));
    myc.visible = t > T.growStart && t < T.indexStart + 3.2;

    // feeds
    const dens = clamp((cam.g - 0.12) / 0.75, 0.22, 1);
    const reveal = (start, dur = 1.6, spread = 1.4) => ((t - start) * (1 + spread)) / dur;
    const setMover = (l, start, accel) => {
      if (!l) return;
      l.uniforms.uSim.value = Math.max(0, t - start) * accel;
      l.uniforms.uReveal.value = reveal(start, 1.6, l.uniforms.uSpread.value);
      l.uniforms.uAlpha.value = feedAlpha(t, start) * dens;
      l.group.visible = t >= start && t < T.cut;
    };
    setMover(L.air, T.air, 140);
    setMover(L.mil, T.mil, 140);
    setMover(L.sea, T.sea, 1800);
    const setEv = (l, start, dur = 1.8) => {
      if (!l) return;
      l.uniforms.uT.value = t;
      l.uniforms.uReveal.value = reveal(start, dur, l.uniforms.uSpread.value);
      l.uniforms.uAlpha.value = feedAlpha(t, start) * dens;
      l.group.visible = t >= start && t < T.cut;
    };
    setEv(L.quake, T.quake, 1.6);
    setEv(L.fire, T.fire, 1.5);
    if (L.fire) L.fire.uniforms.uAlpha.value *= dens;
    if (L.wind) {
      const on = t >= T.wind && t < T.cut;
      L.wind.group.visible = on;
      if (on) {
        L.wind.update(t - T.wind);
        L.wind.uniforms.uAlpha.value = feedAlpha(t, T.wind) * 2.2 * dens;
      }
    }
    if (cableL) {
      const u = cableL.material.uniforms;
      u.uT.value = t;
      u.uDraw.value = ramp(t, T.cable, T.cable + 1.8);
      u.uAlpha.value = feedAlpha(t, T.cable) * 0.9;
      cableL.visible = t >= T.cable && t < T.cut;
    }

    // satellites + rings
    const satOn = t >= T.orbit && t < T.cut;
    const simDate = new Date(snapT.getTime() + Math.max(0, t - T.orbit) * 45 * 1000);
    satL.group.visible = satOn;
    rings.visible = satOn;
    let gmst = satellite.gstime(simDate);
    if (satOn) {
      gmst = updateSatellites(t, simDate);
      satL.uniforms.uReveal.value = reveal(T.orbit, 1.8, 1.3);
      satL.uniforms.uAlpha.value = feedAlpha(t, T.orbit) * Math.max(0.45, dens);
      rings.material.uniforms.uDraw.value = easeInOut(ramp(t, T.orbit + 0.3, T.orbit + 2.4));
      rings.material.uniforms.uAlpha.value = feedAlpha(t, T.orbit) * 0.8;
    }
    ringsHigh.visible = t >= T.saturate + 1 && t < T.cut;
    ringsHigh.material.uniforms.uDraw.value = easeInOut(ramp(t, T.saturate + 1, T.saturate + 3.5));
    ringsHigh.material.uniforms.uAlpha.value = feedAlpha(t, T.saturate + 1) * 0.7;

    // saturation: arcs + lattice
    arcs.visible = t >= T.arcs && t < T.cut;
    arcs.material.uniforms.uT.value = t - T.arcs;
    arcs.material.uniforms.uAlpha.value = feedAlpha(t, T.arcs) * 0.9;
    const twinOn = t >= T.twin && t < T.cut;
    lattice.visible = twinOn;
    if (twinOn) {
      lattice.scale.setScalar(latticeScale(t, cam.dist));
      lattice.rotation.y = t * 0.05;
      const lu = lattice.material.uniforms;
      lu.uBuild.value = ramp(t, T.twin, T.twin + 2.6);
      lu.uT.value = t;
      lu.uAlpha.value = smooth(t, T.twin, T.twin + 0.6) * (1 - smooth(t, T.cut - 0.4, T.cut)) * 0.7;
    }

    // ---- HUD
    const S = {
      t,
      frame,
      cam,
      front,
      gmst,
      simDate,
      project,
      projectVec,
      satPos: (norad) => {
        const i = satByNorad.get(norad);
        if (i === undefined) return null;
        const p = satL.positions;
        return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
      },
      limbR: limbRadiusPx(cam.dist),
      center: project(...[cam.lon, cam.lat], 0), // screen position of the globe centre
      flightPos: (row, accel) => {
        const sim = Math.max(0, t - T.air) * accel;
        return advance(row, sim);
      },
      shipPos: (row) => advance([row[0], row[1], 0, row[3], (row[2] || 0) * 0.5144], Math.max(0, t - T.sea) * 1800),
    };
    S.center = projectVec([0, 0, 0]);
    S.ctx = hudCtx;
    S.camPos = camera.position;
    S.latticeR = latticePx(t, cam.dist);
    S.ringR = ringR0;
    hud.draw(S);

    // ---- post
    const glitch =
      win(t, T.collapse - 0.05, T.collapse + 0.35, 0.02, 0.2) * 0.8 +
      win(t, T.substrate - 0.02, T.substrate + 0.25, 0.02, 0.2) * 0.5 +
      win(t, T.indexed - 0.02, T.indexed + 0.3, 0.02, 0.25) * 0.7 +
      win(t, T.cctvWall - 0.02, T.cctvWall + 0.2, 0.02, 0.15) * 0.5 +
      win(t, T.cctvOut - 0.05, T.cctvOut + 0.3, 0.02, 0.25) * 0.8 +
      win(t, T.dishBreak - 0.02, T.dishBreak + 0.4, 0.02, 0.3) * 1.0 +
      win(t, T.cut - 0.25, T.cut, 0.1, 0.01) * 1.0 +
      win(t, T.eyeOpen - 0.02, T.eyeOpen + 0.2, 0.02, 0.15) * 0.4;
    const flash =
      Math.exp(-Math.max(0, t - T.substrate) * 12) * 0.035 * (t >= T.substrate ? 1 : 0) +
      Math.exp(-Math.max(0, t - T.indexed) * 12) * 0.05 * (t >= T.indexed ? 1 : 0) +
      Math.exp(-Math.max(0, t - T.dishBreak) * 10) * 0.06 * (t >= T.dishBreak ? 1 : 0) +
      Math.exp(-Math.max(0, t - T.eyeOpen) * 10) * 0.05 * (t >= T.eyeOpen ? 1 : 0);
    let fade = smooth(t, 0, 0.6);
    if (t >= T.cut && t < T.title) fade = 0;
    fade *= 1 - smooth(t, T.fadeOut, DURATION_END);
    post.render(scene, camera, {
      time: t,
      frame,
      bloom: t < T.seed ? 0.7 : lerp(0.85, 1.15, smooth(t, T.saturate, T.cut)),
      bloomThresh: 0.78,
      exposure: 1.0,
      aberr: titleOn ? 0.00025 + glitch * 0.004 : 0.0012 + 0.002 * smooth(t, T.saturate, T.cut) + glitch * 0.004,
      grain: 0.05,
      vignette: 0.6,
      glitch,
      scan: t < T.seed ? 0.7 : 0.12,
      flash,
      fade,
      hudGain: 1.0,
    });
  }

  const RING_R = Math.min(W, H) * (PORTRAIT ? 0.43 : 0.4);
  function latticePx(t, dist) {
    const limb = limbRadiusPx(dist) * 1.12;
    if (t < T.dishBreak) return lerp(limb, RING_R, Math.pow(easeInOut(ramp(t, T.twin, T.dishBreak)), 1.2));
    return RING_R * (1 + 1.6 * Math.pow(ramp(t, T.dishBreak, T.cut), 0.8));
  }
  function latticeScale(t, dist) {
    const px = latticePx(t, dist);
    const tanA = (px / (H / 2)) * Math.tan((FOV * D2R) / 2);
    return dist * Math.sin(Math.atan(tanA));
  }
  function limbRadiusPx(dist) {
    const tanA = Math.tan(Math.asin(1 / dist));
    return (tanA / Math.tan((FOV * D2R) / 2)) * (H / 2);
  }

  function advance(row, sim) {
    // row: [lon, lat, alt, track, vel(m/s)] -> [lon, lat] after sim seconds
    const d = ((row[4] || 0) / (EARTH_KM * 1000)) * sim;
    const b = (row[3] || 0) * D2R;
    const la = row[1] * D2R;
    const lo = row[0] * D2R;
    const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lon2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
    return [lon2 * R2D, lat2 * R2D, row[2] || 0];
  }

  // the dish's second coming is sized so the twin breaches it exactly on cue
  const ringR0 = RING_R;

  window.GEV = { renderFrame, ready: true, W, H, frames: Math.round(DURATION_END * FPS), counts, heroes: heroes.length, cams: cams.length, capT };
  status('ready');
  if (qs.has('play')) startPlayback(renderFrame);
}

const DURATION_END = 72;

// Real-time mode (?play): the same deterministic frames, driven by the audio
// clock, for use as a live loading sequence on a GPU. Browsers block audio
// until a gesture, so the first click starts it.
function startPlayback(renderFrame) {
  const audio = new Audio('audio/score.wav');
  const cv = document.getElementById('c');
  cv.style.cssText = 'width:100vw;height:100vh;object-fit:contain;display:block';
  const gate = document.createElement('div');
  gate.textContent = 'CLICK TO INITIALISE';
  gate.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#00f6ff;font:500 14px "JetBrains Mono";letter-spacing:6px;cursor:pointer;background:#000';
  document.body.appendChild(gate);
  gate.addEventListener('click', () => {
    gate.remove();
    audio.play().catch(() => {});
    const t0 = performance.now();
    const tick = () => {
      const t = audio.currentTime > 0 ? audio.currentTime : (performance.now() - t0) / 1000;
      if (t < DURATION_END) {
        renderFrame(Math.min(DURATION_END * FPS - 1, Math.floor(t * FPS)));
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

function pickFlights(f) {
  if (!f) return [];
  // long-haul, high, fast, with recognisable callsigns
  return f.rows
    .filter((r) => r[5] && r[2] > 9000 && r[4] > 220 && /^[A-Z]{3}\d/.test(r[5]))
    .sort((a, b) => b[4] - a[4])
    .slice(0, 120);
}

init().catch((e) => {
  status('error: ' + e.message);
  console.error(e);
});
