/**
 * Feed card archetypes (DESIGN.md §11.2): Sensor, Eye, Track, Number,
 * Witness, Room. Every image card carries sensor framing (corner brackets,
 * a hairline reticle) and one monospace telemetry strip burned into the
 * bottom of the frame. Restraint: one strip per card, never a full HUD.
 */

import { icon } from './icons.js';
import { esc, fmtNum, ago, sparkPath } from './dom.js';
import {
  BAND_NAME,
  bandOf,
  archetypeOf,
  telemetryOf,
  headlineOf,
  realSeries,
  sensorId,
  cardinal,
  fmtKm,
  utc,
} from './bands.js';
import { KIND } from './rooms.js';

export const frame = () =>
  '<span class="fr" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
const reticle = () => '<span class="reticle" aria-hidden="true"></span>';

function fmtVal(v) {
  if (typeof v === 'number') return fmtNum(v, v % 1 ? 1 : 0);
  return String(v ?? '');
}

function bandLine(s, extra = []) {
  const band = bandOf(s);
  const parts = [BAND_NAME[band], ...extra].filter(Boolean);
  return `<div class="c-band tele" data-band="${band}"><i class="bd"></i>${parts.map(esc).join('<b>·</b>')}</div>`;
}

function distBits(s) {
  return Number.isFinite(s.distanceKm) ? [`${fmtKm(s.distanceKm)} away`] : [];
}

function liveBit(s) {
  return s.live
    ? ''
    : `<span class="c-stale tele">${s.kind === 'reconstruction' ? '4D · archive' : 'stale'}</span>`;
}

function body(s, { cta = '' } = {}) {
  return `<div class="card-body">
      ${bandLine(s, [...distBits(s), ago(s.updatedAt)])}
      <h3 class="card-title" id="ct-${esc(s.id)}">${esc(s.title)}</h3>
      <div class="card-place"><span>${esc(s.place || '')}</span>${liveBit(s)}</div>
      ${cta}
    </div>`;
}

/** The shared image frame for a situation card. */
function media(s, ar, { strip = true, inner = '', eye = false } = {}) {
  return `<div class="card-media" style="aspect-ratio:1/${ar.toFixed(3)}">
      <img alt="" decoding="async" ${eye ? 'data-eye' : 'data-thumb'} />
      ${eye ? '<img alt="" decoding="async" class="eye-b" aria-hidden="true" />' : ''}
      ${frame()}${reticle()}
      <div class="c-top"><span class="c-sid tele">${esc(sensorId(s))}</span>${s.live ? `<span class="c-live tele"><i></i>${eye ? `LIVE <span data-clock></span>` : 'LIVE'}</span>` : s.kind === 'reconstruction' ? '<span class="c-live tele recon">4D</span>' : ''}</div>
      ${inner}
      ${strip ? `<div class="c-strip tele">${esc(telemetryOf(s))}</div>` : ''}
    </div>`;
}

const hit = (label) =>
  `<button class="card-hit" type="button" aria-label="${esc(label)}"></button>`;

/* ---------------- Situation archetypes ---------------- */

function sensorCard(s, ar) {
  return `<article class="card c-sensor" data-id="${esc(s.id)}" data-band="${bandOf(s)}" data-arch="sensor" aria-labelledby="ct-${esc(s.id)}">
    ${hit(`Open ${s.title}, ${s.place || ''}`)}
    ${media(s, ar)}
    ${body(s)}
  </article>`;
}

function trackCard(s, ar) {
  const hl = headlineOf(s);
  const harm = /squawk/.test(s.kind) && /7[5-7]00/.test(String(hl?.value));
  return `<article class="card c-track ${harm ? 'is-harm' : ''}" data-id="${esc(s.id)}" data-band="${bandOf(s)}" data-arch="track" aria-labelledby="ct-${esc(s.id)}">
    ${hit(`Open ${s.title}`)}
    ${media(s, ar, {
      inner: hl
        ? `<div class="c-readout"><b class="num">${esc(fmtVal(hl.value))}</b>${hl.unit ? `<small>${esc(hl.unit)}</small>` : ''}<span class="tele">${esc(hl.label || '')}</span></div>`
        : '',
    })}
    ${body(s, { cta: `<span class="c-cta tele">${icon('ride')}Ride along</span>` })}
  </article>`;
}

function numberCard(s, ar) {
  const hl = headlineOf(s);
  const ser = realSeries(s);
  const W = 200;
  const H = 54;
  const d = ser.length >= 3 ? sparkPath(ser, W, H, 3) : '';
  return `<article class="card c-number" data-id="${esc(s.id)}" data-band="${bandOf(s)}" data-arch="number" aria-labelledby="ct-${esc(s.id)}">
    ${hit(`Open ${s.title}`)}
    <div class="card-media" style="aspect-ratio:1/${ar.toFixed(3)}">
      <img alt="" decoding="async" data-thumb class="c-num-bg" />
      ${frame()}
      <div class="c-num">
        ${bandLine(s, [s.kind === 'gnss' ? 'ADS-B' : '', ...distBits(s)])}
        <div class="c-big num">${esc(fmtVal(hl?.value))}<small>${esc(hl?.unit || '')}</small></div>
        <div class="c-big-l">${esc(hl?.label || '')}</div>
        ${d ? `<svg class="c-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${d}L${W - 3} ${H}L3 ${H}Z"/><path class="l" d="${d}"/></svg><div class="c-spark-l tele">${esc(s.seriesLabel || 'trend')} · ${ser.length} samples</div>` : ''}
      </div>
      <div class="c-strip tele">${esc(telemetryOf(s))}</div>
    </div>
    <div class="card-body">
      <h3 class="card-title" id="ct-${esc(s.id)}">${esc(s.title)}</h3>
      <div class="card-place"><span>${esc(s.place || '')} · ${esc(ago(s.updatedAt))}</span></div>
    </div>
  </article>`;
}

function eyeCard(s) {
  const hd = s.media?.headingDeg;
  return `<article class="card c-eye wide" data-id="${esc(s.id)}" data-band="ground" data-arch="eye" data-cam="${esc(s.media?.cameraId || '')}" data-refresh="${Number(s.media?.refreshMs) || 15000}" aria-labelledby="ct-${esc(s.id)}">
    ${hit(`Open live camera, ${s.title}`)}
    <div class="card-media" style="aspect-ratio:16/9">
      <img alt="" decoding="async" data-eye src="${esc(s.media?.url || '')}" />
      <img alt="" decoding="async" class="eye-b" aria-hidden="true" />
      ${frame()}${reticle()}
      <div class="c-top"><span class="c-live tele"><i></i>LIVE <span data-clock></span></span><span class="c-sid tele">${esc(sensorId(s))}</span></div>
      <div class="c-eye-cap">
        ${Number.isFinite(hd) ? `<span class="c-fov" style="--hd:${hd}deg" aria-label="Looking ${cardinal(hd)}"><i></i></span>` : ''}
        <div><h3 class="card-title" id="ct-${esc(s.id)}">${esc(s.title)}</h3>
        <div class="card-place"><span>${esc(s.place || '')}</span></div></div>
      </div>
      <div class="c-strip tele">${esc(telemetryOf(s))}${Number.isFinite(hd) ? ` · LOOKING ${cardinal(hd)} ${Math.round(hd)}°` : ''}</div>
    </div>
    <div class="card-body row">
      ${bandLine(s, [...distBits(s), 'Public camera'])}
      <span class="c-src tele">${esc(s.media?.provider || s.source || '')}</span>
    </div>
  </article>`;
}

/* ---------------- Witness (local captures & live sessions) ---------------- */

function witnessCard(w, ar) {
  const sealed = w.sealed;
  const live = w.type === 'live' || w.liveNow;
  const tele = [
    live
      ? 'WITNESS · LIVE'
      : w.unverified
        ? 'UPLOAD · UNVERIFIED'
        : 'WITNESS · SEALED',
    w.seq ? `#${w.seq}` : '',
    Number.isFinite(w.acc) ? `±${Math.round(w.acc)} M` : '',
    Number.isFinite(w.km) && w.situation
      ? `${fmtKm(w.km).toUpperCase()} FROM EVENT`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<article class="card c-witness ${w.unverified ? 'is-unverified' : ''} ${w.liveNow ? 'is-onair' : ''}" data-witness="${esc(w.id)}" data-band="inside" data-arch="witness">
    ${hit(w.liveNow ? `Watch ${w.handle}'s live broadcast` : `Open your ${w.type}`)}
    <div class="card-media" style="aspect-ratio:1/${ar.toFixed(3)}">
      ${w.isVideo && !w.frame ? `<video muted playsinline preload="metadata" ${w.url ? `src="${esc(w.url)}#t=0.1"` : ''}></video>` : `<img alt="" decoding="async" ${w.url || w.frame ? `src="${esc(w.frame || w.url)}"` : ''} />`}
      ${frame()}
      <div class="c-top">${w.liveNow ? `<span class="c-live tele onair"><i></i>LIVE <span data-since="${w.startedAt}"></span></span><span class="c-sid tele">${icon('users')}<span data-viewers>${w.viewers || 0}</span></span>` : `<span class="c-seal ${sealed ? '' : 'un'}">${icon(sealed ? 'sealFill' : 'upload')}</span>`}</div>
      <div class="c-strip tele">${esc(tele)}</div>
    </div>
    <div class="card-body">
      <div class="c-band tele" data-band="inside"><i class="bd"></i>${esc(w.liveNow ? 'Live from a person' : w.unverified ? 'Your upload' : 'Your witness')}<b>·</b>${esc(ago(w.at))}</div>
      <h3 class="card-title">${esc(w.title)}</h3>
      <div class="card-place"><span>${esc(w.sub || '')}</span></div>
    </div>
  </article>`;
}

function promptCard(p, ar) {
  return `<article class="card c-prompt" data-prompt="capture" data-band="inside" data-arch="witness">
    ${hit('Open Capture')}
    <div class="card-media" style="aspect-ratio:1/${ar.toFixed(3)}">
      ${frame()}
      <div class="c-prompt-in">
        <span class="c-prompt-ic">${icon('viewfinder')}</span>
        <div class="c-band tele" data-band="inside"><i class="bd"></i>Inside · you</div>
        <b>${esc(p.title)}</b>
        <span>${esc(p.text)}</span>
      </div>
      <div class="c-strip tele">${esc(p.tele)}</div>
    </div>
    <div class="card-body"><span class="c-cta tele">${icon('viewfinder')}Open Capture</span></div>
  </article>`;
}

/* ---------------- Room ---------------- */

function avatar(a, i) {
  const h =
    [...(a.handle || '?')].reduce((x, c) => x * 31 + c.charCodeAt(0), 7) >>> 0;
  const hue = a.self ? 42 : h % 360;
  return `<i class="av ${a.self ? 'self' : ''}" style="--h:${hue};z-index:${10 - i}" title="${esc(a.handle)}">${esc((a.handle || '?').replace(/^@/, '')[0].toUpperCase())}</i>`;
}

function roomCard(r, watching = 0) {
  const s = r.situation;
  const top = r.top;
  const k = top ? KIND[top.kind] : null;
  return `<article class="card c-room wide" data-room="${esc(s.id)}" data-band="inside" data-arch="room" data-status="${esc(r.status.id)}">
    ${hit(`Join the room for ${s.title}`)}
    <div class="c-room-in">
      <div class="c-room-head">
        <div class="c-band tele" data-band="inside"><i class="bd"></i>Room<b>·</b>${esc(s.title)}</div>
        ${top?.example ? '<span class="badge-example">Example conversation</span>' : `<span class="c-watch tele" data-room-watch="${esc(s.id)}">${watching > 1 ? `<i></i>${watching} here` : ''}</span>`}
      </div>
      ${top ? `<blockquote class="c-claim ${top.example ? 'is-example' : ''}">${esc(top.text)}</blockquote>` : ''}
      <div class="c-room-meta">
        <span class="c-status tele" data-status="${esc(r.status.id)}">${icon(r.status.id === 'disputed' ? 'dispute' : r.status.id === 'open' ? 'question' : 'sealFill')}${esc(r.status.label)}</span>
        ${top ? `<span class="c-kind tele">${icon(k?.icon || 'note')}${esc(k?.name || '')} · ${esc(top.author.handle)}</span>` : ''}
      </div>
      <div class="c-room-foot">
        <span class="avs">${r.participants.slice(0, 5).map(avatar).join('')}</span>
        <span class="tele">${r.participants.length} people · ${r.posts.length} posts${r.openQ.length ? ` · ${r.openQ.length} open question${r.openQ.length > 1 ? 's' : ''}` : ''}</span>
        <span class="c-join">${icon('chevronRight')}</span>
      </div>
    </div>
  </article>`;
}

export function cardHtml(item, ar) {
  if (item.type === 'room') return roomCard(item.room, item.watching);
  if (item.type === 'witness') return witnessCard(item.w, ar);
  if (item.type === 'prompt') return promptCard(item.p, ar);
  const s = item.s;
  const a = item.archetype || archetypeOf(s);
  if (a === 'eye') return eyeCard(s);
  if (a === 'track') return trackCard(s, ar);
  if (a === 'number') return numberCard(s, ar);
  return sensorCard(s, ar);
}

export { avatar, utc };
