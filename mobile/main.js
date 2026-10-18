/**
 * God's Eye — mobile shell.
 * Boots the five tabs, mounts the one persistent globe (lazy), and wires
 * the feed, the card → world transition, the globe chrome, Capture,
 * Threads and You together.
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

const app = $('#app');
const stage = $('#stage');
const views = {
  now: $('#view-now'),
  globe: $('#view-globe'),
  threads: $('#view-threads'),
  you: $('#view-you'),
  capture: $('#view-capture'),
};

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
  if (!situationsCache || fresh) situationsCache = await g.situations();
  return situationsCache;
}
const situationById = (id) =>
  situationsCache?.find((s) => String(s.id) === String(id)) || null;

/* ---------------- Tabs ---------------- */
let current = 'now';
const tabbar = createTabBar($('#tabbar'), {
  onSelect: (tab, { reselect }) => {
    if (reselect) {
      const v = views[tab];
      if (v?.scrollTop > 0)
        v.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      else if (tab === 'globe') globe?.home();
      return;
    }
    selectTab(tab);
  },
  onSearch: () => search?.open(),
  onAccessory: (s) => openSituation(s),
});

let capture = null;
let you = null;
let world = null;
let chrome = null;
let threads = null;
let search = null;
let inspector = null;
let narrative = null;

function applyTab(tab) {
  const prev = current;
  current = tab;
  app.dataset.tab = tab;
  const two = isTwoPane();
  for (const [id, el] of Object.entries(views)) {
    if (id === 'capture') el.hidden = tab !== 'capture';
    else if (id === 'globe') el.hidden = !(two && tab === 'globe');
    else el.hidden = id !== tab && !(two && tab === 'capture' && id === prev);
  }
  tabbar.select(tab);
  if (tab === 'capture') {
    globe?.pause();
    capture?.enter();
  } else {
    if (prev === 'capture') capture?.leave();
    updateGlobeActivity();
  }
  if (tab === 'you') you?.render();
  if (tab === 'globe' && two) chrome?.renderLeadView();
  if (tab !== 'globe') chrome?.hidePick();
}

function selectTab(tab) {
  if (tab === current) return;
  if (world?.current && !isTwoPane()) world.close();
  if (narrative?.active) narrative.stop();
  const vt = document.startViewTransition && !reducedMotion();
  if (vt) document.startViewTransition(() => applyTab(tab));
  else {
    applyTab(tab);
    const v = views[tab];
    if (v && !v.hidden) {
      v.classList.remove('view-enter');
      void v.offsetWidth;
      v.classList.add('view-enter');
    }
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
    (isTwoPane() || current === 'globe' || app.classList.contains('is-world'));
  if (visible) globe.resume();
  else pauseTimer = setTimeout(() => globe.pause(), 700);
}
document.addEventListener('visibilitychange', updateGlobeActivity);
new MutationObserver(updateGlobeActivity).observe(app, {
  attributes: true,
  attributeFilter: ['class'],
});

/* ---------------- Feed ---------------- */
const feed = createFeed(views.now, {
  getSituations: () => getSituations({ fresh: true }),
  onOpen: (s, card) => openSituation(s, card),
  onLocate: () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => {
          toast('Location unavailable — sorting from San Francisco', {
            icon: icon('location'),
          });
          resolve(null);
        },
        { maximumAge: 600000, timeout: 10000 },
      );
    }),
  bindScroll: (el) => tabbar.bindScroll(el),
});

function openSituation(s, card = null) {
  if (!world) return;
  if (current === 'capture') applyTab('now');
  if (narrative?.active) narrative.stop();
  world.open(s, card);
}

function refreshAccessory() {
  const followed = store.get('followed') || [];
  const s = followed.map((id) => situationById(id)).find(Boolean) || null;
  tabbar.setAccessory(s);
}

/* ---------------- Boot dependent modules ---------------- */
globeReady
  .then(async (g) => {
    world = createWorld({
      app,
      stage,
      globe: g,
      getCard: (id) => feed.cardFor(id),
      isTwoPane,
      onThread: (s) => openThreadFor(s),
      onFollowChange: refreshAccessory,
    });
    world.on('open', (s) => feed.select(s.id));
    world.on('close', () => feed.select(null));
    chrome = createGlobeChrome({
      chrome: $('#globe-chrome'),
      stage,
      leadView: views.globe,
      globe: g,
      onOpenSituation: (s) => openSituation(s),
      onThread: (s) => openThreadFor(s),
      getSituations,
      isTwoPane,
    });
    narrative = createNarrative({
      app,
      chrome: $('#globe-chrome'),
      globe: g,
      ribbon: chrome.ribbon,
      getSituation: situationById,
    });
    threads = createThreads(views.threads, {
      bindScroll: (el) => tabbar.bindScroll(el),
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
    inspector = createInspector();
    you = createYou(views.you, {
      bindScroll: (el) => tabbar.bindScroll(el),
      getSituations,
      onOpenSituation: (s) => openSituation(s),
      onVerify: (b) => inspector.open(b),
      onCredits: () => chrome.openCredits(),
    });
    search = createSearch({
      getSituations,
      globe: g,
      onOpenSituation: (s) => openSituation(s),
      onPlace: (p) => {
        selectTab('globe');
        g.flyTo({ lon: p.lon, lat: p.lat, height: 40e3 });
      },
      onLayer: (id) => {
        g.setLayer(id, true);
        chrome.refreshDock();
        selectTab('globe');
        toast('Lens on', { icon: icon('layers') });
      },
    });
    const { createCapture } = await import('./ui/capture.js');
    capture = createCapture(views.capture, {
      globe: g,
      onSealed: () => {
        if (current === 'you') you.render();
      },
      onVerify: (b) => inspector.open(b),
    });

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

    await feed.load();
    const sits = await getSituations();
    chrome.setPips(
      sits.flatMap((s) =>
        (s.events || []).map((ev) => ({
          at: +new Date(ev.at),
          label: ev.label,
          color: {
            sky: '#7CC4FF',
            sea: '#38E1C6',
            orbit: '#C9A7FF',
            hazards: '#FF6A3D',
            eyes: '#FFD166',
            ground: '#9BE15D',
            weather: '#8AB4F8',
            infra: '#B8C0CC',
          }[s.family],
        })),
      ),
    );
    refreshAccessory();
    store.on((k) => k === 'followed' && refreshAccessory());
    applyTab(current);

    // Deep link: #s=<situation id>
    const m = /#s=([^&]+)/.exec(location.hash);
    if (m) {
      const s = situationById(decodeURIComponent(m[1]));
      if (s) openSituation(s, feed.cardFor(s.id));
    }
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

async function openThreadFor(s) {
  if (!threads) return;
  if (world?.current) await world.close();
  const id =
    s.thread || (s.kind === 'reconstruction' ? s.id : threads.startDraft(s));
  selectTab('threads');
  await threads.openById(id);
  if (!s.thread && s.kind !== 'reconstruction')
    toast('Draft thread started · observation recorded', {
      icon: icon('threads'),
    });
}

applyTab('now');

// Keyboard: Escape closes the world.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && world?.current) world.close();
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
  selectTab,
  openSituation,
  contractReport,
};
