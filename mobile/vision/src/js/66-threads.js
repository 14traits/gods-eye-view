/* Threads: reconstructions people build together. Three strata — Observations (immutable, hashed,
   sourced), Hypotheses (person/AI, confidence, citations, agree/dispute), Narrative (camera path through
   space-time synced to the ribbon) — plus a real SHA-256 hash-chain ledger you can verify and tamper
   with, and an AI refine composer whose output is recorded as a *proposed* hypothesis. */
const THR = (GE.threads = { ws: null });
const P = GE.PEOPLE;
const KT = GE.scenes.FLOOD.startMs; const HR_ = 3600000, MIN = 60000;
const KO = GE.scenes.KOSHI;
const THREADS = {
  koshi: {
    id: 'koshi', sit: 'koshi', title: 'Bhote Koshi outburst flood', place: 'Rasuwagadhi → Syaphrubesi, Nepal', date: '26 Aug 2026',
    window: { start: KT - 1.5 * HR_, end: KT + 6 * HR_ }, people: ['hydro', 'kora', 'tamang', 'geo', 'sky', 'ais'],
    cam: { lat: 28.2, lon: 85.35, range: 0.0046, heading: 0.32, tilt: 0.98 },
    labels: [[28.1600, 85.3395, 'Syaphrubesi'], [28.2560, 85.3690, 'Timure'], [28.2802, 85.3797, 'Rasuwagadhi bridge']],
    obs: [
      { id: 'O1', i: 'frame', f: 'infra', t: 'Optical satellite tile — before', src: 'Public 10 m optical archive', at: Date.UTC(2026, 7, 24, 4, 52), meta: ['10 m', 'cloud 6%'] },
      { id: 'O2', i: 'frame', f: 'infra', t: 'Optical satellite tile — after: new scour along 9.4 km of channel', src: 'Public 10 m optical archive', at: Date.UTC(2026, 7, 27, 4, 58), meta: ['10 m', 'cloud 12%'] },
      { id: 'O3', i: 'drop', f: 'haz', t: 'River gauge, Syaphrubesi: stage 3.1 → 7.8 m', src: 'Gauge feed (illustrative values)', at: KT + 1.75 * HR_, meta: ['15-min series', 'peak 09:30 UTC'] },
      { id: 'O4', i: 'wave', f: 'haz', t: 'No M ≥ 3 earthquake within 50 km in the prior 24 h', src: 'Seismic catalog', at: KT, meta: ['rules out seismic trigger'] },
      { id: 'O5', i: 'seal', f: 'eyes', t: 'Signed capture — water reaches the road at Timure', src: '@tamang_lens · illustrative', at: KT + 27 * MIN, meta: ['IMU ✓', 'GPS ±6 m', 'heading 214°'], lat: 28.2551, lon: 85.3712 },
      { id: 'O6', i: 'seal', f: 'eyes', t: 'Signed capture — debris against the Syaphrubesi bridge deck', src: '@hydro_nerd · illustrative', at: KT + 61 * MIN, meta: ['IMU ✓', 'GPS ±4 m', 'heading 352°'], lat: 28.1629, lon: 85.3402 },
      { id: 'O7', i: 'seal', f: 'eyes', t: 'Signed capture — fresh scour line at Rasuwagadhi', src: '@geodesy_dan · illustrative', at: KT + 21.5 * HR_, meta: ['IMU ✓', 'GPS ±5 m'], lat: 28.2802, lon: 85.3797 },
      { id: 'O8', i: 'helicopter', f: 'sky', t: 'ADS-B: rescue helicopter, 3 sorties along the valley', src: 'ADS-B/MLAT (illustrative track)', at: KT + 2.3 * HR_, meta: ['10:05–13:40 UTC'] },
      { id: 'O9', i: 'cloud', f: 'wx', t: 'Upstream rain gauge: 4 mm in 24 h', src: 'Met station (illustrative)', at: KT - 1 * HR_, meta: ['not a rain-driven flood'] },
      { id: 'O10', i: 'frame', f: 'infra', t: 'Glacial lake area change upstream: −0.42 km²', src: 'Derived from O1/O2-class imagery (illustrative)', at: Date.UTC(2026, 7, 27, 5, 0), meta: ['outside border, upstream'] },
    ],
    hyps: [
      { id: 'H1', by: 'hydro', text: 'A glacial-lake outburst upstream — not rainfall — triggered the flood.', conf: 0.82, ci: [0.71, 0.9], cites: ['O4', 'O9', 'O10'], agree: 31, dispute: 2, status: 'supported' },
      { id: 'H2', by: 'kora', text: 'The crest passed Timure about 08:12 UTC and reached Syaphrubesi ~35 min later (≈ 5 m/s).', conf: 0.68, ci: [0.55, 0.79], cites: ['O3', 'O5', 'O6'], agree: 18, dispute: 4, status: 'supported' },
      { id: 'H3', by: 'tamang', text: 'Clip O5 was filmed from the north bank, about 140 m upstream of the Timure bridge.', conf: 0.74, ci: [0.6, 0.84], cites: ['O5'], agree: 12, dispute: 1, status: 'supported' },
      { id: 'H4', by: 'ai', ai: true, text: 'Peak stage at Syaphrubesi lagged the visible crest by ~20 min — consistent with debris damming at the bridge.', conf: 0.41, ci: [0.22, 0.6], cites: ['O3', 'O6'], agree: 3, dispute: 5, status: 'disputed', prompt: 'Why does the gauge peak late?' },
    ],
    beats: [
      { at: KT, t: '07:45', text: 'Outburst upstream (inferred). The valley is quiet; the river is at its normal 3 m stage.', cites: ['H1', 'O4', 'O9'], cam: { lat: 28.268, lon: 85.37, range: 0.0032, heading: 3.55, tilt: 0.98 } },
      { at: KT + 20 * MIN, t: '08:05', text: 'The crest reaches Rasuwagadhi and the border bridge.', cites: ['H2', 'O7'], cam: { lat: 28.276, lon: 85.376, range: 0.0026, heading: 2.6, tilt: 0.95 } },
      { at: KT + 27 * MIN, t: '08:12', text: 'A witness on the north bank at Timure films water reaching the road.', cites: ['H3', 'O5'], cam: { lat: 28.252, lon: 85.368, range: 0.0027, heading: 3.4, tilt: 0.96 } },
      { at: KT + 61 * MIN, t: '08:46', text: 'Debris piles against the Syaphrubesi bridge deck.', cites: ['O6', 'H4'], cam: { lat: 28.16, lon: 85.338, range: 0.0027, heading: 0.25, tilt: 0.96 } },
      { at: KT + 105 * MIN, t: '09:30', text: 'Gauge peaks at 7.8 m — about 20 minutes after the visible crest.', cites: ['O3', 'H4'], cam: { lat: 28.155, lon: 85.332, range: 0.0032, heading: 0.9, tilt: 0.98 } },
      { at: KT + 140 * MIN, t: '10:05', text: 'First rescue sortie climbs the valley.', cites: ['O8'], cam: { lat: 28.2, lon: 85.35, range: 0.0045, heading: 0.3, tilt: 0.98 } },
    ],
    suggestions: ['Align the witness clip to the corridor using the bridge as a landmark', 'Estimate crest speed between Timure and Syaphrubesi', 'What would falsify H1?'],
    fallback: 'Using the Syaphrubesi bridge as a fixed landmark, clip [O6] was taken from the east abutment looking upstream; matching its horizon to the IMU pitch places the crest front 85 ± 20 m upstream of the bridge at 08:46 UTC. That timing agrees with the gauge [O3] if the crest travelled 4.6 ± 0.6 m/s from Timure [O5].\nConfidence: 0.63',
  },
  concert: {
    id: 'concert', sit: 'concert', title: 'Stadium encore in 4D', place: 'Wembley, London', date: GE.dayWord(GE.T_CONCERT, 'night'),
    window: { start: GE.T_CONCERT - 1 * HR_, end: GE.T_CONCERT + 0.5 * HR_ }, people: ['crowd', 'sky', 'kora', 'geo'],
    cam: { lat: 51.5546, lon: -0.2822, range: 0.00042, heading: 0.6, tilt: 1.1 },
    labels: [[51.556, -0.2803, 'Stage · encore', 0.05]],
    obs: [
      { id: 'O1', i: 'seal', f: 'eyes', t: '2,311 signed phone captures from 86 seat blocks', src: 'Signed bundles (illustrative)', at: GE.T_CONCERT, meta: ['IMU ✓ on 2,204', 'GPS indoor ±12 m'] },
      { id: 'O2', i: 'wave', f: 'eyes', t: 'Audio fingerprints align 1,980 clips to ±9 ms', src: 'Derived', at: GE.T_CONCERT + 0.2 * HR_, meta: ['common track'] },
      { id: 'O3', i: 'video', f: 'eyes', t: 'Venue public camera, concourse north', src: 'Public feed (illustrative)', at: GE.T_CONCERT, meta: ['720p'] },
      { id: 'O4', i: 'ticket', f: 'ground', t: 'Seat map & stage geometry', src: 'Published venue plan', at: Date.now() - 30 * 24 * HR_, meta: ['static'] },
    ],
    hyps: [
      { id: 'H1', by: 'crowd', text: 'The encore began at 22:41:07 local, ±0.2 s.', conf: 0.9, ci: [0.84, 0.95], cites: ['O1', 'O2'], agree: 210, dispute: 3, status: 'supported' },
      { id: 'H2', by: 'geo', text: 'The pyro cue at 22:44 is visible from 86 of 92 seat blocks; 6 blocks are occluded by the roof cantilever.', conf: 0.71, ci: [0.6, 0.8], cites: ['O1', 'O4'], agree: 44, dispute: 6, status: 'supported' },
    ],
    beats: [
      { at: GE.T_CONCERT - 3 * MIN, t: '22:41', text: 'Lights down. 2,311 phones come up together.', cites: ['H1'], cam: { lat: 51.5552, lon: -0.2815, range: 0.00035, heading: 0.9, tilt: 1.15 } },
      { at: GE.T_CONCERT, t: '22:44', text: 'Pyro cue — seen from 86 blocks at once.', cites: ['H2'], cam: { lat: 51.5568, lon: -0.2778, range: 0.0003, heading: 3.6, tilt: 1.12 } },
      { at: GE.T_CONCERT + 12 * MIN, t: '22:56', text: 'Final chorus; the crowd reconstruction is densest here.', cites: ['O1', 'O2'], cam: { lat: 51.556, lon: -0.2796, range: 0.0006, heading: 2.2, tilt: 0.9 } },
    ],
    suggestions: ['Which seat blocks saw the pyro cue?', 'Align the concourse camera to the crowd timeline'],
    fallback: 'The concourse camera [O3] shows the crowd surge 2.1 s after the audio onset in [O2]; offsetting its clock by −2.1 s aligns it with 1,980 crowd clips [O1].\nConfidence: 0.58',
  },
  climb: {
    id: 'climb', sit: 'climb', title: 'Free-climber on a Midtown tower', place: 'Midtown Manhattan (fictional tower)', date: GE.dayWord(GE.T_CLIMB, 'morning'),
    window: { start: GE.T_CLIMB - 0.5 * HR_, end: GE.T_CLIMB + 3 * HR_ }, people: ['news', 'sky', 'kora', 'geo', 'ais'],
    cam: { lat: 40.7532, lon: -73.9865, range: 0.00055, heading: 0.62, tilt: 1.12 },
    labels: [[40.7553, -73.9838, 'Meridian Tower (fictional)', 0.43]],
    obs: [
      { id: 'O1', i: 'helicopter', f: 'sky', t: 'ADS-B tracks: 3 news helicopters orbiting the tower', src: 'ADS-B (illustrative callsigns)', at: GE.T_CLIMB + 1.2 * HR_, meta: ['1 Hz', '2 h 14 m'] },
      { id: 'O2', i: 'video', f: 'eyes', t: 'Broadcast frames, time-coded', src: 'Public broadcast (illustrative)', at: GE.T_CLIMB + 1.2 * HR_, meta: ['29.97 fps'] },
      { id: 'O3', i: 'seal', f: 'eyes', t: '41 signed street-level clips', src: 'Signed bundles (illustrative)', at: GE.T_CLIMB + 1.2 * HR_, meta: ['IMU ✓', 'GPS ±5 m'] },
      { id: 'O4', i: 'cube', f: 'infra', t: 'Tower model, 412 m (fictional building)', src: 'Model', at: Date.now() - 400 * 24 * HR_, meta: ['static'] },
    ],
    hyps: [
      { id: 'H1', by: 'news', text: 'The climb started at 06:52 local on the northeast face.', conf: 0.77, ci: [0.66, 0.86], cites: ['O2', 'O3'], agree: 58, dispute: 4, status: 'supported' },
      { id: 'H2', by: 'geo', text: 'Climber height over time is recoverable to ±3 m by triangulating helicopter camera positions (from ADS-B) with frame bearings.', conf: 0.69, ci: [0.55, 0.8], cites: ['O1', 'O2', 'O4'], agree: 33, dispute: 7, status: 'supported' },
    ],
    beats: [
      { at: GE.T_CLIMB, t: '06:52', text: 'First witness clip from the street: the climber is at the 3rd setback.', cites: ['H1', 'O3'], cam: { lat: 40.7538, lon: -73.9852, range: 0.00022, heading: 0.5, tilt: 1.3 } },
      { at: GE.T_CLIMB + 63 * MIN, t: '07:55', text: 'Three news helicopters in orbit; their ADS-B tracks pin each broadcast camera.', cites: ['O1', 'H2'], cam: { lat: 40.751, lon: -73.99, range: 0.0012, heading: 0.7, tilt: 1.0 } },
      { at: GE.T_CLIMB + 134 * MIN, t: '09:06', text: 'The climber reaches the crown at 384 m.', cites: ['H2'], cam: { lat: 40.7549, lon: -73.9848, range: 0.0003, heading: 0.4, tilt: 1.42 } },
    ],
    suggestions: ['Triangulate the climber at 08:30 from two helicopters', 'Which face was the route on?'],
    fallback: 'At 08:30 the bearings from N9 NEWS and SKY 4 [O1] to the climber in broadcast frames [O2] intersect 232 ± 4 m up the northeast face of the tower model [O4].\nConfidence: 0.66',
  },
};
THR.data = THREADS;

/* ---------- 3D extras per reconstruction (GPU sets, built lazily) ---------- */
const EXTRAS = {};
GE.extrasFor = function (id) {
  if (EXTRAS[id] !== undefined) return EXTRAS[id];
  if (id === 'launch') { const sp = [], ln = []; const pad = [28.5618, -80.5772]; pushSpr(sp, geo.vec(pad[0], pad[1], 0.04), [1, 0.86, 0.6, 0.9], 70, 0, -10, -1e9, 1e9, 0, 0, 0.9); for (const [dx, dy] of [[90, 70], [-80, 60], [70, -80], [-90, -70]]) { const [la, lo] = geo.offset(pad[0], pad[1], dx, dy); pushSpr(sp, geo.vec(la, lo, 0.02), [1, 0.9, 0.7, 0.8], 26, 0, -10, -1e9, 1e9, 0, 0, 0.6); } return (EXTRAS[id] = { sprites: [makeSpriteSet('xl', sp)], lines: null }); }
  const T = THREADS[id] || (GE.SIT.byId[id]?.thread && THREADS[GE.SIT.byId[id].thread]);
  if (!T) return (EXTRAS[id] = null);
  const sp = [], ln = [];
  const gold = [1, 0.84, 0.42, 1];
  if (T.id === 'koshi') {
    GE.scenes.ensure(GE.scenes.byId.koshi);
    const gz = (la, lo) => GE.scenes.groundAt(la, lo) / 1000;
    for (const o of T.obs) if (o.lat) { const z = gz(o.lat, o.lon); pushSpr(sp, geo.vec(o.lat, o.lon, z + 0.09), gold, 26, 6, -10, -1e9, 1e9, 0, 0, 0.5); pushPolyline(ln, [geo.vec(o.lat, o.lon, z), geo.vec(o.lat, o.lon, z + 0.09)], [1, 0.85, 0.5, 0.9]);
      // capture frustum toward the river
      const brg = { O5: 214, O6: 352, O7: 160 }[o.id] * D2R || 0; const tip = geo.vec(o.lat, o.lon, z + 0.012);
      for (const da of [-0.35, 0.35]) for (const dz of [-0.04, 0.04]) { const [la2, lo2] = geo.dest(o.lat, o.lon, brg + da, 0.45); pushPolyline(ln, [tip, geo.vec(la2, lo2, gz(la2, lo2) + 0.012 + dz)], [1, 0.82, 0.4, 0.55]); }
    }
    // gauge & villages
    pushSpr(sp, geo.vec(28.158, 85.336, gz(28.158, 85.336) + 0.06), [0.4, 0.75, 1, 1], 20, 9, -10, -1e9, 1e9, 0, 0.3, 0.4);
    // rescue helicopter track (illustrative) up the valley
    const trk = KO.map(([la, lo], i) => geo.vec(la, lo, gz(la, lo) + 0.35 + (i % 3) * 0.05)); pushPolyline(ln, trk, [0.62, 1, 0.6, 0.7], 1);
  } else if (T.id === 'concert') {
    const c = [51.556, -0.2796]; const stage = geo.vec(...geo.offset(c[0], c[1], -40, 0), 0.015);
    const r = rng(9);
    for (let i = 0; i < 160; i++) { const a = r() * TAU; const rx = 70 + r() * 55, ry = 52 + r() * 50; const [la, lo] = geo.offset(c[0], c[1], Math.cos(a) * rx, Math.sin(a) * ry); const z = 0.008 + r() * 0.03; const p = geo.vec(la, lo, z); pushSpr(sp, p, [1, 0.86, 0.45, 1], 7, 0, -10, -1e9, 1e9, 0, 0, 0.6); if (i % 2 === 0) pushPolyline(ln, [p, v3.lerp(p, stage, 0.35 + r() * 0.2)], [1, 0.8, 0.4, 0.28]); }
    pushSpr(sp, stage, [1, 0.5, 1, 1], 30, 9, -10, -1e9, 1e9, 0, 0.1, 0.9);
  } else if (T.id === 'climb') {
    const tw = [40.7553, -73.9838];
    for (const hc of GE.HELI_CIRCUITS.filter((x) => x.orbit && x.lat === 40.7553)) { const pts = []; for (let k = 0; k <= 64; k++) { const [la, lo] = geo.dest(hc.lat, hc.lon, (k / 64) * TAU, hc.r); pts.push(geo.vec(la, lo, hc.alt)); } pushPolyline(ln, pts, [0.62, 1, 0.6, 0.55], 1); }
    const r = rng(5);
    for (let i = 0; i < 41; i++) { const a = r() * TAU, d = 0.12 + r() * 0.35; const [la, lo] = geo.dest(tw[0], tw[1], a, d); const p = geo.vec(la, lo, 0.002); pushSpr(sp, p, [1, 0.84, 0.42, 1], 11, 6, -10, -1e9, 1e9, 0, 0, 0.5); pushPolyline(ln, [p, geo.vec(tw[0], tw[1], 0.12 + r() * 0.25)], [1, 0.8, 0.4, 0.22]); }
  }
  const set = { sprites: sp.length ? [makeSpriteSet('x' + id, sp)] : null, lines: ln.length ? [makeLineSet(ln)] : null };
  return (EXTRAS[id] = set);
};
GE.setLabels3d = function (L) { GE.extraLabels.clear(); for (const [la, lo, t, alt] of L || []) { const z = GE.scenes.byId.koshi.height && Math.abs(la - 28.2) < 0.2 && Math.abs(lo - 85.35) < 0.2 ? GE.scenes.groundAt(la, lo) / 1000 + 0.12 : alt || 0.05; GE.extraLabels.set('x:' + t, { lat: la, lon: lo, alt: z, html: `<i style="--c:var(--gold)"></i>${esc(t)}`, w: t.length * 6.6 + 32, cls: 'glass' }); } };
GE.setExtras = function (id) { GE.world.activeExtras = id ? GE.extrasFor(id) : null; GE.world.activeExtrasId = id; };

/* ---------- ledger (real SHA-256 hash chain) ---------- */
THR.ledgers = {};
async function buildLedger(T) {
  const entries = []; let ts = T.window.start - 6 * HR_;
  const push = (type, actor, payload) => { entries.push({ i: entries.length, ts: (ts += 7 * MIN + entries.length * 3 * MIN), type, actor, payload }); };
  push('thread.create', 'kora_maps', { title: T.title, place: T.place });
  for (const o of T.obs) push('observation.add', o.src.startsWith('@') ? o.src.split(' ')[0].slice(1) : 'ingest', { id: o.id, title: o.t, source: o.src, at: o.at, contentHash: o.hash });
  for (const hy of T.hyps) { push(hy.ai ? 'ai.proposal' : 'hypothesis.propose', hy.ai ? 'claude' : P[hy.by].h, hy.ai ? { id: hy.id, text: hy.text, cites: hy.cites, prompt: hy.prompt, model: 'claude (window.claude sample)', diff: '+' + hy.id } : { id: hy.id, text: hy.text, cites: hy.cites, confidence: hy.conf }); push('vote', P[T.people[(entries.length) % T.people.length]].h, { target: hy.id, agree: true }); }
  let prev = '0'.repeat(64);
  for (const e of entries) { e.digest = await sha256(canon(e.payload)); e.prev = prev; e.hash = await sha256(canon({ i: e.i, ts: e.ts, type: e.type, actor: e.actor, digest: e.digest, prev })); prev = e.hash; }
  THR.ledgers[T.id] = entries; return entries;
}
THR.append = async function (T, type, actor, payload) {
  const L = THR.ledgers[T.id] || (await buildLedger(T)); const prev = L[L.length - 1].hash;
  const e = { i: L.length, ts: Date.now(), type, actor, payload }; e.digest = await sha256(canon(payload)); e.prev = prev; e.hash = await sha256(canon({ i: e.i, ts: e.ts, type: e.type, actor: e.actor, digest: e.digest, prev })); L.push(e); return e;
};
THR.verify = async function (L, onStep) {
  let prev = '0'.repeat(64), ok = true;
  for (const e of L) { const dg = await sha256(canon(e.payload)); const hh = await sha256(canon({ i: e.i, ts: e.ts, type: e.type, actor: e.actor, digest: dg, prev })); const good = ok && dg === e.digest && e.prev === prev && hh === e.hash; if (!good) ok = false; onStep && (await onStep(e, good)); prev = e.hash; }
  return ok;
};
THR.init = async function () {
  for (const T of Object.values(THREADS)) { for (const o of T.obs) o.hash = await sha256(canon({ id: o.id, t: o.t, src: o.src, at: o.at, meta: o.meta })); await buildLedger(T); }
};

/* ---------- list ---------- */
THR.render = function () {
  const v = $('#v-threads');
  v.innerHTML = `<div class="tlist" id="tlist" style="background:var(--bg);min-height:100%"><div class="navbar">Rooms</div><div class="lt"><div class="kicker mono">${ic('threads', 'xs')} CONVERSATIONS ON THE EVIDENCE</div><div class="row"><h1>Rooms</h1><span class="concept" style="margin-bottom:8px">${ic('sparkles', 'xs')} Concept · illustrative data</span></div></div>
  <div class="livebar" style="padding-bottom:6px"><span class="presence"><span class="stack">${['nadia', 'lin', 'aiko', 'tomas', 'ines'].map((k) => GE.avatarHTML(k)).join('')}</span></span><span><b class="num">${fmt.n(Object.values(GE.rooms.byId).reduce((a, r) => a + r.watching, 0) || 9400)}</b> people in rooms now</span></div>
  <div class="rooms-why">Every situation has a room. Posts are <b>Witness</b>, <b>Context</b>, <b>Question</b>, <b>Correction</b> or <b>Prediction</b>, ordered by evidence — never by followers.</div>
  <div class="sec-h"><h2>Live rooms</h2><span>heating up</span></div><div id="roomsLive" class="rooms-live"></div>
  <div class="sec-h"><h2>Reconstructions</h2><span>4D · signed · open ledgers</span></div>
  ${Object.values(THREADS).map((T) => { const s = GE.SIT.byId[T.sit]; return `<article class="tcard" data-t="${T.id}" data-id="${T.sit}"><div class="thumb"><canvas width="640" height="360"></canvas><div class="bl"><div><h3>${esc(T.title)}</h3><p>${esc(T.place)} · ${esc(T.date)}</p></div><span class="badge d4">4D</span></div></div><div class="stats"><div><b>${T.obs.length}</b>observations</div><div><b>${T.hyps.length}</b>hypotheses</div><div><b>${THR.ledgers[T.id]?.length || '–'}</b>ledger</div><span class="stack">${T.people.slice(0, 4).map((k) => `<span class="avatar sm" style="--h:${P[k].hue}">${P[k].h[0].toUpperCase()}</span>`).join('')}</span></div></article>`; }).join('')}
  <div style="padding:6px 14px 150px"><button class="btn" style="width:100%" id="newThread">${ic('plus', 'sm')}Start a reconstruction</button><p style="font-size:11.5px;color:var(--text3);text-align:center;margin-top:12px">Concept · illustrative data. Witness posts, handles and claims are fictional.</p></div></div>
  <div class="ws" id="ws"></div>`;
  $('#newThread').addEventListener('click', () => APP.toast(`${ic('threads', 'sm')} New thread · add your first observation`));
  const host = $('#roomsLive'); const sq = GE.feed.squawkTrack();
  const extra = [{ id: 'room-sq', arch: 'room', band: 'inside', sit: 'squawk', title: 'Squawk 7700 over the North Atlantic', place: 'Diverting to ' + sq.div.iata, lat: sq.cur[0], lon: sq.cur[1], ago: 3, ev: [['cabin', { seed: 81 }], ['track', { track: sq }]] }, { id: 'room-fi', arch: 'room', band: 'inside', sit: 'fires', title: 'Central Portugal fires', place: 'N2 · Pampilhosa da Serra', lat: 40.13, lon: -8.05, ago: 8, ev: [['firewit', { seed: 71 }], ['firesat', {}]] }];
  const mine = GE.feed.user.filter((x) => x.sit && !['cyclone', 'quake', 'squawk', 'fires'].includes(x.sit)).map((x) => ({ id: 'room-' + x.sit, arch: 'room', band: 'inside', sit: x.sit, title: GE.SIT.byId[x.sit].title, place: GE.SIT.byId[x.sit].place, lat: x.lat, lon: x.lon, ago: 0 }));
  const items = [...mine, ...GE.feed.items().filter((x) => x.arch === 'room' && !x.recon), ...extra];
  for (const x of items) { x.at = x.at || NOW - (x.ago || 1) * 60000; x.dist = GE.feed.distFromMe(x.lat, x.lon); x.wide = true; host.append(GE.now.cardEl(x)); }
  $$('.tcard').forEach((c) => {
    c.addEventListener('click', () => THR.openWs(c.dataset.t));
    const cv = c.querySelector('canvas'); const s = GE.SIT.byId[c.dataset.id]; const done = GE.thumbs.done.get(s.id);
    if (done) cv.getContext('2d').drawImage(done, 0, 0, cv.width, cv.height); else { GE.thumbs.fallback(s, cv); }
  });
};

/* ---------- workspace ---------- */
THR.openWs = function (id) {
  const T = THREADS[id]; if (!T) return; const W = GE.world;
  if (APP.tab !== 'threads') APP.setTab('threads');
  THR.ws = { T, seg: THR.ws?.T === T ? THR.ws.seg : 'obs', beats: T.beats, playing: false };
  $('#tlist').style.display = 'none';
  const ws = $('#ws'); ws.classList.add('on');
  W.setWindow(T.window); W.setTime(T.beats[Math.min(2, T.beats.length - 1)].at);
  GE.setExtras(T.id); GE.setLabels3d(T.labels);
  for (const lid of ['signed', 'holo', 'helis']) W.layerById[lid].on = true;
  const wide = APP.isWide();
  Cam.autoSpin = 0; Cam.flyTo({ ...T.cam, shiftY: wide ? 0 : 0.6, shiftX: 0 });
  APP.setMode('workspace');
  THR.renderWs();
};
THR.closeWs = function (silent) {
  if (!THR.ws) return; THR.stop(); THR.ws = null; const W = GE.world;
  $('#ws').classList.remove('on'); $('#ws').innerHTML = ''; const tl = $('#tlist'); if (tl) tl.style.display = '';
  W.setWindow(null); W.setTime(null); GE.setExtras(null); GE.setLabels3d(null); APP.setMode('');
  if (!silent) Cam.flyTo(APP.heroCam());
};
THR.renderWs = function () {
  const { T, seg } = THR.ws; const ws = $('#ws');
  ws.innerHTML = `<div class="wsh"><button class="circ glass" id="wsBack" aria-label="Back">${ic('chevl')}</button><div class="tt glass"><span style="min-width:0;flex:1"><b>${esc(T.title)}</b><span class="sub">${esc(T.place)} · ${esc(T.date)}</span></span><span class="presence"><span class="stack">${T.people.slice(0, 4).map((k, i) => `<span class="avatar sm ${i < 3 ? 'on' : ''}" style="--h:${P[k].hue}">${P[k].h[0].toUpperCase()}</span>`).join('')}</span></span></div></div>
  <div class="body glass strong"><div class="seg" id="wsSeg">${[['obs', 'Observations'], ['hyp', 'Hypotheses'], ['nar', 'Narrative'], ['led', 'Ledger']].map(([k, l]) => `<button data-s="${k}" class="${seg === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="wsc" id="wsc"></div>
  ${seg === 'hyp' ? `<div class="composer glass strong" id="composer"><div class="sug">${T.suggestions.map((s) => `<button>${esc(s)}</button>`).join('')}</div><div class="row"><textarea id="aiIn" rows="1" placeholder="Ask AI to refine this reconstruction…"></textarea><button class="send" id="aiSend" aria-label="Send">${ic('arrowup')}</button></div></div>` : ''}</div>`;
  $('#wsBack').addEventListener('click', () => THR.closeWs());
  $$('#wsSeg button').forEach((b) => b.addEventListener('click', () => { THR.ws.seg = b.dataset.s; THR.renderWs(); haptic(4); }));
  const c = $('#wsc');
  if (seg === 'obs') c.innerHTML = `<div class="stratum">${ic('lock', 'xs')} Stratum 1 · Observations — immutable, hashed, sourced</div>` + T.obs.map((o) => `<div class="obs" data-o="${o.id}" style="--c:${GE.FAM[o.f].color}"><span class="oi">${ic(o.i)}</span><div><div class="ot"><span class="tagid">${o.id}</span> ${esc(o.t)}</div><div class="om"><span>${esc(o.src)}</span><span class="num">${fmt.utc(o.at)}</span>${o.meta.map((m) => `<span>${esc(m)}</span>`).join('')}<span class="mono">sha256 ${o.hash ? o.hash.slice(0, 12) + '…' : '…'}</span></div></div></div>`).join('');
  if (seg === 'hyp') { c.innerHTML = `<div class="stratum">${ic('people', 'xs')} Stratum 2 · Hypotheses — cite, agree, dispute, supersede</div><div id="hypList"></div>`; THR.renderHyps(); THR.bindComposer(); }
  if (seg === 'nar') THR.renderNarr(c);
  if (seg === 'led') THR.renderLedger(c);
  c.querySelectorAll('[data-o]').forEach((el) => el.addEventListener('click', () => { const o = T.obs.find((x) => x.id === el.dataset.o); if (o.lat) Cam.flyTo({ lat: o.lat - 0.004, lon: o.lon - 0.002, range: 0.0012, tilt: 1.15, heading: 0.4, shiftY: APP.isWide() ? 0 : 0.6 }); GE.world.setTime(o.at); APP.toast(`${ic('hash', 'sm')} ${o.id} · sha256 ${o.hash.slice(0, 16)}…`); }));
};
const confSVG = (h) => { const w = 200; return `<svg viewBox="0 0 ${w} 14" preserveAspectRatio="none"><rect x="0" y="5" width="${w}" height="4" rx="2" fill="rgba(255,255,255,.08)"/><rect x="${h.ci[0] * w}" y="3" width="${(h.ci[1] - h.ci[0]) * w}" height="8" rx="4" fill="${h.ai ? 'rgba(183,156,255,.3)' : 'rgba(124,196,255,.25)'}"/><rect x="${h.conf * w - 1.5}" y="1" width="3" height="12" rx="1.5" fill="${h.ai ? '#B79CFF' : '#7CC4FF'}"/></svg>`; };
THR.hypHTML = function (hy) {
  const p = P[hy.by] || P.ai;
  return `<div class="hyp ${hy.ai ? 'ai' : ''}" data-h="${hy.id}"><div class="hh">${hy.ai ? `<span class="avatar sm ai">${ic('sparkles', 'xs')}</span>` : `<span class="avatar sm" style="--h:${p.hue}">${p.h[0].toUpperCase()}</span>`}<b>${hy.ai ? 'AI proposal' : '@' + p.h}</b><span class="tagid">${hy.id}</span><span class="stt ${hy.status}">${hy.status}</span></div>
  <div class="hb" data-text>${esc(hy.text)}</div>
  <div class="conf"><span>confidence</span>${confSVG(hy)}<b class="num" style="color:var(--text)">${Math.round(hy.conf * 100)}%</b></div>
  <div class="cites">${hy.cites.map((x) => `<span class="tagid">${x}</span>`).join('')}${hy.prompt ? `<span style="font-size:11.5px;color:var(--text3)">prompt: “${esc(hy.prompt)}” · ${esc(hy.model || 'claude')}</span>` : ''}</div>
  <div class="hf"><button class="vote ${hy.myVote === 1 ? 'on' : ''}" data-v="1">${ic('thumbup', 'sm')}<span class="num">${hy.agree + (hy.myVote === 1 ? 1 : 0)}</span></button><button class="vote dis ${hy.myVote === -1 ? 'on' : ''}" data-v="-1">${ic('thumbdown', 'sm')}<span class="num">${hy.dispute + (hy.myVote === -1 ? 1 : 0)}</span></button><button class="vote" data-v="0" style="margin-left:auto">${ic('bubble', 'sm')}Cite</button></div></div>`;
};
THR.renderHyps = function () {
  const { T } = THR.ws; const host = $('#hypList'); if (!host) return;
  host.innerHTML = T.hyps.map(THR.hypHTML).join('');
  host.querySelectorAll('[data-h]').forEach((el) => el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', async () => {
    const hy = T.hyps.find((x) => x.id === el.dataset.h); const v = +b.dataset.v; haptic(5);
    if (v === 0) { APP.toast(`${ic('bubble', 'sm')} Cite ${hy.id} in a new hypothesis`); return; }
    hy.myVote = hy.myVote === v ? 0 : v; await THR.append(T, 'vote', 'you', { target: hy.id, agree: v === 1, retract: hy.myVote === 0 });
    THR.renderHyps(); APP.toast(`${ic('link', 'sm')} Vote recorded in the ledger`);
  })));
};
THR.bindComposer = function () {
  const ta = $('#aiIn'); const send = $('#aiSend'); if (!ta) return;
  $$('#composer .sug button').forEach((b) => b.addEventListener('click', () => { ta.value = b.textContent; ta.focus(); }));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } });
  send.addEventListener('click', () => { const q = ta.value.trim() || THR.ws.T.suggestions[0]; ta.value = ''; THR.refine(q); });
};
THR.refine = async function (q) {
  const { T } = THR.ws; const send = $('#aiSend'); if (send) send.disabled = true;
  const id = 'H' + (T.hyps.length + 1);
  const hy = { id, by: 'ai', ai: true, text: '', conf: 0.5, ci: [0.35, 0.65], cites: [], agree: 0, dispute: 0, status: 'proposed', prompt: q, model: '…' };
  T.hyps.push(hy); THR.renderHyps();
  const card = $(`[data-h="${id}"]`); card?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  const textEl = () => $(`[data-h="${id}"] [data-text]`);
  const promptStr = `You are helping a group of people reconstruct a real-world event from evidence, in an app that keeps observations (immutable) separate from hypotheses (claims).\nEvent: ${T.title} — ${T.place} (${T.date}). Some witness posts are illustrative.\nObservations:\n${T.obs.map((o) => `[${o.id}] ${o.t} — ${o.src}, ${new Date(o.at).toISOString().slice(0, 16)}Z (${o.meta.join('; ')})`).join('\n')}\nCurrent hypotheses:\n${T.hyps.filter((x) => x.id !== id).map((x) => `[${x.id}] ${x.text} (confidence ${x.conf})`).join('\n')}\nRequest from a participant: "${q}"\nReply with ONE new proposed hypothesis in at most 70 words. Cite observation IDs in square brackets like [O3]. Do not invent new observations. End with a final line exactly like "Confidence: 0.xx".`;
  let out = '', model = 'scripted fallback (no AI available here)';
  const render = (txt) => { out = txt; const el = textEl(); if (el) el.textContent = txt.replace(/\n?Confidence:.*$/s, '').trim() || '…'; };
  let sample = null;
  try { sample = window.claude?.use ? await window.claude.use('sample') : null; } catch { sample = null; }
  if (sample) {
    try { const r = await sample(promptStr, { onText: ({ text }) => render(text) }); render(r?.text ?? out); model = 'claude · window.claude sample'; }
    catch (e) { sample = null; }
  }
  if (!sample) { const full = T.fallback; for (let i = 1; i <= full.length; i += 3) { render(full.slice(0, i)); await new Promise((r) => setTimeout(r, prefersReduced() ? 0 : 12)); } render(full); }
  const cm = /Confidence:\s*([0-9.]+)/i.exec(out); hy.conf = cm ? clamp(parseFloat(cm[1]), 0.05, 0.95) : 0.55; hy.ci = [Math.max(0, hy.conf - 0.16), Math.min(1, hy.conf + 0.14)];
  hy.cites = [...new Set((out.match(/\[(O\d+)\]/g) || []).map((x) => x.slice(1, -1)))]; hy.text = out.replace(/\n?Confidence:.*$/s, '').trim(); hy.model = model;
  const e = await THR.append(T, 'ai.proposal', 'claude', { id, prompt: q, model, inputs: hy.cites, output: hy.text, diff: '+' + id });
  THR.renderHyps(); if (send) send.disabled = false;
  APP.toast(`${ic('sparkles', 'sm')} Proposed ${id} · ledger #${e.i} · ${e.hash.slice(0, 10)}…`, 3000);
};

/* narrative */
THR.renderNarr = function (c) {
  const { T } = THR.ws;
  c.innerHTML = `<div class="stratum">${ic('play', 'xs')} Stratum 3 · Narrative — a camera path through space-time</div><div class="playbar"><button class="playbtn" id="play" aria-label="Play">${ic(THR.ws.playing ? 'pause' : 'play')}</button><div style="flex:1"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:6px"><span class="num" id="narT">${fmt.utc(GE.world.simMs)}</span><span>${T.beats.length} beats</span></div><div class="prog"><i id="narP"></i></div></div></div><div class="narr">${T.beats.map((b, i) => `<div class="beat" data-b="${i}"><span class="bt">${b.t}<br><span style="font-size:10px;color:var(--text3)">UTC</span></span><div><p>${esc(b.text)}</p><div class="cites">${b.cites.map((x) => `<span class="tagid">${x}</span>`).join('')}</div></div></div>`).join('')}</div>`;
  $('#play').addEventListener('click', () => (THR.ws.playing ? THR.stop() : THR.play()));
  c.querySelectorAll('[data-b]').forEach((el) => el.addEventListener('click', () => THR.goBeat(+el.dataset.b)));
};
THR.goBeat = function (i, dur) { const { T } = THR.ws; const b = T.beats[i]; THR.ws.beat = i; Cam.flyTo({ ...b.cam, shiftY: APP.isWide() ? 0 : 0.6 }, { duration: dur ?? 2.2 }); GE.world.setTime(b.at); $$('.beat').forEach((x) => x.classList.toggle('on', +x.dataset.b === i)); };
THR.play = function () {
  const ws = THR.ws; ws.playing = true; const T = ws.T; const per = 3.6; const t0 = performance.now(); let last = -1;
  const btn = $('#play'); if (btn) btn.innerHTML = ic('pause');
  const step = () => {
    if (!THR.ws || !THR.ws.playing) return; const el = (performance.now() - t0) / 1000; const total = per * T.beats.length;
    const f = clamp(el / total, 0, 1); const bi = Math.min(T.beats.length - 1, Math.floor(el / per));
    if (bi !== last) { last = bi; THR.goBeat(bi, per * 0.9); }
    const a = T.beats[bi], b = T.beats[Math.min(T.beats.length - 1, bi + 1)]; const u = clamp((el - bi * per) / per, 0, 1);
    GE.world.setTime(lerp(a.at, b.at, bi === T.beats.length - 1 ? 0 : u));
    const p = $('#narP'); if (p) p.style.width = (f * 100).toFixed(1) + '%'; const nt = $('#narT'); if (nt) nt.textContent = fmt.utc(GE.world.simMs);
    if (f >= 1) { THR.stop(); return; } requestAnimationFrame(step);
  };
  step();
};
THR.stop = function () { if (!THR.ws) return; THR.ws.playing = false; const btn = $('#play'); if (btn) btn.innerHTML = ic('play'); };

/* ledger */
THR.renderLedger = function (c) {
  const { T } = THR.ws; const L = THR.ledgers[T.id] || [];
  c.innerHTML = `<div class="stratum">${ic('link', 'xs')} Ledger — SHA-256 hash chain · ${L.length} entries</div><div class="btnrow" style="margin:4px 0 10px"><button class="btn sm pri" id="lv">${ic('check', 'sm')}Verify chain</button><button class="btn sm" id="lt">${THR._tampered ? 'Restore entry #3' : 'Tamper with #3'}</button><button class="btn sm" id="lx">${ic('share', 'sm')}Export</button></div><div class="ledger" id="led">${L.map((e) => `<div class="le" data-i="${e.i}"><div class="lh"><span class="ix">#${e.i}</span><span class="ty">${esc(e.type)} <span>· @${esc(e.actor)}</span></span><span class="vk" data-vk></span></div><div style="margin-left:34px" class="hs">${e.hash.slice(0, 20)}… ← ${e.prev.slice(0, 8)}…</div><pre>${esc(JSON.stringify({ i: e.i, ts: new Date(e.ts).toISOString(), type: e.type, actor: e.actor, payload: e.payload, digest: e.digest, prev: e.prev, hash: e.hash }, null, 1))}</pre></div>`).join('<div class="chain"></div>')}</div>`;
  c.querySelectorAll('.le .lh').forEach((x) => x.addEventListener('click', () => x.parentElement.classList.toggle('open')));
  $('#lv').addEventListener('click', async () => {
    c.querySelectorAll('[data-vk]').forEach((x) => { x.className = 'vk'; x.innerHTML = ''; });
    const ok = await THR.verify(L, async (e, good) => { const el = c.querySelector(`.le[data-i="${e.i}"] [data-vk]`); if (el) { el.className = 'vk ' + (good ? 'ok' : 'bad'); el.innerHTML = ic(good ? 'check' : 'x', 'xs'); el.scrollIntoView({ block: 'nearest' }); } await new Promise((r) => setTimeout(r, prefersReduced() ? 0 : 45)); });
    APP.toast(ok ? `${ic('check', 'sm')} Chain verified · ${L.length} links intact` : `${ic('x', 'sm')} Chain broken at #3 — a payload no longer matches its digest`, 2800); haptic(ok ? 10 : [20, 60, 20]);
  });
  $('#lt').addEventListener('click', () => { const e = L[3]; if (!e) return; if (THR._tampered) { e.payload = THR._tampered; THR._tampered = null; } else { THR._tampered = e.payload; e.payload = { ...e.payload, title: (e.payload.title || e.payload.text || '') + ' (edited)' }; } THR.renderLedger(c); APP.toast(THR._tampered ? 'Entry #3 edited locally — now verify' : 'Entry #3 restored'); });
  $('#lx').addEventListener('click', () => { try { const blob = new Blob([JSON.stringify(L, null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `ledger-${T.id}.json` }); document.body.append(a); a.click(); a.remove(); } catch {} APP.toast(`${ic('share', 'sm')} Ledger exported as JSON`); });
};
