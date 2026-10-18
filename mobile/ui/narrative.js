/**
 * Narrative player: flies the globe through a thread's stops while the time
 * ribbon scrubs the thread's own (schematic) clock.
 */

import { icon } from './icons.js';
import { h, haptic, reducedMotion } from './dom.js';

export function createNarrative({ app, chrome, globe, ribbon, getSituation }) {
  const hud =
    h(`<div class="narr-hud glass-strong" role="region" aria-label="Narrative">
      <div class="narr-top"><button class="narr-play" type="button" aria-label="Pause">${icon('pause')}</button>
        <div class="narr-titles"><div class="narr-step"></div><div class="narr-name"></div></div>
        <button class="icon-btn pick-close" type="button" aria-label="Stop narrative">${icon('close')}</button></div>
      <div class="narr-prog"></div>
      <div class="narr-cav"></div>
    </div>`);
  chrome.appendChild(hud);
  const playBtn = hud.querySelector('.narr-play');
  let run = null;

  function fmt(base) {
    return (ms) => {
      const s = Math.max(0, Math.round((ms - base) / 1000));
      return `T+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
  }

  function sleep(ms, r) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (r.stopped) return resolve();
        if (r.paused) {
          r.resumeAt = () => tick();
          return;
        }
        if (performance.now() - t0 >= ms) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  async function play(thread) {
    stop();
    const r = { stopped: false, paused: false, thread };
    run = r;
    const base = Date.parse(
      `${thread.observedDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`,
    );
    const dur = (thread.elapsedSeconds || 600) * 1000;
    app.classList.add('is-world', 'is-narrative');
    globe.resume();
    ribbon.setWindow({
      start: base,
      end: base + dur,
      label: 'schematic clock',
      format: fmt(base),
    });
    hud.querySelector('.narr-prog').innerHTML = thread.steps
      .map(() => '<i></i>')
      .join('');
    hud.querySelector('.narr-cav').textContent = thread.label || '';
    const sit = getSituation(thread.id);
    if (sit) globe.focus(sit);
    haptic('light');
    let t = base;
    for (let i = 0; i < thread.steps.length && !r.stopped; i += 1) {
      const s = thread.steps[i];
      hud.querySelector('.narr-step').textContent =
        `Stop ${i + 1} of ${thread.steps.length} · ${s.phase || ''}`;
      hud.querySelector('.narr-name').textContent = s.title;
      hud
        .querySelectorAll('.narr-prog i')
        .forEach((el, k) => el.classList.toggle('done', k <= i));
      const target =
        base + (s.progress ?? i / Math.max(1, thread.steps.length - 1)) * dur;
      const flight = globe.flyTo({
        lon: s.lon,
        lat: s.lat,
        height: (s.elev || 1500) + 9000,
        heading: 344,
        pitch: -38,
        duration: reducedMotion() ? 0 : 2.2,
      });
      // Scrub the ribbon toward this stop's schematic time.
      const from = t;
      const t0 = performance.now();
      const scrub = () => {
        if (r.stopped) return;
        const k = Math.min(1, (performance.now() - t0) / 2000);
        t = from + (target - from) * (1 - (1 - k) ** 3);
        ribbon.seek(t);
        globe.setTime(new Date(t));
        if (k < 1) requestAnimationFrame(scrub);
      };
      scrub();
      await Promise.race([flight, sleep(2600, r)]);
      await sleep(reducedMotion() ? 1200 : 1600, r);
    }
    if (!r.stopped) {
      hud.querySelector('.narr-step').textContent = 'End of narrative';
      playBtn.innerHTML = icon('play');
      playBtn.setAttribute('aria-label', 'Replay');
      r.done = true;
    }
  }

  function stop() {
    if (!run) return;
    run.stopped = true;
    run = null;
    app.classList.remove('is-narrative');
    if (!app.classList.contains('keep-world')) app.classList.remove('is-world');
    ribbon.setWindow(null);
    globe.setTime(null);
    playBtn.innerHTML = icon('pause');
  }

  playBtn.addEventListener('click', () => {
    if (!run) return;
    if (run.done) return play(run.thread);
    run.paused = !run.paused;
    playBtn.innerHTML = icon(run.paused ? 'play' : 'pause');
    playBtn.setAttribute('aria-label', run.paused ? 'Play' : 'Pause');
    if (!run.paused && run.resumeAt) {
      const f = run.resumeAt;
      run.resumeAt = null;
      f();
    }
  });
  hud.querySelector('.pick-close').addEventListener('click', stop);

  return {
    play,
    stop,
    get active() {
      return !!run;
    },
  };
}
