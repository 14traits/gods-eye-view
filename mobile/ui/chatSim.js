/**
 * Simulated Live chat (DESIGN.md §12.6, §12.8 "Honest labels").
 *
 * A believable crowd for the demo: per-genre pools written like real people
 * on the ground and in the hobby (pilots, locals, weather nerds, skeptics,
 * jokers, moderators), realistic pacing with bursts, and replies to what the
 * person types. Every handle is fictional and every message is flagged
 * `sim: true`; the lane that shows them is labelled "Simulated chat · demo".
 * Numbers quoted in messages come only from the situation's live metrics.
 */

import { fmtNum } from './dom.js';
import { headlineOf, fmtKm, cardinal } from './bands.js';
import { simTier, hashStr } from './signal.js';

/* ---------------- Personas (fictional) ---------------- */

export const PERSONAS = {
  mod: [
    { handle: '@deskmod_rae', mod: true, floor: 900 },
    { handle: '@nightdesk_mod', mod: true, floor: 760 },
  ],
  pilot: [
    { handle: '@flaps30', domain: 'Pilot', floor: 420 },
    { handle: '@heavy_tess', domain: 'Pilot', floor: 640 },
    { handle: '@atc_listener', floor: 220 },
  ],
  wx: [
    { handle: '@wxdan', domain: 'Met', floor: 520 },
    { handle: '@cape_and_shear', floor: 300 },
    { handle: '@radar_rina', domain: 'Met', floor: 820 },
  ],
  local: [
    { handle: '@onthe5th', local: true, floor: 140 },
    { handle: '@harborkid_22', local: true, floor: 90 },
    { handle: '@ridge_rd_amy', local: true, floor: 260 },
    { handle: '@corner_deli_mo', local: true, floor: 40 },
  ],
  skeptic: [
    { handle: '@actually_tho', floor: 380 },
    { handle: '@sourcepls', floor: 560 },
  ],
  joker: [
    { handle: '@lagspike', floor: 0 },
    { handle: '@pigeonwatch', floor: 60 },
    { handle: '@buffering_bev', floor: 10 },
  ],
  orbit: [
    { handle: '@tle_tom', floor: 700 },
    { handle: '@pass_predictor', floor: 330 },
  ],
  sea: [{ handle: '@bridgewing_ko', domain: 'Mariner', floor: 610 }],
  medic: [
    { handle: '@medic_off_shift', domain: 'First responder', floor: 480 },
  ],
  scanner: [
    { handle: '@scanner_sal', floor: 350 },
    { handle: '@freq_hopper', floor: 180 },
  ],
  photo: [{ handle: '@longlens_ben', floor: 290 }],
  newbie: [
    { handle: '@first_time_here', floor: 0 },
    { handle: '@lurker9', floor: 0 },
    { handle: '@k8_mobile', floor: 20 },
    { handle: '@just_scrolling', floor: 0 },
  ],
};
const ALL = Object.entries(PERSONAS).flatMap(([role, list]) =>
  list.map((p) => ({ ...p, role })),
);
export const personaOf = (handle) => ALL.find((p) => p.handle === handle);

/** Where watchers are (for "hi from …" lines and crowd reactions). */
export const WORLD = [
  ['Lisbon', 38.72, -9.14, 3],
  ['Manila', 14.6, 120.98, 6],
  ['Lagos', 6.52, 3.38, 5],
  ['São Paulo', -23.55, -46.63, 6],
  ['Mumbai', 19.08, 72.88, 7],
  ['Jakarta', -6.2, 106.85, 6],
  ['Tokyo', 35.68, 139.69, 7],
  ['Seoul', 37.57, 126.98, 5],
  ['London', 51.51, -0.13, 6],
  ['Berlin', 52.52, 13.4, 4],
  ['Toronto', 43.65, -79.38, 4],
  ['Chicago', 41.88, -87.63, 4],
  ['Mexico City', 19.43, -99.13, 6],
  ['Sydney', -33.87, 151.21, 4],
  ['Nairobi', -1.29, 36.82, 3],
  ['Cairo', 30.04, 31.24, 5],
  ['Istanbul', 41.01, 28.98, 5],
  ['Denver', 39.74, -104.99, 3],
  ['Seattle', 47.61, -122.33, 3],
  ['Austin', 30.27, -97.74, 3],
  ['Houston', 29.76, -95.37, 4],
  ['Miami', 25.76, -80.19, 3],
  ['New York', 40.71, -74.01, 7],
  ['Los Angeles', 34.05, -118.24, 6],
  ['Paris', 48.86, 2.35, 5],
  ['Madrid', 40.42, -3.7, 4],
  ['Warsaw', 52.23, 21.01, 3],
  ['Helsinki', 60.17, 24.94, 2],
  ['Bangkok', 13.76, 100.5, 5],
  ['Singapore', 1.35, 103.82, 4],
  ['Taipei', 25.03, 121.57, 4],
  ['Auckland', -36.85, 174.76, 2],
  ['Bogotá', 4.71, -74.07, 4],
  ['Johannesburg', -26.2, 28.05, 3],
  ['Dubai', 25.2, 55.27, 3],
  ['Reykjavík', 64.15, -21.94, 1],
];
const WORLD_W = WORLD.reduce((a, w) => a + w[3], 0);
export function worldPoint(rand = Math.random) {
  let x = rand() * WORLD_W;
  for (const w of WORLD) {
    x -= w[3];
    if (x <= 0)
      return {
        city: w[0],
        lat: w[1] + (rand() - 0.5) * 1.6,
        lon: w[2] + (rand() - 0.5) * 1.6,
      };
  }
  return { city: WORLD[0][0], lat: WORLD[0][1], lon: WORLD[0][2] };
}

/* ---------------- Genre ---------------- */

export function chatGenre(s) {
  const k =
    `${s?.kind || ''} ${s?.archetype || ''} ${s?.title || ''}`.toLowerCase();
  if (s?.momentId || /circling|moment|climber/.test(k)) return 'circling';
  if (/cyclone|typhoon|hurricane/.test(k)) return 'cyclone';
  if (/quake/.test(k)) return 'quake';
  if (/fire|volcano/.test(k)) return 'fire';
  if (/lightning|rain|storm|radar/.test(k)) return 'storm';
  if (/squawk/.test(k)) return 'squawk';
  if (/gnss|jam/.test(k)) return 'gnss';
  if (/launch/.test(k)) return 'launch';
  if (/iss|pass|aurora|orbit|starlink/.test(k)) return 'orbit';
  if (/camera|cctv|eye/.test(k)) return 'eye';
  if (/queue|strait|port|ship|vessel/.test(k)) return 'sea';
  if (/heli|rotor/.test(k)) return 'heli';
  if (/airport|military|jet|flight|tanker/.test(k)) return 'air';
  return 'default';
}

/* ---------------- Metric helpers ---------------- */

function fmtMetric(m) {
  if (!m) return '';
  const v =
    typeof m.value === 'number'
      ? fmtNum(m.value, m.value % 1 ? 1 : 0)
      : String(m.value ?? '');
  return `${v}${m.unit ? ` ${m.unit}` : ''}`.trim();
}
function vars(s) {
  const ms = s.metrics || [];
  const hl = headlineOf(s);
  const find = (k) =>
    ms.find((m) =>
      String(m.label).toLowerCase().startsWith(String(k).toLowerCase()),
    );
  return {
    place: s.place || s.title || 'there',
    title: s.title || '',
    m0: fmtMetric(ms[0]),
    m1: fmtMetric(ms[1]),
    m2: fmtMetric(ms[2]),
    l0: String(ms[0]?.label || '').toLowerCase(),
    l1: String(ms[1]?.label || '').toLowerCase(),
    hl: hl ? `${hl.value}${hl.unit ? ` ${hl.unit}` : ''}` : '',
    hll: hl?.label || '',
    dir: cardinal(s.media?.headingDeg) || '',
    find: (k) => fmtMetric(find(k)),
  };
}

/** "{m0}" style templates; returns '' if any placeholder is empty. */
export function fill(t, V, extra = {}) {
  let bad = false;
  const out = t.replace(/\{([\w:]+)\}/g, (_, key) => {
    let v = '';
    if (key.startsWith('m:')) v = V.find(key.slice(2));
    else v = extra[key] ?? V[key] ?? '';
    if (!v) bad = true;
    return v;
  });
  return bad ? '' : out;
}

/* ---------------- Pools ---------------- */
// [role, text]. Text may use {place} {title} {m0} {m1} {hl} {hll} {m:Label}.

const COMMON = [
  ['newbie', 'first time in a live room, this is wild'],
  ['newbie', 'how is everyone seeing this so fast'],
  ['newbie', 'what does the gold ring next to some names mean?'],
  [
    'mod',
    'Gold ring = that person has a sealed capture near this. Their chat glows, it doesn’t mean they’re right SealIt',
  ],
  ['joker', 'my boss thinks I’m in a spreadsheet rn'],
  ['joker', 'chat moving faster than my wifi'],
  [
    'skeptic',
    'reminder that chat is not a source. Record lane or it didn’t happen',
  ],
  ['newbie', 'is the map live or a replay?'],
  [
    'mod',
    'Map is live. Anything with a seal is a real capture; anything that says Example or Simulated is demo content',
  ],
  ['local', 'refreshing this instead of sleeping, as one does'],
  [
    'photo',
    'if anyone nearby has a long lens, the Need eyes pins are where it’s useful',
  ],
  ['newbie', 'o7 from the night shift'],
  ['joker', 'Receipts or it’s fan fiction'],
];

const GREET = [
  'hi from {city}',
  'watching from {city} o7',
  '{city} checking in',
  'evening from {city}',
  'morning from {city}, coffee + this',
];

const POOLS = {
  circling: [
    [
      'scanner',
      'NYPD aviation on the Special Ops freq, they’re holding over 34th',
    ],
    [
      'local',
      'I can see two of them from my office, both orbiting tight around the top of the building',
    ],
    [
      'pilot',
      'that orbit radius looks like ~500 m, classic news-helo orbit for a stable shot',
    ],
    [
      'local',
      'there are people on the observation deck pointing UP. something is on the mast',
    ],
    [
      'photo',
      'from 5th Ave with a 400mm you can see two figures above the 86th floor deck EyesUp',
    ],
    ['skeptic', 'two figures according to who? show me a sealed capture'],
    [
      'local',
      'sealed a clip from the 34th St side, posting to Record SealIt',
      { evidence: 0.25 },
    ],
    ['joker', 'King Kong reboot looking real low budget'],
    [
      'pilot',
      'police heli is lower, around 1,000 ft, news birds stacked above at 1,500',
    ],
    ['scanner', 'ESU requested to the 86th floor, that’s rope rescue'],
    [
      'mod',
      'Please don’t share names of anyone on the building. Slow mode is on.',
    ],
    ['newbie', 'why are there 3 helicopters for 2 people'],
    [
      'pilot',
      'one police, two news. the news ones are there for the shot, not the rescue',
    ],
    ['local', 'crowd forming on 34th, cops pushing everyone back to Broadway'],
    [
      'skeptic',
      'the climbers thing is unconfirmed until someone up close seals it. could be maintenance crew',
    ],
    ['local', 'maintenance doesn’t wave a banner HeliSpin'],
    [
      'photo',
      'banner says something, can’t read it, the wind keeps flipping it',
    ],
    ['scanner', 'they’re calling it a “protest climb” on the radio now'],
    ['joker', 'imagine commuting to work and it’s this'],
    [
      'local',
      'i’m at 1 Penn, 30th floor, perfect angle. sealing now',
      { evidence: 0.6 },
    ],
  ],
  cyclone: [
    [
      'wx',
      'eyewall replacement explains why the peak dipped but the wind field got wider',
    ],
    [
      'wx',
      'sustained {m:Wind} is still a serious storm, don’t let the dip fool you',
    ],
    ['local', 'power flickering here twice in the last ten minutes'],
    [
      'local',
      'outer bands hit the waterfront, chairs on the pier are sliding StormMode',
    ],
    ['skeptic', 'whoever is posting Cat 5 clips: that’s from 2013'],
    [
      'wx',
      'pressure {m:Pressure} — watch whether it falls again after the EWRC',
    ],
    ['newbie', 'is it going to hit Manila?'],
    ['wx', 'the cone is wide this far out. look at the cone, not the line'],
    [
      'mod',
      'If you’re in the warning area: follow PAGASA, not chat. We’re a window, not an alert service.',
    ],
    ['joker', 'StormMode activated, snacks acquired'],
    [
      'local',
      'my uncle in Aparri says the sea is already over the seawall',
      { evidence: null },
    ],
    ['sea', 'ships are leaving the anchorage, that’s a tell'],
    ['photo', 'IR loop is gorgeous, eye is clearing again EyesUp'],
    [
      'skeptic',
      '“my uncle says” is not evidence, but a sealed photo from him would be',
    ],
    [
      'local',
      'sealed a clip of the harbour from the 3rd floor, posting',
      { evidence: 3.8 },
    ],
  ],
  storm: [
    ['wx', '{m0} in the last hour, that’s a very electric line'],
    [
      'local',
      'constant flashes to the south, thunder every couple seconds StormMode',
    ],
    ['local', 'gutters already overflowing on my street'],
    ['wx', 'the core is moving with the line, maybe 40 min to the coast'],
    ['newbie', 'is it safe to drive home now?'],
    [
      'medic',
      'if you can wait 30–40 min, wait. most crashes in these are in the first wave of rain',
    ],
    [
      'skeptic',
      'that “tornado” photo going around is from Oklahoma last spring',
    ],
    [
      'photo',
      'got a lightning shot from the parking garage, 8 s exposure',
      { evidence: 2.1 },
    ],
    ['joker', 'my dog has filed a formal complaint'],
    ['wx', 'peak density {m1}, wow'],
    ['local', 'power just went out on our block'],
    [
      'mod',
      'Flood photos: please post them to the Record with a seal so the room can use them',
    ],
    [
      'local',
      'underpass on 7th is a lake, cars turning around',
      { evidence: 0.8 },
    ],
  ],
  quake: [
    ['local', 'long rolling one, maybe 20 seconds, 6th floor'],
    ['local', 'glasses rattled, nothing fell here'],
    ['wx', 'depth {m:Depth} — shallow ones feel sharper'],
    ['newbie', 'tsunami??'],
    [
      'mod',
      'Tsunami advisories come from the national warning centre. Not from chat. Link is in the Record.',
    ],
    [
      'skeptic',
      'first automatic solutions often fix depth at 10 km, wait for the reviewed one',
    ],
    ['local', 'aftershock just now, small, felt it in the chair'],
    ['joker', 'my cat knew 10 seconds before. cats are the real sensors'],
    ['medic', 'check gas lines if you’re in an older building'],
    ['local', 'sealed a clip of the hallway lights swinging', { evidence: 12 }],
    [
      'skeptic',
      'magnitude keeps getting revised, quote the latest from the brief',
    ],
  ],
  fire: [
    ['local', 'ash on the cars this morning, sky orange to the east'],
    ['local', 'smoke is laying right down the valley'],
    ['wx', 'wind is pushing the plume east, look at the wind lens'],
    ['newbie', 'how many fires is that?'],
    [
      'wx',
      'each hotspot is a ~375 m pixel, {m0} hotspots isn’t that many separate fires',
    ],
    [
      'skeptic',
      'the “fire jumped the river” post is not on the perimeter layer',
    ],
    ['medic', 'close windows, N95 if you have one, AQI will spike tonight'],
    [
      'photo',
      'sealed a photo from the ridge road, glow over the second ridge',
      { evidence: 6.5 },
    ],
    ['joker', 'my car is now beige, it was black'],
    [
      'mod',
      'Evacuation info: county alerts only. Don’t relay road closures from chat as fact.',
    ],
  ],
  squawk: [
    ['pilot', '7700 is a general emergency. medical diversions use it too'],
    [
      'pilot',
      '{m:Altitude} and {m:Speed}, looks like a controlled descent to me',
    ],
    ['atc', 'they asked for vectors to the nearest suitable, sounded calm'],
    ['newbie', 'hijack??'],
    ['skeptic', 'not a hijack. that would be 7500. please stop'],
    ['scanner', 'tower has fire trucks positioned, that’s standard'],
    [
      'local',
      'heard it low over the harbour, gear down, engines sounded normal',
    ],
    ['joker', 'pilots when the coffee machine breaks: 7700'],
    [
      'pilot',
      'track turned north a few min ago, lining up for the long runway',
    ],
    ['mod', 'Please don’t speculate about passengers. Facts in the Record.'],
  ],
  gnss: [
    [
      'pilot',
      'flew through there last week, GPS dropped, we were on inertial for ~20 min',
    ],
    ['newbie', 'does this affect phones?'],
    [
      'wx',
      'the layer is aircraft self-reporting nav accuracy, {m0} aircraft, not phones',
    ],
    [
      'skeptic',
      'calling everything jamming overstates it, some are equipment faults',
    ],
    ['sea', 'ships near the coast report the same pattern at night'],
    ['joker', 'my phone thinks I’m in the sea again'],
    ['mod', 'Stick to what the data shows. No attribution games in Live.'],
  ],
  orbit: [
    [
      'orbit',
      'pass is ~6 min horizon to horizon, look west-southwest at the start',
    ],
    ['orbit', 'it’s brighter than anything but the Moon tonight EyesUp'],
    ['newbie', 'how do I know which dot it is?'],
    ['orbit', 'it doesn’t blink and it moves steadily, planes blink'],
    ['local', 'clouds here, praying for a gap'],
    ['photo', 'tripod out, going for a 6 s exposure streak'],
    ['joker', 'waving at the astronauts o7'],
    ['skeptic', 'the viral fireball clip is a reentry from last year'],
    ['local', 'SAW IT. so bright. sealed photo', { evidence: 0.4 }],
  ],
  launch: [
    ['orbit', 'weather is the only thing that can scrub this now'],
    ['local', 'causeway is packed, cars parked on the shoulder for a mile'],
    ['newbie', 'can you see it from Houston?'],
    ['orbit', 'not the launch, maybe the plume if it’s clear'],
    ['joker', 'LiftOff LiftOff LiftOff'],
    ['skeptic', 'T-0 is a window, not a promise'],
    [
      'photo',
      'set up at the beach with 600mm, sealed test shot of the pad',
      { evidence: 9 },
    ],
    ['mod', 'Reminder: respect the exclusion zone. No drone footage please.'],
  ],
  eye: [
    ['local', 'walking past now, way busier than the frame shows'],
    ['local', 'line out the door at the corner'],
    [
      'skeptic',
      'the camera faces {dir}, the “crowd heading to the square” is walking away from it',
    ],
    ['newbie', 'is this actually live?'],
    [
      'mod',
      'Frame refreshes every ~15 s from the city’s public camera. Faces are not identifiable at this res, keep it that way.',
    ],
    ['joker', 'i’m the pixel in the red jacket. hi mom'],
    ['local', 'lane closure still on, cones all the way to the light'],
    [
      'photo',
      'sealed a photo from across the street, matches the frame',
      { evidence: 0.08 },
    ],
  ],
  sea: [
    [
      'sea',
      'anchored in the waiting area since morning, told to hold 12 more hours',
    ],
    ['sea', 'mostly scheduling, convoys run at set times'],
    ['newbie', 'why so many ships?'],
    ['skeptic', 'some of those are bunkering, not queuing'],
    ['joker', 'this is the DMV of oceans'],
    ['sea', 'AIS will show them moving in a column when the convoy starts'],
  ],
  heli: [
    ['pilot', 'that’s a training pattern, same circuit every 6–7 min'],
    ['local', 'they do this all day, you stop hearing it'],
    ['newbie', 'is something wrong?'],
    ['pilot', 'nope, autorotation practice. looks scary, is routine'],
    ['joker', 'HeliSpin HeliSpin HeliSpin'],
    ['local', 'one just did a hover check right over the field'],
    ['mod', 'Alumni crew is in here tonight o7'],
  ],
  air: [
    [
      'pilot',
      'those racetracks are holding patterns, controllers stack arrivals',
    ],
    ['local', 'watching from the fence, one every couple minutes'],
    ['skeptic', 'not a record day, {m0} is high but normal peak'],
    ['atc', 'they just switched runways, that’s why the holds'],
    ['joker', 'plane spotters are the original live chat'],
    [
      'photo',
      'sealed a clip with the approach lights in frame',
      { evidence: 1.4 },
    ],
  ],
  default: [
    ['local', 'here now, what I see matches the map'],
    ['newbie', 'is this normal for this time of day?'],
    ['skeptic', '{m0} is within the usual range, don’t overread it'],
    ['joker', 'chat is the real content'],
  ],
};

/** Burst lines: short, loud, many people at once. */
const BURST = {
  circling: [
    'THEY’RE MOVING',
    'one of them just climbed higher',
    'ESU on the roof now',
    'EyesUp EyesUp',
    'banner is out!!',
    'HeliSpin',
    'oh no oh no',
    'that’s so high',
    'did you see that',
    'they waved',
  ],
  cyclone: [
    'eye clearing!!',
    'StormMode',
    'new IR frame is insane',
    'that gust',
    'whoa',
    'pressure dropping again?',
  ],
  storm: [
    'THAT FLASH',
    'StormMode',
    'lightning right over us',
    'whoa',
    'power just blinked',
    'that one shook the windows',
  ],
  quake: [
    'AFTERSHOCK',
    'felt that',
    'here too',
    'whoa',
    'that was bigger',
    'everyone ok?',
  ],
  fire: [
    'new hotspot!',
    'wind shifted',
    'whoa',
    'that plume',
    'eyes on the ridge EyesUp',
  ],
  squawk: [
    'ON FINAL',
    'gear down',
    'touchdown?',
    'they’re down!!',
    'o7',
    'o7 crew',
  ],
  gnss: ['new cell lit up', 'whoa', 'spreading north'],
  orbit: [
    'THERE IT IS',
    'EyesUp EyesUp',
    'so bright',
    'o7 ISS',
    'saw it!!',
    'wow',
  ],
  launch: [
    'LiftOff',
    'LIFTOFF',
    'go go go',
    'LiftOff LiftOff',
    'max q',
    'beautiful',
  ],
  eye: [
    'crowd surge',
    'whoa',
    'here comes the parade',
    'EyesUp',
    'look at the corner',
  ],
  sea: ['convoy moving', 'here they go', 'whoa'],
  heli: ['autorotation!', 'HeliSpin', 'nice flare', 'o7'],
  air: ['go around!', 'whoa', 'heavy on final', 'nice landing'],
  default: ['whoa', 'did you see that', 'EyesUp', 'wow'],
};

/** Reaction mix per genre (weights for heart, fire, eyes, wow). */
const MIX = {
  circling: [3, 1, 5, 4],
  cyclone: [3, 2, 3, 3],
  storm: [2, 4, 2, 4],
  quake: [4, 0, 3, 2],
  fire: [3, 4, 2, 1],
  squawk: [6, 0, 4, 1],
  gnss: [1, 1, 4, 2],
  orbit: [5, 1, 3, 5],
  launch: [3, 6, 2, 5],
  eye: [4, 2, 4, 2],
  sea: [2, 1, 3, 2],
  heli: [3, 2, 3, 3],
  air: [3, 1, 3, 2],
  default: [3, 1, 3, 2],
};
export function reactionKind(genre, rand = Math.random) {
  const w = MIX[genre] || MIX.default;
  const kinds = ['heart', 'fire', 'eyes', 'wow'];
  let x = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 4; i += 1) {
    x -= w[i];
    if (x <= 0) return kinds[i];
  }
  return 'heart';
}

/* ---------------- Replies to the person ---------------- */

const REPLIES = [
  {
    re: /\b(hi|hey|hello|yo|sup|first)\b/i,
    lines: [
      ['local', 'welcome {user} o7'],
      [
        'mod',
        'Welcome {user}. Live is fast, the Record is where evidence goes.',
      ],
      ['newbie', 'hey {user}'],
    ],
  },
  {
    re: /\b(fake|real|hoax|cgi|staged|lie|lying)\b/i,
    lines: [
      [
        'skeptic',
        '{user} fair question. sealed captures only, check the Record lane',
      ],
      [
        'mod',
        '{user} If you think something is wrong, post a Correction in the Record. Corroborated corrections raise your Signal.',
      ],
      ['local', '{user} i’m literally here lol'],
    ],
  },
  {
    re: /\b(safe|danger|ok|okay|scared|worried|evacuat)/i,
    lines: [
      [
        'medic',
        '{user} follow local officials for safety calls, chat can’t see your street',
      ],
      [
        'mod',
        '{user} Nothing in this room is an alert. If you’re close, local channels first.',
      ],
    ],
  },
  {
    re: /\b(seal|sealed|capture|photo|pic|video|clip)\b/i,
    lines: [
      ['photo', '{user} SealIt pls, the room needs eyes from the ground'],
      [
        'local',
        '{user} there’s a Need eyes pin near the scene if you’re close',
      ],
    ],
  },
  {
    re: /\b(heli|helicopter|chopper|rotor)/i,
    lines: [
      [
        'pilot',
        '{user} rotorcraft orbiting low and slow, the track lens shows the circles clearly',
      ],
      ['scanner', '{user} one of them is police, the others are news'],
    ],
  },
  {
    re: /\b(iss|satellite|starlink|orbit)\b/i,
    lines: [
      [
        'orbit',
        '{user} if it doesn’t blink and moves steady, that’s a satellite',
      ],
    ],
  },
  {
    re: /\b(rain|flood|storm|lightning|wind|thunder)\b/i,
    lines: [
      [
        'wx',
        '{user} radar lens shows the core, the lightning dots are the last 15 min',
      ],
      ['local', '{user} it’s really coming down here'],
    ],
  },
  {
    re: /\b(where|location|place|address)\b/i,
    lines: [
      ['local', '{user} {place}, tap the room title for the map'],
      [
        'mod',
        '{user} Exact spots of people stay private. The situation pin is on the globe.',
      ],
    ],
  },
  {
    re: /\b(lol|lmao|haha|rofl|💀)\b/i,
    lines: [
      ['joker', '{user} LMAO'],
      ['joker', '{user} chat is undefeated'],
    ],
  },
  {
    re: /\b(how many|how much|number|count|stats?)\b/i,
    lines: [
      ['wx', '{user} brief says {m0}{sep1}{m1}'],
      [
        'skeptic',
        '{user} numbers are in the Brief with their source and age, chat rounds things',
      ],
    ],
  },
  {
    re: /\?$/,
    lines: [
      ['local', '{user} good q, nobody’s confirmed yet'],
      [
        'skeptic',
        '{user} post it as a Question in the Record, they float until answered',
      ],
      [
        'mod',
        '{user} Questions in the Record stay pinned until someone answers with evidence.',
      ],
    ],
  },
];
const GENERIC_REPLY = [
  ['local', '{user} yeah'],
  ['newbie', '{user} same'],
  ['joker', '{user} real'],
  ['local', '{user} 100%'],
  ['skeptic', '{user} source?'],
];

/* ---------------- The simulator ---------------- */

let seq = 0;
export function makeMsg(persona, text, extra = {}) {
  const tier = simTier(persona.handle, persona.floor || 0);
  return {
    id: `sim-${Date.now().toString(36)}-${(seq += 1)}`,
    handle: persona.handle,
    text,
    at: Date.now(),
    sim: true,
    mod: !!persona.mod,
    domain: persona.domain || null,
    local: !!persona.local,
    tier,
    ...extra,
  };
}

function pick(list, rand = Math.random) {
  return list[Math.floor(rand() * list.length)];
}
function personaFor(role, rand) {
  if (role === 'atc') return { ...PERSONAS.pilot[2], role };
  const list = PERSONAS[role] || PERSONAS.newbie;
  return { ...pick(list, rand), role };
}

/**
 * @param {object} s situation
 * @param {{ onMessage(msg), onReactions?(kind, n, burst), viewers?: number,
 *   me?: () => string, rand?: () => number }} o
 */
export function createChatSim(s, o) {
  const rand = o.rand || Math.random;
  const genre = chatGenre(s);
  const V = vars(s);
  const pool = [...(POOLS[genre] || POOLS.default), ...COMMON];
  const used = new Set();
  let timer = 0;
  let burstUntil = 0;
  let nextBurst = Date.now() + 9000 + rand() * 12000;
  let running = false;
  let viewers = o.viewers || viewerCount(s);
  const witnessHandles = new Set(); // sim chatters with sealed captures nearby

  function line() {
    // Prefer unused lines; recycle once the pool is spent.
    let cand = pool.filter((_, i) => !used.has(i));
    if (cand.length < 3) {
      used.clear();
      cand = pool;
    }
    for (let tries = 0; tries < 6; tries += 1) {
      const idx = Math.floor(rand() * pool.length);
      if (used.has(idx) && tries < 5) continue;
      const [role, t, meta] = pool[idx];
      const text = fill(t, V);
      if (!text) {
        used.add(idx);
        continue;
      }
      used.add(idx);
      const p = personaFor(role, rand);
      const extra = {};
      if (meta && meta.evidence != null) {
        extra.evidence = { sealed: true, km: meta.evidence, example: true };
        witnessHandles.add(p.handle);
      }
      if (witnessHandles.has(p.handle)) extra.witness = true;
      return makeMsg(p, text, extra);
    }
    return null;
  }

  function greet() {
    const w = worldPoint(rand);
    const p = personaFor(pick(['newbie', 'local', 'joker', 'newbie']), rand);
    // Greeters are from elsewhere: never mark them local.
    return makeMsg(
      { ...p, local: false },
      fill(pick(GREET, rand), V, { city: w.city }),
      {
        from: w,
      },
    );
  }

  function burstLine() {
    const list = BURST[genre] || BURST.default;
    const p = personaFor(
      pick(['newbie', 'local', 'joker', 'photo', 'newbie', 'local'], rand),
      rand,
    );
    let text = pick(list, rand);
    if (rand() < 0.25) text = text.toUpperCase();
    return makeMsg(
      p,
      text,
      witnessHandles.has(p.handle) ? { witness: true } : {},
    );
  }

  function tick() {
    if (!running) return;
    const now = Date.now();
    if (now > nextBurst) {
      burstUntil = now + 3200 + rand() * 2500;
      nextBurst = now + 22000 + rand() * 26000;
      o.onBurst?.(genre);
    }
    const bursting = now < burstUntil;
    // Messages per second scales gently with viewers; bursts ×4.
    const base = Math.min(2.4, Math.max(0.35, viewers / 1400));
    const rate = bursting ? base * 4 + 1.5 : base;
    const r = rand();
    const msg = bursting
      ? r < 0.75
        ? burstLine()
        : line()
      : r < 0.14
        ? greet()
        : line();
    if (msg) o.onMessage(msg);
    // Reactions from the crowd, in proportion to viewers.
    if (o.onReactions) {
      const n = Math.max(
        0,
        Math.round((viewers / 900) * (bursting ? 6 : 1) * (0.4 + rand())),
      );
      if (n) o.onReactions(reactionKind(genre, rand), n, bursting);
    }
    // Viewer count random walk, ±2 %.
    viewers = Math.max(12, Math.round(viewers * (1 + (rand() - 0.48) * 0.02)));
    o.onViewers?.(viewers);
    const gap = (1000 / rate) * (0.35 + rand() * 1.3);
    timer = setTimeout(tick, gap);
  }

  /** Someone (the person) said something: a few sim people answer. */
  function hear(text, handle) {
    const t = String(text || '');
    const rule = REPLIES.find((r) => r.re.test(t));
    const lines = rule ? rule.lines : GENERIC_REPLY;
    const n = rule ? 1 + (rand() < 0.45 ? 1 : 0) : rand() < 0.55 ? 1 : 0;
    const chosen = [...lines].sort(() => rand() - 0.5).slice(0, n);
    chosen.forEach(([role, tpl], i) => {
      const txt = fill(tpl, V, {
        user: handle,
        sep1: V.m1 ? ' and ' : '',
      });
      if (!txt) return;
      setTimeout(
        () =>
          running &&
          o.onMessage(
            makeMsg(personaFor(role, rand), txt, { replyTo: handle }),
          ),
        1400 + i * 1700 + rand() * 1600,
      );
    });
    // A mention of evidence draws corroborating eyes.
    return chosen.length;
  }

  return {
    genre,
    start() {
      if (running) return;
      running = true;
      // Backfill a little history so the lane is never empty.
      const back = [];
      for (let i = 0; i < 14; i += 1) {
        const m = i % 5 === 2 ? greet() : line();
        if (m) {
          m.at = Date.now() - (14 - i) * (2500 + rand() * 4000);
          back.push(m);
        }
      }
      o.onBackfill?.(back);
      timer = setTimeout(tick, 600);
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    hear,
    burst() {
      nextBurst = 0;
    },
    get viewers() {
      return viewers;
    },
    set viewers(v) {
      viewers = v;
    },
    get running() {
      return running;
    },
  };
}

/** A stable, plausible viewer count for a situation. */
export function viewerCount(s) {
  if (!s) return 0;
  const h = hashStr(s.id);
  const g = chatGenre(s);
  const base =
    {
      circling: 4800,
      cyclone: 2600,
      launch: 3900,
      squawk: 1800,
      storm: 1300,
      quake: 1500,
      orbit: 1100,
      eye: 640,
      fire: 900,
    }[g] || 380;
  return Math.round(base * (0.75 + (h % 500) / 1000) + (s.severity || 0) * 120);
}

/**
 * A Moment's chat on its own clock. Uses moment.chat when the engine
 * provides it; otherwise writes one from the genre pool across the window.
 * @returns {{ t:number, handle, text, badge?, sim:true }[]}
 */
export function momentChat(m) {
  if (Array.isArray(m?.chat) && m.chat.length)
    return m.chat
      .map((c) => ({ ...c, id: c.id || `${c.t}|${c.handle}`, sim: true }))
      .sort((a, b) => a.t - b.t);
  const start = +m?.time?.start || Date.now() - 20 * 60e3;
  const end = +m?.time?.end || Date.now();
  const s = {
    id: m?.id || 'moment',
    kind: 'circling',
    title: m?.title,
    place: m?.place,
    momentId: m?.id,
  };
  let r = hashStr(s.id);
  const rand = () => {
    r =
      Math.imul(r ^ (r >>> 15), 2246822507) ^
      Math.imul(r ^ (r >>> 13), 3266489909);
    return ((r ^= r >>> 16) >>> 0) / 4294967296;
  };
  const out = [];
  const pool = POOLS.circling;
  const V = vars(s);
  const n = Math.min(80, Math.max(24, Math.round((end - start) / 15000)));
  for (let i = 0; i < n; i += 1) {
    const t = start + ((i + rand() * 0.8) / n) * (end - start);
    const [role, tpl, meta] =
      i % 7 === 3 ? ['newbie', pick(BURST.circling, rand)] : pick(pool, rand);
    const p = personaFor(role, rand);
    const text = fill(tpl, V) || tpl;
    out.push({
      id: `mc-${s.id}-${i}`,
      t,
      handle: p.handle,
      text,
      badge: p.mod ? 'mod' : meta?.evidence != null ? 'witness' : undefined,
      sim: true,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

export { fmtKm };

/** A few representative lines for a room preview (Rooms tab ticker). */
export function sampleLines(s, n = 6) {
  const V = vars(s);
  const pool = POOLS[chatGenre(s)] || POOLS.default;
  let r = hashStr(s.id);
  const rand = () => {
    r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
    return r / 4294967296;
  };
  const out = [];
  const idx = pool.map((_, i) => i).sort(() => rand() - 0.5);
  for (const i of idx) {
    const [role, t, meta] = pool[i];
    const text = fill(t, V);
    if (!text) continue;
    const p = personaFor(role, rand);
    out.push(
      makeMsg(
        p,
        text,
        meta?.evidence != null
          ? { evidence: { sealed: true, km: meta.evidence } }
          : {},
      ),
    );
    if (out.length >= n) break;
  }
  return out;
}
