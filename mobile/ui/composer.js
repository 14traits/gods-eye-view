/**
 * Post composer: Capture first, text second (DESIGN.md §11.3 "Reply with
 * evidence"). Structured kinds, an optional place and time anchor.
 */

import { icon } from './icons.js';
import { $, $$, esc, haptic, toast } from './dom.js';
import { createSheet } from './sheet.js';
import { KINDS, KIND } from './rooms.js';
import { llShort, utc } from './bands.js';

export function createComposer({
  rooms,
  getTime,
  getLocation,
  getView,
  onCapture,
  onPosted,
}) {
  const sheet = createSheet({
    label: 'New post',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'composer-sheet opaque',
    heights: { large: (H) => Math.round(Math.min(H * 0.9, 820)) },
  });
  let ctx = null; // { s, replyTo, kind, place, time }

  function placeOptions() {
    const s = ctx.s;
    const opts = [
      { id: 'none', label: 'No place' },
      {
        id: 'situation',
        label: 'At the situation',
        ll: { lat: s.lat, lon: s.lon },
      },
    ];
    const me = getLocation();
    if (me) opts.push({ id: 'me', label: 'Where I am', ll: me });
    const v = getView();
    if (
      v &&
      Number.isFinite(v.lat) &&
      Math.abs(v.lat - s.lat) + Math.abs(v.lon - s.lon) > 0.0005
    )
      opts.push({ id: 'view', label: 'Globe centre', ll: v });
    return opts;
  }

  function render() {
    const s = ctx.s;
    const r = ctx.replyTo || ctx.quote;
    sheet.head.innerHTML = `<div class="c-band tele" data-band="inside"><i class="bd"></i>Record<b>·</b>${esc(s.title)}</div>
      <h2 class="sheet-title">${ctx.quote ? 'Quote post' : r ? 'Reply' : 'Post to the Record'}</h2>
      ${r ? `<div class="cmp-quote ${ctx.quote ? 'is-quote' : ''}"><b class="tele">${ctx.quote ? 'Quoting · ' : ''}${esc(KIND[r.kind]?.name || '')} · ${esc(r.author.handle)}</b>${esc(r.text.slice(0, 140))}${r.text.length > 140 ? '…' : ''}</div>` : ''}`;
    const places = placeOptions();
    const t = getTime();
    sheet.body.innerHTML = `
      <button class="cmp-capture" type="button" data-act="capture">
        <span class="cc-ic">${icon('viewfinder')}</span>
        <span class="cc-t"><b>Answer with a sealed capture</b><span>The strongest reply is a photo or a live view from the scene, signed with your phone’s motion and position. It earns the Was there badge.</span></span>
        ${icon('chevronRight', { cls: 'chev' })}
      </button>
      <div class="cmp-or tele"><span>or write</span></div>
      <div class="kind-row" role="radiogroup" aria-label="Kind of post">
        ${KINDS.map((k) => `<button type="button" role="radio" class="kind-chip" data-kind="${k.id}" aria-checked="${k.id === ctx.kind}">${icon(k.icon)}<span>${k.name}</span></button>`).join('')}
      </div>
      <p class="kind-hint tele">${esc(KIND[ctx.kind].hint)}</p>
      <textarea class="cmp-text" rows="4" maxlength="2000" placeholder="${esc(placeholder(ctx.kind))}" data-no-drag aria-label="Post text"></textarea>
      <div class="cmp-anchor">
        <div class="ca-h tele">${icon('pin')}Anchor in place</div>
        <div class="seg-chips" data-anchor="place">${places.map((p) => `<button type="button" data-v="${p.id}" aria-pressed="${p.id === ctx.place}">${esc(p.label)}${p.ll ? `<small>${esc(llShort(p.ll.lat, p.ll.lon, 2))}</small>` : ''}</button>`).join('')}</div>
        <div class="ca-h tele">${icon('clock')}Anchor in time</div>
        <div class="seg-chips" data-anchor="time"><button type="button" data-v="none" aria-pressed="${ctx.time === 'none'}">No time</button><button type="button" data-v="now" aria-pressed="${ctx.time === 'now'}">Now<small>${esc(utc(new Date(), { seconds: false }))}</small></button>${t ? `<button type="button" data-v="ribbon" aria-pressed="${ctx.time === 'ribbon'}">Ribbon time<small>${esc(utc(t, { seconds: false }))}</small></button>` : ''}</div>
      </div>
      <div class="cmp-foot"><span class="tele">On the record · hash-chained in the room ledger · shared with your other open tabs</span><button class="pill-btn primary" type="button" data-act="post">Post</button></div>`;
  }

  function placeholder(kind) {
    return {
      witness: 'What did you see or hear, from where, and when?',
      context: 'Background that helps people read the data…',
      question: 'What can’t the sensors tell you?',
      correction: 'What is wrong, and what does the evidence show instead?',
      prediction: 'What happens next? It stays on the record.',
    }[kind];
  }

  function open(s, { replyTo = null, kind, quote = null } = {}) {
    ctx = {
      s,
      replyTo,
      quote,
      kind:
        kind ||
        (replyTo
          ? replyTo.kind === 'question'
            ? 'context'
            : 'correction'
          : 'witness'),
      place: 'situation',
      time: 'now',
    };
    render();
    sheet.open('large');
    setTimeout(
      () => $('.cmp-text', sheet.body)?.focus({ preventScroll: true }),
      380,
    );
  }

  sheet.root.addEventListener('click', async (e) => {
    if (!ctx) return;
    const k = e.target.closest('[data-kind]');
    if (k) {
      ctx.kind = k.dataset.kind;
      $$('[data-kind]', sheet.body).forEach((b) =>
        b.setAttribute('aria-checked', String(b === k)),
      );
      $('.kind-hint', sheet.body).textContent = KIND[ctx.kind].hint;
      $('.cmp-text', sheet.body).placeholder = placeholder(ctx.kind);
      haptic('tick');
      return;
    }
    const chip = e.target.closest('[data-anchor] button');
    if (chip) {
      const group = chip.parentElement.dataset.anchor;
      ctx[group] = chip.dataset.v;
      $$('button', chip.parentElement).forEach((b) =>
        b.setAttribute('aria-pressed', String(b === chip)),
      );
      haptic('tick');
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'capture') {
      sheet.close();
      onCapture(ctx.s, { replyTo: ctx.replyTo });
    } else if (act === 'post') {
      const text = $('.cmp-text', sheet.body).value.trim();
      if (!text) {
        $('.cmp-text', sheet.body).focus();
        toast('Write something first');
        return;
      }
      const place = placeOptions().find((p) => p.id === ctx.place)?.ll || null;
      const t =
        ctx.time === 'now'
          ? Date.now()
          : ctx.time === 'ribbon'
            ? +getTime()
            : null;
      const anchor =
        place || t ? { lat: place?.lat, lon: place?.lon, t } : null;
      const p = await rooms.post(ctx.s, {
        kind: ctx.kind,
        text,
        replyTo: ctx.replyTo?.id || null,
        quoteOf: ctx.quote?.id || null,
        anchor,
        evidence: {},
      });
      haptic('success');
      sheet.close();
      toast(`Posted to the room · ${KIND[p.kind].name}`, {
        icon: icon(KIND[p.kind].icon),
      });
      onPosted?.(ctx.s, p);
    }
  });

  return { open, close: () => sheet.close(), root: sheet.root };
}
