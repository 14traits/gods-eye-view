/**
 * Rooms (DESIGN.md §11.3): every situation has a room where the conversation
 * sits on the evidence. Structured posts, earned badges, evidence-first
 * ordering, community notes with a visible bridging rule, and a local,
 * deterministic Known / Disputed / Unknown synthesis that cites every line.
 *
 * Seeded posts are EXAMPLES: fictional handles, written to show the format.
 * They only quote numbers from the situation's live data. The person's own
 * posts are real, persisted in IndexedDB and broadcast to other tabs.
 */

import { emitter, fmtNum, ago } from './dom.js';
import { all, put, get } from '../capture/db.js';
import { canonical, sha256Hex } from '../capture/provenance.js';
import {
  distKm,
  fmtKm,
  presenceRadiusKm,
  headlineOf,
  cardinal,
  utc,
} from './bands.js';

export const KINDS = [
  {
    id: 'witness',
    name: 'Witness',
    icon: 'witness',
    hint: 'I saw or recorded this',
  },
  {
    id: 'context',
    name: 'Context',
    icon: 'context',
    hint: 'Background, a link, a map',
  },
  {
    id: 'question',
    name: 'Question',
    icon: 'question',
    hint: 'What the sensors can’t tell',
  },
  {
    id: 'correction',
    name: 'Correction',
    icon: 'correction',
    hint: 'Something here is wrong',
  },
  {
    id: 'prediction',
    name: 'Prediction',
    icon: 'prediction',
    hint: 'What happens next, on the record',
  },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));

/** Fictional example participants. Clusters drive the bridging simulation. */
const EX = [
  { handle: '@harborpilot.example', cluster: 'A', domain: 'Mariner' },
  { handle: '@metdesk.example', cluster: 'B', domain: 'Met' },
  { handle: '@firstofficer.example', cluster: 'A', domain: 'Pilot' },
  { handle: '@nightmedic.example', cluster: 'B', domain: 'First responder' },
  { handle: '@riverside.example', cluster: 'A', local: true },
  { handle: '@skeptic.example', cluster: 'B' },
  { handle: '@orbitwatch.example', cluster: 'A' },
  { handle: '@lena.example', cluster: 'B', local: true },
  { handle: '@datadesk.example', cluster: 'A' },
];
const [HARBOR, MET, PILOT, MEDIC, RIVER, SKEPTIC, ORBIT, LENA, DATA] = EX;

/* ---------------- Example seeds, per genre ---------------- */

/**
 * Each template: k kind, a author, m minutes before the situation's update,
 * text(s, v) → string, w was-there, sl sealed, re reply-to index,
 * note {text, r: 'AA+B+…'}, up/dn votes, an anchor offset {dLat,dLon}.
 */
export function genre(s) {
  const k = `${s.kind || ''} ${s.archetype || ''}`;
  if (s.momentId || /circling|moment/.test(k)) return 'circling';
  if (/cyclone|typhoon|hurricane/.test(k)) return 'cyclone';
  if (/quake/.test(k)) return 'quake';
  if (/fire/.test(k)) return 'fire';
  if (/lightning|rain|storm|radar/.test(k)) return 'storm';
  if (/squawk/.test(k)) return 'squawk';
  if (/gnss|jam/.test(k)) return 'gnss';
  if (/iss|launch|pass|aurora|orbit/.test(k)) return 'orbit';
  if (/camera|cctv|eye/.test(k)) return 'eye';
  if (/queue|strait|port|ship|vessel/.test(k)) return 'sea';
  if (/heli|airport|military|jet|flight/.test(k)) return 'air';
  if (/reconstruction/.test(k)) return 'recon';
  return 'default';
}

const T = {
  circling: [
    {
      k: 'witness',
      a: RIVER,
      m: 16,
      w: 1,
      sl: 1,
      up: 47,
      dn: 2,
      d: [0.002, -0.003],
      text: (s, v) =>
        `${v(0) ? `${v(0)} overhead` : 'Helicopters overhead'} for about fifteen minutes now. Two are holding high and steady, one is lower and tighter with a searchlight. Sealed clip from street level, looking up.`,
      note: {
        text: 'The clip’s heading points at the orbit centre and its seal time falls inside the detection window. ADS-B shows the same three tracks.',
        r: 'A+A+A+B+B+',
      },
    },
    {
      k: 'question',
      a: LENA,
      m: 13,
      up: 22,
      text: () =>
        'Does anyone know why they’re circling? Nothing on local news yet and the street is blocked at the corner.',
    },
    {
      k: 'context',
      a: PILOT,
      m: 11,
      re: 1,
      up: 39,
      text: () =>
        'The low one is flying a tight left-hand orbit, which is what police aviation does over a scene. The two higher ones at about 1,500 ft are holding still for camera shots. That pattern means something on the ground, not an aircraft in trouble.',
      note: {
        text: 'Consistent with the tracks: one orbit at ~400 m radius and ~1,000 ft, two at ~650 m and ~1,500 ft.',
        r: 'A+A+B+B+B+',
      },
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 8,
      up: 26,
      dn: 4,
      text: () =>
        'A post going around says it’s a shooting. Nothing in this room supports that, and the “scanner audio” people are quoting has no source. Wait for a sealed capture or an official statement.',
      note: {
        text: 'No sealed capture or official source here mentions a shooting.',
        r: 'A+A+B+B+',
      },
    },
    {
      k: 'prediction',
      a: DATA,
      m: 4,
      up: 9,
      dn: 3,
      text: () =>
        'The news helicopters leave within thirty minutes of police clearing the scene; the police one stays longest.',
    },
  ],
  cyclone: [
    {
      k: 'witness',
      a: LENA,
      m: 52,
      w: 1,
      sl: 1,
      up: 31,
      dn: 2,
      d: [0.9, -0.6],
      text: () =>
        'Outer rain bands reached the waterfront about an hour ago. Gusts are moving the plastic chairs on the pier. Sealed clip attached.',
      note: {
        text: 'The clip’s seal places it inside the outer bands, consistent with the post. The timestamp agrees with the satellite loop.',
        r: 'A+A+A+B+B+B-',
      },
    },
    {
      k: 'question',
      a: RIVER,
      m: 40,
      up: 12,
      text: (s, v) =>
        `Is the eyewall replacement finished? The brief still shows ${v('Pressure') || v(1) || 'the same pressure'}.`,
    },
    {
      k: 'context',
      a: MET,
      m: 33,
      re: 1,
      up: 24,
      text: () =>
        'During an eyewall replacement the wind field broadens: the peak can dip while the area of strong wind grows. Watch the wind radii, not only the peak.',
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 21,
      up: 18,
      dn: 6,
      text: (s, v) =>
        `Posts elsewhere call this a Category 5. The sustained wind in this room’s sensor data is ${v('Wind') || v(0)}. Check the scale before resharing.`,
      note: {
        text: 'Category is set by 1-minute sustained wind; the figure quoted is the agency estimate in the brief.',
        r: 'A+A+B+',
      },
    },
    {
      k: 'prediction',
      a: DATA,
      m: 9,
      up: 7,
      dn: 4,
      text: () =>
        'Landfall slips three to six hours later than the current forecast pip. The cone has widened two runs in a row.',
    },
  ],
  quake: [
    {
      k: 'witness',
      a: LENA,
      m: 600,
      w: 1,
      sl: 1,
      up: 44,
      dn: 1,
      d: [0.4, -0.5],
      text: () =>
        'A long rolling motion, maybe twenty seconds, sixth floor. Glasses rattled, nothing fell. Sealed video from the hallway.',
    },
    {
      k: 'question',
      a: RIVER,
      m: 590,
      up: 30,
      text: () =>
        'Is there a tsunami advisory for the coast? Nothing on the local channel yet.',
    },
    {
      k: 'context',
      a: DATA,
      m: 560,
      re: 1,
      up: 21,
      text: (s, v) =>
        `Advisories come from the national warning centre, not from this feed. The sensor data here shows depth ${v('Depth') || 'in the brief'}; shallow offshore events are the ones that get watched.`,
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 400,
      up: 15,
      dn: 3,
      text: () =>
        'Early automatic solutions often use a placeholder depth of 10 km. Quote the reviewed depth, not the first one.',
      note: {
        text: 'Correct: many first solutions fix depth at 10 km until reviewed.',
        r: 'A+A+B+B+',
      },
    },
    {
      k: 'prediction',
      a: MET,
      m: 120,
      up: 9,
      dn: 2,
      text: (s, v) =>
        `The aftershock count (${v('Aftershocks') || 'in the brief'}) roughly halves each day for the next week.`,
    },
  ],
  fire: [
    {
      k: 'witness',
      a: RIVER,
      m: 70,
      w: 1,
      sl: 1,
      up: 38,
      dn: 3,
      d: [0.12, 0.25],
      text: () =>
        'Ash on the cars this morning and the sky is orange to the east. Sealed photo from the ridge road.',
      note: {
        text: 'The photo’s heading points east-north-east, toward the hotspot cluster, at the sealed time.',
        r: 'A+A+B+B+B+',
      },
    },
    {
      k: 'question',
      a: LENA,
      m: 55,
      up: 26,
      text: () =>
        'Which way is the smoke heading tonight? Deciding whether to close the windows at the school.',
    },
    {
      k: 'context',
      a: DATA,
      m: 47,
      up: 33,
      text: (s, v) =>
        `Each satellite hotspot is a pixel about 375 m across, so ${v('Hotspots') || v(0)} hotspots is not that many separate fires.`,
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 30,
      up: 11,
      dn: 9,
      text: () =>
        'A post elsewhere says the fire jumped the river. The perimeter layer in this room does not show that yet.',
      note: {
        text: 'Perimeters update a few times a day; absence here is not proof either way.',
        r: 'A+A-B+',
      },
    },
    {
      k: 'prediction',
      a: MEDIC,
      m: 12,
      up: 8,
      text: () =>
        'Hotspot count peaks mid-afternoon as humidity drops, then falls after sunset.',
    },
  ],
  storm: [
    {
      k: 'witness',
      a: LENA,
      m: 25,
      w: 1,
      sl: 1,
      up: 27,
      d: [0.15, -0.2],
      text: () =>
        'Constant flashes to the south and thunder every few seconds. Street gutters already overflowing. Sealed clip.',
    },
    {
      k: 'question',
      a: RIVER,
      m: 22,
      up: 19,
      text: () =>
        'Is the line strengthening or weakening? Trying to decide whether to drive home now.',
    },
    {
      k: 'context',
      a: MET,
      m: 16,
      re: 1,
      up: 28,
      text: (s, v) =>
        `Watch the core, not the count: ${v(0)} tells you how much is happening, the radar core tells you where it is going. This one is moving with the line.`,
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 11,
      up: 9,
      dn: 2,
      text: () =>
        'The flood photo going around is from a different city. Reverse image search finds it years earlier.',
      note: {
        text: 'Matches an older photo; nobody here has posted a sealed capture of it.',
        r: 'A+A+B+B+',
      },
    },
    {
      k: 'prediction',
      a: DATA,
      m: 6,
      up: 5,
      dn: 3,
      text: () => 'The strongest cells clear the coast within ninety minutes.',
    },
  ],
  squawk: [
    {
      k: 'context',
      a: PILOT,
      m: 14,
      up: 41,
      text: () =>
        '7700 is a general emergency code. Crews use it for medical diversions and technical problems too. It does not by itself mean the aircraft is in danger.',
      note: {
        text: 'Accurate summary of the transponder code meanings.',
        r: 'A+A+A+B+B+',
      },
    },
    {
      k: 'question',
      a: RIVER,
      m: 12,
      up: 22,
      text: () =>
        'Where are they diverting to? The track turned north a few minutes ago.',
    },
    {
      k: 'witness',
      a: LENA,
      m: 9,
      w: 1,
      sl: 1,
      up: 15,
      d: [0.08, 0.1],
      text: () =>
        'Heard it low over the harbour with gear down, sounded normal. Sealed clip, heading north-west.',
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 6,
      up: 13,
      dn: 1,
      text: () =>
        'It’s not a hijack. That would be 7500. Please stop reposting the hijack claim.',
    },
    {
      k: 'prediction',
      a: DATA,
      m: 3,
      up: 6,
      dn: 1,
      text: () =>
        'They land within twenty-five minutes at the nearest suitable airport.',
    },
  ],
  gnss: [
    {
      k: 'witness',
      a: PILOT,
      m: 80,
      w: 1,
      up: 36,
      text: () =>
        'Navigation integrity dropped over the area on the way in; we flew on inertial for about twenty minutes.',
    },
    {
      k: 'question',
      a: LENA,
      m: 60,
      up: 14,
      text: () => 'Does this affect phones on the ground, or only aircraft?',
    },
    {
      k: 'context',
      a: DATA,
      m: 50,
      re: 1,
      up: 25,
      text: (s, v) =>
        `This layer is built from what aircraft broadcast about their own navigation accuracy. ${v(0)} affected means aircraft reporting it, not phones.`,
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 30,
      up: 10,
      dn: 7,
      text: () =>
        'Calling every degraded report “jamming” overstates it. Some are equipment faults.',
      note: {
        text: 'Plausible, but the spatial clustering here argues against random faults.',
        r: 'A+A-B+B-',
      },
    },
    {
      k: 'prediction',
      a: HARBOR,
      m: 20,
      up: 4,
      dn: 2,
      text: () =>
        'Ships transiting tonight report the same pattern near the coast.',
    },
  ],
  orbit: [
    {
      k: 'witness',
      a: ORBIT,
      m: 90,
      w: 1,
      sl: 1,
      up: 29,
      d: [0.3, 0.2],
      text: () =>
        'Saw it from the roof last night: brighter than anything else up there, horizon to horizon in about four minutes. Sealed photo, 6 s exposure.',
    },
    {
      k: 'question',
      a: LENA,
      m: 50,
      up: 17,
      text: () =>
        'Will the clouds clear in time? It’s overcast here right now.',
    },
    {
      k: 'context',
      a: ORBIT,
      m: 44,
      re: 1,
      up: 21,
      text: () =>
        'You only see a pass when the station is sunlit and you are in darkness, which is why good passes cluster after dusk and before dawn.',
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 30,
      up: 8,
      dn: 2,
      text: (s, v) =>
        `The viral clip of a “fireball” is a reentry from last year. This room’s data shows ${v(0)}.`,
      note: {
        text: 'Needs a source for the reentry date before it can show.',
        r: 'A+B-',
      },
    },
    {
      k: 'prediction',
      a: MET,
      m: 15,
      up: 6,
      dn: 1,
      text: () =>
        'A clear gap opens about half an hour before the pass, per the satellite loop.',
    },
  ],
  eye: [
    {
      k: 'witness',
      a: RIVER,
      m: 8,
      w: 1,
      sl: 1,
      up: 19,
      d: [0.0006, 0.0008],
      text: () =>
        'Walking past now. It’s busier than the frame suggests; there’s a line out the door at the corner. Sealed photo from across the street.',
      note: {
        text: 'Sealed position is about 80 m from the camera, facing it. Consistent.',
        r: 'A+A+B+B+',
      },
    },
    {
      k: 'question',
      a: LENA,
      m: 6,
      up: 11,
      text: () => 'Is the lane closure still on? Can’t tell from this angle.',
    },
    {
      k: 'context',
      a: DATA,
      m: 5,
      up: 14,
      text: (s) =>
        `This camera refreshes every ${Math.round((s.media?.refreshMs || 15000) / 1000)} s and looks ${cardinal(s.media?.headingDeg) || 'along the street'}. The time burned into the frame is local.`,
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 4,
      up: 6,
      dn: 1,
      text: (s) =>
        `It faces ${cardinal(s.media?.headingDeg) || 'down the street'}, not north. The “crowd heading to the square” is walking away from it.`,
    },
    {
      k: 'prediction',
      a: MEDIC,
      m: 2,
      up: 3,
      dn: 1,
      text: () => 'Busiest in about an hour, when the venue lets out.',
    },
  ],
  sea: [
    {
      k: 'witness',
      a: HARBOR,
      m: 120,
      w: 1,
      sl: 1,
      up: 33,
      d: [0.05, -0.04],
      text: () =>
        'Anchored in the waiting area since this morning. Told to hold another twelve hours. Sealed photo from the bridge wing.',
    },
    {
      k: 'question',
      a: LENA,
      m: 90,
      up: 12,
      text: () => 'Is the queue caused by weather or by scheduling?',
    },
    {
      k: 'context',
      a: HARBOR,
      m: 70,
      re: 1,
      up: 27,
      text: (s, v) =>
        `Mostly scheduling: convoys run at set times. ${v(0)} waiting is high but not unusual after a weather hold.`,
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 40,
      up: 9,
      dn: 3,
      text: () =>
        'Some of the “waiting” ships are bunkering, not queuing. The count overstates the backlog.',
      note: {
        text: 'Correct for some vessels; the anchorage also serves bunkering.',
        r: 'A+A+B+B+B-',
      },
    },
    {
      k: 'prediction',
      a: DATA,
      m: 20,
      up: 5,
      dn: 2,
      text: () => 'The queue is back under thirty by tomorrow night.',
    },
  ],
  air: [
    {
      k: 'witness',
      a: RIVER,
      m: 30,
      w: 1,
      sl: 1,
      up: 18,
      d: [0.02, 0.03],
      text: () =>
        'Watching from the fence: steady stream, one every couple of minutes. Sealed clip with the approach light row in frame.',
    },
    {
      k: 'question',
      a: LENA,
      m: 22,
      up: 9,
      text: () => 'Why are some of them circling instead of landing?',
    },
    {
      k: 'context',
      a: PILOT,
      m: 18,
      re: 1,
      up: 24,
      text: () =>
        'Those are holding patterns: controllers stack arrivals when the runway rate drops. A few holds at a busy hub is normal.',
      note: {
        text: 'Accurate. Holds appear as racetracks on the track layer.',
        r: 'A+A+B+B+',
      },
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 10,
      up: 5,
      dn: 2,
      text: (s, v) =>
        `This isn’t a record day: ${v(0)} is high but within the normal peak.`,
    },
    {
      k: 'prediction',
      a: DATA,
      m: 5,
      up: 4,
      dn: 2,
      text: () => 'The bank clears within forty minutes.',
    },
  ],
  recon: [
    {
      k: 'context',
      a: DATA,
      m: 300,
      up: 22,
      text: () =>
        'The corridor is a published centreline, not a modelled arrival time. Read the narrative as a schematic.',
    },
    {
      k: 'question',
      a: LENA,
      m: 200,
      up: 14,
      text: () =>
        'Which of the witness clips can actually be placed on the north bank?',
    },
    {
      k: 'witness',
      a: RIVER,
      m: 150,
      w: 1,
      up: 9,
      text: () =>
        'Walked the road last month. The bridge abutment in the clip matches the upstream crossing.',
    },
    {
      k: 'correction',
      a: SKEPTIC,
      m: 90,
      up: 7,
      dn: 3,
      text: () =>
        'Five map placements in one cluster are not five independent timings.',
      note: {
        text: 'Agrees with the hypothesis ledger’s treatment of that cluster.',
        r: 'A+A+B+B+',
      },
    },
  ],
  default: [
    {
      k: 'witness',
      a: RIVER,
      m: 40,
      w: 1,
      sl: 1,
      up: 15,
      d: [0.05, 0.05],
      text: () =>
        'Here now. What I can see matches the sensor picture. Sealed photo attached.',
    },
    {
      k: 'question',
      a: LENA,
      m: 30,
      up: 9,
      text: () => 'Is this normal for the time of day, or unusual?',
    },
    {
      k: 'context',
      a: DATA,
      m: 20,
      re: 1,
      up: 12,
      text: (s, v) =>
        `${v(0) ? `${v(0)} is` : 'This is'} within the usual range for this place at this hour.`,
    },
    {
      k: 'prediction',
      a: MET,
      m: 8,
      up: 3,
      dn: 1,
      text: () => 'Back to baseline by tomorrow.',
    },
  ],
};

function metricText(s) {
  const ms = s.metrics || [];
  const fmt = (m) =>
    m
      ? `${typeof m.value === 'number' ? fmtNum(m.value, m.value % 1 ? 1 : 0) : m.value}${m.unit ? ` ${m.unit}` : ''}`
      : '';
  return (key) => {
    if (typeof key === 'number') return fmt(ms[key]);
    return fmt(
      ms.find((m) =>
        String(m.label).toLowerCase().startsWith(String(key).toLowerCase()),
      ),
    );
  };
}

/** Posts a Moment ships with (engine `moment.posts`), as example seeds. */
function momentSeeds(s) {
  const caps = s.momentCaptures || [];
  return s.momentPosts.map((mp, i) => {
    const at = Number(mp.t) || Date.now();
    const cap = caps.find((c) => c.handle === mp.handle);
    const there = mp.kind === 'witness' && !!cap;
    const votes = mp.votes || {};
    return {
      id: `${s.id}~mp${i + 1}`,
      room: String(s.id),
      kind: KIND[mp.kind] ? mp.kind : 'context',
      text: String(mp.text || ''),
      at,
      author: { handle: mp.handle, example: true, cluster: i % 2 ? 'B' : 'A' },
      example: true,
      evidence: {
        wasThere: there,
        sealed: there || !!cap?.sealed,
        example: true,
        distanceKm: cap ? 0.3 : null,
      },
      votes: {
        up: typeof votes === 'number' ? votes : votes.up || 0,
        dn: votes.dn || 0,
      },
      replyTo: null,
      anchor: cap
        ? { lat: cap.lat, lon: cap.lon, t: Number(cap.t) || at }
        : null,
      notes: [],
    };
  });
}

function seedPosts(s) {
  if (s.momentPosts?.length) return momentSeeds(s);
  const tpl = T[genre(s)] || T.default;
  const v = metricText(s);
  const base = Number(new Date(s.updatedAt)) || Date.now();
  const posts = tpl.map((t, i) => {
    const at = base - t.m * 60e3;
    const p = {
      id: `${s.id}~ex${i + 1}`,
      room: String(s.id),
      kind: t.k,
      text: t.text(s, v),
      at,
      author: { ...t.a, example: true },
      example: true,
      evidence: {
        wasThere: !!t.w,
        sealed: !!t.sl,
        example: true,
      },
      votes: { up: t.up || 0, dn: t.dn || 0 },
      replyTo: t.re != null ? `${s.id}~ex${t.re + 1}` : null,
      anchor: t.d
        ? { lat: s.lat + t.d[0], lon: s.lon + t.d[1], t: at }
        : t.k === 'witness'
          ? { lat: s.lat, lon: s.lon, t: at }
          : null,
      notes: t.note
        ? [
            {
              id: `${s.id}~ex${i + 1}~n1`,
              text: t.note.text,
              author: '@notewriter.example',
              ratings: (t.note.r.match(/[AB][+-]/g) || []).map((x, j) => ({
                rater: `r${j}`,
                cluster: x[0],
                helpful: x[1] === '+',
              })),
            },
          ]
        : [],
    };
    return p;
  });
  return posts;
}

/* ---------------- Badges, bridging, ordering ---------------- */

export function badgesFor(p, s, me) {
  const b = [];
  const ex = p.example;
  if (p.evidence?.wasThere)
    b.push({
      id: 'there',
      label: 'Was there',
      ex,
      detail:
        p.evidence.distanceKm != null
          ? `${fmtKm(p.evidence.distanceKm)} from it`
          : '',
    });
  if (p.evidence?.sealed)
    b.push({
      id: 'sealed',
      label: p.evidence.live ? 'Sealed live' : 'Sealed',
      ex,
    });
  if (p.evidence?.unverified)
    b.push({ id: 'unverified', label: 'Unverified', ex });
  if (
    p.author?.local ||
    (p.author?.self && me?.home && distKm(me.home, s) < 50)
  )
    b.push({ id: 'local', label: 'Local', ex });
  if (p.author?.domain) b.push({ id: 'domain', label: p.author.domain, ex });
  return b;
}

function evidenceScore(p) {
  const e = p.evidence || {};
  return (
    (e.wasThere ? 8 : 0) +
    (e.sealed ? 4 : 0) +
    (p.author?.domain ? 2 : 0) +
    (p.author?.local ? 1 : 0) -
    (e.unverified ? 1 : 0)
  );
}

/**
 * Bridging rule (after Community Notes): a note shows only when raters from
 * both clusters, who usually disagree, rate it helpful. Thresholds are shown
 * in the UI: ≥ 2 raters in each cluster and ≥ 60 % helpful in each.
 */
export const BRIDGE = { minPerCluster: 2, minHelpful: 0.6 };
export function noteStatus(note, mine) {
  const ratings = [...note.ratings, ...(mine ? [mine] : [])];
  const by = { A: { n: 0, h: 0 }, B: { n: 0, h: 0 } };
  for (const r of ratings) {
    const c = by[r.cluster];
    if (!c) continue;
    c.n += 1;
    if (r.helpful) c.h += 1;
  }
  const ok = (c) =>
    c.n >= BRIDGE.minPerCluster && c.h / c.n >= BRIDGE.minHelpful;
  let status = 'shown';
  if (!ok(by.A) || !ok(by.B)) {
    const lacking = ['A', 'B'].filter((k) => by[k].n < BRIDGE.minPerCluster);
    status = lacking.length ? `needs-${lacking.join('')}` : 'not-bridged';
  }
  return { status, by, shown: status === 'shown' };
}

/* ---------------- Synthesis (local, deterministic) ---------------- */

export async function synthesize(s, posts, numbering) {
  const known = [];
  const disputed = [];
  const unknown = [];
  const P = (p) => numbering.get(p.id);
  // Observations from the live data first.
  const obs = (s.metrics || []).slice(0, 3).map((m, i) => ({
    id: `O${i + 1}`,
    text: `${m.label}: ${typeof m.value === 'number' ? fmtNum(m.value, m.value % 1 ? 1 : 0) : m.value}${m.unit ? ` ${m.unit}` : ''}`,
  }));
  if (obs.length)
    known.push({
      text: `${obs.map((o) => o.text).join(' · ')} (${s.source || 'live feed'}, ${ago(s.updatedAt) || 'now'})`,
      cites: obs.map((o) => o.id),
    });
  if (s.media?.cameraId)
    known.push({
      text: `A public camera ${s.media.city ? `in ${s.media.city} ` : ''}is looking ${cardinal(s.media.headingDeg) || 'at the scene'}, refreshing every ${Math.round((s.media.refreshMs || 15000) / 1000)} s.`,
      cites: ['O-cam'],
    });
  const roots = posts.filter((p) => !p.replyTo);
  const replies = (p) => posts.filter((r) => r.replyTo === p.id);
  const sealedThere = posts.filter(
    (p) => p.kind === 'witness' && p.evidence?.sealed && p.evidence?.wasThere,
  );
  for (const p of roots) {
    if (p.kind === 'question') {
      const ans = replies(p).filter(
        (r) => r.kind === 'context' || r.kind === 'witness',
      );
      if (ans.length)
        known.push({
          text: `Answered: “${clip(p.text, 60)}” — ${clip(ans[0].text, 90)}`,
          cites: [P(p), ...ans.map(P)],
        });
      else
        unknown.push({
          text: `Open question: “${clip(p.text, 110)}”`,
          cites: [P(p)],
        });
      continue;
    }
    if (p.kind === 'prediction') {
      unknown.push({
        text: `Unresolved prediction: “${clip(p.text, 100)}”`,
        cites: [P(p)],
      });
      continue;
    }
    const corr = replies(p).filter((r) => r.kind === 'correction');
    const noteShown = (p.notes || []).find((n) => noteStatus(n).shown);
    const split =
      (p.votes?.dn || 0) /
        Math.max(1, (p.votes?.up || 0) + (p.votes?.dn || 0)) >
      0.35;
    if (p.kind === 'correction') {
      const n = (p.notes || []).find((x) => noteStatus(x).shown);
      (n ? known : disputed).push({
        text: n
          ? `Correction stands: “${clip(p.text, 100)}” (note bridged both clusters)`
          : `Correction offered, not yet bridged: “${clip(p.text, 100)}”`,
        cites: [P(p)],
      });
      continue;
    }
    if (corr.length || split)
      disputed.push({
        text: `“${clip(p.text, 90)}” ${corr.length ? `— challenged by ${corr.map(P).join(', ')}` : '— votes split'}`,
        cites: [P(p), ...corr.map(P)],
      });
    else if (p.kind === 'witness' && p.evidence?.sealed && p.evidence?.wasThere)
      known.push({
        text: `Sealed witness from the scene: “${clip(p.text, 90)}”${noteShown ? ' (note bridged)' : ''}`,
        cites: [P(p)],
      });
    else if (p.kind === 'context' && noteShown)
      known.push({
        text: `Context with a bridged note: “${clip(p.text, 90)}”`,
        cites: [P(p)],
      });
    else if (p.evidence?.unverified)
      disputed.push({
        text: `Unverified upload: “${clip(p.text, 90)}” — no capture-time seal`,
        cites: [P(p)],
      });
  }
  if (!sealedThere.length)
    unknown.push({
      text: `No sealed capture from within ${fmtKm(presenceRadiusKm(s))} yet. The best answer here is a photo from the scene.`,
      cites: obs.length ? [obs[0].id] : [],
    });
  const inputs = {
    s: s.id,
    updatedAt: s.updatedAt,
    posts: posts.map((p) => [p.id, p.kind, p.votes?.up || 0, p.votes?.dn || 0]),
  };
  const hash = await sha256Hex(canonical(inputs));
  // Never state anything without a citation.
  const cited = (l) => l.filter((x) => x.cites.filter(Boolean).length);
  return {
    known: cited(known),
    disputed: cited(disputed),
    unknown: cited(unknown),
    hash,
    n: posts.length,
    obs: obs.length,
    at: Date.now(),
    observations: obs,
  };
}

const clip = (t, n) => {
  const s = String(t || '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

/* ---------------- The store ---------------- */

export function createRooms({ rt }) {
  const ev = emitter();
  let mine = null; // Promise<Map room → posts>
  let kv = null;

  async function loadMine() {
    const list = await all('posts').catch(() => []);
    const m = new Map();
    for (const p of list) {
      if (!m.has(p.room)) m.set(p.room, []);
      m.get(p.room).push(p);
    }
    return m;
  }
  const mineMap = () => (mine = mine || loadMine());

  async function loadKv() {
    const rec = await get('kv', 'rooms').catch(() => null);
    return rec || { id: 'rooms', votes: {}, ratings: {}, reactions: {} };
  }
  const state = () => (kv = kv || loadKv());
  async function saveKv() {
    const s = await state();
    await put('kv', s).catch(() => {});
  }

  rt.on('post', async (p) => {
    const m = await mineMap();
    if (!m.has(p.room)) m.set(p.room, []);
    if (!m.get(p.room).some((x) => x.id === p.id))
      m.get(p.room).push({ ...p, remote: true });
    ev.emit('post', p);
  });

  /** My cluster, derived transparently from what I agreed with. */
  async function myCluster() {
    const st = await state();
    let a = 0;
    let b = 0;
    for (const [, v] of Object.entries(st.votes)) {
      if (!v.cluster) continue;
      const sgn = v.kind === 'up' ? 1 : -1;
      if (v.cluster === 'A') a += sgn;
      else b += sgn;
    }
    const hash = [...rt.me.handle].reduce((x, c) => x + c.charCodeAt(0), 0);
    const cluster = a === b ? (hash % 2 ? 'A' : 'B') : a > b ? 'A' : 'B';
    const why =
      a === b
        ? 'assigned by default until you have voted on more posts'
        : `you agreed more with posts from cluster ${cluster} writers`;
    return { cluster, why, a, b };
  }

  async function room(s) {
    const id = String(s.id);
    const seeds = seedPosts(s);
    const m = await mineMap();
    const st = await state();
    const own = (m.get(id) || []).map((p) => ({ ...p }));
    const posts = [...seeds, ...own];
    for (const p of posts) {
      const v = st.votes[p.id];
      p.votes = {
        up: (p.votes?.up || 0) + (v?.kind === 'up' ? 1 : 0),
        dn: (p.votes?.dn || 0) + (v?.kind === 'dn' ? 1 : 0),
      };
      p.myVote = v?.kind || null;
      for (const n of p.notes || []) n.mine = st.ratings[n.id] || null;
    }
    const chrono = [...posts].sort((a, b) => a.at - b.at);
    const numbering = new Map(chrono.map((p, i) => [p.id, `P${i + 1}`]));
    const answered = new Set(
      posts.filter((p) => p.replyTo).map((p) => p.replyTo),
    );
    const roots = posts.filter((p) => !p.replyTo);
    const openQ = roots
      .filter((p) => p.kind === 'question' && !answered.has(p.id))
      .sort((a, b) => b.at - a.at);
    const rest = roots
      .filter((p) => !openQ.includes(p))
      .sort((a, b) => evidenceScore(b) - evidenceScore(a) || b.at - a.at);
    const ordered = [...openQ, ...rest];
    const repliesOf = (p) =>
      posts.filter((r) => r.replyTo === p.id).sort((a, b) => a.at - b.at);
    const synth = await synthesize(s, posts, numbering);
    const claims = rest.filter(
      (p) => p.kind !== 'question' && p.kind !== 'prediction',
    );
    const top = claims[0] || ordered[0] || null;
    const sealedCount = posts.filter(
      (p) => p.kind === 'witness' && p.evidence?.sealed && p.evidence?.wasThere,
    ).length;
    const topDisputed =
      top &&
      (repliesOf(top).some((r) => r.kind === 'correction') ||
        (top.votes.dn || 0) / Math.max(1, top.votes.up + top.votes.dn) > 0.35);
    const status = topDisputed
      ? { id: 'disputed', label: 'Disputed' }
      : sealedCount >= 2
        ? {
            id: 'confirmed',
            label: `Confirmed by ${sealedCount} signed captures`,
          }
        : sealedCount === 1
          ? { id: 'sealed', label: '1 signed capture' }
          : { id: 'open', label: 'Unconfirmed' };
    const participants = [
      ...new Map(posts.map((p) => [p.author.handle, p.author])).values(),
    ];
    const lastAt = Math.max(...posts.map((p) => p.at));
    const recent = posts.filter((p) => Date.now() - p.at < 3 * 3600e3).length;
    return {
      id,
      situation: s,
      posts,
      ordered,
      openQ,
      repliesOf,
      numbering,
      synth,
      top,
      status,
      participants,
      lastAt,
      heat:
        recent * 2 + posts.length + (own.length ? 6 : 0) + (s.severity || 0),
      hasExamples: seeds.length > 0,
      ownCount: own.length,
    };
  }

  async function post(s, draft) {
    const m = await mineMap();
    const id = draft.id || `${s.id}~${rt.tab}~${Date.now().toString(36)}`;
    const dup = (m.get(String(s.id)) || []).find((x) => x.id === id);
    if (dup) return dup;
    const p = {
      id,
      room: String(s.id),
      kind: draft.kind || 'witness',
      text: String(draft.text || '').slice(0, 2000),
      at: draft.at || Date.now(),
      author: draft.author || {
        handle: rt.me.handle,
        self: true,
        local: !!(rt.me.home && distKm(rt.me.home, s) < 50),
      },
      evidence: draft.evidence || {},
      quoteOf: draft.quoteOf || null,
      promotedFrom: draft.promotedFrom || null,
      needEyes: draft.needEyes || null,
      momentId: draft.momentId || s.momentId || null,
      votes: draft.votes || { up: 0, dn: 0 },
      replyTo: draft.replyTo || null,
      anchor: draft.anchor || null,
      hologram: !!draft.hologram,
      notes: [],
    };
    await put('posts', p).catch((err) =>
      console.warn('post not persisted', err),
    );
    if (!m.has(p.room)) m.set(p.room, []);
    m.get(p.room).push(p);
    rt.post(p);
    ev.emit('post', p);
    return p;
  }

  async function vote(p, kind, cluster) {
    const st = await state();
    if (st.votes[p.id]?.kind === kind) delete st.votes[p.id];
    else
      st.votes[p.id] = {
        kind,
        cluster: p.author?.cluster || null,
        at: Date.now(),
      };
    await saveKv();
  }

  async function rate(note, helpful) {
    const st = await state();
    const { cluster } = await myCluster();
    st.ratings[note.id] = { rater: 'you', cluster, helpful, at: Date.now() };
    await saveKv();
    rt.rate({ note: note.id, cluster, helpful });
    return st.ratings[note.id];
  }

  /** Every post this device wrote (for Witness cards and You). */
  async function myPosts() {
    const m = await mineMap();
    return [...m.values()].flat().filter((p) => p.author?.self && !p.remote);
  }
  async function allLocalPosts() {
    const m = await mineMap();
    return [...m.values()].flat();
  }

  /** Rooms ranked by heat, for Room cards and the Threads hub. */
  async function hot(situations, n = 6) {
    const rooms = await Promise.all(situations.map((s) => room(s)));
    rooms.sort((a, b) => b.heat - a.heat);
    // Diversity: one room per genre unless people on this device posted there.
    const seen = new Set();
    const out = [];
    for (const r of rooms) {
      const g = genre(r.situation);
      if (seen.has(g) && !r.ownCount) continue;
      seen.add(g);
      out.push(r);
      if (out.length >= n) break;
    }
    return out;
  }

  /** Places people created from the attach sheet ("New place", a camera). */
  async function places() {
    const rec = await get('kv', 'places').catch(() => null);
    return rec?.list || [];
  }
  async function addPlace(s) {
    const list = await places();
    if (!list.some((x) => x.id === s.id)) list.unshift(s);
    await put('kv', { id: 'places', list: list.slice(0, 50) }).catch(() => {});
    ev.emit('places', list);
    return s;
  }

  return {
    on: ev.on,
    off: ev.off,
    room,
    post,
    vote,
    rate,
    myCluster,
    myPosts,
    allLocalPosts,
    hot,
    seedPosts,
    places,
    addPlace,
  };
}

/** Did a capture at (lat, lon, t) count as "there" for situation s? */
export function wasThere(s, fix, t) {
  if (!fix || !s) return { there: false, km: NaN };
  const km = distKm(fix, s);
  const r = presenceRadiusKm(s);
  const start = s.time?.start
    ? +new Date(s.time.start)
    : +new Date(s.updatedAt) - 12 * 3600e3;
  const end = s.time?.end ? +new Date(s.time.end) : Date.now() + 3600e3;
  const inTime = t >= start - 6 * 3600e3 && t <= end + 6 * 3600e3;
  return { there: km <= r && inTime, km, radius: r, inTime };
}

/** Headline for Room card status lines. */
export function roomHeadline(r) {
  const s = r.situation;
  const h = headlineOf(s);
  return h
    ? `${h.value}${h.unit ? ` ${h.unit}` : ''} ${h.label || ''}`.trim()
    : s.place || '';
}

export { utc };
