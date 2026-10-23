/**
 * God's Eye — mobile shell (DESIGN.md §12).
 * Tabs: Today · Live · Capture · Rooms · You. Mounts the one persistent globe
 * (lazy), paints Today from the last good snapshot before the globe is up,
 * and wires the time machine, Moments, dossiers, search, watch and the
 * director together. Rooms, You and room chat come from the social agent's
 * mount points (ui/social.js) when present.
 */

import {
  $,
  store,
  applyMotionPref,
  reducedMotion,
  toast,
  haptic,
} from './ui/dom.js';
import { icon } from './ui/icons.js';
import { createTabBar } from './ui/tabbar.js';
import { mountGlobe, contractReport } from './ui/globeHost.js';
import { createFeed } from './ui/feed.js';
import { createWorld } from './ui/world.js';
import { createGlobeChrome } from './ui/globeChrome.js';
import { createThreads } from './ui/threads.js';
import { createYou } from './ui/you.js';
import { createSearch } from './ui/search.js';
import { createInspector } from './ui/inspector.js';
import { createNarrative } from './ui/narrative.js';
import { createRealtime } from './ui/realtime.js';
import { createRooms } from './ui/rooms.js';
import { createAttach } from './ui/attach.js';
import { createLiveViewer } from './ui/liveViewer.js';
import { createToday } from './ui/today.js';
import { createWatch } from './ui/watch.js';
import { createSkySheet } from './ui/skySheet.js';
import { createDossier } from './ui/dossier.js';
import { createMomentPlayer } from './ui/moment.js';
import { createDirector } from './ui/director.js';
import { social, callSocial } from './ui/socialBridge.js';
import { PLACES } from './ui/shim3.js';
import { distKm, llShort } from './ui/bands.js';

const app = $('#app');
const stage = $('#stage');
const views = {
  today: $('#view-today'),
  live: $('#view-live'),
  rooms: $('#view-rooms'),
  you: $('#view-you'),
  capture: $('#view-capture'),
};
const paneSheets = $('#pane-sheets');

applyMotionPref();
const isTwoPane = () =>
  getComputedStyle(app).getPropertyValue('--two-pane').trim() === '1';

/* ---------------- Globe (lazy, persistent) ---------------- */
let globe = null;
let situationsCache = null;
const globeReady = mountGlobe($('#globe'), { quality: store.get('quality') })
  .then((g) => {
    globe = g;
    app.dataset.engine = g.kind;
    delete app.dataset.booting;
    return g;
  })
  .catch((err) => {
    console.error('Globe failed to mount', err);
    throw err;
  });

async function getSituations({ fresh = false } = {}) {
  const g = await globeReady;
  if (!situationsCache || fresh) {
    const [live, places] = await Promise.all([
      g.situations(userLoc ? { observer: userLoc } : undefined),
      rooms.places().catch(() => []),
    ]);
    // Places people started from a capture have rooms too.
    situationsCache = [
      ...live,
      ...places.filter((p) => !live.some((s) => String(s.id) === p.id)),
    ];
    saveSnapshot(live);
  }
  return situationsCache;
}
const situationById = (id) =>
  situationsCache?.find((s) => String(s.id) === String(id)) || null;

/* ---------------- Instant first frame ---------------- */
const SNAP_KEY = 'gev.sitcache.v1';
function readSnapshot() {
  try {
    const j = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
    if (Array.isArray(j?.list) && j.list.length)
      return j.list.map((s) => ({ ...s, cached: true, capturedAt: j.at }));
  } catch {
    /* ignore */
  }
  return null;
}
function saveSnapshot(list) {
  if (!list?.length || list[0]?.cached) return;
  try {
    const slim = list.slice(0, 40).map((s) => {
      const { media, ...rest } = s;
      return media ? { ...rest, media: { ...media } } : rest;
    });
    localStorage.setItem(
      SNAP_KEY,
      JSON.stringify({ at: Date.now(), list: slim }),
    );
  } catch {
    /* quota: the engine's own cache still covers us */
  }
}

/* ---------------- Tabs ---------------- */
let current = 'today';
const tabbar = createTabBar($('#tabbar'), {
  onSelect: (tab, { reselect }) => {
    if (reselect) {
      const v = views[tab];
      if (v?.scrollTop > 0)
        v.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      else if (tab === 'live') globe?.home();
      return;
    }
    selectTab(tab);
  },
  onSearch: () => search?.open(),
  onAccessory: (s) => (s.entityId ? openEntity(s.entityId) : openSituation(s)),
});

let capture = null;
let you = null;
let world = null;
let chrome = null;
let threads = null;
let search = null;
let inspector = null;
let narrative = null;
let liveViewer = null;
let dossier = null;
let player = null;
let sky = null;
let lastCam = null;

function applyTab(tab) {
  const prev = current;
  current = tab;
  app.dataset.tab = tab;
  const two = isTwoPane();
  for (const [id, el] of Object.entries(views)) {
    if (id === 'capture') el.hidden = tab !== 'capture';
    else if (id === 'live') el.hidden = !(two && tab === 'live');
    else el.hidden = id !== tab && !(two && tab === 'capture' && id === prev);
  }
  tabbar.select(tab);
  // A camera or sensor failure must never trap someone in Capture.
  try {
    if (tab === 'capture') {
      globe?.pause();
      capture?.enter();
    } else if (prev === 'capture') capture?.leave();
  } catch (err) {
    console.warn('capture', err);
  }
  if (tab !== 'capture') updateGlobeActivity();
  if (tab === 'you') you?.render?.();
  if (tab === 'rooms') threads?.refresh?.();
  if (tab === 'live' && two) chrome?.renderLeadView();
  if (tab !== 'live') chrome?.hidePick();
}
// Paint the right panes in the first frame (on a tablet the Globe pane
// would otherwise cover Today until the engine is up).
applyTab(current);

function selectTab(tab) {
  if (tab === current) return;
  if (player?.current) player.close();
  if (world?.current && !isTwoPane()) world.close();
  if (narrative?.active) narrative.stop();
  // Switch synchronously. A View Transition waits on frames the globe and
  // the camera can hold up, which left taps on the tab bar unanswered.
  applyTab(tab);
  const v = views[tab];
  if (v && !v.hidden && !reducedMotion()) {
    v.classList.remove('view-enter');
    void v.offsetWidth;
    v.classList.add('view-enter');
  }
}

/** Keep the globe rendering only when someone can see it. */
let pauseTimer = 0;
function updateGlobeActivity() {
  if (!globe) return;
  clearTimeout(pauseTimer);
  const visible =
    document.visibilityState === 'visible' &&
    current !== 'capture' &&
    (isTwoPane() ||
      current === 'live' ||
      app.classList.contains('is-world') ||
      app.classList.contains('is-moment'));
  if (visible) globe.resume();
  else pauseTimer = setTimeout(() => globe.pause(), 700);
}
document.addEventListener('visibilitychange', updateGlobeActivity);
new MutationObserver(updateGlobeActivity).observe(app, {
  attributes: true,
  attributeFilter: ['class'],
});

/* ---------------- Realtime + rooms ---------------- */
const rt = createRealtime();
const rooms = createRooms({ rt });

/** The feed is built before the globe mounts; it talks to it lazily. */
const lazyGlobe = {
  thumbnail: async (s, o) => (await globeReady).thumbnail(s, o),
  eyeFrameUrl: (id) => globe?.eyeFrameUrl(id) ?? null,
  setViewer: (v) => globeReady.then((g) => g.setViewer(v)).catch(() => {}),
};

function locate({ quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const loc = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          acc: p.coords.accuracy,
        };
        userLoc = loc;
        watch?.setHome(loc);
        resolve(loc);
      },
      () => {
        if (!quiet)
          toast('Location unavailable — using the demo home', {
            icon: icon('location'),
          });
        resolve(null);
      },
      { maximumAge: 600000, timeout: 10000 },
    );
  });
}
let userLoc = null;

/* ---------------- Today: brief + feed ---------------- */
const feed = createFeed(views.today, {
  getSituations: () => getSituations({ fresh: true }),
  onOpen: (s, card) =>
    s.momentId && /circling/.test(s.kind || '')
      ? openMoment(s.momentId)
      : openSituation(s, card),
  onOpenRoom: (s, card) => openSituation(s, card, { tab: 'room' }),
  onWitness: (w, card) => openWitness(w, card),
  onCapture: () => selectTab('capture'),
  onLocate: () => locate(),
  bindScroll: (el) => tabbar.bindScroll(el),
  globe: lazyGlobe,
  rooms,
  rt,
});

// Globe-dependent pieces are created once it is up; until then, stubs.
const lazy = {
  entity: (ref) => globeReady.then((g) => g.entity(ref)),
  skyNow: (o) => globeReady.then((g) => g.skyNow(o)),
  detections: () => globe?.detections() || [],
  on: (e, f) => globeReady.then((g) => g.on(e, f)),
  raw: null,
};
const watch = createWatch({
  host: paneSheets,
  globe: new Proxy(lazy, {
    get: (t, k) => (globe && k in globe ? globe[k] : t[k]),
  }),
  getSituations: () => getSituations(),
  onOpenSituation: (s) => openSituation(situationById(s.id) || s),
  onOpenEntity: (id) => openEntity(id),
});
const today = createToday(feed.briefSlot, {
  getSituations: () => getSituations(),
  watch,
  getHome: () => watch.home(),
  onOpenSituation: (id) => openSituationById(id),
  onOpenEntity: (id) => openEntity(id),
  onOpenMoment: (id) => openMoment(id),
  onSky: () => sky?.open(),
  onWatch: () => watch.open(),
});

// Paint now from the last good snapshot; hydrate live below.
const snap = readSnapshot();
let primed = false;
if (snap) primed = feed.prime(snap);
if (snap) today.setSituations(snap);
const fetchJson = (url) =>
  fetch(url)
    .then((r) =>
      r.ok && /json/.test(r.headers.get('content-type') || '')
        ? r.json()
        : null,
    )
    .catch(() => null);
// No snapshot on this device yet: the bundled one (real data, see capturedAt).
if (!snap)
  fetchJson(new URL('./demo/snapshot.json', import.meta.url).href).then((j) => {
    const list = Array.isArray(j) ? j : j?.situations;
    if (!list?.length || situationsCache) return;
    const at = j?.capturedAt || null;
    const norm = list.map((s) => ({
      ...s,
      family: String(s.family || 'infra').toLowerCase(),
      cached: true,
      capturedAt: s.capturedAt || at,
    }));
    if (feed.prime(norm)) {
      primed = true;
      today.setSituations(norm);
    }
  });
// Today's Moment paints from the bundle before the globe is up.
fetchJson(
  new URL('./demo/moments/empire-state.json', import.meta.url).href,
).then((m) => m?.tracks && today.setMoment(m));

// Distances appear by themselves when location was already granted.
navigator.permissions
  ?.query({ name: 'geolocation' })
  .then((st) => {
    if (st.state === 'granted')
      locate({ quiet: true }).then((l) => l && feed.setLocation(l));
  })
  .catch(() => {});

/* ---------------- Navigation helpers ---------------- */
function openSituation(s, card = null, opts = {}) {
  if (!world || !s) return;
  if (player?.current) player.close();
  if (current === 'capture') applyTab('today');
  if (narrative?.active) narrative.stop();
  world.open(s, card, opts);
}
async function openSituationById(id, opts = {}) {
  await getSituations();
  const s = situationById(id);
  if (!s) return false;
  if (s.momentId && /circling/.test(s.kind || '')) {
    openMoment(s.momentId);
    return true;
  }
  if (dossier?.isOpen && !opts.keepDossier) dossier.close();
  openSituation(s, feed.cardFor(s.id));
  return true;
}
async function openEntity(ref, o = {}) {
  await globeReady;
  if (/^situation:/.test(String(ref)) && !o.asDossier) {
    const ok = await openSituationById(String(ref).slice(10));
    if (ok) return;
  }
  if (/^moment:[^:]+$/.test(String(ref)) && !o.asDossier)
    return openMoment(String(ref).slice(7));
  dossier.open(ref, o);
}
async function openMoment(id, o = {}) {
  await globeReady;
  if (world?.current) await world.close();
  dossier?.close();
  sky?.close();
  if (!isTwoPane() && current !== 'live' && current !== 'today')
    applyTab('today');
  return player.open(id, o);
}

/** Rooms: the social agent's lanes when present, else the situation room. */
async function openRoom(target, { lane = 'live' } = {}) {
  const r = await callSocial('openRoom', target, { lane });
  if (r.ok) return true;
  let s = null;
  if (target?.time && target?.tracks) {
    await getSituations();
    s = situationsCache.find((x) => x.momentId === target.id) || null;
    player?.close();
  } else if (target?.kind === 'situation' || target?.situation)
    s =
      target.situation ||
      situationById(String(target.id).replace(/^situation:/, ''));
  else if (target?.id && situationById(target.id)) s = situationById(target.id);
  else if (target?.links) {
    const l = target.links.find((x) => x.kind === 'situation');
    if (l) s = situationById(l.id.replace(/^situation:/, ''));
    if (!s && target.links.some((x) => x.kind === 'moment')) {
      await getSituations();
      s = situationsCache.find((x) => x.momentId) || null;
    }
  }
  if (!s) {
    toast('No room for this yet · start one from Capture', {
      icon: icon('rooms'),
    });
    return false;
  }
  dossier?.close();
  openSituation(s, null, { tab: 'room' });
  return true;
}

async function openWitness(w, card) {
  if (w.liveNow) {
    world?.watchLive?.(w);
    return;
  }
  const sid = w.post?.room;
  const s = sid ? situationById(sid) : null;
  if (s) return openSituation(s, card, { tab: 'room', focusPost: w.post.id });
  if (w.bundle) inspector?.open(w.bundle);
  else
    toast('Unverified upload · post it to a room from Capture', {
      icon: icon('upload'),
    });
}

/** The tab-bar accessory: the first followed thing, with its status. */
async function refreshAccessory() {
  const followed = store.get('followed') || [];
  for (const id of followed) {
    const s = situationById(id);
    if (s) return tabbar.setAccessory(s);
    if (!globe) continue;
    const st = await watch
      .statusOf(id, situationsCache || [])
      .catch(() => null);
    if (st)
      return tabbar.setAccessory({
        title: st.title,
        status: st.status,
        family:
          st.band === 'orbit' ? 'orbit' : st.band === 'sky' ? 'sky' : 'ground',
        icon: st.icon,
        entityId: id,
        metrics: [],
      });
  }
  tabbar.setAccessory(null);
}

/** Everything follows the clock: globe, open sheet, room posts. */
function onClock(d) {
  world?.setClock?.(d);
  window.dispatchEvent(
    new CustomEvent('gev:clock', { detail: { t: d ? +d : null } }),
  );
}

/** Range select → a Moment from the recorder, opened at once. */
async function clipMoment({ start, end }) {
  const g = await globeReady;
  const c = lastCam || { lon: -73.98, lat: 40.75, height: 400e3 };
  const radius = Math.max(15, Math.min(600, (c.height || 400e3) / 1000 / 1.5));
  // What the recorder (or the bundled recording) holds for that range,
  // else whatever is live around the camera.
  const recorded = g
    .historyNear((start + end) / 2, c.lon, c.lat, radius)
    .slice(0, 12);
  const fromRecord = recorded.length >= 2;
  const near = fromRecord
    ? recorded
    : g
        .contactsNear(c.lon, c.lat, radius)
        .filter((x) => /aircraft|helicopter|military|ship|vessel/.test(x.kind))
        .slice(0, 6);
  const archive = g.history()?.archive;
  const inArchive =
    archive && start >= archive.start - 60e3 && end <= archive.end + 60e3;
  const tracks = (
    await Promise.all(
      near.map(async (x) => {
        const pts = (await g.trackOf(x.id)).filter(
          (p) => p.t >= start - 30e3 && p.t <= end + 30e3,
        );
        if (pts.length < 2) return null;
        return {
          id: String(x.id),
          kind: x.kind,
          label: x.title || String(x.id),
          operator:
            {
              aircraft: 'Aircraft · ADS-B',
              helicopter: 'Helicopter · ADS-B',
              military: 'Military · ADS-B',
              ship: 'Vessel · AIS',
              vessel: 'Vessel · AIS',
            }[x.kind] || x.kind,
          points: pts.map((p) => ({
            t: p.t,
            lon: p.lon,
            lat: p.lat,
            altM: p.altM ?? x.altM ?? 0,
          })),
        };
      }),
    )
  ).filter(Boolean);
  const evts = g.timeline({ from: start, to: end });
  let place = PLACES.map((p) => ({ p, d: distKm(c, p) })).sort(
    (a, b) => a.d - b.d,
  )[0];
  // Name the clip honestly: a landmark only when the view is that close,
  // else the recording's region, else coordinates.
  const region = inArchive
    ? archive.regions?.find(
        (r) =>
          c.lat >= r.bbox.south &&
          c.lat <= r.bbox.north &&
          c.lon >= r.bbox.west &&
          c.lon <= r.bbox.east,
      )
    : null;
  const placeName =
    place && place.d < Math.min(radius, 25)
      ? place.p.name
      : region?.label || llShort(c.lat, c.lon, 2);
  const m = {
    id: `clip-${Math.round(start / 1000).toString(36)}`,
    title: `Clip · ${placeName}`,
    place: placeName,
    lon: c.lon,
    lat: c.lat,
    time: { start, end },
    illustrative: false,
    simulated: !!g.isStub,
    cameraPath: [
      {
        t: start,
        lon: c.lon,
        lat: c.lat,
        height: Math.min(c.height || 400e3, 900e3),
      },
    ],
    tracks,
    captures: [],
    chat: [],
    posts: evts.map((e) => ({
      t: e.t,
      handle: 'Record',
      kind: 'context',
      text: e.title,
      votes: { corroborate: 0, dispute: 0 },
    })),
    sources: [
      {
        name: g.isStub
          ? 'Simulated recorder (offline stub)'
          : inArchive
            ? 'Bundled recording (real positions, captured ' +
              new Date(archive.start).toISOString().slice(0, 10) +
              ')'
            : 'On-device recorder',
        detail: `${tracks.length} tracks · ${evts.length} events · ${new Date(start).toISOString().slice(11, 16)}–${new Date(end).toISOString().slice(11, 16)}Z`,
      },
    ],
  };
  g.addClip(m);
  toast(`Moment clipped · ${tracks.length} tracks, ${evts.length} events`, {
    icon: icon('film'),
  });
  return openMoment(m, { speed: 60 });
}

/* ---------------- Boot dependent modules ---------------- */
let director = null;
globeReady
  .then(async (g) => {
    g.on('camera', (c) => c && (lastCam = c));
    world = createWorld({
      app,
      stage,
      globe: g,
      getCard: (id) => feed.cardFor(id),
      isTwoPane,
      onThread: (s) => openThreadFor(s),
      onFollowChange: refreshAccessory,
      rooms,
      rt,
      getChrome: () => chrome,
      getLocation: () => userLoc,
      onCapture: (s, o) => captureFor(s, o),
      onWatchLive: (w) => liveViewer?.open(w),
    });
    world.on('open', (s) => feed.select(s.id));
    world.on('close', () => feed.select(null));
    dossier = createDossier({
      globe: g,
      host: paneSheets,
      onOpenSituation: (id) => openSituationById(id),
      onOpenMoment: (id) => openMoment(id),
      onOpenRoom: (d) => openRoom(d),
      onShowOnTime: (d, t) => showOnTime(d, t),
      watch,
    });
    player = createMomentPlayer({
      app,
      globe: g,
      isTwoPane,
      onExit: () => {
        chrome?.ribbon.goLive();
        updateGlobeActivity();
      },
      onOpenEntity: (id) => dossier.open(id),
      onOpenRoom: (m) => openRoom(m, { lane: 'live' }),
    });
    sky = createSkySheet({
      host: paneSheets,
      globe: g,
      getHome: () => watch.home(),
      onOpenEntity: (id) => dossier.open(id),
    });
    chrome = createGlobeChrome({
      chrome: $('#globe-chrome'),
      stage,
      leadView: views.live,
      globe: g,
      onOpenSituation: (s) =>
        s.momentId && /circling/.test(s.kind || '')
          ? openMoment(s.momentId)
          : openSituation(s),
      onThread: (s) => openThreadFor(s),
      getSituations,
      isTwoPane,
      onClock,
      onClip: (r) => clipMoment(r),
      onPick: (p) => {
        // Tapping any thing on the globe opens its dossier.
        if (!p || p.kind === 'situation' || p.kind === 'pin') return false;
        dossier.open(p, { detent: 'medium' });
        return true;
      },
      onPin: (p) => {
        const m = /^post:(.+)$/.exec(p.id || '');
        if (!m) return false;
        const sid = m[1].split('~')[0];
        const s = situationById(sid);
        if (!s) return false;
        openSituation(s, null, { tab: 'room', focusPost: m[1] });
        return true;
      },
    });
    narrative = createNarrative({
      app,
      chrome: $('#globe-chrome'),
      globe: g,
      ribbon: chrome.ribbon,
      getSituation: situationById,
    });
    inspector = createInspector();
    search = createSearch({
      host: $('#sheets'),
      getSituations,
      globe: g,
      onOpenSituation: (id) => openSituationById(id),
      onOpenEntity: (id) => openEntity(id, { asDossier: true }),
      onOpenMoment: (id) => openMoment(id),
      onLayer: (id) => {
        g.setLayer(id, true);
        chrome.refreshDock();
        selectTab('live');
        toast('Lens on', { icon: icon('layers') });
      },
    });
    liveViewer = createLiveViewer({ rt, globe: g });

    // Rooms and You: the social agent's tabs when present.
    const ctx = {
      globe: g,
      rooms,
      rt,
      getSituations,
      bindScroll: (el) => tabbar.bindScroll(el),
      openSituation: (s, o) => openSituation(s, null, o),
      openMoment,
      openEntity,
      openRoom,
      openWatch: () => watch.open(),
      watch,
      selectTab,
      getLocation: () => userLoc || watch.home(),
      getTime: () => chrome?.ribbon?.time || null,
      onVerify: (b) => inspector.open(b),
    };
    Object.assign(ctx, {
      store,
      onCapture: (s, o) => captureFor(s, o),
      onOpenSituation: (s) => openSituation(s),
      onPlayMoment: (m) => openMoment(m),
      onShowGlobe: (s) => {
        // The Live lane watches the place: hearts rise from it on the globe.
        if (!isTwoPane() && current !== 'live') {
          if (world?.current) world.close();
          applyTab('live');
        }
        const subj = s.moment?.subject;
        const c = subj ? { lon: subj.lon, lat: subj.lat } : s.camera || {};
        const lon = c.lon ?? s.lon;
        const lat = c.lat ?? s.lat;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        frameForSheet(
          { lon, lat },
          {
            distM: subj
              ? 3000
              : Math.max(2500, Math.min((c.height || 3000) * 0.9, 6000)),
          },
        );
      },
      onCredits: () => chrome.openCredits(),
      onLocate: () => locate(),
      watch: { summary: () => watch.summary(), open: () => watch.open() },
      sheetHost: paneSheets,
    });
    const sm = await social();
    try {
      sm?.configureSocial?.(ctx);
    } catch (err) {
      console.warn('[social] configureSocial failed', err);
    }
    if (typeof sm?.mountRoomsTab === 'function') {
      try {
        threads = (await sm.mountRoomsTab(views.rooms, ctx)) || null;
      } catch (err) {
        console.warn('[social] mountRoomsTab failed', err);
      }
    }
    if (!threads) threads = mountThreadsFallback(g);
    let youMounted = false;
    if (typeof sm?.mountYouTab === 'function') {
      try {
        you = (await sm.mountYouTab(views.you, ctx)) || { render() {} };
        youMounted = true;
      } catch (err) {
        console.warn('[social] mountYouTab failed', err);
      }
    }
    if (!youMounted)
      you = createYou(views.you, {
        bindScroll: (el) => tabbar.bindScroll(el),
        getSituations,
        onOpenSituation: (s) => openSituation(s),
        onVerify: (b) => inspector.open(b),
        onCredits: () => chrome.openCredits(),
        rooms,
        rt,
        onOpenRoom: (s, postId) =>
          openSituation(s, null, { tab: 'room', focusPost: postId }),
        onLocate: () => locate(),
      });

    const attach = createAttach({
      rooms,
      globe: g,
      getSituations,
      onPosted: async (s, p) => {
        situationsCache = null;
        await getSituations();
        feed.refreshSocial();
        threads?.refresh?.();
        if (current === 'you') you.render?.();
        setTimeout(() => {
          if (current !== 'capture') return;
          openSituation(situationById(s.id) || s, null, {
            tab: 'room',
            focusPost: p.id,
          });
        }, 900);
      },
    });
    const { createCapture } = await import('./ui/capture.js');
    capture = createCapture(views.capture, {
      globe: g,
      rt,
      attach,
      getLocation: () => userLoc,
      onSealed: () => {
        feed.refreshSocial();
        if (current === 'you') you.render?.();
      },
      onVerify: (b) => inspector.open(b),
    });
    // Holograms and witness posts you left stay pinned on the globe.
    rooms
      .myPosts()
      .then((list) => {
        for (const p of list)
          if (
            p.anchor &&
            Number.isFinite(p.anchor.lat) &&
            (p.hologram || p.evidence?.sealed)
          )
            g.addPin({
              id: `post:${p.id}`,
              lon: p.anchor.lon,
              lat: p.anchor.lat,
              kind: p.hologram ? 'hologram' : 'witness',
              label: p.hologram ? 'Hologram' : 'Your witness',
            });
      })
      .catch(() => {});

    // The back chevron also stops a playing narrative.
    $('.world-back').addEventListener(
      'click',
      (e) => {
        if (narrative.active) {
          e.stopImmediatePropagation();
          narrative.stop();
          haptic('tick');
        }
      },
      true,
    );

    // Instant first frame, second chance: the engine's cached snapshot.
    if (!primed) {
      const cached = await Promise.race([
        g.situationsCached(),
        new Promise((r) => setTimeout(() => r([]), 400)),
      ]);
      if (cached.length && feed.prime(cached)) {
        primed = true;
        today.setSituations(cached);
      }
    }
    // The director is ready as soon as the shell is: a presenter must never
    // wait on the first live situations() call (it can take a minute).
    director = buildDirector(g);
    director.bindTripleTap(feed.titleEl);
    today.setGlobe(g);
    await feed.load({ quiet: primed });
    const sits = await getSituations();
    if (primed) feed.markUpdated();
    today.setSituations(sits);
    const refreshTimeline = () =>
      chrome.setTimeline(
        g.timeline({
          from: Date.now() - 24 * 3600e3,
          to: Date.now() + 72 * 3600e3,
        }),
      );
    refreshTimeline();
    setTimeout(refreshTimeline, 1500);
    setInterval(refreshTimeline, 60e3);
    seedFollows(g);
    refreshAccessory();
    store.on((k) => k === 'followed' && refreshAccessory());
    setInterval(refreshAccessory, 20e3);
    watch
      .evaluate({ quiet: true })
      .then(() => setTimeout(() => watch.evaluate(), 4000));
    applyTab(current);

    // Deep links: #s=<situation id>, #m=<moment id>, #e=<entity id>
    const hs = /#s=([^&]+)/.exec(location.hash);
    if (hs) {
      const s = situationById(decodeURIComponent(hs[1]));
      if (s) openSituation(s, feed.cardFor(s.id));
    }
    const hm = /#m=([^&]+)/.exec(location.hash);
    if (hm) openMoment(decodeURIComponent(hm[1]));
    const he = /#e=([^&]+)/.exec(location.hash);
    if (he) openEntity(decodeURIComponent(he[1]), { asDossier: true });
    if (g.isStub)
      console.info(
        '[mobile] running on the offline stub engine',
        contractReport,
      );
  })
  .catch((err) => {
    console.error(err);
    toast('The globe could not start on this device');
  });

function mountThreadsFallback(g) {
  const th = createThreads(views.rooms, {
    bindScroll: (el) => tabbar.bindScroll(el),
    rooms,
    rt,
    getSituations,
    onOpenRoom: (s) => openSituation(s, null, { tab: 'room' }),
    onPlay: (thread) => {
      if (world.current) world.close();
      narrative.play(thread);
    },
    onShowOnGlobe: async (thread, o) => {
      const s = situationById(thread.id);
      if (s) await world.open(s);
      else {
        app.classList.add('is-world');
        g.resume();
      }
      world.sheet.setDetent?.('peek');
      g.flyTo({
        lon: o.lon,
        lat: o.lat,
        height: 7000,
        pitch: -40,
        duration: 2,
      });
    },
  });
  return th;
}

/** Follow the ISS on a first run, so Today's watch and the accessory have life. */
async function seedFollows(g) {
  try {
    if (localStorage.getItem('gev.seeded3')) return;
    localStorage.setItem('gev.seeded3', '1');
  } catch {
    return;
  }
  const iss = (await g.search('ISS')).find((r) => r.kind === 'satellite');
  if (iss && !store.isFollowed(iss.id)) store.toggleFollow(iss.id);
}

/** "Show on time machine" from a dossier. */
async function showOnTime(d, t) {
  if (/^(moment|capture):/.test(d.id) && player) {
    const mid = d.id.split(':')[1];
    dossier.close();
    return openMoment(mid, { at: t ?? null, speed: 10 });
  }
  const ts = t ?? d.track?.[0]?.t ?? d.events?.[0]?.t ?? Date.now() - 3600e3;
  if (!isTwoPane()) {
    dossier.sheet.setDetent('medium');
    selectTab('live');
  }
  chrome.ribbon.jump(ts, { play: t == null, speed: 60 });
}

async function captureFor(s, opts = {}) {
  if (world?.current && !isTwoPane()) await world.close();
  selectTab('capture');
  capture?.attachTo?.(s, opts);
}

async function openThreadFor(s) {
  if (!threads?.openById) {
    openSituation(s, null, { tab: 'room' });
    return;
  }
  if (world?.current) await world.close();
  const id =
    s.thread || (s.kind === 'reconstruction' ? s.id : threads.startDraft(s));
  selectTab('rooms');
  await threads.openById(id);
  if (!s.thread && s.kind !== 'reconstruction')
    toast('Draft thread started · observation recorded', {
      icon: icon('threads'),
    });
}

/**
 * An oblique view of a place, framed into the part of the map a sheet leaves
 * visible: on a phone the medium sheet covers the lower half, so the place
 * sits in the upper third; on iPad (sheets in the leading pane) at the
 * centre, seen more steeply, leaving room above for rising reactions. The default
 * heading looks north, up Midtown toward Central Park, which keeps
 * the airports' dense live traffic (LaGuardia, JFK, Newark) out of frame.
 */
function frameForSheet(
  { lon, lat },
  { distM = 3000, rayDeg = 30, heading = 12, duration = 1.6 } = {},
) {
  if (!globe) return Promise.resolve();
  const r = stage.getBoundingClientRect();
  const W = r.width || 1;
  const H = r.height || 1;
  const fov = globe.raw?.viewer?.camera?.frustum?.fov ?? Math.PI / 3;
  const tanHalfV = W > H ? (Math.tan(fov / 2) * H) / W : Math.tan(fov / 2);
  // On a tablet the whole stage is free: look steeper, place at centre.
  if (isTwoPane()) rayDeg = Math.max(rayDeg, 42);
  const yFrac = isTwoPane() ? 0.5 : 0.27;
  const above = Math.atan((0.5 - yFrac) * 2 * tanHalfV) * (180 / Math.PI);
  const pitch = Math.max(-88, -rayDeg - above);
  const ray = (rayDeg * Math.PI) / 180;
  const back = distM * Math.cos(ray);
  const hd = ((heading + 180) * Math.PI) / 180;
  return globe.flyTo({
    lon:
      lon + (back * Math.sin(hd)) / (111320 * Math.cos((lat * Math.PI) / 180)),
    lat: lat + (back * Math.cos(hd)) / 111320,
    height: 12 + distM * Math.sin(ray),
    heading,
    pitch,
    eye: true,
    duration,
  });
}

/**
 * The busiest region of the bundled recording: a camera over it and the
 * instant to start replaying (20 min before its busiest 5 minutes).
 */
async function busiestRecording(g) {
  const arch = (await g.loadHistory()) || g.history()?.archive;
  const regions = arch?.regions || [];
  if (!regions.length) return null;
  const r = regions
    .slice()
    .sort((a, b) => (b.busiest?.aircraft || 0) - (a.busiest?.aircraft || 0))[0];
  const b = r.bbox;
  const lat = (b.south + b.north) / 2;
  const widthKm =
    (b.east - b.west) * 111 * Math.cos((lat * Math.PI) / 180) * 0.62;
  return {
    label: r.label,
    from: Math.max(r.start, (r.busiest?.t ?? r.start) - 20 * 60e3),
    camera: {
      lon: (b.west + b.east) / 2,
      // A little south: the ribbon and tab bar cover the bottom of the map.
      lat: lat - (b.north - b.south) * 0.12,
      height: Math.max(160e3, Math.min(700e3, widthKm * 1000 * 0.9)),
    },
  };
}

/** Director: a steady stream of reactions rising from a place. */
let reactTimer = 0;
function reactionStream(g, { lon, lat }, ms = 45000) {
  clearInterval(reactTimer);
  const kinds = ['heart', 'heart', 'fire', 'heart', 'eyes', 'wow', 'heart'];
  const until = Date.now() + ms;
  let i = 0;
  reactTimer = setInterval(() => {
    if (Date.now() > until) return clearInterval(reactTimer);
    g.react({
      lon: lon + (Math.random() - 0.5) * 0.006,
      lat: lat + (Math.random() - 0.5) * 0.005,
      kind: kinds[i++ % kinds.length],
      count: 2 + Math.round(Math.random() * 2),
    });
  }, 650);
}

/* ---------------- Director (demo mode) ---------------- */
function closeAll() {
  clearInterval(reactTimer);
  // Capture covers the globe (and on iPad the whole stage): leave it.
  if (current === 'capture') applyTab(isTwoPane() ? 'today' : 'live');
  watch.clearBanners();
  player?.close();
  dossier?.close();
  sky?.close();
  search?.close?.();
  if (world?.current) world.close();
  if (narrative?.active) narrative.stop();
  chrome?.ribbon.goLive();
  document
    .querySelectorAll('.sheet-layer:not([hidden]) .sheet-close')
    .forEach((b) => b.click());
}
const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));

function buildDirector(g) {
  const hero = () => g.momentOfTheDay();
  return createDirector({
    onReset: async () => {
      closeAll();
      try {
        localStorage.setItem('gev.lastVisit', String(Date.now() - 8 * 3600e3));
      } catch {
        /* ignore */
      }
      watch.reset();
      applyTab('today');
      views.today.scrollTo({ top: 0 });
      g.home();
      today.refresh();
    },
    beats: [
      {
        title: 'Today',
        note: 'The daily brief: since you last looked, today’s Moment, your sky',
        icon: 'today',
        run: async () => {
          closeAll();
          applyTab('today');
          views.today.scrollTo({ top: 0, behavior: 'smooth' });
        },
      },
      {
        title: 'Your sky now',
        note: 'Everything above you this minute',
        icon: 'dome',
        run: async () => {
          closeAll();
          applyTab('today');
          await settle(200);
          sky.open();
        },
      },
      {
        title: 'The Empire State Moment',
        note: 'Opens at the police helicopter’s arrival, playing at 10×',
        icon: 'film',
        run: async () => {
          closeAll();
          const m = await hero();
          const arrive = m.tracks?.[0]?.arriveAt ?? m.time.start + 150e3;
          await openMoment(m, { at: arrive - 20e3, speed: 10 });
        },
      },
      {
        title: 'The Live lane, with hearts',
        note: 'Watch party: chat, presence, hearts rising from the city',
        icon: 'rooms',
        run: async () => {
          closeAll();
          const m = await hero();
          // The Live lane over the globe: the room frames Midtown above the
          // sheet (onShowGlobe) and hearts rise from the city.
          // Never wait on a cold live situations() call.
          const list =
            situationsCache ||
            (await Promise.race([getSituations(), settle(1500)])) ||
            [];
          const sit = list.find((x) => x.momentId === m.id) || m;
          if (!isTwoPane()) selectTab('live');
          const ok = (
            await callSocial('openRoom', sit, {
              lane: 'live',
              detent: 'medium',
            })
          ).ok;
          if (!ok) await openRoom(m, { lane: 'live' });
          const subj = m.subject || { lon: m.lon, lat: m.lat };
          await settle(300);
          await frameForSheet(subj, { distM: 3000, duration: 1.2 });
          reactionStream(g, subj);
        },
      },
      {
        title: 'Need eyes',
        note: 'A room asks for coverage nearby; first eyes earn the byline',
        icon: 'eyes',
        run: async () => {
          closeAll();
          const home = watch.home();
          const sm = await social();
          const reqs =
            sm?.needEyesNear?.({ lon: home.lon, lat: home.lat }, 50) || [];
          const open = reqs.find((x) => x.status === 'open') || reqs[0];
          const core = sm?.socialCore?.();
          if (open && core?.needs?.openDetail) {
            if (!isTwoPane()) selectTab('capture');
            await settle(300);
            core.needs.openDetail(open.id);
          } else {
            selectTab('capture');
            toast('Need eyes · is the 7th St bridge underwater? 1.2 km away', {
              icon: icon('eyes'),
            });
          }
        },
      },
      {
        title: 'Capture',
        note: 'Look · Witness · Live · Upload, sealed on the device',
        icon: 'viewfinder',
        run: async () => {
          closeAll();
          selectTab('capture');
        },
      },
      {
        title: 'Dossier of a live aircraft',
        note: 'Identity, live state, track, links and receipts',
        icon: 'sky',
        run: async () => {
          closeAll();
          const home = watch.home();
          const s = await g.skyNow({ lon: home.lon, lat: home.lat });
          const ac =
            s?.aircraft?.find((a) => a.kind === 'aircraft') || s?.aircraft?.[0];
          if (!isTwoPane()) applyTab('live');
          if (ac) await dossier.open(ac.id, { detent: 'large' });
          else {
            const r =
              (await g.search('aircraft'))[0] || (await g.search('A'))[0];
            if (r) await dossier.open(r.id, { detent: 'large' });
          }
        },
      },
      {
        title: 'Link graph',
        note: 'Everything that aircraft touches, synchronized with the globe',
        icon: 'graph',
        run: async () => {
          closeAll();
          if (!isTwoPane()) applyTab('live');
          const m = await hero();
          const tr =
            m.tracks?.find((x) => /police/i.test(`${x.role} ${x.operator}`)) ||
            m.tracks?.[0];
          await dossier.open(`moment:${m.id}:${tr.id}`, { graph: true });
        },
      },
      {
        title: 'Time machine at 60×',
        note: 'Replays a real recording: where everything actually was',
        icon: 'clock',
        run: async () => {
          closeAll();
          selectTab('live');
          const r = await busiestRecording(g);
          if (r) {
            await g.flyTo({ ...r.camera, duration: 1.4 });
            await settle(300);
            chrome.ribbon.jump(r.from, { play: true, speed: 60 });
            toast(
              `Replaying a real recording · ${r.label} · ${new Date(r.from).toUTCString().slice(5, 11)}`,
              { icon: icon('clock') },
            );
            return;
          }
          // No bundled recording: the true start of this device's history.
          const h = g.history();
          g.flyTo({ lon: -73.98, lat: 40.2, height: 420e3, duration: 1.4 });
          await settle(450);
          chrome.ribbon.jump(
            Number.isFinite(h?.start)
              ? Math.max(h.start, Date.now() - 3 * 3600e3)
              : Date.now() - 15 * 60e3,
            { play: true, speed: 60 },
          );
        },
      },
      {
        title: 'Clip this Moment',
        note: 'Select a range on the time machine and clip it',
        icon: 'scissors',
        run: async () => {
          closeAll();
          selectTab('live');
          const r = await busiestRecording(g);
          const cam = r?.camera || {
            lon: -73.95,
            lat: 40.72,
            height: 260e3,
          };
          await g.flyTo({
            ...cam,
            height: Math.min(cam.height, 300e3),
            duration: 1.2,
          });
          await settle(350);
          const t0 = r ? r.from + 6 * 60e3 : Date.now() - 50 * 60e3;
          chrome.ribbon.jump(t0 + 9 * 60e3);
          chrome.ribbon.selectRange(t0, t0 + 18 * 60e3);
        },
      },
      {
        title: 'An alert, calmly',
        note: 'An iOS-style banner from one of your alert rules',
        icon: 'bell',
        run: async () => {
          closeAll();
          applyTab('today');
          await settle(250);
          await watch.demoAlert();
        },
      },
      {
        title: 'Search to dossier',
        note: '“7700” when a squawk is live, else “ISS”; then any result',
        icon: 'search',
        run: async () => {
          closeAll();
          // “7700” only reads well while an aircraft is squawking it.
          const hits = await g.search('7700').catch(() => []);
          const squawk = hits.some((x) =>
            /aircraft|helicopter|military/.test(x.kind),
          );
          search.open(squawk ? '7700' : 'ISS');
        },
      },
    ],
  });
}

// Keyboard: Escape closes the topmost thing.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (document.querySelector('.sheet-layer.is-modal:not([hidden])')) return;
  if (dossier?.isOpen) return dossier.close();
  if (player?.current) return;
  if (world?.current) world.close();
});

window.__gev = {
  app,
  get globe() {
    return globe;
  },
  get world() {
    return world;
  },
  get chrome() {
    return chrome;
  },
  get threads() {
    return threads;
  },
  get capture() {
    return capture;
  },
  get dossier() {
    return dossier;
  },
  get player() {
    return player;
  },
  get director() {
    return director;
  },
  get sky() {
    return sky;
  },
  get search() {
    return search;
  },
  watch,
  today,
  feed,
  selectTab,
  openSituation,
  openMoment,
  openEntity,
  clipMoment,
  contractReport,
};
