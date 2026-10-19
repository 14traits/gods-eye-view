/**
 * Offline mimic of `globe.thumbnail()` (mobile/globe/API.md): base imagery
 * for the situation's box → simple data overlays for its kind → a per-band
 * grade. No framing or telemetry: the shell draws those in HTML. Used only
 * by the stub engine so the shell can be designed without the live engine.
 */

import { esriThumb } from './dom.js';

const cache = new Map();
let running = 0;
const queue = [];

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${url}`));
    img.src = url;
  });
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => (
    (s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0),
    (s % 1e6) / 1e6
  );
}

const GRADE = {
  orbit: { tint: 'rgba(70,40,160,0.32)', mode: 'color', sat: 0.55, bri: 0.78 },
  sky: {
    tint: 'rgba(40,110,170,0.26)',
    mode: 'soft-light',
    sat: 0.7,
    bri: 0.86,
  },
  ground: {
    tint: 'rgba(255,150,40,0.20)',
    mode: 'soft-light',
    sat: 0.9,
    bri: 0.9,
  },
  inside: {
    tint: 'rgba(235,190,100,0.22)',
    mode: 'soft-light',
    sat: 0.85,
    bri: 0.9,
  },
};

function overlay(ctx, s, w, h) {
  const k = `${s.kind}`;
  const r = rng(
    [...String(s.id)].reduce((a, c) => a * 33 + c.charCodeAt(0), 5),
  );
  const cx = w / 2;
  const cy = h / 2;
  ctx.save();
  if (/cyclone/.test(k)) {
    // Spiral cloud bands + forecast cone + track.
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 4; i += 1) {
      ctx.strokeStyle = `rgba(235,240,255,${0.28 - i * 0.05})`;
      ctx.lineWidth = w * (0.07 - i * 0.012);
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 3.2; a += 0.05) {
        const rr = 6 + a * w * 0.05 + i * 9;
        const x = cx + Math.cos(a + i * 1.6) * rr;
        const y = cy + Math.sin(a + i * 1.6) * rr * 0.92;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(10,10,14,0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - w * 0.62, cy - h * 0.05 - w * 0.2);
    ctx.lineTo(cx - w * 0.62, cy - h * 0.05 + w * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 1; i < 6; i += 1) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx - i * w * 0.11, cy - i * h * 0.012, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (/quake/.test(k)) {
    for (let i = 5; i >= 1; i -= 1) {
      ctx.strokeStyle = `rgba(255,68,54,${0.18 + (5 - i) * 0.14})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(cx, cy, i * w * 0.09, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff4436';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 26; i += 1) {
      const a = r() * Math.PI * 2;
      const d = r() * w * 0.32;
      ctx.fillStyle = 'rgba(255,170,120,0.85)';
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(a) * d,
        cy + Math.sin(a) * d * 0.7,
        1.5 + r() * 2.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  } else if (/fire/.test(k)) {
    // Smoke plume east, hotspots.
    const g = ctx.createLinearGradient(cx, cy, w, cy - h * 0.15);
    g.addColorStop(0, 'rgba(200,190,180,0.55)');
    g.addColorStop(1, 'rgba(200,190,180,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.quadraticCurveTo(w * 0.8, cy - h * 0.3, w * 1.1, cy - h * 0.25);
    ctx.lineTo(w * 1.1, cy + h * 0.05);
    ctx.quadraticCurveTo(w * 0.8, cy, cx + 10, cy + 20);
    ctx.fill();
    for (let i = 0; i < 70; i += 1) {
      const x = cx + (r() - 0.6) * w * 0.4;
      const y = cy + (r() - 0.5) * h * 0.22;
      ctx.fillStyle =
        r() > 0.7 ? 'rgba(255,240,170,0.95)' : 'rgba(255,90,40,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 1 + r() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (/lightning|rain|storm/.test(k)) {
    // Radar reflectivity blobs + strikes.
    const cells = /rain/.test(k) ? 5 : 9;
    for (let i = 0; i < cells; i += 1) {
      const x = w * (0.15 + r() * 0.7);
      const y = h * (0.2 + r() * 0.6);
      const rad = w * (0.08 + r() * 0.16);
      for (const [f, c] of [
        [1, 'rgba(40,200,90,0.35)'],
        [0.66, 'rgba(240,220,40,0.45)'],
        [0.36, 'rgba(255,80,40,0.55)'],
        [0.16, 'rgba(230,60,200,0.6)'],
      ]) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(x, y, rad * f, rad * f * 0.7, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (/lightning/.test(k))
      for (let i = 0; i < 90; i += 1) {
        const x = w * (0.1 + r() * 0.8);
        const y = h * (0.15 + r() * 0.7);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillRect(x, y, 1.6, 1.6);
        ctx.strokeStyle = 'rgba(200,180,255,0.7)';
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + 3);
        ctx.stroke();
      }
  } else if (/squawk|heli|military|airport|jet/.test(k)) {
    const n = /airport/.test(k)
      ? 9
      : /jet/.test(k)
        ? 14
        : /military/.test(k)
          ? 4
          : 1;
    for (let j = 0; j < n; j += 1) {
      ctx.strokeStyle = /squawk/.test(k)
        ? 'rgba(255,68,54,0.9)'
        : 'rgba(163,216,255,0.75)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash(/squawk/.test(k) ? [] : [3, 4]);
      ctx.beginPath();
      if (/heli/.test(k)) {
        ctx.ellipse(cx, cy, w * 0.3, h * 0.18, -0.3, 0, Math.PI * 2);
      } else if (/military/.test(k)) {
        const x = w * (0.2 + r() * 0.6);
        const y = h * (0.2 + r() * 0.6);
        ctx.ellipse(x, y, w * 0.14, h * 0.05, r() * 3, 0, Math.PI * 2);
      } else if (/jet/.test(k)) {
        const y = h * (0.25 + j * 0.035);
        ctx.moveTo(0, y + 30);
        ctx.bezierCurveTo(w * 0.3, y - 20, w * 0.7, y + 10, w, y - 30);
      } else if (/airport/.test(k)) {
        const a = (j / n) * Math.PI * 2;
        ctx.moveTo(cx + Math.cos(a) * w * 0.6, cy + Math.sin(a) * h * 0.6);
        ctx.quadraticCurveTo(
          cx + Math.cos(a + 0.6) * w * 0.2,
          cy + Math.sin(a + 0.6) * h * 0.2,
          cx,
          cy,
        );
      } else {
        // Diverting track: in from the east, turning north-west, descending.
        ctx.moveTo(w * 1.05, h * 0.82);
        ctx.bezierCurveTo(w * 0.7, h * 0.78, w * 0.62, h * 0.62, cx, cy);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (/squawk/.test(k)) {
      ctx.fillStyle = '#ff4436';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 9);
      ctx.lineTo(cx + 6, cy + 7);
      ctx.lineTo(cx, cy + 3.5);
      ctx.lineTo(cx - 6, cy + 7);
      ctx.closePath();
      ctx.fill();
    }
  } else if (/iss|launch|aurora/.test(k)) {
    if (/aurora/.test(k)) {
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 3; i += 1) {
        const g = ctx.createLinearGradient(
          0,
          h * (0.2 + i * 0.08),
          0,
          h * (0.45 + i * 0.08),
        );
        g.addColorStop(0, 'rgba(60,255,150,0)');
        g.addColorStop(0.5, `rgba(60,255,150,${0.35 - i * 0.08})`);
        g.addColorStop(1, 'rgba(60,255,150,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, h * (0.32 + i * 0.07));
        ctx.bezierCurveTo(
          w * 0.3,
          h * (0.18 + i * 0.07),
          w * 0.6,
          h * (0.42 + i * 0.07),
          w,
          h * (0.26 + i * 0.07),
        );
        ctx.lineTo(w, h * (0.4 + i * 0.07));
        ctx.bezierCurveTo(
          w * 0.6,
          h * (0.56 + i * 0.07),
          w * 0.3,
          h * (0.3 + i * 0.07),
          0,
          h * (0.46 + i * 0.07),
        );
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = 'rgba(179,157,255,0.9)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      if (/launch/.test(k)) {
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(w * 0.7, h * 0.1, w * 1.05, -10);
      } else {
        ctx.moveTo(-10, h * 0.9);
        ctx.bezierCurveTo(w * 0.3, h * 0.4, w * 0.7, h * 0.3, w + 10, h * 0.1);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(
        /launch/.test(k) ? cx : w * 0.5,
        /launch/.test(k) ? cy : h * 0.38,
        3.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  } else if (/gnss/.test(k)) {
    const sz = w / 9;
    for (let y = 0; y < h; y += sz * 0.86) {
      for (let x = 0; x < w; x += sz) {
        const d = Math.hypot(x - cx, y - cy) / (w * 0.6);
        const v = Math.max(0, 1 - d) * (0.6 + r() * 0.4);
        if (v < 0.15) continue;
        ctx.fillStyle = `rgba(255,${Math.round(200 - v * 150)},60,${v * 0.55})`;
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (Math.PI / 3) * i;
          const px =
            x + ((y / (sz * 0.86)) % 2 ? sz / 2 : 0) + Math.cos(a) * sz * 0.48;
          const py = y + Math.sin(a) * sz * 0.48;
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.fill();
      }
    }
  } else if (/queue|strait|port/.test(k)) {
    for (let i = 0; i < (/strait/.test(k) ? 80 : 41); i += 1) {
      const x = w * (0.2 + r() * 0.6);
      const y = h * (0.25 + r() * 0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r() * 3);
      ctx.fillRect(-3.5, -1.2, 7, 2.4);
      ctx.restore();
    }
  } else if (/transit/.test(k)) {
    ctx.strokeStyle = 'rgba(155,225,93,0.85)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.34, h * 0.3, 0.2, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 18; i += 1) {
      const a = r() * Math.PI * 2;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(a) * w * 0.34,
        cy + Math.sin(a) * h * 0.3,
        2.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

async function compose(s, { width, height, dpr }) {
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (s.media?.url) return s.media.url;
  const span =
    s.span ?? Math.max(0.02, (s.camera?.height || 300e3) / 111e3 / 1.6);
  const base = await loadImg(
    s.thumbnail?.startsWith('/')
      ? s.thumbnail
      : esriThumb(s.lon, s.lat, span, Math.min(720, w), Math.min(960, h)),
  );
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = GRADE[s.band] || GRADE.ground;
  const sc = Math.max(w / base.naturalWidth, h / base.naturalHeight);
  ctx.filter = `saturate(${g.sat}) brightness(${g.bri}) contrast(1.08)`;
  ctx.drawImage(
    base,
    (w - base.naturalWidth * sc) / 2,
    (h - base.naturalHeight * sc) / 2,
    base.naturalWidth * sc,
    base.naturalHeight * sc,
  );
  ctx.filter = 'none';
  ctx.globalCompositeOperation = g.mode;
  ctx.fillStyle = g.tint;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.scale(dpr, dpr);
  overlay(ctx, s, width, height);
  ctx.restore();
  // Vignette.
  const v = ctx.createRadialGradient(
    w / 2,
    h / 2,
    w * 0.3,
    w / 2,
    h / 2,
    w * 0.85,
  );
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
  if (!blob) throw new Error('encode failed');
  return URL.createObjectURL(blob);
}

export function stubThumbnail(s, { width = 360, height = 480, dpr = 2 } = {}) {
  const key = `${s.id}:${width}x${height}@${dpr}`;
  if (cache.has(key)) return cache.get(key);
  const p = new Promise((resolve, reject) => {
    const run = () => {
      running += 1;
      compose(s, { width, height, dpr: Math.min(2, dpr) })
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          queue.shift()?.();
        });
    };
    if (running < 3) run();
    else queue.push(run);
  });
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}
