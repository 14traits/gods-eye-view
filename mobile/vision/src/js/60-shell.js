/* Shell: tabs, Liquid-Glass tab bar with sliding lens, tab-bar accessory (followed situation),
   minimize-on-scroll, layout (phone / two-pane / hinge), overlay labels, toasts. */
const APP = (GE.app = { tab: 'now', mode: '', following: 'cyclone', wide: false });
const appEl = () => $('#app');
APP.isWide = () => { try { return matchMedia('(min-width: 600px)').matches; } catch { return innerWidth >= 600; } };

APP.toast = function (html, ms = 2200) {
  const t = $('#toast'); t.innerHTML = html; t.classList.add('on'); clearTimeout(APP._tt); APP._tt = setTimeout(() => t.classList.remove('on'), ms);
};
APP.setMode = function (m) { APP.mode = m; appEl().dataset.mode = m; bus.emit('mode', m); APP.updateChrome(); };

/* ---------- tabs ---------- */
APP.setTab = function (tab, opts = {}) {
  const prev = APP.tab;
  if (prev === tab && !opts.force) { if (tab === 'now') $('#v-now').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (APP.mode === 'situation') GE.sheet.close(true);
  if (APP.mode === 'ride') GE.ride.exit(true);
  if (prev === 'capture') GE.capture.exit();
  if (prev === 'threads' && GE.threads.ws) GE.threads.closeWs(true);
  APP.tab = tab; appEl().dataset.tab = tab;
  $$('.tab').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
  APP.moveLens();
  const wide = APP.isWide();
  $$('.pane .view').forEach((v) => v.classList.remove('on'));
  const map = { now: '#v-now', threads: '#v-threads', you: '#v-you', globe: wide ? '#v-layers' : null };
  if (map[tab]) $(map[tab]).classList.add('on');
  $('#v-capture').classList.toggle('on', tab === 'capture');
  if (tab === 'capture') GE.capture.enter();
  if (tab === 'globe' && wide) GE.gui.renderLayersPane();
  APP.minimize(false);
  APP.cameraForTab(tab, prev);
  APP.updateChrome();
  haptic(6);
  bus.emit('tab', tab);
};
APP.cameraForTab = function (tab, prev) {
  const Cm = GE.cam; const wide = APP.isWide();
  if (tab === 'now') {
    Cm.flyTo(APP.heroCam(), { duration: prev ? 1.2 : 0 });
    Cm.autoSpin = 0.3;
  } else if (tab === 'globe') {
    Cm.autoSpin = 0;
    if (prev === 'now' || prev === 'you' || prev === 'threads' || !prev) Cm.flyTo({ range: Math.min(2.7, Math.max(Cm.range, 0.5)), shiftY: wide ? 0 : 0.06, shiftX: 0, tilt: 0 }, { duration: 1.0 });
  } else if (tab === 'you' || tab === 'threads') { Cm.autoSpin = 0.3; if (!wide) Cm.flyTo(APP.heroCam(), { duration: 0.9 }); }
};
APP.moveLens = function () {
  const on = $(`.tab[data-tab="${APP.tab}"]`); const lens = $('#tablens'); if (!on || !lens) return;
  lens.style.transform = `translateX(${on.offsetLeft}px)`; lens.style.width = on.offsetWidth + 'px';
};
APP.minimize = function (on) {
  if (APP._mini === on) return; APP._mini = on;
  $('#tabwrap').classList.toggle('mini', on);
  $('#accHost').classList.toggle('hidden', on || !APP.showAcc());
  setTimeout(APP.moveLens, 460); requestAnimationFrame(APP.moveLens);
};
APP.showAcc = () => !!APP.following && (APP.tab === 'now' || APP.tab === 'threads' || APP.tab === 'you' || (APP.isWide() && APP.tab === 'globe')) && !APP.mode;
APP.updateChrome = function () {
  const ride = APP.mode === 'ride', sit = APP.mode === 'situation', wsm = APP.mode === 'workspace';
  $('#tabwrap').classList.toggle('hidden', ride || ((sit || wsm) && !APP.isWide()) || APP.intro);
  $('#accHost').classList.toggle('hidden', !APP.showAcc() || APP._mini || APP.intro);
  $('#back').classList.toggle('on', sit);
  $('#sitbtns').classList.toggle('on', sit);
  // globe ribbon/dock offsets when the sheet is open (phone)
  const gb = $('#gbottom');
  gb.style.opacity = sit && !APP.isWide() ? '0' : ''; gb.style.pointerEvents = sit && !APP.isWide() ? 'none' : '';
};

/* ---------- accessory ---------- */
APP.renderAccessory = function () {
  // the tab-bar accessory follows a person, not a number: the live witness you follow (or you, when live)
  const me = GE.capture?.live; let ttl, sub, open;
  if (me && me.on) { ttl = `You’re live · ${fmt.dur((Date.now() - me.t0) / 1000).slice(3)}`; sub = `Sealed live · ${me.segs.length} segments · ${fmt.n(me.viewers)} watching`; open = () => APP.setTab('capture'); }
  else { const r = GE.rooms.byId.cyclone; const n = r ? r.watching : 3204; ttl = '@nadia_basco · Basco seawall'; sub = `Sealed live · Typhoon Halcyon room · ${fmt.n(n)} watching`; open = () => { const it = GE.feed.items().find((x) => x.id === 'basco'); GE.now._item = it; GE.sheet.open('cyclone', { post: 'cy1' }); }; }
  APP._accOpen = open;
  const html = `<span class="accdot"><span class="dot pulse"></span></span><span class="txt"><div class="ttl">${esc(ttl)}</div><div class="sub num">${esc(sub)}</div></span><canvas class="accv" width="120" height="68"></canvas><span class="ab"><svg class="ic sm"><use href="#i-chevu"/></svg></span>`;
  const a = $('#acc'); if (a._t !== ttl) { a.innerHTML = html; a._t = ttl; } else { a.querySelector('.ttl').textContent = ttl; a.querySelector('.sub').textContent = sub; }
  const m = $('#accMini'); if (m._k !== ttl + sub) { m.innerHTML = `<span class="dot pulse"></span><span class="txt"><div class="ttl">${esc(ttl)}</div><div class="sub num">${esc(sub)}</div></span>`; m._k = ttl + sub; }
};
APP.accFrame = function () { const cv = $('#acc .accv'); if (!cv || $('#accHost').classList.contains('hidden')) return; const me = GE.capture?.live; if (me && me.on) GE.paint.draw('seawall', cv, { skyline: true, noOSD: true, seed: 53, t: performance.now() / 1000 }); else GE.paint.draw('seawall', cv, { noOSD: true, seed: 52, t: performance.now() / 1000 }); };
setInterval(() => { try { APP.accFrame(); } catch {} }, 200);
function sparkPath(data, w, h, col, sw = 1.6) {
  const mn = Math.min(...data), mx = Math.max(...data), n = data.length;
  const pts = data.map((v, i) => [(i / (n - 1)) * (w - 4) + 2, h - 3 - ((v - mn) / (mx - mn || 1)) * (h - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const l = pts[pts.length - 1];
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${l[0]}" cy="${l[1]}" r="2.4" fill="${col}"/>`;
}
GE.sparkPath = sparkPath;

/* ---------- overlay labels on the globe ---------- */
const LBL = { els: new Map() };
APP.updateLabels = function (view) {
  const host = $('#labels'); if (!host) return;
  const want = [];
  const showPins = (APP.tab === 'globe' || APP.isWide()) && !APP.mode && !APP.intro;
  if (showPins) for (const s of GE.SIT.list) {
    if (s.dyn) continue;
    const short = s.short || s.title.split(/ [—–-] /)[0].slice(0, 28);
    want.push({ k: 's:' + s.id, lat: s.lat, lon: s.lon, alt: 0.2, pr: s.watchers, html: `<i style="--c:${GE.FAM[s.fam].color}"></i>${esc(short)}`, w: short.length * 6.6 + 32, cls: 'glass', onclick: () => GE.sheet.open(s.id, { fromGlobe: true }) });
  }
  const showEyes = (APP.tab === 'globe' || APP.isWide()) && !APP.intro && APP.mode !== 'ride' && APP.mode !== 'workspace';
  if (showEyes) for (const e of GE.EYES || []) { if (view.range > 0.9 && e.kind !== 'you') continue; const t = e.label + (e.live ? ' · LIVE' : ''); want.push({ k: 'e:' + e.id + (e.live ? 'L' : ''), lat: e.lat, lon: e.lon, alt: 0.05, pr: e.kind === 'you' ? 2e9 : 6e4, html: `<i class="ei k-${e.kind}"><svg class="ic xs"><use href="#i-${e.kind === 'cctv' ? 'video' : 'eye'}"/></svg></i>${esc(t)}`, w: t.length * 6.4 + 40, cls: 'glass eyelbl k-' + e.kind, onclick: () => { if (e.id === 'you' && GE.live.on) { APP.setTab('capture'); return; } if (e.sit) { const it = GE.feed.items().find((x) => x.post && x.post === e.post); GE.now._item = it || null; GE.sheet.open(e.sit, { post: e.post }); } } }); }
  if (GE.world.sel && GE.world.sel.v && APP.mode !== 'ride') want.push({ k: 'sel', v: GE.world.sel.v, pr: 1e9, html: `<b>${esc(GE.world.sel.title)}</b>`, w: 90, cls: 'plain tag' });
  for (const [k, l] of GE.extraLabels || []) want.push({ k, pr: 1e8, w: 120, ...l });
  want.sort((a, b) => b.pr - a.pr);
  const placed = []; const shown = new Set();
  const cap = view.range > 1.2 ? 7 : view.range > 0.3 ? 12 : 40;
  for (const l of want) {
    const p = l.v || geo.vec(l.lat, l.lon, l.alt || 0);
    const s = GE.world.project(view, p);
    if (!s || !s.vis || shown.size >= cap) continue;
    const tag = l.cls && l.cls.includes('tag');
    const box = tag ? [s.x + 10, s.y - 13, s.x + 10 + l.w, s.y + 13] : [s.x - l.w / 2, s.y - 36, s.x + l.w / 2, s.y - 8];
    if (placed.some((b) => !(box[2] < b[0] - 4 || box[0] > b[2] + 4 || box[3] < b[1] - 3 || box[1] > b[3] + 3))) continue;
    placed.push(box); shown.add(l.k);
    let el = LBL.els.get(l.k);
    if (!el) { el = h('button', { class: 'lbl ' + (l.cls || '') }); el.innerHTML = l.html; if (l.onclick) el.addEventListener('click', l.onclick); else el.style.pointerEvents = 'none'; host.append(el); LBL.els.set(l.k, el); }
    else if (el._html !== l.html) el.innerHTML = l.html;
    el._html = l.html; el.style.opacity = '1';
    el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${(s.y - (tag ? 0 : 8)).toFixed(1)}px, 0) translate(${tag ? '10px, -50%' : '-50%, -100%'})`;
  }
  for (const [k, el] of LBL.els) if (!shown.has(k)) { if (!want.some((w) => w.k === k)) { el.remove(); LBL.els.delete(k); } else el.style.opacity = '0'; }
};
APP.heroCam = function () {
  const W = GE.world; const sun = W.sun;
  if (!APP._heroLon || Math.abs((APP._heroT || 0) - Date.now()) > 600000) {
    let best = sun.lon + 70, bs = -1;
    for (const off of [-80, -65, 65, 80]) { const lon0 = sun.lon + off; let sum = 0; for (let la = -50; la <= 65; la += 7) for (let lo = -60; lo <= 60; lo += 7) { const L = lon0 + lo; const v = geo.vec(la, L); if (v3.dot(v, sun.dir) < -0.05 && geo.dist(24, lon0, la, L) < 1.15) sum += W.lightsAt(la, ((L + 540) % 360) - 180); } if (sum > bs) { bs = sum; best = lon0; } }
    APP._heroLon = ((best + 540) % 360) - 180; APP._heroT = Date.now();
  }
  const sl = APP._heroLon - 66; return APP.isWide() ? { lat: 20, lon: sl + 62, range: 2.6, heading: 0, tilt: 0, shiftY: 0, shiftX: 0 } : { lat: 24, lon: sl + 66, range: 2.85, heading: 0, tilt: 0, shiftY: 0.5, shiftX: 0 }; };
GE.extraLabels = new Map();

/* ---------- wiring ---------- */
APP.initShell = function () {
  $$('.tab').forEach((b) => b.addEventListener('click', () => APP.setTab(b.dataset.tab)));
  const openFollowed = () => (APP._accOpen ? APP._accOpen() : GE.sheet.open(APP.following));
  $('#acc').addEventListener('click', openFollowed); $('#accMini').addEventListener('click', openFollowed);
  $('#btnSearch').addEventListener('click', () => GE.gui.openSearch());
  // minimize tab bar on scroll (feed-like views)
  for (const id of ['#v-now', '#v-threads', '#v-you']) {
    const v = $(id); let last = 0;
    v.addEventListener('scroll', () => {
      const y = v.scrollTop; const dy = y - last; last = y;
      if (y < 40) APP.minimize(false); else if (dy > 4) APP.minimize(true); else if (dy < -6) APP.minimize(false);
      const nb = v.querySelector('.navbar'); if (nb) nb.classList.toggle('on', y > (id === '#v-now' ? (APP.isWide() ? 90 : 250) : 60));
      clearTimeout(v._st); v._st = setTimeout(() => APP.minimize(false), 1400);
      bus.emit('scroll', { id, y });
    }, { passive: true });
  }
  addEventListener('resize', () => { APP.moveLens(); const w = APP.isWide(); if (w !== APP.wide) { APP.wide = w; APP.setTab(APP.tab, { force: true }); } });
  APP.wide = APP.isWide();
  setInterval(APP.renderAccessory, 1000); APP.renderAccessory();
  requestAnimationFrame(APP.moveLens);
};
