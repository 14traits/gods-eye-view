/* World: time, sun, 44-layer catalog, GPU buffers, per-frame update, render, projection, picking. */
const W = (GE.world = {});
const FAM = {
  sky: { name: 'Sky', color: '#7CC4FF', icon: 'airplane' },
  sea: { name: 'Sea', color: '#38E1C6', icon: 'ferry' },
  orbit: { name: 'Orbit', color: '#C9A7FF', icon: 'satellite' },
  haz: { name: 'Hazards', color: '#FF6A3D', icon: 'flame' },
  eyes: { name: 'Eyes', color: '#FFD166', icon: 'eye' },
  ground: { name: 'Ground', color: '#9BE15D', icon: 'tram' },
  wx: { name: 'Weather', color: '#8AB4F8', icon: 'cloud' },
  infra: { name: 'Infra', color: '#B8C0CC', icon: 'bolt' },
};
GE.FAM = FAM;
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/* ---------- layer catalog (44) ---------- */
const L = (id, fam, name, on, icon) => ({ id, fam, name, on, icon, count: 0, status: 'live' });
W.layers = [
  L('flights', 'sky', 'Commercial flights', true, 'airplane'), L('military', 'sky', 'Military aircraft', true, 'jet'), L('helis', 'sky', 'Helicopters', true, 'helicopter'),
  L('ga', 'sky', 'Private / GA', false, 'propeller'), L('squawk', 'sky', 'Emergency squawks', true, 'exclamation'), L('drones', 'sky', 'Drones (Remote ID)', true, 'drone'),
  L('airports', 'sky', 'Airport boards', false, 'board'), L('holding', 'sky', 'Holding patterns', true, 'loop'),
  L('ais', 'sea', 'AIS vessels', true, 'ferry'), L('ports', 'sea', 'Ports', false, 'anchor'), L('tankers', 'sea', 'Tankers / cargo', false, 'drop'),
  L('fishing', 'sea', 'Fishing effort', false, 'fish'), L('dark', 'sea', 'Dark vessels (AIS gaps)', false, 'eyeslash'), L('cables', 'sea', 'Submarine cables', false, 'cable'),
  L('sats', 'orbit', 'Satellites (TLE)', true, 'satellite'), L('crewed', 'orbit', 'ISS & crewed', true, 'iss'), L('trains', 'orbit', 'Starlink trains', true, 'train'),
  L('launches', 'orbit', 'Launches & trajectories', true, 'rocket'), L('debris', 'orbit', 'Debris', false, 'debris'), L('tracks', 'orbit', 'Ground tracks & passes', true, 'orbitpath'),
  L('quakes', 'haz', 'Earthquakes', true, 'wave'), L('fires', 'haz', 'Active fires (FIRMS)', true, 'flame'), L('perims', 'haz', 'Fire perimeters', false, 'perimeter'),
  L('floods', 'haz', 'Floods', true, 'drop'), L('cyclones', 'haz', 'Tropical cyclones', true, 'hurricane'), L('volcanoes', 'haz', 'Volcanoes', false, 'mountain'),
  L('aq', 'haz', 'Air quality', false, 'aqi'),
  L('cctv', 'eyes', 'Public CCTV', true, 'video'), L('signed', 'eyes', 'Signed captures', true, 'seal'), L('street', 'eyes', 'Street-level imagery', false, 'binoculars'),
  L('holo', 'eyes', 'Holograms', true, 'cube'), L('streams', 'eyes', 'Live streams', false, 'live'),
  L('transit', 'ground', 'Transit vehicles', false, 'tram'), L('traffic', 'ground', 'Traffic flow', true, 'car'), L('bikes', 'ground', 'Bike share', false, 'bike'),
  L('rail', 'ground', 'Rail', false, 'rail'), L('venues', 'ground', 'Events & venues', true, 'ticket'), L('alpr', 'ground', 'ALPR cameras', false, 'plate'),
  L('radar', 'wx', 'Radar', false, 'radar'), L('clouds', 'wx', 'Clouds', true, 'cloud'), L('lightning', 'wx', 'Lightning', true, 'bolt'),
  L('wind', 'wx', 'Wind', false, 'wind'), L('models', 'wx', 'Forecast models', false, 'spaghetti'),
  L('dc', 'infra', 'Datacenters', false, 'server'), L('dams', 'infra', 'Dams', false, 'dam'), L('power', 'infra', 'Power plants', false, 'bolt'),
  L('milbase', 'infra', 'Military installations', false, 'shield'), L('gnss', 'infra', 'GNSS interference', false, 'jam'), L('imagery', 'infra', 'Recent satellite imagery', false, 'frame'),
];
W.layerById = Object.fromEntries(W.layers.map((l) => [l.id, l]));
W.on = (id) => !!W.layerById[id]?.on;

/* ---------- time ---------- */
W.offsetH = 0; W.live = true; W.simMs = NOW; W.t = 0; W.sun = astro.sun(NOW);
W.window = null;
W.getWindow = () => W.window || { start: Date.now() - 72 * 3600000, end: Date.now() + 120 * 3600000 };
W.setWindow = (w) => { W.window = w; bus.emit('window', w); };
W.setTime = function (ms) {
  if (ms == null && !W.window) { W.live = true; W.offsetH = 0; }
  else { const win = W.getWindow(); if (ms == null) ms = (win.start + win.end) / 2; ms = clamp(ms, win.start, win.end); W.offsetH = (ms - Date.now()) / 3600000; W.live = !W.window && Math.abs(W.offsetH) < 1 / 120; }
  W.simMs = Date.now() + W.offsetH * 3600000;
  bus.emit('time', W.offsetH);
};
W.timeWindow = () => ({ ...W.getWindow(), now: Date.now() });
W.userHolos = [];

/* ---------- static data for layers ---------- */
const RS = rng(77);
const near = (lat, lon, km, n, f) => { const out = []; for (let i = 0; i < n; i++) { const [a, b] = geo.dest(lat, lon, RS() * TAU, Math.sqrt(RS()) * km); out.push(f ? f(a, b, i) : [a, b]); } return out; };
const BIG_CITIES = GE.CITY_V.slice(0, 32);
const PORTS = [[51.95,4.05,'Rotterdam'],[1.26,103.84,'Singapore'],[31.36,121.6,'Shanghai'],[22.3,114.2,'Hong Kong'],[35.1,129.04,'Busan'],[25.0,55.06,'Jebel Ali'],[33.74,-118.26,'Los Angeles / Long Beach'],[53.54,9.97,'Hamburg'],[51.27,4.3,'Antwerp'],[29.6,32.55,'Suez'],[31.25,32.3,'Port Said'],[40.67,-74.05,'New York / NJ'],[-23.96,-46.3,'Santos'],[13.08,100.9,'Laem Chabang'],[22.6,120.27,'Kaohsiung'],[34.6,135.4,'Osaka'],[35.43,139.65,'Yokohama'],[-33.86,151.2,'Sydney'],[47.6,-122.35,'Seattle'],[30.6,122.08,'Ningbo'],[36.1,120.3,'Qingdao'],[9.35,-79.9,'Colón'],[8.95,-79.55,'Balboa'],[-33.9,18.43,'Cape Town'],[6.43,3.38,'Lagos'],[37.94,23.62,'Piraeus'],[44.4,8.9,'Genoa'],[43.3,5.35,'Marseille'],[29.75,-95.0,'Houston'],[19.0,72.85,'Mumbai (JNPT)']];
const VOLCANOES = [[37.75,14.99,'Etna'],[19.42,-155.29,'Kīlauea'],[31.59,130.66,'Sakurajima'],[19.02,-98.62,'Popocatépetl'],[-7.54,110.44,'Merapi'],[14.47,-90.88,'Fuego'],[-77.53,167.15,'Erebus'],[63.63,-19.62,'Eyjafjallajökull'],[63.9,-22.27,'Reykjanes'],[-0.37,-78.44,'Cotopaxi'],[56.06,160.64,'Klyuchevskoy'],[1.68,127.88,'Ibu'],[-8.06,114.24,'Ijen'],[13.26,123.69,'Mayon'],[46.2,-122.19,'St Helens'],[40.82,14.43,'Vesuvius'],[-39.42,-71.93,'Villarrica'],[-1.52,29.25,'Nyiragongo'],[-15.79,-71.86,'Sabancaya'],[38.79,15.21,'Stromboli']];
const DCS = [[39.04,-77.49,'Ashburn cluster'],[53.33,-6.4,'Dublin'],[50.11,8.68,'Frankfurt'],[1.3,103.8,'Singapore'],[52.37,4.9,'Amsterdam'],[45.6,-121.2,'The Dalles'],[33.45,-112.07,'Phoenix'],[41.6,-93.6,'Des Moines'],[35.69,139.69,'Tokyo'],[37.37,-121.92,'Santa Clara'],[59.33,18.06,'Stockholm'],[-23.5,-46.6,'São Paulo'],[19.07,72.88,'Mumbai'],[32.78,-96.8,'Dallas']];
const DAMS = [[30.82,111.0,'Three Gorges'],[36.02,-114.74,'Hoover'],[-25.41,-54.59,'Itaipu'],[23.97,32.88,'Aswan High'],[47.96,-118.98,'Grand Coulee'],[7.76,-62.99,'Guri'],[34.08,72.7,'Tarbela'],[28.27,85.37,'Rasuwagadhi Hydro (approx.)'],[11.2,35.1,'Grand Ethiopian Renaissance'],[46.23,7.37,'Grande Dixence']];
const MILB = [[31.33,-85.72,'Fort Novosel'],[36.95,-76.33,'Norfolk'],[34.68,-77.34,'Camp Lejeune'],[64.83,-147.6,'Eielson'],[13.58,144.92,'Andersen'],[26.27,127.75,'Kadena'],[49.44,7.6,'Ramstein'],[51.75,-1.58,'Brize Norton'],[37.0,35.42,'Incirlik'],[25.12,51.32,'Al Udeid'],[-7.31,72.41,'Diego Garcia'],[36.24,-115.03,'Nellis']];
const PADS = [[28.5618,-80.5772,'SLC-40, Cape Canaveral'],[34.632,-120.611,'SLC-4E, Vandenberg'],[45.92,63.34,'Baikonur'],[5.24,-52.77,'Kourou'],[40.96,100.29,'Jiuquan'],[30.4,130.97,'Tanegashima'],[13.72,80.23,'Sriharikota'],[19.61,110.95,'Wenchang'],[25.997,-97.155,'Starbase']];
const FISH = [[47,-50,6],[-12,-80,6],[18,-18,5],[40,150,7],[57,-170,5],[-45,-62,6],[64,-10,5],[10,-90,5],[-5,95,5],[20,115,5]];
const GNSS_HOT = [[59.5,24.0,4],[55.5,20.5,3.5],[34.5,33.5,3],[44.5,33.5,3],[33.5,36.0,2.5],[27.0,56.5,2.5],[69.5,30.5,2],[46.5,31.5,2.5]];
const CABLES = [
  [[50.8,-1.3],[50.0,-10],[47,-30],[43,-50],[40.5,-72]], [[51.5,-9.8],[52.5,-30],[48,-50],[44.5,-63.5]], [[43.3,5.3],[38,10],[34.5,25],[31.3,32.3],[29.9,32.5],[20,38.5],[12.6,43.6],[12,52],[16,62],[19,72.8]],
  [[35.4,139.6],[38,155],[42,180],[42,-150],[37,-125],[34.1,-118.4]], [[1.3,103.8],[5,112],[14,119],[22.3,114.2],[30,123],[35.1,129.0]], [[-33.9,151.2],[-25,170],[-10,-170],[10,-160],[21.3,-157.9],[34,-130],[37.7,-122.5]],
  [[-23.0,-43.2],[-15,-30],[0,-20],[15,-20],[33,-10],[38.7,-9.2]], [[51.5,-9.8],[53,-20],[60,-20],[64,-22]], [[1.3,103.8],[-5,100],[-20,105],[-32,115.8]], [[6.4,3.4],[0,0],[-10,8],[-25,12],[-34,18.4]],
];
const RAIL = [[[51.5,-0.13],[51.0,1.9],[50.85,4.35],[52.37,4.9]],[[48.85,2.35],[47.0,4.8],[45.75,4.85],[43.3,5.37]],[[52.52,13.4],[51.34,12.37],[50.11,8.68],[48.14,11.58]],[[35.68,139.77],[35.17,136.9],[34.69,135.5],[34.4,132.46],[33.59,130.4]],[[39.9,116.4],[36.65,117.0],[34.26,117.18],[32.06,118.8],[31.23,121.47]],[[40.75,-73.99],[39.95,-75.16],[39.29,-76.61],[38.9,-77.04]],[[40.42,-3.7],[41.39,2.17]],[[41.9,12.5],[43.77,11.25],[45.46,9.19]]];

function cityScatter(n, km, f) { const out = []; for (let i = 0; i < n; i++) { const c = BIG_CITIES[i % BIG_CITIES.length]; const [a, b] = geo.dest(c.lat, c.lon, RS() * TAU, Math.sqrt(RS()) * km); out.push(f(a, b, c, i)); } return out; }
// holograms & signed captures (fictional authors). Some are placed on situations.
const HOLOS = [
  { lat: 28.2551, lon: 85.3712, by: 'tamang_lens', title: 'North bank, Timure — water at the road', t: -55 * 24 * 3600 + 0, sit: 'koshi' },
  { lat: 28.1629, lon: 85.3402, by: 'hydro_nerd', title: 'Syaphrubesi bridge deck, 14:31 NPT', t: -55 * 86400, sit: 'koshi' },
  { lat: 28.2802, lon: 85.3797, by: 'geodesy_dan', title: 'Rasuwagadhi — scour line photo', t: -54 * 86400, sit: 'koshi' },
  { lat: 51.5560, lon: -0.2796, by: 'row_m_seat14', title: 'Encore from block 114', t: -3600 * 20, sit: 'concert' },
  { lat: 40.7553, lon: -73.9838, by: 'chopper_cam9', title: 'Tower, 41st floor setback', t: -3600 * 9, sit: 'climb' },
  { lat: 69.65, lon: 18.96, by: 'skywatch_ana', title: 'Corona overhead, Tromsø', t: -3600 * 18, sit: 'aurora' },
  { lat: 29.93, lon: 32.56, by: 'ais_owl', title: 'Anchorage at dusk, 48 ships', t: -3600 * 7, sit: 'suez' },
  { lat: 31.276, lon: -85.713, by: 'rotorwash_ret', title: 'Downwind leg, Cairns', t: -3600 * 30, sit: 'novosel' },
];
GE.HOLOS = HOLOS;

/* ---------- buffers ---------- */
const SPR_STRIDE = 15; // pos3 col4 par4 ext4
function pushSpr(a, v, col, size, glyph, hdg = -10, t0 = -1e9, tEnd = 1e9, grow = 0, seed = 0, heat = 0.5) {
  a.push(v[0], v[1], v[2], col[0], col[1], col[2], col[3] ?? 1, size, glyph, hdg, t0, tEnd, grow, seed, heat);
}
const LINE_STRIDE = 9; // pos3 col4 d2
function pushPolyline(a, pts /* [v] */, col, dashed = 0) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    const seg = v3.len(v3.sub(p1, p0));
    a.push(p0[0], p0[1], p0[2], col[0], col[1], col[2], col[3] ?? 1, d, dashed);
    d += seg;
    a.push(p1[0], p1[1], p1[2], col[0], col[1], col[2], col[3] ?? 1, d, dashed);
  }
}
function gcPoints(lat1, lon1, lat2, lon2, n, altKm = 0, lift = 0) {
  const a = geo.vec(lat1, lon1), b = geo.vec(lat2, lon2), out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const p = geo.slerp(a, b, t); const r = 1 + (altKm + lift * Math.sin(Math.PI * t)) / EARTH_KM; out.push(v3.scale(p, r)); }
  return out;
}
function chainPoints(ll, altKm = 0, sub = 8) { const out = []; for (let i = 1; i < ll.length; i++) { const seg = gcPoints(ll[i - 1][0], ll[i - 1][1], ll[i][0], ll[i][1], sub, altKm); if (i > 1) seg.shift(); out.push(...seg); } return out; }
function circlePts(lat, lon, km, n = 48, altKm = 0) { const out = []; for (let i = 0; i <= n; i++) { const [a, b] = geo.dest(lat, lon, (i / n) * TAU, km); out.push(geo.vec(a, b, altKm)); } return out; }

W.static = {}; // id → {vao, count, pass:'add'|'alpha', prog:'sprite'|'line'}
function makeSpriteSet(id, arr, pass = 'add') {
  const gl = GL.gl, P = GL.progs.sprite, buf = GL.buffer(new Float32Array(arr));
  const S = SPR_STRIDE;
  const vao = GL.vao(P, { aPos: [buf, 3, S, 0], aCol: [buf, 4, S, 3], aPar: [buf, 4, S, 7], aExt: [buf, 4, S, 11] });
  return { vao, buf, count: arr.length / S, pass, kind: 'sprite' };
}
function makeLineSet(arr) {
  const P = GL.progs.line, buf = GL.buffer(new Float32Array(arr));
  const vao = GL.vao(P, { aPos: [buf, 3, LINE_STRIDE, 0], aCol: [buf, 4, LINE_STRIDE, 3], aD: [buf, 2, LINE_STRIDE, 7] });
  return { vao, buf, count: arr.length / LINE_STRIDE, kind: 'line' };
}
function addSet(layer, set) { (W.static[layer] = W.static[layer] || []).push(set); }

W.buildStatic = function () {
  const C = (fam, a = 1) => [...hex2rgb(FAM[fam].color), a];
  // quakes
  { const a = []; for (const q of GE.QUAKES) pushSpr(a, geo.vec(q.lat, q.lon, 0.5), [1.0, 0.5, 0.3, 1], 10 + (q.mag - 2.5) * 9, 2, -10, q.t, 1e9, 0, RS(), 0.8); addSet('quakes', makeSpriteSet('quakes', a)); }
  // fires (+ smoke in alpha pass)
  { const a = [], sm = []; for (const f of GE.FIRES) { pushSpr(a, geo.vec(f.lat, f.lon, 0.2), [1, 0.5, 0.15, 1], 4 + Math.sqrt(f.frp) * 0.9, 3, -10, f.t, 1e9, 0.4, RS(), 1.0); if (RS() < 0.35) pushSpr(sm, geo.vec(f.lat + 0.15, f.lon + 0.35, 2), [0.3, 0.28, 0.27, 0.32], 26 + RS() * 30, 11, -10, f.t + 3600, 1e9, 0.8, RS(), 0.5); }
    addSet('fires', makeSpriteSet('fires', a)); addSet('smoke', makeSpriteSet('smoke', sm, 'alpha')); }
  // perimeters
  { const a = []; for (const [la, lo, , , s] of GE.FIRE_CLUSTERS) pushPolyline(a, circlePts(la, lo, s * 111 * 0.9, 40, 0.3), [1, 0.42, 0.24, 0.6], 1); addSet('perims', makeLineSet(a)); }
  // floods
  { const a = [], b = []; for (const [la, lo] of [[28.21, 85.35], [23.9, 90.6], [26.2, 91.7], [9.0, 7.5], [30.0, 70.9]]) { pushSpr(a, geo.vec(la, lo, 0.2), [0.4, 0.75, 1, 1], 16, 9, -10); pushSpr(b, geo.vec(la, lo, 0.5), [0.25, 0.55, 0.95, 0.35], 60, 11); } addSet('floods', makeSpriteSet('floods', a)); addSet('floods', makeSpriteSet('floods2', b, 'alpha')); }
  // volcanoes
  { const a = []; for (const [la, lo] of VOLCANOES) pushSpr(a, geo.vec(la, lo, 0.5), [1, 0.45, 0.3, 1], 13, 14); addSet('volcanoes', makeSpriteSet('v', a)); }
  // air quality (alpha)
  { const a = []; for (const [la, lo] of [[28.6, 77.2], [30.6, 75], [39.9, 116.4], [23.1, 113.3], [24.9, 67], [31.5, 74.3], [6.5, 3.4], [-6.2, 106.8], [40.2, -8.1], [-12, 25], [8, 18]]) for (let i = 0; i < 6; i++) { const [x, y] = geo.dest(la, lo, RS() * TAU, RS() * 260); pushSpr(a, geo.vec(x, y, 1), [0.75, 0.5, 0.25, 0.22], 70 + RS() * 60, 11, -10, -1e9, 1e9, 0, RS()); } addSet('aq', makeSpriteSet('aq', a, 'alpha')); }
  // airports (boards)
  { const a = []; for (const p of GE.AP) pushSpr(a, geo.vec(p.lat, p.lon, 0.3), C('sky', 0.9), 8 + Math.sqrt(p.w) * 1.4, 13); addSet('airports', makeSpriteSet('ap', a)); }
  // ports
  { const a = []; for (const [la, lo] of PORTS) pushSpr(a, geo.vec(la, lo, 0.2), C('sea'), 13, 13); addSet('ports', makeSpriteSet('ports', a)); }
  // fishing effort (alpha)
  { const a = []; for (const [la, lo, s] of FISH) for (let i = 0; i < 26; i++) pushSpr(a, geo.vec(la + RS.gauss() * s * 0.5, lo + RS.gauss() * s, 0.2), [0.2, 0.9, 0.8, 0.12], 30 + RS() * 40, 11, -10, -1e9, 1e9, 0, RS()); addSet('fishing', makeSpriteSet('fish', a, 'alpha')); }
  // dark vessels
  { const a = []; for (let i = 0; i < 40; i++) { const h = RS.pick([[26.5, 56.4], [12.5, 43.5], [36.0, 15.0], [44, 33], [1.3, 104.2], [-12, -78], [22, 119]]); pushSpr(a, geo.vec(h[0] + RS.gauss() * 1.2, h[1] + RS.gauss() * 1.5, 0.2), [1, 0.4, 0.4, 0.95], 12, 16); } addSet('dark', makeSpriteSet('dark', a)); }
  // cables
  { const a = []; for (const c of CABLES) pushPolyline(a, chainPoints(c, -0.5, 10), [0.3, 0.9, 0.85, 0.35]); addSet('cables', makeLineSet(a)); }
  // launches: pads + trajectory
  { const a = []; for (const [la, lo] of PADS) pushSpr(a, geo.vec(la, lo, 0.3), C('orbit'), 12, 9, -10, -1e9, 1e9, 0, RS()); addSet('launches', makeSpriteSet('pads', a));
    const l = []; const tr = []; for (let i = 0; i <= 40; i++) { const f = i / 40; const [la, lo] = geo.dest(28.5618, -80.5772, 52 * D2R, f * 1900); tr.push(geo.vec(la, lo, Math.pow(f, 0.55) * 210)); } pushPolyline(l, tr, [0.85, 0.7, 1, 0.9], 1); addSet('launches', makeLineSet(l)); }
  // cyclone track (past solid, forecast dashed) + forecast cone + model spaghetti
  { const a = []; const tr = GE.CYCLONE.track; const past = tr.filter((x) => x[0] <= 0).map((x) => [x[1], x[2]]); const fut = tr.filter((x) => x[0] >= 0).map((x) => [x[1], x[2]]);
    pushPolyline(a, chainPoints(past, 1, 6), [1, 0.6, 0.45, 0.95]); pushPolyline(a, chainPoints(fut, 1, 6), [1, 0.75, 0.6, 0.95], 1);
    // cone edges
    const left = [], right = []; for (let h = 0; h <= 120; h += 6) { const c = GE.CYCLONE.at(h), c2 = GE.CYCLONE.at(h + 3); const br = geo.bearing(c.lat, c.lon, c2.lat, c2.lon); const r = GE.CYCLONE.cone(h); left.push(geo.vec(...geo.dest(c.lat, c.lon, br - Math.PI / 2, r), 1)); right.push(geo.vec(...geo.dest(c.lat, c.lon, br + Math.PI / 2, r), 1)); }
    pushPolyline(a, left, [1, 0.75, 0.6, 0.5]); pushPolyline(a, right, [1, 0.75, 0.6, 0.5]);
    const end = GE.CYCLONE.at(120); pushPolyline(a, circlePts(end.lat, end.lon, GE.CYCLONE.cone(120), 40, 1), [1, 0.75, 0.6, 0.35]);
    addSet('cyclones', makeLineSet(a));
    // cone fill as soft sprites
    const f = []; for (let h = 3; h <= 120; h += 3) { const c = GE.CYCLONE.at(h); pushSpr(f, geo.vec(c.lat, c.lon, 1), [1, 0.55, 0.4, 0.07], 1, 11, -10, -1e9, 1e9, 0, h); f[f.length - 8] = GE.CYCLONE.cone(h); }
    W.coneSprites = f; // sized per-frame (km → px)
    const m = []; for (let k = 0; k < 14; k++) { const pts = []; let la = GE.CYCLONE.at(0).lat, lo = GE.CYCLONE.at(0).lon; for (let h = 0; h <= 120; h += 6) { const c = GE.CYCLONE.at(h); const sp = h / 120; pts.push([c.lat + Math.sin(k * 1.7) * sp * 4.5 + RS.gauss() * sp, c.lon + Math.cos(k * 2.3) * sp * 6 + RS.gauss() * sp]); } pushPolyline(m, chainPoints(pts, 1, 4), [0.6, 0.75, 1, 0.45]); }
    addSet('models', makeLineSet(m)); }
  // eyes
  { const a = cityScatter(320, 18, (la, lo) => la); const s = []; for (let i = 0; i < 320; i++) { const c = BIG_CITIES[i % BIG_CITIES.length]; const [x, y] = geo.dest(c.lat, c.lon, RS() * TAU, Math.sqrt(RS()) * 16); pushSpr(s, geo.vec(x, y, 0.05), C('eyes'), 13, 5); }
    // Midtown / Wembley / Chicago extra cameras for close-ups
    for (const [la, lo, n] of [[40.7549, -73.984, 40], [51.556, -0.2796, 18], [41.8789, -87.6359, 30], [28.163, 85.34, 4]]) for (let i = 0; i < n; i++) { const [x, y] = geo.dest(la, lo, RS() * TAU, 0.15 + RS() * 1.6); pushSpr(s, geo.vec(x, y, 0.02), C('eyes'), 15, 5); }
    addSet('cctv', makeSpriteSet('cctv', s)); }
  { const s = []; for (let i = 0; i < 70; i++) { const c = BIG_CITIES[(i * 7) % BIG_CITIES.length]; const [x, y] = geo.dest(c.lat, c.lon, RS() * TAU, RS() * 30); pushSpr(s, geo.vec(x, y, 0.05), [1, 0.82, 0.4, 1], 12, 6, -10, -1e9, 1e9, 0, RS(), 0.4); } for (const hh of HOLOS) pushSpr(s, geo.vec(hh.lat, hh.lon, 0.05), [1, 0.82, 0.4, 1], 15, 6); addSet('signed', makeSpriteSet('signed', s)); }
  { const s = cityScatter(1800, 22, () => 0); const a = []; for (let i = 0; i < 1800; i++) { const c = BIG_CITIES[i % BIG_CITIES.length]; const [x, y] = geo.dest(c.lat, c.lon, RS() * TAU, Math.sqrt(RS()) * 20); pushSpr(a, geo.vec(x, y, 0.02), [1, 0.9, 0.6, 0.45], 3.2, 0); } addSet('street', makeSpriteSet('street', a)); }
  { const a = [], l = []; for (const hh of HOLOS) { pushSpr(a, geo.vec(hh.lat, hh.lon, 0.35), [1, 0.85, 0.45, 1], 22, 6, -10, -1e9, 1e9, 0, RS(), 0.4); pushPolyline(l, [geo.vec(hh.lat, hh.lon, 0), geo.vec(hh.lat, hh.lon, 0.35)], [1, 0.85, 0.5, 0.9]); } addSet('holo', makeSpriteSet('holo', a)); addSet('holo', makeLineSet(l)); }
  { const a = []; for (let i = 0; i < 36; i++) { const c = BIG_CITIES[(i * 5) % BIG_CITIES.length]; const [x, y] = geo.dest(c.lat, c.lon, RS() * TAU, RS() * 25); pushSpr(a, geo.vec(x, y, 0.1), [1, 0.35, 0.4, 1], 12, 9, -10, -1e9, 1e9, 0, RS()); } addSet('streams', makeSpriteSet('streams', a)); }
  // ground
  { const a = []; for (let i = 0; i < 1500; i++) { const c = BIG_CITIES[i % 20]; const [x, y] = geo.dest(c.lat, c.lon, RS() * TAU, Math.sqrt(RS()) * 14); pushSpr(a, geo.vec(x, y, 0.02), C('ground', 0.9), 3.5, 0); } addSet('bikes', makeSpriteSet('bikes', a)); }
  { const a = []; for (const r of RAIL) pushPolyline(a, chainPoints(r, 0.1, 6), [0.62, 0.88, 0.37, 0.65]); addSet('rail', makeLineSet(a)); }
  { const a = []; for (const [la, lo] of [[51.556, -0.2796], [40.7505, -73.9934], [41.8623, -87.6167], [34.0141, -118.2879], [48.8414, 2.253], [40.4531, -3.6883], [35.6681, 139.7], [-33.891, 151.2249], [53.4631, -2.2913], [41.3809, 2.1228]]) pushSpr(a, geo.vec(la, lo, 0.1), C('ground'), 14, 9, -10, -1e9, 1e9, 0, RS()); addSet('venues', makeSpriteSet('venues', a)); }
  { const a = []; for (let i = 0; i < 300; i++) { const c = BIG_CITIES[[0, 15, 16, 26, 24][i % 5]]; const [x, y] = geo.dest(c.lat, c.lon, RS() * TAU, Math.sqrt(RS()) * 30); pushSpr(a, geo.vec(x, y, 0.02), [0.75, 0.9, 0.6, 0.85], 7, 13); } addSet('alpr', makeSpriteSet('alpr', a)); }
  // weather: radar blobs + lightning
  { const a = [], b = []; const cy = GE.CYCLONE.at(0);
    for (let i = 0; i < 70; i++) { const ang = RS() * TAU, rr = Math.pow(RS(), 0.7) * 480; const [x, y] = geo.dest(cy.lat, cy.lon, ang, rr); pushSpr(a, geo.vec(x, y, 1), rr < 150 ? [1, 0.75, 0.2, 0.16] : [0.3, 0.85, 0.4, 0.11], 30 + RS() * 40, 11, -10, -1e9, 1e9, 0, RS()); if (RS() < 0.5) pushSpr(b, geo.vec(x, y, 2), [0.85, 0.85, 1, 1], 18, 12, -10, -1e9, 1e9, 0, RS(), 0.9); }
    for (const [la, lo] of [[45, -95], [5, 20], [-5, -60], [10, 100], [32, -85]]) for (let i = 0; i < 18; i++) { const [x, y] = geo.dest(la, lo, RS() * TAU, RS() * 500); pushSpr(a, geo.vec(x, y, 1), [0.3, 0.85, 0.4, 0.1], 24 + RS() * 30, 11, -10, -1e9, 1e9, 0, RS()); pushSpr(b, geo.vec(x, y, 2), [0.85, 0.85, 1, 1], 14, 12, -10, -1e9, 1e9, 0, RS(), 0.9); }
    addSet('radar', makeSpriteSet('radar', a, 'alpha')); addSet('lightning', makeSpriteSet('lightning', b)); }
  // infra
  { const a = []; for (const [la, lo] of DCS) pushSpr(a, geo.vec(la, lo, 0.1), C('infra'), 13, 13); addSet('dc', makeSpriteSet('dc', a)); }
  { const a = []; for (const [la, lo] of DAMS) pushSpr(a, geo.vec(la, lo, 0.1), [0.6, 0.8, 1, 1], 13, 13); addSet('dams', makeSpriteSet('dams', a)); }
  { const a = []; for (let i = 0; i < 260; i++) { const c = RS.pick(GE.AP); const [x, y] = geo.dest(c.lat, c.lon, RS() * TAU, 20 + RS() * 120); pushSpr(a, geo.vec(x, y, 0.1), [1, 0.85, 0.5, 0.8], 6, 0); } addSet('power', makeSpriteSet('power', a)); }
  { const a = []; for (const [la, lo] of MILB) pushSpr(a, geo.vec(la, lo, 0.1), [1, 0.6, 0.4, 0.9], 13, 13); addSet('milbase', makeSpriteSet('mb', a)); }
  { const a = []; for (const [la, lo, s] of GNSS_HOT) for (let i = 0; i < 9; i++) pushSpr(a, geo.vec(la + RS.gauss() * s * 0.25, lo + RS.gauss() * s * 0.45, 1), [1, 0.32, 0.36, 0.22], 18 + s * 4, 10, -10, -1e9, 1e9, 0, RS(), 0.6); addSet('gnss', makeSpriteSet('gnss', a, 'alpha')); }
  { const a = []; for (let i = 0; i < 40; i++) { const c = RS.pick(GE.AP); const la = c.lat + RS.gauss() * 2, lo = c.lon + RS.gauss() * 2, w = 0.5 + RS() * 0.6; const q = [[la - w, lo - w], [la - w, lo + w], [la + w, lo + w], [la + w, lo - w], [la - w, lo - w]].map(([x, y]) => geo.vec(x, y, 0.5)); pushPolyline(a, q, [0.8, 0.85, 0.95, 0.5]); } addSet('imagery', makeLineSet(a)); }
  // AIS lanes as faint context lines
  { const a = []; for (const l of GE.LANES) pushPolyline(a, chainPoints(l, 0, 6), [0.22, 0.88, 0.78, 0.07]); addSet('ais', makeLineSet(a)); }
  // situation pins handled dynamically
  W.counts.quakes = GE.QUAKES.length; W.counts.ports = PORTS.length; W.counts.volcanoes = VOLCANOES.length; W.counts.dc = DCS.length; W.counts.dams = DAMS.length; W.counts.milbase = MILB.length; W.counts.cables = CABLES.length;
  W.counts.launches = PADS.length; W.counts.cctv = 408; W.counts.signed = 78; W.counts.street = 1800; W.counts.holo = HOLOS.length; W.counts.streams = 36; W.counts.bikes = 1500; W.counts.rail = 412; W.counts.venues = 10; W.counts.alpr = 300;
  W.counts.radar = 160; W.counts.clouds = 1; W.counts.models = 14; W.counts.power = 260; W.counts.gnss = 8; W.counts.imagery = 40; W.counts.fishing = 260; W.counts.dark = 40; W.counts.aq = 66; W.counts.floods = 5; W.counts.perims = GE.FIRE_CLUSTERS.length;
};
W.counts = {};

/* ---------- GPU flights & satellites ---------- */
W.buildMovers = function () {
  const gl = GL.gl;
  const F = GE.FLIGHTS, n = F.length, a = new Float32Array(n * 14);
  F.forEach((f, i) => { const o = i * 14; a.set(f.a.v, o); a.set(f.b.v, o + 3); a[o + 6] = f.t0; a[o + 7] = f.dur; a[o + 8] = f.period; a[o + 9] = f.turn; a[o + 10] = f.alt; a[o + 11] = f.kind; a[o + 12] = hash01(i); a[o + 13] = f.dKm; });
  const fb = GL.buffer(a);
  const spec = (P) => ({ aA: [fb, 3, 14, 0, 1], aB: [fb, 3, 14, 3, 1], aTime: [fb, 4, 14, 6, 1], aMeta: [fb, 4, 14, 10, 1] });
  W.flightVao = GL.vao(GL.progs.flight, spec());
  const K = 28, kb = GL.buffer(new Float32Array(Array.from({ length: K }, (_, i) => i / (K - 1))));
  const ts = spec(); ts.aK = [kb, 1, 1, 0, 0];
  W.trailVao = GL.vao(GL.progs.trail, ts); W.trailK = K; W.nFlights = n;
  const S = GE.SATS, sa = new Float32Array(S.length * 8);
  S.forEach((s, i) => { sa.set([s.inc, s.raan, s.u0, s.n, s.alt, s.kind, s.geo ? 1 : 0, hash01(i + 7)], i * 8); });
  const sb = GL.buffer(sa);
  W.satVao = GL.vao(GL.progs.sat, { aEl: [sb, 4, 8, 0], aSM: [sb, 4, 8, 4] }); W.nSats = S.length;
  // dynamic sprites / lines
  W.dynBuf = gl.createBuffer(); W.dynVao = null; W.dynCount = 0; W.dynCap = 0;
  W.dynLineBuf = gl.createBuffer(); W.dynLineCount = 0; W.dynLineCap = 0;
  W.alphaBuf = gl.createBuffer(); W.alphaCount = 0; W.alphaCap = 0;
};
function uploadDyn(bufKey, vaoKey, capKey, countKey, arr, kind) {
  const gl = GL.gl; const f = new Float32Array(arr);
  gl.bindBuffer(gl.ARRAY_BUFFER, W[bufKey]);
  if (f.length > W[capKey]) { W[capKey] = Math.max(f.length, W[capKey] * 1.5) | 0; gl.bufferData(gl.ARRAY_BUFFER, W[capKey] * 4, gl.DYNAMIC_DRAW);
    if (kind === 'line') W[vaoKey] = GL.vao(GL.progs.line, { aPos: [W[bufKey], 3, LINE_STRIDE, 0], aCol: [W[bufKey], 4, LINE_STRIDE, 3], aD: [W[bufKey], 2, LINE_STRIDE, 7] });
    else W[vaoKey] = GL.vao(GL.progs.sprite, { aPos: [W[bufKey], 3, SPR_STRIDE, 0], aCol: [W[bufKey], 4, SPR_STRIDE, 3], aPar: [W[bufKey], 4, SPR_STRIDE, 7], aExt: [W[bufKey], 4, SPR_STRIDE, 11] }); }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, f);
  W[countKey] = f.length / (kind === 'line' ? LINE_STRIDE : SPR_STRIDE);
}

/* ---------- CPU movers: helicopters, drones, holding, transit, wind, runners ---------- */
const HELI_CIRCUITS = [];
(function () {
  // Fort Novosel: Cairns AAF + stagefields — rectangular circuits (illustrative)
  const fields = [[31.276, -85.713, 'Cairns'], [31.36, -85.63, 'Stagefield A'], [31.20, -85.81, 'Stagefield B'], [31.42, -85.79, 'Stagefield C']];
  let k = 0;
  for (const [la, lo, nm] of fields) for (let i = 0; i < (nm === 'Cairns' ? 7 : 4); i++) HELI_CIRCUITS.push({ lat: la, lon: lo, w: 1.6 + RS() * 0.6, h: 0.9 + RS() * 0.3, rot: (nm === 'Cairns' ? 0.06 : RS() * 0.6), alt: 0.15 + RS() * 0.04, period: 330 + RS() * 60, ph: i / 7 + RS() * 0.05, cs: ['HAWK', 'LAKOTA', 'ROTOR', 'TALON'][k % 4] + ' ' + (21 + k), field: nm, type: k % 3 ? 'UH-72' : 'TH-73', idx: k++ });
  // news helicopters over the tower (orbit), and city police/EMS
  for (let i = 0; i < 3; i++) HELI_CIRCUITS.push({ orbit: true, lat: 40.7553, lon: -73.9838, r: 0.55 + i * 0.25, alt: 0.33 + i * 0.06, period: 140 + i * 30, ph: i * 0.33, cs: ['N9 NEWS', 'SKY 4', 'EYE 2'][i] + ' (illustrative)', type: 'AS350', idx: k++ });
  for (let i = 0; i < 18; i++) { const c = BIG_CITIES[i]; HELI_CIRCUITS.push({ orbit: true, lat: c.lat + RS.gauss() * 0.05, lon: c.lon + RS.gauss() * 0.05, r: 1 + RS() * 3, alt: 0.3 + RS() * 0.3, period: 200 + RS() * 300, ph: RS(), cs: 'MED ' + (100 + i), type: 'EC135', idx: k++ }); }
})();
GE.HELI_CIRCUITS = HELI_CIRCUITS;
function heliAt(hc, t) {
  const ph = ((t / hc.period + hc.ph) % 1 + 1) % 1;
  if (hc.orbit) { const ang = ph * TAU; const [la, lo] = geo.dest(hc.lat, hc.lon, ang, hc.r); return { lat: la, lon: lo, altKm: hc.alt, hdg: ang + Math.PI / 2, v: geo.vec(la, lo, hc.alt), spd: (TAU * hc.r * 1000) / hc.period * 1.944 }; }
  // rectangle circuit: perimeter param
  const W2 = hc.w, H2 = hc.h, P = 2 * (W2 + H2); let d = ph * P; let x, y, hd;
  if (d < W2) { x = d - W2 / 2; y = -H2 / 2; hd = Math.PI / 2; } else if ((d -= W2) < H2) { x = W2 / 2; y = d - H2 / 2; hd = 0; } else if ((d -= H2) < W2) { x = W2 / 2 - d; y = H2 / 2; hd = -Math.PI / 2; } else { d -= W2; x = -W2 / 2; y = H2 / 2 - d; hd = Math.PI; }
  // round corners a bit
  const c = Math.cos(hc.rot), s = Math.sin(hc.rot); const ex = x * c - y * s, ny = x * s + y * c;
  const [la, lo] = geo.offset(hc.lat, hc.lon, ex * 1000, ny * 1000);
  // altitude: descend on final (last quarter), climb after takeoff
  const alt = hc.alt * (0.35 + 0.65 * smooth(0.0, 0.12, ph) * smooth(1.0, 0.86, ph));
  return { lat: la, lon: lo, altKm: alt, hdg: hd + hc.rot * -1, v: geo.vec(la, lo, alt), spd: (P * 1000 / hc.period) * 1.944 };
}
GE.heliAt = heliAt;
const HOLD_STACKS = [[51.72, -0.55, 'BNN'], [51.30, -0.45, 'OCK'], [51.33, 0.03, 'BIG'], [51.65, 0.15, 'LAM'], [40.9, -73.2, 'CCC'], [33.9, -84.0, 'ATL-E']];
const HOLDERS = []; HOLD_STACKS.forEach(([la, lo, nm], si) => { for (let i = 0; i < (si < 4 ? 5 : 3); i++) HOLDERS.push({ la, lo, nm, lvl: 7 + i * 1, ph: RS(), cs: GE.FLIGHTS[(si * 13 + i * 7) % 3000].cs }); });
function holdAt(hd, t) {
  const per = 240, ph = ((t / per + hd.ph) % 1 + 1) % 1; // racetrack 4 min
  const L2 = 7, Rr = 2.2; const P = 2 * L2 + TAU * Rr; let d = ph * P; let x, y, hh;
  if (d < L2) { x = d - L2 / 2; y = Rr; hh = Math.PI / 2; } else if ((d -= L2) < Math.PI * Rr) { const a = d / Rr; x = L2 / 2 + Math.sin(a) * Rr; y = Math.cos(a) * Rr; hh = Math.PI / 2 + a; } else if ((d -= Math.PI * Rr) < L2) { x = L2 / 2 - d; y = -Rr; hh = -Math.PI / 2; } else { d -= L2; const a = d / Rr; x = -L2 / 2 - Math.sin(a) * Rr; y = -Math.cos(a) * Rr; hh = -Math.PI / 2 + a; }
  const [la, lo] = geo.offset(hd.la, hd.lo, x * 1000, y * 1000);
  return { lat: la, lon: lo, altKm: hd.lvl * 0.3048, hdg: hh, v: geo.vec(la, lo, hd.lvl * 0.3048) };
}
// delivery-drone corridor (illustrative, suburban Texas)
const DRONE_DEPOT = [30.5880, -96.2900];
const DRONES = []; for (let i = 0; i < 16; i++) { const brg = RS() * TAU, km = 1.2 + RS() * 4.5; DRONES.push({ to: geo.dest(DRONE_DEPOT[0], DRONE_DEPOT[1], brg, km), km, period: 600 + RS() * 400, ph: RS(), id: 'RID-' + (4400 + i) }); }
GE.DRONES = DRONES; GE.DRONE_DEPOT = DRONE_DEPOT;
function droneAt(d, t) {
  const ph = ((t / d.period + d.ph) % 1 + 1) % 1; const out = ph < 0.5; const f = out ? ph * 2 : (1 - ph) * 2;
  const s = smooth(0, 1, f); const la = lerp(DRONE_DEPOT[0], d.to[0], s), lo = lerp(DRONE_DEPOT[1], d.to[1], s);
  const alt = 0.06 * Math.min(1, Math.min(f, 1 - f) * 12 + 0.05);
  return { lat: la, lon: lo, altKm: alt, v: geo.vec(la, lo, alt), hdg: geo.bearing(DRONE_DEPOT[0], DRONE_DEPOT[1], d.to[0], d.to[1]) + (out ? 0 : Math.PI) };
}
// marathon (fictional race) — runners on a lakeshore loop in Chicago
const RUN_ROUTE = [[41.8827, -87.6233], [41.8930, -87.6240], [41.9100, -87.6330], [41.9280, -87.6380], [41.9400, -87.6440], [41.9280, -87.6420], [41.9100, -87.6300], [41.8960, -87.6180], [41.8800, -87.6150], [41.8670, -87.6170], [41.8520, -87.6200], [41.8380, -87.6080], [41.8520, -87.6150], [41.8680, -87.6230], [41.8827, -87.6233]];
const RUN_V = chainPoints(RUN_ROUTE, 0.002, 6); const RUN_CUM = [0]; for (let i = 1; i < RUN_V.length; i++) RUN_CUM.push(RUN_CUM[i - 1] + v3.len(v3.sub(RUN_V[i], RUN_V[i - 1])));
const RUNNERS = []; for (let i = 0; i < 260; i++) RUNNERS.push({ pace: 0.9 + Math.pow(RS(), 1.6) * 1.1, off: RS() * 0.18, lane: RS.gauss() * 0.4, bib: 1000 + i });
GE.RUN_ROUTE = RUN_ROUTE;
function runnerAt(r, t) {
  const L = RUN_CUM[RUN_CUM.length - 1]; let d = ((r.off + (t / 3600) * 3.2 / r.pace / (L * EARTH_KM / 1)) % 1 + 1) % 1 * L;
  let i = 1; while (i < RUN_CUM.length - 1 && RUN_CUM[i] < d) i++;
  const f = (d - RUN_CUM[i - 1]) / ((RUN_CUM[i] - RUN_CUM[i - 1]) || 1); const v = v3.lerp(RUN_V[i - 1], RUN_V[i], f); return v;
}
// wind particles (zonal jets + cyclone swirl)
const WIND = []; for (let i = 0; i < 1400; i++) WIND.push({ lat: Math.asin(RS() * 2 - 1) * R2D * 0.95, lon: RS() * 360 - 180, ph: RS(), life: 5400 + RS() * 5400 });
function windVel(lat, lon, t) { // deg/hour
  const jet = 34 * Math.exp(-Math.pow((Math.abs(lat) - 45) / 10, 2)) - 8 * Math.exp(-Math.pow(lat / 14, 2)) + 6 * Math.sin(lon * D2R * 3 + t / 40000);
  let u = jet * 3.6 / 111 / Math.max(0.2, Math.cos(lat * D2R)), v = 4 * Math.sin(lon * D2R * 2 + lat * D2R * 3) * 3.6 / 111;
  const c = GE.CYCLONE.at(W.offsetH); const dlat = lat - c.lat, dlon = (lon - c.lon) * Math.cos(lat * D2R); const r = Math.hypot(dlat, dlon);
  if (r < 12) { const s = 60 * Math.exp(-r / 3.5) * (1 - Math.exp(-r * r / 0.5)); u += (-dlat / (r + 1e-3)) * s * 3.6 / 111; v += (dlon / (r + 1e-3)) * s * 3.6 / 111; }
  return [u, v];
}

W.squawks = [41, 1207].map((i) => i % GE.FLIGHTS.length);
W.situationPins = []; // filled by situations module

W.updateDynamic = function () {
  const t = W.t, a = [], al = [], ln = [];
  // ships (AIS) — color by kind when tankers layer on
  const showAis = W.on('ais'), showTk = W.on('tankers');
  if (showAis || showTk) {
    if (!W._shipCache || Math.abs(W._shipCacheT - t) > 6 || W._shipCacheN !== GE.SHIPS.length) { W._shipCache = GE.SHIPS.map((s) => shipAt(s, t)); W._shipCacheT = t; W._shipCacheN = GE.SHIPS.length; }
    GE.SHIPS.forEach((s, i) => {
      const p = W._shipCache[i]; const tank = s.kind === 'tanker' || s.kind === 'LNG';
      if (!showAis && !tank) return;
      const ak = clamp(lerp(0.16, 0.95, smooth(1.4, 0.08, W.lastRange ?? 1)), 0.16, 1);
      const col = showTk && tank ? [1, 0.7, 0.35, ak] : s.queue ? [0.5, 1, 0.9, ak] : [0.22, 0.88, 0.78, ak * 0.95];
      pushSpr(a, geo.vec(p.lat, p.lon, 0.03), col, (showTk && tank ? 10 : 8.5), 4, p.hdg, -1e9, 1e9, 0, i, 0.35);
    });
  }
  if (W.on('helis')) for (const hc of HELI_CIRCUITS) { const p = heliAt(hc, t); pushSpr(a, p.v, [0.62, 1, 0.6, 1], 17, 8, p.hdg, -1e9, 1e9, 0, hc.idx, 0.7); }
  if (W.on('holding')) for (const hd of HOLDERS) { const p = holdAt(hd, t); pushSpr(a, p.v, [0.56, 0.82, 1, 1], 13, 1, p.hdg, -1e9, 1e9, 0, 0, 0.55); }
  if (W.on('drones')) for (const d of DRONES) { const p = droneAt(d, t); pushSpr(a, p.v, [0.75, 1, 0.95, 1], 13, 17, p.hdg, -1e9, 1e9, 0, 0, 0.5); }
  if (W.on('squawk')) for (const i of W.squawks) { const p = flightAt(GE.FLIGHTS[i], t); if (p) pushSpr(a, v3.scale(p.v, 1 + p.altKm * W.altX / EARTH_KM), [1, 0.25, 0.25, 1], 30, 9, -10, -1e9, 1e9, 0, i * 0.37, 0.8); }
  if (W.on('venues') || W.on('transit')) for (const r of RUNNERS) pushSpr(a, runnerAt(r, t), [0.62, 0.9, 0.37, 1], 6, 16, -10, -1e9, 1e9, 0, 0, 0.6);
  if (W.on('transit')) for (let i = 0; i < 400; i++) { const c = BIG_CITIES[i % 16]; const ang = hash01(i) * TAU + t / (600 + hash01(i + 3) * 900); const rr = 2 + hash01(i + 9) * 10; const [la, lo] = geo.dest(c.lat, c.lon, ang, rr); pushSpr(a, geo.vec(la, lo, 0.01), [0.62, 0.9, 0.37, 0.95], 5, 0); }
  if (W.on('wind')) for (const w of WIND) { const age = ((t / w.life + w.ph) % 1 + 1) % 1; let la = w.lat, lo = w.lon; const steps = 4, dtH = (age * w.life) / 3600 / steps; for (let k = 0; k < steps; k++) { const [u, v] = windVel(la, lo, t); la += v * dtH; lo += u * dtH; } const [u, v] = windVel(la, lo, t); const fade = Math.sin(age * Math.PI); pushSpr(a, geo.vec(la, lo, 3), [0.75, 0.85, 1, 0.55 * fade], 14, 15, Math.atan2(u * Math.cos(la * D2R), v), -1e9, 1e9, 0, 0, 0.1); }
  for (const hh of W.userHolos) pushSpr(a, geo.vec(hh.lat, hh.lon, 0.06), [1, 0.85, 0.45, 1], 24, 6, -10, -1e9, 1e9, 0, 0.2, 0.4);
  if (W.activeExtrasId === 'climb') { const f = clamp((W.simMs - GE.T_CLIMB) / (2.23 * 3600000), 0, 1); const [la, lo] = geo.offset(40.7553, -73.9838, 16, 23.5); pushSpr(a, geo.vec(la, lo, (12 + f * 372) / 1000), [1, 0.3, 0.3, 1], 16, 9, -10, -1e9, 1e9, 0, 0.7, 0.9); }
  for (const sp of W.extraSprites || []) pushSpr(a, sp.v, sp.col, sp.size || 24, sp.glyph ?? 9, -10, -1e9, 1e9, 0, sp.seed || 0.3, 0.8);
  // eyes: people and cameras looking right now
  if (W.on('cctv') || W.on('signed') || W.on('streams')) for (const e of GE.EYES || []) pushSpr(a, geo.vec(e.lat, e.lon, 0.05), e.kind === 'you' ? [1, 0.9, 0.55, 1] : e.kind === 'cctv' ? [1, 0.66, 0.26, 1] : [0.96, 0.82, 0.48, 1], e.kind === 'you' ? 26 : 15, 9, -10, -1e9, 1e9, 0, e.lat * 0.1, 0.6);
  // situation pins
  for (const p of W.situationPins) pushSpr(a, geo.vec(p.lat, p.lon, 0.2), p.col, p.size || 16, 9, -10, -1e9, 1e9, 0, p.seed || 0, 0.6);
  // selection highlight
  if (W.sel && W.sel.v) pushSpr(a, W.sel.v, [1, 0.85, 0.45, 1], 34, 9, -10, -1e9, 1e9, 0, 0.5, 0.6);
  // cyclone cone fill (alpha)
  if (W.on('cyclones') && W.coneSprites) { const f = W.coneSprites.slice(); const kmPerPx = W.kmPerPx || 10; for (let i = 0; i < f.length; i += SPR_STRIDE) { f[i + 7] = clamp((f[i + 7] * 2) / kmPerPx, 1, 600) / Math.max(W.sizeK, 0.1); } al.push(...f); }
  uploadDyn('dynBuf', 'dynVao', 'dynCap', 'dynCount', a, 'sprite');
  uploadDyn('alphaBuf', 'alphaVao', 'alphaCap', 'alphaCount', al, 'sprite');
  // dynamic lines: ISS ground track, selected route, extra lines from UI
  if (W.on('tracks')) {
    const pts = []; for (let k = -46; k <= 46; k++) { const tt = t + k * 60; const s = astro.sun(NOW + tt * 1000); const p = satAt(GE.ISS, tt, s.gmst); pts.push(v3.scale(v3.norm(p), 1.0005)); }
    pushPolyline(ln, pts, [0.79, 0.66, 1, 0.55], 1);
    const op = []; for (let k = 0; k <= 64; k++) { const tt = t + (k / 64) * (TAU / GE.ISS.n); op.push(satAt(GE.ISS, tt, W.sun.gmst)); } pushPolyline(ln, op, [0.79, 0.66, 1, 0.4]);
  }
  if (W.selRoute) pushPolyline(ln, W.selRoute, [1, 0.85, 0.45, 0.8], 1);
  for (const extra of W.extraLines) pushPolyline(ln, extra.pts, extra.col, extra.dashed || 0);
  if (GE.eyeLines && (W.on('cctv') || W.on('signed') || W.on('streams'))) for (const ex of GE.eyeLines(W.lastRange)) pushPolyline(ln, ex.pts, ex.col, ex.dashed || 0);
  for (const hh of W.userHolos) pushPolyline(ln, [geo.vec(hh.lat, hh.lon, 0), geo.vec(hh.lat, hh.lon, 0.06)], [1, 0.85, 0.5, 0.9]);
  uploadDyn('dynLineBuf', 'dynLineVao', 'dynLineCap', 'dynLineCount', ln, 'line');
};
W.extraLines = [];

/* ---------- counts ---------- */
W.updateCounts = function () {
  const t = W.t; let c0 = 0, c1 = 0, c3 = 0;
  for (const f of GE.FLIGHTS) { let ph = (t - f.t0) % f.period; if (ph < 0) ph += f.period; const lp = ph < f.period / 2 ? ph : ph - f.period / 2; if (lp <= f.dur) { if (f.kind === 0) c0++; else if (f.kind === 1) c1++; else c3++; } }
  const C = W.counts;
  C.flights = c0; C.military = c1; C.ga = c3; C.helis = HELI_CIRCUITS.length; C.squawk = W.squawks.length; C.drones = DRONES.length; C.airports = GE.AP.length; C.holding = HOLDERS.length;
  C.ais = GE.SHIPS.length; C.tankers = GE.SHIPS.filter((s) => s.kind === 'tanker' || s.kind === 'LNG').length;
  C.sats = GE.SATS.filter((s) => s.kind <= 3).length; C.crewed = 2; C.trains = 1; C.debris = GE.SATS.filter((s) => s.kind === 4).length; C.tracks = 1;
  C.fires = GE.FIRES.filter((f) => f.t <= t).length; C.quakes = GE.QUAKES.filter((q) => q.t <= t && q.t > t - 86400 * 3).length;
  C.cyclones = 1; C.lightning = 160 + Math.round(40 * Math.sin(t / 900)); C.wind = 1400; C.transit = 400; C.traffic = 1;
  for (const l of W.layers) l.count = C[l.id] ?? 0;
  bus.emit('layers', W.layers);
};

/* ---------- textures ---------- */
W.loadTextures = async function () {
  const T = window.__GE_TEX || {};
  const load = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = src; });
  const [day, night, clouds, water, topo] = await Promise.all(['day', 'night', 'clouds', 'water', 'topo'].map((k) => load(T[k])));
  W.img = { day, night, clouds, water, topo };
  W.tex = { day: GL.texture(day), night: GL.texture(night), clouds: GL.texture(clouds), water: GL.texture(water, { aniso: 2 }), topo: GL.texture(topo, { mips: true, aniso: 0 }) };
  // CPU copies for density queries (lights) and thumbnails fallback
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(night, 0, 0, 1024, 512); W.nightPx = cx.getImageData(0, 0, 1024, 512).data;
  cx.drawImage(water, 0, 0, 1024, 512); W.waterPx = cx.getImageData(0, 0, 1024, 512).data;
};
W.lightsAt = function (lat, lon) {
  if (!W.nightPx) return 0;
  const x = ((lon + 180) / 360) * 1024, y = ((90 - lat) / 180) * 512;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const s = (i, j) => { i = ((i % 1024) + 1024) % 1024; j = clamp(j, 0, 511); const o = (j * 1024 + i) * 4; return Math.max(0, (W.nightPx[o + 1] * 1.1 - W.nightPx[o + 2] * 0.55) / 255); };
  return lerp(lerp(s(x0, y0), s(x0 + 1, y0), fx), lerp(s(x0, y0 + 1), s(x0 + 1, y0 + 1), fx), fy);
};
W.waterAt = function (lat, lon) { if (!W.waterPx) return 0; const x = Math.floor(((lon + 180) / 360) * 1024) % 1024, y = clamp(Math.floor(((90 - lat) / 180) * 512), 0, 511); return W.waterPx[(y * 1024 + x) * 4] / 255; };

/* ---------- lens ---------- */
W.lens = 'cinematic';
const LENS = { cinematic: 0, clear: 1, night: 2, thermal: 3, nvg: 4 };
W.setLens = (id) => { W.lens = id; bus.emit('lens', id); };

/* ---------- view helpers ---------- */
// view: {eye, right, up, back, fovY, aspect, near, far, shiftX, shiftY, w, h}
W.matrices = function (view) {
  const P = m4.persp(view.fovY, view.aspect, view.near, view.far);
  P[8] = -(view.shiftX || 0); P[9] = -(view.shiftY || 0);
  const V = m4.viewRot(view.right, view.up, view.back);
  view.P = P; view.V = V; view.VP = m4.mul(P, V);
  return view;
};
W.project = function (view, p) { // world unit coords → css px {x,y,z,vis}
  const rel = v3.sub(p, view.eye); const c = m4.xform(view.VP, rel);
  if (c[3] <= 0) return null;
  const x = c[0] / c[3], y = c[1] / c[3];
  // occlusion by planet
  const E = view.eye, d = rel, L2 = v3.len(d), u = v3.scale(d, 1 / L2), b = v3.dot(E, u), cc = v3.dot(E, E) - 0.9985 * 0.9985, disc = b * b - cc;
  let occ = false; if (disc > 0) { const tn = -b - Math.sqrt(disc); occ = tn > 0 && tn < L2; }
  return { x: (x * 0.5 + 0.5) * view.w, y: (1 - (y * 0.5 + 0.5)) * view.h, d: L2, vis: !occ && Math.abs(x) < 1.2 && Math.abs(y) < 1.2 };
};

/* ---------- render ---------- */
W.quality = { scale: 1, steps: 12, bloom: true, grain: true };
const LOD_MIN = { radar: 0.12 };
W.on = (id) => id === 'smoke' ? !!W.layerById.fires?.on : !!W.layerById[id]?.on;
const LOD = { smoke: 0.7, cctv: 0.07, street: 0.03, alpr: 0.035, bikes: 0.04, streams: 0.4, signed: 0.6, venues: 0.9, power: 0.7, dc: 1.6, dams: 1.6, milbase: 1.6, airports: 1.3, ports: 1.4, imagery: 1.6, fishing: 2.2, radar: 1.6 };
W.render = function (view, chain, outFb, opts = {}) {
  const gl = GL.gl, PR = GL.progs;
  W.matrices(view);
  const sun = opts.sun || W.sun;
  const sunDir = sun.dir;
  const t = opts.t ?? W.t;
  const eye = view.eye, eyeR = v3.len(eye), alt = eyeR - 1;
  const eyeC = (eyeR - 1) * (eyeR + 1);
  const eyeH = eye.map(Math.fround), eyeL = [eye[0] - eyeH[0], eye[1] - eyeH[1], eye[2] - eyeH[2]];
  const lensId = opts.lens || W.lens; const mode = LENS[lensId] ?? 0;
  const range = view.range ?? alt;
  const tanY = Math.tan(view.fovY / 2), tanX = tanY * view.aspect;
  gl.bindFramebuffer(gl.FRAMEBUFFER, chain.scene.fb);
  gl.viewport(0, 0, chain.w, chain.h);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
  gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // ---- globe
  const G = PR.globe; gl.useProgram(G.p);
  gl.uniform3fv(G.u.uCamR, view.right); gl.uniform3fv(G.u.uCamU, view.up); gl.uniform3fv(G.u.uCamB, view.back);
  gl.uniform4f(G.u.uTanS, tanX, tanY, view.shiftX || 0, view.shiftY || 0);
  gl.uniform3fv(G.u.uEye, eye); gl.uniform1f(G.u.uEyeC, eyeC); gl.uniform1f(G.u.uT, t); gl.uniform1f(G.u.uGmst, sun.gmst);
  gl.uniform3fv(G.u.uSun, sunDir); gl.uniform1f(G.u.uSunI, 20.0);
  const cloudsOn = W.on('clouds') ? 1 : 0;
  gl.uniform4f(G.u.uLens, mode, mode === 2 ? 1 : opts.nightForce || 0, cloudsOn * (opts.cloudK ?? 1), mode === 1 ? 1 : 0);
  // cyclone
  const cyc = GE.CYCLONE.at(opts.offsetH ?? W.offsetH); const cv = geo.vec(cyc.lat, cyc.lon);
  gl.uniform4f(G.u.uCyc, cv[0], cv[1], cv[2], 5.2 * D2R);
  gl.uniform4f(G.u.uCycP, W.on('cyclones') ? clamp(cyc.wind / 190, 0.3, 1.0) : 0, (t / 3600) * 1.8, 0.16 * D2R, 0);
  gl.uniform1f(G.u.uAurora, opts.aurora ?? W.auroraK);
  // local detail frame
  const sc = opts.scene || W.activeScene(view);
  const org = sc ? sc : { lat: view.tLat ?? 0, lon: view.tLon ?? 0, block: 95, rot: 0.3, urban: 0 };
  const enu = geo.enu(org.lat, org.lon), ov = geo.vec(org.lat, org.lon);
  const de = v3.sub(eye, ov);
  const eyeLocal = [v3.dot(de, enu.east) * EARTH_M, v3.dot(de, enu.north) * EARTH_M, v3.dot(de, enu.up) * EARTH_M];
  gl.uniformMatrix3fv(G.u.uEnu, false, [...enu.east, ...enu.north, ...enu.up]);
  gl.uniform3fv(G.u.uEyeLocal, eyeLocal);
  const detail = smooth(0.012, 0.0025, range) * (opts.detail ?? 1);
  gl.uniform4f(G.u.uCity, detail, org.block || 95, org.rot || 0, org.urban || 0);
  gl.uniform1f(G.u.uRange, range);
  gl.uniform1i(G.u.uSteps, opts.steps || W.quality.steps);
  gl.uniform1f(G.u.uInside, eyeR < 1.0165 ? 1 : 0);
  const fo = opts.focus; if (fo) { const fv = geo.vec(fo.lat, fo.lon); gl.uniform4f(G.u.uFocus, fv[0], fv[1], fv[2], fo.k ?? 0.8); } else gl.uniform4f(G.u.uFocus, 0, 0, 1, 0);
  GL.bindTex(G, 'uDay', W.tex.day, 0); GL.bindTex(G, 'uNight', W.tex.night, 1); GL.bindTex(G, 'uClouds', W.tex.clouds, 2); GL.bindTex(G, 'uWater', W.tex.water, 3); GL.bindTex(G, 'uTopo', W.tex.topo, 4);
  gl.uniform4fv(G.u.uLocalWater, sc && sc.water ? sc.water : [0, 0, 0, 0]);
  gl.uniform1f(G.u.uTraffic, W.on('traffic') ? 1 : 0);
  GL.fsq(G);
  // ---- meshes
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  if (sc && sc.mesh && range < 0.03) GE.scenes.draw(sc, view, { sun, t, eye, opts });
  // ---- lines & sprites (additive)
  gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
  const altX = lerp(1, 16, smooth(0.008, 1.3, range)); W.altX = altX;
  const sizeK = opts.sizeK ?? clamp(lerp(0.5, 1.1, smooth(2.2, 0.05, range)), 0.4, 1.3); W.sizeK = sizeK; W.lastRange = range;
  const px = (opts.pxScale ?? 1) * (chain.w / view.w);
  const occR = 1 - clamp(alt * 0.004, 2e-7, 0.0015);
  const common = (P, alphaK = 1) => {
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, view.VP); gl.uniform3fv(P.u.uEyeH, eyeH); gl.uniform3fv(P.u.uEyeL, eyeL);
    gl.uniform1f(P.u.uEyeC, eyeC); gl.uniform1f(P.u.uOccR, occR); gl.uniform1f(P.u.uT, t);
    if (P.u.uPx) gl.uniform1f(P.u.uPx, px); if (P.u.uAltX) gl.uniform1f(P.u.uAltX, altX); if (P.u.uSizeK) gl.uniform1f(P.u.uSizeK, sizeK);
    if (P.u.uGmst) gl.uniform1f(P.u.uGmst, sun.gmst); if (P.u.uView) gl.uniform2f(P.u.uView, view.w, view.h); if (P.u.uSun) gl.uniform3fv(P.u.uSun, sunDir);
    if (P.u.uMinSize) gl.uniform1f(P.u.uMinSize, 1.3); if (P.u.uGlyphPx) gl.uniform1f(P.u.uGlyphPx, range > 0.55 ? 9999 : 6 * px); if (P.u.uAlphaK) gl.uniform1f(P.u.uAlphaK, alphaK); if (P.u.uPass) gl.uniform1f(P.u.uPass, 0);
  };
  const lineK = opts.lineK ?? 1;
  const LP = PR.line; common(LP, lineK); gl.uniform1f(LP.u.uDashK, 1 / Math.max(range * 0.012, 2e-6));
  for (const id in W.static) if (W.on(id) && range < (LOD[id] || 99) && !(id === 'ais' && range > 1.0)) for (const s of W.static[id]) if (s.kind === 'line') { gl.bindVertexArray(s.vao); gl.drawArrays(gl.LINES, 0, s.count); }
  if (W.dynLineVao && W.dynLineCount) { gl.bindVertexArray(W.dynLineVao); gl.drawArrays(gl.LINES, 0, W.dynLineCount); }
  if (opts.extraLines) for (const s of opts.extraLines) { gl.bindVertexArray(s.vao); gl.drawArrays(gl.LINES, 0, s.count); }
  // trails
  const kindMask = [W.on('flights') ? 1 : 0, W.on('military') ? 1 : 0, 0, W.on('ga') ? 1 : 0];
  const trailLen = range < 0.02 ? 240 : range < 0.2 ? 900 : 1500;
  if ((kindMask[0] || kindMask[1] || kindMask[3]) && opts.trails !== false) {
    const TP = PR.trail; common(TP, (range > 1.4 ? 0.22 : 0.4) * lineK); gl.uniform4fv(TP.u.uKindMask, kindMask); gl.uniform1f(TP.u.uTrail, 1); gl.uniform1f(TP.u.uTrailLen, trailLen); gl.uniform1f(TP.u.uSelId, W.selFlight ?? -1);
    gl.uniform4f(TP.u.uKindSize, 9, 10, 10, 7);
    gl.bindVertexArray(W.trailVao); gl.drawArraysInstanced(gl.LINE_STRIP, 0, W.trailK, W.nFlights);
  }
  // static sprite sets
  const SP = PR.sprite; common(SP);
  for (const id in W.static) if (W.on(id) && range < (LOD[id] || 99)) for (const s of W.static[id]) if (s.kind === 'sprite' && s.pass === 'add') { gl.bindVertexArray(s.vao); gl.drawArrays(gl.POINTS, 0, s.count); }
  if (W.dynVao && W.dynCount) { gl.bindVertexArray(W.dynVao); gl.drawArrays(gl.POINTS, 0, W.dynCount); }
  if (opts.extraSprites) for (const s of opts.extraSprites) { gl.bindVertexArray(s.vao); gl.drawArrays(gl.POINTS, 0, s.count); }
  // flights
  if (kindMask[0] || kindMask[1] || kindMask[3]) {
    const FP = PR.flight; common(FP, lerp(1, 0.42, smooth(0.35, 1.8, range))); gl.uniform4fv(FP.u.uKindMask, kindMask); gl.uniform1f(FP.u.uTrail, 0); gl.uniform1f(FP.u.uTrailLen, 0); gl.uniform1f(FP.u.uSelId, W.selFlight ?? -1);
    gl.uniform4f(FP.u.uKindSize, 13, 15, 14, 10);
    gl.bindVertexArray(W.flightVao); gl.drawArraysInstanced(gl.POINTS, 0, 1, W.nFlights);
  }
  // satellites
  const sm0 = [W.on('sats') ? 1 : 0, W.on('sats') ? 1 : 0, W.on('sats') ? 1 : 0, W.on('sats') ? 1 : 0], sm1 = [W.on('debris') ? 1 : 0, W.on('trains') ? 1 : 0, W.on('crewed') ? 1 : 0, 0];
  if (sm0[0] || sm1[0] || sm1[1] || sm1[2]) {
    const AP2 = PR.sat; common(AP2, opts.satK ?? 1); gl.uniform4fv(AP2.u.uSatMask0, sm0); gl.uniform4fv(AP2.u.uSatMask1, sm1); gl.uniform1f(AP2.u.uSelId, W.selSat ?? -1);
    gl.bindVertexArray(W.satVao); gl.drawArrays(gl.POINTS, 0, W.nSats);
  }
  // alpha pass (smoke, AQ, radar, GNSS, cone)
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  common(SP); gl.uniform1f(SP.u.uPass, 1);
  for (const id in W.static) if (W.on(id) && range < (LOD[id] || 99) && range > (LOD_MIN[id] || 0)) for (const s of W.static[id]) if (s.kind === 'sprite' && s.pass === 'alpha') { gl.bindVertexArray(s.vao); gl.drawArrays(gl.POINTS, 0, s.count); }
  if (W.alphaVao && W.alphaCount) { gl.bindVertexArray(W.alphaVao); gl.drawArrays(gl.POINTS, 0, W.alphaCount); }
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
  gl.bindVertexArray(null);
  // ---- post
  W.post(chain, outFb, opts.outW ?? view.w, opts.outH ?? view.h, mode, opts);
};
W.post = function (chain, outFb, outW, outH, mode, opts) {
  const gl = GL.gl, PR = GL.progs, lv = chain.lv;
  const bloomOn = (opts.bloom ?? W.quality.bloom) && mode !== 1;
  if (bloomOn) {
    const B = PR.bright; gl.useProgram(B.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, lv[0].a.fb); gl.viewport(0, 0, lv[0].a.w, lv[0].a.h);
    GL.bindTex(B, 'uSrc', chain.scene.tex, 0); gl.uniform2f(B.u.uTexel, 0.5 / chain.w, 0.5 / chain.h); gl.uniform1f(B.u.uThr, mode === 4 ? 1.2 : 3.2); GL.fsq(B);
    const Dn = PR.down;
    for (let i = 1; i < 4; i++) { gl.useProgram(Dn.p); gl.bindFramebuffer(gl.FRAMEBUFFER, lv[i].a.fb); gl.viewport(0, 0, lv[i].a.w, lv[i].a.h); GL.bindTex(Dn, 'uSrc', lv[i - 1].a.tex, 0); gl.uniform2f(Dn.u.uTexel, 1 / lv[i - 1].a.w, 1 / lv[i - 1].a.h); GL.fsq(Dn); }
    const Up = PR.up;
    for (let i = 2; i >= 0; i--) { gl.useProgram(Up.p); gl.bindFramebuffer(gl.FRAMEBUFFER, lv[i].b.fb); gl.viewport(0, 0, lv[i].b.w, lv[i].b.h); const src = i === 2 ? lv[3].a : lv[i + 1].b; GL.bindTex(Up, 'uSrc', src.tex, 0); GL.bindTex(Up, 'uBase', lv[i].a.tex, 1); gl.uniform2f(Up.u.uTexel, 1 / src.w, 1 / src.h); gl.uniform1f(Up.u.uMix, 1.0); GL.fsq(Up); }
  }
  const Cp = PR.comp; gl.useProgram(Cp.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFb);
  gl.viewport(0, 0, opts.vpW ?? (outFb ? outW : gl.drawingBufferWidth), opts.vpH ?? (outFb ? outH : gl.drawingBufferHeight));
  GL.bindTex(Cp, 'uScene', chain.scene.tex, 0); GL.bindTex(Cp, 'uBloom', bloomOn ? lv[0].b.tex : lv[0].a.tex, 1);
  gl.uniform2f(Cp.u.uTexel, 1 / chain.w, 1 / chain.h);
  gl.uniform1f(Cp.u.uExposure, (opts.exposure ?? 1) * (mode === 2 ? 1.25 : mode === 0 ? 0.58 : 0.62));
  gl.uniform1f(Cp.u.uBloomK, bloomOn ? (mode === 4 ? 0.3 : 0.16) : 0);
  gl.uniform1f(Cp.u.uVig, opts.vig ?? (mode === 1 ? 0.25 : 0.9));
  gl.uniform1f(Cp.u.uGrain, (opts.grain ?? W.quality.grain) && mode !== 1 ? 0.022 : 0);
  gl.uniform1f(Cp.u.uT, performance.now() / 1000 % 100);
  gl.uniform1f(Cp.u.uFade, opts.fade ?? 1);
  gl.uniform1f(Cp.u.uFxaa, 1);
  gl.uniform1f(Cp.u.uSat, mode === 1 ? 1.0 : 1.12);
  gl.uniform1i(Cp.u.uMode, mode);
  gl.uniform3fv(Cp.u.uLift, [0.00017, 0.00038, 0.001]);
  gl.uniform3fv(Cp.u.uGain, mode === 0 ? [1.02, 1.0, 0.97] : [1, 1, 1]);
  GL.fsq(Cp);
};

/* ---------- active local scene (city / terrain) ---------- */
W.activeScene = function (view) {
  if (!GE.scenes) return null;
  const range = view.range ?? 1; if (range > 0.03) return null;
  const [la, lo] = view.tLat != null ? [view.tLat, view.tLon] : geo.ll(view.eye);
  let best = null, bd = 1e9;
  for (const s of GE.scenes.list) { const d = geo.dist(la, lo, s.lat, s.lon) * EARTH_KM; if (d < s.radiusKm && d < bd) { bd = d; best = s; } }
  if (best) GE.scenes.ensure(best);
  return best;
};

/* ---------- picking (CPU) ---------- */
W.pick = function (view, x, y, radius = 26) {
  const cands = [];
  const consider = (p, item) => { const s = W.project(view, p); if (!s || !s.vis) return; const d = Math.hypot(s.x - x, s.y - y); if (d < radius) cands.push({ d: d - (item.prio || 0), ...item }); };
  const t = W.t;
  for (const p of W.situationPins) consider(geo.vec(p.lat, p.lon, 0.2), { kind: 'situation', id: p.id, title: p.title, prio: 10, lat: p.lat, lon: p.lon });
  if (W.on('flights') || W.on('military') || W.on('ga')) GE.FLIGHTS.forEach((f, i) => {
    if ((f.kind === 0 && !W.on('flights')) || (f.kind === 1 && !W.on('military')) || (f.kind === 3 && !W.on('ga'))) return;
    const p = flightAt(f, t); if (!p) return;
    consider(v3.scale(p.v, 1 + (p.altKm * W.altX) / EARTH_KM), { kind: 'flight', id: i, title: f.cs, subtitle: `${f.type} · ${p.from.iata} → ${p.to.iata}`, lat: p.lat, lon: p.lon, altKm: p.altKm, hdg: p.hdg, meta: { from: p.from, to: p.to, f, prog: p.prog }, prio: 2 });
  });
  if (W.on('helis')) HELI_CIRCUITS.forEach((hc, i) => { const p = heliAt(hc, t); consider(p.v, { kind: 'heli', id: i, title: hc.cs, subtitle: `${hc.type} · ${hc.field || 'orbit'} · ${Math.round(p.altKm * 3281)} ft`, lat: p.lat, lon: p.lon, altKm: p.altKm, hdg: p.hdg, prio: 4 }); });
  if (W.on('ais') && W._shipCache) GE.SHIPS.forEach((s, i) => { const p = W._shipCache[i]; if (!p) return; consider(geo.vec(p.lat, p.lon, 0.03), { kind: 'ship', id: i, title: s.name, subtitle: `${s.kind} · ${p.sog ? p.sog.toFixed(1) + ' kn' : 'at anchor'} · MMSI ${s.mmsi}`, lat: p.lat, lon: p.lon, hdg: p.hdg }); });
  if (W.on('crewed')) [GE.ISS, GE.CSS].forEach((s) => { const p = satAt(s, t, W.sun.gmst); const [la, lo] = geo.ll(p); consider(p, { kind: 'sat', id: GE.SATS.indexOf(s), title: s.name, subtitle: `${Math.round(s.alt)} km · ${(Math.sqrt(398600.4418 / (6371 + s.alt))).toFixed(2)} km/s`, lat: la, lon: lo, prio: 6 }); });
  if (W.on('quakes')) GE.QUAKES.forEach((q, i) => { if (q.t > t) return; consider(geo.vec(q.lat, q.lon, 0.5), { kind: 'quake', id: i, title: `M ${q.mag.toFixed(1)}`, subtitle: `${q.depth} km deep · ${fmt.ago(-q.t * 1000 + W.offsetH * 3600000)}`, lat: q.lat, lon: q.lon, prio: q.mag }); });
  if (W.on('holo') || W.on('signed')) HOLOS.forEach((hh, i) => consider(geo.vec(hh.lat, hh.lon, 0.2), { kind: 'holo', id: i, title: hh.title, subtitle: `Signed capture · @${hh.by} · illustrative`, lat: hh.lat, lon: hh.lon, prio: 5 }));
  cands.sort((a, b) => a.d - b.d);
  return cands[0] || null;
};
W.contactsNear = function (lat, lon, km) {
  const out = [], t = W.t;
  GE.FLIGHTS.forEach((f, i) => { const p = flightAt(f, t); if (!p) return; const d = geo.dist(lat, lon, p.lat, p.lon) * EARTH_KM; if (d < km) out.push({ kind: 'flight', id: i, title: f.cs, sub: f.type, lat: p.lat, lon: p.lon, altM: p.altKm * 1000, headingDeg: p.hdg * R2D, d }); });
  [GE.ISS, GE.CSS].forEach((s) => { const p = satAt(s, t, W.sun.gmst); const [la, lo, al] = geo.ll(p); const d = geo.dist(lat, lon, la, lo) * EARTH_KM; if (d < 2200) out.push({ kind: 'sat', title: s.name, sub: Math.round(al) + ' km', lat: la, lon: lo, altM: al * 1000, d }); });
  return out.sort((a, b) => a.d - b.d);
};
W.auroraK = 0.85;
Object.assign(W, { heliAt, holdAt, droneAt, runnerAt, HOLDERS, RUN_V });
