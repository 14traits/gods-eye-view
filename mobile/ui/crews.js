/**
 * Crews (DESIGN.md §12.6): persistent groups, like X communities. A crew
 * has its own feed, members, rules and rooms, and can co-watch a Moment.
 *
 * Seeded crews and their posts are EXAMPLES: fictional handles (the same
 * cast as the simulated chat), never real people. Joining, leaving and the
 * person's own crew posts are real and stay on this device.
 */

import { icon } from './icons.js';
import { $, $$, h, esc, ago, haptic, toast, emitter } from './dom.js';
import { createSheet } from './sheet.js';
import { simTier } from './signal.js';
import { personaOf } from './chatSim.js';
import { richText } from './emotes.js';
import { get, put } from '../capture/db.js';

const JOIN_KEY = 'gev.mobile.crews.v1';

export const CREWS = [
  {
    id: 'nyc-scanner',
    name: 'NYC Scanner Nerds',
    tagline: 'Radio, rotors and rooftops. Five boroughs, receipts first.',
    hue: '#a3d8ff',
    glyph: 'waveform',
    area: 'New York City',
    lat: 40.7484,
    lon: -73.9857,
    members: 2841,
    genres: ['circling', 'eye', 'air'],
    moment: 'empire-state',
    mods: ['@deskmod_rae', '@scanner_sal'],
    roster: [
      '@scanner_sal',
      '@freq_hopper',
      '@onthe5th',
      '@corner_deli_mo',
      '@actually_tho',
      '@longlens_ben',
      '@flaps30',
      '@lurker9',
    ],
    rules: [
      'No names, faces, plates or addresses of private people. Ever.',
      'Scanner audio is a lead, not a source: post it as Context with the time and channel.',
      'Sealed or it’s a rumour. Unverified uploads get a note before they get a repost.',
      'Be first, be right, be kind to the new eyes.',
    ],
    feed: [
      {
        h: '@deskmod_rae',
        m: 2900,
        k: 'context',
        pin: true,
        up: 212,
        re: 14,
        t: 'Rules refresher: no names, no plates, no addresses of private people. Scanner audio is a lead, not a source. Post it as Context with the time and the channel.',
      },
      {
        h: '@scanner_sal',
        m: 22,
        k: 'witness',
        up: 188,
        re: 41,
        t: 'Aviation and ESU both up on Special Ops at 14:02. Three helos over Midtown on the map: two holding at ~1,500 ft, one lower doing tight lefts. Room is live, Moment is building.',
      },
      {
        h: '@onthe5th',
        m: 17,
        k: 'witness',
        sealed: true,
        up: 264,
        re: 33,
        t: 'Sealed a clip from 5th & 34th looking up. Two figures above the 86th floor deck, one holding a banner. Heading in the seal points straight at the mast. SealIt',
      },
      {
        h: '@actually_tho',
        m: 12,
        k: 'correction',
        up: 97,
        re: 8,
        t: 'PSA: the “shots fired on 8th Ave” clip going around tonight is a 2021 fireworks video. Reverse search finds it. Note is already bridged in the room.',
      },
      {
        h: '@freq_hopper',
        m: 190,
        k: 'question',
        up: 31,
        re: 12,
        t: 'Anyone know why the Citywide 1 feed drops out around 2 am most nights? Trunk maintenance, or something on my end?',
      },
      {
        h: '@longlens_ben',
        m: 410,
        k: 'context',
        up: 58,
        re: 5,
        t: 'Best public vantage for Midtown orbits is the High Line at 30th. You get the ESB, Hudson Yards and the heliport approach in one frame.',
      },
    ],
    events: [
      {
        id: 'cw-esb',
        title: 'Replay: Climbers on the Empire State',
        sub: 'with @scanner_sal annotating the radio timeline',
        when: 'Tonight · 9:00 PM ET',
        going: 41,
        moment: 'empire-state',
      },
    ],
  },
  {
    id: 'gulf-storm',
    name: 'Gulf Storm Chasers',
    tagline:
      'Radar loops, lightning parties and seawall reports from Brownsville to Key West.',
    hue: '#8ab4f8',
    glyph: 'bolt',
    area: 'Gulf of Mexico',
    lat: 28.6,
    lon: -91.5,
    members: 6120,
    genres: ['storm', 'cyclone'],
    mods: ['@radar_rina', '@nightdesk_mod'],
    roster: [
      '@radar_rina',
      '@cape_and_shear',
      '@wxdan',
      '@harborkid_22',
      '@ridge_rd_amy',
      '@buffering_bev',
      '@k8_mobile',
    ],
    rules: [
      'NWS and local officials make the calls. We add eyes, not alerts.',
      'Post radar with its timestamp. A loop without a time is a vibe, not data.',
      'Flood photos must be sealed or carry a place and time.',
      'Don’t drive into water for content.',
    ],
    feed: [
      {
        h: '@radar_rina',
        m: 35,
        k: 'context',
        pin: true,
        up: 341,
        re: 27,
        t: 'Squall line over the central Gulf is the most electric thing on the map tonight. Lightning density near the leading edge is top-decile for October. Room is live, come hang.',
      },
      {
        h: '@cape_and_shear',
        m: 18,
        k: 'prediction',
        up: 122,
        re: 19,
        t: 'Houston cell has a 60 dBZ core over the Ship Channel, moving east ~25 mph. If you’re on I-10 east of downtown, it’s on you in about 20 minutes. StormMode',
      },
      {
        h: '@harborkid_22',
        m: 9,
        k: 'witness',
        sealed: true,
        up: 176,
        re: 22,
        t: 'Galveston seawall at 61st: waves topping the wall at high tide, spray over the road. Sealed clip, 40 s.',
      },
      {
        h: '@wxdan',
        m: 64,
        k: 'question',
        up: 44,
        re: 16,
        t: 'Anyone on the Bolivar ferry with a barometer app? Want a ground-truth pressure to compare against the buoy.',
      },
      {
        h: '@buffering_bev',
        m: 120,
        k: 'context',
        up: 63,
        re: 9,
        t: 'First lightning party in the Live lane and I have never seen chat move this fast. 10/10 would refresh again.',
      },
    ],
    events: [
      {
        id: 'cw-gulf',
        title: 'Live: Gulf lightning party',
        sub: 'Live lane open all night, radar on',
        when: 'Tonight · from 8:00 PM CT',
        going: 233,
        genre: 'storm',
      },
    ],
  },
  {
    id: 'novosel',
    name: 'Fort Novosel Alumni',
    tagline:
      'Rotor school grads, instructors and the people who live under the pattern.',
    hue: '#ffb547',
    glyph: 'sky',
    area: 'Fort Novosel, Alabama',
    lat: 31.33,
    lon: -85.72,
    members: 1307,
    genres: ['heli'],
    mods: ['@heavy_tess'],
    roster: [
      '@heavy_tess',
      '@flaps30',
      '@atc_listener',
      '@medic_off_shift',
      '@first_time_here',
    ],
    rules: [
      'No tail numbers of private aircraft. Training fleet is fine.',
      'What happens in the pattern is training. Explain it before you alarm anyone.',
      'Old stories welcome. Embellishment noted.',
    ],
    feed: [
      {
        h: '@heavy_tess',
        m: 26,
        k: 'witness',
        up: 89,
        re: 11,
        t: 'Fourteenth circuit of the day on the map. Brings me right back. Stage field is busy: at least six in the pattern right now. HeliSpin',
      },
      {
        h: '@flaps30',
        m: 21,
        k: 'context',
        pin: true,
        up: 154,
        re: 17,
        t: 'For the new folks in the room: the “emergency” people keep asking about is an autorotation. It’s practice. The flare at the bottom is the fun part.',
      },
      {
        h: '@first_time_here',
        m: 15,
        k: 'question',
        up: 12,
        re: 6,
        t: 'Why do they all fly the same rectangle over and over?',
      },
      {
        h: '@atc_listener',
        m: 14,
        k: 'context',
        up: 40,
        re: 2,
        t: 'It’s a traffic pattern: takeoff, crosswind, downwind, base, final. Repeating it is how you get good at the hard part, which is the last 50 ft.',
      },
      {
        h: '@heavy_tess',
        m: 2600,
        k: 'context',
        up: 71,
        re: 23,
        t: 'Class reunion in Enterprise in March. Who’s in? The boll weevil statue is still there.',
      },
    ],
    events: [
      {
        id: 'cw-rotor',
        title: 'Rotor school at 600×',
        sub: 'A full day of pattern work, replayed with commentary',
        when: 'Saturday · 10:00 AM CT',
        going: 58,
        genre: 'heli',
      },
    ],
  },
  {
    id: 'orbit',
    name: 'Orbit Watchers',
    tagline:
      'Passes, launches, reentries and the occasional very patient explanation of what that light was.',
    hue: '#b39dff',
    glyph: 'orbit',
    area: 'Everywhere, looking up',
    lat: 25.99,
    lon: -97.15,
    members: 9480,
    genres: ['orbit', 'launch'],
    mods: ['@tle_tom'],
    roster: [
      '@tle_tom',
      '@pass_predictor',
      '@longlens_ben',
      '@pigeonwatch',
      '@just_scrolling',
      '@lagspike',
    ],
    rules: [
      '“UFO” threads get a Context post with the TLE match. Be kind, everyone starts somewhere.',
      'Pass times in local time and UTC.',
      'Respect launch exclusion zones. No drone footage.',
    ],
    feed: [
      {
        h: '@tle_tom',
        m: 48,
        k: 'context',
        pin: true,
        up: 402,
        re: 31,
        t: 'ISS pass tonight: max elevation 71°, about six minutes horizon to horizon. Start looking WSW. It’s the bright one that doesn’t blink. EyesUp',
      },
      {
        h: '@pass_predictor',
        m: 33,
        k: 'prediction',
        up: 118,
        re: 14,
        t: 'Starlink train from yesterday’s launch will be visible about 40 minutes after sunset, low in the north-west. It fades within a week as they raise orbit.',
      },
      {
        h: '@longlens_ben',
        m: 700,
        k: 'witness',
        sealed: true,
        up: 233,
        re: 19,
        t: 'Sealed a 6 s exposure of last night’s pass over the harbour. The streak ends where the station went into Earth’s shadow, not where it “vanished”.',
      },
      {
        h: '@pigeonwatch',
        m: 300,
        k: 'question',
        up: 28,
        re: 11,
        t: 'Saw a row of lights moving in a line last night. Please tell me that’s Starlink and not my sanity.',
      },
      {
        h: '@tle_tom',
        m: 295,
        k: 'context',
        up: 87,
        re: 3,
        t: '@pigeonwatch That’s Starlink: a fresh batch still in a low train. Your sanity is fine. LiftOff',
      },
    ],
    events: [
      {
        id: 'cw-launch',
        title: 'Watch party: launch window at Starbase',
        sub: 'Live lane, countdown, LiftOff spam encouraged',
        when: 'Window opens 6:30 PM CT',
        going: 1204,
        genre: 'launch',
      },
    ],
  },
];
export const CREW = Object.fromEntries(CREWS.map((c) => [c.id, c]));

const fmtM = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function crewAvatar(c, cls = '') {
  return `<span class="crew-av ${cls}" style="--hue:${c.hue}">${icon(c.glyph)}</span>`;
}

export function createCrews(core) {
  const ev = emitter();
  // First run: you start in one crew so the Rooms tab shows how it works.
  let joined = new Set(['nyc-scanner']);
  try {
    const raw = localStorage.getItem(JOIN_KEY);
    if (raw) joined = new Set(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  const saveJoin = () => {
    try {
      localStorage.setItem(JOIN_KEY, JSON.stringify([...joined]));
    } catch {
      /* ignore */
    }
  };
  let own = {}; // crew id → posts
  const ready = get('kv', 'crewPosts')
    .then((r) => (own = r?.posts || {}))
    .catch(() => {});

  const isJoined = (id) => joined.has(id);
  function toggle(id) {
    if (joined.has(id)) joined.delete(id);
    else joined.add(id);
    saveJoin();
    ev.emit('change');
    return joined.has(id);
  }
  async function postTo(id, text) {
    await ready;
    const p = {
      id: `crew-${id}-${Date.now().toString(36)}`,
      h: core.rt.me.handle,
      at: Date.now(),
      k: 'context',
      t: text,
      up: 0,
      re: 0,
      self: true,
    };
    own[id] = [p, ...(own[id] || [])].slice(0, 50);
    await put('kv', { id: 'crewPosts', posts: own }).catch(() => {});
    ev.emit('change');
    return p;
  }
  const feedOf = (c) => {
    const now = Date.now();
    const seeded = c.feed.map((p, i) => ({
      ...p,
      id: `${c.id}-ex${i}`,
      at: now - p.m * 60e3,
      example: true,
    }));
    return [...(own[c.id] || []), ...seeded].sort(
      (a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.at - a.at,
    );
  };

  /* ---------------- Sheet ---------------- */
  const sheet = createSheet({
    label: 'Crew',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'crew-sheet opaque',
    heights: { large: (H) => Math.round(Math.min(H * 0.92, 900)) },
  });
  let cur = null;
  let tab = 'feed';

  function postHtml(p) {
    const per = personaOf(p.h);
    const tier = p.self ? core.signal.tier() : simTier(p.h, per?.floor || 0);
    const mod = cur.mods.includes(p.h);
    return `<article class="cp ${p.pin ? 'is-pin' : ''} k-${p.k}" style="--tc:${tier.color}">
        <div class="cp-head"><span class="cp-av" style="--tc:${tier.color}">${esc(p.h.slice(1, 3).toUpperCase())}</span>
          <span class="cp-meta"><b>${esc(p.h)}</b>${mod ? '<span class="cp-mod tele">Mod</span>' : ''}<span class="cp-tier tele">${esc(tier.name)}</span><span class="tele cp-when">${esc(ago(p.at))}</span></span>
          ${p.pin ? `<span class="cp-pin tele">${icon('pin')}Pinned</span>` : p.example ? '<span class="badge-example">Example</span>' : ''}</div>
        <p>${richText(p.t, { me: core.rt.me.handle }).html}</p>
        ${p.sealed ? `<div class="badges"><span class="bdg ex" data-b="sealed">${icon('sealFill')}Sealed</span></div>` : ''}
        <div class="cp-acts tele"><span>${icon('agree')}${p.up}</span><span>${icon('reply')}${p.re}</span><span class="cp-k">${esc(p.k)}</span></div>
      </article>`;
  }

  async function rooms() {
    const sits = (await core.situations?.().catch(() => [])) || [];
    const { chatGenre, viewerCount } = await import('./chatSim.js');
    return sits
      .filter((s) => cur.genres.includes(chatGenre(s)))
      .slice(0, 4)
      .map((s) => ({ s, v: viewerCount(s) }));
  }

  async function renderBody() {
    const c = cur;
    if (tab === 'feed') {
      await ready;
      sheet.body.innerHTML = `${
        isJoined(c.id)
          ? `<form class="cp-compose"><input type="text" maxlength="280" placeholder="Post to ${esc(c.name)}…" data-no-drag aria-label="Post to the crew"/><button class="pill-btn primary sm" type="submit">Post</button></form>`
          : `<div class="cp-join-hint">${icon('users')}<span>Join to post. Anyone can read.</span></div>`
      }${feedOf(c).map(postHtml).join('')}<p class="footnote">Seeded posts are examples by fictional members. Your posts stay on this device.</p>`;
    } else if (tab === 'watch') {
      const rs = await rooms();
      sheet.body.innerHTML = `<div class="room-h tele">${icon('play')}Co-watch</div>
        ${c.events
          .map(
            (
              e,
            ) => `<div class="cw-card" style="--hue:${c.hue}"><div class="cw-when tele">${esc(e.when)} · ${e.going.toLocaleString()} going</div><b>${esc(e.title)}</b><span>${esc(e.sub)}</span>
            <div class="cw-acts"><button type="button" class="pill-btn primary sm" data-cowatch="${esc(e.id)}">${icon('users')}Co-watch now</button><span class="badge-example">Example</span></div></div>`,
          )
          .join('')}
        <div class="room-h tele">${icon('now')}Crew rooms <span>live now</span></div>
        ${
          rs.length
            ? rs
                .map(
                  ({ s, v }) =>
                    `<button type="button" class="cr-room" data-room="${esc(s.id)}"><i class="live-dot"></i><span><b>${esc(s.title)}</b><small class="tele">${v.toLocaleString()} watching · ${esc(s.place || '')}</small></span>${icon('chevronRight', { cls: 'chev' })}</button>`,
                )
                .join('')
            : '<div class="empty">No live rooms for this crew right now. Nothing unusual is a valid state.</div>'
        }`;
      sheet.body._rooms = rs;
    } else if (tab === 'members') {
      const list = [...new Set([...c.mods, ...c.roster])];
      sheet.body.innerHTML = `<p class="cm-why">${icon('sparkles')}Ordered by Signal. Crews show what members got right, never follower counts.</p>
        ${list
          .map((x) => ({
            x,
            t: simTier(x, personaOf(x)?.floor || 0),
            p: personaOf(x),
          }))
          .sort((a, b) => b.t.min - a.t.min)
          .map(
            ({ x, t, p }) =>
              `<div class="cm-row" style="--tc:${t.color}"><span class="cp-av">${esc(x.slice(1, 3).toUpperCase())}</span><span class="cm-main"><b>${esc(x)}</b><small class="tele">${esc(t.name)}${p?.domain ? ` · ${esc(p.domain)}` : ''}${c.mods.includes(x) ? ' · Mod' : ''}</small></span><span class="cm-w tele">×${t.weight.toFixed(1)}</span></div>`,
          )
          .join('')}
        ${isJoined(c.id) ? `<div class="cm-row is-me" style="--tc:${core.signal.tier().color}"><span class="cp-av">YOU</span><span class="cm-main"><b>${esc(core.rt.me.handle)}</b><small class="tele">${esc(core.signal.tier().name)} · you</small></span><span class="cm-w tele">×${core.signal.tier().weight.toFixed(1)}</span></div>` : ''}
        <p class="footnote">Fictional members (example). ${fmtM(c.members)} members in the seeded crew.</p>`;
    } else {
      sheet.body.innerHTML = `<ol class="cr-rules">${c.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
        <p class="footnote">Every crew inherits the line we don’t cross: we track things that broadcast, never people. No face recognition, no person search.</p>`;
    }
  }

  function renderHead() {
    const c = cur;
    const j = isJoined(c.id);
    sheet.head.innerHTML = `<div class="crew-hero" style="--hue:${c.hue}">
        ${crewAvatar(c, 'lg')}
        <div class="ch-main"><div class="tele ch-area">${esc(c.area)} · Crew <span class="badge-example">Example</span></div><h2 class="sheet-title">${esc(c.name)}</h2><p>${esc(c.tagline)}</p>
        <div class="ch-meta tele"><span class="avs">${c.roster
          .slice(0, 4)
          .map(
            (x) =>
              `<span class="cp-av" style="--tc:${simTier(x, personaOf(x)?.floor || 0).color}">${esc(x.slice(1, 3).toUpperCase())}</span>`,
          )
          .join('')}</span>${fmtM(c.members)} members</div></div>
        <button type="button" class="pill-btn ${j ? 'plain' : 'primary'} sm ch-join" data-join>${j ? `${icon('checkmark')}Joined` : 'Join'}</button>
      </div>
      <div class="crew-tabs" role="tablist">${['feed', 'watch', 'members', 'rules'].map((t) => `<button type="button" role="tab" data-ctab="${t}" aria-selected="${t === tab}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`;
  }

  async function open(id, { tab: t = 'feed' } = {}) {
    cur = CREW[id];
    if (!cur) return;
    sheet.root.parentElement?.appendChild(sheet.root);
    tab = t;
    renderHead();
    sheet.body.innerHTML = '';
    sheet.open('large');
    await renderBody();
  }

  sheet.root.addEventListener('click', async (e) => {
    if (!cur) return;
    if (e.target.closest('[data-join]')) {
      const on = toggle(cur.id);
      haptic(on ? 'success' : 'tick');
      toast(on ? `Joined ${cur.name}` : `Left ${cur.name}`, {
        icon: icon('users'),
      });
      renderHead();
      await renderBody();
      return;
    }
    const ct = e.target.closest('[data-ctab]');
    if (ct) {
      tab = ct.dataset.ctab;
      $$('[data-ctab]', sheet.head).forEach((b) =>
        b.setAttribute('aria-selected', String(b === ct)),
      );
      haptic('tick');
      await renderBody();
      return;
    }
    const cw = e.target.closest('[data-cowatch]');
    if (cw) {
      const evt = cur.events.find((x) => x.id === cw.dataset.cowatch);
      const crew = cur;
      sheet.close();
      if (evt?.moment) {
        const m = await core.moment(evt.moment);
        core.openRoom(m, { lane: 'live', crew });
      } else {
        const sits = (await core.situations?.().catch(() => [])) || [];
        const { chatGenre } = await import('./chatSim.js');
        const s = sits.find((x) => chatGenre(x) === evt?.genre) || sits[0];
        if (s) core.openRoom(s, { lane: 'live', crew });
      }
      return;
    }
    const rm = e.target.closest('[data-room]');
    if (rm) {
      const x = (sheet.body._rooms || []).find(
        (y) => String(y.s.id) === rm.dataset.room,
      );
      const crew = cur;
      sheet.close();
      if (x) core.openRoom(x.s, { lane: 'live', crew });
    }
  });
  sheet.root.addEventListener('submit', async (e) => {
    const f = e.target.closest('.cp-compose');
    if (!f) return;
    e.preventDefault();
    const inp = $('input', f);
    const t = inp.value.trim();
    if (!t) return;
    await postTo(cur.id, t);
    haptic('success');
    toast(`Posted to ${cur.name}`, { icon: icon('users') });
    await renderBody();
  });

  return {
    on: ev.on,
    list: () => CREWS.map((c) => ({ ...c, joined: isJoined(c.id) })),
    isJoined,
    toggle,
    open,
    feedOf,
    postTo,
  };
}

export { fmtM };
