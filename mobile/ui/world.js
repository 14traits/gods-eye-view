/**
 * Card → world: the hero transition into the live globe, the situation
 * brief sheet (peek / medium / large) and the fold back into the card.
 */

import { icon, FAMILY_ICON, FAMILIES } from './icons.js';
import {
  $,
  h,
  esc,
  ago,
  fmtNum,
  fmtCoord,
  haptic,
  toast,
  store,
  reducedMotion,
  SPRING,
  SPRING_SOFT,
  EASE_OUT,
  sparkPath,
  esriThumb,
  emitter,
  safeInsets,
} from './dom.js';
import { createSheet } from './sheet.js';
import { isReconstruction } from './feed.js';

const FAM_NAME = Object.fromEntries(FAMILIES.map((f) => [f.id, f.name]));
let eventPack = null;
export async function loadEventPack() {
  if (!eventPack)
    eventPack = fetch('/events/bhote-koshi-2026/event.json')
      .then((r) => {
        if (!r.ok) throw new Error(`event pack ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        eventPack = null; // let the next caller retry
        throw err;
      });
  return eventPack;
}

export function createWorld({
  app,
  stage,
  globe,
  getCard,
  isTwoPane,
  onThread,
  onFollowChange,
}) {
  const ev = emitter();
  let current = null;
  let busy = false;
  let originCard = null;

  /* ---------- chrome: back button ---------- */
  const back = h(
    `<button class="world-back icon-btn glass-strong liquid" type="button" aria-label="Back to feed">${icon('chevronLeft')}</button>`,
  );
  $('#globe-chrome').appendChild(back);
  back.addEventListener('click', () => close());

  /* ---------- the brief sheet ---------- */
  const sheet = createSheet({
    host: stage,
    label: 'Situation brief',
    detents: ['peek', 'medium', 'large'],
    dismissible: true,
    closeButton: true,
    className: 'brief-sheet',
    heights: {
      peek: () => 22 + (sheet?.head?.offsetHeight || 92) + 16 + safeBottom(),
      medium: (H) => Math.round(H * 0.47),
      large: (H) => Math.round(H * 0.92),
    },
  });
  sheet.on('close', () => {
    if (current && !closingFromCode) close({ fromSheet: true });
  });
  sheet.on('detent', (d) => {
    app.dataset.sheet = d;
    stage.style.setProperty('--sheet-h', `${sheet.visibleHeight()}px`);
  });
  let closingFromCode = false;

  const safeBottom = () => safeInsets().bottom;

  // The world wins: start panning the globe and the sheet steps aside.
  $('#globe').addEventListener(
    'pointerdown',
    () => {
      if (current && sheet.isOpen && sheet.detent !== 'peek')
        sheet.setDetent('peek');
    },
    { capture: true, passive: true },
  );

  // Edge-swipe back (leading edge, like a navigation pop).
  let edge = null;
  stage.addEventListener(
    'touchstart',
    (e) => {
      if (!current) return;
      const t = e.touches[0];
      if (t.clientX - stage.getBoundingClientRect().left < 22)
        edge = { x: t.clientX, y: t.clientY };
    },
    { passive: true },
  );
  stage.addEventListener(
    'touchmove',
    (e) => {
      if (!edge) return;
      const t = e.touches[0];
      if (t.clientX - edge.x > 70 && Math.abs(t.clientY - edge.y) < 60) {
        edge = null;
        close();
      }
    },
    { passive: true },
  );
  stage.addEventListener('touchend', () => (edge = null), { passive: true });

  /* ---------- brief rendering ---------- */
  function metricHtml(m) {
    const v =
      typeof m.value === 'number'
        ? fmtNum(m.value, m.value % 1 ? 1 : 0)
        : m.value;
    return `<div class="metric ${String(v).length > 5 ? 'long' : ''}"><div class="metric-v">${esc(v)}${m.unit ? `<small>${esc(m.unit)}</small>` : ''}</div><div class="metric-l">${esc(m.label)}</div></div>`;
  }

  function sparkHtml(s) {
    if (!Array.isArray(s.series) || s.series.length < 3) return '';
    const W = 220;
    const H = 42;
    const d = sparkPath(s.series, W, H, 3);
    const last = d.split(/[ML]/).filter(Boolean).pop().split(' ').map(Number);
    const m = s.metrics?.[0];
    return `<div class="block"><div class="block-h">Trend<small>${esc(m?.label || '')} · last ${s.series.length} samples</small></div>
      <div class="spark-row"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
        <path class="spark-area" d="${d}L${W - 3} ${H}L3 ${H}Z"/><path class="spark-line" d="${d}"/><circle class="spark-end" cx="${last[0]}" cy="${last[1]}" r="3"/></svg>
        <div class="spark-label"><b>${esc(m ? fmtNum(m.value, typeof m.value === 'number' && m.value % 1 ? 1 : 0) : '')}</b>${esc(m?.unit || '')} now</div></div></div>`;
  }

  function contextEvidence(s) {
    const span = Math.min(
      12,
      Math.max(0.02, (s.camera?.height || 300e3) / 111e3 / 1.6),
    );
    const frames = [
      { t: 'Region', span: Math.min(40, span * 6) },
      { t: 'Area', span },
      { t: 'Close', span: span / 5 },
    ];
    return frames
      .map(
        (
          f,
          i,
        ) => `<a class="ev" href="${esc(esriThumb(s.lon, s.lat, f.span, 900, 1100))}" target="_blank" rel="noopener">
        <img class="ev-img" src="${esc(esriThumb(s.lon, s.lat, f.span, 232, 280))}" alt="" loading="lazy" decoding="async"/>
        <span class="ev-seq">${i + 1}</span><div class="ev-t">${f.t} context</div><div class="ev-s">Esri World Imagery · archival</div></a>`,
      )
      .join('');
  }

  async function packEvidence() {
    const pack = await loadEventPack();
    const pre = `<a class="ev" href="/events/bhote-koshi-2026/pre.webp" target="_blank"><img class="ev-img" src="/events/bhote-koshi-2026/pre.webp" alt="" loading="lazy" decoding="async"/><span class="ev-seq">A</span><div class="ev-t">Before · 16 Oct 2021</div><div class="ev-s">Vantor WorldView-2</div></a>
      <a class="ev" href="/events/bhote-koshi-2026/post.webp" target="_blank"><img class="ev-img" src="/events/bhote-koshi-2026/post.webp" alt="" loading="lazy" decoding="async"/><span class="ev-seq">B</span><div class="ev-t">After · 27 Aug 2026</div><div class="ev-s">Vantor WorldView-3</div></a>`;
    return (
      pre +
      pack.evidenceSpine
        .map(
          (
            e,
          ) => `<a class="ev" href="${esc(e.media?.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer">
          <img class="ev-img" src="${esc(e.media?.posterUrl || esriThumb(e.lon, e.lat, 0.03, 232, 280))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>
          <span class="ev-seq">${e.sequence}</span><div class="ev-t">${esc(e.shortTitle || e.title)}</div><div class="ev-s">${esc(e.media?.platform || 'Source')} · ${esc(e.confidence?.time || '')}</div></a>`,
        )
        .join('')
    );
  }

  function render(s) {
    const followed = store.isFollowed(s.id);
    const recon = isReconstruction(s);
    sheet.sheet.dataset.family = s.family;
    const m0 = s.metrics?.[0];
    const status = s.live
      ? `<span class="live-tag"><span class="live-dot"></span>Live</span>`
      : recon
        ? '<span>Reconstruction</span>'
        : '<span>Stale</span>';
    sheet.head.innerHTML = `
      <div class="brief-top"><span class="fam-tag">${icon(FAMILY_ICON[s.family] || 'now')}${esc(FAM_NAME[s.family] || s.family)}</span>${status}<span>·</span><span class="num">${esc(ago(s.updatedAt))}</span></div>
      <div class="brief-title-row"><h2 class="sheet-title">${esc(s.title)}</h2>${m0 ? `<span class="peek-metric num">${esc(typeof m0.value === 'number' ? fmtNum(m0.value, m0.value % 1 ? 1 : 0) : m0.value)}<small>${esc(m0.unit || '')}</small></span>` : ''}</div>
      <div class="sheet-sub">${esc(s.place || '')}${s.subtitle ? ` — ${esc(s.subtitle)}` : ''}</div>`;
    const metrics = (s.metrics || []).slice(0, 3);
    const time = s.time
      ? `${new Date(s.time.start).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} → ${new Date(s.time.end).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'Live';
    const layers = globe.layers();
    const layerChips = (s.layers || [])
      .map((id) => {
        const l = layers.find((x) => x.id === id);
        const fam = l?.family || id.split('.')[0];
        return `<span class="chip layer-chip" data-family="${esc(fam)}">${icon(FAMILY_ICON[fam] || 'layers')}${esc(l?.name || id)}</span>`;
      })
      .join('');
    sheet.body.innerHTML = `
      ${metrics.length ? `<div class="metrics">${metrics.map(metricHtml).join('')}</div>` : ''}
      <div class="actions" role="group" aria-label="Actions">
        <button class="action" type="button" data-act="follow" aria-pressed="${followed}">${icon('star')}<span>${followed ? 'Following' : 'Follow'}</span></button>
        <button class="action" type="button" data-act="ride">${icon('ride')}<span>Ride</span></button>
        <button class="action" type="button" data-act="eye">${icon('video')}<span>Nearest eye</span></button>
        <button class="action" type="button" data-act="thread">${icon('threads')}<span>Thread</span></button>
        <button class="action" type="button" data-act="share">${icon('share')}<span>Share</span></button>
      </div>
      ${sparkHtml(s)}
      <div class="block"><div class="block-h">Evidence<small>${recon ? 'sourced observations · tap for original' : 'context imagery'}</small></div>
        <div class="evidence" data-hscroll>${recon ? '<div class="ev"><div class="ev-img"></div></div>'.repeat(4) : contextEvidence(s)}</div></div>
      <div class="block"><div class="block-h">Every number, its source and age</div>
        <table class="metric-table"><tbody>${(s.metrics || [])
          .map(
            (m) =>
              `<tr><td>${esc(m.label)}</td><td>${esc(typeof m.value === 'number' ? fmtNum(m.value, m.value % 1 ? 1 : 0) : m.value)} ${esc(m.unit || '')}</td><td>${esc(m.source || s.source || '')} · ${esc(ago(m.updatedAt || s.updatedAt))}</td></tr>`,
          )
          .join('')}</tbody></table></div>
      <div class="block"><div class="block-h">Lenses this situation turns on</div><div class="layer-chips">${layerChips || '<span class="sheet-sub">None</span>'}</div></div>
      <div class="block"><div class="block-h">Details</div><dl class="facts">
        <dt>Where</dt><dd class="mono">${esc(fmtCoord(s.lat, s.lon, 4))}</dd>
        <dt>Window</dt><dd>${esc(time)}</dd>
        <dt>Kind</dt><dd>${esc(s.kind || '—')}</dd>
        <dt>Source</dt><dd>${esc(s.source || '—')}</dd></dl></div>
      ${s.caveat ? `<div class="caveat"><b>Caveat</b>${esc(s.caveat)}</div>` : ''}`;
    if (
      recon &&
      (s.thread === 'bhote-koshi-2026' || s.id === 'bhote-koshi-2026')
    ) {
      packEvidence()
        .then((html) => {
          const strip = $('.evidence', sheet.body);
          if (strip && current === s) strip.innerHTML = html;
          return loadEventPack();
        })
        .then((pack) => {
          if (current !== s || $('.caveat', sheet.body)) return;
          sheet.body.insertAdjacentHTML(
            'beforeend',
            `<div class="caveat"><b>${esc(pack.reconstruction.label)}</b>${esc(pack.reconstruction.caveat)}</div>`,
          );
        })
        .catch((err) => console.warn(err));
    }
  }

  sheet.root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !current) return;
    const s = current;
    haptic('light');
    if (act === 'follow') {
      const on = store.toggleFollow(s.id);
      const b = e.target.closest('[data-act]');
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('span').textContent = on ? 'Following' : 'Follow';
      toast(on ? `Following ${s.title}` : 'Unfollowed', {
        icon: icon(on ? 'starFill' : 'star'),
      });
      onFollowChange?.(s, on);
    } else if (act === 'ride') {
      sheet.setDetent('peek');
      const c = s.camera || {};
      await globe.flyTo({
        lon: c.lon ?? s.lon,
        lat: c.lat ?? s.lat,
        height: Math.max(1500, (c.height || 200e3) * 0.12),
        heading: (c.heading || 0) + 25,
        pitch: -18,
        duration: 2.4,
      });
    } else if (act === 'eye') {
      const cams = globe
        .contactsNear(s.lon, s.lat, 80)
        .filter((c) => /cam|cctv|eye/i.test(c.kind));
      if (cams.length) {
        globe.select(cams[0].id);
        globe.flyTo({ lon: cams[0].lon, lat: cams[0].lat, height: 3000 });
        toast(`Nearest eye: ${cams[0].title}`);
      } else toast('No public camera within 80 km', { icon: icon('video') });
    } else if (act === 'thread') {
      onThread?.(s);
    } else if (act === 'share') {
      const url = `${location.origin}${location.pathname}#s=${encodeURIComponent(s.id)}`;
      try {
        if (navigator.share)
          await navigator.share({
            title: s.title,
            text: `${s.title} — ${s.place}`,
            url,
          });
        else {
          await navigator.clipboard.writeText(url);
          toast('Link copied', { icon: icon('share') });
        }
      } catch {
        /* share cancelled */
      }
    }
  });

  /* ---------- hero geometry ---------- */
  function targetRect() {
    return stage.getBoundingClientRect();
  }

  function heroFor(src, rect) {
    const el = h(
      `<div class="hero" aria-hidden="true"><img alt="" decoding="sync"/></div>`,
    );
    Object.assign(el.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    const img = el.querySelector('img');
    img.src = src || '';
    document.body.appendChild(el);
    return { el, img };
  }

  async function imgSize(img) {
    if (!img.complete || !img.naturalWidth) {
      try {
        await img.decode();
      } catch {
        /* ignore */
      }
    }
    return { w: img.naturalWidth || 480, h: img.naturalHeight || 600 };
  }

  /** Place the hero image to cover `T`, and compute the transform that makes it cover card rect `C`. */
  function coverMath(nat, T, C) {
    const sf = Math.max(T.width / nat.w, T.height / nat.h);
    const sc = Math.max(C.width / nat.w, C.height / nat.h);
    const iw = nat.w * sf;
    const ih = nat.h * sf;
    const left = (T.width - iw) / 2;
    const top = (T.height - ih) / 2;
    const dx = C.left + C.width / 2 - (T.left + T.width / 2);
    const dy = C.top + C.height / 2 - (T.top + T.height / 2);
    return { iw, ih, left, top, k: sc / sf, dx, dy };
  }

  const clipFor = (T, C, r) =>
    `inset(${C.top - T.top}px ${T.right - C.right}px ${T.bottom - C.bottom}px ${C.left - T.left}px round ${r}px)`;

  /* ---------- open ---------- */
  async function open(s, card = null) {
    if (busy) return;
    if (current && current.id === s.id) return;
    busy = true;
    const reduce = reducedMotion();
    const wasOpen = !!current;
    current = s;
    ev.emit('open', s);
    render(s);
    globe.resume();
    const focusing = globe.focus(s);
    originCard?.classList.remove('hero-source');
    originCard = card;

    const media = card?.querySelector('.card-media');
    const T = targetRect();
    if (wasOpen || !media) {
      app.classList.add('is-world');
      sheet.open('medium');
      busy = false;
      haptic('light');
      return;
    }
    const C = media.getBoundingClientRect();
    const { el, img } = heroFor(
      card.querySelector('img')?.currentSrc || s.thumbnail,
      T,
    );
    const nat = await imgSize(img);
    const g = coverMath(nat, T, C);
    Object.assign(img.style, {
      width: `${g.iw}px`,
      height: `${g.ih}px`,
      left: `${g.left}px`,
      top: `${g.top}px`,
    });
    card.classList.add('hero-source');
    haptic('light');

    if (reduce) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 160,
        fill: 'forwards',
      });
      await wait(170);
      app.classList.add('is-world');
      sheet.open('medium');
      await el.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 260,
        fill: 'forwards',
      }).finished;
      el.remove();
      busy = false;
      return;
    }

    const dur = 620;
    const scrim = h('<div class="hero-scrim" aria-hidden="true"></div>');
    document.body.insertBefore(scrim, el);
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: dur * 0.7,
      easing: EASE_OUT,
      fill: 'forwards',
    });
    el.animate(
      [
        { clipPath: clipFor(T, C, 18) },
        { clipPath: `inset(0px 0px 0px 0px round ${isTwoPane() ? 0 : 0}px)` },
      ],
      { duration: dur, easing: SPRING_SOFT, fill: 'forwards' },
    );
    const a = img.animate(
      [
        { transform: `translate(${g.dx}px, ${g.dy}px) scale(${g.k})` },
        { transform: 'translate(0,0) scale(1)' },
      ],
      { duration: dur, easing: SPRING_SOFT, fill: 'forwards' },
    );
    ev.emit('progress', 'morph');
    await a.finished;
    card.classList.remove('hero-source');
    // The world is behind the photo now: reveal it.
    app.classList.add('is-world');
    scrim.remove();
    sheet.open('medium');
    await Promise.race([focusing, wait(250)]);
    const fade = el.animate(
      [
        { opacity: 1, filter: 'blur(0px)' },
        { opacity: 0, filter: 'blur(6px)' },
      ],
      { duration: 520, easing: EASE_OUT, fill: 'forwards' },
    );
    await fade.finished;
    el.remove();
    busy = false;
  }

  /* ---------- close ---------- */
  async function close({ fromSheet = false } = {}) {
    if (!current || busy) return;
    busy = true;
    const s = current;
    const reduce = reducedMotion();
    closingFromCode = true;
    if (!fromSheet) sheet.close();
    closingFromCode = false;
    globe.select(null);
    let card =
      originCard && document.contains(originCard) ? originCard : getCard(s.id);
    const T = targetRect();
    const twoPane = isTwoPane();
    if (!card || twoPane || app.dataset.tab !== 'now') {
      app.classList.remove('is-world');
      card?.classList.remove('hero-source');
      current = null;
      originCard = null;
      busy = false;
      ev.emit('close', s);
      return;
    }
    const { el, img } = heroFor(
      card.querySelector('img')?.currentSrc || s.thumbnail,
      T,
    );
    const nat = await imgSize(img);
    const fadeIn = el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: reduce ? 160 : 260,
      easing: EASE_OUT,
      fill: 'forwards',
    });
    await fadeIn.finished;
    app.classList.remove('is-world');
    card.scrollIntoView({ block: 'nearest' });
    card.classList.add('hero-source');
    const C = card.querySelector('.card-media').getBoundingClientRect();
    const g = coverMath(nat, T, C);
    Object.assign(img.style, {
      width: `${g.iw}px`,
      height: `${g.ih}px`,
      left: `${g.left}px`,
      top: `${g.top}px`,
    });
    if (reduce) {
      card.classList.remove('hero-source');
      await el.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 200,
        fill: 'forwards',
      }).finished;
    } else {
      const dur = 560;
      el.animate(
        [
          { clipPath: 'inset(0px 0px 0px 0px round 0px)' },
          { clipPath: clipFor(T, C, 18) },
        ],
        { duration: dur, easing: SPRING, fill: 'forwards' },
      );
      await img.animate(
        [
          { transform: 'translate(0,0) scale(1)' },
          { transform: `translate(${g.dx}px, ${g.dy}px) scale(${g.k})` },
        ],
        { duration: dur, easing: SPRING, fill: 'forwards' },
      ).finished;
      card.classList.remove('hero-source');
    }
    el.remove();
    current = null;
    originCard = null;
    busy = false;
    haptic('tick');
    ev.emit('close', s);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    open,
    close,
    sheet,
    get current() {
      return current;
    },
    on: ev.on,
    refresh() {
      if (current) render(current);
    },
  };
}
