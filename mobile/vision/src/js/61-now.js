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
const famIcon = (f) => GE.FAM[f].icon;
function cardHTML(s) {
  const c = GE.FAM[s.fam].color;
  const [m, ml] = s.metric();
  const badge = s.d4 ? `<span class="badge d4">4D</span><span class="badge replay">Thread</span>` : s.live ? `<span class="badge live"><span class="dot pulse"></span>Live</span>` : `<span class="badge replay">${s.replayLabel ? 'Replay · ' + s.replayLabel.replace('Today ', '') : 'Replay'}</span>`;
  const right = s.thread ? `<span class="stack">${['tamang', 'hydro', 'kora', 'geo'].map((k) => `<span class="avatar sm" style="--h:${GE.PEOPLE[k].hue}">${GE.PEOPLE[k].h[0].toUpperCase()}</span>`).join('')}</span>` : `<span class="r">${ic('eye', 'xs')}<span class="num">${fmt.k(s.watchers)}</span></span>`;
  return `<div class="thumb" style="aspect-ratio:${1}/${s.aspect}"><canvas width="360" height="${Math.round(360 * s.aspect)}"></canvas>
    <div class="tl">${badge}</div><div class="tr" style="--c:${c}">${ic(famIcon(s.fam), 'sm')}</div>
    <div class="bl"><div class="metric num" data-m>${m}</div><div class="mlabel num" data-ml>${ml}</div></div></div>
    <div class="meta"><div class="ttl">${esc(s.title)}</div><div class="src"><span class="l"><span style="width:6px;height:6px;border-radius:50%;background:${c};flex:none"></span><span data-age>${esc(s.source)} · ${fmt.ago(Date.now() - s.updatedAt)}</span></span>${right}</div>
    ${s.ride ? `<button class="cta" data-ride>${ic('helicopter', 'sm')}Jump into the chopper</button>` : ''}</div>`;
}
NOWV.render = function () {
  const v = $('#v-now');
  const now = new Date();
  const kick = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  v.innerHTML = `<div class="navbar">Now</div>
  <div class="now-hero">
    <div class="lt"><div class="kicker"><span class="dot pulse"></span><span>${kick}</span>·<span class="num" id="nowClock">${fmt.hm(Date.now())} UTC</span></div>
      <div class="row"><h1>Now</h1><button class="avatar md" style="--h:205" aria-label="You" id="nowMe">Y</button></div></div>
    <div class="livebar"><span><b class="num" id="cSit">${GE.SIT.list.length}</b> situations</span><span><b class="num" id="cAir">–</b> aircraft</span><span><b class="num" id="cShip">–</b> vessels</span><span><b class="num" id="cSat">${fmt.n(GE.SATS.length)}</b> satellites</span></div>
  </div>
  <div class="now-body"><div class="chips" id="nowChips">
    ${[['all', 'For you'], ['now', 'Happening now'], ['near', 'Near you'], ['recon', 'Reconstructions'], ['always', 'Always on']].map(([k, l]) => `<button class="chip ${NOWV.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
  </div><div id="nowSecs"></div></div>`;
  $('#nowMe').addEventListener('click', () => APP.setTab('you'));
  $$('#nowChips .chip').forEach((b) => b.addEventListener('click', () => { NOWV.filter = b.dataset.f; $$('#nowChips .chip').forEach((x) => x.classList.toggle('on', x === b)); NOWV.renderSections(); haptic(4); }));
  NOWV.renderSections();
};
NOWV.renderSections = function () {
  const host = $('#nowSecs'); host.innerHTML = '';
  for (const sec of GE.SIT.sections) {
    if (NOWV.filter !== 'all' && NOWV.filter !== sec.id) continue;
    const items = GE.SIT.list.filter((s) => s.section === sec.id);
    const hd = h('div', { class: 'sec-h' }, h('h2', null, sec.title), h('span', null, sec.sub));
    const grid = h('div', { class: 'masonry' }); const cols = [h('div', { class: 'col' }), h('div', { class: 'col' })]; grid.append(...cols);
    const hs = [0, 0];
    for (const s of items) {
      const el = h('article', { class: 'card', 'data-id': s.id, tabindex: 0, role: 'button', 'aria-label': s.title }); el.innerHTML = cardHTML(s);
      const ci = hs[0] <= hs[1] ? 0 : 1; cols[ci].append(el); hs[ci] += s.aspect + 0.62;
      el.addEventListener('click', (e) => { if (e.target.closest('[data-ride]')) { e.stopPropagation(); NOWV.open(s, el, { ride: true }); return; } NOWV.open(s, el); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); NOWV.open(s, el); } });
      const cv = el.querySelector('canvas');
      const cached = TH.done.get(s.id);
      if (cached) cv.getContext('2d').drawImage(cached, 0, 0);
      else { TH.fallback(s, cv); TH.enqueue(() => { const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; TH.renderSituation(s, c2); TH.done.set(s.id, c2); $$(`.card[data-id="${s.id}"] canvas, .tcard[data-id="${s.id}"] canvas`).forEach((x) => { const xc = x.getContext('2d'); xc.drawImage(c2, 0, 0, x.width, x.height); }); }); }
    }
    host.append(hd, grid);
  }
};
NOWV.tick = function () {
  const W = GE.world;
  const c = W.counts; const air = (c.flights || 0) + (c.military || 0) + (c.ga || 0) + GE.HELI_CIRCUITS.length;
  const a = $('#cAir'); if (a) a.textContent = fmt.n(air);
  const sh = $('#cShip'); if (sh) sh.textContent = fmt.n(GE.SHIPS.length);
  const ck = $('#nowClock'); if (ck) ck.textContent = fmt.hm(Date.now()) + ' UTC';
  for (const el of $$('.card[data-id]')) {
    const s = GE.SIT.byId[el.dataset.id]; if (!s) continue;
    const [m, ml] = s.metric(); const me = el.querySelector('[data-m]'), mle = el.querySelector('[data-ml]');
    if (me && me.innerHTML !== m) { me.innerHTML = m; } if (mle && mle.innerHTML !== ml) mle.innerHTML = ml;
    const ag = el.querySelector('[data-age]'); if (ag) ag.textContent = `${s.source} · ${fmt.ago(Date.now() - s.updatedAt)}`;
  }
};

/* ---------- hero morph: card → live globe ---------- */
NOWV.open = function (s, cardEl, o = {}) {
  const wide = APP.isWide();
  const thumb = cardEl?.querySelector('.thumb canvas');
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
  const cardEl = $(`#v-now .card[data-id="${id}"]`); const M = $('#morph');
  if (!cardEl || prefersReduced() || APP.isWide()) return false;
  const thumb = cardEl.querySelector('.thumb canvas'); const app = $('#app').getBoundingClientRect();
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
