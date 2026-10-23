#!/usr/bin/env node
/**
 * Regenerates the bundled first-frame snapshot (DESIGN.md §12.8):
 *
 *   mobile/demo/snapshot.json   the live situations() result, with capturedAt
 *   mobile/demo/thumbs/<id>.jpg each card's composited thumbnail
 *
 * It drives the real engine in headless Chromium against a running dev
 * server, so every card is real data at capture time.
 *
 *   npm run dev            # or: npx vite --port 4173
 *   node mobile/demo/capture-snapshot.mjs [--base http://localhost:4173]
 *        [--chrome /path/to/chrome] [--max 28] [--quality 0.8]
 *        [--lat 40.75 --lon -73.98]   # a viewer position for distances
 *
 * Budget: thumbnails are 360×480 CSS px at 1.25× and JPEG-recompressed so
 * the whole folder stays under ~3 MB.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, '..', '..', 'package.json'));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((kv) => {
      const [k, ...v] = kv.trim().split(/\s+/);
      return [k, v.join(' ') || true];
    }),
);
const BASE = args.base || 'http://localhost:4173';
const MAX = Number(args.max || 28);
const QUALITY = Number(args.quality || 0.8);
const BUDGET = 3 * 1024 * 1024;

const puppeteer = (await import(require.resolve('puppeteer'))).default;
const browser = await puppeteer.launch({
  executablePath: args.chrome || process.env.CHROME_PATH || undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
  protocolTimeout: 600_000,
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.warn('[page]', e.message));
  await page.goto(`${BASE}/mobile/globe/dev.html?hud=0&labels=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await page.waitForFunction('window.globe', { timeout: 120_000 });
  console.log('engine up; building live situations (this takes ~30–60 s)…');
  const viewer =
    args.lat && args.lon
      ? { lat: Number(args.lat), lon: Number(args.lon) }
      : null;
  const result = await page.evaluate(
    async ({ max, quality, viewer }) => {
      if (viewer) globe.setViewer(viewer);
      // Warm the recorder a little so detections have a chance to show.
      const list = (await globe.situations()).slice(0, max);
      const out = [];
      for (const s of list) {
        let thumb = null;
        try {
          const url = await globe.thumbnail(s, {
            width: 360,
            height: 480,
            dpr: 1.25,
          });
          const img = await createImageBitmap(await (await fetch(url)).blob());
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          c.getContext('2d').drawImage(img, 0, 0);
          const blob = await new Promise((r) =>
            c.toBlob(r, 'image/jpeg', quality),
          );
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000)
            bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          thumb = btoa(bin);
        } catch (error) {
          console.warn('thumbnail failed', s.id, error?.message);
        }
        out.push({ situation: JSON.parse(JSON.stringify(s)), thumb });
      }
      return out;
    },
    { max: MAX, quality: QUALITY, viewer },
  );
  const thumbsDir = path.join(HERE, 'thumbs');
  await mkdir(thumbsDir, { recursive: true });
  for (const f of await readdir(thumbsDir))
    if (f.endsWith('.jpg')) await rm(path.join(thumbsDir, f));
  let bytes = 0;
  const situations = [];
  for (const { situation, thumb } of result) {
    const file = `${String(situation.id).replace(/[^\w.-]+/g, '_')}.jpg`;
    if (thumb) {
      const buf = Buffer.from(thumb, 'base64');
      if (bytes + buf.length > BUDGET) {
        console.warn(`budget reached; ${situation.id} ships without a thumb`);
      } else {
        bytes += buf.length;
        await writeFile(path.join(thumbsDir, file), buf);
        situation.thumbFile = `thumbs/${file}`;
      }
    }
    situations.push(situation);
  }
  const snapshot = {
    capturedAt: new Date().toISOString(),
    source:
      'Live God’s Eye feeds through the dev server (see each card’s source)',
    note: 'Bundled first frame for demos. The shell shows capturedAt and replaces these with live cards as soon as situations() resolves.',
    situations,
  };
  let text = JSON.stringify(snapshot);
  try {
    const prettier = await import('prettier');
    text = await prettier.format(text, { parser: 'json' });
  } catch {
    text += '\n';
  }
  await writeFile(path.join(HERE, 'snapshot.json'), text);
  console.log(
    `wrote ${situations.length} situations, ${Math.round(bytes / 1024)} KB of thumbnails`,
  );
} finally {
  await browser.close();
}
