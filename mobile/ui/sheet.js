/**
 * Bottom sheet with detents (peek / medium / large), velocity-aware drag,
 * rubber-banding and nested scroll hand-off, after UISheetPresentationController.
 */

import { h, clamp, emitter, haptic, reducedMotion } from './dom.js';
import { icon } from './icons.js';

const DEFAULT_DETENTS = {
  peek: () => 108,
  medium: (H) => Math.round(H * 0.46),
  large: (H) => Math.round(H * 0.92),
};

/**
 * @param {{
 *   host?: HTMLElement, label: string, detents?: string[], initial?: string,
 *   modal?: boolean, dismissible?: boolean, className?: string,
 *   heights?: Record<string,(H:number)=>number>, closeButton?: boolean,
 * }} o
 */
/** Open dismissible sheets, newest last: Escape closes the top one even
 * when focus is elsewhere (on the globe, or nowhere after a click). */
const escStack = [];
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || !escStack.length) return;
  if (e.target.closest?.('input, textarea, [contenteditable]')) return;
  e.preventDefault();
  escStack[escStack.length - 1]();
});

export function createSheet(o) {
  const ev = emitter();
  const detents = o.detents || ['peek', 'medium', 'large'];
  const heights = { ...DEFAULT_DETENTS, ...(o.heights || {}) };
  const host = o.host || document.getElementById('sheets');

  const root = h(`<div class="sheet-layer ${o.modal ? 'is-modal' : ''}" hidden>
      ${o.modal ? '<div class="sheet-scrim" aria-hidden="true"></div>' : ''}
      <section class="sheet ${o.className || ''}" tabindex="-1" role="dialog" aria-modal="${o.modal ? 'true' : 'false'}" aria-label="${o.label}">
        <button class="sheet-grabber" type="button" aria-label="${o.label}: resize"><span></span></button>
        ${o.closeButton ? `<button class="sheet-close icon-btn" type="button" aria-label="Close">${icon('close')}</button>` : ''}
        <div class="sheet-head"></div>
        <div class="sheet-body"></div>
      </section>
    </div>`);
  host.appendChild(root);
  const sheet = root.querySelector('.sheet');
  const body = root.querySelector('.sheet-body');
  const head = root.querySelector('.sheet-head');
  const scrim = root.querySelector('.sheet-scrim');

  let H = 0;
  let current = null;
  let y = 0; // translateY from the top of the large position
  let isOpen = false;

  const hostHeight = () => host.clientHeight || window.innerHeight;
  const maxH = () => heights[detents[detents.length - 1]](H);
  const offsetFor = (name) => maxH() - heights[name](H);

  function measure() {
    H = hostHeight();
    sheet.style.height = `${maxH()}px`;
  }

  function apply(animate, spring = true) {
    sheet.style.transition = animate
      ? `transform ${reducedMotion() ? 160 : 520}ms ${spring ? 'var(--spring)' : 'var(--ease-out)'}`
      : 'none';
    sheet.style.transform = `translate3d(0, ${y}px, 0)`;
    // Lets docked controls sit at the bottom of the visible part.
    sheet.style.setProperty('--off', `${Math.max(0, y)}px`);
    if (scrim) {
      const lowest = offsetFor(detents[0]);
      const k = clamp(1 - y / Math.max(1, lowest + 120), 0, 1);
      scrim.style.transition = animate ? 'opacity 300ms linear' : 'none';
      scrim.style.opacity = String(isOpen ? 0.5 * k + 0.12 : 0);
    }
  }

  function setDetent(name, { animate = true, silent = false } = {}) {
    if (!detents.includes(name)) return;
    const changed = name !== current;
    current = name;
    y = offsetFor(name);
    root.dataset.detent = name;
    sheet.dataset.detent = name;
    body.classList.toggle('scrollable', name === detents[detents.length - 1]);
    if (name !== detents[detents.length - 1]) body.scrollTop = 0;
    apply(animate);
    if (changed && !silent) {
      haptic('tick');
      ev.emit('detent', name);
    }
  }

  function open(name = o.initial || detents[Math.min(1, detents.length - 1)]) {
    measure();
    root.hidden = false;
    isOpen = true;
    if (o.modal || o.dismissible) {
      const i = escStack.indexOf(close);
      if (i >= 0) escStack.splice(i, 1);
      escStack.push(close);
    }
    if (!current || root.dataset.closing) {
      y = maxH() + 40;
      apply(false);
      void sheet.offsetHeight;
    }
    delete root.dataset.closing;
    setDetent(name, { silent: false });
    ev.emit('open', name);
    if (o.modal)
      setTimeout(
        () =>
          // The dialog itself takes focus (no ring on the grabber); Tab
          // reaches the grabber and every control from there.
          (sheet.querySelector('[autofocus]') || sheet)?.focus({
            preventScroll: true,
          }),
        60,
      );
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    const i = escStack.indexOf(close);
    if (i >= 0) escStack.splice(i, 1);
    root.dataset.closing = '1';
    y = maxH() + 40;
    apply(true, false);
    current = null;
    ev.emit('close');
    setTimeout(() => {
      if (!isOpen) root.hidden = true;
    }, 420);
  }

  /* ---------- drag ---------- */
  let drag = null;
  const rubber = (over, dim) => (1 - 1 / ((over * 0.55) / dim + 1)) * dim;

  function bounded(raw) {
    const top = 0;
    const bottom = offsetFor(detents[0]);
    if (raw < top) return top - rubber(top - raw, H);
    if (raw > bottom && !o.dismissible) return bottom + rubber(raw - bottom, H);
    return raw;
  }

  function start(clientY) {
    drag = {
      y0: clientY,
      start: y,
      samples: [{ t: performance.now(), y: clientY }],
    };
    sheet.style.transition = 'none';
    root.classList.add('dragging');
  }
  function move(clientY) {
    if (!drag) return;
    const raw = drag.start + (clientY - drag.y0);
    y = bounded(raw);
    drag.samples.push({ t: performance.now(), y: clientY });
    if (drag.samples.length > 6) drag.samples.shift();
    apply(false);
  }
  function end() {
    if (!drag) return;
    root.classList.remove('dragging');
    const s = drag.samples;
    const a = s[0];
    const b = s[s.length - 1];
    const v = b.t - a.t > 0 ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0; // px/s
    drag = null;
    const projected = y + v * 0.2;
    const lowest = offsetFor(detents[0]);
    if (
      o.dismissible &&
      (projected > lowest + 90 || (y > lowest + 40 && v > 300))
    ) {
      close();
      return;
    }
    let best = detents[0];
    let bd = Infinity;
    for (const d of detents) {
      const dd = Math.abs(offsetFor(d) - projected);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    // A decisive flick always moves at least one detent.
    const idx = detents.indexOf(current);
    if (best === current && Math.abs(v) > 700) {
      const next = clamp(idx + (v < 0 ? 1 : -1), 0, detents.length - 1);
      best = detents[next];
    }
    setDetent(best);
    if (best === current) apply(true);
  }

  // Touch: hand off between the sheet and its scrolling body.
  let touchMode = null; // 'sheet' | 'scroll'
  let ty0 = 0;
  sheet.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      if (e.target.closest('input, textarea, [data-no-drag]')) {
        touchMode = 'scroll';
        return;
      }
      ty0 = e.touches[0].clientY;
      touchMode = null;
    },
    { passive: true },
  );
  sheet.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1 || touchMode === 'scroll') return;
      const cy = e.touches[0].clientY;
      if (!touchMode) {
        const dy = cy - ty0;
        if (Math.abs(dy) < 4) return;
        const inBody = body.contains(e.target);
        const atLarge = current === detents[detents.length - 1];
        if (inBody && atLarge && (dy < 0 || body.scrollTop > 0)) {
          touchMode = 'scroll';
          return;
        }
        if (e.target.closest('[data-hscroll]') && Math.abs(dy) < 8) return;
        touchMode = 'sheet';
        start(ty0);
      }
      if (touchMode === 'sheet') {
        e.preventDefault();
        move(cy);
      }
    },
    { passive: false },
  );
  const tend = () => {
    if (touchMode === 'sheet') end();
    touchMode = null;
  };
  sheet.addEventListener('touchend', tend, { passive: true });
  sheet.addEventListener('touchcancel', tend, { passive: true });

  // Mouse / pen: drag from the grabber or header area.
  sheet.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (!e.target.closest('.sheet-grabber, .sheet-head, .sheet-drag')) return;
    e.preventDefault();
    start(e.clientY);
    const mv = (ev2) => move(ev2.clientY);
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      end();
    };
    window.addEventListener('pointermove', mv, { passive: true });
    window.addEventListener('pointerup', up);
  });

  root.querySelector('.sheet-grabber').addEventListener('click', () => {
    const i = detents.indexOf(current);
    setDetent(detents[(i + 1) % detents.length]);
  });
  root.querySelector('.sheet-close')?.addEventListener('click', () => close());
  scrim?.addEventListener('click', () => close());
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (o.modal || o.dismissible)) {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  });

  new ResizeObserver(() => {
    if (!isOpen) return;
    measure();
    if (current) {
      y = offsetFor(current);
      apply(false);
    }
  }).observe(host);

  return {
    root,
    sheet,
    head,
    body,
    open,
    close,
    setDetent,
    get detent() {
      return current;
    },
    get isOpen() {
      return isOpen;
    },
    on: ev.on,
    off: ev.off,
    /** Visible height of the sheet at its current position. */
    visibleHeight: () => Math.max(0, maxH() - y),
  };
}
