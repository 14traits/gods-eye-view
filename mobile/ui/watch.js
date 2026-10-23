/**
 * Watch & alerts (DESIGN.md §12.1, §12.2, §12.3).
 *
 * Follow places and things; write alert rules as plain chips
 * ("Any [squawk 7700] within [200 km] of [Home]"). Rules are evaluated
 * against live data while the app is open and surface as calm, iOS-style
 * notification banners. "Nothing unusual near you" is a valid state.
 */

import { icon } from './icons.js';
import { h, esc, ago, haptic, toast, store, reducedMotion } from './dom.js';
import { createSheet } from './sheet.js';
import { distKm, fmtKm, utc, BAND_COLOR, bandOf } from './bands.js';

const RULES_KEY = 'gev.watch.v1';

export const WHAT = [
  {
    id: 'squawk7700',
    label: 'squawk 7700',
    test: (s) =>
      /squawk/.test(s.kind) && /7700/.test(`${s.title} ${s.telemetry}`),
    band: 'sky',
  },
  {
    id: 'emergency',
    label: 'any emergency squawk',
    test: (s) => /squawk/.test(s.kind),
    band: 'sky',
  },
  {
    id: 'circling',
    label: 'helicopters circling',
    test: (s) => /circling/.test(s.kind),
    band: 'sky',
  },
  {
    id: 'quake5',
    label: 'M5+ quake',
    test: (s) => /quake/.test(s.kind) && magOf(s) >= 5,
    band: 'ground',
  },
  {
    id: 'quake6',
    label: 'M6+ quake',
    test: (s) => /quake/.test(s.kind) && magOf(s) >= 6,
    band: 'ground',
  },
  {
    id: 'fire',
    label: 'wildfire',
    test: (s) => /fire/.test(s.kind),
    band: 'ground',
  },
  {
    id: 'launch',
    label: 'launch',
    test: (s) => /launch/.test(s.kind),
    band: 'orbit',
  },
  { id: 'issPass', label: 'ISS visible pass', test: null, band: 'orbit' },
];
const RADII = [25, 50, 200, 500, 1000, 20000];

function magOf(s) {
  const m = /M\s?(\d+(?:\.\d)?)/.exec(`${s.title} ${s.telemetry || ''}`);
  if (m) return Number(m[1]);
  const h = s.headline?.value;
  return Number(String(h || '').replace(/[^\d.]/g, '')) || 0;
}

const DEMO_HOME = {
  id: 'home',
  name: 'Home',
  label: 'Midtown, New York',
  sub: 'Midtown, New York · demo location',
  lon: -73.9851,
  lat: 40.7549,
  demo: true,
};

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(RULES_KEY) || 'null');
    if (j?.rules) return j;
  } catch {
    /* defaults */
  }
  return {
    places: [DEMO_HOME],
    rules: [
      { id: 'r1', what: 'squawk7700', within: 200, of: 'home', on: true },
      { id: 'r2', what: 'quake5', within: 500, of: 'home', on: true },
      { id: 'r3', what: 'circling', within: 25, of: 'home', on: true },
      { id: 'r4', what: 'issPass', within: 0, of: 'home', on: true },
    ],
    fired: {},
  };
}

export function createWatch({
  host,
  globe,
  getSituations,
  onOpenSituation,
  onOpenEntity,
}) {
  let state = load();
  const save = () => {
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify(state));
    } catch {
      /* per-viewer convenience only */
    }
  };
  const placeById = (id) =>
    state.places.find((p) => p.id === id) || state.places[0];
  const what = (id) => WHAT.find((w) => w.id === id) || WHAT[0];

  /* ---------- banners (iOS notification style) ---------- */
  const stack = h('<div class="banners" aria-live="polite"></div>');
  document.getElementById('app').appendChild(stack);
  function banner({
    title,
    body,
    band = 'sky',
    iconName = 'bell',
    onTap,
    sticky = false,
  }) {
    const el =
      h(`<button class="banner glass-strong" type="button" data-band="${esc(band)}">
        <span class="bn-app">${icon('eyes')}</span>
        <span class="bn-main"><span class="bn-top"><b>GOD'S EYE</b><span>now</span></span>
        <span class="bn-title">${icon(iconName)}${esc(title)}</span><span class="bn-body">${esc(body)}</span></span>
      </button>`);
    stack.prepend(el);
    haptic('success');
    const dismiss = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), reducedMotion() ? 0 : 380);
    };
    el.addEventListener('click', () => {
      dismiss();
      onTap?.();
    });
    // Swipe up to dismiss (touch and mouse).
    let y0 = null;
    el.addEventListener('pointerdown', (e) => (y0 = e.clientY));
    el.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      const dy = Math.min(0, e.clientY - y0);
      el.style.transform = `translateY(${dy}px)`;
      if (dy < -40) {
        y0 = null;
        dismiss();
      }
    });
    el.addEventListener('pointerup', () => {
      y0 = null;
      el.style.transform = '';
    });
    if (!sticky) setTimeout(dismiss, 7000);
    while (stack.children.length > 2) stack.lastElementChild.remove();
    return { dismiss };
  }

  /* ---------- evaluation ---------- */
  const hits = new Map(); // ruleId → [situations]
  async function evaluate({ quiet = false } = {}) {
    let sits = [];
    try {
      sits = [...(await getSituations()), ...globe.detections()];
    } catch {
      return;
    }
    const fresh = [];
    for (const r of state.rules) {
      if (!r.on) continue;
      const pl = placeById(r.of);
      const w = what(r.what);
      if (w.id === 'issPass') {
        const sky = await globe
          .skyNow({ lon: pl.lon, lat: pl.lat })
          .catch(() => null);
        const np = sky?.iss?.nextPass;
        const list = [];
        if (sky?.iss?.visibleNow)
          list.push({
            id: 'iss-now',
            title: 'The ISS is above you now',
            when: Date.now(),
          });
        else if (
          np &&
          np.start - Date.now() < 45 * 60e3 &&
          np.start > Date.now()
        )
          list.push({
            id: `iss-${Math.round(np.start / 60e3)}`,
            title: `ISS pass at ${new Date(np.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            when: np.start,
            np,
          });
        hits.set(r.id, list);
        for (const x of list)
          if (!state.fired[`${r.id}:${x.id}`]) fresh.push({ r, x, pl, w });
        continue;
      }
      const list = sits.filter((s) => {
        if (!w.test?.(s) || !Number.isFinite(s.lat)) return false;
        return r.within >= 20000 || distKm(pl, s) <= r.within;
      });
      hits.set(r.id, list);
      for (const s of list)
        if (!state.fired[`${r.id}:${s.id}`]) fresh.push({ r, s, pl, w });
    }
    if (!quiet)
      for (const f of fresh.slice(0, 2)) {
        state.fired[`${f.r.id}:${(f.s || f.x).id}`] = Date.now();
        if (f.s)
          banner({
            title: f.s.title,
            body: `${ruleText(f.r)} · ${fmtKm(distKm(f.pl, f.s))} from ${f.pl.name}`,
            band: bandOf(f.s),
            onTap: () => onOpenSituation?.(f.s),
          });
        else
          banner({
            title: f.x.title,
            body: f.x.np
              ? `Max ${f.x.np.maxElevationDeg ?? '—'}° · look up from ${f.pl.name}`
              : `Look up from ${f.pl.name}`,
            band: 'orbit',
            iconName: 'satellite',
          });
      }
    else
      for (const f of fresh)
        state.fired[`${f.r.id}:${(f.s || f.x).id}`] = Date.now();
    save();
    listeners.forEach((fn) => fn());
  }
  const listeners = new Set();

  function ruleText(r) {
    const w = what(r.what);
    const pl = placeById(r.of);
    if (w.id === 'issPass') return `${w.label} over ${pl.name}`;
    return `Any ${w.label} ${r.within >= 20000 ? 'anywhere' : `within ${r.within.toLocaleString()} km of ${pl.name}`}`;
  }

  /* ---------- sheet ---------- */
  const sheet = createSheet({
    host,
    label: 'Watch and alerts',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'watch-sheet',
    heights: { large: (H) => Math.round(H * 0.9) },
  });

  function chip(kind, rid, label) {
    return `<button class="rule-chip" type="button" data-rule="${esc(rid)}" data-chip="${kind}">${esc(label)}${icon('chevronDown')}</button>`;
  }
  function ruleHtml(r) {
    const w = what(r.what);
    const pl = placeById(r.of);
    const n = (hits.get(r.id) || []).length;
    const sentence =
      w.id === 'issPass'
        ? `${chip('what', r.id, w.label)} over ${chip('of', r.id, pl.name)}`
        : `Any ${chip('what', r.id, w.label)} ${r.within >= 20000 ? chip('within', r.id, 'anywhere') : `within ${chip('within', r.id, `${r.within.toLocaleString()} km`)}`} of ${chip('of', r.id, pl.name)}`;
    return `<div class="rule" data-band="${w.band}"><i class="bd"></i><p>${sentence}</p>
      <span class="rule-state tele">${r.on ? (n ? `${n} NOW` : 'QUIET') : 'OFF'}</span>
      <button class="switch" type="button" role="switch" aria-checked="${!!r.on}" aria-label="Rule on" data-toggle="${esc(r.id)}"></button></div>`;
  }

  async function render() {
    sheet.head.innerHTML = `<h2 class="sheet-title">Watch</h2><div class="sheet-sub">Places and things you follow, and when to tap you on the shoulder</div>`;
    const followed = store.get('followed') || [];
    const sits = await getSituations().catch(() => []);
    const things = await Promise.all(
      followed.slice(0, 8).map((id) => statusOf(id, sits)),
    );
    sheet.body.innerHTML = `
      <div class="section-h">Places</div>
      <div class="group">${state.places
        .map(
          (p) =>
            `<div class="row"><span class="row-icon">${icon(p.id === 'home' ? 'home' : 'pin')}</span><span class="row-main"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${esc(p.sub || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`)}</span></span>${p.id === 'home' ? `<button class="pill-btn plain" type="button" data-home="locate">${icon('location')}Use my location</button>` : `<button class="icon-btn" type="button" data-rm-place="${esc(p.id)}" aria-label="Remove">${icon('minus')}</button>`}</div>`,
        )
        .join('')}
        <button class="row row-add" type="button" data-add-place>${icon('plus')}<span>Watch the place in view on the globe</span></button></div>
      <div class="section-h">Things</div>
      <div class="group">${
        things.filter(Boolean).length
          ? things
              .filter(Boolean)
              .map(
                (t) =>
                  `<button class="row" type="button" data-thing="${esc(t.id)}"><span class="row-icon" data-band="${t.band}">${icon(t.icon)}</span><span class="row-main"><span class="row-title">${esc(t.title)}</span><span class="row-sub">${esc(t.status)}</span></span>${icon('chevronRight', { cls: 'chev' })}</button>`,
              )
              .join('')
          : '<div class="row"><span class="row-sub">Follow an aircraft, ship, satellite or situation from its dossier.</span></div>'
      }</div>
      <div class="section-h">Alert rules</div>
      <div class="rules">${state.rules.map(ruleHtml).join('')}</div>
      <button class="pill-btn tinted new-rule" type="button" data-new-rule>${icon('plus')}New rule</button>
      <p class="footnote">Calm by default: rules are checked against live data while God’s Eye is open, at most two banners at a time, and never for anything outside your rules. A quiet rule means nothing unusual.</p>`;
  }

  async function statusOf(id, sits) {
    const s = sits.find((x) => String(x.id) === String(id));
    if (s) {
      const m = s.metrics?.[0];
      return {
        id,
        kind: 'situation',
        title: s.title,
        status: `${s.place || ''}${m ? ` · ${m.value}${m.unit ? ` ${m.unit}` : ''}` : ''} · ${ago(s.updatedAt)}`,
        band: bandOf(s),
        icon: 'now',
        s,
      };
    }
    const d = await globe.entity(id).catch(() => null);
    if (!d) return null;
    const L = d.live;
    let status = d.subtitle || '';
    if (L && Number.isFinite(L.altM) && L.altM > 0)
      status =
        L.altM > 100e3
          ? `${Math.round(L.altM / 1000)} km up · ${L.speed ? `${(L.speed / 1000).toFixed(2)} km/s` : ''}`
          : `${Math.round(L.altM * 3.28084).toLocaleString()} ft · ${L.speed ? `${Math.round(L.speed * 1.944)} kt` : ''}`;
    const band =
      {
        satellite: 'orbit',
        aircraft: 'sky',
        helicopter: 'sky',
        military: 'sky',
      }[d.kind] || 'ground';
    return {
      id,
      kind: d.kind,
      title: d.title,
      status,
      band,
      icon:
        {
          satellite: 'satellite',
          aircraft: 'sky',
          helicopter: 'heli',
          vessel: 'sea',
          place: 'pin',
          moment: 'film',
        }[d.kind] || 'scope',
      d,
    };
  }

  function cycle(rule, kind) {
    if (kind === 'what') {
      const i = WHAT.findIndex((w) => w.id === rule.what);
      rule.what = WHAT[(i + 1) % WHAT.length].id;
    } else if (kind === 'within') {
      const i = RADII.indexOf(rule.within);
      rule.within = RADII[(i + 1) % RADII.length];
    } else if (kind === 'of') {
      const i = state.places.findIndex((p) => p.id === rule.of);
      rule.of = state.places[(i + 1) % state.places.length].id;
    }
  }

  sheet.body.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-chip]');
    if (c) {
      haptic('tick');
      const r = state.rules.find((x) => x.id === c.dataset.rule);
      cycle(r, c.dataset.chip);
      save();
      await evaluate({ quiet: true });
      render();
      return;
    }
    const t = e.target.closest('[data-toggle]');
    if (t) {
      haptic('tick');
      const r = state.rules.find((x) => x.id === t.dataset.toggle);
      r.on = !r.on;
      save();
      render();
      return;
    }
    if (e.target.closest('[data-new-rule]')) {
      state.rules.push({
        id: `r${Date.now().toString(36)}`,
        what: 'quake5',
        within: 500,
        of: state.places[0].id,
        on: true,
      });
      save();
      haptic('light');
      render();
      return;
    }
    if (e.target.closest('[data-add-place]')) {
      const c2 = globe.raw?.camera?.() || null;
      const v = lastCam || c2;
      if (!v)
        return toast('Open Live and frame a place first', {
          icon: icon('globe'),
        });
      state.places.push({
        id: `p${Date.now().toString(36)}`,
        name: `Place ${state.places.length}`,
        lon: v.lon,
        lat: v.lat,
      });
      save();
      toast('Watching this place', { icon: icon('pin') });
      render();
      return;
    }
    const rm = e.target.closest('[data-rm-place]');
    if (rm) {
      state.places = state.places.filter((p) => p.id !== rm.dataset.rmPlace);
      state.rules = state.rules.filter((r) => r.of !== rm.dataset.rmPlace);
      save();
      render();
      return;
    }
    if (e.target.closest('[data-home="locate"]')) {
      navigator.geolocation?.getCurrentPosition(
        (p) => {
          setHome({ lat: p.coords.latitude, lon: p.coords.longitude });
          render();
        },
        () =>
          toast('Location unavailable · using the demo home', {
            icon: icon('location'),
          }),
      );
      return;
    }
    const th = e.target.closest('[data-thing]');
    if (th) {
      sheet.close();
      onOpenEntity?.(th.dataset.thing);
    }
  });
  let lastCam = null;
  globe.on('camera', (c) => (lastCam = c));

  function setHome(loc) {
    const home = state.places.find((p) => p.id === 'home');
    Object.assign(home, {
      lon: loc.lon,
      lat: loc.lat,
      sub: 'Your location',
      label: 'your location',
      demo: false,
    });
    save();
  }

  setInterval(() => {
    if (!document.hidden) evaluate();
  }, 30000);

  /**
   * Director: one deterministic banner. A real rule against live data when
   * any rule matches now (fired before or not); else a real situation that
   * a demo rule ("any emergency squawk anywhere") would catch; else a
   * clearly labelled example. Sticky until tapped or the next beat.
   */
  async function demoAlert() {
    clearBanners();
    // Never wait on a cold live fetch: after 1.2 s the last good snapshot
    // stands in (its age is said in the banner).
    let sits = [];
    try {
      const fresh = await Promise.race([
        getSituations(),
        new Promise((r) => setTimeout(() => r(null), 1200)),
      ]);
      sits = fresh || (await globe.situationsCached?.()) || [];
      sits = [...sits, ...(globe.detections?.() || [])];
    } catch {
      /* example below */
    }
    const live = sits.filter((s) => Number.isFinite(s.lat));
    const age = (s) =>
      s.cached && s.capturedAt ? ` · seen ${ago(+new Date(s.capturedAt))}` : '';
    for (const r of state.rules) {
      const w = what(r.what);
      if (!r.on || !w.test) continue;
      const pl = placeById(r.of);
      const s = live.find(
        (x) => w.test(x) && (r.within >= 20000 || distKm(pl, x) <= r.within),
      );
      if (s)
        return banner({
          title: s.title,
          body: `${ruleText(r)} · ${fmtKm(distKm(pl, s))} from ${pl.name}${age(s)}`,
          band: bandOf(s),
          sticky: true,
          onTap: () => onOpenSituation?.(s),
        });
    }
    const home = placeById('home');
    for (const id of ['emergency', 'circling', 'quake5', 'launch', 'fire']) {
      const w = what(id);
      const s = live
        .filter((x) => w.test(x))
        .sort((a, b) => distKm(home, a) - distKm(home, b))[0];
      if (s)
        return banner({
          title: s.title,
          body: `Demo rule: any ${w.label} anywhere · ${fmtKm(distKm(home, s))} from ${home.name}${age(s)}`,
          band: bandOf(s),
          sticky: true,
          onTap: () => onOpenSituation?.(s),
        });
    }
    return banner({
      title: 'Squawk 7700 near Home',
      body: 'Example alert · how a rule match looks when one fires',
      band: 'sky',
      sticky: true,
    });
  }
  function clearBanners() {
    stack.replaceChildren();
  }

  return {
    banner,
    demoAlert,
    clearBanners,
    evaluate,
    open() {
      render();
      sheet.open('large');
    },
    home: () => placeById('home'),
    /** One line for You: "Home · 4 rules · 1 on now". */
    summary() {
      const on = state.rules.filter((r) => r.on);
      const now = on.reduce((a, r) => a + (hits.get(r.id) || []).length, 0);
      return `${state.places.length} place${state.places.length === 1 ? '' : 's'} · ${on.length} rule${on.length === 1 ? '' : 's'}${now ? ` · ${now} on now` : ' · all quiet'}`;
    },
    setHome,
    places: () => state.places,
    rules: () => state.rules,
    hits: (rid) => hits.get(rid) || [],
    ruleText,
    statusOf,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** From a dossier's "Alert me". */
    ruleFor(d) {
      const pl = d.live && Number.isFinite(d.live.lat) ? d.live : null;
      let rule;
      if (d.kind === 'satellite' && /iss|zarya/i.test(d.title))
        rule = { what: 'issPass', within: 0, of: 'home' };
      else if (pl) {
        const id = `p${Date.now().toString(36)}`;
        state.places.push({
          id,
          name: d.kind === 'place' ? d.title : `Near ${d.title}`,
          lon: pl.lon,
          lat: pl.lat,
        });
        rule = {
          what: /quake/.test(d.kind)
            ? 'quake5'
            : /heli|moment|capture/.test(d.kind)
              ? 'circling'
              : 'emergency',
          within: 50,
          of: id,
        };
      } else rule = { what: 'emergency', within: 200, of: 'home' };
      const r = { id: `r${Date.now().toString(36)}`, on: true, ...rule };
      state.rules.push(r);
      save();
      haptic('success');
      toast(`Alert set · ${ruleText(r)}`, { icon: icon('bell') });
      evaluate({ quiet: true });
    },
    noteFollow() {
      listeners.forEach((fn) => fn());
    },
    reset() {
      try {
        localStorage.removeItem(RULES_KEY);
      } catch {
        /* ignore */
      }
      state = load();
      hits.clear();
    },
    bandColor: (b) => BAND_COLOR[b],
    utc,
  };
}
