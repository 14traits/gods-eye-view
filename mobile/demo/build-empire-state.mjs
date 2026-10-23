#!/usr/bin/env node
/**
 * Builds the hero Moment, mobile/demo/moments/empire-state.json:
 * "Climbers on the Empire State Building" (DESIGN.md §12.4).
 *
 * ILLUSTRATIVE. Nothing here happened. The event, the helicopters, their
 * callsigns and tail numbers, the witnesses, the chat and the posts are all
 * fictional, and the file says so (`illustrative: true`). What is real is the
 * place: the building's position and heights, the street corners, the
 * heliports, and the neighbouring building massing (midtown-buildings.json).
 *
 * The helicopter tracks come from a small flight model, not from hand-drawn
 * circles: each aircraft flies a constant airspeed in a steady wind, steers
 * to hold an orbit radius with a rate-limited heading (about standard rate),
 * and drifts in altitude. The ground track that results is what ADS-B shows
 * for a real news orbit: stretched downwind, faster on the downwind side,
 * with a few metres of position noise. Output is 1 Hz.
 *
 *   node mobile/demo/build-empire-state.mjs
 *
 * Deterministic: the same seed always writes the same file.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** JSON as the repo's Prettier would write it (so `prettier --check` passes). */
async function prettyJson(value) {
  const text = JSON.stringify(value);
  try {
    const prettier = await import('prettier');
    return await prettier.format(text, { parser: 'json' });
  } catch {
    return `${text}\n`;
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = 0x35_0f1f7a;

/* ── Place (real) ───────────────────────────────────────────────── */
const ESB = { lon: -73.98566, lat: 40.74844 };
const GROUND_MSL = 15; // m, 5th Ave at 34th St
const ROOF = 381; // m above street (102nd floor roof)
const ANTENNA = 443; // m, antenna tip
const DECK_86 = 320; // m, 86th floor open-air deck
const DECK_102 = 373; // m, 102nd floor deck
const DMH = {
  lon: -74.00905,
  lat: 40.70137,
  name: 'Downtown Manhattan Heliport',
};
const E34 = {
  lon: -73.97175,
  lat: 40.74245,
  name: 'East 34th Street Heliport',
};
const NJ = { lon: -74.0742, lat: 40.7727, name: 'over Secaucus, NJ' };

/* ── Clock (fictional date) ─────────────────────────────────────── */
const T0 = Date.UTC(2026, 8, 18, 21, 18, 0); // 5:18 PM EDT
const DURATION_S = 25 * 60;
const at = (mmss) => {
  const [m, s] = String(mmss).split(':').map(Number);
  return T0 + (m * 60 + (s || 0)) * 1000;
};

/* ── Deterministic randomness ───────────────────────────────────── */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const gauss = () => {
  let u = 0;
  let v = 0;
  while (!u) u = rand();
  while (!v) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ── Local metric frame ─────────────────────────────────────────── */
const D2R = Math.PI / 180;
const KX = 111_320 * Math.cos(ESB.lat * D2R);
const KY = 110_574;
const toXY = (p) => [(p.lon - ESB.lon) * KX, (p.lat - ESB.lat) * KY];
const toLL = (x, y) => ({ lon: ESB.lon + x / KX, lat: ESB.lat + y / KY });
const KT = 0.514444;
const FT = 0.3048;
const wrap = (d) => (((d % 360) + 540) % 360) - 180;
const bearingXY = (dx, dy) => (Math.atan2(dx, dy) / D2R + 360) % 360;

/* ── Flight model ───────────────────────────────────────────────── */
// Wind at 1,000–1,500 ft over Midtown: 14 kt from 290° (blowing toward 110°).
const WIND = { fromDeg: 290, kt: 14 };
const windV = () => {
  const to = (WIND.fromDeg + 180) * D2R;
  return [Math.sin(to) * WIND.kt * KT, Math.cos(to) * WIND.kt * KT];
};

/**
 * Fly a helicopter through `plan` (a list of legs) and return 1 Hz points.
 * Legs: { until, mode:'ground'|'goto'|'orbit', ... }.
 */
function fly({ start, startAltFt, plan, tStart, tEnd, noiseM = 4 }) {
  const dt = 0.2;
  let [x, y] = toXY(start);
  let alt = startAltFt * FT;
  let hdg = plan[0].initialHeading ?? 0;
  let air = 0; // airspeed m/s
  const [wx, wy] = windV();
  const out = [];
  let leg = 0;
  let nextOut = tStart;
  let altPhase = rand() * Math.PI * 2;
  for (let t = tStart; t <= tEnd; t += dt * 1000) {
    while (leg < plan.length - 1 && t >= plan[leg].until) leg++;
    const L = plan[leg];
    let targetAir = (L.kt ?? 0) * KT;
    let targetAlt = (L.altFt ?? startAltFt) * FT;
    let desired = hdg;
    if (L.mode === 'ground') {
      targetAir = 0;
      targetAlt = (L.altFt ?? 0) * FT;
    } else if (L.mode === 'goto') {
      const [tx, ty] = toXY(L.to);
      desired = bearingXY(tx - x, ty - y);
      // Arrive gently: slow down inside 600 m of the end of a goto leg.
      const d = Math.hypot(tx - x, ty - y);
      if (L.slowNear && d < 600)
        targetAir = Math.max(L.slowNear * KT, targetAir * (d / 600));
    } else if (L.mode === 'orbit') {
      const [cx, cy] = toXY(L.center);
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const beta = bearingXY(dx, dy);
      // Radius breathes a little: pilots never fly a perfect circle.
      const r =
        L.radius * (1 + 0.06 * Math.sin((t - tStart) / 1000 / 47 + L.radius));
      const err = Math.atan((d - r) / 110) / D2R;
      desired = L.dir === 'cw' ? beta + 90 + err : beta - 90 - err;
      // The heading that holds that ground track in the wind (crab angle).
      const gx = Math.sin(desired * D2R);
      const gy = Math.cos(desired * D2R);
      const cross = wx * gy - wy * gx; // wind across the track
      const crab = Math.asin(
        Math.max(-0.9, Math.min(0.9, cross / Math.max(8, targetAir))),
      );
      desired = desired + crab / D2R;
    }
    // Heading: rate-limited, about standard rate (3°/s), up to 5.5°/s.
    const maxRate = (L.maxRate ?? 5.5) * dt;
    const dh = wrap(desired - hdg);
    hdg = (hdg + Math.max(-maxRate, Math.min(maxRate, dh)) + 360) % 360;
    // Speed and altitude respond with first-order lags.
    air += (targetAir - air) * Math.min(1, dt / 6);
    altPhase += dt / 37;
    const drift =
      L.mode === 'orbit' ? (28 * Math.sin(altPhase) + 9 * gauss()) * FT : 0;
    alt += (targetAlt + drift - alt) * Math.min(1, dt / 9);
    if (L.mode === 'ground') {
      air = 0;
      alt += (0 - alt) * Math.min(1, dt / 4);
    } else {
      x += (Math.sin(hdg * D2R) * air + wx * Math.min(1, air / 10)) * dt;
      y += (Math.cos(hdg * D2R) * air + wy * Math.min(1, air / 10)) * dt;
    }
    if (t >= nextOut) {
      nextOut += 1000;
      if (L.mode === 'hidden') continue;
      const p = toLL(x + gauss() * noiseM, y + gauss() * noiseM);
      // ADS-B altitude: 25 ft steps, MSL.
      const altFt = Math.round((alt / FT + GROUND_MSL / FT) / 25) * 25;
      out.push({
        t: Math.round(t),
        lon: Math.round(p.lon * 1e6) / 1e6,
        lat: Math.round(p.lat * 1e6) / 1e6,
        altM: Math.round(altFt * FT),
      });
    }
  }
  return out;
}

const near = (p, m, deg) => {
  const [x, y] = toXY(p);
  return toLL(x + Math.sin(deg * D2R) * m, y + Math.cos(deg * D2R) * m);
};
const orbitCenter = (m, deg) => near(ESB, m, deg);

/* ── The three helicopters (fictional) ──────────────────────────── */
const police = fly({
  start: DMH,
  startAltFt: 0,
  tStart: T0,
  tEnd: T0 + DURATION_S * 1000,
  plan: [
    { mode: 'ground', until: at('0:20'), initialHeading: 20 },
    // Up the west side, over the Hudson shoreline, then across to 34th St.
    {
      mode: 'goto',
      to: { lon: -74.0135, lat: 40.7205 },
      kt: 95,
      altFt: 900,
      until: at('0:55'),
    },
    {
      mode: 'goto',
      to: { lon: -74.0055, lat: 40.739 },
      kt: 110,
      altFt: 1100,
      until: at('1:40'),
    },
    {
      mode: 'goto',
      to: near(ESB, 520, 240),
      kt: 90,
      altFt: 1100,
      slowNear: 70,
      until: at('2:10'),
    },
    {
      mode: 'orbit',
      center: orbitCenter(60, 200),
      radius: 470,
      kt: 64,
      altFt: 1100,
      dir: 'ccw',
      until: at('14:00'),
    },
    // Tightens and steps down once officers reach the 102nd floor deck.
    {
      mode: 'orbit',
      center: orbitCenter(30, 120),
      radius: 410,
      kt: 58,
      altFt: 1000,
      dir: 'ccw',
      until: at('25:01'),
    },
  ],
});

const news7 = fly({
  start: NJ,
  startAltFt: 900,
  tStart: T0 + 85_000,
  tEnd: T0 + DURATION_S * 1000,
  plan: [
    {
      mode: 'goto',
      to: { lon: -74.024, lat: 40.7585 },
      kt: 120,
      altFt: 1400,
      until: at('3:20'),
      initialHeading: 120,
    },
    {
      mode: 'goto',
      to: near(ESB, 700, 300),
      kt: 105,
      altFt: 1450,
      slowNear: 80,
      until: at('4:30'),
    },
    {
      mode: 'orbit',
      center: orbitCenter(120, 30),
      radius: 660,
      kt: 76,
      altFt: 1450,
      dir: 'ccw',
      until: at('25:01'),
    },
  ],
});

const sky4 = fly({
  start: E34,
  startAltFt: 0,
  tStart: T0 + 330_000,
  tEnd: T0 + DURATION_S * 1000,
  plan: [
    { mode: 'ground', until: at('6:00'), initialHeading: 300 },
    {
      mode: 'goto',
      to: near(ESB, 600, 140),
      kt: 70,
      altFt: 1250,
      slowNear: 62,
      until: at('7:25'),
    },
    {
      mode: 'orbit',
      center: orbitCenter(90, 160),
      radius: 560,
      kt: 68,
      altFt: 1250,
      dir: 'ccw',
      until: at('21:00'),
    },
    // Leaves for the next story: back out over the East River, south.
    {
      mode: 'goto',
      to: { lon: -73.962, lat: 40.728 },
      kt: 110,
      altFt: 1300,
      until: at('22:30'),
    },
    {
      mode: 'goto',
      to: { lon: -73.99, lat: 40.69 },
      kt: 120,
      altFt: 1300,
      until: at('25:01'),
    },
  ],
});

const tracks = [
  {
    id: 'pd-14',
    kind: 'helicopter',
    label: 'PD-14 (illustrative)',
    callsign: 'PD14',
    registration: 'ILLUS-14',
    type: 'Bell 429',
    operator: 'City police aviation (fictional)',
    role: 'police',
    color: '#5EC8FF',
    points: police,
  },
  {
    id: 'news-7',
    kind: 'helicopter',
    label: 'NEWS-7 (illustrative)',
    callsign: 'NEWS7',
    registration: 'ILLUS-07',
    type: 'Airbus H125',
    operator: 'Channel 7 News (fictional)',
    role: 'news',
    color: '#FFD166',
    points: news7,
  },
  {
    id: 'sky-4',
    kind: 'helicopter',
    label: 'SKY-4 (illustrative)',
    callsign: 'SKY4',
    registration: 'ILLUS-04',
    type: 'Airbus H130',
    operator: 'Sky 4 News (fictional)',
    role: 'news',
    color: '#FF9F6B',
    points: sky4,
  },
];

/* ── Witness captures (fictional people, real corners) ──────────── */
function aim(p, altM, targetAltM) {
  const [x, y] = toXY(p);
  const d = Math.hypot(x, y);
  return {
    headingDeg: Math.round(bearingXY(-x, -y) * 10) / 10,
    pitchDeg: Math.round((Math.atan2(targetAltM - altM, d) / D2R) * 10) / 10,
    rangeM: Math.round(d),
  };
}
const capture = (id, mmss, where, altM, targetAltM, fovDeg, rest) => ({
  id,
  t: at(mmss),
  lon: where.lon,
  lat: where.lat,
  altM,
  ...aim(where, altM, targetAltM),
  fovDeg,
  sealed: true,
  ...rest,
});
const captures = [
  capture(
    'c1',
    '0:52',
    { lon: -73.98795, lat: 40.74968 },
    1.5,
    DECK_86 + 10,
    22,
    {
      title: 'Two figures outside the 86th floor fence',
      handle: 'kvn_on_34th',
      place: 'W 34th St & 6th Ave',
      firstEyes: true,
      kind: 'photo',
    },
  ),
  capture(
    'c2',
    '3:05',
    { lon: -73.98752, lat: 40.74482 },
    1.5,
    DECK_86 + 30,
    30,
    {
      title: 'North face, police helicopter overhead',
      handle: 'jules_flatiron',
      place: '5th Ave & 29th St',
      kind: 'clip',
    },
  ),
  capture('c3', '6:10', { lon: -73.99325, lat: 40.75195 }, 142, ROOF + 20, 18, {
    title: 'On the mast, east side, from the 40th floor',
    handle: 'penn_plaza_40th',
    place: '1 Penn Plaza, 40th floor',
    kind: 'clip',
  }),
  capture('c4', '8:40', { lon: -74.00355, lat: 40.75255 }, 9, ROOF, 14, {
    title: 'Three helicopters around the spire',
    handle: 'hellsk1tchen',
    place: 'The High Line at W 30th St',
    kind: 'photo',
  }),
  capture('c5', '12:20', { lon: -73.98805, lat: 40.74745 }, 55, DECK_102, 40, {
    title: 'Officers on the 102nd floor deck',
    handle: 'lena.ktown',
    place: 'Rooftop, W 32nd St (Koreatown)',
    kind: 'clip',
  }),
  capture('c6', '15:30', { lon: -73.98205, lat: 40.75112 }, 1.5, ROOF, 28, {
    title: 'Crowd on 5th Ave looking up',
    handle: 'midtown_mara',
    place: '5th Ave & 38th St',
    kind: 'photo',
  }),
  capture('c7', '19:45', { lon: -73.97765, lat: 40.74662 }, 48, DECK_102, 20, {
    title: 'Both back over the rail at 102',
    handle: 'rooftop_rafa',
    place: 'Rooftop, Murray Hill',
    kind: 'clip',
  }),
  capture(
    'c8',
    '21:10',
    { lon: -73.98875, lat: 40.74905 },
    1.5,
    ROOF - 40,
    34,
    {
      title: 'SKY-4 peeling away east',
      handle: 'deli_guy_dan',
      place: 'Broadway & 33rd St (Herald Sq)',
      kind: 'photo',
    },
  ),
];

/* ── Live lane: chat (fictional handles) ────────────────────────── */
// [m:ss, handle, text, badge?]. Bursts follow the beats: first sighting,
// police arrival, news arrival, the mast climb, the top, officers on deck,
// coming down.
const CHAT = [
  ['0:12', 'deli_guy_dan', 'why is everyone on 34th looking up'],
  [
    '0:31',
    'kvn_on_34th',
    'theres PEOPLE on the empire state. outside the fence on 86',
    'local',
  ],
  ['0:38', 'midtown_mara', 'wait what'],
  ['0:44', 'brklyn_bea', 'link??'],
  [
    '0:52',
    'kvn_on_34th',
    'sealed photo up. north side, two of them',
    'first-eyes',
  ],
  ['0:58', 'throwaway_tom', 'thats a window washer rig'],
  ['1:04', 'kvn_on_34th', 'no rig. no ropes that I can see', 'first-eyes'],
  ['1:10', 'jules_flatiron', 'omg I see them from 29th'],
  ['1:19', 'nyc_scanner_nerd', 'scanner: units responding to 350 5th', 'local'],
  ['1:33', 'ess_ay_dee', '👀👀👀'],
  ['1:41', 'midtown_mara', 'this is insane'],
  [
    '1:52',
    'avgeek_jfk',
    'police helo just lifted out of the downtown heliport',
    'pilot',
  ],
  ['2:04', 'brklyn_bea', 'I hear it'],
  ['2:10', 'nyc_scanner_nerd', 'PD-14 overhead now, orbiting', 'local'],
  ['2:12', 'deli_guy_dan', 'LOUD'],
  ['2:14', 'ess_ay_dee', '🔥🔥'],
  ['2:16', 'hellsk1tchen', 'can see the heli circling from the west side'],
  ['2:21', 'throwaway_tom', 'ok not window washers lol'],
  ['2:25', 'murrayhill_mo', 'is this a protest?'],
  [
    '2:31',
    'kvn_on_34th',
    'no banner, they just look like climbers. helmets',
    'first-eyes',
  ],
  ['2:44', 'lena.ktown', 'going up to our roof'],
  ['2:58', 'jules_flatiron', 'clip sealed from 5th & 29th', 'witness'],
  ['3:12', 'brklyn_bea', 'how did they even get out there'],
  [
    '3:26',
    'avgeek_jfk',
    'orbit looks ~1,100 ft, tight, maybe 500 m radius',
    'pilot',
  ],
  ['3:39', 'midtown_mara', 'they are not moving'],
  ['3:55', 'ess_ay_dee', 'pray for them fr'],
  ['4:08', 'nyc_scanner_nerd', 'second helo inbound from jersey', 'local'],
  ['4:22', 'deli_guy_dan', 'news is here'],
  ['4:30', 'avgeek_jfk', 'NEWS-7 up high, ~1,450', 'pilot'],
  ['4:33', 'murrayhill_mo', 'its on tv now'],
  ['4:35', 'brklyn_bea', 'channel 7 live rn'],
  ['4:37', 'ess_ay_dee', '😮'],
  ['4:41', 'throwaway_tom', 'tv is 40s behind this chat lmao'],
  ['4:52', 'hellsk1tchen', 'two helis circling opposite sides'],
  ['5:10', 'kvn_on_34th', 'THEY ARE CLIMBING. the mast', 'first-eyes'],
  ['5:12', 'midtown_mara', 'NO'],
  ['5:13', 'jules_flatiron', 'oh my god'],
  ['5:15', 'deli_guy_dan', 'nope nope nope'],
  ['5:17', 'ess_ay_dee', '😮😮😮'],
  ['5:20', 'brklyn_bea', 'im shaking'],
  [
    '5:24',
    'lena.ktown',
    'on the roof, I can see them on the east side',
    'local',
  ],
  ['5:31', 'murrayhill_mo', 'how high is that'],
  ['5:36', 'avgeek_jfk', 'mast starts ~1,250 ft. antenna tip 1,454', 'pilot'],
  ['5:52', 'throwaway_tom', 'who does this'],
  [
    '6:02',
    'nyc_scanner_nerd',
    'third helo lifting from E 34th St heliport',
    'local',
  ],
  [
    '6:10',
    'penn_plaza_40th',
    'from 1 Penn 40th fl. sealed. they are halfway up the mast',
    'witness',
  ],
  ['6:14', 'deli_guy_dan', 'thats so close'],
  ['6:25', 'midtown_mara', 'is that a drone?'],
  ['6:40', 'hellsk1tchen', 'drone over by the river too'],
  [
    '6:58',
    'avgeek_jfk',
    'not a drone, thats SKY-4 coming off the E 34th pad',
    'pilot',
  ],
  ['7:20', 'brklyn_bea', 'three helicopters now'],
  ['7:26', 'ess_ay_dee', '🔥🔥🔥'],
  [
    '7:41',
    'metwx_paul',
    'winds ~15 kt from WNW at 1,000+ ft. thats why the orbits look stretched east',
    'met',
  ],
  ['7:58', 'jules_flatiron', 'the gusts up there must be brutal'],
  ['8:12', 'murrayhill_mo', 'they stopped'],
  ['8:30', 'kvn_on_34th', 'one is waving??', 'first-eyes'],
  [
    '8:40',
    'hellsk1tchen',
    'sealed from the high line, all three helis in frame',
    'witness',
  ],
  ['8:51', 'deli_guy_dan', 'crowd on 5th is massive now'],
  ['9:05', 'brklyn_bea', 'please come down'],
  ['9:22', 'lena.ktown', 'they are going higher', 'witness'],
  ['9:34', 'throwaway_tom', 'HOW'],
  ['9:40', 'kvn_on_34th', 'ONE IS AT THE TOP OF THE MAST', 'first-eyes'],
  ['9:41', 'midtown_mara', 'NOOOO'],
  ['9:42', 'ess_ay_dee', '😮😮😮😮'],
  ['9:43', 'jules_flatiron', 'oh my god oh my god'],
  ['9:44', 'deli_guy_dan', 'cant watch'],
  ['9:46', 'murrayhill_mo', 'insane'],
  ['9:48', 'brklyn_bea', '😭'],
  ['9:51', 'hellsk1tchen', 'the whole avenue just gasped'],
  ['9:55', 'penn_plaza_40th', 'whole office is at the window', 'witness'],
  [
    '10:08',
    'heli_dispatch_ret',
    'three ships stacked 1,000/1,250/1,450, all left orbits. textbook',
    'pilot',
  ],
  ['10:22', 'throwaway_tom', 'helmet cam. this is for a video 100%'],
  [
    '10:40',
    'avgeek_jfk',
    'NEWS-7 widening out, prob for the wide shot',
    'pilot',
  ],
  ['11:05', 'midtown_mara', 'is the deck closed?'],
  [
    '11:20',
    'nyc_scanner_nerd',
    'scanner says deck cleared, ESU going up',
    'local',
  ],
  ['11:42', 'brklyn_bea', 'come on come on'],
  ['12:05', 'murrayhill_mo', 'whats ESU'],
  [
    '12:11',
    'nyc_scanner_nerd',
    'emergency service unit. rescue specialists',
    'local',
  ],
  [
    '12:20',
    'lena.ktown',
    'sealed: officers on the 102 deck right under them',
    'witness',
  ],
  ['12:24', 'ess_ay_dee', '🙏'],
  ['12:35', 'deli_guy_dan', 'they are talking to them i think'],
  ['13:02', 'jules_flatiron', 'PD-14 dropping lower'],
  [
    '13:40',
    'heli_dispatch_ret',
    'police ship tightening the orbit, stepping down to ~1,000',
    'pilot',
  ],
  ['14:10', 'throwaway_tom', 'third climber on the setback??'],
  ['14:14', 'midtown_mara', 'wait three??'],
  ['14:20', 'brklyn_bea', 'I see a third one'],
  [
    '14:48',
    'jules_flatiron',
    'thats the mast shadow lol. compare the 5th ave and high line shots',
    'witness',
  ],
  ['15:02', 'hellsk1tchen', 'yeah shadow, sun is behind us', 'witness'],
  [
    '15:30',
    'midtown_mara',
    'sealed from 38th, the crowd is all phones',
    'witness',
  ],
  ['15:51', 'deli_guy_dan', 'sold out of water lol'],
  ['16:20', 'murrayhill_mo', 'how long has it been'],
  ['16:24', 'kvn_on_34th', '16 min since I saw them', 'first-eyes'],
  ['16:50', 'ess_ay_dee', '❤️❤️'],
  ['17:15', 'brklyn_bea', 'they are moving'],
  ['17:30', 'lena.ktown', 'coming DOWN', 'witness'],
  ['17:32', 'midtown_mara', 'YES'],
  ['17:34', 'deli_guy_dan', 'thank god'],
  ['17:36', 'ess_ay_dee', '❤️❤️❤️'],
  ['17:55', 'throwaway_tom', 'slowly. slowly'],
  ['18:30', 'jules_flatiron', 'first one at the rail'],
  ['18:58', 'penn_plaza_40th', 'officers reaching over the rail', 'witness'],
  ['19:20', 'kvn_on_34th', 'ONE IS IN', 'first-eyes'],
  ['19:22', 'brklyn_bea', '😭😭'],
  ['19:24', 'midtown_mara', 'ok im crying'],
  ['19:40', 'lena.ktown', 'SECOND ONE IN', 'witness'],
  ['19:42', 'deli_guy_dan', 'LETS GOOO'],
  ['19:43', 'ess_ay_dee', '❤️🔥❤️🔥'],
  ['19:44', 'murrayhill_mo', 'the street is clapping'],
  [
    '19:45',
    'rooftop_rafa',
    'sealed from murray hill, both over the rail',
    'witness',
  ],
  ['19:50', 'hellsk1tchen', 'cheering from the high line too'],
  ['20:10', 'throwaway_tom', 'they are so arrested'],
  [
    '20:40',
    'nyc_scanner_nerd',
    'scanner: two in custody, no injuries reported',
    'local',
  ],
  ['21:00', 'avgeek_jfk', 'SKY-4 departing east, next story', 'pilot'],
  ['21:10', 'deli_guy_dan', 'sealed one of SKY-4 leaving', 'witness'],
  ['21:35', 'jules_flatiron', 'what a day for midtown'],
  ['22:10', 'midtown_mara', 'the replay of this is gonna be wild'],
  ['22:40', 'brklyn_bea', 'thank you everyone for the updates'],
  [
    '23:15',
    'heli_dispatch_ret',
    'NEWS-7 and PD-14 still up. will hold till the street clears',
    'pilot',
  ],
  ['24:05', 'murrayhill_mo', 'traffic on 5th still stopped'],
  [
    '24:40',
    'kvn_on_34th',
    'cant believe I just looked up at the right time',
    'first-eyes',
  ],
];

/* ── Record lane: posts ─────────────────────────────────────────── */
const POSTS = [
  [
    '0:58',
    'kvn_on_34th',
    'witness',
    'Two people outside the safety fence on the 86th floor setback, north face. Sealed photo from W 34th St & 6th Ave, 22° zoom.',
    412,
  ],
  [
    '2:40',
    'midtown_mara',
    'question',
    'Is the observation deck being cleared? Is anyone still up there?',
    88,
  ],
  [
    '3:30',
    'nyc_scanner_nerd',
    'context',
    'Police aviation is on scene, orbiting at about 1,100 ft. News helicopters usually follow within minutes.',
    230,
  ],
  [
    '6:15',
    'penn_plaza_40th',
    'witness',
    'From 1 Penn Plaza, 40th floor: both are on the mooring mast, east side, about halfway up. Sealed clip.',
    377,
  ],
  [
    '7:05',
    'avgeek_jfk',
    'correction',
    'The "drone" in clips around 6:30 is SKY-4 lifting out of the East 34th St heliport. Its track matches.',
    156,
  ],
  [
    '7:50',
    'metwx_paul',
    'context',
    'Wind at 1,000–1,500 ft is about 15 kt from the WNW. That is why every orbit looks stretched toward the East River.',
    141,
  ],
  [
    '10:15',
    'heli_dispatch_ret',
    'context',
    'Three helicopters holding 1,000, 1,250 and 1,450 ft in left-hand orbits. Staggered altitudes are normal deconfliction.',
    264,
  ],
  [
    '12:25',
    'lena.ktown',
    'witness',
    'Rooftop in Koreatown: officers visible on the 102nd floor deck directly below the climbers. Sealed.',
    198,
  ],
  [
    '14:55',
    'jules_flatiron',
    'correction',
    "There is no third climber. The figure on the setback is the mast's shadow: compare the 5th Ave and High Line captures, taken 6 minutes apart.",
    301,
  ],
  ['16:10', 'brklyn_bea', 'question', 'Has anyone been hurt?', 64],
  [
    '19:50',
    'rooftop_rafa',
    'witness',
    'Both are back over the rail at the 102nd floor and officers have them. Sealed clip from Murray Hill.',
    520,
  ],
  [
    '20:45',
    'nyc_scanner_nerd',
    'context',
    'Scanner traffic: two in custody, no injuries reported. Unconfirmed until an official statement.',
    187,
  ],
];

/* ── Beats (for timeline pips) ──────────────────────────────────── */
const BEATS = [
  ['0:52', 'First sealed capture: two figures outside the 86th floor fence'],
  ['2:10', 'Police helicopter on scene'],
  ['4:30', 'NEWS-7 arrives'],
  ['5:10', 'Climbers start up the mast'],
  ['7:25', 'SKY-4 joins: three helicopters orbiting'],
  ['9:40', 'One climber at the top of the mast'],
  ['12:20', 'Officers on the 102nd floor deck'],
  ['17:30', 'Climbers start down'],
  ['19:40', 'Both back over the rail'],
  ['21:00', 'SKY-4 departs'],
];

/* ── Cinematic camera path, keyed to time ───────────────────────── */
// Each key: bearing from the building, ground range, the camera's pitch
// down to the look point, and the look point's height (default the deck).
function camKey(
  mmss,
  bearingFromEsb,
  rangeM,
  pitchDownDeg,
  lookAltM = DECK_86,
) {
  const heightM = Math.round(lookAltM + Math.tan(pitchDownDeg * D2R) * rangeM);
  const p = near(ESB, rangeM, bearingFromEsb);
  const [x, y] = toXY(p);
  const heading = bearingXY(-x, -y);
  const pitch = Math.atan2(lookAltM - heightM, Math.hypot(x, y)) / D2R;
  return {
    t: at(mmss),
    lon: Math.round(p.lon * 1e6) / 1e6,
    lat: Math.round(p.lat * 1e6) / 1e6,
    height: heightM,
    heading: Math.round(heading * 10) / 10,
    pitch: Math.round(pitch * 10) / 10,
  };
}
const cameraPath = [
  camKey('0:00', 212, 4200, 30, 150),
  camKey('1:00', 218, 3200, 30, 200),
  camKey('2:00', 228, 2300, 31, 260),
  camKey('3:30', 248, 1800, 32),
  camKey('5:00', 278, 1550, 31, ROOF),
  camKey('6:30', 308, 1450, 30, ROOF),
  camKey('8:00', 338, 1350, 29, ROOF),
  camKey('9:40', 6, 1150, 26, ROOF + 20),
  camKey('11:30', 38, 1350, 29, ROOF),
  camKey('13:30', 72, 1650, 32),
  camKey('15:30', 108, 1900, 34),
  camKey('17:30', 142, 1600, 31, ROOF),
  camKey('19:40', 172, 1300, 27, DECK_102),
  camKey('21:30', 198, 2000, 31),
  camKey('23:30', 216, 3000, 31, 220),
  camKey('25:00', 224, 4000, 30, 150),
];

/* ── Assemble ───────────────────────────────────────────────────── */
const jitter = (t, s) => t + Math.round(gauss() * s * 1000);
const chat = CHAT.map(([mmss, handle, text, badge]) => ({
  t: jitter(at(mmss), 1.2),
  handle,
  text,
  ...(badge ? { badge } : {}),
})).sort((a, b) => a.t - b.t);
const posts = POSTS.map(([mmss, handle, kind, text, votes], i) => ({
  id: `p${i + 1}`,
  t: at(mmss),
  handle,
  kind,
  text,
  votes,
  ...(captures.find(
    (c) => c.handle === handle && Math.abs(c.t - at(mmss)) < 60_000,
  )
    ? {
        captureId: captures.find(
          (c) => c.handle === handle && Math.abs(c.t - at(mmss)) < 60_000,
        ).id,
      }
    : {}),
}));

const moment = {
  id: 'empire-state',
  title: 'Climbers on the Empire State Building',
  place: 'Midtown Manhattan, New York',
  lon: ESB.lon,
  lat: ESB.lat,
  time: { start: T0, end: T0 + DURATION_S * 1000 },
  illustrative: true,
  illustrativeNote:
    'Illustrative reconstruction. The event, aircraft, callsigns, people, chat and posts are fictional; the place, building heights and heliports are real.',
  recommendedSpeed: 30,
  groundMslM: GROUND_MSL,
  subject: {
    lon: ESB.lon,
    lat: ESB.lat,
    altM: DECK_86,
    label: 'Empire State Building',
    roofM: ROOF,
    antennaM: ANTENNA,
    decks: [DECK_86, DECK_102],
  },
  stage: {
    buildings: 'midtown-buildings.json',
    water: 'midtown-water.json',
    highlight: '1015862',
  },
  wind: WIND,
  cameraPath,
  beats: BEATS.map(([mmss, title]) => ({ t: at(mmss), title })),
  tracks,
  captures,
  chat,
  posts,
  sources: [
    {
      name: 'Illustrative reconstruction',
      detail:
        'Helicopter tracks are synthetic, from a flight model (constant airspeed, 14 kt wind, rate-limited turns) shaped like real news and police orbits. Callsigns and tail numbers are fictional and are not real registrations.',
    },
    {
      name: 'NYC Open Data · Building Footprints',
      detail:
        'Real footprints and roof heights for Midtown (NYC OTI, dataset 5zhs-2jue).',
    },
    {
      name: 'OpenStreetMap water polygons',
      detail: 'Hudson and East River surfaces (ODbL, via OpenFreeMap).',
    },
    {
      name: 'Esri World Imagery',
      detail: 'Base imagery of the real place.',
    },
    {
      name: 'Simulated Live and Record lanes',
      detail:
        'Chat, posts, handles and witness captures are simulated to show how a room forms around an event.',
    },
  ],
};

await mkdir(path.join(HERE, 'moments'), { recursive: true });
const file = path.join(HERE, 'moments', 'empire-state.json');
await writeFile(file, await prettyJson(moment));
console.log(
  `wrote ${file}: ${tracks.map((t) => `${t.id} ${t.points.length} pts`).join(', ')}, ` +
    `${captures.length} captures, ${chat.length} chat, ${posts.length} posts`,
);
