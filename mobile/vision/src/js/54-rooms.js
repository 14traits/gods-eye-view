/* Rooms — every situation has one. Structured posts (Witness / Context / Question / Correction /
   Prediction) anchored in place and time, badges earned from evidence, community notes shown only when
   raters who usually disagree both find them helpful, and a Known / Disputed / Unknown synthesis whose
   every line cites a post or an observation. All people, posts and claims are fictional. */
const RM = (GE.rooms = { byId: {} });
const MIN_ = 60000, HR2 = 3600000;
RM.KINDS = {
  witness: { name: 'Witness', icon: 'eye', tone: 'gold', hint: 'I saw or recorded this' },
  context: { name: 'Context', icon: 'layers', tone: 'sky', hint: 'Background, a map, a source' },
  question: { name: 'Question', icon: 'bubble', tone: 'white', hint: 'Floats to the top until answered' },
  correction: { name: 'Correction', icon: 'flag', tone: 'amber', hint: 'Something here is wrong' },
  prediction: { name: 'Prediction', icon: 'clock', tone: 'orbit', hint: 'What happens next — scored later' },
};
const P0 = GE.PEOPLE;
const kmBetween = (a, b, c, d) => geo.dist(a, b, c, d) * EARTH_KM;
RM.kmBetween = kmBetween;

/* ---------- room content ---------- */
const CY = GE.CYCLONE.at(0);
const ROOMS = {
  cyclone: {
    watching: 3204, rate: 4,
    src: { O1: 'Geostationary IR mosaic · 01:40Z', O2: 'Advisory + 14 ensemble tracks · 3 h', O3: 'AIS vessel positions · 40 s', S1: 'Sealed live stream, 6 segments · @nadia_basco' },
    posts: [
      { id: 'cy1', kind: 'witness', by: 'nadia', ago: 4, live: true, text: 'Waves are coming over the seawall by the port every 30–40 seconds. The road behind it is ankle-deep. The wall itself is intact from what I can see — I\'m 200 m up the slope.', place: { lat: 20.4485, lon: 121.9705, label: 'Basco seawall' }, att: { paint: 'seawall', o: { handheld: true, noOSD: true, seed: 52 }, tier: 'sealed-live', segs: 6, distKm: 0.2 }, reacts: { eye: 1240, heart: 212, alert: 48 }, replies: 31 },
      { id: 'cy2', kind: 'question', by: 'rafa', ago: 6, text: 'Is the Magapit bridge into Aparri still open? Nobody here knows and the power is out.', place: { lat: 18.12, lon: 121.65, label: 'Magapit bridge' }, reacts: { eye: 96 }, replies: 2 },
      { id: 'cy3', kind: 'context', by: 'lin', ago: 11, text: 'An eyewall replacement looks likely in the next 12 h. Expect the peak wind number to drop while the wind field gets wider. For Batanes that is not good news, so don\'t read a lower number as "weakening".', cites: ['O1', 'O2'], reacts: { heart: 340, eye: 520 }, replies: 18 },
      { id: 'cy4', kind: 'witness', by: 'repost', ago: 9, text: 'VIDEO: Basco port pier has COLLAPSED!! Share before it\'s deleted', att: { paint: 'harbour', o: { seed: 19, cam: 'CAM 03', place: 'PORT' }, tier: 'unverified', distKm: null }, reacts: { alert: 860 }, replies: 77,
        note: { text: 'This clip is from a 2019 storm at a different port. Reverse-image search finds 3 earlier copies. The pier is visible and intact in tonight\'s sealed live stream from Basco [P1].', helpfulA: 0.81, helpfulB: 0.74, ratersA: 118, ratersB: 94, cites: ['P1'] } },
      { id: 'cy5', kind: 'prediction', by: 'joon', ago: 14, text: 'Kaohsiung will close the port to outbound traffic by 06:00 local. 11 ships have already left the anchorage and are heading south of the track.', place: { lat: 22.61, lon: 120.27, label: 'Kaohsiung pier 70' }, att: { paint: 'harbour', o: { seed: 8, cam: 'HBR-07', place: 'KAOHSIUNG PIER 70' }, tier: 'eye', distKm: null }, cites: ['O3'], reacts: { eye: 210, heart: 41 }, replies: 6, resolves: '06:00 local' },
      { id: 'cy6', kind: 'witness', by: 'rafa', ago: 22, text: 'Power out across Aparri centro since 01:10. The hospital is on generators. Rain is sideways.', place: { lat: 18.357, lon: 121.637, label: 'Aparri centro' }, att: { paint: 'blackout', o: { seed: 91 }, tier: 'sealed', distKm: 0.4 }, reacts: { heart: 190, eye: 300 }, replies: 9 },
      { id: 'cy7', kind: 'correction', by: 'ais', ago: 18, text: 'Correction to an earlier post: there are 2 ships holding off Batanes, not 6. The other 4 are at anchor in the lee of Sabtang and are fine.', cites: ['O3'], place: { lat: 20.34, lon: 121.85, label: 'Sabtang lee' }, reacts: { heart: 88 }, replies: 3 },
    ],
    synth: {
      known: [['Waves are overtopping the Basco seawall near the port; the wall itself is intact as of a few minutes ago.', ['P1', 'S1']], ['Eyewall cloud tops are colder than −80 °C with frequent lightning.', ['O1']], ['Aparri centro has lost power; the hospital is on generators.', ['P6']]],
      disputed: [['A viral "collapsed pier" video — a community note shows it predates this storm.', ['P4', 'N1']], ['Whether Halcyon is weakening: peak wind estimates dip while the wind field broadens.', ['P3', 'O2']]],
      unknown: [['Whether the Magapit bridge into Aparri is open — asked 6 min ago, no evidence yet.', ['P2']], ['Landfall point: guidance still spreads ±150 km at 36 h.', ['O2']]],
    },
  },
  quake: {
    watching: 1880, rate: 2,
    src: { O1: 'Seismic catalog · revised 12 min ago', O2: 'Tide gauges · 3 min', O3: 'Rail status boards · 9 min' },
    posts: [
      { id: 'qk1', kind: 'question', by: 'aiko', ago: 48, text: 'Are trains running north of Sendai yet? Stuck at the station with my kids.', place: { lat: 38.26, lon: 140.88, label: 'Sendai station' }, answered: 'qk2', reacts: { eye: 140 }, replies: 5 },
      { id: 'qk2', kind: 'context', by: 'tetsu', ago: 41, text: 'Northbound service resumed at 02:41 after track inspection. Expect 20–30 min delays through Fukushima.', cites: ['O3'], reacts: { heart: 220 }, replies: 4 },
      { id: 'qk3', kind: 'witness', by: 'aiko', ago: 300, text: 'Long rolling shake, maybe 40 seconds. Shelves came down in the store and everyone came out onto the street. Nobody hurt here.', place: { lat: 38.262, lon: 140.871, label: 'Aoba-ku' }, att: { paint: 'crossing', o: { seed: 33, cam: 'PHONE', rec: false }, tier: 'sealed', distKm: 162 }, reacts: { heart: 410, eye: 700 }, replies: 22 },
      { id: 'qk4', kind: 'correction', by: 'geo', ago: 280, text: 'The depth is 32 km in the revised solution, not the 10 km in early reposts. That matters for how far the shaking reached.', cites: ['O1'], reacts: { heart: 160 }, replies: 7 },
      { id: 'qk5', kind: 'witness', by: 'repost', ago: 310, text: 'TSUNAMI 3 METERS hitting the coast right now!!!', reacts: { alert: 1900 }, replies: 140,
        note: { text: 'Tide gauges along the coast recorded at most 20 cm [O2]. No tsunami warning was issued. The video attached to the original claim is from 2011.', helpfulA: 0.88, helpfulB: 0.79, ratersA: 302, ratersB: 241, cites: ['O2'] } },
      { id: 'qk6', kind: 'prediction', by: 'geo', ago: 200, text: 'Chance of an M5+ aftershock in the next 72 h is about 1 in 4 for a sequence like this. Not a reason to panic, a reason to secure shelves.', cites: ['O1'], reacts: { heart: 98 }, replies: 11, resolves: 'in 72 h' },
    ],
    synth: {
      known: [['An M 6.4 thrust event at 32 km depth off the Honshu coast.', ['O1', 'P4']], ['Tide gauges recorded at most 20 cm; no tsunami.', ['O2', 'N1']], ['Northbound trains resumed at 02:41 with delays.', ['P2', 'O3']]],
      disputed: [['Early reposts claimed a 3 m tsunami — rated false by raters across perspectives.', ['P5', 'N1']]],
      unknown: [['Damage inland of Fukushima — the only sealed capture so far is from Sendai.', ['P3']], ['Whether a larger aftershock follows (≈ 1 in 4 within 72 h).', ['P6']]],
    },
  },
  squawk: {
    watching: 2410, rate: 3,
    src: { O1: 'ADS-B · 1 Hz', O2: 'Diversion airport board · 2 min' },
    posts: [
      { id: 'sq1', kind: 'witness', by: 'seat', ago: 7, text: 'On board. Masks dropped about 20 minutes ago. Crew are calm, we\'re descending and they said we\'re landing soon. Everyone is OK.', att: { paint: 'cabin', o: { seed: 81 }, tier: 'sealed', distKm: 0 }, reacts: { heart: 1820, eye: 2100 }, replies: 64 },
      { id: 'sq2', kind: 'context', by: 'tomas', ago: 12, text: 'Squawk 7700, a turn toward the nearest long runway and a steady ~2,400 ft/min descent to FL100 is what a pressurisation problem looks like. It is a well-practised procedure.', cites: ['O1'], reacts: { heart: 960 }, replies: 21 },
      { id: 'sq3', kind: 'question', by: 'sky', ago: 5, text: 'Does anyone know which runway they\'ll use? Wind there is strong from the east.', reacts: { eye: 44 }, replies: 1 },
      { id: 'sq4', kind: 'prediction', by: 'tomas', ago: 9, text: 'They\'ll be on the ground in about 34 minutes.', cites: ['O1', 'O2'], reacts: { heart: 120 }, replies: 2, resolves: 'at landing' },
    ],
    synth: {
      known: [['The aircraft squawked 7700, turned toward the diversion airport and is descending.', ['O1']], ['A passenger on board reports masks deployed and the crew calm.', ['P1']]],
      disputed: [],
      unknown: [['The cause — the descent profile fits a pressurisation problem, unconfirmed.', ['P2']], ['Landing runway and time (est. ~34 min).', ['P3', 'P4']]],
    },
  },
  fires: {
    watching: 1460, rate: 2,
    src: { O1: 'VIIRS 375 m hotspots · 38 min', O2: 'Wind model · 1 h' },
    posts: [
      { id: 'fi1', kind: 'witness', by: 'ines', ago: 26, text: 'The ridge above the N2 is burning along about two kilometres. Ash is falling on the road. Traffic is still moving south.', place: { lat: 40.13, lon: -8.05, label: 'N2 at the ridge' }, att: { paint: 'firewit', o: { seed: 71 }, tier: 'sealed', distKm: 1.8 }, reacts: { heart: 260, eye: 900 }, replies: 18 },
      { id: 'fi2', kind: 'context', by: 'bomb', ago: 20, text: 'Front is moving west at about 1.2 km/h. The N2 will close between the two junctions within the hour. Please don\'t stop on the road to film.', cites: ['O1', 'O2'], reacts: { heart: 700 }, replies: 12 },
      { id: 'fi3', kind: 'question', by: 'ines', ago: 8, text: 'Is the IC8 open toward Coimbra?', reacts: { eye: 60 }, replies: 0 },
    ],
    synth: { known: [['A fire front about 2 km long is burning above the N2, moving west ~1.2 km/h.', ['P1', 'P2', 'O1']]], disputed: [], unknown: [['Whether the IC8 toward Coimbra is open.', ['P3']]] },
  },
};
// light rooms for the rest: a context post from the brief + an open question
function liteRoom(s) {
  const by = ['kora', 'sky', 'geo', 'ais', 'hydro'][s.id.length % 5];
  return { watching: Math.round((s.watchers || 2000) * 0.06) + 40, rate: 1, src: Object.fromEntries((s.brief?.sources || []).slice(0, 3).map(([n, a], i) => ['O' + (i + 1), `${n} · ${a}`])),
    posts: [{ id: s.id + '-1', kind: 'context', by, ago: 12, text: s.brief?.lede || s.title, cites: ['O1'], reacts: { heart: 40, eye: 120 }, replies: 3 }, { id: s.id + '-2', kind: 'question', by: 'kora', ago: 5, text: 'Anyone close enough to send a sealed capture?', reacts: { eye: 20 }, replies: 0 }],
    synth: { known: [[s.brief?.lede?.split('. ')[0] + '.', ['O1', 'P1']]], disputed: [], unknown: [['No witness captures yet.', ['P2']]] } };
}

/* ---------- derived: badges, evidence score, ordering ---------- */
RM.badges = function (room, p) {
  const s = GE.SIT.byId[room.sit]; const who = P0[p.by] || {}; const out = [];
  const sealed = p.att && /^sealed/.test(p.att.tier);
  if (sealed && p.att.distKm != null && p.att.distKm <= 5) out.push(['there', `Was there · ${p.att.distKm < 1 ? Math.round(p.att.distKm * 1000) + ' m' : p.att.distKm.toFixed(1) + ' km'}`]);
  if (sealed) out.push(['sealed', p.att.tier === 'sealed-live' ? 'Sealed live' : 'Sealed']);
  if (who.home && s && kmBetween(who.home[0], who.home[1], p.place?.lat ?? s.lat, p.place?.lon ?? s.lon) < 120) out.push(['local', 'Local']);
  if (who.domain) out.push(['domain', who.domain]);
  if (p.att && p.att.tier === 'unverified') out.push(['unv', 'Unverified upload']);
  if (p.by === 'you' && GE.ME && s && kmBetween(GE.ME.lat, GE.ME.lon, s.lat, s.lon) < 120 && !out.some((b) => b[0] === 'local')) out.push(['local', 'Local']);
  return out;
};
RM.score = function (room, p) { let sc = 0; for (const [k] of RM.badges(room, p)) sc += { there: 4, sealed: 3, domain: 2, local: 1, unv: -2 }[k] || 0; if (p.att?.tier === 'eye') sc += 1; if (p.note) sc -= 3; return sc; };
RM.ordered = function (room, mode = 'evidence') {
  const ps = room.posts.slice();
  const openQ = (p) => p.kind === 'question' && !p.answered;
  if (mode === 'latest') return ps.sort((a, b) => b.at - a.at);
  if (mode === 'questions') return ps.filter((p) => p.kind === 'question').sort((a, b) => (openQ(b) - openQ(a)) || b.at - a.at);
  return ps.sort((a, b) => (openQ(b) - openQ(a)) || RM.score(room, b) - RM.score(room, a) || b.at - a.at);
};
RM.pid = (room, p) => 'P' + (room.posts.indexOf(p) + 1);
RM.byPid = (room, pid) => room.posts[+pid.slice(1) - 1];

/* ---------- ledger per room (real SHA-256 chain) ---------- */
RM.append = async function (room, type, actor, payload) {
  const L = room.ledger; const prev = L.length ? L[L.length - 1].hash : '0'.repeat(64);
  const e = { i: L.length, ts: Date.now(), type, actor, payload }; e.digest = await sha256(canon(payload)); e.prev = prev; e.hash = await sha256(canon({ i: e.i, ts: e.ts, type: e.type, actor: e.actor, digest: e.digest, prev })); L.push(e); return e;
};

/* ---------- build ---------- */
RM.get = function (sitId) {
  if (RM.byId[sitId]) return RM.byId[sitId];
  const s = GE.SIT.byId[sitId]; if (!s) return null;
  const R0 = ROOMS[sitId] || liteRoom(s);
  const room = { sit: sitId, ...R0, ledger: [], posts: R0.posts.map((p) => ({ ...p, at: NOW - (p.ago || 1) * MIN_ })) };
  for (const p of room.posts) if (p.att && p.att.paint === 'seawall' && p.live) p.att.o.cam = '@' + P0[p.by].h;
  RM.byId[sitId] = room;
  (async () => { for (const p of room.posts) await RM.append(room, 'post.' + p.kind, P0[p.by]?.h || p.by, { id: p.id, text: p.text, att: p.att ? { tier: p.att.tier } : null, place: p.place || null }); })();
  return room;
};
RM.count = (sitId) => { const r = ROOMS[sitId]; return r ? r.posts.length : 2; };
RM.watching = (sitId) => (RM.byId[sitId]?.watching) ?? ROOMS[sitId]?.watching ?? Math.round((GE.SIT.byId[sitId]?.watchers || 2000) * 0.06) + 40;
RM.sealedCount = (sitId) => { const r = RM.byId[sitId] || ROOMS[sitId]; return r ? r.posts.filter((p) => p.att && /^sealed/.test(p.att.tier)).length : 0; };
RM.topClaim = function (sitId) {
  const r = ROOMS[sitId]; if (!r) return null;
  const open = r.posts.find((p) => p.kind === 'question' && !p.answered);
  const k = r.synth.known[0], d = r.synth.disputed[0];
  return { q: open?.text, known: k?.[0], disputed: d?.[0], sealed: r.posts.filter((p) => p.att && /^sealed/.test(p.att.tier)).length };
};
