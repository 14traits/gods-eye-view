/* Feed model — mixed archetypes across the four altitude bands, ordered for diversity.
   Bands answer "where is the sensor": Orbit, Sky, Ground, and Inside (a person). */
const FD = (GE.feed = {});
GE.BANDS = {
  orbit: { name: 'Orbit', c: '#B79CFF', alt: '400–36,000 km', sensor: 'satellites · ISS · launches' },
  sky: { name: 'Sky', c: '#8CD4FF', alt: '0–15 km', sensor: 'aircraft · radar · lightning' },
  ground: { name: 'Ground', c: '#FFA53D', alt: '0 m', sensor: 'cameras · seismometers · crowds' },
  inside: { name: 'Inside', c: '#F2CF7A', alt: 'you', sensor: 'witnesses · broadcasts · rooms' },
};
GE.ARCH = { sensor: 'Sensor', eye: 'Eye', track: 'Track', number: 'Number', witness: 'Witness', room: 'Room' };
const MIN3 = 60000;
FD.fmtDist = (km) => (km < 1 ? Math.round(km * 1000) + ' m' : km < 100 ? km.toFixed(km < 10 ? 1 : 0) + ' km' : fmt.n(Math.round(km)) + ' km');
FD.distFromMe = (lat, lon) => geo.dist(GE.ME.lat, GE.ME.lon, lat, lon) * EARTH_KM;
const llz = (lat, lon) => `${Math.abs(lat).toFixed(2)}${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}${lon >= 0 ? 'E' : 'W'}`;
const hmsZ = () => { const d = new Date(); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}Z`; };
FD.hmsZ = hmsZ; FD.llz = llz;

/* the diverting flight, computed from the synthetic traffic so card, room and globe agree */
FD.squawkTrack = function () {
  if (FD._sq) return FD._sq;
  const f = GE.FLIGHTS[GE.world.squawks[0]]; const pts = [];
  for (let k = -90; k <= 0; k += 3) { const p = GE.flightAt(f, GE.world.t + k * 60); if (p) pts.push([p.lat, p.lon]); }
  let ok = pts.length > 12;
  if (!ok) { pts.length = 0; for (let k = 0; k <= 30; k++) pts.push(k < 18 ? [55 + k * 0.12, -10 - k * 0.9] : [57.1 + (k - 18) * 0.25, -26.2 - (k - 18) * 0.35]); }
  const cur = pts[pts.length - 1]; let div = null, bd = 1e9;
  for (const a of GE.AP) { if (a.w < 8) continue; const d = geo.dist(cur[0], cur[1], a.lat, a.lon); if (d < bd && d > 0.02) { bd = d; div = a; } }
  if (!ok) div = GE.apByIata.RKV || div;
  // bend the last third toward the diversion field
  const k0 = Math.floor(pts.length * 0.62); const bend = pts.slice(0, k0 + 1); const a = pts[k0];
  for (let i = 1; i <= pts.length - 1 - k0; i++) { const t = (i / (pts.length - 1 - k0)) * 0.45; bend.push([lerp(a[0], div.lat, t), lerp(a[1], div.lon, t)]); }
  const alt = [37000, 37000, 36000, 31000, 27000, 24000];
  FD._sq = { pts: bend, sqAt: k0, div: { lat: div.lat, lon: div.lon, iata: div.iata, city: div.city }, alt, cur: bend[bend.length - 1] };
  // put the same track on the globe: white before the declaration, red after, the aircraft at its head
  const W = GE.world; const C2 = FD._sq.cur; const alt3 = (i) => 10.5 - Math.max(0, i - k0) * 0.25;
  W.extraLines.push({ pts: bend.slice(0, k0 + 1).map(([la, lo], i) => geo.vec(la, lo, alt3(i))), col: [0.85, 0.9, 1, 0.55] }, { pts: bend.slice(k0).map(([la, lo], i) => geo.vec(la, lo, alt3(i + k0))), col: [1, 0.25, 0.2, 0.95] }, { pts: [geo.vec(C2[0], C2[1], 7), geo.vec(div.lat, div.lon, 0)], col: [1, 0.45, 0.4, 0.5], dashed: 1 });
  (W.extraSprites = W.extraSprites || []).push({ v: geo.vec(C2[0], C2[1], 7), col: [1, 0.23, 0.19, 1], size: 30 });
  const s = GE.SIT.byId.squawk; if (s) { s.lat = C2[0]; s.lon = C2[1]; s.camera = { lat: C2[0] - 4, lon: C2[1] - 3, range: 0.14, heading: 0.35, tilt: 0.85 }; }
  return FD._sq;
};

/* ---------- items ---------- */
FD.items = function () {
  if (FD._items) return FD._items;
  const C = GE.CYCLONE.at(0); const sq = FD.squawkTrack(); const iss = GE.SIT.issPass(Date.now());
  const it = [
    { id: 'basco', arch: 'witness', band: 'inside', sit: 'cyclone', post: 'cy1', wide: true, prio: 100, live: true, by: 'nadia', paint: 'seawall', po: { handheld: true, noOSD: true, seed: 52 }, aspect: 0.62,
      title: 'Waves over the Basco seawall — live from the port', place: 'Basco, Batanes', lat: 20.4485, lon: 121.9705, ago: 14,
      tele: () => `WITNESS · SEALED LIVE · ±4 M · ${fmt.n(Math.round(RM.kmBetween(20.4485, 121.9705, C.lat, C.lon)))} KM FROM EYE` },
    { id: 'ir', arch: 'sensor', band: 'orbit', sit: 'cyclone', prio: 95, paint: 'ir', aspect: 1.25, title: 'Typhoon Halcyon: −83 °C cloud tops and lightning in the eyewall', place: 'Philippine Sea', lat: C.lat, lon: C.lon, ago: 2,
      tele: () => `ORBIT · GEO IR · 35,786 KM · ${llz(C.lat, C.lon)}` },
    { id: 'cabin', arch: 'witness', band: 'inside', sit: 'squawk', post: 'sq1', prio: 92, by: 'seat', paint: 'cabin', aspect: 1.3, title: '“Masks dropped. Crew calm. We’re descending.” — on board the 7700', place: 'Over the North Atlantic', lat: sq.cur[0], lon: sq.cur[1], ago: 7,
      tele: () => 'WITNESS · SEALED · ON BOARD · FL240' },
    { id: 'harbour', arch: 'eye', band: 'ground', sit: 'cyclone', post: 'cy5', prio: 90, live: true, paint: 'harbour', po: { seed: 8, cam: 'HBR-07', place: 'KAOHSIUNG · PIER 70' }, aspect: 1.0, title: 'Kaohsiung harbour cam: ships leave ahead of Halcyon', place: 'Kaohsiung, Taiwan', lat: 22.61, lon: 120.27, ago: 0,
      tele: () => `GROUND · CAM HBR-07 · ${llz(22.61, 120.27)} · ${hmsZ()}` },
    { id: 'squawk', arch: 'track', band: 'sky', sit: 'squawk', prio: 89, live: true, paint: 'track', po: { track: sq }, aspect: 1.15, title: `Squawk 7700 — diverting to ${sq.div.iata} ${sq.div.city ? '(' + sq.div.city + ')' : ''}`, place: 'Over the North Atlantic', lat: sq.cur[0], lon: sq.cur[1], ago: 3,
      readout: 'SQ 7700 · FL240 ↓', tele: () => 'SKY · ADS-B · 2,400 FPM ↓ · 412 KT', cta: ['airplane', 'Follow the track'] },
    { id: 'room-cy', arch: 'room', band: 'inside', sit: 'cyclone', prio: 88, wide: true, title: 'Typhoon Halcyon', place: 'Batanes · Babuyan · Luzon Strait', lat: 20.45, lon: 121.97, ago: 1, ev: [['seawall', { noOSD: true, seed: 52 }], ['harbour', { seed: 8, cam: 'HBR-07' }], ['blackout', { seed: 91 }], ['ir', {}]] },
    { id: 'radar', arch: 'sensor', band: 'sky', sit: 'dfw', prio: 86, paint: 'radar', aspect: 1.2, title: 'Bowing squall line crossing Dallas–Fort Worth — tornado warning', place: 'Dallas–Fort Worth', lat: 32.82, lon: -97.0, ago: 2,
      tele: () => 'SKY · RADAR 0.5° · 62 DBZ · 72 KM/H E' },
    { id: 'crossing', arch: 'eye', band: 'ground', sit: 'shibuya', prio: 84, live: true, paint: 'crossing', po: { seed: 31, cam: 'CAM 0412', place: 'SHIBUYA SCRAMBLE' }, aspect: 1.25, title: 'Shibuya crossing in the rain: ~2,400 people every cycle', place: 'Shibuya, Tokyo', lat: 35.6595, lon: 139.7005, ago: 0,
      tele: () => `GROUND · CAM 0412 · ${llz(35.6595, 139.7005)} · ${hmsZ()}` },
    { id: 'shake', arch: 'sensor', band: 'ground', sit: 'quake', prio: 83, paint: 'shake', aspect: 1.15, title: 'M 6.4 off Honshu: strongest shaking on the Fukushima coast', place: 'Off eastern Honshu', lat: GE.BIGQ.lat, lon: GE.BIGQ.lon, ago: 324,
      tele: () => 'GROUND · 46 STATIONS · MMI VI · 32 KM DEEP' },
    { id: 'firesat', arch: 'sensor', band: 'orbit', sit: 'fires', prio: 80, paint: 'firesat', aspect: 1.1, title: 'Central Portugal: a 60 km smoke plume drifts toward the coast', place: 'Pampilhosa da Serra', lat: 40.05, lon: -7.95, ago: 38,
      tele: () => 'ORBIT · 375 M · FRP 840 MW · WIND ESE 31' },
    { id: 'isscam', arch: 'eye', band: 'orbit', sit: 'iss', prio: 79, live: true, paint: 'isscam', aspect: 1.3, title: 'From the station’s external camera: the Nile at night', place: '418 km over Egypt', lat: 27.1, lon: 31.2, ago: 0,
      tele: () => 'ORBIT · ISS · 418 KM · 7.66 KM/S · 27.1N 31.2E' },
    { id: 'firewit', arch: 'witness', band: 'inside', sit: 'fires', post: 'fi1', prio: 78, by: 'ines', paint: 'firewit', aspect: 1.25, title: 'The ridge above the N2 is burning — 1.8 km from the front', place: 'N2, central Portugal', lat: 40.13, lon: -8.05, ago: 26,
      tele: () => 'WITNESS · SEALED · ±6 M · 1.8 KM FROM FRONT' },
    { id: 'lightning', arch: 'number', band: 'sky', sit: 'gulf', prio: 76, paint: 'strikes', aspect: 1.05, title: 'Lightning over the Gulf of Mexico', place: 'Gulf of Mexico', lat: 26.5, lon: -89, ago: 1,
      big: '4,812', unit: 'strikes', label: 'in the last hour over the Gulf', spark: [1200, 1500, 1900, 2600, 3100, 3800, 4300, 4812], tele: () => 'SKY · LIGHTNING NETWORK · 5 CELLS' },
    { id: 'stadium', arch: 'sensor', band: 'ground', sit: 'derby', prio: 75, live: true, paint: 'stadium', aspect: 1.1, title: 'Derby egress: 4.6 people/m² building at Gate C', place: 'Avellaneda, Buenos Aires', lat: -34.6705, lon: -58.3685, ago: 1,
      tele: () => 'GROUND · CROWD SENSING · GATE C · 4.6 P/M²' },
    { id: 'aurora', arch: 'witness', band: 'inside', sit: 'aurora', prio: 74, by: 'ola', paint: 'aurora', aspect: 1.2, title: 'Corona overhead in Tromsø, sealed 18 minutes ago', place: 'Tromsø, Norway', lat: 69.65, lon: 18.96, ago: 18,
      tele: () => 'WITNESS · SEALED · ±5 M · KP 6' },
    { id: 'skychart', arch: 'track', band: 'orbit', sit: 'iss', prio: 72, paint: 'skychart', po: { at: iss.start, max: Math.round(iss.max) }, aspect: 1.0, title: `The ISS crosses your sky at ${fmt.hm(iss.maxAt)} UTC`, place: `Over ${GE.ME.name}`, lat: GE.ME.lat, lon: GE.ME.lon, ago: 0,
      readout: `MAX ${Math.round(iss.max)}° · ${Math.round((iss.end - iss.start) / 60000)} MIN`, tele: () => 'ORBIT · ISS PASS · TLE · COMPUTED', cta: ['bell', 'Remind me'] },
    { id: 'plume', arch: 'track', band: 'orbit', sit: 'launch', prio: 71, paint: 'plume', aspect: 1.3, title: 'Twilight launch: the plume was seen along 600 km of coast', place: 'Cape Canaveral', lat: 28.5618, lon: -80.5772, ago: 34,
      readout: () => `T+${fmt.dur((Date.now() - GE.LAUNCH_T0) / 1000)}`, tele: () => 'ORBIT · TRACKING CAM · 2ND STAGE 212 KM' },
    { id: 'room-qk', arch: 'room', band: 'inside', sit: 'quake', prio: 70, wide: true, title: 'M 6.4 off Honshu', place: 'Fukushima · Miyagi · Ibaraki', lat: GE.BIGQ.lat, lon: GE.BIGQ.lon, ago: 3, ev: [['shake', {}], ['crossing', { seed: 33, cam: 'PHONE', rec: false }]] },
    { id: 'gnss', arch: 'number', band: 'sky', sit: 'gnss', prio: 68, paint: 'gnss', aspect: 1.05, title: 'GPS interference over the Baltic', place: 'Baltic Sea', lat: 56.8, lon: 21.5, ago: 10,
      big: '340', unit: 'aircraft', label: 'lost GPS integrity in the last hour', spark: [120, 160, 150, 210, 260, 240, 300, 340], tele: () => 'SKY · ADS-B NIC/NACp · 10 MIN' },
    { id: 'heli', arch: 'track', band: 'sky', sit: 'novosel', prio: 66, live: true, paint: 'heli', po: { laps: 14 }, aspect: 1.1, title: 'HAWK 21 is flying its 14th circuit at Fort Novosel', place: 'Cairns Army Airfield, Alabama', lat: 31.276, lon: -85.713, ago: 0, ride: true,
      readout: 'CIRCUIT 14 · 500 FT', tele: () => 'SKY · ADS-B/MLAT · 72 KT · 500 FT AGL', cta: ['helicopter', 'Ride along'] },
    { id: 'koshi', arch: 'room', band: 'inside', sit: 'koshi', recon: 'koshi', prio: 64, wide: true, paint: 'globe', aspect: 0.56, title: 'Bhote Koshi outburst flood — 4D reconstruction', place: 'Rasuwa, Nepal · 26 Aug 2026', lat: 28.215, lon: 85.36, ago: 120 },
    { id: 'sar', arch: 'sensor', band: 'orbit', sit: 'suez', prio: 62, paint: 'sar', aspect: 1.15, title: 'Radar satellite pass: 48 ships waiting off Suez', place: 'Gulf of Suez', lat: 29.86, lon: 32.55, ago: 47,
      tele: () => 'ORBIT · SAR C-BAND · 10 M · DESC PASS' },
    { id: 'volcano', arch: 'eye', band: 'ground', sit: 'sakurajima', prio: 60, live: true, paint: 'volcano', po: { cam: 'VOLCANO CAM 2', place: 'KAGOSHIMA BAY' }, aspect: 1.05, title: 'Sakurajima: ash column to 3.2 km, drifting away from the city', place: 'Kagoshima, Japan', lat: 31.58, lon: 130.66, ago: 2,
      tele: () => `GROUND · VOLCANO CAM 2 · ${llz(31.58, 130.66)}` },
    { id: 'blackout', arch: 'witness', band: 'inside', sit: 'cyclone', post: 'cy6', prio: 58, by: 'rafa', paint: 'blackout', aspect: 1.15, title: 'Aparri is dark — the hospital is running on generators', place: 'Aparri, Cagayan', lat: 18.357, lon: 121.637, ago: 22,
      tele: () => 'WITNESS · SEALED · ±8 M · LOCAL' },
  ];
  for (const x of it) { x.at = NOW - x.ago * MIN3; x.dist = FD.distFromMe(x.lat, x.lon); }
  return (FD._items = it);
};
FD.user = []; // your own posts land here (newest first)

/* diversity-aware ordering: never two of the same archetype or band side by side when avoidable */
FD.order = function (items) {
  const rest = items.slice().sort((a, b) => b.prio - a.prio); const out = [];
  while (rest.length) {
    const prev = out[out.length - 1], prev2 = out[out.length - 2];
    const fits = (x, strict) => !prev || ((x.arch !== prev.arch || !strict) && x.band !== prev.band && (!strict || !prev2 || x.arch !== prev2.arch));
    let i = rest.findIndex((x) => fits(x, true)); if (i < 0) i = rest.findIndex((x) => fits(x, false)); if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  return out;
};
FD.list = function (band = 'all') {
  const all = [...FD.user, ...FD.items()];
  const f = band === 'all' ? all : band === 'near' ? all.filter((x) => x.dist < 2500) : all.filter((x) => x.band === band);
  const user = f.filter((x) => x.mine); const ordered = FD.order(f.filter((x) => !x.mine));
  return [...user, ...ordered];
};
FD.counts = function () { const c = { all: 0, orbit: 0, sky: 0, ground: 0, inside: 0 }; for (const x of [...FD.user, ...FD.items()]) { c.all++; c[x.band]++; } return c; };
