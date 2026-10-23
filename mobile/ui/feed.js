/**
 * Now: the global equivalent of a neighbourhood safety feed (DESIGN.md §11.2).
 * Mixed card archetypes across the four altitude bands, ordered so that
 * neighbours differ, with Room and Witness cards woven in, an altitude
 * filter, distance from you, and a "Near you" lens. Two-column masonry with
 * full-width rows for live cameras and rooms; columns are balanced exactly
 * before every wide row.
 */

import { icon } from './icons.js';
import { $, $$, esc, ago, clamp, haptic, reducedMotion } from './dom.js';
import { cardHtml } from './cards.js';
import { localWitness } from './witness.js';
import {
  BANDS,
  bandOf,
  archetypeOf,
  distKm,
  fmtKm,
  utc,
  presenceRadiusKm,
} from './bands.js';

const BAND_RANGE = {
  orbit: '36,000 km',
  sky: '15 km',
  ground: '0 m',
  inside: 'you',
};

function hashStr(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i += 1)
    x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}

export function isReconstruction(s) {
  return (
    s.section === 'reconstructions' || s.kind === 'reconstruction' || !!s.thread
  );
}
export function isAlwaysOn(s) {
  return s.section === 'always' || !!s.alwaysOn;
}

const WIDE = new Set(['eye', 'room']);
const BODY_H = {
  sensor: 84,
  track: 110,
  number: 62,
  witness: 78,
  prompt: 46,
};
const GAP = 8;

function aspect(item) {
  const a = item.archetype;
  if (a === 'number') return 1.06;
  if (a === 'track') return 1;
  if (a === 'witness') return item.w?.liveNow ? 1.3 : 1.22;
  if (a === 'prompt') return 1.08;
  const opts = [1.18, 1.32, 1.0, 1.42, 1.12];
  return opts[hashStr(String(item.key)) % opts.length];
}

/** Diversity-aware ordering: keep priority, avoid same archetype/band neighbours. */
export function diversify(list) {
  const pool = [...list];
  const out = [];
  let sinceWide = 9;
  while (pool.length) {
    let best = 0;
    let bs = -Infinity;
    for (let i = 0; i < Math.min(pool.length, 7); i += 1) {
      const it = pool[i];
      const p1 = out[out.length - 1];
      const p2 = out[out.length - 2];
      let sc = -i * 1.15;
      if (p1?.archetype === it.archetype) sc -= 6;
      if (p2?.archetype === it.archetype) sc -= 2.5;
      if (p1?.band === it.band) sc -= 4;
      if (p2?.band === it.band) sc -= 1.5;
      if (WIDE.has(it.archetype) && sinceWide < 3) sc -= 5;
      if (sc > bs) {
        bs = sc;
        best = i;
      }
    }
    const it = pool.splice(best, 1)[0];
    sinceWide = WIDE.has(it.archetype) ? 0 : sinceWide + 1;
    out.push(it);
  }
  return out;
}

export function createFeed(
  view,
  {
    getSituations,
    onOpen,
    onOpenRoom,
    onWitness,
    onCapture,
    onLocate,
    bindScroll,
    globe,
    rooms,
    rt,
  },
) {
  view.innerHTML = `
    <header class="navbar"><span class="nav-title">Today</span>
      <div class="nav-trailing"><span class="fresh-chip tele" hidden></span><button type="button" class="near-chip" data-act="near" aria-pressed="false">${icon('location')}<span>Near you</span></button><button class="icon-btn" type="button" data-act="refresh" aria-label="Refresh">${icon('refresh')}</button></div>
    </header>
    <div class="ptr" aria-hidden="true"><div class="ptr-spinner">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<i style="--i:${i}"></i>`).join('')}</div></div>
    <div class="feed-inner">
      <div class="feed-hero today-hero">
        <div class="today-date tele" data-date></div>
        <h1 class="large-title today-title"><span>Your world</span><span class="today-time" data-localtime></span></h1>
        <div class="feed-clock tele" aria-hidden="true"><b data-utc></b></div>
      </div>
      <div class="title-sub tele"><span class="live-dot"></span><span class="feed-count">Acquiring the planet…</span></div>
      <div class="brief-slot"></div>
      <div class="feed-section-h"><h2>Around the world</h2><span class="tele">LIVE · EVERY BAND</span></div>
      <div class="bandbar" role="tablist" aria-label="Altitude" data-hscroll>
        <button role="tab" type="button" data-band="all" aria-selected="true"><span class="bb-n">All</span><span class="bb-r tele" data-count="all">—</span></button>
        ${BANDS.map((b) => `<button role="tab" type="button" data-band="${b.id}" aria-selected="false"><span class="bb-n"><i></i>${b.name}</span><span class="bb-r tele"><span data-count="${b.id}">—</span> · ${BAND_RANGE[b.id]}</span></button>`).join('')}
      </div>
      <div class="feed-note" hidden></div>
      <div class="feed-body" role="feed" aria-busy="true"></div>
      <p class="feed-end tele" hidden>End of feed · the planet keeps turning</p>
    </div>`;

  const inner = $('.feed-inner', view);
  const fbody = $('.feed-body', view);
  const bandbar = $('.bandbar', view);
  const count = $('.feed-count', view);
  const note = $('.feed-note', view);
  const ptr = $('.ptr', view);
  let band = 'all';
  let near = false;
  let all = [];
  let userLoc = null;
  let hot = [];
  let witness = [];
  const cardEls = new Map();
  let selectedId = null;
  const itemsByKey = new Map();

  /* ---------- clocks ---------- */
  function tickClocks() {
    const now = new Date();
    const u = utc(now);
    const hd = $('[data-utc]', view);
    if (hd) hd.textContent = u;
    const dt = $('[data-date]', view);
    if (dt) {
      // The kicker greets the hour: what the planet is doing for you now.
      const hr = now.getHours();
      const greet =
        hr < 5
          ? 'Up late'
          : hr < 12
            ? 'Good morning'
            : hr < 17
              ? 'Good afternoon'
              : hr < 22
                ? 'Good evening'
                : 'Tonight';
      const txt = `${now
        .toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
        .toUpperCase()} · ${greet.toUpperCase()}`;
      if (dt.textContent !== txt) dt.textContent = txt;
    }
    const lt = $('[data-localtime]', view);
    if (lt) {
      const txt = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      if (lt.textContent !== txt) lt.textContent = txt;
    }
    if (view.hidden) return;
    $$('[data-clock]', fbody).forEach((el) => (el.textContent = u));
    $$('[data-since]', fbody).forEach((el) => {
      const s = Math.max(
        0,
        Math.round((Date.now() - Number(el.dataset.since)) / 1000),
      );
      el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    });
  }
  setInterval(tickClocks, 1000);
  tickClocks();

  function skeleton() {
    fbody.innerHTML = `<div class="masonry">${[0, 1]
      .map(
        (ci) =>
          `<div class="mcol">${[0, 1, 2]
            .map(
              (i) =>
                `<div class="card skel"><div class="card-media" style="aspect-ratio:1/${[1.2, 1, 1.35][(i + ci) % 3]}"></div><div class="card-body"><div class="sk-line"></div><div class="sk-line short"></div></div></div>`,
            )
            .join('')}</div>`,
      )
      .join('')}</div>`;
  }

  /* ---------- items ---------- */
  function withDistance(list) {
    return list.map((s) => {
      if (!userLoc || !Number.isFinite(s.lat)) return s;
      const d = Number.isFinite(s.distanceKm)
        ? s.distanceKm
        : distKm(userLoc, s);
      return { ...s, distanceKm: d };
    });
  }

  function situationItems() {
    const sits = withDistance(all);
    const items = sits.map((s, i) => ({
      key: `s:${s.id}`,
      type: 'situation',
      s,
      archetype: archetypeOf(s),
      band: bandOf(s),
      prio:
        (s.severity || 0) * 10 -
        i * 0.6 +
        (s.live ? 2 : 0) +
        // Detections from real data (circling, emergency squawks) lead.
        (/circling|squawk|quake-cluster/.test(s.kind || '') ? 60 : 0),
    }));
    // The street is the most Citizen-like card: one live eye right after
    // the two most severe situations.
    const ranked = [...items].sort((a, b) => b.prio - a.prio);
    const eye = ranked.find((x) => x.archetype === 'eye');
    if (eye && ranked[1] && ranked.indexOf(eye) > 2)
      eye.prio = ranked[1].prio - 0.1;
    // A detection is the first card: never shuffled away by diversity.
    for (const it of items)
      if (/circling|squawk|quake-cluster/.test(it.s.kind || '')) it.lead = true;
    return items;
  }

  function liveWitness() {
    return rt.lives().map((l) => ({
      id: `live:${l.id}`,
      liveId: l.id,
      type: 'live',
      liveNow: true,
      sealed: true,
      at: l.startedAt,
      startedAt: l.startedAt,
      handle: l.handle,
      viewers: l.viewers || 0,
      frame: l.frame,
      title: `${l.handle} is live${l.situationTitle ? ` near ${l.situationTitle}` : ''}`,
      sub: `${l.segments || 0} sealed segments · heading ${Math.round(l.headingDeg || 0)}°`,
      fix: Number.isFinite(l.lat) ? { lat: l.lat, lon: l.lon } : null,
      acc: l.acc,
    }));
  }

  function buildItems() {
    let items = situationItems();
    const lives = liveWitness();
    const wit = [...lives, ...witness.slice(0, 4)].map((w) => ({
      key: `w:${w.id}`,
      type: 'witness',
      w,
      archetype: 'witness',
      band: 'inside',
      prio: w.liveNow ? 100 : Date.now() - w.at < 6 * 3600e3 ? 30 : 0,
    }));
    const roomItems = hot.map((r, i) => ({
      key: `r:${r.id}`,
      type: 'room',
      room: r,
      watching: rt.presence(r.id).length,
      archetype: 'room',
      band: 'inside',
      prio: 40 - i * 12,
    }));
    if (!witness.length && !lives.length) {
      const nearest = userLoc
        ? [...withDistance(all)]
            .filter((s) => Number.isFinite(s.distanceKm))
            .sort((a, b) => a.distanceKm - b.distanceKm)[0]
        : null;
      wit.push({
        key: 'prompt',
        type: 'prompt',
        archetype: 'prompt',
        band: 'inside',
        prio: 28,
        p: nearest
          ? {
              title: `You’re ${fmtKm(nearest.distanceKm)} from ${nearest.title}`,
              text:
                nearest.distanceKm <= presenceRadiusKm(nearest)
                  ? 'A sealed photo from where you stand is the strongest post its room can get.'
                  : 'Your phone is a sensor too. Seal what you see and it joins the room for the nearest situation.',
              tele: `INSIDE · YOU · ${fmtKm(nearest.distanceKm).toUpperCase()} · ${utc(new Date(), { seconds: false })}`,
            }
          : {
              title: 'Be the sensor',
              text: 'Seal a photo, go live or upload. Your phone becomes an eye for the God’s eye, with its motion and position signed in.',
              tele: `INSIDE · YOU · ${utc(new Date(), { seconds: false })}`,
            },
      });
    }
    if (near) {
      items = items
        .filter((x) => Number.isFinite(x.s.distanceKm))
        .sort((a, b) => a.s.distanceKm - b.s.distanceKm)
        .slice(0, 14)
        .map((x, i) => ({ ...x, prio: 100 - i * 5 }));
    }
    let list = [...items, ...roomItems, ...wit];
    if (band !== 'all') list = list.filter((x) => x.band === band);
    list.sort((a, b) => b.prio - a.prio);
    if (near) return list;
    const lead = list.filter((x) => x.lead);
    return [...lead, ...diversify(list.filter((x) => !x.lead))];
  }

  /* ---------- layout ---------- */
  function layout(list) {
    const W = fbody.clientWidth || view.clientWidth || 400;
    const colW = (W - 16 - GAP) / 2;
    const blocks = [];
    let cols = [[], []];
    let h = [0, 0];
    const pending = [];
    const canFlush = () => {
      const d = Math.abs(h[0] - h[1]);
      if (d < 4) return true;
      const short = h[0] < h[1] ? 0 : 1;
      const last = cols[short].at(-1);
      return !!last && d < last.ar * colW * 0.55;
    };
    const flush = () => {
      if (!cols[0].length && !cols[1].length) return;
      const d = Math.abs(h[0] - h[1]);
      const short = h[0] < h[1] ? 0 : 1;
      const last = cols[short].at(-1);
      if (last && d >= 4) last.ar = (last.ar * colW + d) / colW;
      blocks.push({ kind: 'mason', cols });
      cols = [[], []];
      h = [0, 0];
    };
    for (const it of list) {
      if (WIDE.has(it.archetype)) {
        if (canFlush()) {
          flush();
          blocks.push({ kind: 'wide', it });
        } else pending.push(it);
        continue;
      }
      const c = h[0] <= h[1] ? 0 : 1;
      const ar = aspect(it);
      const cell = { it, ar };
      cols[c].push(cell);
      h[c] += ar * colW + (BODY_H[it.archetype] || 84) + GAP;
      while (pending.length && canFlush()) {
        flush();
        blocks.push({ kind: 'wide', it: pending.shift() });
      }
    }
    // A lonely trailing card would leave a hole: let the last wide row go first.
    if (pending.length) {
      flush();
      for (const it of pending) blocks.push({ kind: 'wide', it });
    } else if (cols[0].length + cols[1].length)
      blocks.push({ kind: 'mason', cols });
    return blocks;
  }

  function render() {
    const list = buildItems();
    itemsByKey.clear();
    list.forEach((it) => itemsByKey.set(it.key, it));
    const blocks = layout(list);
    const keyed = (it, ar) =>
      cardHtml(it, ar).replace(
        '<article ',
        `<article data-key="${esc(it.key)}" `,
      );
    fbody.innerHTML = blocks
      .map((b) =>
        b.kind === 'wide'
          ? `<div class="wide-row">${keyed(b.it, 0.5625)}</div>`
          : `<div class="masonry">${b.cols.map((c) => `<div class="mcol">${c.map((cell) => keyed(cell.it, cell.ar)).join('')}</div>`).join('')}</div>`,
      )
      .join('');
    cardEls.clear();
    $$('.card[data-id]', fbody).forEach((el) => {
      cardEls.set(el.dataset.id, el);
      el.classList.toggle('is-selected', el.dataset.id === selectedId);
    });
    fbody.setAttribute('aria-busy', 'false');
    $('.feed-end', view).hidden = !list.length;
    if (!list.length)
      fbody.innerHTML = `<div class="feed-empty tele">Nothing in this band right now${near ? ' near you' : ''}.</div>`;
    // counts
    const sit = situationItems();
    const counts = { all: sit.length + hot.length + witness.length };
    for (const b of BANDS)
      counts[b.id] = sit.filter((x) => x.band === b.id).length;
    counts.inside += hot.length + witness.length;
    for (const [k, v] of Object.entries(counts)) {
      const el = $(`[data-count="${k}"]`, bandbar);
      if (el) el.textContent = String(v);
    }
    const live = all.filter((s) => s.live).length;
    const eyes = all.filter((s) => archetypeOf(s) === 'eye').length;
    count.textContent = `${live} live · ${eyes} eyes open · ${hot.reduce((a, r) => a + r.posts.length, 0)} posts in ${hot.length} hot rooms`;
    if (near && !userLoc) {
      note.hidden = false;
      note.innerHTML = `<div class="near-prompt">${icon('location')}<div><b>See what’s around you</b><span>Distances and the Near lens need your location. It stays on this device.</span></div><button class="pill-btn primary" type="button" data-act="locate">Use location</button></div>`;
    } else note.hidden = true;
    hydrate();
  }

  /* ---------- images: composited thumbnails, live eyes ---------- */
  const thumbIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        thumbIO.unobserve(e.target);
        loadThumb(e.target);
      }
    },
    { root: view, rootMargin: '700px 0px' },
  );
  const visibleEyes = new Set();
  const eyeIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visibleEyes.add(e.target);
        else visibleEyes.delete(e.target);
      }
    },
    { root: view, threshold: 0.15 },
  );

  function markLoaded(img) {
    const done = () => img.classList.add('loaded');
    if (img.complete && img.naturalWidth) done();
    else {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', () => img.classList.add('failed'), {
        once: true,
      });
    }
  }

  async function loadThumb(img) {
    const card = img.closest('.card');
    const it = itemsByKey.get(card?.dataset.key);
    const s = it?.s;
    if (!s) return;
    const media = img.closest('.card-media');
    const r = media.getBoundingClientRect();
    const w = 360;
    const hgt =
      Math.round((w * (r.height / Math.max(1, r.width))) / 40) * 40 || 480;
    // The plain still shows at once; the composited frame replaces it.
    if (s.thumbnail && !img.getAttribute('src')) {
      img.src = s.thumbnail;
      img.classList.add('still');
      markLoaded(img);
    }
    let url = '';
    try {
      url = await globe.thumbnail(s, { width: w, height: hgt, dpr: 2 });
    } catch {
      url = '';
    }
    if (!img.isConnected || !url || url === img.getAttribute('src')) return;
    const pre = new Image();
    pre.decoding = 'async';
    pre.onload = () => {
      if (!img.isConnected) return;
      img.src = url;
      img.classList.remove('still');
      img.classList.add('loaded', 'composited');
    };
    pre.src = url;
  }

  function hydrate() {
    $$('img[data-thumb]', fbody).forEach((img) => thumbIO.observe(img));
    $$('.c-eye', fbody).forEach((card) => {
      eyeIO.observe(card);
      card._next = Date.now() + Number(card.dataset.refresh || 15000);
      const img = $('img[data-eye]', card);
      markLoaded(img);
      img.addEventListener(
        'error',
        () => {
          const it = itemsByKey.get(card.dataset.key);
          if (it?.s?.thumbnail && !img.dataset.fellBack) {
            img.dataset.fellBack = '1';
            img.src = it.s.thumbnail;
            card.classList.add('eye-offline');
          }
        },
        { once: true },
      );
    });
    $$('.c-witness img, .c-witness video', fbody).forEach((m) => {
      if (m.tagName === 'VIDEO') m.classList.add('loaded');
      else markLoaded(m);
    });
    tickClocks();
  }

  function freshFrame(card) {
    const id = card.dataset.cam;
    const fromEngine = id ? globe.eyeFrameUrl(id) : null;
    if (fromEngine) return fromEngine;
    const cur = $('img[data-eye]', card).src;
    try {
      const u = new URL(cur, location.href);
      u.searchParams.set('ts', String(Math.floor(Date.now() / 1000)));
      return u.pathname + u.search;
    } catch {
      return cur;
    }
  }

  // Auto-refresh camera frames while on screen; cross-fade between buffers.
  setInterval(() => {
    if (view.hidden || document.hidden) return;
    const now = Date.now();
    for (const card of visibleEyes) {
      if (card.classList.contains('eye-offline') || now < (card._next || 0))
        continue;
      card._next = now + Number(card.dataset.refresh || 15000);
      const a = $('img[data-eye]', card);
      const b = $('img.eye-b', card);
      b.onload = () => {
        b.classList.add('loaded', 'front');
        a.classList.remove('front');
        // swap roles
        a.removeAttribute('data-eye');
        a.classList.add('eye-b');
        b.classList.remove('eye-b');
        b.setAttribute('data-eye', '');
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      };
      b.src = freshFrame(card);
    }
  }, 1000);

  /* ---------- load ---------- */
  async function refreshSocial() {
    const vis = all.filter((s) => s.kind !== 'reconstruction');
    hot = vis.length
      ? (await rooms.hot(vis, 3).catch(() => [])).filter(Boolean)
      : [];
    witness = await localWitness({ rooms, situations: all }).catch(() => []);
  }

  async function load({ quiet = false } = {}) {
    if (!quiet) skeleton();
    try {
      const prev = new Map(all.map((s) => [s.id, JSON.stringify(s.metrics)]));
      all = await getSituations();
      await refreshSocial();
      render();
      if (quiet)
        for (const s of all)
          if (prev.has(s.id) && prev.get(s.id) !== JSON.stringify(s.metrics))
            cardEls.get(String(s.id))?.classList.add('pulse');
    } catch (err) {
      console.error(err);
      count.textContent = 'Could not reach the live feeds';
    }
  }

  async function toggleNear(nb) {
    near = !near;
    nb.setAttribute('aria-pressed', String(near));
    view.classList.toggle('is-near', near);
    haptic('tick');
    if (near && !userLoc) {
      const loc = await onLocate();
      if (loc) setLocation(loc);
    }
    view.scrollTo({ top: 0 });
    swap();
  }

  bandbar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-band]');
    if (!b || b.dataset.band === band) return;
    band = b.dataset.band;
    $$('[data-band]', bandbar).forEach((x) =>
      x.setAttribute('aria-selected', String(x === b)),
    );
    bandbar.dataset.sel = band;
    haptic('tick');
    b.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    swap();
  });

  function swap() {
    fbody.classList.remove('swap');
    void fbody.offsetWidth;
    fbody.classList.add('swap');
    render();
  }

  view.addEventListener('click', async (e) => {
    const hitEl = e.target.closest('.card-hit');
    if (hitEl) {
      const card = hitEl.closest('.card');
      const it = itemsByKey.get(card.dataset.key);
      if (!it) return;
      haptic('light');
      if (it.type === 'situation') onOpen(it.s, card);
      else if (it.type === 'room') onOpenRoom(it.room.situation, card);
      else if (it.type === 'witness') onWitness(it.w, card);
      else if (it.type === 'prompt') onCapture();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'near') return toggleNear(e.target.closest('[data-act]'));
    if (act === 'refresh') refresh();
    if (act === 'locate') {
      const loc = await onLocate();
      if (loc) setLocation(loc);
      render();
    }
  });

  /* ---------- large title + nav bar ---------- */
  const title = $('.large-title', view);
  view.addEventListener(
    'scroll',
    () => {
      const y = view.scrollTop;
      view.classList.toggle('is-scrolled', y > 44);
      if (y < 0)
        title.style.transform = `scale(${1 + Math.min(0.08, -y / 900)})`;
      else if (title.style.transform) title.style.transform = '';
    },
    { passive: true },
  );
  bindScroll(view);

  /* ---------- pull to refresh ---------- */
  let pull = null;
  let refreshing = false;
  const THRESH = 78;
  view.addEventListener(
    'touchstart',
    (e) => {
      if (view.scrollTop > 0 || refreshing || e.touches.length !== 1) return;
      pull = { y0: e.touches[0].clientY, d: 0, armed: false };
    },
    { passive: true },
  );
  view.addEventListener(
    'touchmove',
    (e) => {
      if (!pull) return;
      const dy = e.touches[0].clientY - pull.y0;
      if (dy <= 0) {
        pull.d = 0;
        setPull(0);
        return;
      }
      if (view.scrollTop > 0) return;
      e.preventDefault();
      pull.d = dy;
      const d = (1 - 1 / ((dy * 0.55) / 320 + 1)) * 320;
      setPull(d);
      if (!pull.armed && d > THRESH) {
        pull.armed = true;
        haptic('light');
      } else if (pull.armed && d < THRESH) pull.armed = false;
    },
    { passive: false },
  );
  view.addEventListener(
    'touchend',
    () => {
      if (!pull) return;
      const armed = pull.armed;
      pull = null;
      if (armed) refresh();
      else setPull(0, true);
    },
    { passive: true },
  );

  function setPull(d, animate = false) {
    inner.style.transition = animate ? 'transform 420ms var(--spring)' : 'none';
    inner.style.transform = d ? `translate3d(0, ${d}px, 0)` : '';
    ptr.style.transition = animate ? 'opacity 200ms linear' : 'none';
    ptr.style.opacity = String(clamp(d / THRESH, 0, 1));
    ptr.style.setProperty('--p', clamp(d / THRESH, 0, 1).toFixed(3));
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    ptr.classList.add('spinning');
    setPull(64, true);
    const t = performance.now();
    await load({ quiet: true });
    const wait = Math.max(0, 700 - (performance.now() - t));
    setTimeout(() => {
      ptr.classList.remove('spinning');
      setPull(0, true);
      refreshing = false;
      haptic('success');
    }, wait);
  }

  // Keep relative times honest.
  setInterval(() => {
    if (!view.hidden && !document.hidden) {
      $$('.ago[data-ts]', view).forEach((el) => {
        if (el.dataset.ts)
          el.textContent = ago(Number(el.dataset.ts) || el.dataset.ts);
      });
    }
  }, 30000);

  // Social changes re-render quietly (posts from other tabs, live broadcasts).
  let socialTimer = 0;
  const socialChanged = () => {
    clearTimeout(socialTimer);
    socialTimer = setTimeout(async () => {
      await refreshSocial();
      if (!view.hidden) {
        const y = view.scrollTop;
        render();
        view.scrollTop = y;
      }
    }, 250);
  };
  rooms.on('post', socialChanged);
  let liveKey = '';
  rt.on('live', (l) => {
    const card = $(`[data-key="w:live:${CSS.escape(l.id)}"]`, fbody);
    if (card) {
      const img = $('img', card);
      if (img && l.frame) img.src = l.frame;
      const v = $('[data-viewers]', card);
      if (v) v.textContent = String(l.viewers || 0);
      if (!view.hidden) rt.watch(l.id);
    }
    const key = rt
      .lives()
      .map((x) => x.id)
      .join(',');
    if (key !== liveKey) {
      liveKey = key;
      socialChanged();
    }
  });
  rt.on('live-end', () => {
    liveKey = rt
      .lives()
      .map((x) => x.id)
      .join(',');
    socialChanged();
  });
  rt.on('presence', () => {
    for (const r of hot) {
      const el = $(`[data-room-watch="${CSS.escape(r.id)}"]`, fbody);
      const n = rt.presence(r.id).length;
      if (el) el.innerHTML = n > 1 ? `<i></i>${n} here` : '';
    }
  });

  function setLocation(loc) {
    userLoc = loc;
    if (loc) globe.setViewer?.({ lon: loc.lon, lat: loc.lat });
  }

  /** Instant first frame: paint cached situations before the live call. */
  function prime(list) {
    if (!Array.isArray(list) || !list.length || all.length) return false;
    all = list;
    render();
    count.textContent = `${count.textContent} · last good snapshot`;
    return true;
  }
  let freshTimer = 0;
  function markUpdated() {
    const chip = $('.fresh-chip', view);
    chip.textContent = 'Updated just now';
    chip.hidden = false;
    chip.classList.remove('in');
    void chip.offsetWidth;
    chip.classList.add('in');
    clearTimeout(freshTimer);
    freshTimer = setTimeout(() => (chip.hidden = true), 4200);
  }

  return {
    load,
    prime,
    markUpdated,
    briefSlot: $('.brief-slot', view),
    titleEl: $('.today-title', view),
    refresh,
    render,
    refreshSocial: socialChanged,
    cardFor: (id) => cardEls.get(String(id)) || null,
    situations: () => all,
    select(id) {
      selectedId = id == null ? null : String(id);
      cardEls.forEach((el, k) =>
        el.classList.toggle('is-selected', k === selectedId),
      );
    },
    setLocation(loc) {
      setLocation(loc);
      render();
    },
    get location() {
      return userLoc;
    },
  };
}
