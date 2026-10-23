/**
 * Director (DESIGN.md §12.8): a presenter menu for demos. Press "." (or
 * triple-tap the Today title) to open it; each beat sets up its state
 * deterministically so the demo never depends on luck. Number keys 1–9, 0, - and = jump
 * straight to a beat, whether or not the menu is open.
 */

import { icon } from './icons.js';
import { esc, haptic, toast } from './dom.js';
import { createSheet } from './sheet.js';

export function createDirector({ beats, onReset }) {
  const sheet = createSheet({
    label: 'Director',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'director-sheet',
    heights: { large: (H) => Math.min(Math.round(H * 0.9), 820) },
  });
  let armed = false;
  let current = -1;

  function render() {
    sheet.head.innerHTML = `<div class="dir-kicker tele">${icon('director')}DIRECTOR · DEMO MODE</div><h2 class="sheet-title">The story, beat by beat</h2><div class="sheet-sub">Each beat sets its own state. Keys 1–9, 0, - and = jump; “.” opens this menu.</div>`;
    sheet.body.innerHTML = `<ol class="dir-beats">${beats
      .map(
        (
          b,
          i,
        ) => `<li><button class="dir-beat ${i === current ? 'done' : ''}" type="button" data-beat="${i}">
          <span class="dir-n num">${i + 1}</span><span class="dir-main"><b>${esc(b.title)}</b><small>${esc(b.note || '')}</small></span>${icon(b.icon || 'chevronRight')}</button></li>`,
      )
      .join('')}</ol>
      <div class="dir-foot"><button class="pill-btn plain" type="button" data-reset>${icon('refresh')}Reset demo</button><span class="tele">Real data shows its source and age · illustrative content is labelled</span></div>`;
  }

  async function run(i) {
    const b = beats[i];
    if (!b) return;
    current = i;
    armed = true;
    haptic('medium');
    if (sheet.isOpen) sheet.close();
    try {
      await b.run();
    } catch (err) {
      console.error('[director] beat failed', err);
      toast(`Beat “${b.title}” could not be set up`, { icon: icon('info') });
    }
  }

  sheet.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-beat]');
    if (b) return run(Number(b.dataset.beat));
    if (e.target.closest('[data-reset]')) {
      sheet.close();
      current = -1;
      await onReset?.();
      toast('Demo reset', { icon: icon('refresh') });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '.') {
      e.preventDefault();
      if (sheet.isOpen) sheet.close();
      else open();
      return;
    }
    // 1–9 and 0 jump to beats 1–10, - and = to 11 and 12, menu open or not:
    // a presenter reads the menu and presses the number.
    const keyBeat = { 0: 9, '-': 10, '=': 11 }[e.key] ?? Number(e.key) - 1;
    if (armed && /^[0-9=-]$/.test(e.key)) {
      e.preventDefault();
      if (sheet.isOpen) sheet.close();
      run(keyBeat);
    }
  });

  function open() {
    armed = true;
    render();
    sheet.open('large');
  }

  /** Triple-tap (or triple-click) on an element opens the director. */
  function bindTripleTap(el) {
    let taps = [];
    el.addEventListener('pointerup', () => {
      const n = performance.now();
      taps = [...taps.filter((t) => n - t < 650), n];
      if (taps.length >= 3) {
        taps = [];
        open();
      }
    });
  }

  return {
    open,
    run,
    bindTripleTap,
    get isOpen() {
      return sheet.isOpen;
    },
  };
}
