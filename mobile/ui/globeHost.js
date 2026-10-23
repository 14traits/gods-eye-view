/**
 * Mounts the one persistent globe behind the shell.
 *
 * Prefers the real Cesium engine (mobile/globe/index.js, DESIGN.md §10) and
 * falls back to the offline stub so the shell is always demoable. Every call
 * goes through a guard so a missing method or a throwing engine never takes
 * the shell down; mismatches are collected in `contractReport` for the lead.
 */

import { installRound3 } from './shim3.js';

const REQUIRED = [
  'flyTo',
  'home',
  'layers',
  'setLayer',
  'setFamily',
  'setTime',
  'timeWindow',
  'setLens',
  'focus',
  'select',
  'on',
  'off',
  'pause',
  'resume',
  'contactsNear',
  'situations',
];

/** Round-two additions (mobile/globe/API.md), optional. */
const ROUND_TWO = [
  'setViewer',
  'viewer',
  'thumbnail',
  'addPin',
  'removePin',
  'pins',
  'nearestEye',
  'eyeFrameUrl',
];

/** Round-three additions (mobile/globe/API.md, "Round three"), optional. */
const ROUND_THREE = [
  'history',
  'trackOf',
  'timeline',
  'detections',
  'moments',
  'moment',
  'momentOfTheDay',
  'playMoment',
  'exitMoment',
  'activeMoment',
  'seekMoment',
  'entity',
  'search',
  'graph',
  'react',
  'attentionHeat',
  'skyNow',
  'cachedThumbnail',
];

export const contractReport = {
  engine: 'none',
  missing: [],
  errors: [],
  notes: [],
};
if (typeof window !== 'undefined') window.__gevContract = contractReport;

/** Families are lower-case ids in the shell; the engine may capitalise them. */
const fam = (f) => String(f || 'infra').toLowerCase();
const normLayer = (l) => ({ ...l, family: fam(l.family) });
function normSituation(s) {
  const section = String(s.section || '').toLowerCase();
  return {
    ...s,
    family: fam(s.family),
    section:
      section === 'reconstruction' ? 'reconstructions' : section || undefined,
    alwaysOn: s.alwaysOn ?? section === 'always',
  };
}

function guard(engine, kind) {
  const note = (m) => {
    if (!contractReport.errors.includes(m)) contractReport.errors.push(m);
  };
  const call = (name, fallback, ...args) => {
    const fn = engine[name];
    if (typeof fn !== 'function') return fallback;
    try {
      return fn.apply(engine, args);
    } catch (err) {
      note(`${name}(): ${err?.message || err}`);
      console.warn(`[globe:${kind}] ${name} failed`, err);
      return fallback;
    }
  };
  const asyncCall = async (name, fallback, ...args) => {
    try {
      const v = await call(name, fallback, ...args);
      return v ?? fallback;
    } catch (err) {
      note(`${name}(): ${err?.message || err}`);
      return fallback;
    }
  };
  return {
    kind,
    raw: engine,
    isStub: kind === 'stub',
    flyTo: (o) => asyncCall('flyTo', undefined, o),
    home: () => call('home', undefined),
    layers: () => {
      const v = call('layers', []);
      return Array.isArray(v) ? v.map(normLayer) : [];
    },
    setLayer: (id, on) => call('setLayer', undefined, id, on),
    setFamily: (f, on) => call('setFamily', undefined, f, on),
    setTime: (d) => call('setTime', undefined, d),
    timeWindow: () => {
      const v = call('timeWindow', null);
      const n = Date.now();
      if (!v || !v.start || !v.end)
        return {
          start: new Date(n - 72 * 3600e3),
          end: new Date(n + 120 * 3600e3),
          now: new Date(n),
        };
      return {
        start: new Date(v.start),
        end: new Date(v.end),
        now: new Date(v.now ?? n),
      };
    },
    setLens: (id) => call('setLens', undefined, id),
    focus: (s) => asyncCall('focus', undefined, s),
    select: (id) => call('select', undefined, id),
    on: (ev, fn) => call('on', undefined, ev, fn),
    off: (ev, fn) => call('off', undefined, ev, fn),
    pause: () => call('pause', undefined),
    resume: () => call('resume', undefined),
    contactsNear: (lon, lat, km) => {
      const v = call('contactsNear', [], lon, lat, km);
      return Array.isArray(v) ? v : [];
    },
    situations: async (opts) => {
      const v = await asyncCall('situations', [], opts);
      return Array.isArray(v) ? v.map(normSituation) : [];
    },
    /* ---- round two (mobile/globe/API.md); every one feature-detected ---- */
    has: (name) => typeof engine[name] === 'function',
    setViewer: (v) => call('setViewer', undefined, v),
    viewer: () => call('viewer', null),
    /** Composited card image (blob: URL); falls back to the plain still. */
    thumbnail: async (s, o) => {
      if (typeof engine.thumbnail !== 'function') return s?.thumbnail || '';
      try {
        return (await engine.thumbnail(s, o)) || s?.thumbnail || '';
      } catch {
        return s?.thumbnail || '';
      }
    },
    addPin: (p) => call('addPin', null, p),
    removePin: (id) => call('removePin', false, id),
    pins: () => {
      const v = call('pins', []);
      return Array.isArray(v) ? v : [];
    },
    nearestEye: async (lon, lat, km = 50) => {
      if (typeof engine.nearestEye === 'function')
        return asyncCall('nearestEye', null, lon, lat, km);
      const cams = (call('contactsNear', [], lon, lat, km) || []).filter((c) =>
        /cam|cctv|eye/i.test(c.kind),
      );
      return cams[0] ? { ...cams[0], imageUrl: null } : null;
    },
    eyeFrameUrl: (id) => call('eyeFrameUrl', null, id),
    credits: () => {
      const v = call('credits', null);
      return Array.isArray(v) ? v : null;
    },
    /** Screen-space label candidates (engine draws none; the shell renders them). */
    labels: (max = 40) => {
      const v = call('labels', [], max);
      return Array.isArray(v) ? v : [];
    },
    project: (lon, lat, alt) => call('project', null, lon, lat, alt),
    time: () => call('time', null),

    /* ---- round three (API.md); the shell fills gaps with shim3.js ---- */
    situationsCached: async () => {
      const v = await asyncCall('situations', [], { cached: true });
      return Array.isArray(v) ? v.map(normSituation) : [];
    },
    cachedThumbnail: (s) => call('cachedThumbnail', null, s),
    history: () => call('history', null),
    loadHistory: () => asyncCall('loadHistory', null),
    historyNear: (ms, lon, lat, km) => {
      const v = call('historyNear', [], ms, lon, lat, km);
      return Array.isArray(v) ? v : [];
    },
    trackOf: (id) => asyncCall('trackOf', [], id),
    playback: {
      play: (o) => {
        try {
          engine.playback?.play?.(o);
        } catch (err) {
          note(`playback.play(): ${err?.message || err}`);
        }
      },
      stop: () => {
        try {
          engine.playback?.stop?.();
        } catch (err) {
          note(`playback.stop(): ${err?.message || err}`);
        }
      },
      state: () => {
        try {
          return (
            engine.playback?.state?.() || { playing: false, speed: 1, t: null }
          );
        } catch {
          return { playing: false, speed: 1, t: null };
        }
      },
    },
    timeline: (o) => {
      const v = call('timeline', [], o);
      return Array.isArray(v) ? v : [];
    },
    detections: () => {
      const v = call('detections', []);
      return Array.isArray(v) ? v.map(normSituation) : [];
    },
    moments: async () => {
      const v = await asyncCall('moments', []);
      return Array.isArray(v) ? v : [];
    },
    moment: (id) => asyncCall('moment', null, id),
    momentOfTheDay: () => asyncCall('momentOfTheDay', null),
    playMoment: (m, o) => asyncCall('playMoment', null, m, o),
    exitMoment: () => call('exitMoment', undefined),
    activeMoment: () => call('activeMoment', null),
    seekMoment: (t) => call('seekMoment', undefined, t),
    entity: (ref) => asyncCall('entity', null, ref),
    search: async (q) => {
      const v = await asyncCall('search', [], q);
      return Array.isArray(v) ? v : [];
    },
    graph: (ref) => {
      const v = call('graph', null, ref);
      return v && Array.isArray(v.nodes) ? v : { nodes: [], edges: [] };
    },
    react: (o) => call('react', undefined, o),
    attentionHeat: (p) => call('attentionHeat', undefined, p),
    skyNow: (o) => asyncCall('skyNow', null, o),
    addClip: (m) => call('_addClip', undefined, m),
  };
}

/**
 * @param {HTMLElement} container
 * @param {{ quality?: string, preferStub?: boolean }} opts
 */
export async function mountGlobe(container, opts = {}) {
  const params = new URLSearchParams(location.search);
  const forceStub = opts.preferStub || params.get('engine') === 'stub';
  if (!forceStub) {
    // vite-plugin-cesium serves Workers/Assets at /cesium/ and passes the base
    // as a build-time define, which the pre-bundled dev dependency never sees;
    // Cesium then resolves them next to node_modules/.vite/deps and gets HTML.
    if (typeof window !== 'undefined' && !window.CESIUM_BASE_URL)
      window.CESIUM_BASE_URL = '/cesium/';
    try {
      // A glob (not a bare dynamic import) so a checkout without the engine
      // still builds; Vite re-evaluates it when mobile/globe/index.js appears.
      const loaders = import.meta.glob('../globe/index.js');
      const load = loaders['../globe/index.js'];
      if (!load) throw new Error('mobile/globe/index.js not present');
      const mod = await load();
      const create = mod.createGlobe || mod.default?.createGlobe || mod.default;
      if (typeof create !== 'function')
        throw new Error('mobile/globe/index.js exports no createGlobe');
      const quality =
        opts.quality === 'battery' ? 'low' : opts.quality || 'auto';
      const engine = await create(container, { quality });
      contractReport.engine = 'cesium';
      contractReport.roundThree = Object.fromEntries(
        ROUND_THREE.map((m) => [
          m,
          typeof engine?.[m] === 'function' ? 'native' : 'shim',
        ]),
      );
      contractReport.roundThree.playback =
        typeof engine?.playback?.play === 'function' ? 'native' : 'shim';
      installRound3(engine, { kind: 'cesium' });
      contractReport.missing = REQUIRED.filter(
        (m) => typeof engine?.[m] !== 'function',
      );
      if (typeof engine?.credits !== 'function')
        contractReport.notes.push(
          'credits() not provided (optional, used for attribution sheet)',
        );
      contractReport.roundTwo = Object.fromEntries(
        ROUND_TWO.map((m) => [m, typeof engine?.[m] === 'function']),
      );
      if (contractReport.missing.length)
        console.warn('[globe] contract gaps', contractReport.missing);
      return guard(engine, 'cesium');
    } catch (err) {
      contractReport.notes.push(
        `real engine unavailable: ${err?.message || err}`,
      );
      console.info('[globe] using offline stub:', err?.message || err);
      container.replaceChildren();
    }
  }
  const { createGlobe } = await import('./globeStub.js');
  const engine = await createGlobe(container, {
    quality: opts.quality || 'auto',
  });
  contractReport.engine = 'stub';
  contractReport.roundThree = 'stub (shim3 + native stub recorder)';
  contractReport.roundTwo = Object.fromEntries(
    ROUND_TWO.map((m) => [m, typeof engine?.[m] === 'function']),
  );
  return guard(engine, 'stub');
}
