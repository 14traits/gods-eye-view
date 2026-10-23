/**
 * The hero Moment (DESIGN.md §12.4): "Climbers on the Empire State Building".
 *
 * An ILLUSTRATIVE reconstruction used when the engine does not ship one
 * (offline stub, or before mobile/demo/moments/empire-state.json lands).
 * Tracks are synthetic but physically plausible: two news helicopters and one
 * police helicopter orbiting at 1,000–1,500 ft, radii 400–700 m, 60–80 kt,
 * with standard-rate-ish turns. Captures, chat and posts are invented and
 * labelled as such everywhere they are shown.
 */

const R = 6371008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const ESB = { lon: -73.98566, lat: 40.74844 };

function dest(lon, lat, brg, dist) {
  const d = dist / R;
  const b = brg * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return [l2 * R2D, p2 * R2D];
}

export function bearing(a, b) {
  const p1 = a.lat * D2R;
  const p2 = b.lat * D2R;
  const dl = (b.lon - a.lon) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (((Math.atan2(y, x) * R2D + 360) % 360) + 360) % 360;
}

export function distM(a, b) {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * One helicopter: a straight approach from its base to the orbit entry, then
 * a constant-speed orbit. Points every 5 s from departure to the Moment end.
 */
function heli({
  id,
  label,
  type,
  operator,
  base,
  arriveAt,
  radius,
  altM,
  kt,
  dir,
  phase,
  t0,
  t1,
}) {
  const v = kt * 0.514444;
  const entryBrg = bearing(ESB, base);
  const [ex, ey] = dest(ESB.lon, ESB.lat, entryBrg, radius);
  const entry = { lon: ex, lat: ey };
  const approachM = distM(base, entry);
  const depart = arriveAt - (approachM / v) * 1000;
  const pts = [];
  const step = 5000;
  const omega = (v / radius) * R2D; // deg per second
  for (
    let t = Math.max(t0, Math.ceil(depart / step) * step);
    t <= t1;
    t += step
  ) {
    if (t < arriveAt) {
      const k = (t - depart) / (arriveAt - depart);
      const lon = base.lon + (entry.lon - base.lon) * k;
      const lat = base.lat + (entry.lat - base.lat) * k;
      pts.push({ t, lon, lat, altM: Math.round(560 + (altM - 560) * k) });
    } else {
      const s = (t - arriveAt) / 1000;
      const a = entryBrg + dir * omega * s + (phase || 0) * 0;
      const [lon, lat] = dest(ESB.lon, ESB.lat, a, radius);
      // A gentle porpoise of ±15 m reads as a real track, not a CAD circle.
      pts.push({
        t,
        lon,
        lat,
        altM: Math.round(altM + 15 * Math.sin(s / 23 + (phase || 0))),
      });
    }
  }
  return {
    id,
    kind: 'helicopter',
    label,
    type,
    operator,
    speedKt: kt,
    radiusM: radius,
    arriveAt,
    points: pts,
  };
}

/** Interpolated position of a track at time t (null before it exists). */
export function trackAt(track, t) {
  const p = track.points;
  if (!p?.length || t < p[0].t) return null;
  if (t >= p[p.length - 1].t) return { ...p[p.length - 1], i: p.length - 1 };
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (p[m].t <= t) lo = m;
    else hi = m;
  }
  const a = p[lo];
  const b = p[hi];
  const k = (t - a.t) / Math.max(1, b.t - a.t);
  const pos = {
    t,
    lon: a.lon + (b.lon - a.lon) * k,
    lat: a.lat + (b.lat - a.lat) * k,
    altM: a.altM + (b.altM - a.altM) * k,
    i: lo,
  };
  pos.headingDeg = bearing(a, b);
  pos.speedMps = distM(a, b) / Math.max(0.001, (b.t - a.t) / 1000);
  return pos;
}

export function buildHeroMoment(now = Date.now()) {
  // The Moment happened earlier today: 20 minutes, ending ~75 min ago.
  const t0 = Math.floor((now - 95 * 60e3) / 60e3) * 60e3;
  const t1 = t0 + 20 * 60e3;
  const at = (m, s = 0) => t0 + m * 60e3 + s * 1000;

  const tracks = [
    heli({
      id: 'police6',
      label: 'POLICE 6',
      type: 'Bell 429',
      operator: 'City police aviation unit',
      base: { lon: -74.009, lat: 40.7013 },
      arriveAt: at(2, 30),
      radius: 450,
      altM: 320,
      kt: 68,
      dir: -1,
      t0,
      t1,
    }),
    heli({
      id: 'news4',
      label: 'NEWSCOPTER 4',
      type: 'Airbus H125',
      operator: 'Metro 4 News',
      base: { lon: -74.008, lat: 40.754 },
      arriveAt: at(5, 10),
      radius: 650,
      altM: 442,
      kt: 78,
      dir: -1,
      phase: 2,
      t0,
      t1,
    }),
    heli({
      id: 'sky7',
      label: 'SKY 7',
      type: 'Bell 407',
      operator: 'Harbor 7 Eyewitness',
      base: { lon: -74.061, lat: 40.85 },
      arriveAt: at(8, 40),
      radius: 560,
      altM: 395,
      kt: 72,
      dir: -1,
      phase: 4,
      t0,
      t1,
    }),
  ];

  const cap = (o) => {
    const pos = { lon: o.lon, lat: o.lat };
    return {
      fovDeg: 52,
      sealed: true,
      ...o,
      headingDeg: Math.round(bearing(pos, ESB)),
      distanceM: Math.round(distM(pos, ESB)),
    };
  };
  const captures = [
    cap({
      id: 'c1',
      t: at(1, 12),
      lon: -73.9883,
      lat: 40.7497,
      altM: 2,
      title: 'Two figures on the north setback',
      handle: '@harbor_cam_kid',
      where: 'W 34th St & 6th Ave',
      firstEyes: true,
      media: 'photo',
    }),
    cap({
      id: 'c2',
      t: at(4, 31),
      lon: -73.98745,
      lat: 40.74645,
      altM: 2,
      title: 'Police helicopter holding over 5th Ave',
      handle: '@5thave_dana',
      where: '5th Ave & 31st St',
      media: 'clip',
    }),
    cap({
      id: 'c3',
      t: at(9, 5),
      lon: -73.9928,
      lat: 40.7506,
      altM: 158,
      title: 'Level view from the 38th floor, 1 Penn',
      handle: '@onepenn_38f',
      where: '1 Penn Plaza, floor 38',
      media: 'photo',
    }),
    cap({
      id: 'c4',
      t: at(11, 48),
      lon: -73.9888,
      lat: 40.7458,
      altM: 64,
      title: 'Live from a Broadway rooftop',
      handle: '@roof_rodrigo',
      where: 'Broadway & 30th St, roof',
      media: 'live',
      live: true,
    }),
    cap({
      id: 'c5',
      t: at(15, 20),
      lon: -73.9849,
      lat: 40.7499,
      altM: 2,
      title: 'Climbers brought in at the 86th floor',
      handle: '@midtown_maya',
      where: '5th Ave & 35th St',
      media: 'clip',
    }),
  ];

  const chatScript = [
    [
      0,
      40,
      '@nyc_scanner_nerd',
      'scanner: units requested to 350 5th, "persons on the exterior"',
      'local',
    ],
    [0, 58, '@lex_ave_lee', 'wait what, ON the building??'],
    [
      1,
      20,
      '@harbor_cam_kid',
      'I can see them from 34th. two people. sealed photo up',
      'first-eyes',
    ],
    [1, 34, '@aero_ana', 'that photo is wild'],
    [1, 50, '@k_ostrowski', '👀👀👀'],
    [
      2,
      10,
      '@nyc_scanner_nerd',
      'aviation unit launching from downtown',
      'local',
    ],
    [
      2,
      41,
      '@heli_hank',
      'POLICE 6 inbound, left-hand orbit ~450 m. textbook',
      'pilot',
    ],
    [3, 2, '@5thave_dana', 'deck looks closed, people being moved inside'],
    [3, 30, '@bk_bianca', 'is anyone hurt?'],
    [
      3,
      44,
      '@harbor_cam_kid',
      'not that I can see. they look clipped in',
      'first-eyes',
    ],
    [4, 12, '@lex_ave_lee', 'stay safe up there 🙏'],
    [
      4,
      40,
      '@5thave_dana',
      'clip from 5th, you can see POLICE 6 holding',
      'witness',
    ],
    [
      5,
      15,
      '@heli_hank',
      'NEWSCOPTER 4 just joined, wider orbit ~650 m',
      'pilot',
    ],
    [5, 40, '@aero_ana', 'two helis now'],
    [6, 5, '@k_ostrowski', 'traffic on 34th is stopped'],
    [6, 30, '@nyc_scanner_nerd', 'ESU on the 86th floor per scanner', 'local'],
    [7, 3, '@midtown_maya', 'heading over, 5 min out'],
    [7, 40, '@bk_bianca', 'who are they? protest?'],
    [
      8,
      2,
      '@mod_signal',
      'Reminder: no names, no faces. Evidence, not identities.',
      'mod',
    ],
    [
      8,
      51,
      '@heli_hank',
      'SKY 7 makes three. all holding separation, nice',
      'pilot',
    ],
    [
      9,
      12,
      '@onepenn_38f',
      'level view from 1 Penn, 38th fl. they are lower than the spire',
      'witness',
    ],
    [9, 40, '@lex_ave_lee', 'that angle 🔥'],
    [10, 15, '@aero_ana', 'so not the spire then'],
    [10, 48, '@harbor_cam_kid', 'correct, setback above 86', 'first-eyes'],
    [
      11,
      20,
      '@k_ostrowski',
      'hearts for the window washers who called it in ❤️',
    ],
    [
      11,
      55,
      '@roof_rodrigo',
      'going live from the roof on Broadway',
      'witness',
    ],
    [12, 30, '@bk_bianca', 'watching the live, so steady'],
    [
      13,
      10,
      '@nyc_scanner_nerd',
      'scanner: "contact made, cooperative"',
      'local',
    ],
    [13, 42, '@lex_ave_lee', 'phew'],
    [14, 20, '@heli_hank', 'POLICE 6 tightening orbit to ~350 m', 'pilot'],
    [
      15,
      25,
      '@midtown_maya',
      'they are being brought in through a window at 86',
      'witness',
    ],
    [15, 50, '@aero_ana', '😮'],
    [16, 30, '@k_ostrowski', 'whole street clapping lol'],
    [17, 15, '@5thave_dana', 'deck reopening soon per staff'],
    [18, 0, '@heli_hank', 'news helis peeling off west', 'pilot'],
    [18, 45, '@nyc_scanner_nerd', 'units clearing', 'local'],
    [19, 20, '@bk_bianca', 'what a morning'],
  ];
  const chat = chatScript.map(([m, s, handle, text, badge]) => ({
    t: at(m, s),
    handle,
    text,
    ...(badge ? { badge } : {}),
  }));

  const posts = [
    {
      t: at(1, 40),
      handle: '@harbor_cam_kid',
      kind: 'witness',
      text: 'Two people on the north setback above the 86th-floor deck. Sealed photo from W 34th St, 180 m from the base.',
      votes: { corroborate: 41, dispute: 2 },
      captureId: 'c1',
    },
    {
      t: at(3, 15),
      handle: '@bk_bianca',
      kind: 'question',
      text: 'Is the observation deck closed? Anyone hurt?',
      votes: { corroborate: 12, dispute: 0 },
    },
    {
      t: at(6, 10),
      handle: '@nyc_scanner_nerd',
      kind: 'context',
      text: 'Police aviation on scene since the 2½-minute mark; this is the standard rope-rescue pattern for exterior climbers in Midtown.',
      votes: { corroborate: 19, dispute: 1 },
    },
    {
      t: at(10, 5),
      handle: '@onepenn_38f',
      kind: 'correction',
      text: 'Not the spire. The level view from 1 Penn puts them on the setback just above 86, well below the mast.',
      votes: { corroborate: 33, dispute: 3 },
      captureId: 'c3',
    },
    {
      t: at(15, 35),
      handle: '@midtown_maya',
      kind: 'witness',
      text: 'Both climbers brought in through a window at the 86th floor. Clip sealed from 5th Ave & 35th.',
      votes: { corroborate: 27, dispute: 0 },
      captureId: 'c5',
    },
    {
      t: at(18, 30),
      handle: 'Clerk',
      kind: 'synthesis',
      text: 'What chat is saying: two climbers on the north setback (5 sealed captures agree); three helicopters on scene; no injuries reported; both brought inside at 86.',
      votes: { corroborate: 0, dispute: 0 },
    },
  ];

  return {
    id: 'empire-state',
    title: 'Climbers on the Empire State Building',
    place: 'Midtown Manhattan, New York',
    lon: ESB.lon,
    lat: ESB.lat,
    time: { start: t0, end: t1 },
    subject: { lon: ESB.lon, lat: ESB.lat, label: 'Empire State Building' },
    illustrative: true,
    cameraPath: [
      {
        t: t0,
        lon: ESB.lon,
        lat: ESB.lat - 0.012,
        height: 4200,
        heading: 10,
        pitch: -38,
      },
      {
        t: at(5),
        lon: ESB.lon - 0.006,
        lat: ESB.lat - 0.01,
        height: 2600,
        heading: 30,
        pitch: -32,
      },
      {
        t: at(12),
        lon: ESB.lon + 0.008,
        lat: ESB.lat - 0.009,
        height: 2200,
        heading: 340,
        pitch: -30,
      },
      {
        t: t1,
        lon: ESB.lon,
        lat: ESB.lat - 0.011,
        height: 3000,
        heading: 0,
        pitch: -35,
      },
    ],
    tracks,
    captures,
    chat,
    posts,
    sources: [
      {
        name: 'Illustrative reconstruction',
        detail:
          'Synthetic helicopter tracks modelled on typical news and police orbits (400–700 m radius, 1,000–1,500 ft, 60–80 kt). No real aircraft, people or posts.',
      },
      {
        name: 'Esri World Imagery',
        detail: 'Base imagery of Midtown Manhattan',
      },
      {
        name: 'Example captures',
        detail: 'View cones, positions and times are illustrative',
      },
    ],
  };
}
