/**
 * Mounts the one persistent globe behind the shell.
 *
 * Prefers the real Cesium engine (mobile/globe/index.js, DESIGN.md §10) and
 * falls back to the offline stub so the shell is always demoable. Every call
 * goes through a guard so a missing method or a throwing engine never takes
 * the shell down; mismatches are collected in `contractReport` for the lead.
 */

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
    situations: async () => {
      const v = await asyncCall('situations', []);
      return Array.isArray(v) ? v.map(normSituation) : [];
    },
    credits: () => {
      const v = call('credits', null);
      return Array.isArray(v) ? v : null;
    },
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
      contractReport.missing = REQUIRED.filter(
        (m) => typeof engine?.[m] !== 'function',
      );
      if (typeof engine?.credits !== 'function')
        contractReport.notes.push(
          'credits() not provided (optional, used for attribution sheet)',
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
  return guard(engine, 'stub');
}
