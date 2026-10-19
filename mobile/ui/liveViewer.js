/**
 * Watch a live broadcast from another tab on this device: frames arrive over
 * BroadcastChannel about once a second with the broadcaster's telemetry and
 * sealed segment count. Watching reports back so the broadcaster's viewer
 * count is real.
 */

import { esc, haptic } from './dom.js';
import { createSheet } from './sheet.js';
import { frame } from './cards.js';
import { llShort, cardinal } from './bands.js';

export function createLiveViewer({ rt, globe }) {
  const sheet = createSheet({
    label: 'Live broadcast',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'eye-sheet opaque',
    heights: { large: (H) => Math.round(Math.min(H * 0.86, 760)) },
  });
  let cur = null;
  let tick = 0;
  let pin = null;

  function paint(l) {
    if (!cur || l.id !== cur.id) return;
    cur = { ...cur, ...l };
    const img = sheet.body.querySelector('.ev-frame img');
    if (img && l.frame) img.src = l.frame;
    const t = sheet.body.querySelector('[data-lv-tele]');
    if (t)
      t.textContent = `INSIDE · ${llShort(l.lat, l.lon, 3)} · HDG ${Math.round(l.headingDeg || 0)}° ${cardinal(l.headingDeg)} · ${l.segments || 0} SEALED SEGMENTS`;
    if (pin) globe.removePin(pin);
    if (Number.isFinite(l.lat))
      pin = globe.addPin({
        id: `watch:${l.id}`,
        kind: 'live',
        lon: l.lon,
        lat: l.lat,
        headingDeg: l.headingDeg || 0,
        fovDeg: 62,
        label: `${l.handle} · live`,
      });
  }

  function open(w) {
    const l = rt.lives().find((x) => x.id === w.liveId) || {
      id: w.liveId,
      handle: w.handle,
      startedAt: w.startedAt,
    };
    cur = l;
    sheet.head.innerHTML = `<div class="c-band tele" data-band="inside"><i class="bd"></i>Inside<b>·</b>Live from a person</div>
      <h2 class="sheet-title">${esc(l.handle || 'Someone')} is live</h2>
      <div class="sheet-sub">${esc(l.situationTitle ? `Near ${l.situationTitle}` : 'Broadcasting from this device’s other tab')}</div>`;
    sheet.body.innerHTML = `<div class="ev-frame" data-band="inside"><img class="front" alt="Latest broadcast frame" ${l.frame ? `src="${esc(l.frame)}"` : ''}/>${frame()}
        <div class="c-top"><span class="c-live tele onair"><i></i>LIVE <span data-lv-since></span></span><span class="c-sid tele">SEALED EVERY 10 S</span></div>
        <div class="c-strip tele" data-lv-tele></div></div>
      <p class="footnote" style="padding:12px 2px 0">Frames reach this tab over BroadcastChannel about once a second (a prototype stand-in for a streaming server). The broadcaster’s file is sealed as a hash chain every 10 seconds; the bundle appears in their You tab when they end.</p>`;
    paint(l);
    sheet.open('large');
    rt.watch(l.id);
    haptic('light');
    clearInterval(tick);
    tick = setInterval(() => {
      const el = sheet.body.querySelector('[data-lv-since]');
      if (!el || !cur?.startedAt) return;
      const s = Math.max(0, Math.round((Date.now() - cur.startedAt) / 1000));
      el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
  }

  rt.on('live', paint);
  rt.on('live-end', ({ id }) => {
    if (cur?.id !== id) return;
    const t = sheet.body.querySelector('[data-lv-tele]');
    if (t)
      t.textContent =
        'BROADCAST ENDED · BUNDLE SEALED ON THE BROADCASTER’S DEVICE';
    sheet.body.querySelector('.c-live')?.classList.add('ended');
  });
  sheet.on('close', () => {
    clearInterval(tick);
    rt.watch(null);
    if (pin) globe.removePin(pin);
    pin = null;
    cur = null;
  });

  return { open };
}
