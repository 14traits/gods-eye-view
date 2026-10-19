// Export the film clock for the score: every visual event the audio locks to.
import fs from 'node:fs';
import { T, FEEDS, CITIES, DURATION, captureTimes, CAPTURE_SLOW } from '../src/timeline.js';
import { angDist } from '../src/geo.js';

const heroes = JSON.parse(fs.readFileSync('imagery/hero/index.json', 'utf8'));
const caps = captureTimes(heroes.length).map((t, i) => ({ t, slow: i < CAPTURE_SLOW, lon: heroes[i].lon }));

// tile reveal times — same formula as the globe shader and HUD
const f = (v) => v - Math.floor(v);
const hash3 = (x, y, z) => {
  const px = f(x * 0.3183099 + 0.71) * 17, py = f(y * 0.3183099 + 0.113) * 17, pz = f(z * 0.3183099 + 0.419) * 17;
  return f(px * py * pz * (px + py + pz));
};
const tiles = [];
[[3, T.zWave[0], 0.35], [4, T.zWave[1], 0.3], [5, T.zWave[2], 0.25]].forEach(([z, wave, jit]) => {
  const n = 2 ** z;
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++) {
      const lon = ((x + 0.5) / n) * 360 - 180;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ((y + 0.5) / n)))) * 180) / Math.PI;
      // only the hemisphere facing the camera is heard
      const d = angDist(0, 0, lon, lat);
      tiles.push({ t: wave + (d / Math.PI) * 2.6 + hash3(x, y, z) * jit, z, pan: Math.max(-1, Math.min(1, lon / 90)), vis: angDist(10, 8, lon, lat) < 1.4 });
    }
});

// boot console keystrokes
const boot = [];
[['GEV://OBSERVER-1  rev 0.2.1', T.boot, 55], ['allocating substrate ........ 1.0000  OK', T.boot + 0.75, 55], ['loading priors .............. NONE', T.boot + 1.35, 55], ['> seed --origin 0.0000°N 0.0000°E', T.boot + 2.1, 26]].forEach(([s, st, cps], line) => {
  for (let i = 0; i < s.length; i++) {
    const t = st + i / cps;
    if (t < T.collapse) boot.push({ t, ch: s[i], line });
  }
});

const status = [77.4, 78.5, 79.6, 80.7, 81.7];
const rapid = Array.from({ length: 7 }, (_, i) => T.rapid + i * 0.22);
fs.writeFileSync('audio/cues.json', JSON.stringify({ T, DURATION, feeds: FEEDS.map((x) => ({ key: x.key, t: x.t })), cities: CITIES.map((c) => ({ slug: c.slug, t0: c.t0, t1: c.t1 })), caps, tiles, boot, status, rapid }, null, 1));
console.log('cues:', caps.length, 'captures,', tiles.length, 'tiles,', boot.length, 'keystrokes');
