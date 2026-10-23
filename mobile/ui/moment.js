/**
 * The Moments player (DESIGN.md §12.4): a cinematic, full-screen replay of a
 * 4D reconstruction. The globe plays the Moment (globe.playMoment); a scrubber
 * covers just the Moment's window; captures pop in at their times with their
 * First-eyes byline, seal and view cone; the chat replays beside it (the
 * social agent's chatOverlay when present); record posts appear as they were
 * made; a legend reads each track's callsign, operator, altitude and speed.
 *
 * On a phone it is an overlay on the globe; on a tablet the chat, captures and
 * record move to the leading pane and the globe keeps the trailing pane.
 */

import { icon } from './icons.js';
import {
  $,
  $$,
  h,
  esc,
  haptic,
  toast,
  clamp,
  esriThumb,
  reducedMotion,
  emitter,
} from './dom.js';
import { utc, fmtKm } from './bands.js';
import { trackAt } from './stubMoments.js';
import { social } from './socialBridge.js';

const TRACK_COL = [
  '#a3d8ff',
  '#ffd27a',
  '#ff9db0',
  '#9be15d',
  '#b39dff',
  '#7cf0d0',
];
const SPEEDS = [1, 10, 30, 60];

const KIND = {
  witness: ['witness', 'Witness'],
  context: ['context', 'Context'],
  question: ['question', 'Question'],
  correction: ['correction', 'Correction'],
  prediction: ['prediction', 'Prediction'],
  synthesis: ['sparkles', 'Clerk · synthesis'],
};

const BADGE = {
  'first-eyes': ['First eyes', 'seal'],
  witness: ['Was there', 'witness'],
  pilot: ['Pilot', 'sky'],
  local: ['Local', 'pin'],
  mod: ['Mod', 'checkmark'],
};

const at = (h) =>
  !h || h.startsWith('@') || h === 'Clerk' || h === 'Record' ? h : `@${h}`;

/** The engine's Moment and the shell's share one shape after this. */
export function normMoment(m) {
  const subject = m.subject || { lon: m.lon, lat: m.lat };
  const R = 6371008.8;
  const dist = (a) => {
    const dLat = ((subject.lat - a.lat) * Math.PI) / 180;
    const dLon = ((subject.lon - a.lon) * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((subject.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  };
  return {
    ...m,
    subject,
    tracks: (m.tracks || []).map((tr) => ({
      ...tr,
      arriveAt: tr.arriveAt ?? tr.points?.find((p) => dist(p) < 900)?.t,
    })),
    captures: (m.captures || []).map((c) => ({
      ...c,
      handle: at(c.handle),
      where: c.where || c.place || '',
      media: c.media || c.kind || 'photo',
      live: c.live || c.kind === 'live',
      distanceM: c.distanceM ?? c.rangeM ?? Math.round(dist(c)),
      headingDeg: Number.isFinite(c.headingDeg)
        ? c.headingDeg
        : (Math.atan2(
            (subject.lon - c.lon) * Math.cos((c.lat * Math.PI) / 180),
            subject.lat - c.lat,
          ) *
            180) /
          Math.PI,
    })),
    chat: (m.chat || []).map((c) => ({ ...c, handle: at(c.handle) })),
    posts: (m.posts || []).map((p) => ({
      ...p,
      handle: at(p.handle),
      votes:
        typeof p.votes === 'number'
          ? { corroborate: p.votes, dispute: 0 }
          : p.votes || { corroborate: 0, dispute: 0 },
    })),
  };
}

/** A capture's thumbnail: the place, with its view cone toward the subject. */
export function coneThumb(c, m, { w = 168, hgt = 120 } = {}) {
  const span = 0.006;
  const mPerPx = (span * 111320 * (hgt / w)) / hgt;
  const len = clamp((c.distanceM || 250) / mPerPx, 26, w * 0.7);
  const a = ((c.headingDeg || 0) - 90) * (Math.PI / 180);
  const f = ((c.fovDeg || 52) / 2) * (Math.PI / 180);
  const cx = w / 2;
  const cy = hgt / 2;
  const p1 = [cx + len * Math.cos(a - f), cy + len * Math.sin(a - f)];
  const p2 = [cx + len * Math.cos(a + f), cy + len * Math.sin(a + f)];
  const tx = cx + len * 0.92 * Math.cos(a);
  const ty = cy + len * 0.92 * Math.sin(a);
  return `<span class="cone-thumb" style="aspect-ratio:${w}/${hgt}">
    <img src="${esc(esriThumb(c.lon, c.lat, span, w * 2, hgt * 2))}" alt="" loading="lazy" decoding="async"/>
    <svg viewBox="0 0 ${w} ${hgt}" aria-hidden="true"><defs><linearGradient id="cg-${esc(c.id)}" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(${(c.headingDeg || 0) - 90} .5 .5)"><stop offset="0" stop-color="#ebc777" stop-opacity=".75"/><stop offset="1" stop-color="#ebc777" stop-opacity=".08"/></linearGradient></defs>
    <path d="M${cx} ${cy}L${p1[0].toFixed(1)} ${p1[1].toFixed(1)}A${len} ${len} 0 0 1 ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}Z" fill="url(#cg-${esc(c.id)})" stroke="#ebc777" stroke-opacity=".8" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="3.6" fill="#ebc777" stroke="#050607" stroke-width="1.4"/>
    ${m?.id === 'empire-state' ? `<path d="M${tx - 5} ${ty - 5}h3M${tx - 5} ${ty - 5}v3M${tx + 5} ${ty - 5}h-3M${tx + 5} ${ty - 5}v3M${tx - 5} ${ty + 5}h3M${tx - 5} ${ty + 5}v-3M${tx + 5} ${ty + 5}h-3M${tx + 5} ${ty + 5}v-3" stroke="#fff" stroke-width="1.1"/>` : ''}
    </svg></span>`;
}

export function createMomentPlayer({
  app,
  globe,
  onExit,
  onOpenEntity,
  onOpenRoom,
  isTwoPane,
}) {
  const ev = emitter();
  const el = h(`<section class="mp" aria-label="Moment player" hidden>
      <div class="mp-stage">
        <header class="mp-top">
          <button class="icon-btn glass-strong liquid mp-back" type="button" aria-label="Close Moment">${icon('chevronLeft')}</button>
          <div class="mp-titles"><div class="mp-kicker tele"></div><h2 class="mp-title"></h2></div>
          <button class="icon-btn glass-strong liquid mp-room" type="button" aria-label="Open the room">${icon('rooms')}</button>
        </header>
        <div class="mp-clock tele"><b class="num mp-utc">—</b><span class="mp-rel num"></span></div>
        <div class="mp-legend glass-strong" role="list" aria-label="Tracks"></div>
        <div class="mp-pops" aria-live="polite"></div>
        <div class="mp-react" role="group" aria-label="React">
          <button type="button" data-react="heart" aria-label="Heart">❤️</button><button type="button" data-react="fire" aria-label="Fire">🔥</button><button type="button" data-react="eyes" aria-label="Eyes">👀</button><button type="button" data-react="wow" aria-label="Wow">😮</button>
        </div>
        <div class="mp-bar glass-strong">
          <button class="mp-play" type="button" aria-label="Pause">${icon('pause')}</button>
          <div class="mp-scrub" role="slider" tabindex="0" aria-label="Moment time"><canvas></canvas><i class="mp-head"></i></div>
          <div class="mp-speeds" role="radiogroup" aria-label="Speed">${SPEEDS.map((s) => `<button type="button" role="radio" data-speed="${s}" aria-checked="${s === 30}">${s}×</button>`).join('')}</div>
        </div>
      </div>
      <aside class="mp-side glass-strong">
        <div class="mp-side-title"><div class="mp-st-k tele"></div><h3></h3><p class="mp-st-s"></p></div>
        <section class="mp-feed" aria-label="On the record, as it happened">
          <header class="mp-fh tele"><span>${icon('receipt')}On the record</span><span class="mp-fn"></span></header>
          <div class="mp-feed-list"></div>
        </section>
        <header class="mp-ch tele"><span><span class="live-dot"></span>Chat replay</span><span class="mp-chn"></span></header>
        <div class="mp-side-head">
          <div class="segmented mp-seg" role="tablist"><button role="tab" type="button" data-seg="chat" aria-selected="true">Chat<span class="mp-n" data-n="chat"></span></button><button role="tab" type="button" data-seg="record" aria-selected="false">Record<span class="mp-n" data-n="record"></span></button><button role="tab" type="button" data-seg="captures" aria-selected="false">Captures<span class="mp-n" data-n="captures"></span></button></div>
        </div>
        <div class="mp-pane" data-pane="chat"><div class="mp-chat"></div></div>
        <div class="mp-pane" data-pane="record" hidden><div class="mp-record"></div></div>
        <div class="mp-pane" data-pane="captures" hidden><div class="mp-caps"></div></div>
        <p class="mp-src tele"></p>
      </aside>
    </section>`);
  app.appendChild(el);
  const legend = $('.mp-legend', el);
  const pops = $('.mp-pops', el);
  const scrub = $('.mp-scrub', el);
  const canvas = $('canvas', scrub);
  const sctx = canvas.getContext('2d');
  const chatEl = $('.mp-chat', el);
  const recEl = $('.mp-record', el);
  const capsEl = $('.mp-caps', el);
  const feedEl = $('.mp-feed-list', el);
  let feedKeys = new Set();

  let m = null;
  let raf = 0;
  let t = 0;
  let speed = 30;
  let shown = { chat: 0, posts: 0, caps: 0 };
  let ext = null; // social chatOverlay
  let seg = 'chat';
  let wasPlaying = false;
  let reactCooldown = 0;
  let offOwn = null;

  /* ---------- rendering pieces ---------- */
  const rel = (ms) => {
    const s = Math.max(0, Math.round((ms - m.time.start) / 1000));
    return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function legendHtml() {
    return (m.tracks || [])
      .map(
        (
          tr,
          i,
        ) => `<button class="mp-tr" type="button" role="listitem" data-track="${esc(tr.id)}" style="--c:${esc(tr.color || TRACK_COL[i % TRACK_COL.length])}">
          <i class="sw"></i><span class="mp-tr-main"><b>${esc(tr.callsign || String(tr.label).replace(/\s*\(illustrative\)/i, ''))}</b><small>${esc(tr.operator || tr.type || tr.kind || '')}</small></span>
          <span class="mp-tr-v tele"><b class="num" data-alt>—</b><span data-spd>—</span></span></button>`,
      )
      .join('');
  }

  function capCard(c, { pop = false } = {}) {
    const fe = c.firstEyes;
    return `<button class="mp-cap ${pop ? 'pop' : ''} ${fe ? 'first' : ''}" type="button" data-cap="${esc(c.id)}">
      ${coneThumb(c, m)}
      <span class="mp-cap-body">
        ${c.self ? `<span class="fe tele">${icon('sealFill')}YOURS${fe ? ' · FIRST EYES' : ''}</span>` : fe ? `<span class="fe tele">${icon('sealFill')}FIRST EYES</span>` : `<span class="fe tele">${icon(c.live ? 'live' : 'seal')}${c.live ? 'LIVE · SEALED' : 'SEALED'}</span>`}
        <b>${esc(c.title)}</b>
        <small>${esc(c.handle)} · ${esc(utc(c.t))} · ${esc(fmtKm((c.distanceM || 0) / 1000))}</small>
      </span></button>`;
  }

  function chatHtml(c) {
    const b = c.badge && BADGE[c.badge];
    return `<div class="mp-msg ${c.badge ? `b-${esc(c.badge)}` : ''}"><span class="mp-who">${b ? `<span class="mp-badge" title="${esc(b[0])}">${icon(b[1])}</span>` : ''}${esc(c.handle)}</span> <span class="mp-txt">${esc(c.text)}</span></div>`;
  }

  function postHtml(p) {
    const k = KIND[p.kind] || KIND.context;
    return `<article class="mp-post k-${esc(p.kind)}"><header><span class="mp-pk">${icon(k[0])}${esc(k[1])}</span><span class="tele">${esc(utc(p.t, { seconds: false }))}</span></header>
      <p><b>${esc(p.handle)}</b> ${esc(p.text)}</p>
      ${p.kind !== 'synthesis' ? `<footer class="tele"><span>${icon('agree')}${p.votes?.corroborate ?? 0} corroborate</span><span>${icon('dispute')}${p.votes?.dispute ?? 0} dispute</span>${p.captureId ? `<button type="button" data-cap="${esc(p.captureId)}">${icon('seal')}Sealed capture</button>` : ''}</footer>` : '<footer class="tele"><span>AI synthesis · cites 5 captures and 37 messages</span></footer>'}</article>`;
  }

  /** A capture as a compact row for the leading pane's feed. */
  function capRow(c) {
    const fe = c.firstEyes;
    return `<button class="mp-fi mp-fcap ${fe ? 'first' : ''}" type="button" data-cap="${esc(c.id)}">
      ${coneThumb(c, m, { w: 96, hgt: 72 })}
      <span class="mp-fbody"><span class="fe tele">${icon(fe ? 'sealFill' : c.live ? 'live' : 'seal')}${fe ? 'FIRST EYES' : c.live ? 'LIVE · SEALED' : 'SEALED CAPTURE'}</span>
      <b>${esc(c.title)}</b><small>${esc(c.handle)} · ${esc(utc(c.t))} · ${esc(fmtKm((c.distanceM || 0) / 1000))}</small></span></button>`;
  }

  /**
   * The leading pane's feed (tablet): captures and record posts stacked
   * newest first as the clock passes them.
   */
  function renderFeed() {
    const items = [
      ...(m.captures || [])
        .filter((c) => c.t <= t)
        .map((c) => ({ key: `c:${c.id}`, t: c.t, html: capRow(c) })),
      ...(m.posts || [])
        .filter((p) => p.t <= t)
        .map((p) => ({
          key: `p:${p.id || p.t}`,
          t: p.t,
          html: postHtml(p).replace('class="mp-post', 'class="mp-fi mp-post'),
        })),
    ].sort((a, b) => b.t - a.t);
    const keys = new Set(items.map((x) => x.key));
    const same =
      keys.size === feedKeys.size && [...keys].every((k) => feedKeys.has(k));
    if (!same) {
      const fresh = feedKeys.size > 0;
      feedEl.innerHTML =
        items
          .slice(0, 12)
          .map((x) =>
            fresh && !feedKeys.has(x.key)
              ? x.html.replace('class="mp-fi', 'class="mp-fi in')
              : x.html,
          )
          .join('') ||
        '<p class="mp-empty tele">Sealed captures and record posts appear here at the moment they were made</p>';
      feedKeys = keys;
      feedEl.scrollTop = 0;
    }
    $('.mp-fn', el).textContent = items.length
      ? `${items.length} ITEM${items.length === 1 ? '' : 'S'}`
      : '';
  }

  function drawScrub() {
    const r = scrub.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = r.width;
    const H = r.height;
    if (canvas.width !== Math.round(W * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, W, H);
    const s = m.time.start;
    const e = m.time.end;
    const x = (ms) => 6 + ((ms - s) / (e - s)) * (W - 12);
    const mid = H / 2 + 6;
    // Chat density (a quiet histogram).
    const bins = new Array(60).fill(0);
    for (const c of m.chat || [])
      bins[Math.min(59, Math.floor(((c.t - s) / (e - s)) * 60))] += 1;
    const peak = Math.max(1, ...bins);
    sctx.fillStyle = 'rgba(255,255,255,0.12)';
    bins.forEach((b, i) => {
      const bh = (b / peak) * 12;
      sctx.fillRect(
        6 + (i / 60) * (W - 12),
        mid - 6 - bh,
        (W - 12) / 60 - 1,
        bh,
      );
    });
    // Track and progress
    sctx.fillStyle = 'rgba(255,255,255,0.14)';
    sctx.fillRect(6, mid - 1.5, W - 12, 3);
    sctx.fillStyle = '#fff';
    sctx.fillRect(6, mid - 1.5, x(t) - 6, 3);
    // Arrivals, captures and posts
    // Beats (the story's chapters), else arrivals.
    const beats = m.beats?.length
      ? m.beats.map((b) => b.t)
      : (m.tracks || []).map((tr) => tr.arriveAt).filter(Boolean);
    for (const bt of beats) {
      sctx.fillStyle =
        bt <= t ? 'rgba(163,216,255,0.95)' : 'rgba(163,216,255,0.4)';
      sctx.fillRect(x(bt) - 1, mid - 9, 2, 18);
    }
    for (const p of m.posts || []) {
      sctx.fillStyle =
        p.t <= t ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
      sctx.beginPath();
      sctx.arc(x(p.t), mid + 9, 2, 0, Math.PI * 2);
      sctx.fill();
    }
    // First eyes stamps its byline onto the timeline as the clock passes it.
    for (const c of m.captures || []) {
      if (!c.firstEyes || c.t > t) continue;
      const k = clamp((t - c.t) / 6000, 0, 1);
      const label = `FIRST EYES · ${c.handle || ''}`;
      sctx.font = '700 8px "JetBrains Mono", ui-monospace, monospace';
      const w = sctx.measureText(label).width + 12;
      const bx = clamp(x(c.t) - w / 2, 2, W - w - 2);
      sctx.globalAlpha = k;
      sctx.fillStyle = 'rgba(235,199,119,0.95)';
      sctx.beginPath();
      sctx.roundRect(bx, 1 + (1 - k) * 4, w, 12, 6);
      sctx.fill();
      sctx.fillStyle = '#2a1a00';
      sctx.textAlign = 'left';
      sctx.fillText(label, bx + 6, 10 + (1 - k) * 4);
      sctx.globalAlpha = 1;
    }
    for (const c of m.captures || []) {
      sctx.fillStyle = c.t <= t ? '#ebc777' : 'rgba(235,199,119,0.4)';
      sctx.beginPath();
      sctx.arc(x(c.t), mid, c.firstEyes ? 5 : 3.6, 0, Math.PI * 2);
      sctx.fill();
      sctx.strokeStyle = '#08090b';
      sctx.lineWidth = 1.2;
      sctx.stroke();
    }
    $('.mp-head', el).style.transform = `translateX(${x(t)}px)`;
  }

  /* ---------- the clock ---------- */
  function sync(force = false) {
    const nc = (m.chat || []).filter((c) => c.t <= t).length;
    const np = (m.posts || []).filter((p) => p.t <= t).length;
    const caps = (m.captures || []).filter((c) => c.t <= t);
    const nk = caps.length;
    // Seeking back re-renders; playing forward appends with a pop.
    // The social overlay replays the raw chat by the clock itself.
    if (ext) {
      try {
        ext.setTime?.(t);
      } catch {
        /* ignore */
      }
    }
    if (force || nc < shown.chat) {
      chatEl.innerHTML =
        (m.chat || [])
          .filter((c) => c.t <= t)
          .slice(-40)
          .map(chatHtml)
          .join('') ||
        `<p class="mp-empty tele">${(m.chat || []).length ? 'The chat starts as the Moment does' : 'No chat was recorded in this window'}</p>`;
    } else
      for (const c of (m.chat || []).slice(shown.chat, nc)) {
        chatEl.querySelector('.mp-empty')?.remove();
        chatEl.insertAdjacentHTML('beforeend', chatHtml(c));
        const last = chatEl.lastElementChild;
        last.classList.add('in');
        while (chatEl.children.length > 60) chatEl.firstElementChild.remove();
        // Reactions in chat rise from the city on the globe.
        const k = /❤️|🙏|♥/.test(c.text)
          ? 'heart'
          : /🔥/.test(c.text)
            ? 'fire'
            : /👀/.test(c.text)
              ? 'eyes'
              : /😮|wild|wow/i.test(c.text)
                ? 'wow'
                : null;
        if (k) burst(k, 4);
      }
    if (force || np < shown.posts)
      recEl.innerHTML =
        (m.posts || [])
          .filter((p) => p.t <= t)
          .map(postHtml)
          .reverse()
          .join('') || emptyRec();
    else
      for (const p of (m.posts || []).slice(shown.posts, np)) {
        recEl.querySelector('.mp-empty')?.remove();
        recEl.insertAdjacentHTML('afterbegin', postHtml(p));
        recEl.firstElementChild.classList.add('in');
      }
    if (force || nk < shown.caps) {
      capsEl.innerHTML =
        caps
          .map((c) => capCard(c))
          .reverse()
          .join('') ||
        '<p class="mp-empty tele">Captures appear here at the moment they were sealed</p>';
      // After a seek, the latest capture stays pinned (settled) for context.
      pops.innerHTML = caps.length
        ? capCard(caps[caps.length - 1]).replace(
            'class="mp-cap ',
            'class="mp-cap settled ',
          )
        : '';
    } else
      for (const c of caps.slice(shown.caps)) {
        capsEl.querySelector('.mp-empty')?.remove();
        capsEl.insertAdjacentHTML('afterbegin', capCard(c));
        popCapture(c);
      }
    if (nc !== shown.chat && seg === 'chat') {
      const pane = chatEl.parentElement;
      pane.scrollTop = pane.scrollHeight;
    }
    shown = { chat: nc, posts: np, caps: nk };
    $('[data-n="chat"]', el).textContent = nc ? ` ${nc}` : '';
    $('[data-n="record"]', el).textContent = np ? ` ${np}` : '';
    $('[data-n="captures"]', el).textContent = nk ? ` ${nk}` : '';
    $('.mp-chn', el).textContent = nc ? `${nc} MESSAGES` : '';
    if (isTwoPane()) renderFeed();
    // Legend: live per-track readouts.
    (m.tracks || []).forEach((tr) => {
      const row = legend.querySelector(`[data-track="${CSS.escape(tr.id)}"]`);
      if (!row) return;
      const p = trackAt(tr, t);
      row.classList.toggle('absent', !p);
      $('[data-alt]', row).textContent = p
        ? `${Math.round((p.altM * 3.28084) / 10) * 10} FT`
        : '—';
      $('[data-spd]', row).textContent = !p
        ? 'NOT YET'
        : p.speedMps
          ? `${Math.round(p.speedMps * 1.94384)} KT`
          : 'LANDED';
    });
    $('.mp-utc', el).textContent = utc(t);
    $('.mp-rel', el).textContent = `${rel(t)} / ${rel(m.time.end)}`;
    drawScrub();
  }

  const emptyRec = () =>
    '<p class="mp-empty tele">Record posts appear as they were made</p>';

  function popCapture(c) {
    const card = h(capCard(c, { pop: true }));
    pops.prepend(card);
    haptic(c.firstEyes ? 'seal' : 'light');
    while (pops.children.length > (isTwoPane() ? 3 : 1))
      pops.lastElementChild.remove();
    setTimeout(() => card.classList.add('settle'), 4200);
  }

  function burst(kind, count = 3) {
    const now = performance.now();
    if (now - reactCooldown < 200) return;
    reactCooldown = now;
    const jitter = () => (Math.random() - 0.5) * 0.01;
    globe.react({
      lon: (m.lon ?? 0) + jitter(),
      lat: (m.lat ?? 0) + jitter(),
      kind,
      count,
    });
  }

  function loop() {
    raf = 0;
    if (!m) return;
    const a = globe.activeMoment();
    const st = globe.playback.state();
    const nt = Number.isFinite(a?.t) ? a.t : Number.isFinite(st?.t) ? st.t : t;
    if (nt !== t) {
      t = clamp(nt, m.time.start, m.time.end);
      sync();
    }
    setPlayingUi(!!(a?.playing ?? st?.playing));
    raf = requestAnimationFrame(loop);
  }

  function setPlayingUi(p) {
    if (el.classList.contains('playing') === p) return;
    el.classList.toggle('playing', p);
    $('.mp-play', el).innerHTML = icon(p ? 'pause' : 'play');
    $('.mp-play', el).setAttribute('aria-label', p ? 'Pause' : 'Play');
  }

  /* ---------- open / close ---------- */
  async function open(
    idOrMoment,
    { at: atT = null, speed: s = null, autoplay = true } = {},
  ) {
    const raw =
      typeof idOrMoment === 'string'
        ? await globe.moment(idOrMoment)
        : idOrMoment;
    const mm = raw ? normMoment(raw) : null;
    if (!mm) {
      toast('That Moment is not available', { icon: icon('film') });
      return null;
    }
    m = mm;
    speed =
      s ?? (SPEEDS.includes(m.recommendedSpeed) ? m.recommendedSpeed : 30);
    $$('[data-speed]', el).forEach((b) =>
      b.setAttribute('aria-checked', String(Number(b.dataset.speed) === speed)),
    );
    el.dataset.illustrative = String(!!m.illustrative);
    $('.mp-kicker', el).innerHTML =
      `<span class="mp-dot"></span>MOMENT · ${esc(m.place || '')}${m.simulated ? ' <span class="tag-ill">Simulated</span>' : m.illustrative ? ' <span class="tag-ill">Illustrative</span>' : ' <span class="tag-real">Recorded</span>'}`;
    $('.mp-title', el).textContent = m.title;
    $('.mp-side-title h3', el).textContent = m.title;
    $('.mp-st-k', el).innerHTML = $('.mp-kicker', el).innerHTML;
    $('.mp-st-s', el).textContent =
      `${Math.round((m.time.end - m.time.start) / 60e3)} min · ${(m.tracks || []).length} tracks · ${(m.captures || []).length} sealed captures · ${(m.posts || []).length} posts on the record`;
    legend.innerHTML = legendHtml();
    const extra = (m.tracks || []).length - 4;
    if (extra > 0)
      legend.insertAdjacentHTML(
        'beforeend',
        `<div class="mp-more tele">+${extra} more tracks on the globe</div>`,
      );
    legend.hidden = !(m.tracks || []).length;
    $('.mp-src', el).textContent = (m.sources || [])
      .map((x) => `${x.name}${x.detail ? ` — ${x.detail}` : ''}`)
      .join(' · ');
    shown = { chat: 0, posts: 0, caps: 0 };
    feedKeys = new Set();
    feedEl.innerHTML = '';
    chatEl.innerHTML = '';
    recEl.innerHTML = emptyRec();
    capsEl.innerHTML = '';
    pops.innerHTML = '';
    // The social agent's chat replay, when it exists.
    ext = null;
    const sm = await social();
    // Your own sealed captures posted into this Moment join its timeline.
    const addOwn = (list) => {
      for (const c of list || []) {
        const id = String(c.id).split(':').pop();
        if (m.captures.some((x) => x.id === id)) continue;
        m.captures.push(
          normMoment({
            ...m,
            captures: [
              {
                ...c,
                id,
                t: clamp(+c.t || m.time.end, m.time.start, m.time.end),
                self: true,
                title: c.title || 'Your sealed capture',
              },
            ],
          }).captures[0],
        );
      }
      m.captures.sort((a, b) => a.t - b.t);
    };
    try {
      addOwn(await sm?.momentCaptures?.(m.id));
    } catch {
      /* optional */
    }
    offOwn?.();
    offOwn =
      sm?.onSocial?.('moment-capture', (e) => {
        if (!m || e?.momentId !== m.id) return;
        addOwn([e.capture]);
        sync(true);
      }) || null;
    const slot = $('.mp-pane[data-pane="chat"]', el);
    slot.classList.remove('has-ext');
    el.classList.remove('has-ext');
    $('.mp-ext', slot)?.remove();
    // Clips carry no chat: the overlay would only invent one.
    if (typeof sm?.chatOverlay === 'function' && (m.chat || []).length) {
      try {
        const host = h('<div class="mp-ext"></div>');
        slot.prepend(host);
        ext = sm.chatOverlay(host, {
          moment: raw,
          globe,
          getTime: () => t,
          // A tablet's leading pane has the height for a real chat column.
          maxLines: isTwoPane() ? 60 : 9,
        });
        ext?.setMoment?.({ ...raw, chat: [] });
        slot.classList.add('has-ext');
        el.classList.add('has-ext');
      } catch (err) {
        console.warn(
          '[moment] chatOverlay failed; using the built-in replay',
          err,
        );
        ext = null;
      }
    }
    el.hidden = false;
    app.classList.add('is-moment');
    void el.offsetWidth;
    el.classList.add('in');
    t = atT ?? m.time.start;
    await globe.playMoment(raw, { speed, camera: true, autoplay: false });
    if (atT != null) globe.seekMoment(atT);
    sync(true);
    if (autoplay) globe.playback.play({ speed });
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    ev.emit('open', m);
    return m;
  }

  function close() {
    if (!m) return;
    cancelAnimationFrame(raf);
    raf = 0;
    // Stop the clock and let a frame render before the engine tears the
    // Moment's primitives down (exiting mid-frame can stop Cesium's render).
    globe.playback.stop();
    const leaving = m;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (m === null || m === leaving) globe.exitMoment();
      }),
    );
    try {
      ext?.destroy?.();
    } catch {
      /* ignore */
    }
    ext = null;
    offOwn?.();
    offOwn = null;
    const was = m;
    m = null;
    el.classList.remove('in');
    app.classList.remove('is-moment');
    setTimeout(
      () => {
        if (!m) el.hidden = true;
      },
      reducedMotion() ? 0 : 320,
    );
    ev.emit('close', was);
    onExit?.(was);
  }

  /* ---------- input ---------- */
  $('.mp-back', el).addEventListener('click', () => {
    haptic('tick');
    close();
  });
  $('.mp-room', el).addEventListener('click', () => m && onOpenRoom?.(m));
  $('.mp-play', el).addEventListener('click', () => {
    haptic('tick');
    const st = globe.playback.state();
    if (st.playing) globe.playback.stop();
    else globe.playback.play({ speed });
  });
  $('.mp-speeds', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (!b) return;
    haptic('tick');
    speed = Number(b.dataset.speed);
    $$('[data-speed]', el).forEach((x) =>
      x.setAttribute('aria-checked', String(x === b)),
    );
    if (globe.playback.state().playing) globe.playback.play({ speed });
  });
  $('.mp-react', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-react]');
    if (!b || !m) return;
    haptic('light');
    reactCooldown = 0;
    burst(b.dataset.react, 3);
    b.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.35)' },
        { transform: 'scale(1)' },
      ],
      { duration: 320, easing: 'cubic-bezier(.32,1.25,.4,1)' },
    );
  });
  const seekTo = (clientX) => {
    const r = scrub.getBoundingClientRect();
    const k = clamp((clientX - r.left - 6) / (r.width - 12), 0, 1);
    const ms = m.time.start + k * (m.time.end - m.time.start);
    globe.seekMoment(ms);
    t = ms;
    sync(true);
  };
  let dragging = false;
  scrub.addEventListener('pointerdown', (e) => {
    if (!m) return;
    scrub.setPointerCapture(e.pointerId);
    dragging = true;
    wasPlaying = globe.playback.state().playing;
    globe.playback.stop();
    el.classList.add('scrubbing');
    seekTo(e.clientX);
  });
  scrub.addEventListener('pointermove', (e) => dragging && seekTo(e.clientX));
  const up = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('scrubbing');
    if (wasPlaying) globe.playback.play({ speed });
  };
  scrub.addEventListener('pointerup', up);
  scrub.addEventListener('pointercancel', up);
  scrub.addEventListener('keydown', (e) => {
    if (!m) return;
    const step = e.shiftKey ? 60e3 : 10e3;
    if (e.key === 'ArrowRight')
      globe.seekMoment(Math.min(m.time.end, t + step));
    else if (e.key === 'ArrowLeft')
      globe.seekMoment(Math.max(m.time.start, t - step));
    else if (e.key === ' ') $('.mp-play', el).click();
    else return;
    e.preventDefault();
    t = globe.activeMoment()?.t ?? t;
    sync(true);
  });
  $('.mp-seg', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg]');
    if (!b) return;
    haptic('tick');
    seg = b.dataset.seg;
    $$('[data-seg]', el).forEach((x) =>
      x.setAttribute('aria-selected', String(x === b)),
    );
    $$('.mp-pane', el).forEach((p) => (p.hidden = p.dataset.pane !== seg));
  });
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-track]');
    if (tr && m) return onOpenEntity?.(`moment:${m.id}:${tr.dataset.track}`);
    const c = e.target.closest('[data-cap]');
    if (c && m) return onOpenEntity?.(`capture:${m.id}:${c.dataset.cap}`);
  });
  document.addEventListener('keydown', (e) => {
    if (!m || e.target.closest?.('input, textarea')) return;
    if (
      e.key === 'Escape' &&
      !document.querySelector(
        '.sheet-layer:not([hidden]) .sheet[aria-modal="true"]',
      )
    )
      close();
  });
  new ResizeObserver(() => m && drawScrub()).observe(scrub);

  return {
    open,
    close,
    on: ev.on,
    get current() {
      return m;
    },
    get time() {
      return t;
    },
    /** Deterministic setup for the director. */
    seek(ms, { play = false } = {}) {
      if (!m) return;
      globe.seekMoment(ms);
      t = ms;
      sync(true);
      if (play) globe.playback.play({ speed });
      else globe.playback.stop();
    },
    setSeg(s) {
      $(`[data-seg="${s}"]`, el)?.click();
    },
  };
}
