// Deterministic frame renderer: drives src/main.js frame by frame in headless
// Chromium and either writes stills or pipes straight into ffmpeg.
//
//   node tools/render.mjs --w 1920 --h 1080 --frames 480,900,1500 --out out/stills
//   node tools/render.mjs --w 1920 --h 1080 --from 0 --to 2160 --video out/video_16x9.mp4
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((s) => {
      const [k, ...v] = s.trim().split(' ');
      return [k, v.join(' ') || true];
    }),
);
const W = +args.w || 1920;
const H = +args.h || 1080;
const URL = `http://127.0.0.1:${args.port || 8765}/index.html?w=${W}&h=${H}`;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--js-flags=--max-old-space-size=8192'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  const t = m.text();
  if (/error|warn|missing|\[gev\]/i.test(t)) console.log('  page:', t.slice(0, 300));
});
page.on('pageerror', (e) => console.log('  PAGE ERROR:', e.message));
await page.goto(URL);
await page.waitForFunction(() => window.__status === 'ready' || String(window.__status).startsWith('error'), null, { timeout: 600000, polling: 500 });
const st = await page.evaluate(() => window.__status);
if (st !== 'ready') {
  console.error('init failed:', st);
  process.exit(1);
}
const info = await page.evaluate(() => ({ counts: GEV.counts, heroes: GEV.heroes, cams: GEV.cams, frames: GEV.frames }));
console.log('ready', JSON.stringify(info));

const cdp = await page.context().newCDPSession(page);
async function grab(format = 'png') {
  const r = await cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? 96 : undefined, fromSurface: true, captureBeyondViewport: false });
  return Buffer.from(r.data, 'base64');
}

let frames = [];
if (args.frames) frames = String(args.frames).split(',').map((x) => (x.includes('s') ? Math.round(parseFloat(x) * 30) : +x));
else {
  const from = +(args.from || 0);
  const to = +(args.to || info.frames);
  const step = +(args.step || 1);
  for (let f = from; f < to; f += step) frames.push(f);
}

let ff = null;
if (args.video) {
  fs.mkdirSync(path.dirname(args.video), { recursive: true });
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', args.preset || 'slow', '-crf', String(args.crf || 14), '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', args.video], { stdio: ['pipe', 'inherit', 'inherit'] });
} else {
  fs.mkdirSync(args.out || 'out/stills', { recursive: true });
}

const t0 = Date.now();
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  await page.evaluate((fr) => window.GEV.renderFrame(fr), f);
  const buf = await grab('png');
  if (ff) {
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  } else {
    fs.writeFileSync(path.join(args.out || 'out/stills', `${args.prefix || 'f'}_${String(f).padStart(5, '0')}.png`), buf);
  }
  if (i % 30 === 0 || i === frames.length - 1) {
    const el = (Date.now() - t0) / 1000;
    const per = el / (i + 1);
    console.log(`frame ${f} (${i + 1}/${frames.length}) ${per.toFixed(2)} s/frame, eta ${((frames.length - i - 1) * per / 60).toFixed(1)} min`);
  }
}
if (ff) {
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
}
await browser.close();
console.log('done in', ((Date.now() - t0) / 60000).toFixed(1), 'min');
