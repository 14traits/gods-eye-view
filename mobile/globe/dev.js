// Dev harness: mounts the globe full-screen and exposes it as window.globe.
// Query: ?quality=auto|low|high&lens=cinematic&layers=flights,iss&hud=0
import { createGlobe } from './index.js';

const params = new URLSearchParams(location.search);
const hud = document.getElementById('hud');
const showHud = params.get('hud') !== '0';

const globe = await createGlobe(document.getElementById('globe'), {
  quality: params.get('quality') || 'auto',
  lens: params.get('lens') || 'cinematic',
  layers: params.get('layers')?.split(',').filter(Boolean),
  preserveDrawingBuffer: params.has('capture'),
});
window.globe = globe;

let quality = globe.quality();
let lastPick = null;
const render = () => {
  if (!showHud) return;
  const on = globe
    .layers()
    .filter((l) => l.on)
    .map((l) => `${l.id} ${l.count} ${l.status}`)
    .join('\n');
  hud.textContent = [
    `scale ${quality.scale} · ${quality.fps} fps · bloom ${quality.bloom ? 'on' : 'off'}`,
    on,
    lastPick ? `▸ ${lastPick.title} — ${lastPick.subtitle}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};
globe.on('quality', (q) => {
  quality = q;
  render();
});
globe.on('layers', render);
globe.on('pick', (p) => {
  lastPick = p;
  render();
});
render();

// HTML labels (§5): at most 40, refreshed with the camera and once a second.
const labelLayer = document.getElementById('labels');
const drawLabels = () => {
  labelLayer.replaceChildren(
    ...globe.labels(40).map((l) => {
      const el = document.createElement('span');
      el.textContent = l.title;
      el.style.left = `${l.x}px`;
      el.style.top = `${l.y}px`;
      return el;
    }),
  );
};
if (params.get('labels') !== '0') {
  globe.on('camera', drawLabels);
  setInterval(drawLabels, 1000);
}
