/**
 * God's Eye social layer (DESIGN.md §12.2, §12.3, §12.6): the mount points
 * the shell integrates, and the one shared social core behind them.
 *
 *   configureSocial(ctx)                → core   (call once from main.js)
 *   mountRoomsTab(el, ctx)              → { refresh(), destroy() }
 *   openRoom(situationOrMoment, { lane: 'live'|'record', focusPost?, crew?, detent? })
 *                                       → Promise<{ sheet, panel, close() }>
 *   mountYouTab(el, ctx)                → { render(), destroy() }
 *   chatOverlay(el, ctx)                → { push(msg), setMoment(moment), setTime(t), destroy() }
 *   needEyesNear(lonlat, km = 25)       → Request[] (sync; open requests first)
 *   onSocial(event, fn)                 → unsubscribe   ('moment-capture' | 'promote' | 'clerk' | 'signal')
 *   momentCaptures(momentId)            → Promise<Capture[]> (the person's captures posted into a Moment)
 *
 * ctx (every key optional, read late so it can be filled in after boot):
 *   { globe, store, rt, rooms, getSituations(), getLocation(), bindScroll(el),
 *     onCapture(situation, { needEyes?, replyTo? }), onOpenSituation(s),
 *     onPlayMoment(moment), onShowGlobe(situation), onVerify(bundle),
 *     onCredits(), watch: { summary()? , open()? }, sheetHost }
 * Pass main.js's `rt` and `rooms` so the app keeps one realtime channel.
 */

import { icon } from './icons.js';
import { h, esc, emitter, toast, haptic, store as domStore } from './dom.js';
import { createSheet } from './sheet.js';
import { createRealtime } from './realtime.js';
import { createRooms } from './rooms.js';
import { createSignal, tierOf, RULE, simTier } from './signal.js';
import { createRoomHub, mountChatOverlay, guessLoc } from './liveChat.js';
import { createRoomPanel } from './room.js';
import { createNeeds, celebrate } from './needEyes.js';
import { createCrews } from './crews.js';
import { createComposer } from './composer.js';
import { PERSONAS, viewerCount } from './chatSim.js';
import { BAND_NAME, bandOf, fmtKm, utc, distKm } from './bands.js';
import { get, put } from '../capture/db.js';

/* ---------------- Styles (no index.html change needed) ---------------- */
function ensureCss() {
  if (
    typeof document === 'undefined' ||
    document.getElementById('gev-social-css')
  )
    return;
  const l = document.createElement('link');
  l.id = 'gev-social-css';
  l.rel = 'stylesheet';
  l.href = new URL('../styles/social.css', import.meta.url).href;
  document.head.appendChild(l);
}

/* ---------------- Moments ---------------- */

/** The hero Moment when the engine has none (illustrative, labelled). */
function heroFallback() {
  const end = Date.now() - 4 * 60e3;
  return {
    id: 'empire-state',
    title: 'Climbers on the Empire State Building',
    place: 'Midtown Manhattan, New York',
    lon: -73.9857,
    lat: 40.7484,
    time: { start: end - 18 * 60e3, end },
    illustrative: true,
    tracks: [
      { id: 'n1', kind: 'helicopter', label: 'News 1', operator: 'News' },
      { id: 'n2', kind: 'helicopter', label: 'News 2', operator: 'News' },
      { id: 'p1', kind: 'helicopter', label: 'Police', operator: 'Police' },
    ],
    captures: [],
    chat: [],
    posts: [],
    sources: [
      { name: 'Illustrative reconstruction', detail: 'Synthetic tracks' },
    ],
  };
}

export function isMoment(t) {
  return (
    !!t &&
    !t.momentPosts &&
    !!(t.tracks || t.cameraPath || (t.time && t.captures))
  );
}

/** A Moment as a room: the same Live and Record lanes, on its evidence. */
export function momentRoom(m) {
  const tracks = m.tracks || [];
  const caps = m.captures || [];
  const mins = Math.max(
    1,
    Math.round(((+m.time?.end || 0) - (+m.time?.start || 0)) / 60e3),
  );
  return {
    id: `moment:${m.id}`,
    momentId: m.id,
    moment: m,
    kind: 'circling',
    family: 'sky',
    band: 'sky',
    archetype: 'track',
    title: m.title,
    place: m.place,
    subtitle: m.illustrative
      ? 'Illustrative reconstruction'
      : 'Detected from live ADS-B',
    lon: m.lon,
    lat: m.lat,
    live: !m.illustrative,
    illustrative: !!m.illustrative,
    updatedAt: +m.time?.end || Date.now(),
    time: m.time,
    source: m.illustrative ? 'Illustrative reconstruction' : 'ADS-B detection',
    severity: 2,
    metrics: [
      { label: 'Aircraft circling', value: tracks.length || 3 },
      { label: 'Sealed captures', value: caps.length },
      { label: 'Window', value: mins, unit: 'min' },
    ],
    momentPosts: m.posts?.length ? m.posts : null,
    momentCaptures: caps,
    camera: m.cameraPath?.[0] || {
      lon: m.lon,
      lat: m.lat,
      height: 2500,
      heading: 0,
      pitch: -35,
    },
    layers: [],
  };
}

/* ---------------- The core ---------------- */

let core = null;

/**
 * The shared social core. The first call builds it; later calls merge ctx.
 * @param {object} ctx
 */
export function socialCore(ctx = {}) {
  ensureCss();
  if (core) {
    Object.assign(core.ctx, strip(ctx));
    if (ctx.globe && !core.globe) core.globe = ctx.globe;
    return core;
  }
  core = buildCore(ctx);
  return core;
}
export const configureSocial = socialCore;
/** Accept the shell's names too (openSituation, openMoment, openWatch). */
const strip = (o) => {
  const x = Object.fromEntries(
    Object.entries(o || {}).filter(([, v]) => v != null),
  );
  if (!x.onOpenSituation && x.openSituation)
    x.onOpenSituation = x.openSituation;
  if (!x.onPlayMoment && x.openMoment) x.onPlayMoment = x.openMoment;
  if (!x.watch && x.openWatch) x.watch = { open: x.openWatch };
  else if (x.watch && !x.watch.open && x.openWatch)
    x.watch = Object.assign(Object.create(x.watch), { open: x.openWatch });
  return x;
};

function buildCore(ctx) {
  const ev = emitter();
  const c = {
    ctx: strip(ctx),
    ev,
    on: ev.on,
    off: ev.off,
    hubs: new Map(),
  };
  c.globe = ctx.globe || null;
  c.store = ctx.store || domStore;
  c.rt = ctx.rt || createRealtime();
  c.rooms = ctx.rooms || createRooms({ rt: c.rt });
  c.signal = createSignal({ me: c.rt.me });
  c.signal.on('change', (x) => ev.emit('signal', x));

  c.situations = async () => {
    try {
      if (c.ctx.getSituations) return (await c.ctx.getSituations()) || [];
      if (c.globe?.situations) return (await c.globe.situations()) || [];
    } catch {
      /* ignore */
    }
    return [];
  };
  c.getLocation = () => c.ctx.getLocation?.() || null;
  c.myLoc = () => c.getLocation() || c.rt.me.home || guessLoc();
  c.hub = (s) => {
    if (!s) return null;
    const id = String(s.id);
    if (!c.hubs.has(id)) c.hubs.set(id, createRoomHub(c, s));
    return c.hubs.get(id);
  };
  c.onCapture = (s, o = {}) => {
    roomSheet?.close();
    if (c.ctx.onCapture) return c.ctx.onCapture(s, o);
    // Fallback: switch to Capture and pre-attach through the shell's handle.
    const cap = typeof window !== 'undefined' ? window.__gev?.capture : null;
    if (c.ctx.selectTab) {
      c.ctx.selectTab('capture');
      setTimeout(() => (window.__gev?.capture || cap)?.attachTo?.(s, o), 60);
      return null;
    }
    toast('Open Capture to answer with a sealed photo', {
      icon: icon('viewfinder'),
    });
    return null;
  };

  /* Moments, feature-detected on the engine. */
  const eng = () => c.globe?.raw || c.globe;
  c.moments = async () => {
    try {
      const fn = c.globe?.moments || eng()?.moments;
      if (typeof fn === 'function') {
        const list = await fn.call(c.globe?.moments ? c.globe : eng());
        if (Array.isArray(list) && list.length) return list;
      }
    } catch {
      /* ignore */
    }
    return [heroFallback()];
  };
  c.moment = async (id) => {
    try {
      const fn = c.globe?.moment || eng()?.moment;
      if (typeof fn === 'function') {
        const m = await fn.call(c.globe?.moment ? c.globe : eng(), id);
        if (m) return m;
      }
    } catch {
      /* ignore */
    }
    return (await c.moments()).find((m) => m.id === id) || heroFallback();
  };

  /* Where the person has a sealed capture (for the Witness glow). */
  const witnessRooms = new Set();
  c.rooms
    .myPosts()
    .then((list) =>
      list.forEach((p) => p.evidence?.sealed && witnessRooms.add(p.room)),
    )
    .catch(() => {});
  c.myWitness = (room) => witnessRooms.has(String(room));

  /* Simulated corroboration of the person's sealed posts (labelled). */
  let simc = {};
  get('kv', 'simcorro')
    .then((r) => (simc = r?.map || {}))
    .catch(() => {});
  c.simCorro = (postId) => simc[postId] || [];
  async function simulateCorroboration(s, post) {
    const cast = [
      ...PERSONAS.local,
      ...PERSONAS.wx,
      ...PERSONAS.pilot,
      ...PERSONAS.photo,
      ...PERSONAS.skeptic,
    ].sort(() => Math.random() - 0.5);
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i += 1) {
      const p = cast[i];
      setTimeout(
        async () => {
          const t = simTier(p.handle, p.floor);
          simc[post.id] = [
            ...(simc[post.id] || []),
            { handle: p.handle, w: t.weight, at: Date.now() },
          ];
          await put('kv', { id: 'simcorro', map: simc }).catch(() => {});
          const delta = Math.round(RULE.corroborated.delta * t.weight);
          await c.signal.award({
            id: `corro:${post.id}:${p.handle}`,
            rule: 'corroborated',
            delta,
            text: `${p.handle} (${t.name}, ×${t.weight.toFixed(1)}) corroborated your capture in ${s.title} · simulated`,
            ref: { room: String(s.id), post: post.id },
            sim: true,
          });
          ev.emit('simcorro', { room: String(s.id), post: post.id });
          if (i === 0)
            toast(`${p.handle} corroborated your capture · +${delta} Signal`, {
              icon: icon('agree'),
            });
        },
        7000 + i * (3500 + Math.random() * 4000),
      );
    }
  }

  /**
   * After a capture is posted (attach.js calls this): receipts, First eyes,
   * Need eyes fulfilment, the byline moment, and the Moment timeline.
   */
  c.afterPost = async (s, post, item = {}, { needEyes = null } = {}) => {
    if (!post?.evidence?.sealed) return null;
    witnessRooms.add(String(s.id));
    const before = await c.signal.score();
    const receipts = [];
    const add = async (r) => {
      const out = await c.signal.award(r);
      if (out) receipts.push(out.receipt);
    };
    const ref = { room: String(s.id), post: post.id };
    await add({
      id: `sealed:${post.id}`,
      rule: 'sealed',
      text: `Sealed capture posted to ${s.title}`,
      ref,
    });
    if (post.evidence.wasThere)
      await add({
        id: `there:${post.id}`,
        rule: 'there',
        text: `Inside the ${needEyes ? 'request' : 'event'} radius${Number.isFinite(post.evidence.distanceKm) ? ` · ${fmtKm(post.evidence.distanceKm)} ${needEyes ? 'from the spot' : 'away'}` : ''}`,
        ref,
      });
    // First eyes on the room: no earlier sealed capture from inside it.
    const r = await c.rooms.room(s).catch(() => null);
    const earlier = (r?.posts || []).filter(
      (p) => p.id !== post.id && p.evidence?.sealed && p.evidence?.wasThere,
    );
    const roomFirst = post.evidence.wasThere && !earlier.length;
    let km = NaN;
    if (Number.isFinite(post.evidence.distanceKm))
      km = post.evidence.distanceKm;
    else if (needEyes && post.anchor && Number.isFinite(post.anchor.lat))
      km = distKm(post.anchor, needEyes);
    let needFirst = false;
    if (needEyes) {
      const live = c.needs.byId(needEyes.id);
      needFirst = !live?.fulfilledBy;
      await c.needs.fulfil(needEyes, post, { km });
      await add({
        id: `fulfil:${needEyes.id}`,
        rule: 'fulfil',
        text: `Fulfilled Need eyes: “${needEyes.question}”`,
        ref,
      });
    }
    const first = roomFirst || needFirst;
    if (first)
      await add({
        id: `first:${needEyes ? `need:${needEyes.id}` : s.id}`,
        rule: 'first',
        text: needEyes
          ? `First eyes on “${needEyes.question}”`
          : `First eyes on ${s.title}`,
        ref,
      });
    // Sensor corroboration: real contacts near the sealed position.
    const a = post.anchor;
    if (a && Number.isFinite(a.lat) && c.globe?.contactsNear) {
      const near = (c.globe.contactsNear(a.lon, a.lat, 8) || []).filter((x) =>
        /aircraft|helicopter|ship|vessel/.test(x.kind),
      );
      if (near.length) {
        const air = near.filter((x) =>
          /aircraft|helicopter/.test(x.kind),
        ).length;
        await add({
          id: `sensor:${post.id}`,
          rule: 'sensor',
          text: `${air ? `ADS-B: ${air} aircraft` : `AIS: ${near.length} vessels`} within 8 km at the sealed time`,
          ref,
          source: air ? 'ADS-B' : 'AIS',
        });
      }
    }
    const after = await c.signal.score();
    const handle = c.rt.me.handle;
    const at = post.anchor?.t || post.at;
    const byline = `${first ? 'FIRST EYES' : 'SEALED'} · ${handle} · ${utc(new Date(at))}${Number.isFinite(km) ? ` · ${fmtKm(km).toUpperCase()}` : ''}`;
    // The Live lane hears about it.
    c.hubs.get(String(s.id))?.push({
      id: `sys-cap-${post.id}`,
      system: true,
      handle: 'Record',
      text: `${handle} posted a sealed capture${Number.isFinite(km) ? ` from ${fmtKm(km)}` : ''}${first ? ' · First eyes' : ''}.`,
      at: Date.now(),
      ref: post.id,
    });
    c.hubs.get(String(s.id))?.refreshFirst();
    // A Moment's timeline picks it up.
    const mid = s.momentId || activeMomentId();
    if (mid) {
      const cap = {
        id: `capture:${mid}:${post.id}`,
        t: at,
        lon: a?.lon,
        lat: a?.lat,
        headingDeg: post.evidence.headingDeg ?? null,
        fovDeg: 62,
        title: post.text,
        handle,
        sealed: true,
        firstEyes: first,
        post: post.id,
        self: true,
      };
      const rec = await get('kv', 'momentCaptures').catch(() => null);
      const map = rec?.map || {};
      map[mid] = [...(map[mid] || []).filter((x) => x.id !== cap.id), cap];
      await put('kv', { id: 'momentCaptures', map }).catch(() => {});
      const fn = c.globe?.addMomentCapture || eng()?.addMomentCapture;
      if (typeof fn === 'function')
        try {
          fn.call(c.globe?.addMomentCapture ? c.globe : eng(), mid, cap);
        } catch {
          /* optional */
        }
      ev.emit('moment-capture', { momentId: mid, capture: cap });
    }
    simulateCorroboration(s, post);
    const total = receipts.reduce((x, y) => x + (y.delta || 0), 0);
    if (needEyes || first)
      celebrate({
        byline,
        first,
        need: needEyes,
        receipts,
        before,
        after,
        onRecord: () => openRoom(s, { lane: 'record', focusPost: post.id }),
      });
    else if (total)
      toast(`+${total} Signal · ${receipts.length} receipts`, {
        icon: icon('sparkles'),
      });
    return { receipts, before, after, first };
  };
  function activeMomentId() {
    try {
      const fn = c.globe?.activeMoment || eng()?.activeMoment;
      return typeof fn === 'function'
        ? fn.call(c.globe?.activeMoment ? c.globe : eng())?.id || null
        : null;
    } catch {
      return null;
    }
  }

  /* Cross-tab traffic into the right hub. */
  c.rt.on('chat', ({ room, msg }) => {
    const hub = c.hubs.get(String(room));
    if (hub && msg) hub.push({ ...msg, tier: msg.tier || tierOf(0) });
  });
  c.rt.on('react', ({ room, kind, remote }) => {
    const hub = c.hubs.get(String(room));
    if (hub && ['heart', 'fire', 'eyes', 'wow'].includes(kind))
      hub.react(kind, { remote });
  });
  c.rt.on('corro', ({ room, id, w }) => {
    const hub = c.hubs.get(String(room));
    const m = hub?.log.find((x) => x.id === id);
    if (m) hub.addCorro(m, `tab:${id}:${Math.random()}`, w || 1);
  });

  c.needs = createNeeds(c);
  c.crews = createCrews(c);
  c.openRoom = (t, o) => openRoom(t, o);
  c.composer = null;
  c.getComposer = () => {
    // Modal sheets made earlier must still open above the room sheet.
    const r = c.composer?.root;
    r?.parentElement?.appendChild(r);
    return (c.composer =
      c.composer ||
      createComposer({
        rooms: c.rooms,
        getTime: () => c.ctx.getTime?.() || null,
        getLocation: c.getLocation,
        getView: () => null,
        onCapture: (s, o) => c.onCapture(s, o),
        onPosted: () => {},
      }));
  };
  return c;
}

/* ---------------- openRoom ---------------- */

let roomSheet = null;
let openPanel = null;

/**
 * Open a room sheet in a lane. Accepts a Situation or a Moment.
 * @param {object} target
 * @param {{ lane?: 'live'|'record', focusPost?: string, crew?: object, detent?: string }} o
 */
export async function openRoom(target, o = {}) {
  const c = socialCore();
  if (!target) return null;
  const s = isMoment(target) ? momentRoom(target) : target;
  const lane = o.lane === 'record' ? 'record' : 'live';
  if (!roomSheet)
    roomSheet = createSheet({
      host:
        c.ctx.sheetHost || document.getElementById('sheets') || document.body,
      label: 'Room',
      detents: ['medium', 'large'],
      dismissible: true,
      closeButton: true,
      className: 'room-sheet',
      heights: {
        medium: (H) => Math.round(H * 0.56),
        large: (H) => Math.round(H * 0.94),
      },
    });
  const sheet = roomSheet;
  openPanel?.destroy();
  openPanel = null;
  let dock = sheet.sheet.querySelector('.sheet-dock');
  if (!dock) {
    dock = h('<div class="sheet-dock"></div>');
    sheet.sheet.appendChild(dock);
  }
  dock.innerHTML = '';
  sheet.body.innerHTML = '';
  const band = bandOf(s);
  const hub = c.hub(s);
  sheet.sheet.dataset.band = band;
  sheet.head.innerHTML = `<div class="rs-top tele" data-band="${band}"><i class="bd"></i><span>${esc(BAND_NAME[band] || 'Room')}</span><span class="rs-live"><i></i>${s.live === false && !s.momentId ? 'Room' : 'Live room'}</span><span>·</span><span class="rs-place">${esc(s.place || '')}</span></div>
      <h2 class="sheet-title">${esc(s.title)}</h2>
      ${o.crew ? `<div class="rs-crew" style="--hue:${o.crew.hue}">${icon('users')}<span>Watching with <b>${esc(o.crew.name)}</b> · ${12 + (o.crew.members % 40)} crew here</span><em class="badge-example">Example</em></div>` : ''}
      ${s.illustrative ? '<div class="rs-ill tele">Illustrative reconstruction · tracks are synthetic</div>' : ''}`;
  const panel = createRoomPanel(c, s, {
    body: sheet.body,
    dock,
    switchHost: sheet.head,
    lane,
    focusPost: o.focusPost,
    onCompose: (x, y) => c.getComposer().open(x, y),
    onCapture: (x, y) => {
      sheet.close();
      c.onCapture(x, y);
    },
    flyTo: (a) => {
      sheet.setDetent('medium');
      c.globe?.flyTo?.({
        lon: a.lon,
        lat: a.lat,
        height: 2500,
        pitch: -45,
        duration: 1.6,
      });
    },
    scrub: null,
    onLane: (l) => {
      sheet.sheet.dataset.lane = l;
    },
  });
  openPanel = panel;
  const detent =
    o.detent || (lane === 'live' && c.ctx.onShowGlobe ? 'medium' : 'large');
  if (c.ctx.onShowGlobe) c.ctx.onShowGlobe(s);
  sheet.open(detent);
  const offClose = sheet.on('close', () => {
    offClose?.();
    if (openPanel === panel) {
      panel.destroy();
      openPanel = null;
    }
  });
  haptic('light');
  void hub;
  return { sheet, panel, close: () => sheet.close() };
}

/* ---------------- Tabs ---------------- */

export function mountRoomsTab(el, ctx = {}) {
  const c = socialCore(ctx);
  let api = null;
  const p = import('./roomsTab.js').then(
    (m) => (api = m.createRoomsTab(el, c)),
  );
  return {
    refresh: () => p.then(() => api?.refresh()),
    destroy: () => p.then(() => api?.destroy()),
  };
}

export function mountYouTab(el, ctx = {}) {
  const c = socialCore(ctx);
  let api = null;
  const p = import('./you.js').then((m) => {
    api = m.createYou(el, {
      bindScroll: c.ctx.bindScroll || (() => {}),
      getSituations: c.situations,
      onOpenSituation: (s) => c.ctx.onOpenSituation?.(s),
      onVerify: (b) => c.ctx.onVerify?.(b),
      onCredits: () => c.ctx.onCredits?.(),
      rooms: c.rooms,
      rt: c.rt,
      onOpenRoom: (s, postId) =>
        openRoom(s, { lane: 'record', focusPost: postId }),
      onLocate: async () => c.ctx.onLocate?.() || c.getLocation(),
      core: c,
    });
    api.render();
    return api;
  });
  return {
    render: () => p.then(() => api?.render()),
    destroy: () => p.then(() => (el.innerHTML = '')),
  };
}

/** Twitch-style chat overlay for the Moment player. */
export function chatOverlay(el, ctx = {}) {
  const c = socialCore(ctx);
  return mountChatOverlay(c, el, {
    globe: ctx.globe || c.globe,
    moment: ctx.moment,
    maxLines: ctx.maxLines,
  });
}

/** Open Need eyes requests near a point (sync; for Today and Capture). */
export function needEyesNear(lonlat, km = 25) {
  const c = socialCore();
  return c.needs.near(lonlat, km);
}

export function onSocial(event, fn) {
  return socialCore().on(event, fn);
}

export async function momentCaptures(momentId) {
  const rec = await get('kv', 'momentCaptures').catch(() => null);
  return rec?.map?.[momentId] || [];
}

export function openCrew(id, o) {
  return socialCore().crews.open(id, o);
}
export function openNeedEyes(situation) {
  return socialCore().needs.openCreate(situation);
}
export function signalNow() {
  const c = socialCore();
  return { score: c.signal.cached, tier: c.signal.tier() };
}
export { celebrate, viewerCount };
