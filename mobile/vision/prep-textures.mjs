// One-time texture prep: NASA public-domain sources -> small WebP files in ./assets.
// Usage: node mobile/vision/prep-textures.mjs <dir-with-downloads>
// Sources (public domain, NASA): Blue Marble NG (cloudless day), Black Marble 2016 (night lights,
// https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg),
// Blue Marble clouds, land/water mask and topography (three-globe@2.31.0 example images).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) { console.error('usage: node prep-textures.mjs <download-dir>'); process.exit(1); }
const out = (f) => path.join(here, 'assets', f);
const jobs = [
  ['earth-blue-marble.jpg', 'day.webp', (s) => s.resize(4096, 2048).webp({ quality: 84, smartSubsample: true, effort: 6 })],
  ['BlackMarble_2016_3km.jpg', 'night.webp', (s) => s.resize(4096, 2048, { kernel: 'lanczos3' }).webp({ quality: 80, smartSubsample: true, effort: 6 })],
  ['clouds.png', 'clouds.webp', (s) => s.resize(2048, 1024).extractChannel('alpha').webp({ quality: 66, effort: 6 })],
  ['earth-water.png', 'water.webp', (s) => s.resize(2048, 1024).greyscale().webp({ quality: 60, effort: 6 })],
  ['earth-topology.png', 'topo.webp', (s) => s.resize(2048, 1024).greyscale().webp({ quality: 74, effort: 6 })],
];
for (const [i, o, fn] of jobs) {
  const info = await fn(sharp(path.join(src, i))).toFile(out(o));
  console.log(o, info.width + 'x' + info.height, (info.size / 1024).toFixed(0) + ' KB');
}
