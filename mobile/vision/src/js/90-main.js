/* Boot, render loop, adaptive-DPR governor, cold open. */
const HASH = (() => { const o = {}; try { (location.hash || '').slice(1).split('&').forEach((kv) => { const [k, v] = kv.split('='); if (k) o[decodeURIComponent(k)] = v == null ? true : decodeURIComponent(v); }); } catch {} return o; })();
GE.HASH = HASH;
const gov = (GE.gov = { levels: [1, 0.85, 0.72, 0.6, 0.5], li: 0, scale: 1, ms: 16, w: 0, h: 0, acc: 0, n: 0, slow: 0, fast: 0, pinned: HASH.dpr ? parseFloat(HASH.dpr) : null });
let chain = null; const canvas = $('#gl');
function sizeCanvas() {
  const cw = canvas.clientWidth || innerWidth, chh = canvas.clientHeight || innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const s = gov.pinned || dpr * gov.levels[gov.li]; gov.scale = s;
  const w = Math.max(2, Math.round(cw * s)), hh = Math.max(2, Math.round(chh * s));
  if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  if (!chain || chain.w !== w || chain.h !== hh) { chain && chain.dispose(); chain = GL.chain(w, hh); }
  gov.w = w; gov.h = hh; return [cw, chh];
}
function governor(dt) {
  if (gov.pinned) return;
  gov.ms = lerp(gov.ms, dt * 1000, 0.08);
  if (gov.ms > 21) { gov.slow += dt; gov.fast = 0; } else if (gov.ms < 13.5) { gov.fast += dt; gov.slow = 0; } else { gov.slow = Math.max(0, gov.slow - dt); gov.fast = 0; }
  if (gov.slow > 2 && gov.li < gov.levels.length - 1) { gov.li++; gov.slow = 0; bus.emit('quality', { scale: gov.scale, fps: 1000 / gov.ms }); }
  if (gov.fast > 5 && gov.li > 0) { gov.li--; gov.fast = 0; }
  W.quality.steps = gov.li >= 3 ? 8 : 12;
}
function globeVisible() {
  if (APP.intro) return true;
  if (APP.isWide()) return true;
  if (APP.tab === 'globe' || APP.tab === 'capture' || APP.mode) return true;
  if (APP.tab === 'now') { const v = $('#v-now'); return v.scrollTop < v.querySelector('.now-hero')?.offsetHeight + 40; }
  return false;
}
let lastT = performance.now(), lastDyn = 0, lastSec = 0, running = true;
function frame(now) {
  if (!running) return;
  const dt = Math.min(0.25, Math.max(0.001, (now - lastT) / 1000)); lastT = now;
  W.simMs = Date.now() + W.offsetH * 3600000; W.t = (W.simMs - NOW) / 1000; W.sun = astro.sun(W.simMs);
  Cam.update(dt);
  if (APP.mode === 'situation' && !Cam.anim && GE.sheet.targetShift != null && !APP.isWide()) Cam.shiftY += (GE.sheet.targetShift - Cam.shiftY) * Math.min(1, dt * 7);
  if (globeVisible()) {
    const [cw, chh] = sizeCanvas();
    if (now - lastDyn > 40) { W.updateDynamic(); lastDyn = now; }
    const view = Cam.view(cw, chh); GE.mainView = view;
    const ov = GE.renderOverride || {};
    W.render(view, chain, null, { ...ov, focus: W.focus, extraSprites: W.activeExtras?.sprites, extraLines: W.activeExtras?.lines, fade: GE.introFade ?? 1 });
    APP.updateLabels(view); GE.ride.frame(view); GE.capture.frame(view);
  }
  if (APP.tab === 'globe' || APP.isWide() || APP.mode) GE.gui.ribbonFrame();
  if (APP.intro || !(Cam.anim || Cam.interacting || GE.thumbs._busyUntil > now)) GE.thumbs.step(APP.intro ? 14 : 8);
  if (now - lastSec > 1000) { lastSec = now; W.updateCounts(); GE.now.tick(); GE.sheet.tick(); GE.you.tick(); }
  governor(dt);
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) running = false; else if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(frame); } });

/* ---------- cold open ---------- */
function coldOpen() {
  const cold = $('#cold'); const app = $('#app');
  const skipAll = HASH.nointro || HASH.tab;
  const red = prefersReduced();
  W.sun = astro.sun(Date.now()); const finalCam = APP.heroCam();
  const end = () => {
    if (!APP.intro) return; APP.intro = false; GE.introFade = 1; W.setTime(null);
    cold.classList.add('out'); app.classList.remove('intro'); setTimeout(() => cold.remove(), 1100);
    Cam.cancel(); if (Cam.range > 2.2 && !APP.isWide()) Cam.flyTo(finalCam, { duration: 0.6 });
    Cam.autoSpin = 0.3; APP.updateChrome(); APP.moveLens();
    if (HASH.tab) APP.setTab(HASH.tab, { force: true });
  };
  APP.intro = true; app.classList.add('intro'); APP.updateChrome();
  if (skipAll) { Cam.set(finalCam); end(); return; }
  Cam.set({ lat: 8, lon: finalCam.lon + 75, range: 5.8, heading: 0, tilt: 0, shiftY: 0.0, shiftX: 0 });
  const T = (red ? 1.2 : 3.4) * (HASH.slow ? +HASH.slow : 1); const t0 = performance.now();
  GE.introFade = 0;
  if (!red) Cam.flyTo(finalCam, { duration: T });
  else Cam.set(finalCam);
  const tick = () => {
    if (!APP.intro) return; const u = clamp((performance.now() - t0) / 1000 / T, 0, 1);
    GE.introFade = ease.out(clamp(u * 2.2, 0, 1));
    if (!red) W.setTime(Date.now() - (1 - ease.outQuint(u)) * 9 * 3600000);
    if (u > 0.12) cold.classList.add('s1'); if (u > 0.36) cold.classList.add('s2');
    if (u >= 1) { setTimeout(end, red ? 200 : 500); return; } requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  $('#skip').addEventListener('click', (e) => { e.stopPropagation(); Cam.set(finalCam); end(); });
  cold.addEventListener('click', () => { Cam.set(finalCam); end(); });
}

/* ---------- boot ---------- */
async function boot() {
  const gl = GL.init(canvas);
  if (!gl) { document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:grid;place-items:center;color:#fff;font:15px system-ui;padding:24px;text-align:center;background:#05070B">This vision needs WebGL2. Try a recent browser on a phone, tablet or desktop.</div>'); return; }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; APP.toast('Graphics context lost — reopen to resume', 4000); });
  await W.loadTextures();
  W.buildStatic(); W.buildMovers(); W.updateCounts(); W.updateDynamic();
  W.situationPins = GE.SIT.list.map(GE.SIT.pin).filter(Boolean);
  APP.initShell(); GE.now.render(); GE.threads.render(); GE.you.render(); GE.gui.init(); GE.sheet.initDrag();
  Cam.attach(canvas, () => GE.mainView || Cam.view(canvas.clientWidth, canvas.clientHeight));
  sizeCanvas();
  coldOpen();
  requestAnimationFrame(frame);
  GE.threads.init().then(() => { if (!GE.threads.ws) GE.threads.render(); });
  GE.crypto.KEY.get().then(() => GE.you.render());
  if (HASH.open) setTimeout(() => GE.sheet.open(HASH.open, {}), 300);
  GE.ready = true;
}
boot().catch((e) => { console.error(e); });
