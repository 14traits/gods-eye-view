/**
 * Small canvas glyphs for billboards. Drawn once in white at 2x, tinted per
 * layer through `billboard.color`, and shared through a fixed `imageId` so the
 * texture atlas holds each glyph exactly once however many billboards use it.
 */

const SIZE = 48; // drawn at 2x, displayed at scale 0.5 → 24 css px
const cache = new Map();

function canvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function stroke(ctx, width = 3) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fill();
}

const painters = {
  dot(ctx, s) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  },
  plane(ctx) {
    ctx.beginPath();
    ctx.moveTo(24, 3);
    ctx.lineTo(27.5, 9);
    ctx.lineTo(27.5, 19);
    ctx.lineTo(44, 29);
    ctx.lineTo(44, 33);
    ctx.lineTo(27.5, 28);
    ctx.lineTo(27, 38);
    ctx.lineTo(33, 43);
    ctx.lineTo(33, 45.5);
    ctx.lineTo(24, 43);
    ctx.lineTo(15, 45.5);
    ctx.lineTo(15, 43);
    ctx.lineTo(21, 38);
    ctx.lineTo(20.5, 28);
    ctx.lineTo(4, 33);
    ctx.lineTo(4, 29);
    ctx.lineTo(20.5, 19);
    ctx.lineTo(20.5, 9);
    ctx.closePath();
    stroke(ctx);
  },
  heli(ctx) {
    ctx.beginPath();
    ctx.ellipse(24, 22, 6.5, 9, 0, 0, Math.PI * 2);
    ctx.rect(22.5, 28, 3, 15);
    ctx.rect(18, 41, 12, 3);
    stroke(ctx);
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#fff';
    ctx.moveTo(7, 7);
    ctx.lineTo(41, 37);
    ctx.moveTo(41, 7);
    ctx.lineTo(7, 37);
    ctx.stroke();
  },
  ship(ctx) {
    ctx.beginPath();
    ctx.moveTo(24, 4);
    ctx.quadraticCurveTo(34, 16, 32, 42);
    ctx.lineTo(16, 42);
    ctx.quadraticCurveTo(14, 16, 24, 4);
    ctx.closePath();
    stroke(ctx);
  },
  sat(ctx) {
    ctx.beginPath();
    ctx.rect(19, 18, 10, 12);
    ctx.rect(3, 20, 14, 8);
    ctx.rect(31, 20, 14, 8);
    stroke(ctx, 2.5);
  },
  iss(ctx) {
    ctx.beginPath();
    ctx.rect(21, 14, 6, 20);
    ctx.rect(3, 8, 6, 14);
    ctx.rect(11, 8, 6, 14);
    ctx.rect(31, 8, 6, 14);
    ctx.rect(39, 8, 6, 14);
    ctx.rect(3, 26, 6, 14);
    ctx.rect(11, 26, 6, 14);
    ctx.rect(31, 26, 6, 14);
    ctx.rect(39, 26, 6, 14);
    ctx.rect(9, 22.5, 30, 3);
    stroke(ctx, 2);
  },
  ring(ctx, s) {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 3;
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(
        s / 2 + Math.cos(a) * (s / 2 - 1),
        s / 2 + Math.sin(a) * (s / 2 - 1),
      );
      ctx.lineTo(
        s / 2 + Math.cos(a) * (s / 2 - 12),
        s / 2 + Math.sin(a) * (s / 2 - 12),
      );
      ctx.stroke();
    }
  },
  quake(ctx, s) {
    for (const [r, a] of [
      [20, 0.45],
      [13, 0.8],
    ]) {
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  fire(ctx) {
    ctx.beginPath();
    ctx.moveTo(24, 4);
    ctx.bezierCurveTo(34, 16, 40, 24, 36, 34);
    ctx.bezierCurveTo(33, 43, 15, 43, 12, 34);
    ctx.bezierCurveTo(9, 26, 16, 22, 18, 14);
    ctx.bezierCurveTo(21, 20, 24, 20, 24, 4);
    ctx.closePath();
    stroke(ctx);
  },
  cyclone(ctx, s) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const a = k * Math.PI + t * Math.PI * 1.25;
        const r = 4 + t * 17;
        const x = s / 2 + Math.cos(a) * r;
        const y = s / 2 + Math.sin(a) * r;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  },
  rocket(ctx) {
    ctx.beginPath();
    ctx.moveTo(24, 3);
    ctx.bezierCurveTo(31, 10, 31, 22, 30, 32);
    ctx.lineTo(36, 40);
    ctx.lineTo(29, 39);
    ctx.lineTo(27, 44);
    ctx.lineTo(21, 44);
    ctx.lineTo(19, 39);
    ctx.lineTo(12, 40);
    ctx.lineTo(18, 32);
    ctx.bezierCurveTo(17, 22, 17, 10, 24, 3);
    ctx.closePath();
    stroke(ctx);
  },
  camera(ctx) {
    ctx.beginPath();
    ctx.roundRect(7, 15, 26, 18, 4);
    ctx.moveTo(33, 20);
    ctx.lineTo(42, 15);
    ctx.lineTo(42, 33);
    ctx.lineTo(33, 28);
    ctx.closePath();
    stroke(ctx);
  },
  volcano(ctx) {
    ctx.beginPath();
    ctx.moveTo(4, 42);
    ctx.lineTo(18, 16);
    ctx.lineTo(30, 16);
    ctx.lineTo(44, 42);
    ctx.closePath();
    stroke(ctx);
    ctx.beginPath();
    ctx.arc(24, 9, 5, 0, Math.PI * 2);
    ctx.fill();
  },
  pin(ctx) {
    ctx.beginPath();
    ctx.arc(24, 18, 12, Math.PI, 0);
    ctx.bezierCurveTo(36, 28, 28, 34, 24, 45);
    ctx.bezierCurveTo(20, 34, 12, 28, 12, 18);
    ctx.closePath();
    stroke(ctx);
    ctx.beginPath();
    ctx.arc(24, 18, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();
  },
  port(ctx) {
    ctx.beginPath();
    ctx.arc(24, 10, 5, 0, Math.PI * 2);
    ctx.moveTo(24, 15);
    ctx.lineTo(24, 42);
    ctx.moveTo(14, 22);
    ctx.lineTo(34, 22);
    ctx.moveTo(8, 30);
    ctx.quadraticCurveTo(10, 42, 24, 42);
    ctx.quadraticCurveTo(38, 42, 40, 30);
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  },
  bolt(ctx) {
    ctx.beginPath();
    ctx.moveTo(28, 3);
    ctx.lineTo(12, 27);
    ctx.lineTo(23, 27);
    ctx.lineTo(19, 45);
    ctx.lineTo(37, 18);
    ctx.lineTo(26, 18);
    ctx.closePath();
    stroke(ctx, 3);
  },
  aq(ctx, s) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 9, 0, Math.PI * 2);
    stroke(ctx, 3);
  },
  bus(ctx) {
    ctx.beginPath();
    ctx.moveTo(24, 4);
    ctx.lineTo(33, 14);
    ctx.lineTo(33, 42);
    ctx.lineTo(15, 42);
    ctx.lineTo(15, 14);
    ctx.closePath();
    stroke(ctx, 3);
  },
  post(ctx) {
    ctx.beginPath();
    ctx.moveTo(8, 10);
    ctx.lineTo(40, 10);
    ctx.lineTo(40, 32);
    ctx.lineTo(22, 32);
    ctx.lineTo(13, 41);
    ctx.lineTo(14, 32);
    ctx.lineTo(8, 32);
    ctx.closePath();
    stroke(ctx, 3);
  },
  witness(ctx) {
    // a seal: a rosette with a check
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = i % 2 ? 17 : 21;
      ctx.lineTo(24 + r * Math.cos(a), 24 + r * Math.sin(a));
    }
    ctx.closePath();
    stroke(ctx, 3);
    ctx.beginPath();
    ctx.moveTo(16, 24);
    ctx.lineTo(22, 30);
    ctx.lineTo(33, 18);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.stroke();
  },
  eye(ctx) {
    ctx.beginPath();
    ctx.moveTo(4, 24);
    ctx.quadraticCurveTo(24, 4, 44, 24);
    ctx.quadraticCurveTo(24, 44, 4, 24);
    ctx.closePath();
    stroke(ctx, 3);
    ctx.beginPath();
    ctx.arc(24, 24, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fill();
  },
  live(ctx) {
    ctx.beginPath();
    ctx.arc(24, 24, 9, 0, Math.PI * 2);
    stroke(ctx, 3);
    for (const r of [15, 21]) {
      ctx.beginPath();
      ctx.arc(24, 24, r, -0.7, 0.7);
      ctx.moveTo(24 - r * Math.cos(0.7), 24 - r * Math.sin(0.7));
      ctx.arc(24, 24, r, Math.PI - 0.7, Math.PI + 0.7);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  },
  hologram(ctx) {
    ctx.beginPath();
    ctx.moveTo(24, 3);
    ctx.lineTo(42, 14);
    ctx.lineTo(42, 34);
    ctx.lineTo(24, 45);
    ctx.lineTo(6, 34);
    ctx.lineTo(6, 14);
    ctx.closePath();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, 14);
    ctx.lineTo(24, 25);
    ctx.lineTo(42, 14);
    ctx.moveTo(24, 25);
    ctx.lineTo(24, 45);
    ctx.stroke();
  },
};

/** `{ image, imageId }` for a named glyph. */
export function glyph(name) {
  let entry = cache.get(name);
  if (entry) return entry;
  const paint = painters[name] || painters.dot;
  const size = name === 'dot' ? 32 : SIZE;
  const c = canvas(size);
  paint(c.getContext('2d'), size);
  entry = { image: c, imageId: `gev-mobile-glyph-${name}` };
  cache.set(name, entry);
  return entry;
}
