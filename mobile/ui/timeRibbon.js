/**
 * The time machine (DESIGN.md §12.5).
 *
 * A fixed playhead over a moving track: recorded range shading (history()),
 * forecast range, event pips coloured by altitude band with detents, momentum
 * scrubbing, a NOW snap, play/pause at 1×/10×/60×/600×, a big readable time
 * readout ("−42 MIN · 14:02:11Z"), and range select → "Clip this Moment".
 * Works with touch, mouse drag, trackpad swipe (wheel) and pinch (ctrl+wheel).
 *
 * The public surface of the round-two ribbon is kept: setPips, setWindow,
 * scrubTo, seek, goLive, time, isLive. Calls `onTime(Date | null)`.
 */

import { h, clamp, haptic, reducedMotion, esc } from './dom.js';
import { icon } from './icons.js';
import { BAND_COLOR, utc } from './bands.js';

const MIN = 60e3;
const HOUR = 3600e3;
const SPEEDS = [1, 10, 60, 600];
const STEPS = [1, 5, 10, 15, 30, 60, 180, 360, 720, 1440].map((m) => m * MIN);

/** "−42 MIN", "−3 H 12 MIN", "+2 H" */
export function fmtDelta(ms) {
  const sign = ms < 0 ? '−' : '+';
  if (Math.abs(ms) < MIN) return `${sign}${Math.round(Math.abs(ms) / 1000)} S`;
  const a = Math.round(Math.abs(ms) / MIN);
  if (a < 60) return `${sign}${a} MIN`;
  const hrs = Math.floor(a / 60);
  const m = a % 60;
  if (hrs >= 48) return `${sign}${Math.round(hrs / 24)} D`;
  return `${sign}${hrs} H${m ? ` ${m} MIN` : ''}`;
}

export function createTimeRibbon(
  parent,
  {
    getWindow,
    onTime,
    playback = null,
    getHistory = null,
    onClip = null,
    onPip = null,
  },
) {
  const el =
    h(`<div class="ribbon tm glass-strong liquid is-live" role="group" aria-label="Time machine">
      <div class="tm-row">
        <button class="tm-play" type="button" aria-label="Play">${icon('play')}</button>
        <div class="tm-read" aria-live="off">
          <b class="tm-delta num">LIVE</b><span class="tm-abs num"></span>
        </div>
        <div class="tm-speeds" role="radiogroup" aria-label="Playback speed">
          ${SPEEDS.map((s) => `<button type="button" role="radio" data-speed="${s}" aria-checked="${s === 60}">${s}×</button>`).join('')}
        </div>
        <button class="tm-clip icon-btn" type="button" aria-pressed="false" aria-label="Select a range to clip">${icon('scissors')}</button>
        <button class="rb-live tm-now is-live" type="button" aria-label="Return to now"><span class="live-dot"></span><span>NOW</span></button>
      </div>
      <div class="rb-track tm-track" role="slider" tabindex="0" aria-label="Scrub time" aria-valuetext="Live">
        <canvas></canvas>
        <div class="rb-head tm-head" aria-hidden="true"><i></i></div>
      </div>
      <div class="tm-callout tele" hidden></div>
      <div class="tm-cliprow" hidden>
        <span class="tm-cliplen tele"></span>
        <button class="pill-btn plain tm-clipcancel" type="button">Cancel</button>
        <button class="pill-btn primary tm-clipgo" type="button">${icon('film')}Clip this Moment</button>
      </div>
    </div>`);
  parent.appendChild(el);
  const track = el.querySelector('.tm-track');
  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const playBtn = el.querySelector('.tm-play');
  const nowBtn = el.querySelector('.tm-now');
  const clipBtn = el.querySelector('.tm-clip');
  const readD = el.querySelector('.tm-delta');
  const readA = el.querySelector('.tm-abs');
  const callout = el.querySelector('.tm-callout');
  const clipRow = el.querySelector('.tm-cliprow');
  const clipLen = el.querySelector('.tm-cliplen');

  let win = getWindow();
  let rec = null; // { start, end }
  let arch = null; // the bundled recording: { start, end, label }
  let custom = null;
  let pips = [];
  let t = Date.now();
  let live = true;
  let pxPerHour = 80;
  let W = 0;
  let Hh = 0;
  let dpr = 1;
  let raf = 0;
  let vel = 0;
  let emitTimer = 0;
  let speed = 60;
  let playing = false;
  let clipMode = false;
  let range = null; // { a, b }
  let hotPip = null;
  let calloutTimer = 0;

  const start = () =>
    custom
      ? custom.start
      : Math.min(
          win.start.getTime(),
          rec?.start ?? Infinity,
          arch ? arch.start - HOUR : Infinity,
        );
  const end = () => (custom ? custom.end : win.end.getTime());
  const nowMs = () => (custom ? (custom.now ?? custom.start) : Date.now());
  const x = (ms) => W / 2 + ((ms - t) / HOUR) * pxPerHour;
  const tAt = (px) => t + ((px - W / 2) / pxPerHour) * HOUR;

  function refreshHistory() {
    try {
      const hst = getHistory?.();
      if (hst && Number.isFinite(+hst.start))
        rec = { start: +hst.start, end: +hst.end || Date.now() };
      const a = hst?.archive;
      arch =
        a && Number.isFinite(+a.start)
          ? {
              start: +a.start,
              end: +a.end,
              label: `RECORDING · ${new Date(+a.start)
                .toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })
                .toUpperCase()}`,
            }
          : null;
    } catch {
      rec = null;
    }
  }

  function resize() {
    const r = track.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    Hh = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(Hh * dpr);
    if (custom)
      pxPerHour = (W * 0.9) / (Math.max(MIN, custom.end - custom.start) / HOUR);
    else if (!resize.done) {
      // Six recorded hours span about 1.3 track widths.
      pxPerHour = clamp(W / 4.6, 40, 240);
      resize.done = true;
    }
    draw();
  }

  function stepFor() {
    for (const s of STEPS) if ((s / HOUR) * pxPerHour >= 11) return s;
    return STEPS[STEPS.length - 1];
  }

  function draw() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    const s = start();
    const e = end();
    const n = nowMs();
    const base = Math.round(Hh * 0.6);
    const xs = clamp(x(s), -2, W + 2);
    const xe = clamp(x(e), -2, W + 2);
    const xn = clamp(x(n), -2, W + 2);

    // Body of the window
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fillRect(xs, base - 12, xe - xs, 24);
    if (!custom) {
      // Range labels sit inside the band's lower edge. Each is placed only
      // where it fits inside its own range and clear of the labels already
      // placed, so they never run into each other ("RECORDEDCAST").
      ctx.font = '600 8.5px "JetBrains Mono", ui-monospace, monospace';
      const placed = [];
      const label = (texts, from, to, color, align = 'left') => {
        // The longest wording that fits inside its range.
        const all = [].concat(texts);
        const text =
          all.find(
            (tx) =>
              ctx.measureText(tx).width + 8 <=
              Math.min(to, W - 24) - Math.max(from, 24),
          ) || all[all.length - 1];
        const w = ctx.measureText(text).width;
        const lo = Math.max(from, 24);
        const hi = Math.min(to, W - 24);
        if (hi - lo < w + 8) return;
        const x0 = align === 'right' ? hi - 4 - w : lo + 4;
        if (placed.some(([a, b]) => x0 < b + 8 && x0 + w > a - 8)) return;
        placed.push([x0, x0 + w]);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(text, x0, base + 9);
      };
      const band = (a, b, top, bottom, edge) => {
        const g = ctx.createLinearGradient(0, base - 12, 0, base + 12);
        g.addColorStop(0, top);
        g.addColorStop(1, bottom);
        ctx.fillStyle = g;
        ctx.fillRect(a, base - 12, b - a, 24);
        ctx.fillStyle = edge;
        ctx.fillRect(a, base - 12, b - a, 1.2);
      };
      // The bundled recording: real positions at their real times.
      if (arch) {
        const a = clamp(x(arch.start), -2, W + 2);
        const b = clamp(x(Math.min(arch.end, n)), -2, W + 2);
        if (b > a) {
          band(
            a,
            b,
            'rgba(122,231,199,0.2)',
            'rgba(122,231,199,0.05)',
            'rgba(122,231,199,0.8)',
          );
        }
      }
      // Recorded range: where this device remembers every contact.
      if (rec) {
        const a = clamp(x(rec.start), -2, W + 2);
        band(
          a,
          xn,
          'rgba(163,216,255,0.22)',
          'rgba(163,216,255,0.06)',
          'rgba(163,216,255,0.85)',
        );
      }
      // Forecast
      if (xn < W) {
        const g = ctx.createLinearGradient(xn, 0, Math.min(W, xe), 0);
        g.addColorStop(0, 'rgba(179,157,255,0.2)');
        g.addColorStop(1, 'rgba(179,157,255,0.02)');
        ctx.fillStyle = g;
        ctx.fillRect(xn, base - 12, Math.min(W, xe) - xn, 24);
      }
      // Labels: forecast first (anchored at now), then the recordings.
      if (xn < W)
        label('FORECAST', xn, Math.min(W, xe), 'rgba(199,180,255,0.75)');
      if (rec)
        label(
          ['RECORDED', 'REC'],
          x(rec.start),
          xn,
          'rgba(163,216,255,0.8)',
          'right',
        );
      if (arch)
        label(
          [arch.label, 'RECORDING', 'REC'],
          x(arch.start),
          x(Math.min(arch.end, n)),
          'rgba(122,231,199,0.85)',
        );
    }
    // Clip range
    if (range) {
      const a = x(Math.min(range.a, range.b));
      const b = x(Math.max(range.a, range.b));
      ctx.fillStyle = 'rgba(235,199,119,0.24)';
      ctx.fillRect(a, 2, b - a, Hh - 4);
      ctx.fillStyle = '#ebc777';
      for (const px of [a, b]) {
        ctx.beginPath();
        ctx.roundRect(px - 2.5, 3, 5, Hh - 6, 2.5);
        ctx.fill();
      }
    }
    // Ticks
    const step = stepFor();
    const major =
      step *
      (step < HOUR ? (step <= 5 * MIN ? 6 : 4) : step < 24 * HOUR ? 4 : 1);
    const t0 = Math.ceil(tAt(-10) / step) * step;
    const t1 = tAt(W + 10);
    ctx.textAlign = 'center';
    let lastLabelEnd = -Infinity;
    for (let m = t0; m <= t1; m += step) {
      if (m < s - step || m > e + step) continue;
      const px = x(m);
      const isMajor = m % major === 0;
      const day = m % (24 * HOUR) === 0;
      const future = !custom && m > n;
      const len = day ? 16 : isMajor ? 11 : 5;
      ctx.strokeStyle = future
        ? 'rgba(199,180,255,0.45)'
        : isMajor
          ? 'rgba(255,255,255,0.7)'
          : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = isMajor ? 1.2 : 1;
      if (future) ctx.setLineDash([1.5, 2]);
      ctx.beginPath();
      ctx.moveTo(px, base - len / 2);
      ctx.lineTo(px, base + len / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (isMajor) {
        const d = new Date(m);
        ctx.font = `${day ? 700 : 550} 9.5px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillStyle = day
          ? 'rgba(255,255,255,0.9)'
          : 'rgba(255,255,255,0.55)';
        const label = custom
          ? custom.format(m)
          : day
            ? d
                .toLocaleDateString('en-GB', {
                  weekday: 'short',
                  timeZone: 'UTC',
                })
                .toUpperCase()
            : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        const lw = ctx.measureText(label).width;
        // Skip a label that would collide with the previous one or be
        // cut by the edge fades.
        if (
          px - lw / 2 > lastLabelEnd + 6 &&
          px - lw / 2 > 14 &&
          px + lw / 2 < W - 14
        ) {
          ctx.fillText(label, px, base - 15);
          lastLabelEnd = px + lw / 2;
        }
      }
    }
    // NOW marker
    if (!custom && x(n) > -10 && x(n) < W + 10) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x(n), base + 15, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Event pips (by altitude band, sized by severity)
    for (const p of pips) {
      const px = x(p.at);
      if (px < -8 || px > W + 8) continue;
      const r = 2.8 + (p.severity || 0) * 0.9;
      if (p === hotPip) {
        ctx.fillStyle = `${p.color || '#fff'}44`;
        ctx.beginPath();
        ctx.arc(px, base, r + 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = p.color || '#FFD166';
      ctx.beginPath();
      ctx.arc(px, base, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(5,7,11,0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // Edge fades
    const fade = (x0, x1) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), Hh);
      ctx.restore();
    };
    fade(0, 22);
    fade(W, W - 22);
    updateReadout();
  }

  function updateReadout() {
    if (custom) {
      readD.textContent = custom.format(t);
      readA.textContent = custom.label || '';
      track.setAttribute(
        'aria-valuetext',
        `${custom.format(t)} ${custom.label || ''}`,
      );
      return;
    }
    const at = new Date(live ? Date.now() : t);
    // Another UTC day: say which one, so a recording reads honestly.
    const otherDay =
      !live &&
      at.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10);
    const abs = otherDay
      ? `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()} · ${utc(at)}`
      : utc(at);
    readD.textContent = live ? 'LIVE' : fmtDelta(t - Date.now());
    readA.textContent = abs;
    el.dataset.future = String(!live && t > Date.now());
    track.setAttribute(
      'aria-valuetext',
      live ? `Live, ${abs}` : `${readD.textContent}, ${abs}`,
    );
  }

  function setLive(v) {
    live = v;
    el.classList.toggle('is-live', v);
    nowBtn.classList.toggle('is-live', v);
    nowBtn.querySelector('span:last-child').textContent = custom
      ? 'START'
      : 'NOW';
    nowBtn.setAttribute('aria-pressed', String(v));
  }

  function emit(immediate = false) {
    const fire = () => {
      emitTimer = 0;
      onTime(live && !custom ? null : new Date(t));
    };
    if (immediate) {
      clearTimeout(emitTimer);
      fire();
    } else if (!emitTimer) emitTimer = setTimeout(fire, 60);
  }

  let lastDetent = 0;
  function setCursor(ms, { fromUser = false } = {}) {
    const s = start();
    const e = end();
    let v = ms;
    if (v < s) v = s - (1 - 1 / (((s - v) / HOUR) * 0.4 + 1)) * HOUR * 0.6;
    if (v > e) v = e + (1 - 1 / (((v - e) / HOUR) * 0.4 + 1)) * HOUR * 0.6;
    t = v;
    if (fromUser) {
      // Detents: a tick as the playhead crosses a pip.
      const near = pips.find((p) => Math.abs(x(p.at) - W / 2) < 3);
      if (near && near !== hotPip) {
        const pn = performance.now();
        if (pn - lastDetent > 70) haptic('tick');
        lastDetent = pn;
      }
      hotPip = near || null;
      const isNear =
        !custom && Math.abs(t - Date.now()) < (6 / pxPerHour) * HOUR;
      setLive(isNear);
      if (playing) stopPlay();
      emit();
    }
    draw();
  }

  /* ---------- gestures ---------- */
  let drag = null;
  let press = 0;
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    track.setPointerCapture(e.pointerId);
    cancelAnimationFrame(raf);
    const r = track.getBoundingClientRect();
    const px = e.clientX - r.left;
    drag = {
      x: e.clientX,
      px,
      t0: t,
      moved: false,
      samples: [{ x: e.clientX, ts: performance.now() }],
      handle: null,
    };
    if (range) {
      const a = x(range.a);
      const b = x(range.b);
      if (Math.abs(px - a) < 16) drag.handle = 'a';
      else if (Math.abs(px - b) < 16) drag.handle = 'b';
    }
    if (clipMode && !drag.handle) {
      range = { a: tAt(px), b: tAt(px) };
      drag.handle = 'b';
    }
    clearTimeout(press);
    if (!clipMode && !drag.handle)
      press = setTimeout(() => {
        if (!drag || drag.moved) return;
        setClipMode(true);
        haptic('medium');
        range = { a: tAt(drag.px), b: tAt(drag.px) };
        drag.handle = 'b';
        draw();
      }, 420);
    el.classList.add('scrubbing');
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.handle) {
      const r = track.getBoundingClientRect();
      range[drag.handle] = tAt(e.clientX - r.left);
      showClipRow();
      draw();
      return;
    }
    drag.samples.push({ x: e.clientX, ts: performance.now() });
    if (drag.samples.length > 6) drag.samples.shift();
    setCursor(drag.t0 - (dx / pxPerHour) * HOUR, { fromUser: true });
  });
  const release = (e) => {
    clearTimeout(press);
    if (!drag) return;
    el.classList.remove('scrubbing');
    if (drag.handle) {
      drag = null;
      if (range && Math.abs(range.b - range.a) < MIN) {
        range = null;
        showClipRow();
      }
      draw();
      return;
    }
    if (!drag.moved) {
      // A tap: on a pip jumps to it; elsewhere centres that instant.
      const r = track.getBoundingClientRect();
      const px = (e?.clientX ?? drag.x) - r.left;
      drag = null;
      const pip = pipAt(px);
      if (pip) return jumpToPip(pip);
      animateTo(tAt(px), () => settleLive());
      return;
    }
    const a = drag.samples[0];
    const b = drag.samples[drag.samples.length - 1];
    const pxPerMs = b.ts > a.ts ? (b.x - a.x) / (b.ts - a.ts) : 0;
    drag = null;
    vel = (-(pxPerMs * 16.7) / pxPerHour) * HOUR;
    if (reducedMotion() || Math.abs(pxPerMs) < 0.08) return settle();
    const stepFn = () => {
      vel *= 0.94;
      setCursor(t + vel, { fromUser: true });
      if (Math.abs(vel) > (0.4 / pxPerHour) * HOUR && t > start() && t < end())
        raf = requestAnimationFrame(stepFn);
      else settle();
    };
    raf = requestAnimationFrame(stepFn);
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);

  // Trackpad: two-finger swipe scrubs, pinch (ctrl+wheel) zooms the scale.
  track.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        pxPerHour = clamp(pxPerHour * Math.exp(-e.deltaY * 0.01), 6, 3000);
        draw();
        return;
      }
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setCursor(t + (d / pxPerHour) * HOUR, { fromUser: true });
      clearTimeout(track._wt);
      track._wt = setTimeout(settle, 160);
    },
    { passive: false },
  );

  function pipAt(px) {
    let best = null;
    let bd = 12;
    for (const p of pips) {
      const d = Math.abs(x(p.at) - px);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  function showCallout(p) {
    if (!p?.label) return;
    callout.textContent = p.label;
    callout.style.setProperty('--c', p.color || '#fff');
    callout.hidden = false;
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => (callout.hidden = true), 2600);
  }

  function jumpToPip(p) {
    haptic('light');
    hotPip = p;
    showCallout(p);
    setLive(false);
    animateTo(p.at, () => {
      emit(true);
      onPip?.(p);
    });
  }

  function settleLive() {
    const isNear = !custom && Math.abs(t - Date.now()) < (6 / pxPerHour) * HOUR;
    if (isNear) {
      setLive(true);
      animateTo(Date.now(), () => emit(true));
    } else emit(true);
  }

  function settle() {
    const target = clamp(t, start(), end());
    // Detent: settle onto a pip within 10 px of the playhead.
    const near = pips
      .map((p) => ({ p, d: Math.abs(x(p.at) - x(target)) }))
      .filter((o) => o.d < 10)
      .sort((a, b) => a.d - b.d)[0];
    if (near) {
      haptic('light');
      hotPip = near.p;
      showCallout(near.p);
      return animateTo(near.p.at, () => emit(true));
    }
    if (!custom && Math.abs(target - Date.now()) < (8 / pxPerHour) * HOUR) {
      setLive(true);
      snapPulse();
      return animateTo(Date.now(), () => emit(true));
    }
    const q = custom ? 1000 : stepFor() >= HOUR ? 5 * MIN : MIN / 4;
    animateTo(Math.round(target / q) * q, () => emit(true));
  }

  function animateTo(target, done) {
    cancelAnimationFrame(raf);
    const from = t;
    const t0 = performance.now();
    const dur = reducedMotion() ? 1 : 460;
    const step = () => {
      const k = clamp((performance.now() - t0) / dur, 0, 1);
      const e = 1 - (1 - k) ** 3;
      t = from + (target - from) * e;
      draw();
      if (k < 1) raf = requestAnimationFrame(step);
      else done?.();
    };
    raf = requestAnimationFrame(step);
  }

  /** The NOW snap: a haptic tick and a pulse ring, like a detent landing. */
  function snapPulse() {
    haptic('medium');
    el.classList.remove('snap');
    void el.offsetWidth;
    el.classList.add('snap');
    clearTimeout(snapPulse.t);
    snapPulse.t = setTimeout(() => el.classList.remove('snap'), 900);
  }

  function goLive() {
    snapPulse();
    stopPlay();
    if (clipMode) setClipMode(false);
    if (custom) {
      animateTo(custom.start, () => emit(true));
      return;
    }
    setLive(true);
    animateTo(Date.now(), () => emit(true));
  }
  nowBtn.addEventListener('click', goLive);

  /* ---------- playback ---------- */
  function setPlaying(v) {
    playing = v;
    el.classList.toggle('is-playing', v);
    playBtn.innerHTML = icon(v ? 'pause' : 'play');
    playBtn.setAttribute('aria-label', v ? 'Pause' : 'Play');
  }
  function stopPlay() {
    if (!playing) return;
    playback?.stop();
    setPlaying(false);
  }
  function play(s = speed) {
    if (custom || !playback) return;
    speed = s;
    markSpeed();
    if (live) {
      // From live, replay the last hour of the recording.
      const from = Math.max(rec?.start ?? -Infinity, Date.now() - HOUR);
      t = from;
      setLive(false);
      onTime(new Date(t));
    }
    setPlaying(true);
    playback.play({ speed });
    haptic('light');
  }
  playBtn.addEventListener('click', () => (playing ? stopPlay() : play()));
  function markSpeed() {
    el.querySelectorAll('[data-speed]').forEach((b) =>
      b.setAttribute('aria-checked', String(Number(b.dataset.speed) === speed)),
    );
  }
  el.querySelector('.tm-speeds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (!b) return;
    haptic('tick');
    speed = Number(b.dataset.speed);
    markSpeed();
    if (playing) playback?.play({ speed });
  });

  /** The engine reports its clock while playing. */
  function onPlayback(st) {
    if (!st) return;
    if (st.playing !== playing) setPlaying(!!st.playing);
    if (Number.isFinite(st.t) && st.playing) {
      t = st.t;
      setLive(false);
      draw();
    } else if (
      !st.playing &&
      (st.t == null || Math.abs(st.t - Date.now()) < 3000)
    ) {
      setLive(true);
      t = Date.now();
      draw();
    }
  }

  /* ---------- clip ---------- */
  function setClipMode(v) {
    clipMode = v;
    clipBtn.setAttribute('aria-pressed', String(v));
    el.classList.toggle('is-clipping', v);
    if (!v) range = null;
    showClipRow();
    draw();
  }
  function showClipRow() {
    const ok = !!range && Math.abs(range.b - range.a) >= MIN;
    clipRow.hidden = !clipMode;
    el.querySelector('.tm-clipgo').disabled = !ok;
    clipLen.innerHTML = ok
      ? `${esc(utc(new Date(Math.min(range.a, range.b)), { seconds: false }).slice(0, 5))}–${esc(utc(new Date(Math.max(range.a, range.b)), { seconds: false }))}<br/><b>${esc(fmtDelta(Math.abs(range.b - range.a)).slice(1))}</b>`
      : 'Drag across the track to select a range';
  }
  clipBtn.addEventListener('click', () => {
    haptic('tick');
    setClipMode(!clipMode);
  });
  el.querySelector('.tm-clipcancel').addEventListener('click', () =>
    setClipMode(false),
  );
  el.querySelector('.tm-clipgo').addEventListener('click', () => {
    if (!range) return;
    const r = {
      start: Math.min(range.a, range.b),
      end: Math.max(range.a, range.b),
    };
    haptic('success');
    setClipMode(false);
    onClip?.(r);
  });

  /* ---------- keyboard ---------- */
  track.addEventListener('keydown', (e) => {
    const stepMs = custom ? 10e3 : e.shiftKey ? HOUR : 5 * MIN;
    if (e.key === 'ArrowRight') setCursor(t + stepMs, { fromUser: true });
    else if (e.key === 'ArrowLeft') setCursor(t - stepMs, { fromUser: true });
    else if (e.key === 'End') goLive();
    else if (e.key === ' ' || e.key === 'k') playing ? stopPlay() : play();
    else return;
    e.preventDefault();
  });

  // Live: keep the playhead glued to now while the planet turns.
  setInterval(() => {
    if (!custom && !drag) {
      refreshHistory();
      if (live) {
        t = Date.now();
        win = getWindow();
      }
      draw();
    }
  }, 1000);

  new ResizeObserver(resize).observe(track);
  refreshHistory();
  resize();
  setLive(true);

  return {
    el,
    /** [{ at, label, color, severity?, ev? }] */
    setPips(list) {
      pips = list.filter((p) => Number.isFinite(p.at));
      draw();
    },
    /** Timeline events from globe.timeline(), coloured by band. */
    setEvents(evts) {
      this.setPips(
        evts.map((ev) => ({
          at: ev.t,
          label: ev.title,
          color: BAND_COLOR[ev.band] || '#fff',
          severity: ev.severity || 0,
          ev,
        })),
      );
    },
    /** Use a custom window (e.g. a reconstruction's schematic clock). */
    setWindow(w) {
      stopPlay();
      custom = w
        ? {
            ...w,
            start: +w.start,
            end: +w.end,
            format: w.format || ((ms) => new Date(ms).toLocaleTimeString()),
          }
        : null;
      el.classList.toggle('custom', !!custom);
      if (custom) {
        t = custom.start;
        setLive(false);
      } else {
        win = getWindow();
        t = Date.now();
        resize.done = false;
        setLive(true);
      }
      resize();
    },
    scrubTo(ms) {
      stopPlay();
      setLive(false);
      animateTo(clamp(ms, start(), end()), () => emit(true));
    },
    seek(ms) {
      cancelAnimationFrame(raf);
      t = ms;
      draw();
    },
    /** Deterministic setup (director): jump, then play at a speed. */
    jump(ms, { play: p = false, speed: s = speed } = {}) {
      stopPlay();
      cancelAnimationFrame(raf);
      t = ms;
      setLive(false);
      onTime(new Date(t));
      draw();
      if (p) play(s);
    },
    selectRange(a, b) {
      setClipMode(true);
      range = { a, b };
      showClipRow();
      draw();
    },
    play,
    stop: stopPlay,
    onPlayback,
    goLive,
    get time() {
      return live && !custom ? null : new Date(t);
    },
    get isLive() {
      return live && !custom;
    },
    get playing() {
      return playing;
    },
    get debug() {
      return {
        t,
        pxPerHour,
        W,
        Hh,
        live,
        custom: !!custom,
        playing,
        speed,
        range,
        rec,
      };
    },
  };
}
