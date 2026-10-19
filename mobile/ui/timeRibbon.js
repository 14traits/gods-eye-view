/**
 * Time ribbon: −72 h ← NOW → +120 h with momentum drag, haptic hour detents,
 * event pips and a LIVE pill that snaps back. Fast drags move in hours,
 * slow drags in minutes. Calls `onTime(Date | null)` (null = live).
 */

import { h, clamp, haptic, reducedMotion } from './dom.js';

const HOUR = 3600e3;

export function createTimeRibbon(parent, { getWindow, onTime }) {
  const el =
    h(`<div class="ribbon glass-strong liquid" role="group" aria-label="Time">
      <button class="rb-live is-live" type="button" aria-label="Return to live"><span class="live-dot"></span><span>LIVE</span></button>
      <div class="rb-track" role="slider" tabindex="0" aria-label="Scrub time" aria-valuetext="Live">
        <canvas></canvas>
        <div class="rb-head" aria-hidden="true"></div>
      </div>
      <div class="rb-read" aria-live="off"><b class="num">Now</b><span class="num"></span></div>
    </div>`);
  parent.appendChild(el);
  const track = el.querySelector('.rb-track');
  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const liveBtn = el.querySelector('.rb-live');
  const readB = el.querySelector('.rb-read b');
  const readS = el.querySelector('.rb-read span');

  let win = getWindow();
  let custom = null; // { start, end, label, pips, format }
  let pips = [];
  let t = Date.now(); // cursor time (ms)
  let live = true;
  let pxPerHour = 7;
  let W = 0;
  let Hh = 0;
  let dpr = 1;
  let raf = 0;
  let vel = 0; // ms per frame
  let lastHour = Math.floor(t / HOUR);
  let lastTick = 0;
  let emitTimer = 0;

  const span = () => (custom ? custom.end - custom.start : win.end - win.start);
  const start = () => (custom ? custom.start : win.start.getTime());
  const end = () => (custom ? custom.end : win.end.getTime());
  const nowMs = () => (custom ? (custom.now ?? custom.start) : Date.now());

  function resize() {
    const r = track.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    Hh = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(Hh * dpr);
    // Custom windows (minutes long) scale to fit ~1.6 track widths.
    pxPerHour = custom ? (W * 1.6) / (span() / HOUR) : 7;
    draw();
  }

  function x(ms) {
    return W / 2 + ((ms - t) / HOUR) * pxPerHour;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    const s = start();
    const e = end();
    const n = nowMs();
    const mid = Hh / 2 + 4;
    // Window body
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    const xs = Math.max(0, x(s));
    const xe = Math.min(W, x(e));
    ctx.fillRect(xs, mid - 9, xe - xs, 18);
    // Forecast region
    if (!custom) {
      const xn = x(n);
      if (xn < W) {
        const g = ctx.createLinearGradient(xn, 0, Math.min(W, xe), 0);
        g.addColorStop(0, 'rgba(138,180,248,0.16)');
        g.addColorStop(1, 'rgba(138,180,248,0.03)');
        ctx.fillStyle = g;
        ctx.fillRect(
          Math.max(0, xn),
          mid - 9,
          Math.min(W, xe) - Math.max(0, xn),
          18,
        );
      }
    }
    // Ticks
    const stepMin = custom ? (span() / HOUR < 3 ? 5 : 15) : 60;
    const step = stepMin * 60e3;
    const first = Math.ceil((t - (W / 2 / pxPerHour) * HOUR) / step) * step;
    const last = t + (W / 2 / pxPerHour) * HOUR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (
      let m = Math.max(first, s - (s % step));
      m <= Math.min(last, e);
      m += step
    ) {
      const px = x(m);
      const d = new Date(m);
      const major = custom
        ? (m - s) % (stepMin * 4 * 60e3) === 0
        : d.getHours() === 0;
      const mid6 = !custom && d.getHours() % 6 === 0;
      const future = !custom && m > n;
      const len = major ? 14 : mid6 ? 9 : 5;
      ctx.strokeStyle = future
        ? 'rgba(170,200,255,0.42)'
        : major
          ? 'rgba(255,255,255,0.75)'
          : 'rgba(255,255,255,0.32)';
      ctx.lineWidth = major ? 1.3 : 1;
      if (future) ctx.setLineDash([1.5, 2]);
      ctx.beginPath();
      ctx.moveTo(px, mid - len / 2);
      ctx.lineTo(px, mid + len / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (major || (mid6 && pxPerHour > 4)) {
        ctx.font = `${major ? 650 : 500} 9.5px ui-rounded, system-ui, sans-serif`;
        ctx.fillStyle = major
          ? 'rgba(255,255,255,0.8)'
          : 'rgba(255,255,255,0.38)';
        const label = custom
          ? custom.format(m)
          : major
            ? d
                .toLocaleDateString(undefined, { weekday: 'short' })
                .toUpperCase()
            : `${String(d.getHours()).padStart(2, '0')}`;
        ctx.fillText(label, px, mid - 12);
      }
    }
    // NOW marker
    if (!custom) {
      const xn = x(n);
      if (xn > -10 && xn < W + 10) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(xn, mid + 13, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Event pips
    for (const p of pips) {
      const px = x(p.at);
      if (px < -6 || px > W + 6) continue;
      ctx.fillStyle = p.color || '#FFD166';
      ctx.beginPath();
      ctx.arc(px, mid, 3.4, 0, Math.PI * 2);
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
    fade(0, 26);
    fade(W, W - 26);
    updateReadout();
  }

  function fmtRel(ms) {
    const d = ms / 60e3;
    const sign = d < 0 ? '−' : '+';
    const a = Math.abs(d);
    if (a < 60) return `${sign}${Math.round(a)} min`;
    const hrs = Math.floor(a / 60);
    const mins = Math.round(a % 60);
    return `${sign}${hrs} h${mins ? ` ${mins}` : ''}`;
  }

  function updateReadout() {
    if (custom) {
      readB.textContent = custom.format(t);
      readS.textContent = custom.label || '';
      track.setAttribute(
        'aria-valuetext',
        `${custom.format(t)} ${custom.label || ''}`,
      );
      return;
    }
    if (live) {
      readB.textContent = 'Now';
      readS.textContent = new Date().toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else {
      readB.textContent = fmtRel(t - Date.now());
      readS.textContent = new Date(t).toLocaleString(undefined, {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    track.setAttribute(
      'aria-valuetext',
      live ? 'Live' : `${readB.textContent}, ${readS.textContent}`,
    );
  }

  function setLive(v) {
    live = v;
    el.classList.toggle('is-live', v);
    liveBtn.classList.toggle('is-live', v);
    liveBtn.querySelector('span:last-child').textContent = v
      ? 'LIVE'
      : custom
        ? 'RESET'
        : 'LIVE';
    liveBtn.setAttribute('aria-pressed', String(v));
  }

  function emit(immediate = false) {
    const fire = () => {
      emitTimer = 0;
      onTime(live && !custom ? null : new Date(t));
    };
    if (immediate) {
      clearTimeout(emitTimer);
      fire();
    } else if (!emitTimer) emitTimer = setTimeout(fire, 90);
  }

  function setCursor(ms, { fromUser = false, quant = 0 } = {}) {
    const s = start();
    const e = end();
    let v = ms;
    if (v < s) v = s - (1 - 1 / (((s - v) / HOUR) * 0.2 + 1)) * HOUR * 2;
    if (v > e) v = e + (1 - 1 / (((v - e) / HOUR) * 0.2 + 1)) * HOUR * 2;
    if (quant) v = Math.round(v / quant) * quant;
    t = v;
    const hr = Math.floor(t / HOUR);
    if (fromUser && hr !== lastHour) {
      const now = performance.now();
      if (now - lastTick > 55) {
        haptic('tick');
        lastTick = now;
      }
      lastHour = hr;
    }
    if (fromUser) {
      const near = !custom && Math.abs(t - Date.now()) < 4 * 60e3;
      setLive(near);
      emit();
    }
    draw();
  }

  /* ---------- drag with momentum ---------- */
  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    cancelAnimationFrame(raf);
    drag = {
      x: e.clientX,
      t0: t,
      samples: [{ x: e.clientX, ts: performance.now() }],
    };
    el.classList.add('scrubbing');
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    drag.samples.push({ x: e.clientX, ts: performance.now() });
    if (drag.samples.length > 6) drag.samples.shift();
    const a = drag.samples[0];
    const b = drag.samples[drag.samples.length - 1];
    const speed = b.ts > a.ts ? Math.abs((b.x - a.x) / (b.ts - a.ts)) : 0; // px/ms
    const quant = custom ? 60e3 : speed > 0.6 ? HOUR : 5 * 60e3;
    setCursor(drag.t0 - (dx / pxPerHour) * HOUR, { fromUser: true, quant });
  });
  const release = () => {
    if (!drag) return;
    el.classList.remove('scrubbing');
    const a = drag.samples[0];
    const b = drag.samples[drag.samples.length - 1];
    const pxPerMs = b.ts > a.ts ? (b.x - a.x) / (b.ts - a.ts) : 0;
    drag = null;
    vel = (-(pxPerMs * 16.7) / pxPerHour) * HOUR;
    const fast = Math.abs(pxPerMs) > 0.6;
    if (reducedMotion() || Math.abs(pxPerMs) < 0.05) return settle(fast);
    const stepFn = () => {
      vel *= 0.93;
      setCursor(t + vel, { fromUser: true });
      if (Math.abs(vel) > 60e3 && t > start() && t < end())
        raf = requestAnimationFrame(stepFn);
      else settle(fast);
    };
    raf = requestAnimationFrame(stepFn);
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);

  function settle(fast) {
    const s = start();
    const e = end();
    const target = clamp(t, s, e);
    const q = custom ? 60e3 : fast ? HOUR : 5 * 60e3;
    animateTo(Math.round(target / q) * q, () => emit(true));
  }

  function animateTo(target, done) {
    cancelAnimationFrame(raf);
    const from = t;
    const t0 = performance.now();
    const dur = reducedMotion() ? 1 : 420;
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

  function goLive() {
    haptic('tick');
    if (custom) {
      animateTo(custom.start, () => emit(true));
      return;
    }
    setLive(true);
    animateTo(Date.now(), () => emit(true));
  }
  liveBtn.addEventListener('click', goLive);

  track.addEventListener('keydown', (e) => {
    const stepMs = custom ? 60e3 : e.shiftKey ? 6 * HOUR : HOUR;
    if (e.key === 'ArrowRight') setCursor(t + stepMs, { fromUser: true });
    else if (e.key === 'ArrowLeft') setCursor(t - stepMs, { fromUser: true });
    else if (e.key === 'Home' || e.key === 'End') goLive();
    else return;
    e.preventDefault();
  });

  // Live: keep the cursor glued to now while the planet turns.
  setInterval(() => {
    if (live && !custom && !drag) {
      t = Date.now();
      win = getWindow();
      draw();
    }
  }, 15000);

  new ResizeObserver(resize).observe(track);
  resize();
  setLive(true);

  return {
    el,
    setPips(list) {
      pips = list.filter((p) => Number.isFinite(p.at));
      draw();
    },
    /** Use a custom window (e.g. a reconstruction's schematic clock). */
    setWindow(w) {
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
        setLive(true);
      }
      resize();
    },
    /** Animate to a moment and tell the globe (post anchors). */
    scrubTo(ms) {
      const lo = start();
      const hi = end();
      const target = Math.min(hi, Math.max(lo, ms));
      setLive(false);
      animateTo(target, () => emit());
    },
    /** Programmatic scrub (narrative playback). */
    seek(ms) {
      cancelAnimationFrame(raf);
      t = ms;
      draw();
    },
    goLive,
    get time() {
      return live && !custom ? null : new Date(t);
    },
    get isLive() {
      return live && !custom;
    },
    get debug() {
      return { t, pxPerHour, W, Hh, live, custom: !!custom };
    },
  };
}
