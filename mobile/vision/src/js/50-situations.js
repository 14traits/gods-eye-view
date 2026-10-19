/* Situations — the feed's genres (DESIGN.md §9). Live metrics are computed from the synthetic world;
   names, handles, posts and reconstruction claims are illustrative. */
const SIT = (GE.SIT = {});
const fam = (f) => GE.FAM[f].color;
const RSit = rng(4242);
function walk(n, start, vol, drift = 0, seed = 1) { const r = rng(seed); let v = start; const out = []; for (let i = 0; i < n; i++) { v += r.gauss() * vol + drift; out.push(v); } return out; }

/* user locale ("Near you") from time zone only — no geolocation */
const TZMAP = { 'America/Los_Angeles': ['San Francisco', 37.77, -122.42], 'America/New_York': ['New York', 40.71, -74.0], 'America/Chicago': ['Chicago', 41.88, -87.63], 'America/Denver': ['Denver', 39.74, -104.99], 'Europe/London': ['London', 51.51, -0.13], 'Europe/Paris': ['Paris', 48.86, 2.35], 'Europe/Berlin': ['Berlin', 52.52, 13.4], 'Asia/Tokyo': ['Tokyo', 35.68, 139.69], 'Asia/Kolkata': ['Delhi', 28.61, 77.21], 'Asia/Kathmandu': ['Kathmandu', 27.72, 85.32], 'Australia/Sydney': ['Sydney', -33.87, 151.21], 'Asia/Singapore': ['Singapore', 1.35, 103.82] };
let tz = 'UTC'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch {}
const ME = TZMAP[tz] || ['London', 51.51, -0.13];
GE.ME = { name: ME[0], lat: ME[1], lon: ME[2], tz };

/* ISS pass prediction over "you" on the synthetic orbit */
function issPass(fromMs) {
  const obs = geo.vec(GE.ME.lat, GE.ME.lon); const up = v3.norm(obs);
  let best = null, inPass = false, cur = null;
  for (let s = 0; s < 36 * 3600; s += 20) {
    const ms = fromMs + s * 1000, t = (ms - NOW) / 1000; const g = astro.sun(ms).gmst;
    const p = GE.satAt(GE.ISS, t, g); const d = v3.norm(v3.sub(p, obs)); const el = Math.asin(v3.dot(d, up)) * R2D;
    if (el > 10) { if (!inPass) { inPass = true; cur = { start: ms, max: el, maxAt: ms }; } if (el > cur.max) { cur.max = el; cur.maxAt = ms; } }
    else if (inPass) { inPass = false; cur.end = ms; if (!best && cur.max > 18) { best = cur; break; } }
  }
  return best || { start: fromMs + 3.2 * 3600000, max: 41, maxAt: fromMs + 3.25 * 3600000, end: fromMs + 3.3 * 3600000 };
}
function busiestAirport() {
  const t = GE.world.t; const counts = new Map();
  for (const f of GE.FLIGHTS) { if (f.kind !== 0) continue; const p = GE.flightAt(f, t); if (!p) continue; for (const ap of [p.from, p.to]) { if (!ap.iata || ap.iata.length !== 3) continue; const d = geo.dist(p.lat, p.lon, ap.lat, ap.lon) * EARTH_KM; if (d < 160) counts.set(ap.iata, (counts.get(ap.iata) || 0) + 1); } }
  let best = 'ATL', bc = 0; for (const [k, v] of counts) if (v > bc) { bc = v; best = k; }
  return { iata: best, ap: GE.apByIata[best], n: bc, perH: Math.round(bc * 5.6) };
}
SIT.issPass = issPass; SIT.busiest = busiestAirport;
// daytime replay helper: if it is night at a place now, use the most recent local afternoon
function dayReplay(lat, lon, localHour = 15.5) {
  if (astro.elev(NOW, lat, lon) > 8) return null;
  const tzh = Math.round(lon / 15); const d = new Date(NOW); let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0) + (localHour - tzh) * 3600000;
  while (t > NOW) t -= 86400000; return { at: t, start: t - 3 * 3600000, end: t + 3 * 3600000, replay: true };
}
SIT.dayReplay = dayReplay;
const LAUNCH_T0 = NOW - (34 * 60 + 12) * 1000;
GE.LAUNCH_T0 = LAUNCH_T0;
const KOSHI_T = GE.scenes.FLOOD.startMs;
const AURORA_T = (() => { const d = new Date(NOW); d.setUTCHours(21, 30, 0, 0); if (d.getTime() < NOW) d.setUTCDate(d.getUTCDate() + 1); return d.getTime(); })();

/* ---------- situation definitions ---------- */
const S = [];
const add = (o) => { o.updatedAt = o.updatedAt || NOW - (o.ageS || 60) * 1000; S.push(o); return o; };
add({
  id: 'cyclone', short: 'Typhoon Halcyon', fam: 'haz', kind: 'cyclone', section: 'now', live: true, aspect: 1.25, ageS: 120, watchers: 48200,
  title: 'Typhoon Halcyon tracks toward Luzon Strait', place: 'Philippine Sea', lat: 16.2, lon: 128.8,
  camera: { lat: 15.2, lon: 127.6, range: 0.42, heading: -0.25, tilt: 0.42 }, thumbCam: { lat: 16.6, lon: 128.4, range: 0.3, heading: -0.2, tilt: 0.36 },
  layers: ['cyclones', 'lightning', 'clouds', 'models', 'ais', 'flights'], source: 'Advisory feed (illustrative)',
  metric: () => { const c = GE.CYCLONE.at(GE.world.offsetH); return [`${Math.round(c.wind)}<small>km/h</small>`, `${Math.round(c.p)} hPa · moving WNW 19 km/h`]; },
  metrics: () => { const c = GE.CYCLONE.at(GE.world.offsetH); return [{ v: Math.round(c.wind), u: 'km/h', l: 'Max sustained', s: 'Advisory · 2 min' }, { v: Math.round(c.p), u: 'hPa', l: 'Central pressure', s: 'Advisory · 2 min' }, { v: 610, u: 'km', l: 'To Luzon Strait', s: 'Computed · now' }]; },
  accessory: () => { const c = GE.CYCLONE.at(GE.world.offsetH); return `${Math.round(c.wind)} km/h · ${Math.round(c.p)} hPa · updated 2 min ago`; },
  brief: {
    lede: 'A compact, intense typhoon is moving west-northwest at 19 km/h. The forecast cone widens to ±370 km by day 5; most guidance recurves it north of Luzon before a weakening landfall near Taiwan. Ships are routing south of the track; two vessels are holding off Batanes.',
    series: [
      { label: 'Max wind', unit: 'km/h', data: GE.CYCLONE.track.map((x) => x[3]), split: 6, band: 18, src: 'Advisory feed · 6-hourly · 2 min', fmt: (v) => Math.round(v) },
      { label: 'Pressure', unit: 'hPa', data: GE.CYCLONE.track.map((x) => x[4]), split: 6, band: 6, src: 'Advisory feed · 6-hourly · 2 min', fmt: (v) => Math.round(v), invert: true },
      { label: 'Ships within 500 km', unit: '', data: walk(24, 40, 2, -0.6, 3).map((v) => Math.max(0, Math.round(v))), src: 'AIS · 5 min bins · 40 s', fmt: (v) => v },
    ],
    multiples: { kind: 'globe', label: 'Track, 24 h apart', items: [-48, -24, 0, 24].map((h) => ({ h, cap: h === 0 ? '<b>Now</b>' : (h < 0 ? '−' : '+') + Math.abs(h) + ' h' })) },
    sources: [['Tropical cyclone advisory (illustrative)', '2 min', 'live'], ['Geostationary IR mosaic', '10 min', 'live'], ['AIS vessel positions', '40 s', 'live'], ['Ensemble forecast tracks (14 members)', '3 h', 'stale']],
  },
});
add({
  id: 'quake', short: 'M 6.4 · Honshu', fam: 'haz', kind: 'quake', section: 'now', live: true, aspect: 1.0, ageS: 5.4 * 3600, watchers: 21900,
  title: 'M 6.4 off the coast of Honshu — largest in 24 h', place: 'Off eastern Honshu, Japan', lat: GE.BIGQ.lat, lon: GE.BIGQ.lon,
  camera: { lat: 35.2, lon: 141.0, range: 0.13, heading: 0.35, tilt: 0.75 }, layers: ['quakes', 'flights', 'ais', 'cctv'], source: 'Seismic network (illustrative)',
  metric: () => [`M 6.4`, `32 km deep · 9 aftershocks`], metrics: () => [{ v: '6.4', u: 'Mw', l: 'Magnitude', s: 'Seismic net · 5 h' }, { v: 32, u: 'km', l: 'Depth', s: 'Seismic net · 5 h' }, { v: 9, u: '', l: 'Aftershocks ≥ M3.4', s: 'Seismic net · 12 min' }],
  brief: {
    lede: 'A shallow thrust event under the Pacific margin, felt widely along the coast. No tsunami was generated beyond 20 cm. Rail services paused for inspection and resumed within 90 minutes; flights into HND were briefly held.',
    series: [{ label: 'Aftershocks per hour', unit: '', data: [0, 0, 0, 0, 0, 7, 5, 3, 3, 2, 2, 1, 1, 2, 1, 0, 1, 1], src: 'Seismic catalog · hourly · 12 min', fmt: (v) => v }, { label: 'Coastal tide gauge', unit: 'cm', data: walk(36, 0, 1.2, 0, 7).map((v, i) => (i > 18 && i < 26 ? v + 14 * Math.sin((i - 18) / 8 * Math.PI) : v)), band: 3, src: 'Tide gauge (illustrative) · 1 min · 3 min', fmt: (v) => v.toFixed(0) }],
    multiples: { kind: 'bars', label: 'Felt reports by prefecture', items: [['Fukushima', 0.9], ['Ibaraki', 0.75], ['Miyagi', 0.6], ['Chiba', 0.45]] },
    sources: [['Seismic network catalog (illustrative)', '12 min', 'live'], ['Tide gauges', '3 min', 'live'], ['Rail status boards', '9 min', 'live']],
  },
});
add({
  id: 'fires', short: 'Fires · Iberia', fam: 'haz', kind: 'fires', section: 'now', live: true, aspect: 1.33, ageS: 38 * 60, watchers: 9800,
  title: 'Wildfire clusters across Iberia and Greece', place: 'Southern Europe', lat: 40.0, lon: -6.5,
  camera: { lat: 39.2, lon: -6.0, range: 0.18, heading: 0.1, tilt: 0.55 }, layers: ['fires', 'perims', 'aq', 'wind', 'flights'], source: 'VIIRS 375 m hotspots',
  metric: () => [`${fmt.n(GE.FIRES.filter((f) => f.t <= GE.world.t && (f.cluster === 'Central Portugal' || f.cluster === 'Galicia' || f.cluster === 'Attica' || f.cluster === 'Epirus' || f.cluster === 'Antalya')).length)}<small>hotspots</small>`, 'Portugal · Galicia · Attica · Antalya'],
  metrics: () => [{ v: GE.FIRES.filter((f) => f.t <= GE.world.t && f.lat > 34 && f.lon > -10 && f.lon < 32).length, u: '', l: 'Active hotspots', s: 'VIIRS · 38 min' }, { v: '3.4k', u: 'ha', l: 'Mapped perimeter', s: 'Perimeters · 3 h' }, { v: 31, u: 'km/h', l: 'Wind, Galicia', s: 'Model · 1 h' }],
  brief: { lede: 'Dry easterly winds are pushing fire fronts toward the Atlantic in central Portugal and Galicia. Smoke is degrading air quality in Porto; the Attica cluster is contained on its north flank.',
    series: [{ label: 'Hotspots, 6 h bins', unit: '', data: [12, 18, 44, 61, 58, 80, 102, 96, 120, 140, 133, 151], src: 'VIIRS / MODIS · 6 h · 38 min', fmt: (v) => v }, { label: 'PM2.5 Porto', unit: 'µg/m³', data: walk(30, 14, 3, 1.4, 11), band: 8, src: 'Air-quality sensors · 1 h · 22 min', fmt: (v) => Math.round(v) }],
    multiples: { kind: 'globe', label: 'Spread, 24 h apart', items: [-48, -24, 0, 24].map((h) => ({ h, cap: h === 0 ? '<b>Now</b>' : (h < 0 ? '−' : '+') + Math.abs(h) + ' h', cam: { lat: 40.6, lon: -7.8, range: 0.05, heading: 0, tilt: 0.3 } })) },
    sources: [['VIIRS 375 m active fires', '38 min', 'live'], ['Fire perimeters (illustrative)', '3 h', 'stale'], ['Wind model', '1 h', 'live']] },
});
add({
  id: 'milair', short: 'Military air · Baltic', fam: 'sky', kind: 'mil', section: 'now', live: true, aspect: 1.0, ageS: 30, watchers: 17300,
  title: 'Military air activity over the Baltic', place: 'Baltic Sea', lat: 56.5, lon: 19.5,
  camera: { lat: 56.0, lon: 19.0, range: 0.16, heading: 0.0, tilt: 0.5 }, layers: ['military', 'flights', 'gnss', 'holding'], source: 'ADS-B / MLAT',
  metric: () => [`38<small>aircraft</small>`, '3 tankers holding · GNSS jamming'], metrics: () => [{ v: 38, u: '', l: 'Military aircraft', s: 'ADS-B/MLAT · 30 s' }, { v: 3, u: '', l: 'Tankers in orbit', s: 'ADS-B · 30 s' }, { v: '41', u: '%', l: 'Flights w/ GNSS loss', s: 'NIC/NACp · 10 min' }],
  brief: { lede: 'Two tanker orbits are active over southern Sweden with fighter pairs cycling. GNSS integrity reports from airliners show a jamming footprint centred off Kaliningrad, affecting 41% of overflights in the last hour.',
    series: [{ label: 'Military aircraft aloft', unit: '', data: walk(36, 26, 2, 0.35, 21).map(Math.round), src: 'ADS-B / MLAT · 10 min · 30 s', fmt: (v) => v }, { label: 'GNSS-degraded flights', unit: '%', data: walk(36, 30, 2.4, 0.3, 23), band: 6, src: 'Aircraft integrity reports · 10 min', fmt: (v) => Math.round(v) }],
    multiples: { kind: 'bars', label: 'By type', items: [['Fighters', 0.8], ['Tankers', 0.22], ['ISR', 0.3], ['Transport', 0.5]] },
    sources: [['ADS-B / MLAT network', '30 s', 'live'], ['GNSS integrity (NIC/NACp)', '10 min', 'live']] },
});
add({
  id: 'iss', fam: 'orbit', kind: 'iss', section: 'near', live: true, aspect: 1.33, ageS: 4, watchers: 6400,
  title: `ISS pass over ${GE.ME.name}`, place: `${GE.ME.name} (from your time zone)`, lat: GE.ME.lat, lon: GE.ME.lon,
  camera: { lat: GE.ME.lat, lon: GE.ME.lon, range: 0.55, heading: 0, tilt: 0.55 }, layers: ['crewed', 'tracks', 'sats', 'trains'], source: 'TLE propagation',
  dyn: true,
  metric: () => { const p = SIT._iss || (SIT._iss = issPass(Date.now())); const s = (p.start - Date.now()) / 1000; return [s > 0 ? `in ${Math.floor(s / 3600)}<small>h</small> ${Math.floor((s % 3600) / 60)}<small>m</small>` : 'now', `max ${Math.round(p.max)}° · ${fmt.hm(p.maxAt)} UTC`]; },
  metrics: () => { const p = SIT._iss || (SIT._iss = issPass(Date.now())); return [{ v: fmt.hm(p.start), u: 'UTC', l: 'Rises', s: 'TLE · 4 s' }, { v: Math.round(p.max), u: '°', l: 'Max elevation', s: 'Computed' }, { v: Math.round((p.end - p.start) / 60000), u: 'min', l: 'Visible for', s: 'Computed' }]; },
  brief: { lede: 'The station will rise in the west-southwest and climb high across your sky. If the sky is clear and the pass is after dusk it will be the brightest point-like object, brighter than any star.', series: [{ label: 'Elevation during pass', unit: '°', data: Array.from({ length: 30 }, (_, i) => Math.max(0, Math.sin((i / 29) * Math.PI)) * 54), src: 'Propagated from TLE · computed', fmt: (v) => Math.round(v) }], sources: [['Two-line elements (illustrative epoch)', '4 h', 'live'], ['Sun/terminator', 'computed', 'live']] },
});
add({
  id: 'airport', short: 'Busiest: ATL', fam: 'sky', kind: 'airport', section: 'always', live: true, aspect: 1.25, ageS: 20, watchers: 5200,
  title: 'Busiest airport right now', place: 'Hartsfield–Jackson Atlanta', lat: 33.6407, lon: -84.4277,
  camera: { lat: 33.636, lon: -84.4277, range: 0.0042, heading: 0.35, tilt: 1.05 }, layers: ['flights', 'airports', 'holding', 'traffic'], source: 'ADS-B',
  metric: () => { const b = SIT._busy || (SIT._busy = busiestAirport()); return [`${b.iata} <small>${b.perH} mvts/h</small>`, `${b.ap.city} · ${b.n} aircraft within 160 km`]; },
  metrics: () => { const b = SIT._busy || (SIT._busy = busiestAirport()); return [{ v: b.perH, u: '/h', l: 'Movements', s: 'ADS-B · 20 s' }, { v: b.n, u: '', l: 'Aircraft < 160 km', s: 'ADS-B · 20 s' }, { v: 4, u: 'min', l: 'Avg. taxi-out delay', s: 'Derived · 15 min' }]; },
  brief: { lede: 'Arrivals are landing on the two southern runways in a steady stream; departures are pushing west. The evening bank peaks in 40 minutes.', series: [{ label: 'Movements per hour', unit: '', data: [62, 70, 88, 94, 101, 97, 90, 85, 92, 104, 112, 108], src: 'ADS-B · hourly · 20 s', fmt: (v) => v }], multiples: { kind: 'bars', label: 'Top 4 right now', items: [['ATL', 0.95], ['DFW', 0.84], ['DXB', 0.8], ['LHR', 0.74]] }, sources: [['ADS-B network', '20 s', 'live'], ['Airport board (scraped, illustrative)', '2 min', 'live']] },
});
add({
  id: 'novosel', short: 'Fort Novosel circuits', fam: 'sky', kind: 'heli', section: 'always', live: true, aspect: 1.5, ageS: 15, watchers: 3100, ride: true,
  title: 'Fort Novosel helicopter school — jump into the chopper', place: 'Cairns Army Airfield, Alabama', lat: 31.276, lon: -85.713,
  camera: { lat: 31.2745, lon: -85.7105, range: 0.00062, heading: -0.65, tilt: 0.9 }, layers: ['helis', 'flights', 'ga', 'traffic'], source: 'ADS-B / MLAT', time: dayReplay(31.276, -85.713, 15.2), labels3d: [[31.276, -85.713, 'Cairns AAF', 0.05], [31.36, -85.63, 'Stagefield A', 0.05]],
  metric: () => [`${GE.HELI_CIRCUITS.filter((h) => h.field).length}<small>in circuits</small>`, 'Cairns + 3 stagefields · 500 ft AGL'],
  metrics: () => [{ v: GE.HELI_CIRCUITS.filter((h) => h.field).length, u: '', l: 'Helicopters in circuits', s: 'ADS-B · 15 s' }, { v: 500, u: 'ft', l: 'Pattern altitude', s: 'Observed' }, { v: 5.5, u: 'min', l: 'Circuit time', s: 'Derived' }],
  brief: { lede: 'Student pilots are flying rectangular traffic patterns at Cairns and three stagefields: upwind, crosswind, downwind, base, final — over and over. Tap Ride to sit in the left seat of one of them.', series: [{ label: 'Helicopters aloft', unit: '', data: [2, 4, 9, 14, 17, 19, 19, 18, 19, 17, 19, 19], src: 'ADS-B / MLAT · hourly · 15 s', fmt: (v) => v }, { label: 'Groundspeed, HAWK 21', unit: 'kt', data: Array.from({ length: 40 }, (_, i) => 70 + 12 * Math.sin(i / 3.2) + (i % 10 > 7 ? -30 : 0)), src: 'ADS-B · 1 s · 15 s', fmt: (v) => Math.round(v) }], sources: [['ADS-B / MLAT', '15 s', 'live']] },
});
add({
  id: 'launch', short: 'Launch · SLC-40', fam: 'orbit', kind: 'launch', section: 'now', live: true, aspect: 1.5, ageS: 300, watchers: 33800,
  title: 'Twilight launch from SLC-40 — plume seen along 600 km of coast', place: 'Cape Canaveral, Florida', lat: 28.5618, lon: -80.5772,
  camera: { lat: 28.5585, lon: -80.5825, range: 0.00045, heading: 0.85, tilt: 1.28 }, labels3d: [[28.5618, -80.5772, 'SLC-40 · vehicle on pad', 0.11]], thumbCam: { lat: 28.25, lon: -80.95, range: 0.028, heading: 0.75, tilt: 1.0 }, layers: ['launches', 'flights', 'ais', 'tracks'], source: 'Range schedule (illustrative)',
  metric: () => [`<span class="num">T+${fmt.dur((Date.now() - LAUNCH_T0) / 1000)}</span>`, 'Rideshare to SSO · 2nd stage coasting'],
  metrics: () => [{ v: fmt.dur((Date.now() - LAUNCH_T0) / 1000), u: '', l: 'Since liftoff', s: 'Range · live' }, { v: 212, u: 'km', l: '2nd stage altitude', s: 'Tracking · 10 s' }, { v: 418, u: '', l: 'Sky captures', s: 'Signed · 4 min' }],
  brief: { lede: 'The vehicle lifted off just after sunset. Its exhaust climbed into sunlight above the dark ground and spread into a glowing "jellyfish" seen from Georgia to the Keys. The second stage is coasting to its burn; the pad is being safed.', series: [{ label: 'Sky captures per minute', unit: '', data: [0, 2, 14, 61, 120, 96, 70, 44, 30, 22, 15, 11], src: 'Signed bundles · 1 min', fmt: (v) => v }], sources: [['Range schedule (illustrative)', '5 min', 'live'], ['Tracking camera (illustrative)', '10 s', 'live'], ['Signed sky captures', '4 min', 'live']] },
});
add({
  id: 'koshi', short: 'Bhote Koshi · 4D', fam: 'haz', kind: 'recon', section: 'recon', live: false, aspect: 1.33, ageS: 53 * 86400, watchers: 12800, thread: 'koshi', d4: true,
  title: 'Bhote Koshi outburst flood — 4D reconstruction', place: 'Rasuwa, Nepal · 26 Aug 2026', lat: 28.215, lon: 85.36,
  camera: { lat: 28.212, lon: 85.352, range: 0.0036, heading: 0.35, tilt: 1.08 }, time: { at: KOSHI_T + 2.2 * 3600000, start: KOSHI_T - 3 * 3600000, end: KOSHI_T + 9 * 3600000 },
  layers: ['signed', 'holo', 'floods', 'helis'], source: 'Thread · 23 observations',
  metric: () => ['23<small>obs</small> · 9<small>hyp</small>', '14 people · 3 AI proposals'], metrics: () => [{ v: 23, u: '', l: 'Observations', s: 'Ledger · 2 h' }, { v: 9, u: '', l: 'Hypotheses', s: 'Ledger · 2 h' }, { v: 14, u: '', l: 'Contributors', s: 'Thread' }],
  brief: { lede: 'An outburst flood was observed on the Bhote Koshi on 26 August 2026. This thread reconstructs the crest’s passage from Rasuwagadhi down to Syaphrubesi using signed witness captures, river-gauge readings and satellite imagery. Witness posts are illustrative.', series: [{ label: 'River stage, Syaphrubesi (illustrative)', unit: 'm', data: Array.from({ length: 40 }, (_, i) => 3.1 + 4.7 * Math.exp(-Math.pow((i - 16) / 5, 2)) + (i > 16 ? 0.6 : 0)), band: 0.4, src: 'Gauge (illustrative) · 15 min', fmt: (v) => v.toFixed(1) }], sources: [['Signed witness captures (illustrative)', '53 d', 'stale'], ['Optical satellite tiles, before/after', '50 d', 'stale']] },
});
add({
  id: 'concert', short: 'Stadium encore · 4D', fam: 'eyes', kind: 'recon', section: 'recon', live: false, aspect: 1.25, ageS: 20 * 3600, watchers: 88200, thread: 'concert', d4: true,
  title: 'Stadium encore in 4D — from 2,311 crowd captures', place: 'Wembley, London · ' + GE.dayWord(GE.T_CONCERT, 'night'), lat: 51.556, lon: -0.2796,
  camera: { lat: 51.5553, lon: -0.2806, range: 0.00026, heading: 0.55, tilt: 1.0 }, time: { at: GE.T_CONCERT, start: GE.T_CONCERT - 3600000, end: GE.T_CONCERT + 1800000 },
  layers: ['signed', 'holo', 'venues', 'cctv'], source: 'Thread · 2,311 signed captures', nightThumb: true,
  metric: () => ['2,311<small>captures</small>', '4D · 41 min · 86 seat blocks'], metrics: () => [{ v: '2,311', u: '', l: 'Signed captures', s: 'Ledger · 20 h' }, { v: 86, u: '', l: 'Seat blocks covered', s: 'Derived' }, { v: '±9', u: 'ms', l: 'Time alignment', s: 'Audio sync' }],
  brief: { lede: 'A crowd-sourced reconstruction of last night’s encore: 2,311 signed phone captures aligned by audio fingerprint and IMU traces into a single 4D scene you can scrub. Performer and attendee identities are not part of the record.', series: [{ label: 'Captures per minute', unit: '', data: [3, 5, 9, 21, 64, 140, 188, 162, 120, 96, 72, 40], src: 'Signed bundles · 1 min', fmt: (v) => v }], sources: [['Signed crowd captures (illustrative)', '20 h', 'stale']] },
});
add({
  id: 'climb', short: 'Tower climb · 4D', fam: 'eyes', kind: 'recon', section: 'recon', live: false, aspect: 1.5, ageS: 9 * 3600, watchers: 41500, thread: 'climb', d4: true,
  title: 'Free-climber on a Midtown tower — reconstructed', place: 'Midtown Manhattan · ' + GE.dayWord(GE.T_CLIMB, 'morning'), lat: 40.7553, lon: -73.9838,
  camera: { lat: 40.7532, lon: -73.9865, range: 0.00055, heading: 0.62, tilt: 1.12 }, time: { at: GE.T_CLIMB + 1.2 * 3600000, start: GE.T_CLIMB - 1800000, end: GE.T_CLIMB + 3 * 3600000 },
  layers: ['helis', 'signed', 'holo', 'cctv'], source: 'Thread · 3 news helicopters (ADS-B)',
  metric: () => ['41<small>clips</small> · 3<small>helis</small>', 'Fictional tower · ascent 2 h 14 m'], metrics: () => [{ v: 41, u: '', l: 'Witness clips', s: 'Ledger · 9 h' }, { v: 3, u: '', l: 'News helicopters', s: 'ADS-B · 9 h' }, { v: 412, u: 'm', l: 'Tower height', s: 'Model (fictional tower)' }],
  brief: { lede: 'Three news helicopters orbited the tower for two hours; their ADS-B tracks give precise camera positions for every broadcast frame. Combined with 41 signed street-level clips, the climber’s height over time is reconstructed to ±3 m. The tower and people are fictional.', series: [{ label: 'Climber height (reconstructed)', unit: 'm', data: Array.from({ length: 30 }, (_, i) => Math.min(380, i * 14 + Math.sin(i) * 6)), band: 3, src: 'Hypothesis H2 · ±3 m', fmt: (v) => Math.round(v) }], sources: [['ADS-B: 3 helicopters', '9 h', 'stale'], ['Signed street clips (illustrative)', '9 h', 'stale']] },
});
add({
  id: 'suez', short: 'Suez queue', fam: 'sea', kind: 'queue', section: 'always', live: true, aspect: 1.0, ageS: 40, watchers: 7700,
  title: 'Ships queuing at Suez', place: 'Gulf of Suez & Port Said anchorages', lat: 30.3, lon: 32.4,
  camera: { lat: 29.75, lon: 32.45, range: 0.045, heading: 0.2, tilt: 0.85 }, layers: ['ais', 'tankers', 'ports'], source: 'AIS',
  metric: () => [`${GE.SHIPS.filter((s) => s.queue === 'suez').length}<small>waiting</small>`, 'avg wait 31 h · southbound convoy 06:00'],
  metrics: () => [{ v: GE.SHIPS.filter((s) => s.queue === 'suez').length, u: '', l: 'Ships at anchor', s: 'AIS · 40 s' }, { v: 31, u: 'h', l: 'Average wait', s: 'Derived · 1 h' }, { v: 52, u: '', l: 'Transits / 24 h', s: 'AIS · 1 h' }],
  brief: { lede: 'The anchorage off Suez is fuller than its 30-day median; northbound tankers are waiting longest.', series: [{ label: 'Ships at anchor', unit: '', data: walk(30, 52, 2.2, 0.75, 31).map(Math.round), band: 5, src: 'AIS · 6 h · 40 s', fmt: (v) => v }], multiples: { kind: 'bars', label: 'By type', items: [['Tanker', 0.82], ['Bulk', 0.6], ['Container', 0.45], ['LNG', 0.22]] }, sources: [['AIS terrestrial + satellite', '40 s', 'live']] },
});
add({
  id: 'aurora', short: 'Aurora · Kp 6', fam: 'wx', kind: 'aurora', section: 'near', live: true, aspect: 1.33, ageS: 600, watchers: 15100,
  title: 'Aurora nowcast — Kp 6 expected tonight', place: 'Northern Scandinavia & Iceland', lat: 69.6, lon: 18.9,
  camera: { lat: 62.5, lon: 12.0, range: 0.62, heading: 0.15, tilt: 0.95 }, time: { at: AURORA_T }, layers: ['clouds', 'signed', 'holo', 'flights'], source: 'Space-weather forecast', auroraK: 1.15,
  metric: () => ['Kp 6<small>tonight</small>', 'Tromsø 92% · cloud 18%'], metrics: () => [{ v: 6, u: 'Kp', l: 'Forecast peak', s: 'Space weather · 10 min' }, { v: 92, u: '%', l: 'Chance, Tromsø', s: 'Model · 10 min' }, { v: 18, u: '%', l: 'Cloud cover', s: 'Satellite · 15 min' }],
  brief: { lede: 'A coronal mass ejection is arriving earlier than forecast. The auroral oval will push south after dark; sky captures from Tromsø already show a bright arc.', series: [{ label: 'Kp forecast', unit: '', data: [2, 2, 3, 3, 4, 5, 6, 6, 5, 4, 4, 3], band: 1, src: 'Space-weather forecast · 3 h · 10 min', fmt: (v) => v }], sources: [['Space-weather forecast', '10 min', 'live'], ['Sky captures (illustrative)', '18 min', 'live']] },
});
add({
  id: 'drones', short: 'Drone corridor', fam: 'ground', kind: 'drone', section: 'always', live: false, aspect: 1.25, ageS: 3600, watchers: 2300,
  title: 'Delivery-drone corridor — today’s replay', place: 'Suburban Texas (illustrative operator)', lat: 30.588, lon: -96.29,
  camera: { lat: 30.578, lon: -96.300, range: 0.0013, heading: 0.5, tilt: 1.1 }, layers: ['drones', 'traffic'], source: 'Remote ID broadcasts', time: dayReplay(30.588, -96.29, 14.5),
  metric: () => ['212<small>drops</small>', '16 drones · 4.1 min median'], metrics: () => [{ v: 212, u: '', l: 'Deliveries today', s: 'Remote ID · 1 h' }, { v: 16, u: '', l: 'Drones active', s: 'Remote ID · 1 min' }, { v: 4.1, u: 'min', l: 'Median trip', s: 'Derived' }],
  brief: { lede: 'Remote ID broadcasts let anyone replay a corridor: out and back at 60 m, a hover-and-lower at each drop.', series: [{ label: 'Drops per hour', unit: '', data: [0, 0, 4, 12, 19, 22, 25, 21, 24, 27, 23, 18], src: 'Remote ID · hourly', fmt: (v) => v }], sources: [['Remote ID receivers (illustrative)', '1 min', 'live']] },
});
add({
  id: 'marathon', short: 'Lakeshore 42K', fam: 'ground', kind: 'race', section: 'always', live: true, aspect: 1.0, ageS: 10, watchers: 4600,
  title: 'Lakeshore 42K — runner trackers', place: 'Chicago lakefront (fictional race)', lat: 41.89, lon: -87.625,
  camera: { lat: 41.875, lon: -87.630, range: 0.0026, heading: 0.15, tilt: 1.05 }, layers: ['venues', 'transit', 'traffic'], source: 'Race trackers (illustrative)', time: dayReplay(41.88, -87.63, 9.5),
  metric: () => ['260<small>trackers</small>', 'leader at 31.4 km · 2:21 pace'], metrics: () => [{ v: 260, u: '', l: 'Live trackers', s: 'Race app · 10 s' }, { v: 31.4, u: 'km', l: 'Leader', s: '10 s' }, { v: '3:21', u: '/km', l: 'Median pace', s: 'Derived' }],
  brief: { lede: 'Bibs broadcast positions every 10 seconds; the field has stretched to 9 km.', series: [{ label: 'Leader pace', unit: 's/km', data: walk(30, 200, 1.5, 0, 41), band: 2, src: 'Tracker · 1 km', fmt: (v) => Math.round(v) }], sources: [['Race trackers (fictional race)', '10 s', 'live']] },
});
add({
  id: 'gnss', short: 'GNSS jamming', fam: 'infra', kind: 'gnss', section: 'now', live: true, aspect: 1.25, ageS: 600, watchers: 6100,
  title: 'GNSS jamming hot spots', place: 'Baltic · Black Sea · Eastern Med', lat: 50, lon: 27,
  camera: { lat: 49.0, lon: 26.0, range: 0.42, heading: 0.0, tilt: 0.35 }, layers: ['gnss', 'flights', 'military'], source: 'Aircraft integrity reports',
  metric: () => ['8<small>hot spots</small>', 'Baltic 41% · E. Med 28%'], metrics: () => [{ v: 8, u: '', l: 'Hot spots', s: '10 min' }, { v: 41, u: '%', l: 'Baltic flights affected', s: '10 min' }, { v: 28, u: '%', l: 'E. Med', s: '10 min' }],
  brief: { lede: 'Aircraft broadcast their own position-integrity; mapping drops in that integrity reveals where navigation signals are being jammed.', series: [{ label: 'Affected flights', unit: '%', data: walk(24, 30, 2, 0.4, 51), band: 5, src: 'NIC/NACp · 1 h', fmt: (v) => Math.round(v) }], sources: [['ADS-B integrity fields', '10 min', 'live']] },
});
add({
  id: 'starlink', fam: 'orbit', kind: 'train', section: 'near', live: true, aspect: 1.0, ageS: 90, watchers: 8800,
  title: 'Fresh satellite train — visible at dusk', place: 'Low Earth orbit, 312 km', lat: 30, lon: -60,
  camera: null, layers: ['trains', 'sats', 'tracks'], source: 'TLE propagation', dyn: true,
  metric: () => ['24<small>satellites</small>', 'orbit raising · 312 km'], metrics: () => [{ v: 24, u: '', l: 'Satellites in train', s: 'TLE · 90 s' }, { v: 312, u: 'km', l: 'Altitude', s: 'TLE' }, { v: 7.73, u: 'km/s', l: 'Speed', s: 'Computed' }],
  brief: { lede: 'A freshly launched batch flies in a tight line before raising orbit — at dusk it looks like a string of pearls.', series: [{ label: 'Altitude (orbit raising)', unit: 'km', data: Array.from({ length: 20 }, (_, i) => 290 + i * 1.2), src: 'TLE · daily', fmt: (v) => Math.round(v) }], sources: [['Two-line elements', '90 s', 'live']] },
});
add({
  id: 'squawk', fam: 'sky', kind: 'squawk', section: 'now', live: true, aspect: 1.25, ageS: 300, watchers: 12000,
  title: 'Squawk 7700 — diversion in progress', place: 'Over the North Atlantic', lat: 50, lon: -30, dyn: true,
  camera: null, layers: ['squawk', 'flights'], source: 'ADS-B',
  metric: () => ['7700<small>emergency</small>', 'diverting · descending'], metrics: () => [{ v: 7700, u: '', l: 'Squawk', s: 'ADS-B · 5 s' }, { v: 'FL240', u: '', l: 'Descending through', s: '5 s' }, { v: 34, u: 'min', l: 'To diversion', s: 'Computed' }],
  brief: { lede: 'An airliner set its transponder to 7700 and turned toward the nearest suitable airport. Replay the last 20 minutes.', series: [{ label: 'Altitude', unit: 'ft', data: Array.from({ length: 30 }, (_, i) => (i < 8 ? 37000 : 37000 - (i - 8) * 600)), src: 'ADS-B · 1 min', fmt: (v) => fmt.n(v) }], sources: [['ADS-B', '5 s', 'live']] },
});
add({
  id: 'strait', short: 'Singapore Strait', fam: 'sea', kind: 'strait', section: 'always', live: true, aspect: 1.5, ageS: 40, watchers: 3900,
  title: 'Singapore Strait — the world’s busiest lane', place: 'Singapore', lat: 1.25, lon: 103.9,
  camera: { lat: 1.18, lon: 103.85, range: 0.022, heading: 0.1, tilt: 0.9 }, layers: ['ais', 'tankers', 'ports', 'flights'], source: 'AIS',
  metric: () => ['1,912<small>transits/day</small>', '90 at anchor · 2 dark'], metrics: () => [{ v: '1,912', u: '', l: 'Transits / 24 h', s: 'AIS · 40 s' }, { v: 90, u: '', l: 'At anchor', s: 'AIS · 40 s' }, { v: 2, u: '', l: 'AIS gaps', s: '1 h' }],
  brief: { lede: 'Two traffic separation lanes, one of the densest anchorages anywhere.', series: [{ label: 'Transits per hour', unit: '', data: walk(24, 80, 4, 0, 61).map(Math.round), src: 'AIS · hourly', fmt: (v) => v }], sources: [['AIS', '40 s', 'live']] },
});

/* round two: situations behind the new feed cards (lite: camera, layers, brief) */
const lite = (o) => add({ live: true, aspect: 1.25, section: 'now', watchers: 3000, metric: () => [o.m0 || '', o.m1 || ''], metrics: () => o.ms.map(([v, u, l, sx]) => ({ v, u, l, s: sx })), brief: { lede: o.lede, series: o.series || [], sources: o.sources || [] }, ...o });
lite({ id: 'dfw', short: 'Squall line · DFW', fam: 'wx', kind: 'storm', title: 'Bowing squall line crossing Dallas–Fort Worth', place: 'Dallas–Fort Worth, Texas', lat: 32.82, lon: -97.0, camera: { lat: 32.62, lon: -97.12, range: 0.05, heading: 0.3, tilt: 0.9 }, layers: ['radar', 'lightning', 'flights', 'traffic'], source: 'Radar mosaic', watchers: 26100, ageS: 90,
  ms: [[62, 'dBZ', 'Peak reflectivity', 'Radar · 2 min'], [72, 'km/h', 'Line motion', 'Derived'], [1, '', 'Tornado warning', 'Warning feed · 4 min']], lede: 'A bowing line is racing east at 72 km/h. The apex is producing 100 km/h gusts and a brief tornado warning covers Arlington. Departures at DFW are on a ground stop.', series: [{ label: 'Peak dBZ', unit: '', data: [38, 41, 47, 52, 55, 58, 61, 62], src: 'Radar mosaic · 5 min', fmt: (v) => v }], sources: [['Radar mosaic (illustrative)', '2 min', 'live'], ['Lightning network', '30 s', 'live']] });
lite({ id: 'gulf', short: 'Lightning · Gulf', fam: 'wx', kind: 'lightning', title: '4,812 lightning strikes in the last hour over the Gulf', place: 'Gulf of Mexico', lat: 26.5, lon: -89, camera: { lat: 24.5, lon: -89.5, range: 0.3, heading: 0, tilt: 0.5 }, layers: ['lightning', 'clouds', 'flights', 'ais'], source: 'Lightning network', watchers: 4100, ageS: 60,
  ms: [['4,812', '', 'Strikes / h', 'Network · 1 min'], [5, '', 'Active cells', 'Derived'], [31, '', 'Flights deviating', 'ADS-B · 2 min']], lede: 'Five clusters of deep convection are firing over warm Gulf water. Airliners are deviating around the two strongest cells.', sources: [['Lightning network (illustrative)', '1 min', 'live']] });
lite({ id: 'shibuya', short: 'Shibuya crossing', fam: 'eyes', kind: 'eye', title: 'Shibuya crossing in the rain — public camera', place: 'Shibuya, Tokyo', lat: 35.6595, lon: 139.7005, camera: { lat: 35.6575, lon: 139.6985, range: 0.0009, heading: 0.6, tilt: 1.1 }, layers: ['cctv', 'transit', 'traffic', 'venues'], source: 'Public camera', watchers: 9400, ageS: 3,
  ms: [['~2,400', '', 'People per cycle', 'Camera count · 1 min'], [12, 'mm/h', 'Rain', 'Gauge · 10 min'], [46, 's', 'Signal cycle', 'Observed']], lede: 'A public street camera over the scramble. Counts are estimated on-device; no faces are kept.', sources: [['Public street camera (illustrative)', 'live', 'live']] });
lite({ id: 'derby', short: 'Derby egress', fam: 'ground', kind: 'crowd', title: 'Derby egress: crowd density building at Gate C', place: 'Avellaneda, Buenos Aires', lat: -34.6705, lon: -58.3685, camera: { lat: -34.6735, lon: -58.3715, range: 0.0012, heading: 0.4, tilt: 1.0 }, layers: ['venues', 'transit', 'traffic', 'cctv'], source: 'Crowd sensing (illustrative)', watchers: 11800, ageS: 40,
  ms: [[4.6, 'p/m²', 'Peak density', 'Derived · 30 s'], ['41k', '', 'Leaving', 'Estimate'], [3, '', 'Gates open', 'Venue feed']], lede: 'Fans are leaving after the final whistle. Density outside Gate C has passed 4 people per square metre while Gates A and D are flowing freely. Stewards are being redirected.', series: [{ label: 'Density at Gate C', unit: 'p/m²', data: [1.1, 1.4, 2.0, 2.8, 3.5, 4.1, 4.6], src: 'Derived · 1 min', fmt: (v) => v.toFixed(1) }], sources: [['Crowd sensing (illustrative)', '30 s', 'live'], ['Signed captures', '3 min', 'live']] });
lite({ id: 'sakurajima', short: 'Sakurajima cam', fam: 'haz', kind: 'volcano', title: 'Sakurajima ash column to 3.2 km — webcam', place: 'Kagoshima Bay, Japan', lat: 31.58, lon: 130.66, camera: { lat: 31.52, lon: 130.6, range: 0.012, heading: 0.5, tilt: 1.15 }, layers: ['volcanoes', 'flights', 'wind', 'cctv'], source: 'Volcano webcam', watchers: 5300, ageS: 120,
  ms: [[3.2, 'km', 'Ash column', 'Webcam · 2 min'], ['ESE', '', 'Drift', 'Wind model'], [0, '', 'Flights affected', 'ADS-B']], lede: 'A routine but tall explosion. Ash is drifting away from the city; the airport is open.', sources: [['Volcano webcam (illustrative)', '2 min', 'live'], ['Wind model', '1 h', 'live']] });
lite({ id: 'lakefront', short: 'Lake Michigan gale', fam: 'wx', kind: 'gale', title: 'Gale on Lake Michigan — waves over the lakefront trail', place: 'Chicago lakefront', lat: 41.866, lon: -87.607, camera: { lat: 41.62, lon: -87.42, range: 0.035, heading: -0.35, tilt: 1.0 }, layers: ['cctv', 'signed', 'traffic'], source: 'Buoy + signed captures', watchers: 1900, ageS: 300, section: 'near',
  ms: [[3.4, 'm', 'Wave height', 'Buoy · 10 min'], [74, 'km/h', 'Gusts', 'Station · 5 min'], [2, '', 'Trail closures', 'City feed']], lede: 'North-northeast gales are piling waves onto the lakefront. The trail is closed between two harbours.', sources: [['Lake buoy (illustrative)', '10 min', 'live'], ['Signed captures', 'live', 'live']] });

for (const s of S) if (s.time && s.time.replay) { s.live = false; s.replayLabel = 'Today ' + new Date(s.time.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'; }
SIT.list = S;
SIT.byId = Object.fromEntries(S.map((s) => [s.id, s]));
SIT.sections = [
  { id: 'now', title: 'Happening now', sub: 'Live' }, { id: 'near', title: 'Near you', sub: GE.ME.name }, { id: 'recon', title: 'Reconstructions', sub: '4D · signed' }, { id: 'always', title: 'Always on', sub: 'Worth a look' },
];
// dynamic cameras
SIT.cameraFor = function (s) {
  if (s.id === 'starlink') { const g = GE.world.sun.gmst; const p = GE.satAt(GE.SATS.find((x) => x.kind === 5), GE.world.t, g); const [la, lo] = geo.ll(p); return { lat: la - 6, lon: lo - 8, range: 0.32, heading: 0.6, tilt: 0.85 }; }
  if (s.id === 'squawk' && GE.feed && GE.feed._sq) return s.camera;
  if (s.id === 'squawk') { const f = GE.FLIGHTS[GE.world.squawks[0]]; const p = GE.flightAt(f, GE.world.t) || { lat: 50, lon: -30 }; return { lat: p.lat - 4, lon: p.lon - 3, range: 0.3, heading: 0.3, tilt: 0.75 }; }
  if (s.id === 'iss') { const p = GE.satAt(GE.ISS, GE.world.t, GE.world.sun.gmst); const [la, lo] = geo.ll(p); return { lat: la - 9, lon: lo - 4, range: 0.48, heading: 0.35, tilt: 0.78 }; }
  return s.camera;
};
SIT.pin = (s) => { if (s.id === 'starlink' || s.id === 'squawk' || s.id === 'iss') { const c = SIT.cameraFor(s); return null; } return { id: s.id, lat: s.lat, lon: s.lon, title: s.title, col: [...hex2rgb(fam(s.fam)), 1], seed: hash01(s.id.length) }; };
