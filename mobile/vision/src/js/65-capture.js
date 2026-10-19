/* Capture: Look (AR — the God's-eye view projected around you on a rendered "camera" scene with
   aircraft/satellite callouts, compass tape, horizon; drag to look) and Witness (shutter → sealed
   bundle: real SHA-256 over the rendered frame, real ECDSA P-256 via WebCrypto, simulated IMU/GPS,
   hash chain, gold seal; then drop it as a hologram here). */
const CAP = (GE.capture = { mode: 'look', yaw: 0, pitch: 0.06, zoom: 1, on: false });
GE.captures = [];
const SPOT = { lat: 41.8662, lon: -87.6072, alt: 0.042, name: 'Chicago lakefront', hdg: -52 * D2R };
CAP.spot = SPOT;

/* ---------- device key (non-extractable, IndexedDB when available) ---------- */
const KEY = { pair: null, jwk: null, ready: null };
function idb() { return new Promise((res, rej) => { try { const r = indexedDB.open('ge-vision', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }); }
KEY.get = function () {
  if (KEY.ready) return KEY.ready;
  KEY.ready = (async () => {
    if (!hasSubtle()) return null;
    try { const db = await idb(); const got = await new Promise((res) => { const tx = db.transaction('keys', 'readonly'); const rq = tx.objectStore('keys').get('device'); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); }); if (got && got.privateKey) { KEY.pair = got; } } catch {}
    if (!KEY.pair) {
      try {
        KEY.pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('keys', 'readwrite'); tx.objectStore('keys').put(KEY.pair, 'device'); tx.oncomplete = res; tx.onerror = res; }); } catch {}
      } catch (e) { console.warn('keygen', e); return null; }
    }
    try { KEY.jwk = await crypto.subtle.exportKey('jwk', KEY.pair.publicKey); } catch {}
    return KEY.pair;
  })();
  return KEY.ready;
};
const hexToBytes = (hx) => new Uint8Array(hx.match(/../g).map((b) => parseInt(b, 16)));
async function signHex(hashHex) { const k = await KEY.get(); if (!k) return null; const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, hexToBytes(hashHex)); return fmt.hex(sig); }
async function verifyHex(hashHex, sigHex) { const k = await KEY.get(); if (!k || !sigHex) return false; try { return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, hexToBytes(sigHex), hexToBytes(hashHex)); } catch { return false; } }
GE.crypto = { KEY, signHex, verifyHex };

/* ---------- simulated golden hour at the spot ---------- */
CAP.goldenMs = function () {
  const base = Date.now(); let best = base, bd = 1e9;
  for (let m = -24 * 60; m <= 24 * 60; m += 4) { const ms = base + m * 60000; const e = astro.elev(ms, SPOT.lat, SPOT.lon); const e2 = astro.elev(ms + 60000, SPOT.lat, SPOT.lon); if (e2 < e) { const d = Math.abs(e - 3.2); if (d < bd) { bd = d; best = ms; } } }
  return best;
};

/* ---------- enter / exit ---------- */
CAP.enter = function () {
  CAP.on = true; CAP.ms = CAP.goldenMs(); CAP.t = (CAP.ms - NOW) / 1000; CAP.sun = astro.sun(CAP.ms);
  // face the sunset over the skyline
  const sunAz = geo.bearing(SPOT.lat, SPOT.lon, CAP.sun.lat, CAP.sun.lon);
  CAP.yaw = 0; SPOT.hdg = sunAz * 0.35 + (-52 * D2R) * 0.65;
  GE.renderOverride = { t: CAP.t, sun: CAP.sun, simMs: CAP.ms, offsetH: (CAP.ms - Date.now()) / 3600000, exposure: 1.25, cloudK: 0.5 };
  Cam.setRig({ blendTime: 0.01, pose: () => Cam.pose(SPOT.lat, SPOT.lon, SPOT.alt, SPOT.hdg + CAP.yaw, CAP.pitch, 0, 62 * D2R / CAP.zoom), look(dx, dy) { CAP.yaw -= dx * 0.0042 / CAP.zoom; CAP.pitch = clamp(CAP.pitch - dy * 0.0035 / CAP.zoom, -0.5, 1.2); }, zoom(r) { CAP.zoom = clamp(CAP.zoom / r, 0.6, 4); CAP.syncZoom(); } });
  Cam.rigBlend = 1;
  GE.scenes.ensure(GE.scenes.byId.chi);
  CAP.render();
  KEY.get();
};
CAP.exit = function () { if (!CAP.on) return; CAP.on = false; CAP.cover = false; GE.renderOverride = null; Cam.setRig(null); Cam.rigBlend = 1; $('#sealOv').classList.remove('on'); };
CAP.MODES = [['look', 'Look'], ['witness', 'Witness'], ['live', 'Live'], ['upload', 'Upload']];
CAP.setMode = function (m) { if (CAP.mode === 'live' && m !== 'live' && CAP.live?.on) { APP.toast(`${ic('live', 'sm')} End the broadcast first`); return; } CAP.mode = m; if (CAP.on) CAP.render(); };
CAP.render = function () {
  const el = $('#v-capture'); const last = GE.captures[GE.captures.length - 1]; const m = CAP.mode;
  const rt = CAP.replyTo && GE.SIT.byId[CAP.replyTo.sit];
  CAP.cover = m === 'live';
  el.innerHTML = `<canvas class="livecv ${m === 'live' ? 'on' : ''}" id="liveCv"></canvas><div class="cap-ui m-${m}">
    <svg class="compass-tape" id="ctape"></svg>
    <div class="callouts" id="callouts"></div>
    <div class="cap-top"><span class="st glass">${ic('location', 'xs')}<span>Simulated camera · ${SPOT.name}</span></span><span class="st glass" id="capMode">${{ look: `${ic('eye', 'xs')}Look · AR`, witness: `${ic('key', 'xs')}Witness · signing`, live: `${ic('live', 'xs')}Live · sealed every 10 s`, upload: `${ic('gallery', 'xs')}Upload · unverified` }[m]}</span></div>
    ${rt ? `<div class="replyto glass">${ic('threads', 'xs')}<span>Replying in <b>${esc(rt.short || rt.title.split(' — ')[0])}</b></span><button id="rtX" aria-label="Cancel reply">${ic('x', 'xs')}</button></div>` : ''}
    <div class="sensors glass ${m === 'witness' ? 'on' : ''}" id="sensors"></div>
    <div id="modeHost"></div>
    <div class="cap-bottom">
      ${m === 'look' || m === 'witness' ? `<div class="zooms glass">${[0.5, 1, 3].map((z) => `<button data-z="${z}" class="${CAP.zoom === z ? 'on' : ''}">${z === 0.5 ? '.5' : z}×</button>`).join('')}</div>` : ''}
      <div class="dial" id="dial">${CAP.MODES.map(([k, l]) => `<button data-m="${k}" class="${m === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="shutrow"><button class="lastcap" id="lastcap" aria-label="Last capture" style="${last ? `background-image:url(${last.thumb})` : ''}">${last ? '<svg class="seal"><use href="#i-seal"/></svg>' : ''}</button>
        <button class="shutter s-${m} ${CAP.live?.on ? 'rec' : ''}" id="shutter" aria-label="${{ look: 'Switch to Witness', witness: 'Capture and sign', live: CAP.live?.on ? 'End broadcast' : 'Go live', upload: 'Choose a file' }[m]}"><i></i></button>
        <button class="circ glass" id="capFlip" aria-label="${m === 'live' ? 'See yourself on the globe' : 'Layers in view'}">${ic(m === 'live' ? 'globe' : 'layers')}</button></div>
    </div></div>`;
  el.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => { CAP.zoom = +b.dataset.z; CAP.syncZoom(); haptic(4); }));
  el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { CAP.setMode(b.dataset.m); haptic(6); }));
  $('#rtX')?.addEventListener('click', () => { CAP.replyTo = null; CAP.render(); });
  $('#shutter').addEventListener('click', () => { if (m === 'look') { CAP.setMode('witness'); return; } if (m === 'witness') CAP.shoot(); if (m === 'live') (CAP.live?.on ? GE.live.stop() : GE.live.start()); if (m === 'upload') $('#upFile')?.click(); });
  $('#lastcap').addEventListener('click', () => { if (GE.captures.length) GE.you.inspect(GE.captures.length - 1); });
  $('#capFlip').addEventListener('click', () => { if (m === 'live') GE.live.showOnGlobe(); else APP.toast(`${ic('layers', 'sm')} Showing Sky + Orbit in view`); });
  if (m === 'live') GE.live.renderUI($('#modeHost'));
  if (m === 'upload') GE.upload.renderUI($('#modeHost'));
};
CAP.syncZoom = () => $$('#v-capture [data-z]').forEach((x) => x.classList.toggle('on', +x.dataset.z === CAP.zoom));

/* ---------- per-frame AR overlay ---------- */
CAP.frame = function (view) {
  if (!CAP.on) return;
  if (CAP.mode === 'live' || CAP.mode === 'upload') { GE.live.frame(); return; }
  const W = GE.world; const t = CAP.t + (performance.now() / 1000 - (CAP._t0 || (CAP._t0 = performance.now() / 1000)));
  const host = $('#callouts'); if (!host) return;
  // compass tape
  const svg = $('#ctape'); const w = svg.clientWidth; const hdg = (((SPOT.hdg + CAP.yaw) * R2D) % 360 + 360) % 360;
  const pxPerDeg = w / (view.fovY * R2D * view.aspect);
  let g = `<g font-family="var(--font)" font-size="11" text-anchor="middle" fill="rgba(255,255,255,.85)" stroke="rgba(255,255,255,.55)">`;
  for (let d = Math.floor((hdg - 60) / 5) * 5; d <= hdg + 60; d += 5) { const x = w / 2 + (d - hdg) * pxPerDeg; if (x < -10 || x > w + 10) continue; const dd = ((d % 360) + 360) % 360; g += `<line x1="${x}" x2="${x}" y1="2" y2="${dd % 15 === 0 ? 11 : 6}"/>`; if (dd % 15 === 0) g += `<text x="${x}" y="25" stroke="none" font-weight="${dd % 90 === 0 ? 800 : 500}" fill="${dd === 0 ? '#FF6A3D' : 'rgba(255,255,255,.8)'}">${{ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] ?? dd}</text>`; }
  g += `<path d="M${w / 2 - 5} 0 L${w / 2 + 5} 0 L${w / 2} 6Z" fill="#FFD60A" stroke="none"/><text x="${w / 2}" y="38" font-size="10" stroke="none" fill="rgba(255,255,255,.6)">${Math.round(hdg)}° · pitch ${Math.round(CAP.pitch * R2D)}°</text></g>`;
  svg.innerHTML = g;
  // contacts
  const want = [];
  const sun = CAP.sun;
  for (let i = 0; i < GE.FLIGHTS.length; i++) {
    const f = GE.FLIGHTS[i]; const p = GE.flightAt(f, CAP.t); if (!p) continue;
    const dkm = geo.dist(SPOT.lat, SPOT.lon, p.lat, p.lon) * EARTH_KM; if (dkm > 110) continue;
    const v = v3.scale(p.v, 1 + p.altKm / EARTH_KM); want.push({ k: 'f' + i, v, c: 'var(--sky)', i: 'airplane', t: f.cs, s: `${f.type} · ${fmt.n(Math.round(p.altKm * 3281 / 100) * 100)} ft · ${dkm.toFixed(0)} km`, d: dkm });
  }
  const obs = geo.vec(SPOT.lat, SPOT.lon); const up = v3.norm(obs);
  if (!CAP._sats || Math.abs(CAP._satT - CAP.t) > 20) {
    CAP._sats = []; CAP._satT = CAP.t;
    for (let i = 0; i < GE.SATS.length; i += 3) { const s = GE.SATS[i]; if (s.kind > 1 && s.kind !== 6 && s.kind !== 5) continue; const p = GE.satAt(s, CAP.t, sun.gmst); const d = v3.sub(p, obs); const el = Math.asin(v3.dot(v3.norm(d), up)) * R2D; if (el > 12) CAP._sats.push({ s, el, km: v3.len(d) * EARTH_KM }); }
    CAP._sats.sort((a, b) => a.km - b.km); CAP._sats = CAP._sats.slice(0, 3);
  }
  for (const o of CAP._sats) { const p = GE.satAt(o.s, CAP.t, sun.gmst); want.push({ k: 's' + o.s.name, v: p, c: 'var(--orbit)', i: 'satellite', t: o.s.name, s: `${Math.round(o.s.alt)} km up · ${Math.round(o.el)}° elev`, d: o.km }); }
  const seen = new Set(); let n = 0; const used = [];
  for (const it of want.sort((a, b) => a.d - b.d)) {
    const s = W.project(view, it.v); let el = host.querySelector(`[data-k="${it.k}"]`);
    const onScreen = s && s.x > 8 && s.x < view.w - 8 && s.y > 60 && s.y < view.h - 230;
    if (!onScreen || n >= 7) { if (el) el.remove(); continue; }
    n++; seen.add(it.k);
    if (!el) { el = h('div', { 'data-k': it.k }); el.innerHTML = `<div class="reticle" style="--c:${it.c}"></div><div class="callout glass" style="--c:${it.c}"><span class="ci">${ic(it.i, 'sm')}</span><span><b>${esc(it.t)}</b><span data-s></span></span></div>`; host.append(el); }
    el.querySelector('[data-s]').textContent = it.s;
    el.querySelector('.reticle').style.transform = `translate(${s.x}px, ${s.y}px)`;
    let cy = s.y; for (const u of used) if (Math.abs(u - cy) < 44) cy = u + 44; used.push(cy);
    const flip = s.x > view.w - 210; el.querySelector('.callout').style.transform = flip ? `translate(${s.x - 24}px, ${cy}px) translate(-100%, -50%)` : `translate(${s.x + 24}px, ${cy}px) translate(0, -50%)`;
  }
  host.querySelectorAll('[data-k]').forEach((e) => { if (!seen.has(e.dataset.k)) e.remove(); });
  // witness sensors
  if (CAP.mode === 'witness') {
    const ss = $('#sensors'); const tt = performance.now() / 1000;
    const imu = Array.from({ length: 40 }, (_, i) => Math.sin((tt * 3 + i * 0.4)) * 0.4 + Math.sin(tt * 7.3 + i) * 0.15);
    ss.innerHTML = `<div style="display:flex;justify-content:space-between"><span>IMU 50 Hz</span><b>${(imu[39] * 0.12).toFixed(3)} g</b></div><svg viewBox="0 0 140 26">${GE.sparkPath(imu, 140, 26, '#5CF2A0', 1.3)}</svg><div style="display:flex;justify-content:space-between"><span>GPS</span><b>±4 m · ${SPOT.lat.toFixed(5)}, ${SPOT.lon.toFixed(5)}</b></div><div style="display:flex;justify-content:space-between"><span>Heading</span><b>${Math.round(hdg)}° true</b></div><div style="display:flex;justify-content:space-between;gap:10px"><span>Key</span><b>P-256 · ${KEY.pair ? 'device-bound' : '…'}</b></div>`;
  }
};

/* ---------- shoot & seal ---------- */
CAP.shoot = async function () {
  if (CAP.busy) return; CAP.busy = true; haptic([5, 20, 30]);
  const flash = h('div', { style: { position: 'absolute', inset: 0, background: '#fff', zIndex: 72, opacity: 1, transition: 'opacity .45s ease' } }); $('#app').append(flash); requestAnimationFrame(() => (flash.style.opacity = 0)); setTimeout(() => flash.remove(), 500);
  const start = Date.now();
  // render the frame offscreen at 1200×900
  const W0 = 1200, H0 = 900; const view = Cam.view(W0, H0);
  const cv = GE.thumbs.renderView(view, W0, H0, { ...GE.renderOverride, px: 1.6 });
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const thumb = (() => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; c.getContext('2d').drawImage(cv, 0, 0, 320, 240); return c.toDataURL('image/jpeg', 0.8); })();
  const hdgDeg = Math.round((((SPOT.hdg + CAP.yaw) * R2D) % 360 + 360) % 360);
  const imu = Array.from({ length: 150 }, (_, i) => ({ t: i * 20, a: +(hdgDeg + Math.sin(i / 9) * 0.6).toFixed(2), b: +(CAP.pitch * R2D + Math.sin(i / 7) * 0.3).toFixed(2), g: +(Math.sin(i / 5) * 0.4).toFixed(2), ax: +(Math.sin(i / 3) * 0.02).toFixed(3), ay: +(9.806 + Math.sin(i / 4) * 0.03).toFixed(3), az: +(Math.cos(i / 3) * 0.02).toFixed(3) }));
  const session = { start, end: start + 3000, imu, gps: [0, 1, 2].map((k) => ({ t: start + k * 1000, lat: +(SPOT.lat + k * 1e-6).toFixed(6), lon: +SPOT.lon.toFixed(6), acc: 4, alt: 182 })), heading: hdgDeg };
  const context = { device: 'Simulated camera (concept)', ua: navigator.userAgent.slice(0, 64), screen: `${screen.width}x${screen.height}@${Math.round((devicePixelRatio || 1) * 100) / 100}`, timezone: GE.ME.tz, networkTimeOffsetMs: 12 };
  const prev = GE.captures.length ? GE.captures[GE.captures.length - 1].hash : '0'.repeat(64);
  const b = { bytes, thumb, session, context, prev, place: SPOT.name, lat: SPOT.lat, lon: SPOT.lon, at: start };
  CAP.ceremony(b, cv);
  b.mediaHash = await sha256(bytes);
  b.hash = await sha256(canon({ media: b.mediaHash, session, context, prev }));
  b.sig = await signHex(b.hash);
  b.jwk = KEY.jwk;
  GE.captures.push(b);
  CAP.ceremonyFill(b);
  CAP.busy = false;
};
CAP.ceremony = function (b, cv) {
  const ov = $('#sealOv');
  ov.innerHTML = `<div class="bundle glass strong"><div class="ph" id="bph"><svg class="bigseal" id="bigseal" viewBox="0 0 24 24"><use href="#i-seal"/></svg></div>
  <div class="steps">
    <div class="step" data-s="0"><span class="ck">${ic('check', 'xs')}</span><div><b>Frame hashed</b> · SHA-256 of ${fmt.n(b.bytes.length)} JPEG bytes<div class="h" id="sh0">…</div></div></div>
    <div class="step" data-s="1"><span class="ck">${ic('check', 'xs')}</span><div><b>Session sealed</b> · IMU 150 samples @ 50 Hz · GPS ±4 m · heading ${b.session.heading}°<svg class="trace" viewBox="0 0 300 30" preserveAspectRatio="none">${GE.sparkPath(b.session.imu.map((x) => x.g + x.b * 0.02), 300, 30, '#5CF2A0', 1.2)}</svg></div></div>
    <div class="step" data-s="2"><span class="ck">${ic('check', 'xs')}</span><div><b>Chained</b> to this device’s previous bundle<div class="h">prev ${b.prev.slice(0, 24)}…</div></div></div>
    <div class="step" data-s="3"><span class="ck">${ic('check', 'xs')}</span><div><b>Bundle hash</b><div class="h" id="sh3">…</div></div></div>
    <div class="step" data-s="4"><span class="ck">${ic('check', 'xs')}</span><div><b>Signed</b> · ECDSA P-256, key generated on device, non-extractable<div class="h" id="sh4">…</div></div></div>
  </div>
  <div class="btnrow" id="bbtns" style="opacity:.35;pointer-events:none"><button class="btn gold" id="bdrop">${ic('threads', 'sm')}Attach &amp; post</button></div>
  <div class="btnrow" id="bbtns2" style="opacity:.35;pointer-events:none"><button class="btn" id="bver">${ic('check', 'sm')}Verify</button><button class="btn" id="bdone">Keep private</button></div>
  <p style="margin:0;font-size:11px;color:var(--text3);text-align:center">None of this proves truth. It raises the cost of lying.</p></div>`;
  const ph = $('#bph'); const c2 = document.createElement('canvas'); c2.width = 600; c2.height = 450; c2.getContext('2d').drawImage(cv, 0, 0, 600, 450); ph.prepend(c2);
  ov.classList.add('on');
};
CAP.ceremonyFill = async function (b) {
  const step = (i) => new Promise((r) => setTimeout(() => { const s = $(`.step[data-s="${i}"]`); s && s.classList.add('on', 'done'); haptic(4); r(); }, prefersReduced() ? 30 : 380));
  const stream = async (id, hex) => { const el = $('#' + id); if (!el) return; if (prefersReduced()) { el.textContent = hex; return; } for (let i = 0; i <= hex.length; i += 4) { el.textContent = hex.slice(0, i) + (i < hex.length ? '▍' : ''); await new Promise((r) => setTimeout(r, 8)); } };
  $(`.step[data-s="0"]`).classList.add('on'); await stream('sh0', b.mediaHash); await step(0);
  await step(1); await step(2);
  $(`.step[data-s="3"]`).classList.add('on'); await stream('sh3', b.hash); await step(3);
  $(`.step[data-s="4"]`).classList.add('on'); await stream('sh4', b.sig ? b.sig : 'WebCrypto unavailable here — bundle hashed but unsigned'); await step(4);
  $('#bigseal').classList.add('on'); haptic([10, 40, 20]);
  for (const id of ['bbtns', 'bbtns2']) { const e = $('#' + id); e.style.opacity = 1; e.style.pointerEvents = 'auto'; }
  $('#bdrop').addEventListener('click', () => { $('#sealOv').classList.remove('on'); GE.attach.open({ kind: 'witness', tier: 'sealed', img: b.thumb, lat: b.lat, lon: b.lon, at: b.at, place: b.place, hash: b.hash, cap: b }); });
  $('#bver').addEventListener('click', () => { $('#sealOv').classList.remove('on'); GE.you.inspect(GE.captures.indexOf(b)); });
  $('#bdone').addEventListener('click', () => { $('#sealOv').classList.remove('on'); CAP.render(); GE.you.render(); });
};
