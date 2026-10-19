/* Globe chrome: lens dock (8 families), Control-Center layer grid (long-press = solo), visual lenses,
   haptic time ribbon (−72 h ← NOW → +120 h) with event pips, pick card, search. */
const GUI = (GE.gui = {});
const FAMS = Object.keys(GE.FAM);
const LENSES = [
  ['cinematic', 'Cinematic', 'linear-gradient(135deg,#0B2A55,#1E6FB8 45%,#F2B36B 80%,#2a1a10)'],
  ['clear', 'Clear', 'linear-gradient(135deg,#3B6EA8,#8FB9E3 50%,#C9D9A4)'],
  ['night', 'Night', 'radial-gradient(circle at 60% 40%,#FFC46B 0,#7A4A12 8%,#0B1426 30%,#04070D)'],
  ['thermal', 'Thermal', 'linear-gradient(90deg,#08001A,#5A0F8C 30%,#E3263F 55%,#FF9F00 78%,#FFFBD6)'],
  ['nvg', 'NVG', 'radial-gradient(circle,#B8FFB0 0,#2EA043 35%,#05200C 75%)'],
];
GUI.famCount = (f) => GE.world.layers.filter((l) => l.fam === f && l.on).reduce((s, l) => s + (l.count || 0), 0);

/* ---------- dock ---------- */
GUI.renderDock = function () {
  const d = $('#dock'); const W = GE.world;
  d.innerHTML = FAMS.map((f) => { const F = GE.FAM[f]; const on = W.layers.some((l) => l.fam === f && l.on); return `<button class="fam glass ${on ? '' : 'off'} ${GUI.solo === f ? 'solo' : ''}" data-f="${f}" style="--c:${F.color}">${ic(F.icon)}${F.name}<span class="n num">${fmt.k(GUI.famCount(f))}</span></button>`; }).join('');
  $$('#dock .fam').forEach((b) => {
    let tm = null, long = false;
    b.addEventListener('pointerdown', () => { long = false; tm = setTimeout(() => { long = true; GUI.soloFam(b.dataset.f); }, 520); });
    const clr = () => clearTimeout(tm);
    b.addEventListener('pointerup', clr); b.addEventListener('pointerleave', clr); b.addEventListener('pointercancel', clr);
    b.addEventListener('click', () => { if (long) return; GUI.openCC(b.dataset.f); });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
};
GUI.soloFam = function (f) {
  const W = GE.world;
  if (GUI.solo === f) { if (GUI._preSolo) W.layers.forEach((l, i) => (l.on = GUI._preSolo[i])); GUI.solo = null; APP.toast(`Restored all families`); }
  else { if (!GUI.solo) GUI._preSolo = W.layers.map((l) => l.on); GUI.solo = f; W.layers.forEach((l) => (l.on = l.fam === f ? (l.on || ['flights', 'ais', 'sats', 'quakes', 'fires', 'cyclones', 'cctv', 'holo', 'venues', 'clouds', 'radar', 'gnss'].includes(l.id)) : l.id === 'clouds')); APP.toast(`<span style="color:${GE.FAM[f].color}">●</span> Soloed ${GE.FAM[f].name} · long-press to restore`); }
  haptic([8, 30, 8]); bus.emit('layers', W.layers);
};

/* ---------- Control Center grid ---------- */
GUI.ccHTML = function (inPane) {
  const W = GE.world;
  const lens = `<div class="lenses">${LENSES.map(([id, n, bg]) => `<button class="lens ${W.lens === id ? 'on' : ''}" data-lens="${id}"><span class="sw" style="background:${bg}"></span>${n}</button>`).join('')}</div>`;
  const fams = FAMS.map((f) => { const F = GE.FAM[f]; const ls = W.layers.filter((l) => l.fam === f);
    return `<section class="ccfam" id="ccf-${f}" style="--c:${F.color}"><div class="fh" data-fh="${f}"><i></i>${F.name}<span style="color:var(--text4);font-weight:600">${ls.length}</span><button class="solo" data-solo="${f}">${GUI.solo === f ? 'Restore' : 'Solo'}</button></div><div class="ccgrid">${ls.map((l) => `<button class="tile ${l.on ? 'on' : ''}" data-l="${l.id}"><span class="ti">${ic(l.icon || F.icon)}</span><span><div class="tn">${esc(l.name)}</div><div class="tc"><span class="st ${l.id === 'models' || l.id === 'imagery' ? 'stale' : ''}"></span><span class="num">${l.count ? fmt.n(l.count) : '—'}</span>${l.id === 'models' || l.id === 'imagery' ? ' · 3 h' : ''}</div></span></button>`).join('')}</div></section>`; }).join('');
  return `<div class="cch"><div><h2>Layers</h2><p>${W.layers.length} live layers in 8 families · long-press a family to solo</p></div>${inPane ? '' : `<button class="circ glass" id="ccX" aria-label="Close">${ic('x')}</button>`}</div><div class="stratum" style="margin-top:4px">Lens</div>${lens}${fams}`;
};
GUI.bindCC = function (root) {
  const W = GE.world;
  root.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => { const l = W.layerById[b.dataset.l]; l.on = !l.on; b.classList.toggle('on', l.on); haptic(4); bus.emit('layers', W.layers); }));
  root.querySelectorAll('[data-lens]').forEach((b) => b.addEventListener('click', () => { W.setLens(b.dataset.lens); root.querySelectorAll('[data-lens]').forEach((x) => x.classList.toggle('on', x === b)); haptic(6); }));
  root.querySelectorAll('[data-solo]').forEach((b) => b.addEventListener('click', () => { GUI.soloFam(b.dataset.solo); GUI.refreshCC(); }));
  root.querySelectorAll('[data-fh]').forEach((hd) => { let tm; hd.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; tm = setTimeout(() => { GUI.soloFam(hd.dataset.fh); GUI.refreshCC(); }, 520); }); const c = () => clearTimeout(tm); hd.addEventListener('pointerup', c); hd.addEventListener('pointerleave', c); });
  root.querySelector('#ccX')?.addEventListener('click', GUI.closeCC);
};
GUI.openCC = function (fam) {
  if (APP.isWide()) { if (APP.tab !== 'globe') APP.setTab('globe'); GUI.renderLayersPane(); const t = $('#ccf-' + fam); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const cc = $('#cc'); cc.innerHTML = GUI.ccHTML(false); GUI.bindCC(cc); cc.classList.add('on');
  if (fam) requestAnimationFrame(() => { const t = $('#ccf-' + fam); if (t) cc.scrollTop = t.offsetTop - 60; });
  haptic(6);
};
GUI.refreshCC = function () { const cc = $('#cc'); if (cc.classList.contains('on')) { const st = cc.scrollTop; cc.innerHTML = GUI.ccHTML(false); GUI.bindCC(cc); cc.scrollTop = st; } if (APP.isWide() && APP.tab === 'globe') GUI.renderLayersPane(); };
GUI.closeCC = () => $('#cc').classList.remove('on');
GUI.renderLayersPane = function () { const v = $('#v-layers'); const st = v.scrollTop; v.innerHTML = `<div style="padding:calc(var(--sat) + 16px) 16px 140px">${GUI.ccHTML(true)}</div>`; GUI.bindCC(v); v.scrollTop = st; };

/* ---------- ribbon ---------- */
const RB = { span: 30, vel: 0, drag: null };
GUI.initRibbon = function () {
  const el = $('#ribbon'), cv = el.querySelector('canvas');
  const W = GE.world;
  const hpp = () => RB.span / Math.max(1, el.clientWidth);
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('#rbNow')) return; el.setPointerCapture(e.pointerId); RB.drag = { x: e.clientX, t: performance.now(), lastHour: Math.floor(W.offsetH) }; RB.vel = 0; Cam.lastInput = performance.now(); });
  el.addEventListener('pointermove', (e) => {
    if (!RB.drag) return; const now = performance.now(); const dx = e.clientX - RB.drag.x; const dt = Math.max(1, now - RB.drag.t);
    const speed = Math.abs(dx) / dt; // px/ms
    const k = clamp(0.22 + speed * 1.1, 0.22, 2.6); // slow → minutes, fast → hours
    const dh = -dx * hpp() * k;
    GUI.scrubTo(W.offsetH + dh);
    RB.vel = dh / dt * 16; RB.drag.x = e.clientX; RB.drag.t = now;
    const hr = Math.floor(W.offsetH); if (hr !== RB.drag.lastHour) { RB.drag.lastHour = hr; haptic(3); }
  });
  const up = () => { RB.drag = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  $('#rbNow').addEventListener('click', () => GUI.snapNow());
  GUI.drawRibbon();
};
GUI.scrubTo = function (h) {
  const W = GE.world; const win = W.getWindow(); const nowMs = Date.now();
  const lo = (win.start - nowMs) / 3600000, hi = (win.end - nowMs) / 3600000;
  W.setTime(nowMs + clamp(h, lo, hi) * 3600000);
};
GUI.snapNow = function () {
  const W = GE.world; const win = W.getWindow();
  if (W.window) { GUI.scrubTo(((win.start + win.end) / 2 - Date.now()) / 3600000); return; }
  const from = W.offsetH; const t0 = performance.now(); haptic(12);
  const anim = () => { const u = clamp((performance.now() - t0) / 600, 0, 1); const e = ease.outBack(u); const v = from * (1 - e); if (u >= 1) { W.setTime(null); return; } W.setTime(Date.now() + v * 3600000); requestAnimationFrame(anim); };
  anim();
};
GUI.ribbonFrame = function () {
  if (!RB.drag && Math.abs(RB.vel) > 1e-4) { GUI.scrubTo(GE.world.offsetH + RB.vel); RB.vel *= 0.92; }
  GUI.drawRibbon();
};
GUI.drawRibbon = function () {
  const el = $('#ribbon'); if (!el || !el.offsetWidth) return; const cv = el.querySelector('canvas');
  const W = GE.world; const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = el.clientWidth, hh = el.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
  const cx = cv.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, w, hh);
  const win = W.getWindow(); const nowMs = Date.now();
  RB.span = W.window ? Math.max(4, (win.end - win.start) / 3600000 * 0.7) : 30;
  const cur = W.offsetH; const pxh = w / RB.span; const X = (hr) => w / 2 + (hr - cur) * pxh;
  const lo = (win.start - nowMs) / 3600000, hi = (win.end - nowMs) / 3600000;
  // past / forecast regions
  const xNow = X(0);
  if (!W.window) {
    cx.fillStyle = 'rgba(138,180,248,.08)'; cx.fillRect(Math.max(0, xNow), 0, Math.max(0, w - Math.max(0, xNow)), hh);
    cx.save(); cx.beginPath(); cx.rect(Math.max(0, xNow), 0, w, hh); cx.clip(); cx.strokeStyle = 'rgba(138,180,248,.10)'; cx.lineWidth = 1; for (let x = Math.floor(xNow) - hh; x < w; x += 7) { cx.beginPath(); cx.moveTo(x, hh); cx.lineTo(x + hh, 0); cx.stroke(); } cx.restore();
  }
  // out-of-window shade
  cx.fillStyle = 'rgba(0,0,0,.35)'; if (X(lo) > 0) cx.fillRect(0, 0, X(lo), hh); if (X(hi) < w) cx.fillRect(X(hi), 0, w - X(hi), hh);
  // ticks
  const h0 = Math.floor(cur - RB.span / 2) - 1, h1 = Math.ceil(cur + RB.span / 2) + 1;
  cx.font = '600 10px ' + getComputedStyle(document.body).fontFamily; cx.textAlign = 'center';
  for (let k = h0; k <= h1; k++) {
    const x = X(k); const abs = new Date(nowMs + k * 3600000); const hrUTC = abs.getUTCHours();
    const major = hrUTC % 6 === 0, day = hrUTC === 0;
    cx.strokeStyle = day ? 'rgba(255,255,255,.55)' : major ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.14)';
    cx.lineWidth = day ? 1.4 : 1;
    const th = day ? 18 : major ? 12 : 6; cx.beginPath(); cx.moveTo(x, hh - 6); cx.lineTo(x, hh - 6 - th); cx.stroke();
    if (major && pxh * 6 > 34) { cx.fillStyle = day ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.45)'; cx.fillText(day ? abs.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) : String(hrUTC).padStart(2, '0'), x, hh - 26 - (day ? 2 : 0)); }
    // minute ticks when zoomed (slow scrub)
  }
  // NOW marker
  if (!W.window && xNow > -2 && xNow < w + 2) { cx.fillStyle = '#FF453A'; cx.fillRect(xNow - 1, 4, 2, hh - 8); }
  // event pips
  const pips = GUI.pips();
  for (const p of pips) { const x = X(p.h); if (x < -6 || x > w + 6) continue; cx.fillStyle = p.c; cx.beginPath(); cx.arc(x, hh - 6, 3.2, 0, TAU); cx.fill(); cx.shadowColor = p.c; cx.shadowBlur = 8; cx.beginPath(); cx.arc(x, hh - 6, 2, 0, TAU); cx.fill(); cx.shadowBlur = 0; if (Math.abs(x - w / 2) < 60) { cx.fillStyle = 'rgba(255,255,255,.7)'; cx.font = '600 9.5px ' + getComputedStyle(document.body).fontFamily; cx.fillText(p.l, x, hh - 14); } }
  // readout
  const simMs = nowMs + cur * 3600000;
  $('#rbTime').textContent = fmt.utc(simMs);
  $('#rbRel').textContent = W.window ? '' : W.live ? '' : fmt.rel(cur);
  el.classList.toggle('future', cur > 0.02 && !W.window);
  el.classList.toggle('breath', W.live && !prefersReduced());
  const nb = $('#rbNow'); nb.classList.toggle('live', W.live); nb.innerHTML = W.window ? `${ic('clock', 'xs')}EVENT` : W.live ? '<span class="dot pulse"></span>LIVE' : 'NOW';
  const stt = $('#statusTxt'); if (stt) {
    const alt = (GE.mainView ? geo.ll(GE.mainView.eye)[2] : Cam.range * EARTH_KM); const band = alt > 120 ? 'ORBIT' : alt > 0.8 ? 'SKY' : 'GROUND'; const bc = { ORBIT: 'var(--b-orbit)', SKY: 'var(--b-sky)', GROUND: 'var(--b-ground)' }[band];
    if (GE.live && GE.live.on) { stt.innerHTML = `You’re live · <b class="num">${fmt.dur((Date.now() - GE.live.t0) / 1000).slice(3)}</b>`; $('#statusTime').textContent = 'return'; $('#status .dot').style.background = ''; }
    else { stt.innerHTML = `${W.window ? 'Replay' : W.live ? 'Live' : cur > 0 ? 'Forecast' : 'Replay'} <span class="alt mono" style="color:${bc}">${band} · ${alt >= 10 ? fmt.n(Math.round(alt)) + ' KM' : alt >= 1 ? alt.toFixed(1) + ' KM' : fmt.n(Math.round(alt * 1000)) + ' M'}</span>`; $('#statusTime').textContent = fmt.utc(simMs, false) + ' UTC'; $('#status .dot').style.background = W.live ? '' : cur > 0 ? 'var(--wx)' : 'var(--gold)'; } }
};
GUI.pips = function () {
  const nowMs = Date.now(); const W = GE.world;
  if (W.window && GE.threads?.ws?.beats) return GE.threads.ws.beats.map((b) => ({ h: (b.at - nowMs) / 3600000, c: '#E9C46A', l: b.t }));
  if (APP.mode === 'situation' && GE.sheet.id && GE.rooms.byId[GE.sheet.id]) { const KC = { witness: '#F2CF7A', context: '#8CD4FF', question: '#FFFFFF', correction: '#FFB25C', prediction: '#B79CFF' }; return GE.rooms.byId[GE.sheet.id].posts.map((p) => ({ h: ((p.time || p.at) - nowMs) / 3600000, c: KC[p.kind], l: '@' + (GE.PEOPLE[p.by]?.h || p.by) })); }
  return [{ h: GE.BIGQ.t / 3600, c: '#FF6A3D', l: 'M6.4' }, { h: (GE.LAUNCH_T0 - nowMs) / 3600000, c: '#C9A7FF', l: 'Launch' }, { h: 40, c: '#FF6A3D', l: 'Landfall' }, { h: (GE.SIT.byId.aurora.time.at - nowMs) / 3600000, c: '#5CF2A0', l: 'Aurora' }, { h: -30, c: '#FF6A3D', l: 'Fire run' }, { h: (SIT._iss?.start - nowMs) / 3600000 || 3, c: '#C9A7FF', l: 'ISS' }];
};

/* ---------- pick card ---------- */
GUI.showPick = function (p) {
  const el = $('#pick'); const W = GE.world;
  if (!p) { el.classList.remove('on'); W.sel = null; W.selFlight = -1; W.selSat = -1; W.selRoute = null; return; }
  const famOf = { flight: 'sky', heli: 'sky', ship: 'sea', sat: 'orbit', quake: 'haz', holo: 'eyes', situation: 'haz' }[p.kind] || 'sky';
  const icn = { flight: 'airplane', heli: 'helicopter', ship: 'ferry', sat: 'iss', quake: 'wave', holo: 'seal', situation: 'radiowaves' }[p.kind];
  W.sel = { ...p, v: p.kind === 'flight' ? v3.scale(geo.vec(p.lat, p.lon), 1 + (p.altKm * W.altX) / EARTH_KM) : geo.vec(p.lat, p.lon, p.altKm || 0.1) };
  W.selFlight = p.kind === 'flight' ? p.id : -1; W.selSat = p.kind === 'sat' ? p.id : -1;
  if (p.kind === 'flight') { const m = p.meta; W.selRoute = (() => { const a = m.from, b = m.to; const pts = []; for (let i = 0; i <= 64; i++) { const t = i / 64; pts.push(v3.scale(geo.slerp(a.v, b.v, t), 1 + 0.002)); } return pts; })(); } else W.selRoute = null;
  let kv = '';
  if (p.kind === 'flight') kv = `<div><b>${fmt.n(Math.round(p.altKm * 3281 / 100) * 100)}</b>ft</div><div><b>${Math.round(p.meta.f.speed / 1.852)}</b>kt</div><div><b>${String(Math.round(((p.hdg * R2D) + 360) % 360)).padStart(3, '0')}°</b>hdg</div><div><b>${Math.round(p.meta.prog * 100)}%</b>route</div>`;
  else if (p.kind === 'ship') kv = `<div><b>${fmt.ll(p.lat, p.lon, 2)}</b>position</div>`;
  else if (p.kind === 'heli') kv = `<div><b>${Math.round(p.altKm * 3281)}</b>ft AGL</div><div><b>${String(Math.round(((p.hdg * R2D) + 360) % 360)).padStart(3, '0')}°</b>hdg</div>`;
  else kv = `<div><b class="mono">${fmt.ll(p.lat, p.lon, 2)}</b>position</div>`;
  const canRide = p.kind === 'flight' || p.kind === 'heli';
  el.style.setProperty('--c', GE.FAM[famOf].color);
  el.innerHTML = `<div class="hd"><span class="ico">${ic(icn)}</span><div class="tt"><b>${esc(p.title)}</b><span>${esc(p.subtitle || '')}</span></div><button class="x" aria-label="Close">${ic('x', 'sm')}</button></div><div class="kv">${kv}</div>
  <div class="acts"><button class="act pri" data-p="follow">${ic('bellplus')}Follow</button><button class="act ${canRide ? 'gold' : ''}" data-p="ride" ${canRide ? '' : 'disabled style="opacity:.4"'}>${ic(p.kind === 'heli' ? 'helicopter' : 'airplane')}Ride</button><button class="act" data-p="eye">${ic('video')}Nearest eye</button><button class="act" data-p="thread">${ic('threads')}Thread</button></div>`;
  el.classList.add('on');
  el.querySelector('.x').addEventListener('click', () => GUI.showPick(null));
  el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.p; haptic(6);
    if (a === 'ride' && canRide) { GUI.showPick(null); GE.ride.start(p); }
    if (a === 'follow') APP.toast(`${ic('bell', 'sm')} Following ${esc(p.title)}`);
    if (a === 'eye') { Cam.flyTo({ lat: p.lat, lon: p.lon, range: Math.min(Cam.range, 0.004), tilt: 1.0 }); APP.toast(`${ic('video', 'sm')} Nearest eye · public camera ${(0.6 + hash01(p.id || 1) * 3).toFixed(1)} km · illustrative`); }
    if (a === 'thread') APP.toast(`${ic('threads', 'sm')} Thread started for ${esc(p.title)}`);
  }));
};
bus.on('tap', ({ x, y }) => {
  if (APP.mode === 'ride' || APP.tab === 'capture') return;
  if (APP.tab !== 'globe' && !APP.isWide()) return;
  const v = GE.mainView; if (!v) return;
  const p = GE.world.pick(v, x, y, 28);
  if (p && p.kind === 'situation') { GE.sheet.open(p.id, { fromGlobe: true }); return; }
  GUI.showPick(p); if (p) haptic(5);
});

/* ---------- search ---------- */
GUI.openSearch = function () {
  const el = $('#search');
  el.innerHTML = `<div class="res" id="sres"></div><div class="bar"><div class="field glass">${ic('search')}<input id="sq" placeholder="Places, situations, layers, callsigns" autocomplete="off" enterkeyhint="search"></div><button class="circ glass" id="sx" style="width:52px;height:52px">${ic('x')}</button></div>`;
  el.classList.add('on');
  const q = $('#sq'); const run = () => GUI.searchResults(q.value.trim());
  q.addEventListener('input', run); run(); setTimeout(() => q.focus(), 60);
  $('#sx').addEventListener('click', () => el.classList.remove('on'));
};
GUI.searchResults = function (q) {
  const res = $('#sres'); const ql = q.toLowerCase(); const W = GE.world;
  const groups = [];
  const sits = GE.SIT.list.filter((s) => !ql || (s.title + s.place).toLowerCase().includes(ql)).slice(0, ql ? 6 : 4);
  groups.push(['Situations', sits.map((s) => ({ c: GE.FAM[s.fam].color, i: GE.FAM[s.fam].icon, t: s.title, s: s.place, go: () => { $('#search').classList.remove('on'); GE.sheet.open(s.id, { fromGlobe: true }); } }))]);
  const places = [...GE.CITY_V.map((c) => ({ ...c, k: 'city' })), ...GE.AP.map((a) => ({ name: `${a.iata} · ${a.city}`, lat: a.lat, lon: a.lon, k: 'ap' }))].filter((p) => ql && p.name.toLowerCase().includes(ql)).slice(0, 5);
  groups.push(['Places', places.map((p) => ({ c: 'var(--ground)', i: p.k === 'ap' ? 'airplane' : 'location', t: p.name, s: fmt.ll(p.lat, p.lon, 2), go: () => { $('#search').classList.remove('on'); if (APP.tab !== 'globe') APP.setTab('globe'); Cam.flyTo({ lat: p.lat, lon: p.lon, range: p.k === 'ap' ? 0.006 : 0.012, tilt: 0.9, heading: 0.3 }); } }))]);
  const lays = W.layers.filter((l) => ql && l.name.toLowerCase().includes(ql)).slice(0, 4);
  groups.push(['Layers', lays.map((l) => ({ c: GE.FAM[l.fam].color, i: l.icon, t: l.name, s: `${GE.FAM[l.fam].name} · ${l.on ? 'on' : 'off'} · ${fmt.n(l.count)}`, go: () => { l.on = true; bus.emit('layers'); $('#search').classList.remove('on'); GUI.openCC(l.fam); } }))]);
  if (ql.length >= 2) {
    const fl = []; for (let i = 0; i < GE.FLIGHTS.length && fl.length < 4; i++) { const f = GE.FLIGHTS[i]; if (f.cs.toLowerCase().includes(ql)) { const p = GE.flightAt(f, W.t); if (p) fl.push({ f, i, p }); } }
    groups.push(['Contacts', fl.map(({ f, i, p }) => ({ c: 'var(--sky)', i: 'airplane', t: f.cs, s: `${f.type} · ${p.from.iata} → ${p.to.iata}`, go: () => { $('#search').classList.remove('on'); if (APP.tab !== 'globe') APP.setTab('globe'); Cam.flyTo({ lat: p.lat, lon: p.lon, range: 0.05, tilt: 0.6 }); GUI.showPick({ kind: 'flight', id: i, title: f.cs, subtitle: `${f.type} · ${p.from.iata} → ${p.to.iata}`, lat: p.lat, lon: p.lon, altKm: p.altKm, hdg: p.hdg, meta: { from: p.from, to: p.to, f, prog: p.prog } }); } }))]);
  }
  res.innerHTML = ''; const frag = document.createDocumentFragment();
  for (const [title, items] of groups) { if (!items.length) continue; frag.append(h('div', { class: 'grpH' }, title)); for (const it of items) { const b = h('button', { class: 'it', html: `<span class="ri" style="--c:${it.c}">${ic(it.i, 'sm')}</span><span style="text-align:left;min-width:0"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.t)}</span><small>${esc(it.s)}</small></span>` }); b.addEventListener('click', it.go); frag.append(b); } }
  if (!q) frag.prepend(h('div', { class: 'grpH', style: { marginTop: 0 } }, 'Try “typhoon”, “ATL”, “Kathmandu”, “fires”, “AXR”'));
  res.append(frag);
};

GUI.init = function () {
  GUI.renderDock(); GUI.initRibbon();
  bus.on('layers', () => { GUI.renderDock(); GUI.refreshCCSoft(); });
  GUI.refreshCCSoft = () => { const cc = $('#cc'); if (cc.classList.contains('on')) cc.querySelectorAll('[data-l]').forEach((b) => { const l = GE.world.layerById[b.dataset.l]; b.classList.toggle('on', l.on); const n = b.querySelector('.tc .num'); if (n) n.textContent = l.count ? fmt.n(l.count) : '—'; }); };
  $('#btnLayers').addEventListener('click', () => GUI.openCC());
  $('#btnLens').addEventListener('click', () => { const ids = LENSES.map((l) => l[0]); const i = (ids.indexOf(GE.world.lens) + 1) % ids.length; GE.world.setLens(ids[i]); APP.toast(`${ic('sparkles', 'sm')} ${LENSES[i][1]} lens`); $('#btnLens').classList.toggle('on', ids[i] !== 'cinematic'); });
  $('#btnHome').addEventListener('click', () => { GUI.showPick(null); Cam.flyTo({ range: 2.6, tilt: 0, heading: 0, shiftY: APP.isWide() ? 0 : 0.06 }); });
  $('#btnCompass').addEventListener('click', () => Cam.flyTo({ heading: 0, tilt: 0 }, { duration: 0.8 }));
  $('#status').addEventListener('click', () => { if (GE.live && GE.live.on) { APP.setTab('capture'); return; } GUI.snapNow(); });
};
