// Contact sheet: every live situation with its composited thumbnail.
// Open /mobile/globe/contact.html (optionally ?lat=&lon= for a viewer).
import { createGlobe } from './index.js';

const params = new URLSearchParams(location.search);
const status = document.getElementById('status');
const sheet = document.getElementById('sheet');
const globe = await createGlobe(document.getElementById('globe'), {
  layers: [],
  terrain: false,
});
window.globe = globe;
if (params.has('lat'))
  globe.setViewer({
    lat: Number(params.get('lat')),
    lon: Number(params.get('lon')),
  });

const t0 = performance.now();
const only = params.get('only');
const all = await globe.situations();
const list = only
  ? all.filter((s) => only.split(',').some((o) => s.id.startsWith(o)))
  : all;
const cw = Number(params.get('w') || 216);
const ch = Math.round((cw * 4) / 3);
document.documentElement.style.setProperty('--cw', `${cw}px`);
document.documentElement.style.setProperty('--ch', `${ch}px`);
window.situations = list;
status.textContent = `${list.length} situations in ${Math.round(performance.now() - t0)} ms · rendering thumbnails…`;
const t1 = performance.now();
let done = 0;
await Promise.all(
  list.map(async (s) => {
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    const tm = document.createElement('div');
    tm.className = 'tm';
    tm.textContent = s.telemetry || '';
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<b></b><small></small>`;
    cap.querySelector('b').textContent = s.title;
    cap.querySelector('small').textContent =
      `${s.band}/${s.archetype} · ${s.subtitle}`;
    fig.append(img, tm, cap);
    sheet.append(fig);
    try {
      img.src = await globe.thumbnail(s, { width: cw, height: ch, dpr: 2 });
    } catch (error) {
      cap.querySelector('small').className = 'err';
      cap.querySelector('small').textContent =
        `thumbnail failed: ${error.message}`;
    }
    done++;
  }),
);
status.textContent = `${list.length} situations · thumbnails in ${Math.round(performance.now() - t1)} ms · omitted: ${(globe.omitted?.() || []).map((o) => `${o.genre} (${o.reason})`).join('; ')}`;
console.log('timings', JSON.stringify(window.globe.timings?.()));
document.body.dataset.ready = '1';
