/**
 * Eye viewer: the nearest public camera's live frame (DESIGN.md §11.2 Eye),
 * re-requested every refresh interval while open, with a LIVE timecode,
 * the camera id and the direction it looks.
 */

import { icon } from './icons.js';
import { esc, haptic } from './dom.js';
import { createSheet } from './sheet.js';
import { frame } from './cards.js';
import { cardinal, fmtKm, utc, llShort } from './bands.js';

export function createEyeViewer({ globe, onFly }) {
  const sheet = createSheet({
    label: 'Live camera',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'eye-sheet opaque',
    heights: { large: (H) => Math.round(Math.min(H * 0.86, 760)) },
  });
  let timer = 0;
  let clock = 0;
  let cur = null;

  function url() {
    return globe.eyeFrameUrl(cur.id) || cur.imageUrl || '';
  }

  function refresh() {
    const a = sheet.body.querySelector('.ev-frame img.front');
    const b = sheet.body.querySelector('.ev-frame img:not(.front)');
    if (!a || !b) return;
    b.onload = () => {
      b.classList.add('front');
      a.classList.remove('front');
      sheet.body.querySelector('.ev-age').textContent = 'just now';
    };
    b.src = url();
  }

  function open(eye, { from } = {}) {
    if (!eye) return;
    cur = eye;
    const hd = Number(eye.headingDeg);
    sheet.head.innerHTML = `<div class="c-band tele" data-band="ground"><i class="bd"></i>Ground<b>·</b>Public camera${Number.isFinite(eye.distanceKm) ? `<b>·</b>${esc(fmtKm(eye.distanceKm))} from ${esc(from || 'here')}` : ''}</div>
      <h2 class="sheet-title">${esc(eye.title || eye.id)}</h2>
      <div class="sheet-sub">${esc([eye.city, eye.provider].filter(Boolean).join(' · '))}</div>`;
    sheet.body.innerHTML = `<div class="ev-frame" data-band="ground">
        <img class="front" alt="Live frame from ${esc(eye.title || 'camera')}" src="${esc(url())}"/><img alt="" aria-hidden="true"/>
        ${frame()}
        <div class="c-top"><span class="c-live tele"><i></i>LIVE <span data-ev-clock>${utc()}</span></span><span class="c-sid tele">CAM ${esc(String(eye.id).slice(-8).toUpperCase())}</span></div>
        <div class="c-strip tele">GROUND · ${esc(llShort(eye.lat, eye.lon, 4))}${Number.isFinite(hd) ? ` · LOOKING ${cardinal(hd)} ${Math.round(hd)}°` : ''}</div>
      </div>
      <div class="ev-facts tele"><span>Refreshed <b class="ev-age">just now</b></span><span>every 15 s while open</span></div>
      <div class="ev-actions"><button class="pill-btn tinted" type="button" data-ev="fly">${icon('globe')}Show on globe</button></div>
      <p class="footnote" style="padding:12px 2px 0">Public traffic camera via the app’s CCTV proxy. Frames are stills, not video; the time burned into the frame is the camera’s local clock.</p>`;
    const front = sheet.body.querySelector('.ev-frame img.front');
    front.addEventListener(
      'error',
      () => sheet.body.querySelector('.ev-frame')?.classList.add('offline'),
      { once: true },
    );
    sheet.open('large');
    haptic('light');
    clearInterval(timer);
    clearInterval(clock);
    timer = setInterval(refresh, 15000);
    let n = 0;
    clock = setInterval(() => {
      n += 1;
      const c = sheet.body.querySelector('[data-ev-clock]');
      if (c) c.textContent = utc();
      const age = sheet.body.querySelector('.ev-age');
      if (age && n % 5 === 0) age.textContent = `${n % 15} s ago`;
    }, 1000);
  }

  sheet.on('close', () => {
    clearInterval(timer);
    clearInterval(clock);
  });
  sheet.root.addEventListener('click', (e) => {
    if (e.target.closest('[data-ev="fly"]') && cur) {
      sheet.close();
      onFly?.(cur);
    }
  });

  return { open, close: () => sheet.close() };
}
