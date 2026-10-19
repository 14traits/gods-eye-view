/**
 * Mini-map for placing an upload: real imagery (Esri export) under a fixed
 * centre pin. Drag the map to move the place; +/− to zoom. Apple Maps'
 * "move the map, not the pin" pattern, with a live coordinate strip.
 */

import { icon } from './icons.js';
import { $, h, esc, esriThumb, clamp, haptic } from './dom.js';
import { llShort, mgrs } from './bands.js';

export function createMiniMap(
  host,
  { lat, lon, spanDeg = 0.02, onChange, label = '' },
) {
  const el = h(`<div class="minimap" data-band="inside">
      <div class="mm-pane"><img class="mm-img" alt="" draggable="false"/><img class="mm-next" alt="" draggable="false"/></div>
      <span class="mm-pin" aria-hidden="true">${icon('pin')}</span>
      <span class="mm-cross" aria-hidden="true"></span>
      <div class="mm-zoom"><button type="button" data-z="in" aria-label="Zoom in">${icon('plus')}</button><button type="button" data-z="out" aria-label="Zoom out">${icon('minus')}</button></div>
      <div class="mm-strip tele"></div>
      ${label ? `<div class="mm-label tele">${esc(label)}</div>` : ''}
    </div>`);
  host.appendChild(el);
  const pane = $('.mm-pane', el);
  const img = $('.mm-img', el);
  const next = $('.mm-next', el);
  const strip = $('.mm-strip', el);
  let c = { lat, lon };
  let span = spanDeg;
  let drag = null;

  const dims = () => {
    const r = el.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };
  // Degrees per pixel (equirectangular near the centre; esriThumb uses the same box).
  function degPerPx() {
    const { w, h: hh } = dims();
    const dLon = span / Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
    const dLat = span * (hh / w);
    return { x: dLon / w, y: dLat / hh };
  }

  function load() {
    const { w, h: hh } = dims();
    const url = esriThumb(
      c.lon,
      c.lat,
      span,
      Math.round(Math.min(800, w * 2)),
      Math.round(Math.min(800, hh * 2)),
    );
    next.onload = () => {
      img.src = next.src;
      pane.style.transform = '';
    };
    next.src = url;
    strip.textContent = `${llShort(c.lat, c.lon, 5)} · ${mgrs(c.lat, c.lon, 4)}`;
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    pane.style.transform = `translate(${drag.dx}px, ${drag.dy}px)`;
    const k = degPerPx();
    strip.textContent = `${llShort(c.lat + drag.dy * k.y, c.lon - drag.dx * k.x, 5)} · moving`;
  });
  const end = () => {
    if (!drag) return;
    el.classList.remove('dragging');
    const k = degPerPx();
    if (Math.abs(drag.dx) + Math.abs(drag.dy) > 2) {
      c = {
        lat: clamp(c.lat + drag.dy * k.y, -85, 85),
        lon: ((c.lon - drag.dx * k.x + 540) % 360) - 180,
      };
      haptic('tick');
      load();
      onChange?.({ ...c });
    }
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.style.touchAction = 'none';
  el.addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (!z) return;
    span = clamp(span * (z === 'in' ? 0.5 : 2), 0.0015, 40);
    haptic('tick');
    load();
  });
  requestAnimationFrame(load);

  return {
    el,
    get center() {
      return { ...c };
    },
    set(ll, s) {
      c = { lat: ll.lat, lon: ll.lon };
      if (s) span = s;
      load();
      onChange?.({ ...c });
    },
  };
}
