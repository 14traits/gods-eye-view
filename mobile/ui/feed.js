/**
 * Now: a two-column, RedNote-style masonry of live situations with a large
 * collapsing title, section tabs, pull-to-refresh and skeleton loading.
 */

import { icon, FAMILY_ICON, FAMILIES } from './icons.js';
import { $, $$, esc, ago, fmtNum, clamp, haptic } from './dom.js';

const SECTIONS = [
  { id: 'now', label: 'Happening now' },
  { id: 'near', label: 'Near you' },
  { id: 'recon', label: 'Reconstructions' },
  { id: 'always', label: 'Always on' },
];

const ASPECTS = [1.25, 1, 1.33, 0.82, 1.18, 0.95];
const FAM_NAME = Object.fromEntries(FAMILIES.map((f) => [f.id, f.name]));

function hashStr(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i += 1)
    x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}

/** Height/width ratio for a card: from the thumbnail URL when known, else stable per id. */
function aspectFor(s) {
  const m = /size=(\d+),(\d+)/.exec(s.thumbnail || '');
  if (m) return clamp(Number(m[2]) / Number(m[1]), 0.72, 1.4);
  if (s.kind === 'reconstruction') return 1.3;
  return ASPECTS[hashStr(String(s.id)) % ASPECTS.length];
}

export function isReconstruction(s) {
  return (
    s.section === 'reconstructions' || s.kind === 'reconstruction' || !!s.thread
  );
}
export function isAlwaysOn(s) {
  return s.section === 'always' || !!s.alwaysOn;
}

function distKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function createFeed(
  view,
  { getSituations, onOpen, onLocate, bindScroll },
) {
  view.innerHTML = `
    <header class="navbar"><span class="nav-title">Now</span>
      <div class="nav-trailing"><button class="icon-btn" type="button" data-act="refresh" aria-label="Refresh">${icon('refresh')}</button></div>
    </header>
    <div class="ptr" aria-hidden="true"><div class="ptr-spinner">${FAMILIES.map((f, i) => `<i style="--c:${f.color};--i:${i}"></i>`).join('')}</div></div>
    <div class="feed-inner">
      <h1 class="large-title">Now</h1>
      <div class="title-sub"><span class="live-dot"></span><span class="feed-count num">Loading the planet…</span></div>
      <div class="feed-tabs" role="tablist" aria-label="Feed sections" data-hscroll>
        ${SECTIONS.map((s, i) => `<button role="tab" type="button" data-sec="${s.id}" aria-selected="${i === 0}">${s.label}</button>`).join('')}
        <span class="feed-tabs-ink" aria-hidden="true"></span>
      </div>
      <div class="feed-note" hidden></div>
      <div class="masonry" role="feed" aria-busy="true"><div class="mcol"></div><div class="mcol"></div></div>
      <p class="feed-end" hidden>You’re caught up with the planet.</p>
    </div>`;

  const inner = $('.feed-inner', view);
  const cols = $$('.mcol', view);
  const masonry = $('.masonry', view);
  const tabs = $('.feed-tabs', view);
  const ink = $('.feed-tabs-ink', view);
  const count = $('.feed-count', view);
  const note = $('.feed-note', view);
  const ptr = $('.ptr', view);
  let section = 'now';
  let all = [];
  let userLoc = null;
  const cardEls = new Map();
  let selectedId = null;

  function skeleton() {
    cols.forEach((c, ci) => {
      c.innerHTML = [0, 1, 2]
        .map(
          (i) =>
            `<div class="card skel"><div class="card-media" style="aspect-ratio:1/${ASPECTS[(i + ci * 2) % ASPECTS.length]}"></div><div class="card-body"><div class="sk-line"></div><div class="sk-line short"></div></div></div>`,
        )
        .join('');
    });
  }

  function cardHtml(s) {
    const m = s.metrics?.[0];
    const ar = aspectFor(s);
    const fam = FAM_NAME[s.family] || s.family;
    return `<article class="card ${s.live ? 'is-live' : isReconstruction(s) ? 'is-recon' : s.stale || (!isAlwaysOn(s) && s.section !== 'always') ? 'is-stale' : 'is-evergreen'}" data-id="${esc(s.id)}" data-family="${esc(s.family)}" aria-labelledby="ct-${esc(s.id)}">
      <button class="card-hit" type="button" aria-label="Open ${esc(s.title)}, ${esc(s.place || '')}"></button>
      <div class="card-media" style="aspect-ratio:1/${ar.toFixed(3)}">
        <img src="${esc(s.thumbnail || '')}" alt="" loading="lazy" decoding="async" fetchpriority="low" />
        <div class="card-badges">
          <span class="fam-tag glass-tag">${icon(FAMILY_ICON[s.family] || 'now')}${esc(fam)}</span>
          ${s.live ? '<span class="live-pill"><span class="live-dot"></span>LIVE</span>' : isReconstruction(s) ? `<span class="live-pill recon">${icon('threads')}4D</span>` : ''}
        </div>
        ${m ? `<div class="card-metric"><b class="num">${esc(fmtNum(m.value, typeof m.value === 'number' && m.value % 1 ? 1 : 0))}</b>${m.unit ? `<small>${esc(m.unit)}</small>` : ''}<span>${esc(m.label)}</span></div>` : ''}
      </div>
      <div class="card-body">
        <h3 class="card-title" id="ct-${esc(s.id)}">${esc(s.title)}</h3>
        <div class="card-place">${icon('pin')}<span>${esc(s.place || '')}</span></div>
        <div class="card-foot"><span class="src">${esc(shortSource(s.source))}</span><span class="ago num" data-ts="${esc(s.updatedAt || '')}">${esc(ago(s.updatedAt))}</span></div>
      </div>
    </article>`;
  }

  function shortSource(src = '') {
    return String(src).split(/[·(]/)[0].trim() || 'Live feed';
  }

  function filtered() {
    if (section === 'recon') return all.filter(isReconstruction);
    if (section === 'always') return all.filter(isAlwaysOn);
    if (section === 'near') {
      const at = userLoc || { lon: -122.42, lat: 37.77 };
      return [...all]
        .filter((s) => Number.isFinite(s.lon))
        .sort((a, b) => distKm(at, a) - distKm(at, b))
        .slice(0, 8);
    }
    return all
      .filter((s) => !isReconstruction(s) && !isAlwaysOn(s))
      .sort(
        (a, b) =>
          (b.severity ?? 0) - (a.severity ?? 0) ||
          new Date(b.updatedAt) - new Date(a.updatedAt),
      );
  }

  function render() {
    const list = filtered();
    cardEls.clear();
    const heights = [0, 0];
    const parts = [[], []];
    for (const s of list) {
      const col = heights[0] <= heights[1] ? 0 : 1;
      parts[col].push(cardHtml(s));
      heights[col] += aspectFor(s) + 0.42;
    }
    cols.forEach((c, i) => (c.innerHTML = parts[i].join('')));
    $$('.card[data-id]', masonry).forEach((el) => {
      cardEls.set(el.dataset.id, el);
      el.classList.toggle('is-selected', el.dataset.id === selectedId);
    });
    masonry.setAttribute('aria-busy', 'false');
    $('.feed-end', view).hidden = !list.length;
    const live = all.filter((s) => s.live).length;
    count.textContent = `${live} live · ${all.length} situations · ${new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
    if (section === 'near' && !userLoc) {
      note.hidden = false;
      note.innerHTML = `<div class="near-prompt glass">${icon('location')}<div><b>See what’s around you</b><span>Sorted from San Francisco until you share your location. It stays on this device.</span></div><button class="pill-btn primary" type="button" data-act="locate">Use location</button></div>`;
    } else note.hidden = true;
    // Images fade in when decoded.
    $$('img', masonry).forEach((img) => {
      if (img.complete) img.classList.add('loaded');
      else
        img.addEventListener('load', () => img.classList.add('loaded'), {
          once: true,
        });
      img.addEventListener('error', () => img.classList.add('failed'), {
        once: true,
      });
    });
  }

  function placeInk() {
    const btn = $(`[data-sec="${section}"]`, tabs);
    if (!btn) return;
    ink.style.width = `${btn.offsetWidth - 20}px`;
    ink.style.transform = `translateX(${btn.offsetLeft + 10}px)`;
  }

  async function load({ quiet = false } = {}) {
    if (!quiet) skeleton();
    try {
      const prev = new Map(all.map((s) => [s.id, JSON.stringify(s.metrics)]));
      all = await getSituations();
      render();
      if (quiet)
        for (const s of all)
          if (prev.has(s.id) && prev.get(s.id) !== JSON.stringify(s.metrics))
            cardEls.get(s.id)?.classList.add('pulse');
    } catch (err) {
      console.error(err);
      count.textContent = 'Could not reach the live feeds';
    }
  }

  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]');
    if (!b || b.dataset.sec === section) return;
    section = b.dataset.sec;
    $$('[data-sec]', tabs).forEach((x) =>
      x.setAttribute('aria-selected', String(x === b)),
    );
    haptic('tick');
    placeInk();
    b.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: 'smooth',
    });
    masonry.classList.remove('swap');
    void masonry.offsetWidth;
    masonry.classList.add('swap');
    render();
  });

  view.addEventListener('click', async (e) => {
    const hit = e.target.closest('.card-hit');
    if (hit) {
      const card = hit.closest('.card');
      const s = all.find((x) => String(x.id) === card.dataset.id);
      if (s) onOpen(s, card);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') refresh();
    if (act === 'locate') {
      userLoc = await onLocate();
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
    const t = animate ? 'transform 420ms var(--spring)' : 'none';
    inner.style.transition = t;
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

  // Keep "2 min ago" honest.
  setInterval(() => {
    $$('.ago[data-ts]', view).forEach((el) => {
      if (el.dataset.ts)
        el.textContent = ago(Number(el.dataset.ts) || el.dataset.ts);
    });
  }, 30000);

  new ResizeObserver(placeInk).observe(tabs);
  requestAnimationFrame(placeInk);

  return {
    load,
    refresh,
    cardFor: (id) => cardEls.get(String(id)) || null,
    situations: () => all,
    select(id) {
      selectedId = id == null ? null : String(id);
      cardEls.forEach((el, k) =>
        el.classList.toggle('is-selected', k === selectedId),
      );
    },
    setLocation(loc) {
      userLoc = loc;
      if (section === 'near') render();
    },
  };
}
