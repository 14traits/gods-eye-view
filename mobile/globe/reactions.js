/**
 * Geolocated reactions (DESIGN.md §12.6): hearts, fire, eyes and wow rise
 * from the reactor's place on the globe. A screen-space canvas over the
 * viewer (pointer-events: none) draws pre-rendered emoji sprites; each
 * particle is re-projected every frame so the burst stays anchored to its
 * point while the globe moves. The loop runs only while particles live.
 *
 * attentionHeat(points) draws a soft additive glow where viewers are; it is
 * redrawn after every globe render, so it costs nothing at rest.
 */
const KINDS = { heart: '❤️', fire: '🔥', eyes: '👀', wow: '😮' };
const CAP = 300;
const LIFE_S = 2.6;

export function createReactions({ host, project, onFrame }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'gev-reactions';
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  host.appendChild(canvas);
  const g = canvas.getContext('2d');
  const sprites = new Map();
  const parts = [];
  let heat = null;
  let raf = 0;
  let dpr = 1;

  function sprite(kind) {
    let s = sprites.get(kind);
    if (s) return s;
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `${size * 0.78}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    x.shadowColor = 'rgba(0,0,0,0.45)';
    x.shadowBlur = 6;
    x.fillText(KINDS[kind] || KINDS.heart, size / 2, size / 2 + 3);
    s = c;
    sprites.set(kind, s);
    return s;
  }

  function resize() {
    dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.round(host.clientWidth * dpr);
    const h = Math.round(host.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function drawHeat() {
    if (!heat?.length) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const p of heat) {
      const s = project(p.lon, p.lat, 0);
      if (!s) continue;
      const r = (26 + 40 * Math.sqrt(p.weight ?? 1)) * dpr;
      const grad = g.createRadialGradient(
        s.x * dpr,
        s.y * dpr,
        0,
        s.x * dpr,
        s.y * dpr,
        r,
      );
      grad.addColorStop(0, 'rgba(255,120,150,0.30)');
      grad.addColorStop(0.45, 'rgba(255,90,140,0.12)');
      grad.addColorStop(1, 'rgba(255,90,140,0)');
      g.fillStyle = grad;
      g.fillRect(s.x * dpr - r, s.y * dpr - r, r * 2, r * 2);
    }
    g.restore();
  }

  function draw(now) {
    resize();
    g.clearRect(0, 0, canvas.width, canvas.height);
    drawHeat();
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const age = (now - p.born) / 1000;
      if (age > LIFE_S) {
        parts.splice(i, 1);
        continue;
      }
      if (age < 0) continue;
      const s = project(p.lon, p.lat, p.altM);
      if (!s) continue;
      const f = age / LIFE_S;
      const rise = p.rise * (1 - (1 - f) ** 2.2);
      const x = s.x + p.dx * f + Math.sin(age * p.wobble + p.phase) * 9;
      const y = s.y - rise;
      const size = p.size * (age < 0.18 ? age / 0.18 : 1) * (1 - 0.25 * f);
      g.globalAlpha = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
      g.drawImage(
        sprite(p.kind),
        (x - size / 2) * dpr,
        (y - size / 2) * dpr,
        size * dpr,
        size * dpr,
      );
    }
    g.globalAlpha = 1;
  }

  function loop(now) {
    draw(now);
    raf = parts.length ? requestAnimationFrame(loop) : 0;
    if (!parts.length) onFrame?.();
  }

  return {
    react({ lon, lat, kind = 'heart', count = 1, altM = 0 } = {}) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 0;
      const k = KINDS[kind] ? kind : 'heart';
      const n = Math.max(1, Math.min(40, Math.round(count)));
      const now = performance.now();
      for (let i = 0; i < n; i++) {
        if (parts.length >= CAP) parts.shift();
        parts.push({
          lon,
          lat,
          altM,
          kind: k,
          born: now + i * (90 + Math.random() * 70),
          rise: 120 + Math.random() * 110,
          dx: (Math.random() - 0.5) * 70,
          wobble: 2 + Math.random() * 3,
          phase: Math.random() * 6.28,
          size: 22 + Math.random() * 16,
        });
      }
      if (!raf) raf = requestAnimationFrame(loop);
      return n;
    },
    heat(points) {
      heat = Array.isArray(points)
        ? points.filter(
            (p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat),
          )
        : null;
      if (!raf) {
        resize();
        g.clearRect(0, 0, canvas.width, canvas.height);
        drawHeat();
      }
    },
    /** Redraw the heat after a globe render (camera moved). */
    afterRender() {
      if (raf || !heat?.length) return;
      resize();
      g.clearRect(0, 0, canvas.width, canvas.height);
      drawHeat();
    },
    get count() {
      return parts.length;
    },
    destroy() {
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
