/**
 * Today (DESIGN.md §12.3): the daily brief above the feed.
 *
 *  - Since you last looked: the three biggest changes (timeline() and a
 *    situations diff against a stored last-visit time).
 *  - Today's Moment: one replay a day, playing inline on its own canvas.
 *  - Overhead tonight: the next ISS pass and the next launch (real data).
 *  - Your sky now: a mini sky dome; opens the full sheet.
 *  - Your watch: followed places and things, and whether anything is unusual.
 */

import { icon } from './icons.js';
import { $, esc, ago, haptic, esriThumb, reducedMotion, store } from './dom.js';
import { bandOf, utc, cardinal } from './bands.js';
import { trackAt } from './stubMoments.js';
import { domeSvg } from './skySheet.js';

const LAST_KEY = 'gev.lastVisit';
const SKY_KEY = 'gev.sky.v1';
/**
 * The hero Moment's card, so it paints in the first frame (the full Moment
 * JSON is ~0.5 MB and arrives a moment later). Its picture is the same Esri
 * span the live card draws on, bundled (mobile/demo/moments/empire-state.jpg).
 */
const HERO_CARD = {
  id: 'empire-state',
  title: 'Climbers on the Empire State Building',
  place: 'Midtown Manhattan, New York',
  minutes: 25,
  tracks: 3,
  captures: 8,
  illustrative: true,
};
const HERO_IMG = new URL('../demo/moments/empire-state.jpg', import.meta.url)
  .href;

/** The last sky snapshot (this device), so the card never says "Looking up…". */
function readSky() {
  try {
    const j = JSON.parse(localStorage.getItem(SKY_KEY) || 'null');
    if (j?.sky && Date.now() - j.at < 12 * 3600e3)
      return { ...j.sky, cachedAt: j.at };
  } catch {
    /* ignore */
  }
  return null;
}
function saveSky(sky) {
  try {
    const slim = {
      at: sky.at,
      observer: sky.observer,
      aircraft: (sky.aircraft || []).slice(0, 16).map((a) => ({
        id: a.id,
        title: a.title,
        kind: a.kind,
        elevationDeg: a.elevationDeg,
        azimuthDeg: a.azimuthDeg,
        headingDeg: a.headingDeg,
      })),
      satellites: (sky.satellites || []).slice(0, 24).map((x) => ({
        id: x.id,
        title: x.title,
        elevationDeg: x.elevationDeg,
        azimuthDeg: x.azimuthDeg,
      })),
      iss: sky.iss
        ? { visibleNow: false, nextPass: sky.iss.nextPass || null }
        : null,
    };
    localStorage.setItem(
      SKY_KEY,
      JSON.stringify({ at: Date.now(), sky: slim }),
    );
  } catch {
    /* per-device convenience only */
  }
}
const SEEN_KEY = 'gev.seenIds';

function readLast() {
  try {
    const v = Number(localStorage.getItem(LAST_KEY));
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    /* ignore */
  }
  return Date.now() - 8 * 3600e3;
}
function readSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function createToday(
  slot,
  {
    getSituations,
    watch,
    getHome,
    onOpenSituation,
    onOpenEntity,
    onOpenMoment,
    onSky,
    onWatch,
  },
) {
  const lastVisit = readLast();
  const seen = readSeen();
  let globe = null;
  let sits = [];
  let moment = null;
  let sky = null;
  let raf = 0;
  let visible = true;

  slot.innerHTML = `
    <section class="brief" aria-label="Your brief">
      <div class="bf-since glass-card" aria-label="Since you last looked">
        <header class="bf-h"><h3>Since you last looked</h3><span class="tele" data-since></span></header>
        <div class="bf-rows" data-changes><div class="bf-row bf-ph"><i></i><span></span></div><div class="bf-row bf-ph"><i></i><span></span></div><div class="bf-row bf-ph"><i></i><span></span></div></div>
      </div>
      <button class="bf-moment" type="button" aria-label="Play today's Moment">
        <img class="bf-mimg" alt="" decoding="async"/>
        <canvas class="bf-mcanvas" aria-hidden="true"></canvas>
        <span class="bf-mshade"></span>
        <span class="bf-mtop tele"><span class="bf-mk">TODAY’S MOMENT</span><span class="bf-mtag"></span></span>
        <span class="bf-mbody"><b class="bf-mtitle">Loading today’s Moment…</b><small class="bf-msub"></small></span>
        <span class="bf-mplay">${icon('play')}</span>
        <span class="bf-mclock tele"></span>
      </button>
      <button class="bf-sky glass-card" type="button" aria-label="Your sky now">
        <span class="bf-dome" data-dome></span>
        <span class="bf-skytxt"><span class="bf-skyk tele"><span class="live-dot"></span>YOUR SKY NOW</span><b class="bf-skyh" data-skyh>Looking up…</b><small data-skyn></small></span>
        ${icon('chevronRight', { cls: 'chev' })}
      </button>
      <div class="bf-tonight glass-card"><header class="bf-h"><h3>Overhead tonight</h3><span class="tele" data-tonight-where></span></header><div data-tonight><div class="bf-row bf-ph"><i></i><span></span></div><div class="bf-row bf-ph"><i></i><span></span></div></div></div>
      <div class="bf-watch glass-card"><header class="bf-h"><h3>Your watch</h3><button class="link-btn" type="button" data-manage>Manage</button></header><div data-watch></div></div>
    </section>`;

  const mBtn = $('.bf-moment', slot);
  const mCanvas = $('.bf-mcanvas', slot);
  const mctx = mCanvas.getContext('2d');

  // First frame: the hero card from its bundled picture and a few facts.
  {
    const img = $('.bf-mimg', slot);
    img.onload = () => img.classList.add('loaded');
    img.src = HERO_IMG;
    $('.bf-mtitle', slot).textContent = HERO_CARD.title;
    $('.bf-msub', slot).textContent =
      `${HERO_CARD.place} · ${HERO_CARD.minutes} min in 20 s · ${HERO_CARD.tracks} helicopters · ${HERO_CARD.captures} sealed captures`;
    $('.bf-mtag', slot).innerHTML = '<span class="tag-ill">Illustrative</span>';
  }

  /* ---------- since you last looked ---------- */
  function changes() {
    const now = Date.now();
    const out = [];
    const used = new Set();
    let evts = [];
    try {
      evts = globe ? globe.timeline({ from: lastVisit, to: now }) : [];
    } catch {
      evts = [];
    }
    const ranked = [...evts].sort(
      (a, b) => (b.severity || 0) - (a.severity || 0) || b.t - a.t,
    );
    for (const e of ranked) {
      const key = e.momentId || e.situationId || e.entityId || e.title;
      if (used.has(key)) continue;
      used.add(key);
      const s = e.situationId
        ? sits.find((x) => String(x.id) === String(e.situationId))
        : null;
      out.push({
        t: e.t,
        title: s?.title || e.title,
        sub: s?.place || (e.momentId ? 'Moment · replay it' : e.kind),
        band: e.band || (s ? bandOf(s) : 'ground'),
        momentId:
          e.kind === 'moment' || e.kind === 'capture' || e.kind === 'circling'
            ? e.momentId
            : null,
        situationId: e.situationId,
        entityId: e.entityId,
        sev: e.severity || 0,
      });
      if (out.length >= 3) break;
    }
    // New situations since the last visit fill the rest.
    if (out.length < 3)
      for (const s of [...sits].sort(
        (a, b) => (b.severity || 0) - (a.severity || 0),
      )) {
        if (out.length >= 3) break;
        if (
          used.has(s.id) ||
          used.has(s.momentId) ||
          (seen.size && seen.has(String(s.id)))
        )
          continue;
        used.add(s.id);
        out.push({
          t: +new Date(s.updatedAt),
          title: s.title,
          sub: s.place,
          band: bandOf(s),
          situationId: s.id,
          sev: s.severity || 0,
          isNew: !seen.has(String(s.id)),
        });
      }
    return out;
  }

  function renderChanges() {
    const list = changes();
    $('[data-since]', slot).textContent = `${ago(lastVisit).toUpperCase()}`;
    $('[data-changes]', slot).innerHTML =
      list
        .map(
          (c, i) =>
            `<button class="bf-row" type="button" data-ch="${i}" data-band="${c.band}"><i class="bd"></i><span class="bf-main"><b>${esc(c.title)}</b><small>${esc(c.sub || '')}</small></span><span class="bf-when tele">${esc(c.t > Date.now() ? 'SOON' : ago(c.t).replace(' ago', '').toUpperCase())}</span></button>`,
        )
        .join('') ||
      `<div class="bf-calm">${icon('checkmark')}<span><b>Nothing unusual</b> since you last looked.</span></div>`;
    slot._changes = list;
  }

  /* ---------- today's moment ---------- */
  let geom = null;
  function setMoment(m) {
    moment = m;
    if (!m) return;
    const span = 0.02;
    const img = $('.bf-mimg', slot);
    const r = mBtn.getBoundingClientRect();
    // The card is 16:11 whatever its width (today.css).
    const w = Math.max(320, Math.round(r.width || 400));
    const hgt = Math.round((w * 11) / 16);
    if (m.id !== HERO_CARD.id) {
      img.classList.remove('loaded');
      img.src = esriThumb(
        m.lon,
        m.lat,
        span,
        Math.min(1024, w * 2),
        Math.min(1024, Math.round((hgt / w) * Math.min(1024, w * 2))),
      );
    } else if (!img.src.includes('empire-state')) img.src = HERO_IMG;
    img.onload = () => img.classList.add('loaded');
    const dLon = span / Math.cos((m.lat * Math.PI) / 180);
    const dLat = span * (hgt / w);
    geom = { lon0: m.lon - dLon / 2, lat1: m.lat + dLat / 2, dLon, dLat };
    $('.bf-mtitle', slot).textContent = m.title;
    const dur = Math.round((m.time.end - m.time.start) / 60e3);
    $('.bf-msub', slot).textContent =
      `${m.place} · ${dur} min in 20 s · ${(m.tracks || []).length} helicopters · ${(m.captures || []).length} sealed captures`;
    $('.bf-mtag', slot).innerHTML = m.illustrative
      ? '<span class="tag-ill">Illustrative</span>'
      : '<span class="tag-real">Recorded</span>';
    mBtn.classList.add('ready');
    startLoop();
  }

  const TRACK_COL = ['#a3d8ff', '#ffd27a', '#ff9db0', '#9be15d'];
  function drawMoment(ts) {
    raf = 0;
    if (!moment || !geom) return;
    const r = mCanvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = r.width;
    const H = r.height;
    if (mCanvas.width !== Math.round(W * dpr)) {
      mCanvas.width = Math.round(W * dpr);
      mCanvas.height = Math.round(H * dpr);
    }
    const ctx = mctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const m = moment;
    const loop = 20000;
    const k = reducedMotion() ? 0.55 : (ts % loop) / loop;
    const t = m.time.start + k * (m.time.end - m.time.start);
    const px = (lon, lat) => [
      ((lon - geom.lon0) / geom.dLon) * W,
      ((geom.lat1 - lat) / geom.dLat) * H,
    ];
    (m.tracks || []).forEach((tr, i) => {
      const head = trackAt(tr, t);
      if (!head) return;
      const col = TRACK_COL[i % TRACK_COL.length];
      const pts = tr.points;
      for (let j = Math.max(1, head.i - 24); j <= head.i; j += 1) {
        const a = px(pts[j - 1].lon, pts[j - 1].lat);
        const b = px(pts[j].lon, pts[j].lat);
        const f = 1 - (head.i - j) / 24;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.1 + 0.8 * f * f;
        ctx.lineWidth = 1 + 1.8 * f;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const [x, y] = px(head.lon, head.lat);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((head.headingDeg || 0) * Math.PI) / 180);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 4.5);
      ctx.lineTo(0, 2.4);
      ctx.lineTo(-4, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    for (const c of m.captures || []) {
      if (c.t > t) continue;
      const [x, y] = px(c.lon, c.lat);
      const age = (t - c.t) / 60e3;
      const f = Math.max(0, 1 - age / 1.2);
      const hd = ((c.headingDeg || 0) - 90) * (Math.PI / 180);
      const fov = ((c.fovDeg || 52) * Math.PI) / 360;
      const len = 46;
      const g = ctx.createRadialGradient(x, y, 1, x, y, len);
      g.addColorStop(0, `rgba(235,199,119,${0.45 + f * 0.4})`);
      g.addColorStop(1, 'rgba(235,199,119,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, len, hd - fov, hd + fov);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ebc777';
      ctx.beginPath();
      ctx.arc(x, y, 3 + f * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const s = Math.round((t - m.time.start) / 1000);
    const day =
      new Date(m.time.start).toDateString() === new Date().toDateString()
        ? 'TODAY'
        : new Date(m.time.start)
            .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            .toUpperCase();
    $('.bf-mclock', slot).textContent =
      `${day} · ${utc(t)} · +${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (!reducedMotion()) startLoop();
  }
  function startLoop() {
    if (!raf && visible && !document.hidden)
      raf = requestAnimationFrame(drawMoment);
  }
  new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    if (visible) startLoop();
  }).observe(mBtn);
  document.addEventListener('visibilitychange', startLoop);

  /* ---------- overhead tonight ---------- */
  const hm = (t) =>
    new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  function tMinus(t) {
    const d = t - Date.now();
    if (d < 0) return 'NOW';
    const hrs = Math.floor(d / 3600e3);
    const mins = Math.round((d % 3600e3) / 60e3);
    return `T−${hrs ? `${hrs} H ` : ''}${mins} MIN`;
  }
  function renderTonight() {
    const rows = [];
    const pass = sky?.iss?.nextPass;
    const np =
      pass && (pass.end || pass.start + 600e3) > Date.now() ? pass : null;
    if (sky?.iss?.visibleNow)
      rows.push(
        `<button class="bf-row" type="button" data-sky data-band="orbit"><i class="bd"></i><span class="bf-main"><b>ISS is overhead now</b><small>${Math.round(sky.iss.elevationDeg)}° up, ${esc(cardinal(sky.iss.azimuthDeg))}</small></span></button>`,
      );
    else if (np)
      rows.push(
        `<button class="bf-row" type="button" data-sky data-band="orbit"><i class="bd"></i><span class="bf-main"><b>International Space Station</b><small>${np.maxElevationDeg != null ? `Rises to ${np.maxElevationDeg}° · ` : ''}visible ${Math.max(1, Math.round(((np.end || np.start + 360e3) - np.start) / 60e3))} min</small></span><span class="bf-when tele">${esc(hm(np.start).toUpperCase())}</span></button>`,
      );
    const launches = sits
      .filter((s) => /launch/.test(s.kind || ''))
      .map((s) => {
        const ev = (s.events || []).find((e) => +new Date(e.at) > Date.now());
        return { s, at: ev ? +new Date(ev.at) : +new Date(s.time?.start || 0) };
      })
      .filter((x) => x.at > Date.now())
      .sort((a, b) => a.at - b.at);
    if (launches[0]) {
      const { s, at } = launches[0];
      rows.push(
        `<button class="bf-row" type="button" data-sit="${esc(s.id)}" data-band="orbit"><i class="bd"></i><span class="bf-main"><b>${esc(s.title)}</b><small>${esc(s.place || '')}</small></span><span class="bf-when tele">${esc(tMinus(at))}</span></button>`,
      );
    }
    $('[data-tonight]', slot).innerHTML =
      rows.join('') ||
      (sky
        ? '<div class="bf-calm"><span>Clear skies, nothing scheduled.</span></div>'
        : '<div class="bf-row bf-ph"><i></i><span></span></div><div class="bf-row bf-ph"><i></i><span></span></div>');
  }

  function renderSky() {
    const kicker = $('.bf-skyk', slot);
    if (!sky) {
      // Never looked from this device yet: an empty dome, counting.
      const home = getHome();
      $('[data-dome]', slot).innerHTML = domeSvg(
        { aircraft: [], satellites: [] },
        { size: 120, labels: false },
      );
      $('[data-skyh]', slot).textContent = 'Counting what’s above you';
      $('[data-skyn]', slot).textContent =
        `Aircraft within 50 km and satellites over ${home.label || home.name}`;
      return;
    }
    kicker.innerHTML = sky.cachedAt
      ? `YOUR SKY · ${esc(ago(sky.cachedAt).toUpperCase())}`
      : '<span class="live-dot"></span>YOUR SKY NOW';
    $('[data-dome]', slot).innerHTML = domeSvg(sky, {
      size: 120,
      labels: false,
    });
    const home = getHome();
    const ac = (sky.aircraft || []).length;
    const sats = (sky.satellites || []).length;
    const top = (sky.aircraft || [])[0];
    $('[data-skyh]', slot).textContent = sats
      ? `${ac} aircraft and ${sats} satellite${sats === 1 ? '' : 's'} above you`
      : `${ac} aircraft above you right now`;
    $('[data-skyn]', slot).textContent = top
      ? `Highest: ${top.title}, ${Math.round(top.elevationDeg)}° up ${cardinal(top.azimuthDeg)} · ${home.label || home.name}`
      : `A quiet sky over ${home.label || home.name}`;
    $('[data-tonight-where]', slot).textContent = (
      home.label || home.name
    ).toUpperCase();
  }

  /* ---------- your watch ---------- */
  async function renderWatch() {
    const home = getHome();
    const rules = watch.rules().filter((r) => r.on && r.of === 'home');
    const hits = rules.flatMap((r) => watch.hits(r.id).map((x) => ({ r, x })));
    const rows = [];
    rows.push(
      hits.length
        ? `<button class="bf-row" type="button" data-hit="0" data-band="${esc(bandOf(hits[0].x))}"><span class="bf-ic">${icon('home')}</span><span class="bf-main"><b>${esc(home.name)} · ${hits.length} on watch</b><small>${esc(hits[0].x.title)}</small></span><span class="bf-when tele">${esc(hits[0].x.updatedAt ? ago(hits[0].x.updatedAt).replace(' ago', '').toUpperCase() : '')}</span></button>`
        : `<div class="bf-row"><span class="bf-ic">${icon('home')}</span><span class="bf-main"><b>${esc(home.name)} · quiet</b><small>Nothing unusual within ${Math.max(...rules.map((r) => r.within || 0), 200).toLocaleString()} km</small></span><span class="bf-ok">${icon('checkmark')}</span></div>`,
    );
    slot._hits = hits;
    const followed = store.get('followed') || [];
    const things = (
      await Promise.all(
        followed
          .slice(0, 3)
          .map((id) => watch.statusOf(id, sits).catch(() => null)),
      )
    ).filter(Boolean);
    for (const t of things)
      rows.push(
        `<button class="bf-row" type="button" data-thing="${esc(t.id)}" data-band="${t.band}"><span class="bf-ic">${icon(t.icon)}</span><span class="bf-main"><b>${esc(t.title)}</b><small>${esc(t.status)}</small></span>${icon('chevronRight', { cls: 'chev' })}</button>`,
      );
    if (!things.length)
      rows.push(
        `<button class="bf-row bf-add" type="button" data-manage>${icon('plus')}<span>Follow a place, a tail number, a ship or the ISS</span></button>`,
      );
    $('[data-watch]', slot).innerHTML = rows.join('');
  }

  /* ---------- input ---------- */
  slot.addEventListener('click', (e) => {
    const ch = e.target.closest('[data-ch]');
    if (ch) {
      haptic('light');
      const c = slot._changes[Number(ch.dataset.ch)];
      if (c.momentId) return onOpenMoment(c.momentId);
      if (c.situationId) return onOpenSituation(c.situationId);
      if (c.entityId) return onOpenEntity(c.entityId);
      return;
    }
    if (e.target.closest('.bf-moment')) {
      haptic('light');
      if (moment) onOpenMoment(moment.id);
      return;
    }
    if (e.target.closest('.bf-sky, [data-sky]')) {
      haptic('light');
      return onSky();
    }
    const sit = e.target.closest('[data-sit]');
    if (sit) return onOpenSituation(sit.dataset.sit);
    const th = e.target.closest('[data-thing]');
    if (th) return onOpenEntity(th.dataset.thing);
    const hit = e.target.closest('[data-hit]');
    if (hit && slot._hits?.[0]) return onOpenSituation(slot._hits[0].x.id);
    if (e.target.closest('[data-manage]')) onWatch();
  });

  /* ---------- lifecycle ---------- */
  function persistVisit() {
    try {
      localStorage.setItem(LAST_KEY, String(Date.now()));
      localStorage.setItem(
        SEEN_KEY,
        JSON.stringify(sits.map((s) => String(s.id)).slice(0, 200)),
      );
    } catch {
      /* ignore */
    }
  }
  document.addEventListener(
    'visibilitychange',
    () => document.visibilityState === 'hidden' && persistVisit(),
  );
  window.addEventListener('pagehide', persistVisit);

  async function refreshSky() {
    if (!globe) return;
    const home = getHome();
    const fresh = await globe
      .skyNow({ lon: home.lon, lat: home.lat })
      .catch(() => null);
    if (fresh) {
      sky = fresh;
      saveSky(fresh);
    }
    renderSky();
    renderTonight();
  }

  sky = readSky();
  renderSky();
  if (sky) renderTonight();

  watch.onChange(() => renderWatch());
  setInterval(() => {
    if (!document.hidden && slot.offsetParent) {
      refreshSky();
      renderChanges();
    }
  }, 15000);

  return {
    setSituations(list) {
      sits = list || [];
      renderChanges();
      renderTonight();
      renderWatch();
    },
    /** Before the globe: the bundled hero paints the card at once. */
    setMoment(m) {
      if (!moment && m) setMoment(m);
    },
    async setGlobe(g) {
      globe = g;
      renderChanges();
      const m = await g.momentOfTheDay();
      if (
        m &&
        (!moment || m.id !== moment.id || m.time?.start !== moment.time?.start)
      )
        setMoment(m);
      await refreshSky();
      renderWatch();
    },
    refresh() {
      renderChanges();
      refreshSky();
      renderWatch();
    },
    get moment() {
      return moment;
    },
    lastVisit,
  };
}
