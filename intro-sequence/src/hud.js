import { T, FEEDS, CAPTURE_SLOW, DURATION, clamp, lerp, ramp, smooth, win, easeInOut, easeOut, easeIn, expoOut, count, hash1, mulberry32 } from './timeline.js';
import { angDist, fmtLat, fmtLon, llToVec, EARTH_KM, D2R } from './geo.js';

// Everything typographic and 2D: boot console, the dish, captures, the feed
// stack, the camera wall, the title. Drawn to a canvas that the post chain
// composites into the HDR frame so it blooms with the scene.

const CY = '#00f6ff';
const WH = '#eafcff';
const DIM = 'rgba(150,215,230,0.62)';
const FAINT = 'rgba(120,200,220,0.28)';
const AMB = '#ffb547';
const RED = '#ff3b3b';
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>';

const EYE_PATH =
  'M567.5,623c-163.183,0-303.026-99.084-361.823-239.922C257.508,238.76,401.037,135,570,135c166.451,0,308.222,100.7,361.954,241.667C874.771,520.905,733.152,623,567.5,623Z';
const EYE_INNER_RING = 'M567,156c124.816,0,226,101.184,226,226S691.816,608,567,608,341,506.816,341,382,442.184,156,567,156Z';
const EYE_WINGS =
  'M816,256.213A272.836,272.836,0,0,1,846,381M793.574,488.677a249.545,249.545,0,0,0,3.239-208.3A303.384,303.384,0,0,0,816,256.213a274.468,274.468,0,0,1-1.516,252.475q-0.927,1.758-1.88,3.5-1.632-2.238-3.306-4.446Q801.826,497.884,793.574,488.677ZM345.5,490.85q-8.055,9.164-15.37,18.966a274.353,274.353,0,0,1-3.748-250.343q7.347,10.012,15.469,19.393A249.512,249.512,0,0,0,345.5,490.85Z';
const EYE_CAGE =
  'M578.4,368.9h76.237a314.2,314.2,0,0,0-11.945-78.026H578.4V368.9ZM654.634,387.1H578.4V464.94h64.345A314.251,314.251,0,0,0,654.634,387.1Zm90.813,0H671.861a333.4,333.4,0,0,1-11.206,77.836h63.112A182.117,182.117,0,0,0,745.447,387.1Zm-32.528,95.444H655.363a288.421,288.421,0,0,1-32.3,67.191A177.214,177.214,0,0,0,712.919,482.548Zm-115.67,73.48a263.416,263.416,0,0,0,39.828-73.48H578.4v75.476A173.846,173.846,0,0,0,597.249,556.028ZM560.6,558.036V482.548H497.674a263.837,263.837,0,0,0,39.135,72.575A174.279,174.279,0,0,0,560.6,558.036ZM510.434,547.83a289.038,289.038,0,0,1-31.078-65.282H426.1A177.5,177.5,0,0,0,510.434,547.83Zm-95.208-82.89H474.1A333.353,333.353,0,0,1,462.878,387.1H393.555A182.127,182.127,0,0,0,415.226,464.94ZM393.555,368.9h69.323a333.4,333.4,0,0,1,11.268-78.026H415.332A182.13,182.13,0,0,0,393.555,368.9Zm32.676-95.633h53.185a289.064,289.064,0,0,1,31-65.087A177.487,177.487,0,0,0,426.231,273.263Zm134.372-75.3a174.068,174.068,0,0,0-23.8,2.914,263.8,263.8,0,0,0-39.06,72.384H560.6v-75.3Zm0,92.905H492.051A314.088,314.088,0,0,0,480.106,368.9h80.5V290.87Zm-80.5,96.234A314.1,314.1,0,0,0,492,464.94h68.6V387.1h-80.5ZM578.4,197.977v75.286h58.612a263.412,263.412,0,0,0-39.751-73.289A174.011,174.011,0,0,0,578.4,197.977Zm44.672,8.286a288.6,288.6,0,0,1,32.231,67h57.491A177.213,177.213,0,0,0,623.069,206.263Zm100.6,84.607H660.6A333.3,333.3,0,0,1,671.861,368.9h73.586A182.129,182.129,0,0,0,723.667,290.87Z';
const EYE_C = { x: 568.5, y: 379, w: 727, h: 488, iris: 195 };

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pad = (n, k) => String(n).padStart(k, '0');

export function createHUD(opts) {
  const { W, H, PORTRAIT, heroes, cams, counts, rapidList, pick, capT, snapT, sunLL, flurry = [], nycCams = [] } = opts;
  const u = Math.min(W, H) / 1080;
  const M = Math.round((PORTRAIT ? 52 : 58) * u);
  const canvas = document.createElement('canvas');
  // main.js hands this canvas to post; we draw into the one it created
  let ctx = null;

  const mono = (s, w = 400) => `${w} ${Math.round(s * u)}px "JetBrains Mono"`;
  const sans = (s, w = 300) => `${w} ${Math.round(s * u)}px Inter`;

  // ---------------------------------------------------------- eye layout
  const eyeW = PORTRAIT ? W * 0.8 : W * 0.37;
  const es = eyeW / EYE_C.w;
  const eyeLayout = { cx: W / 2, cy: PORTRAIT ? H * 0.4 : H * 0.42, s: es, irisR: EYE_C.iris * es * 0.985 };
  const eyePaths = { outer: new Path2D(EYE_PATH), ring: new Path2D(EYE_INNER_RING), wings: new Path2D(EYE_WINGS), cage: new Path2D(EYE_CAGE) };

  // ---------------------------------------------------------- precompute
  // feature-extraction overlay for the full-frame capture (real Sobel on Esri pixels)
  const fullHero = heroes.find((h) => h.slug === 'manhattan') || heroes[0];
  let edgeCanvas = null;
  let edgeCount = 0;
  if (fullHero) {
    const im = fullHero.close;
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const src = x.getImageData(0, 0, c.width, c.height);
    const out = x.createImageData(c.width, c.height);
    const w = c.width;
    const L = new Float32Array(w * c.height);
    for (let i = 0; i < L.length; i++) L[i] = src.data[i * 4] * 0.3 + src.data[i * 4 + 1] * 0.59 + src.data[i * 4 + 2] * 0.11;
    for (let y = 1; y < c.height - 1; y++)
      for (let xx = 1; xx < w - 1; xx++) {
        const i = y * w + xx;
        const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
        const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
        const g = Math.min(255, Math.hypot(gx, gy) * 0.9);
        if (g > 90) edgeCount++;
        const a = g > 40 ? g : 0;
        out.data[i * 4] = 40;
        out.data[i * 4 + 1] = 240;
        out.data[i * 4 + 2] = 255;
        out.data[i * 4 + 3] = a;
      }
    x.putImageData(out, 0, 0);
    edgeCanvas = c;
  }

  // graded CCTV stills: slight desaturation, crushed blacks, scanlines baked in
  const camTiles = cams.concat(nycCams).map((c) => {
    const cw = 320;
    const ch = 180;
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const x = cv.getContext('2d');
    x.filter = 'saturate(0.55) contrast(1.15) brightness(0.86)';
    const im = c.img;
    const s = Math.max(cw / im.width, ch / im.height);
    x.drawImage(im, (cw - im.width * s) / 2, (ch - im.height * s) / 2, im.width * s, im.height * s);
    x.filter = 'none';
    x.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < ch; y += 3) x.fillRect(0, y, cw, 1);
    return { ...c, tile: cv };
  });

  // detection totals across every still we hold (YOLOv8n, run once offline)
  const detTotals = { all: 0, person: 0, vehicle: 0 };
  for (const c of cams.concat(nycCams))
    for (const b of c.det || []) {
      detTotals.all++;
      if (b[5] === 'person') detTotals.person++;
      if (['car', 'truck', 'bus', 'motorcycle'].includes(b[5])) detTotals.vehicle++;
    }

  // ---------------------------------------------------------- primitives
  function text(s, x, y, { font = mono(14), color = WH, align = 'left', alpha = 1, spacing = 0, baseline = 'alphabetic' } = {}) {
    if (alpha <= 0.002 || !s) return 0;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = font;
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(s, x, y);
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  }
  function measure(s, font, spacing = 0) {
    ctx.save();
    ctx.font = font;
    ctx.letterSpacing = `${spacing}px`;
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  }
  // characters resolve out of noise, left to right
  function scramble(s, t, start, dur = 0.6, seed = 1) {
    if (t < start) return '';
    const k = (t - start) / dur;
    if (k >= 1) return s;
    const n = s.length;
    const fr = Math.floor(t * 30);
    let out = '';
    for (let i = 0; i < n; i++) {
      const ch = s[i];
      const reveal = i / n;
      if (k > reveal + 0.25 || ch === ' ') out += ch;
      else if (k > reveal - 0.1) out += GLYPHS[Math.floor(hash1(i * 13.1 + fr * 7.7 + seed) * GLYPHS.length)];
      else out += '';
    }
    return out;
  }
  function typed(s, t, start, cps = 40) {
    if (t < start) return '';
    return s.slice(0, Math.floor((t - start) * cps));
  }
  function line(x1, y1, x2, y2, color = CY, alpha = 1, w = 1) {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = w * u;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
  function brackets(x, y, w, h, len, color = CY, alpha = 1, lw = 1.2) {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw * u;
    ctx.beginPath();
    const l = Math.min(len, w / 2, h / 2);
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x + w, y + h - l); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - l, y + h);
    ctx.moveTo(x + l, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - l);
    ctx.stroke();
    ctx.restore();
  }
  function glowDot(x, y, r, color = '200,250,255', alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,1)`);
    g.addColorStop(0.15, `rgba(${color},0.9)`);
    g.addColorStop(0.4, `rgba(${color},0.25)`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // white-box "Samaritan" label: black text knocked out of a bright plate
  function plate(s, x, y, { font = mono(14, 500), padX = 10, padY = 7, align = 'left', alpha = 1, spacing = 1, inverse = true } = {}) {
    if (alpha <= 0.002) return;
    const w = measure(s, font, spacing * u);
    const fs = parseFloat(font.split(' ')[1]);
    const bx = align === 'center' ? x - w / 2 - padX * u : align === 'right' ? x - w - padX * u * 2 : x;
    const bw = w + padX * u * 2;
    const bh = fs + padY * u * 2;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = inverse ? '#bfe9f0' : 'rgba(0,0,0,0.78)';
    ctx.fillRect(bx, y - bh / 2, bw, bh);
    ctx.restore();
    text(s, bx + padX * u, y + fs * 0.36, { font, color: inverse ? '#000' : WH, alpha, spacing: spacing * u });
    return bw;
  }
  function drawCover(im, x, y, w, h, scale = 1, cx = 0.5, cy = 0.5) {
    const s = Math.max(w / im.width, h / im.height) * scale;
    const dw = im.width * s;
    const dh = im.height * s;
    ctx.drawImage(im, x + (w - dw) * cx, y + (h - dh) * cy, dw, dh);
  }

  // ---------------------------------------------------------- tile ids (mirrors the globe shader)
  function hash3(x, y, z) {
    const f = (v) => v - Math.floor(v);
    let px = f(x * 0.3183099 + 0.71) * 17;
    let py = f(y * 0.3183099 + 0.113) * 17;
    let pz = f(z * 0.3183099 + 0.419) * 17;
    return f(px * py * pz * (px + py + pz));
  }
  const tileList = [];
  for (const [z, wave, jit] of [[3, T.zWave[0], 0.35], [4, T.zWave[1], 0.3]]) {
    const n = 2 ** z;
    for (let x = 0; x < n; x++)
      for (let y = 0; y < n; y++) {
        const lon = ((x + 0.5) / n) * 360 - 180;
        const my = (y + 0.5) / n;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
        const d = angDist(0, 0, lon, lat);
        const tRev = wave + (d / Math.PI) * 2.6 + hash3(x, y, z) * jit;
        tileList.push({ z, x, y, lon, lat, tRev });
      }
  }

  // ---------------------------------------------------------- layout
  const sheet = (() => {
    const n = Math.max(1, heroes.length);
    const cols = PORTRAIT ? 6 : 4;
    const rows = Math.ceil(n / cols);
    const gap = 6 * u;
    const sw = PORTRAIT ? W - 2 * M : W * 0.215;
    const tw = (sw - gap * (cols - 1)) / cols;
    const th = tw * (2 / 3);
    const sh = rows * th + (rows - 1) * gap;
    const x0 = PORTRAIT ? M : W - M - sw;
    const y0 = PORTRAIT ? H - M - 70 * u - sh : H * 0.2;
    const slots = [];
    for (let i = 0; i < n; i++) slots.push({ x: x0 + (i % cols) * (tw + gap), y: y0 + Math.floor(i / cols) * (th + gap), w: tw, h: th });
    return { x0, y0, sw, sh, slots, tw, th };
  })();
  const bigCard = PORTRAIT
    ? { x: M, y: H * 0.17, w: W - 2 * M, h: (W - 2 * M) * (2 / 3) }
    : { x: M, y: H * 0.4, w: W * 0.255, h: W * 0.255 * (2 / 3) };

  const stack = PORTRAIT
    ? { x: M, y: H * 0.665, w: W - 2 * M, row: 38 * u }
    : { x: M, y: H * 0.27, w: 500 * u, row: 40 * u };

  // camera wall grid
  const wall = (() => {
    const cols = PORTRAIT ? 5 : 10;
    const rows = PORTRAIT ? 16 : 10;
    const cw = W / cols;
    const ch = H / rows;
    const cells = [];
    const r = mulberry32(1234);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const cx = (i + 0.5) * cw;
        const cy = (j + 0.5) * ch;
        const d = Math.hypot((cx - W / 2) / W, (cy - H / 2) / H);
        cells.push({ x: i * cw, y: j * ch, w: cw, h: ch, d, cam: 0, r: r(), r2: r() });
      }
    // assign cameras: unique as far as they go, nearest-to-centre first
    const order = cells.slice().sort((a, b) => a.d - b.d);
    order.forEach((c, k) => (c.cam = cams.length ? k % cams.length : 0));
    const maxD = Math.max(...cells.map((c) => c.d));
    return { cells, maxD, cw, ch };
  })();

  // ---------------------------------------------------------- scene pieces
  function chromeAlpha(t) {
    return smooth(t, T.substrate, T.substrate + 1.2) * (1 - smooth(t, T.cut - 0.1, T.cut));
  }

  function stateName(t) {
    if (t < T.indexStart) return 'SUBSTRATE LOCK';
    if (t < T.indexed) return 'INDEXING';
    if (t < T.saturate) return 'INGESTING';
    if (t < T.omni) return 'SATURATING';
    return 'OMNIPRESENT';
  }

  function drawChrome(S) {
    const t = S.t;
    const a = chromeAlpha(t) * (1 - 0.85 * win(t, T.cctvWall, T.cctvOut + 0.2, 0.15, 0.2));
    if (a <= 0) return;
    const L = 26 * u;
    brackets(M * 0.55, M * 0.55, W - M * 1.1, H - M * 1.1, L, CY, a * 0.7, 1.4);
    // edge rulers
    ctx.save();
    ctx.globalAlpha = a * 0.35;
    ctx.strokeStyle = CY;
    ctx.lineWidth = 1;
    const n = PORTRAIT ? 40 : 24;
    for (let i = 1; i < n; i++) {
      const y = M * 1.4 + ((H - M * 2.8) * i) / n;
      const len = i % 4 === 0 ? 10 * u : 5 * u;
      ctx.beginPath();
      ctx.moveTo(M * 0.55, y);
      ctx.lineTo(M * 0.55 + len, y);
      ctx.moveTo(W - M * 0.55, y);
      ctx.lineTo(W - M * 0.55 - len, y);
      ctx.stroke();
    }
    ctx.restore();

    const top = M + 18 * u;
    text('GEV // OBSERVER-1', M + 6 * u, top, { font: mono(13, 500), color: CY, alpha: a, spacing: 2 * u });
    const st = stateName(t);
    text('STATE ▸ ' + scramble(st, t, stateChangeTime(t), 0.5, 3), M + 6 * u, top + 22 * u, { font: mono(13), color: WH, alpha: a, spacing: 1.5 * u });

    const now = new Date(snapT.getTime() + t * 1000);
    const iso = now.toISOString().replace('T', ' ').replace('Z', ' UTC');
    text(iso, W - M - 6 * u, top, { font: mono(13), color: WH, alpha: a, align: 'right', spacing: 1 * u });
    const tt = `T+00:00:${pad(Math.floor(t), 2)}.${pad(Math.floor((t % 1) * 100), 2)}`;
    text(tt, W - M - 6 * u, top + 22 * u, { font: mono(13), color: DIM, alpha: a, align: 'right', spacing: 1 * u });

    const bot = H - M - 8 * u;
    const alt = (S.cam.dist - 1) * EARTH_KM;
    text(`CAM ${fmtLat(S.cam.lat, 4)} ${fmtLon(((S.cam.lon + 540) % 360) - 180, 4)} · ALT ${fmt(alt)} KM`, M + 6 * u, bot, { font: mono(12), color: DIM, alpha: a, spacing: 1 * u });
    text(`SUN ${fmtLat(sunLL[1], 1)} ${fmtLon(sunLL[0], 1)} · SUBSOLAR`, M + 6 * u, bot - 20 * u, { font: mono(12), color: FAINT, alpha: a, spacing: 1 * u });

    const feedsOn = FEEDS.filter((f) => t >= f.t).length + (t >= T.rapid ? rapidList.length : 0);
    const total = FEEDS.length + rapidList.length;
    let sig = 0;
    for (const f of FEEDS) if (t >= f.t) sig += count(t, f.t, f.t + 1.4, 0, counts[f.key] || 0);
    if (t >= T.rapid) for (const [, v] of rapidList) sig += v;
    text(`FEEDS ${pad(feedsOn, 2)}/${pad(total, 2)} · SIGNALS ${fmt(sig)}`, W - M - 6 * u, bot, { font: mono(12), color: DIM, alpha: a, align: 'right', spacing: 1 * u });
  }
  function stateChangeTime(t) {
    const ts = [T.substrate, T.indexStart, T.indexed, T.saturate, T.omni];
    let last = ts[0];
    for (const x of ts) if (t >= x) last = x;
    return last;
  }

  // ---------------------------------------------------------- ACT 0
  function drawBoot(S) {
    const t = S.t;
    if (t > T.seed + 0.1) return;
    const lines = [
      ['GEV://OBSERVER-1', '  rev 0.2.1', T.boot],
      ['allocating substrate ', '........ 1.0000  OK', T.boot + 0.75],
      ['loading priors ', '.............. NONE', T.boot + 1.35],
      ['> seed --origin ', '0.0000°N 0.0000°E', T.boot + 2.1],
    ];
    const font = mono(17);
    const lh = 30 * u;
    const bw = measure('allocating substrate ........ 1.0000  OK', font, 0.5 * u);
    const x0 = W / 2 - bw / 2;
    const y0 = H / 2 - lh * 1.5;
    const k = ramp(t, T.collapse, T.seed);
    ctx.save();
    // collapse: the whole console implodes into the seed
    const sx = 1 - easeIn(k);
    const sy = Math.max(0.002, 1 - easeOut(Math.min(1, k * 1.6)));
    ctx.translate(W / 2, H / 2);
    ctx.scale(Math.max(0.001, sx), sy);
    ctx.translate(-W / 2, -H / 2);
    const bright = 1 + k * 2;
    lines.forEach(([a, b, st], i) => {
      const full = a + b;
      const cps = i === 3 ? 26 : 55;
      const s = typed(full, t, st, cps);
      const y = y0 + i * lh;
      const ca = i === 0 ? CY : i === 3 ? WH : DIM;
      text(s, x0, y, { font, color: ca, spacing: 0.5 * u, alpha: Math.min(1, bright) });
      // ok tokens light up
      if (i === 1 && s.length === full.length) text('OK', x0 + measure(full.slice(0, -2), font, 0.5 * u), y, { font, color: CY, spacing: 0.5 * u });
    });
    // cursor
    let cy = y0;
    let cx = x0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const [a, b, st] = lines[i];
      if (t >= st) {
        const cps = i === 3 ? 26 : 55;
        const s = typed(a + b, t, st, cps);
        cy = y0 + i * lh;
        cx = x0 + measure(s, font, 0.5 * u) + 3 * u;
        break;
      }
    }
    const blink = Math.floor(t * 2.2) % 2 === 0 || (t > T.boot && t < T.boot + 3.2);
    if (t > T.cursor && blink && k < 0.05) {
      ctx.fillStyle = CY;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(cx, cy - 15 * u, 9 * u, 18 * u);
    }
    ctx.restore();
    // the line of light the console collapses into
    if (k > 0 && k < 1) {
      const w = bw * (1 - easeIn(k)) * 1.1;
      ctx.save();
      ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9;
      const g = ctx.createLinearGradient(W / 2 - w / 2, 0, W / 2 + w / 2, 0);
      g.addColorStop(0, 'rgba(0,246,255,0)');
      g.addColorStop(0.5, 'rgba(220,255,255,1)');
      g.addColorStop(1, 'rgba(0,246,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(W / 2 - w / 2, H / 2 - 1.5 * u, w, 3 * u);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------- ACT 1
  function drawSeed(S) {
    const t = S.t;
    if (t < T.seed - 0.1 || t > T.indexStart + 1.5) return;
    const p = S.project(0, 0, 1.001);
    const beat = (b) => (t >= b ? Math.exp(-(t - b) * 5) : 0);
    const pulse = beat(T.beat1) + beat(T.beat2) * 1.2 + beat(T.seed) * 1.5;
    const fade = 1 - smooth(t, T.growStart + 1.5, T.substrate + 0.5);
    const r = (34 + pulse * 70 + Math.sin(t * 3) * 2) * u;
    glowDot(p.x, p.y, r, '120,245,255', fade);
    glowDot(p.x, p.y, (5 + pulse * 5) * u, '255,255,255', fade);
    // heartbeat shock rings
    for (const b of [T.beat1, T.beat2]) {
      const k = (t - b) / 1.1;
      if (k > 0 && k < 1) {
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.6 * fade;
        ctx.strokeStyle = CY;
        ctx.lineWidth = 1.2 * u;
        ctx.beginPath();
        ctx.arc(p.x, p.y, easeOut(k) * S.limbR * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    const la = win(t, T.seed + 0.35, T.growStart + 1.6, 0.2, 0.6);
    const lx = p.x + 26 * u;
    line(p.x + 8 * u, p.y - 8 * u, lx, p.y - 26 * u, CY, la * 0.7);
    line(lx, p.y - 26 * u, lx + 120 * u, p.y - 26 * u, CY, la * 0.7);
    text(scramble('SEED 0x00000001', t, T.seed + 0.4, 0.5), lx + 4 * u, p.y - 33 * u, { font: mono(13, 500), color: WH, alpha: la, spacing: 1.5 * u });
    text(scramble('NULL ISLAND · 0.0000°N 0.0000°E', t, T.seed + 0.7, 0.6, 2), lx + 4 * u, p.y - 10 * u, { font: mono(11), color: DIM, alpha: la, spacing: 1 * u });
  }

  function dishRing(cx, cy, r, prog, alpha, rot, { ticks = true, labels = true, breakK = 0 } = {}) {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = CY;
    const start = -Math.PI / 2;
    if (breakK <= 0) {
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.arc(0, 0, r, start, start + prog * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.35;
      ctx.setLineDash([2 * u, 6 * u]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 14 * u, start + rot, start + rot + prog * Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (ticks) {
        const N = 120;
        for (let i = 0; i < N * prog; i++) {
          const a = start + rot + (i / N) * Math.PI * 2;
          const long = i % 10 === 0;
          const l = (long ? 12 : 5) * u;
          ctx.globalAlpha = alpha * (long ? 0.85 : 0.4);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * (r + 3 * u), Math.sin(a) * (r + 3 * u));
          ctx.lineTo(Math.cos(a) * (r + 3 * u + l), Math.sin(a) * (r + 3 * u + l));
          ctx.stroke();
          if (labels && long && i % 30 === 0) {
            ctx.globalAlpha = alpha * 0.7;
            ctx.font = mono(10);
            ctx.fillStyle = CY;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const rr = r + 30 * u;
            ctx.fillText(pad(i * 3, 3), Math.cos(a) * rr, Math.sin(a) * rr);
          }
        }
      }
    } else {
      // shattering: arc segments fly outward and spin away
      const N = 48;
      for (let i = 0; i < N; i++) {
        const a0 = start + (i / N) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / N * 0.82;
        const hr = hash1(i * 3.7);
        const push = easeOut(breakK) * (60 + hr * 380) * u;
        const spin = (hash1(i * 9.1) - 0.5) * breakK * 0.8;
        ctx.globalAlpha = alpha * (1 - breakK) * (0.6 + hr * 0.4);
        ctx.lineWidth = (1.5 + hr * 2.5) * u;
        ctx.beginPath();
        const am = (a0 + a1) / 2;
        const ox = Math.cos(am) * push;
        const oy = Math.sin(am) * push;
        ctx.arc(ox, oy, r, a0 + spin, a1 + spin);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawDish(S) {
    const t = S.t;
    if (t < T.dishDraw || t > T.indexStart + 4) return;
    const prog = easeInOut(ramp(t, T.dishDraw, T.dishDone));
    const a = 1 - smooth(t, T.indexStart + 0.5, T.indexStart + 3.5);
    const r = S.limbR + 10 * u;
    dishRing(S.center.x, S.center.y, r, prog, a, t * 0.02);
    // label at the top of the dish
    const ta = win(t, T.dishDraw + 0.6, T.indexStart + 3, 0.4, 0.6);
    text(scramble('SUBSTRATE', t, T.dishDraw + 0.6, 0.6), S.center.x, S.center.y - r - 46 * u, { font: mono(12, 500), color: CY, align: 'center', alpha: ta, spacing: 6 * u });
  }

  function drawGrowth(S) {
    const t = S.t;
    if (t < T.growStart || t > T.indexStart + 1.5) return;
    const a = win(t, T.growStart + 0.1, T.substrate + 0.15, 0.4, 0.3);
    const f = Math.max(0, Math.min(Math.PI, S.front));
    const frac = (1 - Math.cos(f)) / 2;
    const nodes = Math.floor(1 + 4.8e6 * Math.pow(frac, 1.15));
    const dbl = 0.42 / (1 + (t - T.growStart) * 0.6);
    const y = PORTRAIT ? S.center.y + S.limbR + 110 * u : H - M - 52 * u;
    const parts = [
      ['NODES', fmt(nodes)],
      ['FRONT', ((Math.min(f, Math.PI) * 180) / Math.PI).toFixed(1).padStart(5, '0') + '°'],
      ['DOUBLING', dbl.toFixed(3) + ' S'],
      ['MEDIUM', 'UNKNOWN'],
    ];
    if (t > T.coastReached - 1.2) parts[3][1] = scramble('LAND / SEA', t, T.coastReached - 1.2, 0.5);
    if (t > T.growEnd - 0.6) parts[3][1] = scramble('PLANETARY', t, T.growEnd - 0.6, 0.5);
    const font = mono(13);
    const gap = 46 * u;
    const widths = parts.map(([k, v]) => measure(k + '  ' + v, font, 1.2 * u));
    const total = widths.reduce((s, w) => s + w, 0) + gap * (parts.length - 1);
    if (PORTRAIT) {
      // two rows in portrait
      parts.forEach(([k, v], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = W / 2 + (col === 0 ? -20 * u : 20 * u);
        const yy = y + row * 26 * u;
        text(k, x - (col === 0 ? measure(v, font, 1.2 * u) + 14 * u : 0), yy, { font, color: DIM, align: col === 0 ? 'right' : 'left', alpha: a, spacing: 1.2 * u });
        text(v, col === 0 ? x : x + measure(k, font, 1.2 * u) + 14 * u, yy, { font, color: WH, align: col === 0 ? 'right' : 'left', alpha: a, spacing: 1.2 * u });
      });
    } else {
      let x = W / 2 - total / 2;
      parts.forEach(([k, v], i) => {
        const kw = text(k + '  ', x, y, { font, color: DIM, alpha: a, spacing: 1.2 * u });
        text(v, x + kw, y, { font, color: WH, alpha: a, spacing: 1.2 * u });
        x += widths[i] + gap;
      });
    }

    // the culture learning place names as the front passes them
    const la = 1 - smooth(t, T.substrate, T.indexStart + 1);
    let shown = 0;
    for (let i = 0; i < pick.cities.length && shown < 26; i++) {
      const c = pick.cities[i];
      const d = angDist(0, 0, c[0], c[1]);
      const k = S.front - d;
      if (k < 0 || k > 0.75) continue;
      const p = S.project(c[0], c[1], 1.002);
      if (!p.vis || p.facing < 0.25) continue;
      if (i > 90) continue;
      shown++;
      const age = k / 0.75;
      const alpha = la * Math.min(1, k * 14) * (1 - smooth(age, 0.55, 1));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = CY;
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (3 + 10 * Math.exp(-k * 18)) * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const name = c[3].toUpperCase();
      text(scramble(name, S.t, S.t - k * 2.2, 0.35, i), p.x + 7 * u, p.y - 6 * u, { font: mono(11, 500), color: WH, alpha, spacing: 1.2 * u });
      text(`${fmt(c[2])}`, p.x + 7 * u, p.y + 8 * u, { font: mono(9), color: DIM, alpha: alpha * 0.8, spacing: 0.8 * u });
    }

    // SUBSTRATE IDENTIFIED
    const sa = win(t, T.substrate, T.indexStart + 1.2, 0.05, 0.6);
    if (sa > 0) {
      const yy = PORTRAIT ? S.center.y + S.limbR + 130 * u : H - M - 62 * u;
      text(scramble('SUBSTRATE IDENTIFIED', t, T.substrate, 0.45), W / 2, yy, { font: sans(30, 300), color: WH, align: 'center', alpha: sa, spacing: 12 * u });
      text(scramble('EARTH · 510,072,000 KM² · 1 OBSERVER', t, T.substrate + 0.25, 0.5, 5), W / 2, yy + 34 * u, { font: mono(13), color: CY, align: 'center', alpha: sa, spacing: 2.5 * u });
    }
  }

  // ---------------------------------------------------------- ACT 2
  function drawIndexing(S) {
    const t = S.t;
    if (t < T.indexStart || t > T.indexed + 1.6) return;
    const a = win(t, T.indexStart, T.indexed, 0.3, 0.3);
    const x = M + 6 * u;
    const y = PORTRAIT ? H * 0.1 + 40 * u : H * 0.2;
    if (a > 0) {
      text(scramble('INDEXING SURFACE', t, T.indexStart, 0.6), x, y, { font: sans(30, 300), color: WH, alpha: a, spacing: 9 * u });
      text(scramble('ESRI WORLD IMAGERY · WEB MERCATOR QUADTREE', t, T.indexStart + 0.3, 0.7, 2), x, y + 28 * u, { font: mono(12), color: DIM, alpha: a, spacing: 1.5 * u });
      const zk = ramp(t, T.indexStart + 0.4, T.flurryEnd);
      const z = Math.round(lerp(3, 19, Math.pow(zk, 0.8)));
      const tiles = (Math.pow(4, z + 1) - 1) / 3;
      const gsd = 156543.03 / 2 ** z;
      const rows = [
        ['LEVEL', `Z${pad(z, 2)}`],
        ['TILES', fmt(tiles)],
        ['GSD', gsd >= 1 ? `${fmt(gsd)} M/PX` : `${gsd.toFixed(2)} M/PX`],
        ['SOLAR', t > 22.8 ? scramble('MODEL APPLIED', t, 22.8, 0.5) : 'PENDING'],
      ];
      rows.forEach(([k, v], i) => {
        const yy = y + (60 + i * 22) * u;
        const ra = a * smooth(t, T.indexStart + 0.5 + i * 0.12, T.indexStart + 0.8 + i * 0.12);
        text(k, x, yy, { font: mono(13), color: DIM, alpha: ra, spacing: 1.5 * u });
        text(v, x + 92 * u, yy, { font: mono(13, 500), color: i === 3 && t > 22.8 ? CY : WH, alpha: ra, spacing: 1.5 * u });
      });
    }

    // tile ids riding the quadtree front
    const ta = 1 - smooth(t, 23.5, 25);
    if (ta > 0)
      for (const tl of tileList) {
        const ph = t - tl.tRev;
        if (ph < 0 || ph > 0.55) continue;
        const p = S.project(tl.lon, tl.lat, 1.0);
        if (!p.vis || p.facing < 0.3) continue;
        const al = ta * (1 - ph / 0.55) * (tl.z === 3 ? 1 : 0.7);
        text(`${tl.z}/${tl.x}/${tl.y}`, p.x, p.y, { font: mono(tl.z === 3 ? 11 : 9, 500), color: tl.z === 3 ? WH : CY, align: 'center', alpha: al, spacing: 1 * u, baseline: 'middle' });
      }

    drawCaptures(S);
  }

  function capLabel(h, i) {
    const gsd = (156543.03 * Math.cos(h.lat * D2R)) / 2 ** (h.close_zoom || 18);
    return {
      id: `CAPTURE ${pad(i + 1, 4)}`,
      name: h.name.toUpperCase(),
      coord: `${fmtLat(h.lat, 4)} ${fmtLon(h.lon, 4)}`,
      gsd: `${gsd.toFixed(2)} M/PX`,
    };
  }

  function drawCaptures(S) {
    const t = S.t;
    if (!heroes.length || t < T.capStart - 0.4) return;
    const sheetA = smooth(t, T.capStart - 0.4, T.capStart + 0.2) * (1 - smooth(t, T.flurryEnd - 0.2, T.indexed));
    // empty slots
    if (sheetA > 0) {
      sheet.slots.forEach((s, i) => {
        const filled = t >= capT[i] + (i < CAPTURE_SLOW ? 1.5 : 0);
        ctx.save();
        ctx.globalAlpha = sheetA * (filled ? 0 : 0.45);
        ctx.strokeStyle = FAINT;
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
        ctx.restore();
      });
      const done = capT.filter((c, i) => t >= c + (i < CAPTURE_SLOW ? 1.5 : 0.0)).length;
      const ly = sheet.y0 - 14 * u;
      text('SYNTHETIC CAPTURES', sheet.x0, ly, { font: mono(12, 500), color: CY, alpha: sheetA, spacing: 2 * u });
      text(`${pad(done, 2)}/${pad(heroes.length, 2)}`, sheet.x0 + sheet.sw, ly, { font: mono(12), color: WH, alpha: sheetA, align: 'right', spacing: 2 * u });
    }

    const fullIdx = Math.max(0, heroes.indexOf(fullHero));
    // filled thumbnails
    heroes.forEach((h, i) => {
      const s = sheet.slots[i];
      const t0 = capT[i];
      const slow = i < CAPTURE_SLOW;
      const landT = slow ? t0 + 1.5 : t0;
      if (t < landT) return;
      if (i === fullIdx && t >= T.capFull && t < T.capFull + 3.0) return;
      const k = t - landT;
      ctx.save();
      ctx.globalAlpha = sheetA;
      drawCover(h.close, s.x, s.y, s.w, s.h);
      // fresh-capture flash
      const fl = Math.exp(-k * 9);
      if (fl > 0.01) {
        ctx.fillStyle = `rgba(230,255,255,${fl * 0.85})`;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
      ctx.restore();
      brackets(s.x, s.y, s.w, s.h, 7 * u, CY, sheetA * (0.35 + fl), 1);
      // rapid captures: a viewfinder ping on the globe
      if (!slow && k < 0.45) {
        const p = S.project(h.lon, h.lat, 1.0);
        if (p.vis) {
          const sz = (34 - 20 * easeOut(k / 0.45)) * u;
          brackets(p.x - sz / 2, p.y - sz / 2, sz, sz, 6 * u, WH, (1 - k / 0.45) * sheetA, 1.2);
          line(p.x, p.y, s.x + s.w / 2, s.y + s.h / 2, CY, (1 - k / 0.45) * 0.35 * sheetA, 0.8);
        }
      }
    });

    // slow captures: the enhance
    for (let i = 0; i < Math.min(CAPTURE_SLOW, heroes.length); i++) {
      const t0 = capT[i];
      const k = t - t0;
      if (k < 0 || k > 1.5) continue;
      const h = heroes[i];
      const lab = capLabel(h, i);
      const p = S.project(h.lon, h.lat, 1.0);
      // viewfinder lock on the globe
      if (k < 0.5 && p.vis) {
        const sz = (90 - 60 * easeOut(k / 0.5)) * u;
        brackets(p.x - sz / 2, p.y - sz / 2, sz, sz, 10 * u, WH, 1 - k / 0.5, 1.4);
      }
      // card rect: appear → hold → fly to slot
      const s = sheet.slots[i];
      const fly = easeInOut(ramp(k, 1.2, 1.5));
      const open = easeOut(ramp(k, 0.05, 0.3));
      const R = {
        x: lerp(bigCard.x, s.x, fly),
        y: lerp(bigCard.y, s.y, fly),
        w: lerp(bigCard.w, s.w, fly),
        h: lerp(bigCard.h * open, s.h, fly),
      };
      R.y += (bigCard.h - R.h) * 0.5 * (1 - fly);
      if (p.vis && fly < 0.05) line(p.x, p.y, R.x + R.w, R.y + R.h / 2, CY, 0.4 * open, 0.8);
      ctx.save();
      ctx.beginPath();
      ctx.rect(R.x, R.y, R.w, R.h);
      ctx.clip();
      ctx.fillStyle = '#000';
      ctx.fillRect(R.x, R.y, R.w, R.h);
      // z13 → z18: 32x exponential zoom, handing off to the native close crop
      const zk = easeInOut(ramp(k, 0.3, 1.3));
      const sc = Math.pow(32, zk);
      ctx.globalAlpha = 1;
      drawCover(h.wide, R.x, R.y, R.w, R.h, sc);
      const cf = smooth(sc, 7, 22);
      if (cf > 0) {
        ctx.globalAlpha = cf;
        drawCover(h.close, R.x, R.y, R.w, R.h, Math.max(1, sc / 32));
      }
      ctx.globalAlpha = 1;
      const fl = Math.exp(-Math.max(0, k - 0.05) * 10) * (k > 0.05 ? 1 : 0);
      ctx.fillStyle = `rgba(230,255,255,${fl * 0.9})`;
      ctx.fillRect(R.x, R.y, R.w, R.h);
      ctx.restore();
      const ia = open * (1 - fly);
      brackets(R.x, R.y, R.w, R.h, 18 * u, CY, open, 1.5);
      // crosshair
      const cx = R.x + R.w / 2;
      const cy = R.y + R.h / 2;
      line(cx - 16 * u, cy, cx - 5 * u, cy, WH, ia * 0.8);
      line(cx + 5 * u, cy, cx + 16 * u, cy, WH, ia * 0.8);
      line(cx, cy - 16 * u, cx, cy - 5 * u, WH, ia * 0.8);
      line(cx, cy + 5 * u, cx, cy + 16 * u, WH, ia * 0.8);
      plate(scramble(lab.id, t, t0 + 0.1, 0.3), R.x + 12 * u, R.y + 22 * u, { font: mono(12, 500), alpha: ia, spacing: 1.5 });
      const zl = `Z${Math.round(lerp(13, 18, zk))}`;
      text(zl, R.x + R.w - 14 * u, R.y + 27 * u, { font: mono(13, 500), color: WH, align: 'right', alpha: ia, spacing: 1.5 * u });
      text(scramble(lab.name, t, t0 + 0.25, 0.4, i), R.x + 14 * u, R.y + R.h - 34 * u, { font: sans(20, 500), color: WH, alpha: ia, spacing: 4 * u });
      text(`${lab.coord} · ${lab.gsd}`, R.x + 14 * u, R.y + R.h - 14 * u, { font: mono(11), color: WH, alpha: ia * 0.85, spacing: 1 * u });
    }

    // full-frame: feature extraction
    if (fullHero && t >= T.capFull && t < T.indexed + 0.1) {
      const k = t - T.capFull;
      const s = sheet.slots[fullIdx];
      const ex = easeInOut(ramp(k, 0, 0.55));
      const out = easeIn(ramp(t, T.indexed - 0.5, T.indexed));
      let R = { x: lerp(s.x, 0, ex), y: lerp(s.y, 0, ex), w: lerp(s.w, W, ex), h: lerp(s.h, H, ex) };
      if (out > 0) {
        const cx = S.center.x;
        const cy = S.center.y;
        const f = 1 - out;
        R = { x: lerp(cx, 0, f), y: lerp(cy, 0, f), w: W * f, h: H * f };
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(R.x, R.y, R.w, R.h);
      ctx.clip();
      ctx.globalAlpha = 1 - out * 0.6;
      const kb = 1 + k * 0.025;
      drawCover(fullHero.close, R.x, R.y, R.w, R.h, kb);
      // scan: edges in cyan above the line, image dimmed
      const scanY = R.y + R.h * easeInOut(ramp(k, 0.75, 2.35));
      ctx.fillStyle = 'rgba(0,8,14,0.55)';
      ctx.fillRect(R.x, R.y, R.w, scanY - R.y);
      ctx.save();
      ctx.beginPath();
      ctx.rect(R.x, R.y, R.w, scanY - R.y);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      drawCover(edgeCanvas, R.x, R.y, R.w, R.h, kb);
      ctx.restore();
      // scanline
      if (k > 0.75 && k < 2.4) {
        const g = ctx.createLinearGradient(0, scanY - 40 * u, 0, scanY + 2 * u);
        g.addColorStop(0, 'rgba(0,246,255,0)');
        g.addColorStop(1, 'rgba(160,255,255,0.75)');
        ctx.fillStyle = g;
        ctx.fillRect(R.x, scanY - 40 * u, R.w, 42 * u);
        ctx.fillStyle = '#fff';
        ctx.fillRect(R.x, scanY - 1 * u, R.w, 2 * u);
      }
      // analysis grid
      ctx.globalAlpha = 0.12 * ex * (1 - out);
      ctx.strokeStyle = CY;
      ctx.lineWidth = 1;
      const gs = 90 * u;
      for (let gx = R.x; gx < R.x + R.w; gx += gs) {
        ctx.beginPath();
        ctx.moveTo(gx, R.y);
        ctx.lineTo(gx, R.y + R.h);
        ctx.stroke();
      }
      for (let gy = R.y; gy < R.y + R.h; gy += gs) {
        ctx.beginPath();
        ctx.moveTo(R.x, gy);
        ctx.lineTo(R.x + R.w, gy);
        ctx.stroke();
      }
      ctx.restore();
      const ia = ex * (1 - out);
      const lab = capLabel(fullHero, fullIdx);
      const bx = M + 6 * u;
      const by = PORTRAIT ? H * 0.12 : H * 0.16;
      plate('FEATURE EXTRACTION', bx, by, { font: mono(14, 500), alpha: ia, spacing: 2.5 });
      text(`${lab.name} · Z18 · ${lab.gsd}`, bx, by + 40 * u, { font: mono(13), color: WH, alpha: ia, spacing: 1.5 * u });
      text(lab.coord, bx, by + 62 * u, { font: mono(13), color: DIM, alpha: ia, spacing: 1.5 * u });
      const ec = count(t, T.capFull + 0.75, T.capFull + 2.35, 0, edgeCount, (x) => x);
      text('EDGE FEATURES', bx, by + 100 * u, { font: mono(12), color: DIM, alpha: ia, spacing: 2 * u });
      text(fmt(ec), bx, by + 140 * u, { font: sans(44, 200), color: WH, alpha: ia, spacing: 2 * u });
      brackets(M * 0.55 + 10 * u, M * 0.55 + 10 * u, W - M * 1.1 - 20 * u, H - M * 1.1 - 20 * u, 40 * u, WH, ia * 0.6, 1.5);
    }

    // SURFACE INDEXED
    const ia = win(t, T.indexed, T.indexed + 1.5, 0.05, 0.5);
    if (ia > 0) {
      const p = S.center;
      text(scramble('SURFACE INDEXED', t, T.indexed, 0.4), W / 2, PORTRAIT ? H * 0.2 : H * 0.17, { font: sans(32, 300), color: WH, align: 'center', alpha: ia, spacing: 14 * u });
      text(`${fmt(366503875925)} TILES · Z0–Z19`, W / 2, (PORTRAIT ? H * 0.2 : H * 0.17) + 34 * u, { font: mono(13), color: CY, align: 'center', alpha: ia, spacing: 2.5 * u });
    }
  }

  // ---------------------------------------------------------- ACT 3
  const callCache = {};
  function callout(S, key, lon, lat, r, title, sub, side = 1, alpha = 1, color = WH) {
    const p = r > 1.3 ? S.projectVec(llToVec(lon, lat, r)) : S.project(lon, lat, r);
    if (r <= 1.3 && (!p.vis || p.facing < 0.15)) return false;
    if (p.x < M || p.x > W - M || p.y < M * 2 || p.y > H - M * 2) return false;
    drawCallout(p.x, p.y, title, sub, side, alpha, color);
    return true;
  }
  function drawCallout(x, y, title, sub, side, alpha, color = WH) {
    const dx = 46 * u * side;
    const dy = -38 * u;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    ctx.arc(x, y, 5 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 4 * u * side, y - 4 * u);
    ctx.lineTo(x + dx, y + dy);
    ctx.lineTo(x + dx + 70 * u * side, y + dy);
    ctx.stroke();
    ctx.restore();
    const tx = x + dx + (side > 0 ? 4 * u : -4 * u);
    text(title, tx, y + dy - 7 * u, { font: mono(13, 500), color, alpha, align: side > 0 ? 'left' : 'right', spacing: 1.2 * u });
    text(sub, tx, y + dy + 15 * u, { font: mono(11), color: DIM, alpha, align: side > 0 ? 'left' : 'right', spacing: 1 * u });
  }

  function drawFeeds(S) {
    const t = S.t;
    if (t < T.air - 0.6 || t > T.cut) return;
    const wallDim = 1 - win(t, T.cctvWall - 0.1, T.cctvOut + 0.3, 0.2, 0.3);
    const a = smooth(t, T.air - 0.6, T.air) * (1 - smooth(t, T.descend, T.descend + 0.5)) * wallDim;
    if (t > T.descend + 0.6) return;
    // a soft dark gutter keeps the stack legible over the planet
    if (a > 0) {
      ctx.save();
      ctx.globalAlpha = a * 0.75;
      const g = PORTRAIT ? ctx.createLinearGradient(0, H, 0, H * 0.55) : ctx.createLinearGradient(0, 0, W * 0.42, 0);
      g.addColorStop(0, 'rgba(0,3,6,0.92)');
      g.addColorStop(0.55, 'rgba(0,3,6,0.6)');
      g.addColorStop(1, 'rgba(0,3,6,0)');
      ctx.fillStyle = g;
      if (PORTRAIT) ctx.fillRect(0, H * 0.55, W, H * 0.45);
      else ctx.fillRect(0, 0, W * 0.42, H);
      ctx.restore();
    }

    // header + stack
    const x = stack.x;
    let y = stack.y;
    if (a > 0) {
      text(scramble('INGESTION', t, T.air - 0.5, 0.5), x, y - 34 * u, { font: sans(26, 300), color: WH, alpha: a, spacing: 9 * u });
      text('LIVE PUBLIC FEEDS', x + stack.w, y - 36 * u, { font: mono(11), color: DIM, alpha: a, align: 'right', spacing: 2 * u });
      line(x, y - 22 * u, x + stack.w, y - 22 * u, CY, a * 0.5);
      FEEDS.forEach((f, i) => {
        if (t < f.t) return;
        const k = t - f.t;
        const ry = y + i * stack.row;
        const ra = a * Math.min(1, k * 8);
        const flash = Math.exp(-k * 5);
        if (flash > 0.02) {
          ctx.save();
          ctx.globalAlpha = ra * flash;
          ctx.fillStyle = '#f2fdff';
          ctx.fillRect(x - 6 * u, ry - stack.row * 0.62, stack.w + 12 * u, stack.row * 0.86);
          ctx.restore();
        }
        const ink = flash > 0.45 ? '#001014' : null;
        const n = count(t, f.t, f.t + 1.3, 0, counts[f.key] || 0);
        text(pad(i + 1, 2), x, ry, { font: mono(12), color: ink || DIM, alpha: ra, spacing: 1 * u });
        text(scramble(f.label, t, f.t, 0.35, i), x + 34 * u, ry, { font: mono(14, 500), color: ink || WH, alpha: ra, spacing: 1.6 * u });
        text(f.code, x + stack.w * (PORTRAIT ? 0.45 : 0.47), ry, { font: mono(11), color: ink || CY, alpha: ra * 0.9, spacing: 1 * u });
        text(fmt(n), x + stack.w - 62 * u, ry, { font: mono(14, 500), color: ink || WH, alpha: ra, align: 'right', spacing: 1 * u });
        const blink = 0.55 + 0.45 * Math.sin(t * 6 + i);
        ctx.save();
        ctx.globalAlpha = ra * blink;
        ctx.fillStyle = ink || (f.key === 'quake' ? RED : f.key === 'fire' ? '#ff7a1f' : f.key === 'mil' ? AMB : CY);
        ctx.beginPath();
        ctx.arc(x + stack.w - 46 * u, ry - 5 * u, 3.2 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        text('LIVE', x + stack.w, ry, { font: mono(11, 500), color: ink || WH, alpha: ra, align: 'right', spacing: 1 * u });
        text(f.src, x + 34 * u, ry + 14 * u, { font: mono(9), color: FAINT, alpha: ra, spacing: 1 * u });
      });
      // rapid tail — the long list keeps scrolling in
      if (t >= T.rapid) {
        const by = y + FEEDS.length * stack.row + 6 * u;
        rapidList.forEach(([name, v], i) => {
          const st = T.rapid + i * 0.22;
          if (t < st) return;
          const ry = by + i * 20 * u;
          const ra = a * Math.min(1, (t - st) * 10);
          text(`+ ${name}`, x + 34 * u, ry, { font: mono(11), color: DIM, alpha: ra, spacing: 1 * u });
          text(fmt(count(t, st, st + 0.5, 0, v)), x + stack.w - 62 * u, ry, { font: mono(11), color: WH, alpha: ra, align: 'right', spacing: 1 * u });
        });
      }
    }

    // caption for the feed that just arrived
    const cur = FEEDS.filter((f) => t >= f.t).pop();
    if (cur && t < T.cctvWall) {
      const idx = FEEDS.indexOf(cur);
      const next = FEEDS[idx + 1]?.t ?? T.cctvWall;
      const ca = win(t, cur.t, next, 0.08, 0.15) * a;
      const n = count(t, cur.t, cur.t + 1.3, 0, counts[cur.key] || 0);
      const unit = { air: 'AIRBORNE CONTACTS', mil: 'MILITARY TRANSPONDERS', sea: 'VESSELS UNDER WAY', orbit: 'OBJECTS IN ORBIT', quake: 'EVENTS · 30 DAYS', fire: 'THERMAL DETECTIONS · 24 H', wind: 'GRID CELLS · 10 M WIND', cable: 'CABLE SEGMENTS', cctv: 'PUBLIC CAMERAS' }[cur.key];
      if (PORTRAIT) {
        const cy = M + 110 * u;
        text(scramble(cur.label, t, cur.t, 0.35, 9), W / 2, cy, { font: sans(40, 200), color: WH, align: 'center', alpha: ca, spacing: 12 * u });
        text(`${fmt(n)} ${unit}`, W / 2, cy + 36 * u, { font: mono(14), color: CY, align: 'center', alpha: ca, spacing: 2 * u });
        text(cur.src, W / 2, cy + 58 * u, { font: mono(11), color: DIM, align: 'center', alpha: ca, spacing: 2 * u });
      } else {
        const cx = W - M - 6 * u;
        const cy = H - M - 112 * u;
        text(scramble(cur.label, t, cur.t, 0.35, 9), cx, cy, { font: sans(46, 200), color: WH, align: 'right', alpha: ca, spacing: 14 * u });
        text(`${fmt(n)} ${unit} · ${cur.src}`, cx, cy + 34 * u, { font: mono(13), color: CY, align: 'right', alpha: ca, spacing: 2 * u });
      }
    }

    // callouts on real records
    const ca = (s, e) => win(t, s, e, 0.25, 0.3) * wallDim;
    {
      const al = ca(T.air + 0.6, T.orbit + 0.4);
      if (al > 0) {
        let n = 0;
        for (const r of pick.flights) {
          if (n >= 3) break;
          const [lon, lat] = S.flightPos(r, 140);
          const ok = callout(S, 'f' + r[5], lon, lat, 1.02, r[5], `FL${pad(Math.round(r[2] * 3.2808 / 100), 3)} · ${Math.round(r[4] * 1.944)} KT · HDG ${pad(Math.round(r[3]), 3)}`, n % 2 ? -1 : 1, al);
          if (ok) n++;
        }
      }
    }
    {
      const al = ca(T.mil + 0.4, T.orbit + 0.6);
      if (al > 0) {
        let n = 0;
        for (const r of pick.mil) {
          if (n >= 2) break;
          const [lon, lat] = S.flightPos(r, 140);
          if (callout(S, 'm' + r[5], lon, lat, 1.02, `${r[5]} · ${r[7]}`, `${fmt(r[2])} M · ${Math.round(r[4] * 1.944)} KT`, n % 2 ? 1 : -1, al, AMB)) n++;
        }
      }
    }
    {
      const al = ca(T.sea + 0.4, T.sea + 2.6);
      if (al > 0) {
        let n = 0;
        for (const r of pick.ships) {
          if (n >= 3) break;
          const [lon, lat] = S.shipPos(r);
          if (callout(S, 's' + r[4], lon, lat, 1.002, r[5], `MMSI ${r[4]} · ${r[2].toFixed(1)} KN`, n % 2 ? -1 : 1, al, '#7dffd6')) n++;
        }
      }
    }
    {
      const al = ca(T.orbit + 0.8, T.fire + 1);
      if (al > 0) {
        for (const [id, name] of [[25544, 'ISS (ZARYA)'], [48274, 'TIANHE (CSS)'], [20580, 'HUBBLE']]) {
          const p = S.satPos(id);
          if (!p) continue;
          const sp = S.projectVec(p);
          const r = Math.hypot(...p);
          // hide when behind the planet
          const cam = S.camPos;
          if (sp.z > 1 || sp.x < M || sp.x > W - M || sp.y < M * 2 || sp.y > H - M * 2) continue;
          if (occluded(p, cam)) continue;
          drawCallout(sp.x, sp.y, name, `NORAD ${id} · ${fmt((r - 1) * EARTH_KM)} KM`, sp.x > S.center.x ? 1 : -1, al, '#d9d2ff');
        }
      }
    }
    {
      const al = ca(T.quake + 0.6, T.wind + 0.5);
      if (al > 0) {
        let n = 0;
        for (const q of pick.quakeTop) {
          if (n >= 2) break;
          if (callout(S, 'q', q[0], q[1], 1.002, `M${q[3].toFixed(1)}`, q[5].toUpperCase().slice(0, 34), n % 2 ? -1 : 1, al, '#ff7a7a')) n++;
        }
      }
    }
    {
      const al = ca(T.fire + 0.6, T.wind + 0.8);
      if (al > 0) {
        let n = 0;
        for (const f of pick.fireTop) {
          if (n >= 1) break;
          if (callout(S, 'fi', f[0], f[1], 1.002, `FRP ${fmt(f[2])} MW`, `${fmtLat(f[1], 2)} ${fmtLon(f[0], 2)} · VIIRS`, -1, al, '#ffa260')) n++;
        }
      }
    }
  }
  function occluded(p, cam) {
    // ray from camera to point hits the unit sphere first?
    const dx = p[0] - cam.x;
    const dy = p[1] - cam.y;
    const dz = p[2] - cam.z;
    const L = Math.hypot(dx, dy, dz);
    const rx = dx / L;
    const ry = dy / L;
    const rz = dz / L;
    const b = cam.x * rx + cam.y * ry + cam.z * rz;
    const c = cam.x ** 2 + cam.y ** 2 + cam.z ** 2 - 1;
    const disc = b * b - c;
    if (disc < 0) return false;
    const tHit = -b - Math.sqrt(disc);
    return tHit > 0 && tHit < L;
  }

  // ---------------------------------------------------------- CCTV
  function camCell(c, x, y, w, h, alpha, t, opts = {}) {
    if (!c) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    drawCover(c.tile, x, y, w, h);
    // live noise band rolling through
    const band = ((t * 0.35 + (opts.r || 0)) % 1) * h * 1.6 - h * 0.3;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y + band, w, h * 0.08);
    ctx.restore();
    if (c.det && w > 60 * u && h > 30 * u) detBoxes(c.det, x, y, w, h, alpha * 0.9, t, w > 150 * u);
    if (w > 90 * u) {
      const fs = Math.max(7, Math.min(10, w / 26 / u));
      text((c.name || '').toUpperCase().slice(0, Math.floor(w / (fs * 0.62 * u)) - 2), x + 5 * u, y + 12 * u, { font: mono(fs, 500), color: WH, alpha: alpha * 0.9, spacing: 0.5 * u });
      const now = new Date(snapT.getTime() + t * 1000);
      text(now.toISOString().slice(11, 19), x + 5 * u, y + h - 6 * u, { font: mono(fs * 0.9), color: WH, alpha: alpha * 0.75, spacing: 0.5 * u });
      if (Math.floor(t * 2 + (opts.r || 0) * 2) % 2 === 0) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = RED;
        ctx.beginPath();
        ctx.arc(x + w - 24 * u, y + 9 * u, 2.5 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      text('REC', x + w - 5 * u, y + 12 * u, { font: mono(fs * 0.9, 500), color: WH, alpha: alpha * 0.8, align: 'right' });
      text((c.city || c.country || '').toUpperCase(), x + w - 5 * u, y + h - 6 * u, { font: mono(fs * 0.9), color: CY, alpha: alpha * 0.85, align: 'right', spacing: 0.5 * u });
    }
  }

  function tvOn(k) {
    // CRT power-on: a bright line opens vertically
    return { open: easeOut(clamp(k / 0.14)), glow: Math.exp(-k * 10) };
  }

  function drawCCTV(S) {
    const t = S.t;
    if (!camTiles.length || t < T.cctv || t > T.cctvOut + 0.8) return;
    // tethered feeds pinned to the globe
    if (t < T.cctvWall + 0.3 && T.cctv < T.cctvWall) {
      const a = 1 - smooth(t, T.cctvWall - 0.1, T.cctvWall + 0.25);
      const vis = [];
      for (const c of camTiles) {
        const p = S.project(c.lon, c.lat, 1.001);
        if (p.vis && p.facing > 0.3) vis.push({ c, p });
        if (vis.length >= (PORTRAIT ? 6 : 9)) break;
      }
      // pins for every camera we hold
      for (const c of camTiles) {
        const p = S.project(c.lon, c.lat, 1.001);
        if (!p.vis) continue;
        const k = t - T.cctv - hash1(c.lat * 7.1) * 0.6;
        if (k < 0) continue;
        glowDot(p.x, p.y, 7 * u, '255,255,255', a * Math.min(1, k * 6));
      }
      const tw = (PORTRAIT ? 170 : 176) * u;
      const th = tw * 9 / 16;
      vis.forEach(({ c, p }, i) => {
        const st = T.cctv + 0.25 + i * 0.12;
        const k = t - st;
        if (k < 0) return;
        const ang = -Math.PI / 2 + (i - (vis.length - 1) / 2) * 0.45;
        const dist = (150 + (i % 3) * 40) * u;
        let bx = p.x + Math.cos(ang) * dist - tw / 2;
        let by = p.y + Math.sin(ang) * dist - th / 2 - 30 * u;
        bx = clamp(bx, M, W - M - tw);
        by = clamp(by, M * 2, H - M * 2 - th);
        const { open, glow } = tvOn(k);
        line(p.x, p.y, bx + tw / 2, by + th, WH, a * 0.5 * Math.min(1, k * 8), 0.8);
        const hh = th * open;
        camCell(c, bx, by + (th - hh) / 2, tw, Math.max(1, hh), a, t, { r: i * 0.17 });
        if (glow > 0.02) {
          ctx.save();
          ctx.globalAlpha = a * glow;
          ctx.fillStyle = '#e8ffff';
          ctx.fillRect(bx, by + (th - hh) / 2, tw, Math.max(2 * u, hh));
          ctx.restore();
        }
        brackets(bx - 3 * u, by - 3 * u, tw + 6 * u, th + 6 * u, 8 * u, CY, a * 0.7, 1);
      });
    }

    // THE WALL
    if (t >= T.cctvWall - 0.05) {
      const outK = ramp(t, T.cctvOut, T.cctvOut + 0.55);
      const swapR = mulberry32(Math.floor(t * 6) + 99);
      for (const cell of wall.cells) {
        const st = T.cctvWall + (cell.d / wall.maxD) * 0.85 + cell.r * 0.12;
        const k = t - st;
        if (k < 0) continue;
        // collapse toward the centre, nearest first
        const ck = clamp((outK * 1.6 - (1 - cell.d / wall.maxD) * 0.6));
        const sc = 1 - easeIn(ck);
        if (sc <= 0.01) continue;
        const cxp = lerp(W / 2, cell.x + cell.w / 2, sc);
        const cyp = lerp(H / 2, cell.y + cell.h / 2, sc);
        const g = 1.5 * u;
        const w = (cell.w - g * 2) * sc;
        let h = (cell.h - g * 2) * sc;
        const { open, glow } = tvOn(k);
        h *= open;
        // feeds occasionally cut to another camera
        let camIdx = cell.cam;
        const cut = Math.floor((t - T.cctvWall) * 1.6 + cell.r2 * 7);
        if (cell.r2 > 0.55) camIdx = (cell.cam + cut * 17) % camTiles.length;
        const x = cxp - w / 2;
        const y = cyp - h / 2;
        camCell(camTiles[camIdx], x, y, w, Math.max(1, h), sc, t, { r: cell.r });
        if (glow > 0.02) {
          ctx.save();
          ctx.globalAlpha = glow;
          ctx.fillStyle = '#e8ffff';
          ctx.fillRect(x, y, w, Math.max(2 * u, h));
          ctx.restore();
        }
      }
      // the watcher: a selection reticle hopping cell to cell
      if (t > T.cctvWall + 0.8 && outK === 0) {
        const hop = Math.floor((t - T.cctvWall) * 7);
        const cell = wall.cells[Math.floor(hash1(hop * 3.3) * wall.cells.length)];
        const c = camTiles[cell.cam];
        brackets(cell.x + 3 * u, cell.y + 3 * u, cell.w - 6 * u, cell.h - 6 * u, 12 * u, CY, 1, 2);
        const tag = `ID-${pad(cell.cam + 1, 4)} · ${(c.city || '').toUpperCase()}`;
        plate(tag, cell.x + 6 * u, cell.y + cell.h + 12 * u, { font: mono(10, 500), alpha: 1, spacing: 1, padX: 6, padY: 4 });
      }
      // centre plate over the wall
      if (outK === 0 && t > T.cctvWall + 0.5) {
        const pa = smooth(t, T.cctvWall + 0.5, T.cctvWall + 0.7);
        const cy = H / 2;
        const shown = count(t, T.cctvWall + 0.5, T.cctvOut - 0.6, cams.length, counts.cctv, expoOut);
        const bw = (PORTRAIT ? 620 : 700) * u;
        const bh = 184 * u;
        ctx.save();
        ctx.globalAlpha = pa * 0.88;
        ctx.fillStyle = '#000';
        ctx.fillRect(W / 2 - bw / 2, cy - bh / 2, bw, bh);
        ctx.restore();
        brackets(W / 2 - bw / 2, cy - bh / 2, bw, bh, 14 * u, CY, pa, 1.5);
        text('OPTICAL NETWORK', W / 2, cy - 30 * u, { font: mono(13, 500), color: CY, align: 'center', alpha: pa, spacing: 6 * u });
        text(fmt(shown), W / 2, cy + 26 * u, { font: sans(56, 200), color: WH, align: 'center', alpha: pa, spacing: 4 * u });
        text(`OBJECTS IN FRAME ${fmt(detTotals.all)} · PEOPLE ${fmt(detTotals.person)} · VEHICLES ${fmt(detTotals.vehicle)}`, W / 2, cy + 76 * u, { font: mono(10, 500), color: CY, align: 'center', alpha: pa, spacing: 1.5 * u });
        text(`PUBLIC CAMERAS · ${counts.cctvSources} AGENCIES · ${counts.cctvCountries} COUNTRIES`, W / 2, cy + 56 * u, { font: mono(11), color: DIM, align: 'center', alpha: pa, spacing: 2 * u });
        // the heartbeat of the cities, from what the cameras see
        const pyb = H - 64 * u;
        ctx.save();
        ctx.globalAlpha = pa * 0.85;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, pyb - 26 * u, W, 64 * u);
        ctx.restore();
        cityPulse(M, pyb - 6 * u, W - 2 * M, 40 * u, pa, t, camTiles, 'CITY PULSE · OBJECTS DETECTED PER CAMERA · YOLOV8N');
      }
    }
  }

  // ---------------------------------------------------------- ACT 4
  function drawSaturation(S) {
    const t = S.t;
    if (t < T.saturate || t > T.cut) return;
    const a = smooth(t, T.saturate + 0.3, T.saturate + 1.2) * (1 - smooth(t, T.cut - 0.15, T.cut));
    // observation counter, top centre
    let total = 0;
    for (const f of FEEDS) total += counts[f.key] || 0;
    for (const [, v] of rapidList) total += v;
    const live = total + Math.floor((t - T.saturate) * 48211);
    // portrait stacks it above the ring; landscape hangs it in the left gutter
    const cx0 = PORTRAIT ? W / 2 : M + 6 * u;
    const al0 = PORTRAIT ? 'center' : 'left';
    const ty = PORTRAIT ? H * 0.13 : H * 0.26;
    text('OBSERVATIONS IN VIEW', cx0, ty - 50 * u, { font: mono(12, 500), color: CY, align: al0, alpha: a, spacing: 5 * u });
    text(fmt(live), cx0, ty + 12 * u, { font: sans(PORTRAIT ? 62 : 58, 200), color: WH, align: al0, alpha: a, spacing: 3 * u });
    if (!PORTRAIT) line(cx0, ty + 34 * u, cx0 + 300 * u, ty + 34 * u, CY, a * 0.5);

    // status lines
    const lines = [
      [77.4, 'HUMAN ACTIVITY', 'INGESTED'],
      [78.5, 'NON-HUMAN ACTIVITY', 'INGESTED'],
      [79.6, 'COVERAGE', '510,072,000 KM²'],
      [80.7, 'LATENCY', `${212 - Math.floor(ramp(t, 80.7, 82) * 170)} MS`],
      [81.7, 'TWIN', 'EXCEEDS SUBSTRATE'],
    ];
    const font = mono(13);
    const lx = PORTRAIT ? W / 2 - 230 * u : W - M - 446 * u;
    const ly = PORTRAIT ? H * 0.78 : H * 0.62;
    lines.forEach(([st, k, v], i) => {
      if (t < st) return;
      const la = a * Math.min(1, (t - st) * 8) * (1 - smooth(t, T.omni - 0.2, T.omni + 0.1));
      const y = ly + i * 24 * u;
      text(k, lx, y, { font, color: DIM, alpha: la, spacing: 2 * u });
      text('.'.repeat(14), lx + 110 * u, y, { font, color: FAINT, alpha: la, spacing: 2 * u });
      text(scramble(v, t, st, 0.4, i), lx + 440 * u, y, { font: mono(13, 500), color: i === 4 ? CY : WH, alpha: la, align: 'right', spacing: 2 * u });
    });

    // the dish returns, too small now
    const dr = S.ringR;
    const dA = smooth(t, T.twin - 0.6, T.twin + 0.6);
    const breakK = ramp(t, T.dishBreak, T.dishBreak + 1.1);
    dishRing(S.center.x, S.center.y, dr, 1, dA * a * (breakK > 0 ? 1 : 0.9), -t * 0.05, { breakK, labels: true });
    if (t < T.dishBreak) {
      text('SUBSTRATE BOUNDARY', S.center.x, S.center.y - dr - 46 * u, { font: mono(11, 500), color: CY, align: 'center', alpha: dA * a, spacing: 5 * u });
      // strain readout as the lattice presses on the ring
      const strain = clamp(S.latticeR / dr) * 100;
      text(`CONTAINMENT ${(100 - strain * 0.999).toFixed(1)}%`, S.center.x, S.center.y + dr + 52 * u, { font: mono(11), color: strain > 88 ? RED : DIM, align: 'center', alpha: dA * a, spacing: 3 * u });
    }

    // OMNIPRESENT
    const oa = smooth(t, T.omni, T.omni + 0.12) * (1 - smooth(t, T.cut - 0.1, T.cut));
    if (oa > 0) {
      const y = PORTRAIT ? H * 0.8 : H * 0.78;
      text('TWIN STATE', W / 2, y - 46 * u, { font: mono(12, 500), color: CY, align: 'center', alpha: oa, spacing: 6 * u });
      plate(scramble('ALIVE', t, T.omni, 0.35), W / 2, y + 4 * u, { font: sans(PORTRAIT ? 34 : 38, 500), align: 'center', alpha: oa, spacing: 14, padX: 26, padY: 14 });
    }
  }

  // ---------------------------------------------------------- ACT 5
  function drawTitle(S) {
    const t = S.t;
    if (t < T.title) return;
    const { cx, cy, s } = eyeLayout;
    const fadeEnd = 1 - smooth(t, T.fadeOut, DURATION);
    ctx.save();
    ctx.translate(cx - EYE_C.x * s, cy - EYE_C.y * s);
    ctx.scale(s, s);
    // outer eye: drawn on, then filled
    const dk = easeInOut(ramp(t, T.eyeOpen, T.eyeOpen + 1.2));
    if (dk > 0) {
      const len = 2400;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([len * dk, len]);
      ctx.strokeStyle = 'rgba(80,190,255,0.95)';
      ctx.lineWidth = 7;
      ctx.globalAlpha = fadeEnd;
      ctx.stroke(eyePaths.outer);
      ctx.setLineDash([]);
      ctx.globalAlpha = smooth(t, T.eyeOpen + 0.8, T.eyeOpen + 1.6) * 0.42 * fadeEnd;
      ctx.fillStyle = 'rgba(68,84,114,0.6)';
      ctx.fill(eyePaths.outer, 'evenodd');
      ctx.globalAlpha = smooth(t, T.eyeOpen + 0.5, T.eyeOpen + 1.4) * fadeEnd;
      ctx.fillStyle = 'rgba(70,170,230,0.55)';
      ctx.fill(eyePaths.wings);
      // iris ring
      ctx.globalAlpha = smooth(t, T.eyeOpen + 0.3, T.eyeOpen + 1.0) * fadeEnd;
      ctx.strokeStyle = CY;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(EYE_C.x - 0.5, EYE_C.y - 1, EYE_C.iris, 0, Math.PI * 2);
      ctx.stroke();
      // cage over the planet
      ctx.globalAlpha = smooth(t, T.eyeOpen + 0.9, T.eyeOpen + 1.8) * 0.09 * fadeEnd;
      ctx.fillStyle = '#ffffff';
      ctx.fill(eyePaths.cage);
    }
    ctx.restore();

    const eyeBottom = cy + (EYE_C.h / 2) * s;
    const wy = eyeBottom + (PORTRAIT ? 120 : 92) * u;
    const wa = smooth(t, T.wordmark, T.wordmark + 0.3) * fadeEnd;
    const wsize = PORTRAIT ? 64 : 70;
    text(scramble("GOD'S EYE VIEW", t, T.wordmark, 0.9, 4), W / 2 + 10 * u, wy, { font: sans(wsize, 200), color: WH, align: 'center', alpha: wa, spacing: (PORTRAIT ? 18 : 26) * u });
    const ta = smooth(t, T.tagline, T.tagline + 0.2) * fadeEnd;
    text(scramble('OMNISCIENCE', t, T.tagline, 0.9, 8), W / 2, wy + 58 * u, { font: mono(20, 500), color: CY, align: 'center', alpha: ta, spacing: 16 * u });
    const oa = smooth(t, T.online, T.online + 0.15) * fadeEnd;
    if (oa > 0) {
      const y = wy + (PORTRAIT ? 130 : 112) * u;
      const blink = 0.5 + 0.5 * Math.sin((t - T.online) * 5);
      const label = scramble('ONLINE', t, T.online, 0.4);
      const w = measure('ONLINE', mono(15, 500), 6 * u);
      ctx.save();
      ctx.globalAlpha = oa * (0.4 + blink * 0.6);
      ctx.fillStyle = CY;
      ctx.beginPath();
      ctx.arc(W / 2 - w / 2 - 18 * u, y - 5 * u, 4.5 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      text(label, W / 2 + 4 * u, y, { font: mono(15, 500), color: CY, align: 'center', alpha: oa, spacing: 6 * u });
      text('PUBLIC SIGNALS · OPEN SOURCE · RUNS IN YOUR BROWSER', W / 2, y + 30 * u, { font: mono(10), color: FAINT, align: 'center', alpha: oa * smooth(t, T.online + 0.6, T.online + 1.2), spacing: 2.5 * u });
    }
    // sources, as the feeds came in
    const ca = smooth(t, T.tagline + 1.6, T.tagline + 2.4) * fadeEnd;
    if (ca > 0) {
      const credits = [
        'IMAGERY ESRI WORLD IMAGERY (ESRI, MAXAR, EARTHSTAR GEOGRAPHICS) · NASA GIBS BLACK MARBLE · VIIRS',
        'FEEDS OPENSKY · ADSB.LOL · ADSB.FI · KYSTVERKET · DIGITRAFFIC · CELESTRAK · USGS · NASA FIRMS · NOAA GFS',
        'TELEGEOGRAPHY · NATURAL EARTH · OURAIRPORTS · RADIO-BROWSER · WRI · PUBLIC TRAFFIC CAMERAS OF 18 AGENCIES',
      ];
      const fs = PORTRAIT ? 8.5 : 9;
      const lh = 15 * u;
      const y0 = H - M - 6 * u - (credits.length - 1) * lh;
      credits.forEach((c, i) => text(c, W / 2, y0 + i * lh, { font: mono(fs), color: 'rgba(150,205,220,0.62)', align: 'center', alpha: ca, spacing: (PORTRAIT ? 0.6 : 1.4) * u }));
    }
  }

  // ---------------------------------------------------------- v2: the eye opens
  const SENSORS = ['VIS', 'NIR', 'SWIR', 'MWIR', 'LWIR', 'SAR-X', 'SAR-C', 'RF', 'ADS-B', 'AIS', 'SEISMIC', 'GNSS-R', 'LIDAR', 'OPTICAL·CCTV'];
  function drawAwakening(S) {
    const t = S.t;
    if (t < T.seed || t > T.indexStart + 1.2) return;
    const fade = 1 - smooth(t, T.substrate + 0.2, T.indexStart + 1.0);
    const cx = S.center.x;
    const cy = S.center.y;
    const R = S.limbR;
    // iris aperture: seven blades retract from the seed to the limb
    const ak = easeInOut(ramp(t, T.aperture, T.growStart + 1.4));
    if (t < T.growStart + 2.2) {
      const ri = lerp(6 * u, R * 1.02, ak);
      const ro = R + 10 * u;
      const a = smooth(t, T.seed + 0.3, T.aperture) * (1 - smooth(t, T.growStart + 1.2, T.growStart + 2.2));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = CY;
      ctx.lineWidth = 1 * u;
      const rot = ak * 1.4 + t * 0.05;
      const N = 7;
      for (let i = 0; i < N; i++) {
        const a0 = rot + (i / N) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / N;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a0) * ri, Math.sin(a0) * ri);
        ctx.lineTo(Math.cos(a1) * ri, Math.sin(a1) * ri);
        // blade edge sweeping out to the ring
        ctx.moveTo(Math.cos(a0) * ri, Math.sin(a0) * ri);
        ctx.quadraticCurveTo(Math.cos(a0 + 0.5) * (ri + ro) * 0.55, Math.sin(a0 + 0.5) * (ri + ro) * 0.55, Math.cos(a0 + 0.9) * ro, Math.sin(a0 + 0.9) * ro);
        ctx.stroke();
      }
      // closed blades read as a dark iris
      ctx.globalAlpha = a * 0.5 * (1 - ak);
      ctx.fillStyle = 'rgba(0,30,40,0.6)';
      ctx.beginPath();
      ctx.arc(0, 0, ro, 0, Math.PI * 2);
      ctx.arc(0, 0, ri, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
      const fnum = lerp(22, 1.4, ak);
      text(`APERTURE f/${fnum < 2 ? fnum.toFixed(1) : Math.round(fnum)}`, cx, cy + R + 64 * u, { font: mono(11, 500), color: CY, align: 'center', alpha: a, spacing: 4 * u });
    }
    // radar sweep across the disc while the culture grows
    const sw = win(t, T.growStart, T.substrate + 0.8, 0.5, 0.8) * fade;
    if (sw > 0) {
      const ang = (t - T.growStart) * 2.4;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.clip();
      for (let i = 0; i < 24; i++) {
        const a0 = ang - i * 0.02;
        ctx.globalAlpha = sw * 0.12 * (1 - i / 24);
        ctx.fillStyle = CY;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, a0 - 0.02, a0);
        ctx.fill();
      }
      ctx.globalAlpha = sw * 0.7;
      ctx.strokeStyle = '#bff8ff';
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(ang) * R, Math.sin(ang) * R);
      ctx.stroke();
      ctx.restore();
    }
    // orbiting coordinate text ring
    const ta = win(t, T.dishDone - 0.2, T.indexStart + 1.0, 0.6, 0.6);
    if (ta > 0) {
      const str = ' 00°00′00″N 000°00′00″E · OBSERVER-1 · SUBSTRATE · CULTURE 001 · SENSORS ONLINE ·'.repeat(3);
      const rr = R + 52 * u;
      const n = Math.floor((Math.PI * 2 * rr) / (8.2 * u));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = mono(9);
      ctx.fillStyle = CY;
      ctx.textAlign = 'center';
      ctx.globalAlpha = ta * 0.55;
      const rot = -t * 0.06;
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        ctx.save();
        ctx.rotate(a);
        ctx.translate(0, -rr);
        ctx.fillText(str[i % str.length], 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
    // sensors waking, one band at a time
    const sa = win(t, T.growStart + 0.2, T.indexStart + 1.0, 0.3, 0.6);
    if (sa > 0) {
      const x0 = PORTRAIT ? M + 6 * u : W - M - 250 * u;
      const y0 = PORTRAIT ? H - M - 330 * u : H * 0.24;
      text('SENSOR ARRAY', x0, y0, { font: mono(11, 500), color: CY, alpha: sa, spacing: 3 * u });
      line(x0, y0 + 8 * u, x0 + 240 * u, y0 + 8 * u, CY, sa * 0.5);
      SENSORS.forEach((name, i) => {
        const st = T.growStart + 0.3 + i * ((T.growEnd - T.growStart - 0.6) / SENSORS.length);
        const k = t - st;
        if (k < 0) return;
        const y = y0 + (26 + i * 18) * u;
        const ra = sa * Math.min(1, k * 6);
        text(name, x0, y, { font: mono(10), color: WH, alpha: ra, spacing: 1.2 * u });
        const lvl = clamp(k / 0.8) * (0.55 + 0.45 * hash1(i * 7.3));
        ctx.save();
        ctx.globalAlpha = ra;
        ctx.fillStyle = 'rgba(0,246,255,0.18)';
        ctx.fillRect(x0 + 96 * u, y - 7 * u, 90 * u, 5 * u);
        ctx.fillStyle = CY;
        ctx.fillRect(x0 + 96 * u, y - 7 * u, 90 * u * lvl, 5 * u);
        ctx.restore();
        text(k < 0.8 ? 'SYNC' : 'LIVE', x0 + 240 * u, y, { font: mono(9, 500), color: k < 0.8 ? AMB : CY, alpha: ra, align: 'right', spacing: 1 * u });
      });
    }
    // optics calibration, converging
    const ca = win(t, T.seed + 0.6, T.indexStart + 1.0, 0.4, 0.6);
    if (ca > 0 && !PORTRAIT) {
      const x0 = M + 6 * u;
      const y0 = H * 0.24;
      text('CALIBRATING OPTICS', x0, y0, { font: mono(11, 500), color: CY, alpha: ca, spacing: 3 * u });
      line(x0, y0 + 8 * u, x0 + 240 * u, y0 + 8 * u, CY, ca * 0.5);
      const focus = 1 - Math.exp(-(t - T.seed) * 0.45);
      const rows = [['FOCUS', focus.toFixed(3)], ['EXPOSURE', `${(-6 + focus * 6.3).toFixed(2)} EV`], ['NOISE FLOOR', `${(-12 - focus * 30).toFixed(1)} dB`], ['DYNAMIC RANGE', `${(4 + focus * 16).toFixed(1)} STOPS`]];
      rows.forEach(([k, v], i) => {
        const y = y0 + (28 + i * 20) * u;
        text(k, x0, y, { font: mono(10), color: DIM, alpha: ca, spacing: 1.2 * u });
        text(v, x0 + 240 * u, y, { font: mono(10, 500), color: WH, alpha: ca, align: 'right', spacing: 1.2 * u });
      });
      // histogram settling
      const hy = y0 + 130 * u;
      ctx.save();
      ctx.globalAlpha = ca * 0.85;
      for (let i = 0; i < 48; i++) {
        const xx = i / 47;
        const target = Math.exp(-Math.pow((xx - 0.32) / 0.14, 2)) + 0.5 * Math.exp(-Math.pow((xx - 0.8) / 0.06, 2));
        const noise = hash1(i * 3.1 + Math.floor(t * 12)) * (1 - focus);
        const v = target * focus + noise * 0.8;
        ctx.fillStyle = i % 8 === 0 ? WH : CY;
        ctx.fillRect(x0 + i * 5 * u, hy - v * 46 * u, 3.2 * u, v * 46 * u);
      }
      ctx.restore();
      line(x0, hy + 2 * u, x0 + 240 * u, hy + 2 * u, CY, ca * 0.4);
    }
  }

  // ---------------------------------------------------------- v2: the flurry
  function drawFlurry(S) {
    const t = S.t;
    if (!flurry.length || t < T.flurry - 0.2 || t > T.indexed + 0.4) return;
    const fa = 1 - smooth(t, T.flurryEnd, T.indexed + 0.2);
    let shown = 0;
    const sz0 = (PORTRAIT ? 92 : 78) * u;
    for (const f of flurry) {
      if (f.t === undefined) continue;
      const k = t - f.t;
      if (k >= 0) shown++;
      const life = 0.42;
      if (k < 0 || k > life) continue;
      const p = S.project(f.lon, f.lat, 1.0);
      if (!p.vis || p.facing < 0.12) continue;
      const pop = easeOut(Math.min(1, k / 0.1));
      const a = fa * (1 - smooth(k, life * 0.6, life));
      const sz = sz0 * (0.55 + 0.45 * pop) * (0.6 + 0.4 * p.facing);
      const x = p.x - sz / 2;
      const y = p.y - sz - 10 * u;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.drawImage(f.img, x, y, sz, sz);
      const fl = Math.exp(-k * 18);
      if (fl > 0.02) {
        ctx.fillStyle = `rgba(230,255,255,${fl * 0.9})`;
        ctx.fillRect(x, y, sz, sz);
      }
      ctx.restore();
      brackets(x - 2 * u, y - 2 * u, sz + 4 * u, sz + 4 * u, 6 * u, CY, a * 0.9, 1);
      line(p.x, p.y, p.x, y + sz, CY, a * 0.5, 0.8);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = WH;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (sz > 56 * u && hash1(f.lat * 3.7) > 0.55) text((f.name || '').toUpperCase().slice(0, 18), x, y - 5 * u, { font: mono(8, 500), color: WH, alpha: a * 0.85, spacing: 0.8 * u });
    }
    // sweep readout
    const ra = win(t, T.flurry, T.indexed + 0.3, 0.2, 0.3);
    if (ra > 0) {
      const x = M + 6 * u;
      const y = (PORTRAIT ? H * 0.1 + 40 * u : H * 0.2) + 160 * u;
      const rate = Math.round(lerp(6, 64, ramp(t, T.flurry, T.flurryEnd - 1)));
      text('GLOBAL SWEEP', x, y, { font: mono(12, 500), color: CY, alpha: ra, spacing: 3 * u });
      text(`CAPTURES  ${fmt(heroes.length + shown)}`, x, y + 22 * u, { font: mono(13, 500), color: WH, alpha: ra, spacing: 1.5 * u });
      text(`RATE      ${rate} / S`, x, y + 42 * u, { font: mono(13), color: WH, alpha: ra, spacing: 1.5 * u });
    }
  }

  // ---------------------------------------------------------- v2: cities
  const CLS_COL = { person: '#ffd24a', car: CY, truck: '#ff8a3d', bus: '#ff8a3d', bicycle: '#7dffd6', motorcycle: '#7dffd6', 'traffic light': '#bfa8ff', 'stop sign': '#ff5b5b' };
  function detBoxes(det, x, y, w, h, alpha, t, labels = true) {
    if (!det || !det.length || alpha <= 0) return 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, 1.1 * u);
    let n = 0;
    for (const b of det) {
      const [x0, y0, x1, y1, conf, cls] = b;
      const col = CLS_COL[cls] || WH;
      const j = Math.sin(t * 9 + x0 * 40) * 0.6 * u;
      const bx = x + x0 * w + j;
      const by = y + y0 * h;
      const bw = (x1 - x0) * w;
      const bh = (y1 - y0) * h;
      if (bw < 2 || bh < 2) continue;
      ctx.strokeStyle = col;
      const c = Math.min(bw, bh) * 0.3;
      ctx.beginPath();
      ctx.moveTo(bx, by + c); ctx.lineTo(bx, by); ctx.lineTo(bx + c, by);
      ctx.moveTo(bx + bw - c, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + c);
      ctx.moveTo(bx + bw, by + bh - c); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw - c, by + bh);
      ctx.moveTo(bx + c, by + bh); ctx.lineTo(bx, by + bh); ctx.lineTo(bx, by + bh - c);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.12;
      ctx.fillStyle = col;
      ctx.fillRect(bx, by, bw, bh);
      ctx.globalAlpha = alpha;
      if (labels && bw > 18 * u) {
        ctx.font = mono(7, 500);
        ctx.fillStyle = col;
        ctx.fillText(`${cls.toUpperCase()} ${Math.round(conf * 100)}`, bx, by - 2 * u);
      }
      n++;
    }
    ctx.restore();
    return n;
  }

  function drawCity(S) {
    const C = S.city;
    if (!C) return;
    const t = S.t;
    const lt = C.lt;
    const dur = C.t1 - C.t0;
    const a = smooth(lt, 0.15, 0.6) * (1 - smooth(lt, dur - 0.25, dur));
    const B = C.built;
    const st = B.stats || {};
    // dark gutter behind the readouts
    ctx.save();
    ctx.globalAlpha = a * 0.8;
    const gg = PORTRAIT ? ctx.createLinearGradient(0, 0, 0, H * 0.42) : ctx.createLinearGradient(0, 0, W * 0.36, 0);
    gg.addColorStop(0, 'rgba(0,3,6,0.85)');
    gg.addColorStop(0.6, 'rgba(0,3,6,0.45)');
    gg.addColorStop(1, 'rgba(0,3,6,0)');
    ctx.fillStyle = gg;
    if (PORTRAIT) ctx.fillRect(0, 0, W, H * 0.42);
    else ctx.fillRect(0, 0, W * 0.36, H);
    ctx.restore();
    // acquisition plate on the cut
    const pa = win(lt, 0.0, 0.9, 0.05, 0.3);
    if (pa > 0) plate(`ACQUIRING ▸ ${C.name}`, W / 2, H * 0.5, { font: mono(15, 500), align: 'center', alpha: pa, spacing: 3, padX: 16, padY: 10 });
    // title block
    const x = M + 6 * u;
    const y = PORTRAIT ? M + 110 * u : H * 0.2;
    text(scramble(C.name, t, C.t0 + 0.2, 0.5, 3), x, y, { font: sans(PORTRAIT ? 40 : 34, 300), color: WH, alpha: a, spacing: 10 * u });
    text(C.sub, x, y + 28 * u, { font: mono(12), color: CY, alpha: a, spacing: 2 * u });
    text(`${fmtLat(C.lat, 4)} ${fmtLon(C.lon, 4)}`, x, y + 48 * u, { font: mono(11), color: DIM, alpha: a, spacing: 1.5 * u });
    const rows = [];
    if (st.buildings) rows.push(['BUILDINGS', fmt(st.buildings), 'OSM']);
    if (st.roads) rows.push(['ROAD SEGMENTS', fmt(st.roads), 'OSM']);
    if (st.roads) rows.push(['TRAFFIC', 'MODELED', 'OSM GRAPH']);
    if (st.cameras) rows.push(['STREET CAMERAS', fmt(st.cameras), 'NYC DOT']);
    if (st.aircraft) rows.push(['AIRCRAFT', fmt(st.aircraft), 'ADS-B']);
    if (st.helis) rows.push(['ROTORCRAFT', fmt(st.helis), 'ADS-B']);
    if (B.modeled?.length && C.slug === 'nyc') rows.push(['HELI CORRIDORS', fmt(B.modeled.length), 'MODELED']);
    if (st.routes) rows.push(['TRANSIT ROUTES', fmt(st.routes), 'MBTA GTFS']);
    if (st.vehicles) rows.push(['TRANSIT VEHICLES', fmt(st.vehicles), 'GTFS-RT']);
    if (B.runways) rows.push(['RUNWAYS', fmt(B.d.aeroway?.runways?.length || B.d.military?.runways?.length || 0), 'OSM']);
    if (B.milPolys) rows.push(['RESTRICTED AREAS', fmt(B.milPolys.length), 'OSM']);
    if (C.slug === 'bragg') rows.push(['AIRFIELD PATTERN', '3', 'MODELED']);
    if (B.d.peaks?.length) rows.push(['PEAKS', fmt(B.d.peaks.length), 'OSM']);
    if (B.d.elev) rows.push(['ELEVATION', `${fmt(B.d.elevMeta?.max || 8848)} M`, 'AWS TERRAIN']);
    rows.forEach(([k, v, src], i) => {
      const ry = y + (78 + i * 19) * u;
      const ra = a * smooth(lt, 0.35 + i * 0.12, 0.6 + i * 0.12);
      text(k, x, ry, { font: mono(10), color: DIM, alpha: ra, spacing: 1.2 * u });
      text(v, x + 170 * u, ry, { font: mono(11, 500), color: v === 'MODELED' ? AMB : WH, alpha: ra, spacing: 1.2 * u });
      text(src, x + 262 * u, ry, { font: mono(8), color: FAINT, alpha: ra, spacing: 1 * u });
    });
    // congestion legend
    if (st.roads && C.slug !== 'everest') {
      const lx = PORTRAIT ? M + 6 * u : M + 6 * u;
      const ly = H - M - 70 * u;
      const lw = 200 * u;
      ctx.save();
      ctx.globalAlpha = a;
      const g = ctx.createLinearGradient(lx, 0, lx + lw, 0);
      g.addColorStop(0, '#1aff73');
      g.addColorStop(0.5, '#ffcc1a');
      g.addColorStop(1, '#ff2a1f');
      ctx.fillStyle = g;
      ctx.fillRect(lx, ly, lw, 4 * u);
      ctx.restore();
      text('FREE FLOW', lx, ly - 7 * u, { font: mono(9), color: DIM, alpha: a, spacing: 1 * u });
      text('CONGESTED', lx + lw, ly - 7 * u, { font: mono(9), color: DIM, alpha: a, align: 'right', spacing: 1 * u });
      text('TRAFFIC · MODELED ON OSM ROAD GRAPH', lx, ly + 18 * u, { font: mono(8), color: FAINT, alpha: a, spacing: 1 * u });
    }
    // world-space labels
    const la = a * smooth(lt, 0.9, 1.4);
    if (la > 0) {
      if (B.d.peaks) {
        let n = 0;
        for (const pk of B.d.peaks.slice().sort((p, q) => q[2] - p[2])) {
          if (n >= 6) break;
          const z = B.elevAt ? B.elevAt(pk[0], pk[1]) : pk[2];
          const p = C.project(pk[0], pk[1], z + 60);
          if (!p.vis || p.x < M || p.x > W - M || p.y < M || p.y > H - M) continue;
          drawCallout(p.x, p.y, (pk[3] || '').toUpperCase(), `${fmt(pk[2])} M`, n % 2 ? -1 : 1, la);
          n++;
        }
      }
      if (B.d.air?.a) {
        let n = 0;
        for (const p of B.d.air.a.slice().sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]))) {
          if (n >= 4 || !p.now) break;
          const s = C.project(p.now[0], p.now[1], p.now[2]);
          if (!s.vis || s.x < M || s.x > W - M || s.y < M * 2 || s.y > H - M * 2) continue;
          const alt = Math.round((p[2] || 0) * 3.2808);
          drawCallout(s.x, s.y, `${(p[6] || 'UNKNOWN').trim()}${p[7] ? ' · ' + p[7] : ''}`, `${alt ? fmt(alt) + ' FT' : 'GROUND'} · ${Math.round((p[4] || 0) * 1.944)} KT`, n % 2 ? -1 : 1, la, p.heli ? '#7dffd6' : WH);
          n++;
        }
      }
      if (B.modeled?.length) {
        B.modeled.slice(0, 2).forEach((m, i) => {
          if (!m.now) return;
          const s = C.project(m.now[0], m.now[1], m.now[2]);
          if (!s.vis) return;
          drawCallout(s.x, s.y, m.name, `MODELED · ${fmt(m.now[2] * 3.28)} FT`, i % 2 ? 1 : -1, la * 0.9, m.color || '#7dffd6');
        });
      }
      if (B.milPolys) {
        const big = B.milPolys.slice().sort((p, q) => q.pts.length - p.pts.length)[0];
        if (big) {
          let cx = 0, cy = 0;
          big.pts.forEach((q) => { cx += q[0]; cy += q[1]; });
          const s = C.project(cx / big.pts.length, cy / big.pts.length, 400);
          if (s.vis) plate(`RESTRICTED · ${(big.name || 'MILITARY').toUpperCase().slice(0, 28)}`, s.x, s.y, { font: mono(10, 500), align: 'center', alpha: la * 0.9, spacing: 2, inverse: false, padX: 8, padY: 5 });
        }
      }
      if (B.labels?.length && C.slug === 'lax') {
        B.labels.filter((l) => l.kind === 'runway').slice(0, 4).forEach((l) => {
          const s = C.project(l.x, l.y, 5);
          if (s.vis) text(l.text, s.x, s.y - 6 * u, { font: mono(9, 500), color: WH, align: 'center', alpha: la * 0.8, spacing: 1.5 * u });
        });
      }
    }
    // NYC: street cameras opening onto real frames with detections
    if (C.slug === 'nyc' && nycCams.length) {
      const pw = (PORTRAIT ? 230 : 210) * u;
      const ph = pw * 9 / 16;
      const slots = PORTRAIT
        ? [[W - M - pw, H * 0.22], [W - M - pw, H * 0.22 + ph + 14 * u], [W - M - pw, H * 0.22 + 2 * (ph + 14 * u)]]
        : [[W - M - pw, H * 0.18], [W - M - pw, H * 0.18 + ph + 16 * u], [W - M - pw, H * 0.18 + 2 * (ph + 16 * u)], [W - M - pw, H * 0.18 + 3 * (ph + 16 * u)]];
      let total = 0;
      slots.forEach(([sx, sy], i) => {
        const c = nycCams[(i + Math.floor(lt / 2.2) * slots.length) % nycCams.length];
        const st0 = 2.2 + i * 0.35 + Math.floor(lt / 2.2) * 0;
        const k = lt - st0;
        if (k < 0) return;
        const { open, glow } = tvOn(k);
        const ca = a * Math.min(1, k * 5);
        const hh = ph * open;
        const yy = sy + (ph - hh) / 2;
        ctx.save();
        ctx.globalAlpha = ca;
        ctx.beginPath();
        ctx.rect(sx, yy, pw, Math.max(1, hh));
        ctx.clip();
        ctx.filter = 'saturate(0.6) contrast(1.15) brightness(0.9)';
        drawCover(c.img, sx, yy, pw, Math.max(1, hh));
        ctx.filter = 'none';
        ctx.restore();
        if (open > 0.95) total += detBoxes(c.det, sx, sy, pw, ph, ca * smooth(k, 0.35, 0.6), t);
        if (glow > 0.02) {
          ctx.save();
          ctx.globalAlpha = ca * glow;
          ctx.fillStyle = '#e8ffff';
          ctx.fillRect(sx, yy, pw, Math.max(2 * u, hh));
          ctx.restore();
        }
        brackets(sx - 3 * u, sy - 3 * u, pw + 6 * u, ph + 6 * u, 8 * u, CY, ca * 0.8, 1);
        text((c.name || '').toUpperCase().slice(0, 30), sx + 5 * u, sy + 12 * u, { font: mono(8, 500), color: WH, alpha: ca, spacing: 0.5 * u });
        text(`DOT ${c.id || ''} · ${new Date(snapT.getTime() + t * 1000).toISOString().slice(11, 19)}`, sx + 5 * u, sy + ph - 6 * u, { font: mono(7), color: WH, alpha: ca * 0.8 });
        // tether to the camera's beam on the street
        if (c.x !== undefined) {
          const p = C.project(c.x, c.y, 90);
          if (p.vis) line(p.x, p.y, sx, sy + ph / 2, CY, ca * 0.35, 0.8);
        }
      });
      // street pulse: detections per frame across the cameras
      const pa2 = a * smooth(lt, 2.8, 3.4);
      if (pa2 > 0) {
        const gx = PORTRAIT ? M + 6 * u : W - M - pw;
        const gy = PORTRAIT ? H - M - 150 * u : H * 0.18 + 4 * (ph + 16 * u) + 16 * u;
        const gw = PORTRAIT ? W - 2 * M - 12 * u : pw;
        cityPulse(gx, gy, gw, 34 * u, pa2, t, nycCams, 'STREET PULSE · OBJECTS / FRAME');
      }
    }
  }

  // an ECG-style trace built from real per-camera detection counts
  function cityPulse(x, y, w, h, alpha, t, pool, label) {
    const vals = pool.map((c) => (c.det ? c.det.length : 0));
    if (!vals.length) return;
    const N = 90;
    const scroll = t * 14;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = CY;
    ctx.lineWidth = 1.3 * u;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const s = i + scroll;
      const idx = Math.floor(s / 6) % vals.length;
      const v = vals[idx] / Math.max(1, Math.max(...vals));
      const ph = (s % 6) / 6;
      // a heartbeat-shaped spike per camera, height = its object count
      const spike = ph < 0.12 ? -0.25 * Math.sin((ph / 0.12) * Math.PI) : ph < 0.28 ? Math.sin(((ph - 0.12) / 0.16) * Math.PI) * v : ph < 0.4 ? -0.2 * Math.sin(((ph - 0.28) / 0.12) * Math.PI) * v : 0;
      const px = x + (i / N) * w;
      const py = y + h * 0.65 - spike * h * 0.8;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
    line(x, y + h * 0.65, x + w, y + h * 0.65, CY, alpha * 0.2, 0.8);
    text(label, x, y - 4 * u, { font: mono(8, 500), color: CY, alpha, spacing: 1.2 * u });
  }

  // ---------------------------------------------------------- frame
  function draw(S) {
    ctx = S.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    drawBoot(S);
    drawSeed(S);
    drawAwakening(S);
    drawDish(S);
    drawGrowth(S);
    drawIndexing(S);
    drawFlurry(S);
    drawCity(S);
    drawFeeds(S);
    drawCCTV(S);
    drawSaturation(S);
    drawChrome(S);
    drawTitle(S);
  }

  return { draw, eyeLayout, canvas };
}
