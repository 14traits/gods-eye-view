/* Now: RedNote-style two-column masonry of living situation cards. Thumbnails are rendered from the
   same WebGL globe in an offscreen pass (texture-crop fallback first, so there is never a blank). */
const NOWV = (GE.now = { filter: 'all' });
const TH = (GE.thumbs = { q: [], chains: new Map(), done: new Map() });

/* ---------- thumbnail renderer ---------- */
Cam.viewFrom = function (spec, w, h) {
  const save = { lat: Cam.lat, lon: Cam.lon, range: Cam.range, heading: Cam.heading, tilt: Cam.tilt, shiftX: Cam.shiftX, shiftY: Cam.shiftY, rig: Cam.rig };
  Object.assign(Cam, { shiftX: 0, shiftY: 0, heading: 0, tilt: 0 }, spec); Cam.rig = null;
  const v = Cam.view(w, h); Object.assign(Cam, save); return v;
};
TH.chainFor = function (w, h) { const k = w + 'x' + h; if (!TH.chains.has(k)) TH.chains.set(k, { chain: GL.chain(w, h), out: GL.target(w, h, { hdr: false }) }); return TH.chains.get(k); };
TH.render = function (spec, w, h, o = {}) { return TH.renderView(Cam.viewFrom(spec, w, h), w, h, o); };
TH.renderView = function (view, w, h, o = {}) {
  const gl = GL.gl; const { chain, out } = TH.chainFor(w, h);
  const W = GE.world;
  const at = o.at ?? null;
  const t = at != null ? (at - NOW) / 1000 : W.t;
  const sun = at != null ? astro.sun(at) : W.sun;
  const offsetH = at != null ? (at - Date.now()) / 3600000 : W.offsetH;
  const saved = W.layers.map((l) => l.on);
  if (o.layers) for (const id of o.layers) if (W.layerById[id]) W.layerById[id].on = true;
  W.render(view, chain, out.fb, { t: o.t ?? t, sun: o.sun ?? sun, offsetH: o.offsetH ?? offsetH, simMs: o.simMs ?? at ?? W.simMs, lens: o.lens || 'cinematic', outW: w, outH: h, vpW: w, vpH: h, pxScale: o.px ?? 1.35, aurora: o.aurora, exposure: o.exposure ?? 1.08, grain: false, focus: o.focus, extraSprites: o.extraSprites, extraLines: o.extraLines, steps: 10, lineK: 1.25, cloudK: o.cloudK });
  W.layers.forEach((l, i) => (l.on = saved[i]));
  const px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const cv = o.canvas || document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d'); const id = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) id.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  cx.putImageData(id, 0, 0);
  return cv;
};
TH.situationSpec = (s) => s.thumbCam || GE.SIT.cameraFor(s);
TH.renderSituation = function (s, canvas) {
  const w = canvas.width, hh = canvas.height;
  const extras = GE.extrasFor ? GE.extrasFor(s.id) : null;
  return TH.render(TH.situationSpec(s), w, hh, { at: s.time?.at ?? null, layers: s.layers, canvas, aurora: s.auroraK, extraSprites: extras?.sprites, extraLines: extras?.lines, focus: s.kind === 'recon' ? null : null });
};
TH.enqueue = function (fn) { TH.q.push(fn); };
TH.step = function (budgetMs = 10) {
  const t0 = performance.now(); let n = 0;
  while (TH.q.length && (n === 0 || performance.now() - t0 < budgetMs)) { const fn = TH.q.shift(); try { fn(); } catch (e) { console.warn('thumb', e); } n++; }
};
// texture-crop fallback, drawn instantly
TH.fallback = function (s, canvas) {
  const W = GE.world; const cx = canvas.getContext('2d'); const w = canvas.width, hh = canvas.height;
  const spec = TH.situationSpec(s) || { lat: s.lat, lon: s.lon, range: 0.3 };
  const spanDeg = clamp(spec.range * 70, 1.2, 120);
  const img = W.img?.day; if (!img) { cx.fillStyle = '#0b1220'; cx.fillRect(0, 0, w, hh); return; }
  const sx = ((spec.lon + 180) / 360) * img.width, sy = ((90 - spec.lat) / 180) * img.height;
  const sw = (spanDeg / 360) * img.width, sh = sw * (hh / w);
  cx.drawImage(img, sx - sw / 2, sy - sh / 2, sw, sh, 0, 0, w, hh);
  const el = astro.elev(s.time?.at ?? Date.now(), s.lat, s.lon);
  if (el < 4) { cx.globalAlpha = clamp((4 - el) / 12, 0, 0.92); cx.drawImage(W.img.night, sx - sw / 2, sy - sh / 2, sw, sh, 0, 0, w, hh); cx.globalAlpha = 1; }
  const g = cx.createRadialGradient(w / 2, hh / 2, Math.min(w, hh) * 0.2, w / 2, hh / 2, Math.max(w, hh) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)'); cx.fillStyle = g; cx.fillRect(0, 0, w, hh);
};

/* ---------- feed ---------- */
const BAND_ORDER = ['all', 'orbit', 'sky', 'ground', 'inside'];
NOWV.band = store.get('band', 'all');
const famIcon = (f) => GE.FAM[f].icon;
const avatarHTML = (k, cls = 'sm') => { const p = GE.PEOPLE[k] || { h: k, hue: 205 }; return `<span class="avatar ${cls}" style="--h:${p.hue}">${esc((p.h || '?')[0].toUpperCase())}</span>`; };
GE.avatarHTML = avatarHTML;
const bandTag = (b) => `<span class="bt">${GE.BANDS[b].name.toUpperCase()}</span>`;
function cvSize(x) { const W0 = x.wide ? 800 : 400; return [W0, Math.round(W0 * x.aspect)]; }
function whereHTML(x) { const ago = x.live && x.ago < 1 ? 'LIVE NOW' : x.live ? `LIVE · ${fmt.ago(Date.now() - x.at).replace(' ago', '').toUpperCase()}` : fmt.ago(Date.now() - x.at).toUpperCase(); return `<div class="where"><div class="pl">${esc(x.place)}</div><div class="d mono">${x.dist < 60 ? 'NEAR YOU · ' : ''}${GE.feed.fmtDist(x.dist).toUpperCase()} AWAY · ${ago}</div></div>`; }
function socHTML(x) {
  const r = GE.rooms; const n = r.watching(x.sit); const posts = r.count(x.sit); const sealed = r.sealedCount(x.sit);
  const ppl = (GE.rooms.byId[x.sit]?.posts || []).slice(0, 3).map((p) => p.by);
  const stack = (ppl.length ? ppl : ['kora', 'sky', 'geo']).map((k) => avatarHTML(k)).join('');
  return `<div class="soc">${x.wide ? `<span class="stack">${stack}</span>` : ''}<span>${ic('threads', 'xs')}<b class="num">${fmt.k(n)}</b> in room</span>${sealed ? `<span class="sl">${ic('seal', 'xs')}<b class="num">${sealed}</b> sealed</span>` : `<span><b class="num">${posts}</b> posts</span>`}</div>`;
}
function frameHTML(x, inner = '') {
  const [w, h] = cvSize(x);
  return `<div class="fr" style="aspect-ratio:${1}/${x.aspect}"><canvas width="${w}" height="${h}"></canvas><i class="bk a"></i><i class="bk b"></i><i class="bk c"></i><i class="bk d"></i>
    <div class="ftop">${bandTag(x.band)}<span class="at">${GE.ARCH[x.arch].toUpperCase()}</span>${x.live ? '<span class="lv"><i></i>LIVE</span>' : ''}${x.mine ? '<span class="mine">YOU</span>' : ''}</div>
    ${inner}${x.tele ? `<div class="tele" data-tele>${esc(x.tele())}</div>` : ''}</div>`;
}
function cardHTML(x) {
  const B = GE.BANDS[x.band];
  if (x.arch === 'room' && !x.recon) return roomCardHTML(x);
  let inner = '';
  if (x.arch === 'number') inner = `<div class="numov"><div class="big num">${x.big}<small>${esc(x.unit)}</small></div><div class="nl">${esc(x.label)}</div><svg class="nsp" viewBox="0 0 160 34" preserveAspectRatio="none">${GE.sparkPath(x.spark, 160, 34, B.c, 2)}</svg></div>`;
  if (x.readout) inner += `<div class="readout num" data-ro>${esc(typeof x.readout === 'function' ? x.readout() : x.readout)}</div>`;
  if (x.arch === 'witness') inner += `<svg class="fseal"><use href="#i-seal"/></svg>`;
  if (x.recon) inner += `<div class="r4d"><span class="badge d4">4D</span><span class="badge">Reconstruction</span></div>`;
  const who = x.by ? (() => { const p = GE.PEOPLE[x.by]; const room = GE.rooms.get(x.sit); const post = room?.posts.find((q) => q.id === x.post); const bd = post ? GE.rooms.badges(room, post).slice(0, 2) : []; return `<div class="who">${avatarHTML(x.by)}<b>@${esc(p.h)}</b>${bd.map(([k, l]) => `<span class="bdg ${k}">${esc(l)}</span>`).join('')}</div>`; })() : '';
  const cta = x.cta ? `<button class="cta" data-cta>${ic(x.cta[0], 'sm')}${esc(x.cta[1])}</button>` : '';
  const recon = x.recon ? `<div class="soc"><span><b class="num">23</b> observations</span><span><b class="num">9</b> hypotheses</span><span class="sl">${ic('link', 'xs')}ledger verified</span></div>` : socHTML(x);
  return `${frameHTML(x, inner)}<div class="fm">${who}<div class="ttl">${esc(x.title)}</div>${whereHTML(x)}${recon}${cta}</div>`;
}
function roomCardHTML(x) {
  const room = GE.rooms.get(x.sit); const syn = room.synth; const open = room.posts.find((p) => p.kind === 'question' && !p.answered);
  const ppl = [...new Set(room.posts.map((p) => p.by))].slice(0, 5);
  const line = (cls, lab, t, c) => t ? `<div class="cl ${cls}"><b>${lab}</b><span>${esc(t)}</span>${c ? `<span class="cites">${c.map((z) => `<i>${z}</i>`).join('')}</span>` : ''}</div>` : '';
  const ev = (x.ev || []).map((e, i) => `<canvas class="evc" data-ev="${i}" width="200" height="150"></canvas>`).join('');
  const sealed = room.posts.filter((p) => p.att && /^sealed/.test(p.att.tier)).length; const notes = room.posts.filter((p) => p.note).length;
  return `<div class="rhead"><span class="rtag">${ic('threads', 'xs')}ROOM</span>${bandTag('inside')}<span class="lvw"><span class="dot pulse"></span><b class="num" data-watch>${fmt.n(room.watching)}</b> watching</span><span class="stack">${ppl.map((k) => avatarHTML(k)).join('')}</span></div>
    <h3>${esc(x.title)}</h3>${whereHTML(x)}
    <div class="claims">${line('known', 'KNOWN', syn.known[0]?.[0], syn.known[0]?.[1])}${line('disputed', 'DISPUTED', syn.disputed[0]?.[0], syn.disputed[0]?.[1])}${open ? line('open', 'ASKED', '“' + open.text + '”', null) : line('unknown', 'UNKNOWN', syn.unknown[0]?.[0], syn.unknown[0]?.[1])}</div>
    ${ev ? `<div class="evs">${ev}</div>` : ''}
    <div class="rfoot"><span><b class="num">${room.posts.length}</b> posts · <b class="num">${sealed}</b> sealed${notes ? ` · <b class="num">${notes}</b> note` : ''}</span><span class="join">Join the room ${ic('chevr', 'xs')}</span></div>`;
}
NOWV.render = function () {
  const v = $('#v-now'); const now = new Date();
  const kick = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase();
  v.innerHTML = `<div class="navbar"><span class="wm">GOD’S EYE</span></div>
  <div class="now-hero">
    <div class="hud"><span class="wm">GOD’S&nbsp;EYE</span><i class="hb a"></i><i class="hb b"></i><i class="hb c"></i><i class="hb d"></i><i class="xh"></i><div class="hud-t mono" id="heroTele"></div></div>
    <div class="lt"><div class="kicker mono"><span class="dot pulse"></span><span>LIVE · ${kick} · <span class="num" id="nowClock">${GE.feed.hmsZ()}</span></span></div>
      <div class="row"><h1>Right now, at every altitude.</h1><button class="avatar md" style="--h:205" aria-label="You" id="nowMe">Y</button></div>
      <div class="counts mono"><span><b class="num" id="cAir">–</b> aircraft</span><span><b class="num" id="cShip">–</b> vessels</span><span><b class="num">${fmt.n(GE.SATS.length)}</b> satellites</span><span><b class="num">408</b> cameras</span><span class="w"><b class="num" id="cWit">14</b> witnesses live</span></div></div>
  </div>
  <div class="now-body"><div class="bandrail" id="bandRail" role="tablist" aria-label="Altitude"></div><div id="feed"></div><div class="feed-end mono">${ic('sparkles', 'xs')} CONCEPT · ILLUSTRATIVE DATA · PEOPLE AND POSTS ARE FICTIONAL</div></div>`;
  $('#nowMe').addEventListener('click', () => APP.setTab('you'));
  NOWV.renderRail(); NOWV.renderFeed();
};
NOWV.renderRail = function () {
  const c = GE.feed.counts();
  $('#bandRail').innerHTML = BAND_ORDER.map((b) => { const B = GE.BANDS[b]; return `<button class="bcell ${NOWV.band === b ? 'on' : ''}" data-b="${b}" role="tab" aria-selected="${NOWV.band === b}" style="--c:${B ? B.c : '#E8EEF8'}"><i></i><b>${b === 'all' ? 'ALL' : B.name.toUpperCase()}</b><span class="num">${c[b]}</span><em>${b === 'all' ? 'orbit → you' : esc(B.alt)}</em></button>`; }).join('<span class="rarr"></span>');
  $$('#bandRail .bcell').forEach((el) => el.addEventListener('click', () => { NOWV.band = el.dataset.b; store.set('band', NOWV.band); NOWV.renderRail(); NOWV.renderFeed(); haptic(5); const v = $('#v-now'); const r = $('#bandRail'); if (v.scrollTop > r.offsetTop) v.scrollTo({ top: r.offsetTop - 4, behavior: 'smooth' }); }));
};
NOWV.cardEl = function (x) {
  const el = h('article', { class: `card fc a-${x.arch} b-${x.band}${x.wide ? ' wide' : ''}${x.arch === 'room' && !x.recon ? ' room' : ''}${x.mine ? ' mine' : ''}`, 'data-fid': x.id, 'data-id': x.sit, tabindex: 0, role: 'button', 'aria-label': x.title, style: `--c:${GE.BANDS[x.band].c}` });
  el.innerHTML = cardHTML(x);
  const go = (e) => { if (e && e.target.closest('[data-cta]')) { e.stopPropagation(); if (x.ride) { NOWV.open(GE.SIT.byId[x.sit], el, { ride: true }); return; } if (x.cta[0] === 'bell') { APP.toast(`${ic('bell', 'sm')} Reminder set · 5 min before the pass`); return; } } NOWV.openItem(x, el); };
  el.addEventListener('click', go); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  // paint
  const cv = el.querySelector('.fr canvas');
  if (cv) NOWV.paint(x, cv);
  el.querySelectorAll('canvas.evc').forEach((c) => { const [id, o] = x.ev[+c.dataset.ev]; TH.enqueue(() => GE.paint.draw(id, c, { ...o, t: 2 + +c.dataset.ev })); });
  return el;
};
NOWV.paint = function (x, cv) {
  if (x.img) { const im = new Image(); im.onload = () => { const cx = cv.getContext('2d'); const s = Math.max(cv.width / im.width, cv.height / im.height); cx.drawImage(im, (cv.width - im.width * s) / 2, (cv.height - im.height * s) / 2, im.width * s, im.height * s); }; im.src = x.img; return; }
  if (x.paint === 'globe') { const s = GE.SIT.byId[x.sit]; const cached = TH.done.get(s.id); if (cached) cv.getContext('2d').drawImage(cached, 0, 0, cv.width, cv.height); else { TH.fallback(s, cv); TH.enqueue(() => { const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; TH.renderSituation(s, c2); TH.done.set(s.id, c2); $$(`[data-id="${s.id}"] .fr canvas`).forEach((z) => z.getContext('2d').drawImage(c2, 0, 0, z.width, z.height)); }); } return; }
  const key = x.id + '|' + cv.width; const done = NOWV.painted.get(key);
  const cx = cv.getContext('2d'); cx.fillStyle = '#06080c'; cx.fillRect(0, 0, cv.width, cv.height);
  if (GE.paint.animated(x.paint)) { NOWV.anim.set(cv, x); TH.enqueue(() => GE.paint.draw(x.paint, cv, { ...x.po, t: performance.now() / 1000 })); return; }
  if (done) { cx.drawImage(done, 0, 0); return; }
  TH.enqueue(() => { if (!GE.paint.draw(x.paint, cv, { ...x.po })) return; const c2 = GE.paint.mk(cv.width, cv.height); c2.getContext('2d').drawImage(cv, 0, 0); NOWV.painted.set(key, c2); });
};
NOWV.painted = new Map(); NOWV.anim = new Map(); NOWV.vis = new Set();
NOWV.renderFeed = function () {
  const host = $('#feed'); if (!host) return; host.innerHTML = ''; NOWV.anim.clear();
  const list = GE.feed.list(NOWV.band);
  if (NOWV.band !== 'all') { const B = GE.BANDS[NOWV.band]; host.append(h('div', { class: 'band-h', style: `--c:${B.c}`, html: `<b>${B.name}</b><span>${esc(B.alt)} · ${esc(B.sensor)}</span>` })); }
  let grid = null, cols = null, hs = [0, 0];
  const flush = () => { grid = null; };
  for (const x of list) {
    const el = NOWV.cardEl(x);
    if (x.wide) { flush(); host.append(el); continue; }
    if (!grid) { grid = h('div', { class: 'masonry' }); cols = [h('div', { class: 'col' }), h('div', { class: 'col' })]; grid.append(...cols); host.append(grid); hs = [0, 0]; }
    const ci = hs[0] <= hs[1] ? 0 : 1; cols[ci].append(el); hs[ci] += (x.aspect || 0.9) + (x.arch === 'number' ? 0.5 : 0.62) + (x.by ? 0.16 : 0) + (x.cta ? 0.2 : 0);
  }
  NOWV.observe();
};
NOWV.observe = function () {
  if (!('IntersectionObserver' in window)) { NOWV.anim.forEach((x, cv) => NOWV.vis.add(cv)); return; }
  NOWV.io && NOWV.io.disconnect(); NOWV.vis.clear();
  NOWV.io = new IntersectionObserver((es) => { for (const e of es) { const cv = e.target; if (e.isIntersecting) NOWV.vis.add(cv); else NOWV.vis.delete(cv); } }, { root: $('#v-now'), rootMargin: '80px' });
  NOWV.anim.forEach((x, cv) => NOWV.io.observe(cv));
};
// animated eyes: CCTV and live scenes redraw at ~8 fps while visible
NOWV.animate = function () {
  if (APP.tab !== 'now' || APP.mode || APP.intro) return; const t = performance.now() / 1000;
  for (const cv of NOWV.vis) { const x = NOWV.anim.get(cv); if (!x) continue; GE.paint.draw(x.paint, cv, { ...x.po, t }); }
};
setInterval(() => { try { NOWV.animate(); } catch (e) { console.warn(e); } }, 125);
NOWV.openItem = function (x, el) {
  if (x.recon) { APP.setTab('threads'); GE.threads.openWs(x.recon); return; }
  const s = GE.SIT.byId[x.sit]; NOWV._item = x;
  if (x.arch === 'room') { GE.sheet.open(x.sit, { post: x.post }); return; }
  NOWV.open(s, el, { cam: x.cam, post: x.post, seg: x.arch === 'number' || (x.arch === 'sensor' && !x.post) ? 'room' : 'room' });
};
NOWV.tick = function () {
  const W = GE.world;
  const c = W.counts; const air = (c.flights || 0) + (c.military || 0) + (c.ga || 0) + GE.HELI_CIRCUITS.length;
  const a = $('#cAir'); if (a) a.textContent = fmt.n(air);
  const sh = $('#cShip'); if (sh) sh.textContent = fmt.n(GE.SHIPS.length);
  const ck = $('#nowClock'); if (ck) ck.textContent = GE.feed.hmsZ();
  const ht = $('#heroTele'); if (ht && GE.mainView) { const v = GE.mainView; const [la, lo, alt] = geo.ll(v.eye); ht.textContent = `ORBIT · ALT ${fmt.n(Math.round(alt))} KM · NADIR ${GE.feed.llz(la, lo)} · TERMINATOR ${W.sun.lat >= 0 ? 'N' : 'S'} · ${GE.feed.hmsZ()}`; }
  if (APP.tab !== 'now') return;
  const items = new Map([...GE.feed.user, ...GE.feed.items()].map((x) => [x.id, x]));
  for (const el of $$('#feed .fc[data-fid]')) { const x = items.get(el.dataset.fid); if (!x) continue; const t = el.querySelector('[data-tele]'); if (t && x.tele) { const s2 = x.tele(); if (t.textContent !== s2) t.textContent = s2; } const ro = el.querySelector('[data-ro]'); if (ro && typeof x.readout === 'function') ro.textContent = x.readout(); const w = el.querySelector('[data-watch]'); if (w) { const r = GE.rooms.byId[x.sit]; if (r) w.textContent = fmt.n(r.watching); } }
};
GE.rooms.drift = setInterval(() => { for (const r of Object.values(GE.rooms.byId)) r.watching += Math.round((Math.random() - 0.42) * r.rate * 3); }, 2000);

/* ---------- hero morph: card → live globe ---------- */
NOWV.open = function (s, cardEl, o = {}) {
  const wide = APP.isWide();
  const thumb = cardEl?.querySelector('.fr canvas') || cardEl?.querySelector('.evc');
  if (wide || !thumb || prefersReduced()) { GE.sheet.open(s.id, { ...o, fade: !wide }); return; }
  const r = thumb.getBoundingClientRect(); const app = $('#app').getBoundingClientRect();
  const M = $('#morph'); M.innerHTML = ''; const cv = document.createElement('canvas'); cv.width = thumb.width; cv.height = thumb.height; cv.getContext('2d').drawImage(thumb, 0, 0); M.append(cv);
  // target: the visible world above the sheet's medium detent
  const tw = app.width, th = app.height * 0.57;
  Object.assign(M.style, { left: '0px', top: '0px', width: tw + 'px', height: th + 'px', borderRadius: '18px', opacity: '1', transition: 'none' });
  const sx = r.width / tw, sy = r.height / th;
  M.style.transformOrigin = '0 0';
  M.style.transform = `translate(${r.left - app.left}px, ${r.top - app.top}px) scale(${sx}, ${sy})`;
  M.classList.add('on'); NOWV._morphCard = cardEl;
  cardEl.style.visibility = 'hidden';
  GE.sheet.open(s.id, { ...o, morph: true });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const k = GE.HASH && GE.HASH.slow ? +GE.HASH.slow : 1; M.style.transition = `transform ${0.62 * k}s cubic-bezier(.2,.9,.2,1), border-radius ${0.62 * k}s ease, opacity ${0.5 * k}s ease ${0.34 * k}s`;
    M.style.transform = 'translate(0,0) scale(1,1)'; M.style.borderRadius = '0px'; M.style.opacity = '0';
    setTimeout(() => { M.classList.remove('on'); cardEl.style.visibility = ''; }, 900 * k);
  }));
};
NOWV.foldBack = function (id) {
  const cardEl = (NOWV._morphCard && document.body.contains(NOWV._morphCard) && NOWV._morphCard.dataset.id === id) ? NOWV._morphCard : $(`#v-now .card[data-id="${id}"]`); const M = $('#morph');
  if (!cardEl || prefersReduced() || APP.isWide()) return false;
  const thumb = cardEl.querySelector('.fr canvas') || cardEl.querySelector('.evc'); if (!thumb) return false; const app = $('#app').getBoundingClientRect();
  M.innerHTML = ''; const cv = document.createElement('canvas'); cv.width = thumb.width; cv.height = thumb.height; cv.getContext('2d').drawImage(thumb, 0, 0); M.append(cv);
  const tw = app.width, th = app.height * 0.57;
  Object.assign(M.style, { left: '0px', top: '0px', width: tw + 'px', height: th + 'px', transformOrigin: '0 0', transition: 'none', transform: 'none', borderRadius: '0px', opacity: '0' });
  M.classList.add('on'); cardEl.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    const r = thumb.getBoundingClientRect();
    M.style.transition = 'transform .55s cubic-bezier(.3,.8,.2,1), border-radius .55s ease, opacity .18s ease';
    M.style.opacity = '1'; M.style.borderRadius = '18px';
    M.style.transform = `translate(${r.left - app.left}px, ${r.top - app.top}px) scale(${r.width / tw}, ${r.height / th})`;
    setTimeout(() => { M.classList.remove('on'); cardEl.style.visibility = ''; cardEl.classList.add('flash'); setTimeout(() => cardEl.classList.remove('flash'), 1200); }, 600);
  });
  return true;
};
