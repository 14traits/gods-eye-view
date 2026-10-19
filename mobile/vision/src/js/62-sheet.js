/* Situation sheet: detents (peek / medium / large), drag with velocity snapping, the world always
   wins (touching the globe collapses to peek). Tufte-grade brief: direct-labelled sparklines with
   uncertainty, small multiples rendered from the globe, evidence strip, every number sourced + aged. */
const SH = (GE.sheet = { id: null, detent: 'medium', seg: 'room' });
const sheetEl = () => $('#sheet');
SH.heights = function () {
  const H = $('#app').clientHeight; const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
  return { peek: 112 + sab, medium: Math.round(H * 0.45), large: Math.round(H * 0.92), H };
};
SH.setDetent = function (d, animate = true) {
  SH.detent = d; const el = sheetEl(); if (APP.isWide()) { el.classList.add('wopen'); return; }
  const hs = SH.heights(); const full = el.offsetHeight || hs.H; const vis = hs[d];
  el.classList.toggle('drag', !animate);
  el.style.transform = `translateY(${Math.max(0, full - vis)}px)`;
  const sc = $('#sheetC'); sc.style.overflowY = d === 'large' ? 'auto' : 'hidden'; sc.style.touchAction = d === 'large' ? 'pan-y' : 'none';
  if (d !== 'large') sc.scrollTop = 0;
  SH.targetShift = d === 'large' ? 0.75 : clamp(vis / hs.H, 0, 0.8);
};
SH.open = function (id, o = {}) {
  const s = GE.SIT.byId[id]; if (!s) return;
  const W = GE.world;
  SH.fromTab = APP.mode === 'situation' ? SH.fromTab : APP.tab; SH.id = id; SH.sit = s; SH.opts = o; SH.seg = o.seg || 'room';
  if (APP.tab !== 'globe' && !APP.isWide()) { APP.tab = 'globe'; $('#app').dataset.tab = 'globe'; $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'globe')); $$('.pane .view').forEach((v) => v.classList.remove('on')); APP.moveLens(); }
  APP.setMode('situation');
  // layers & time window
  SH._savedLayers = SH._savedLayers || W.layers.map((l) => l.on);
  for (const lid of s.layers || []) if (W.layerById[lid]) W.layerById[lid].on = true;
  bus.emit('layers', W.layers);
  if (s.time) { W.setWindow({ start: s.time.start ?? s.time.at - 6 * 3600000, end: s.time.end ?? s.time.at + 6 * 3600000 }); W.setTime(s.time.at); }
  W.auroraK = s.auroraK ?? 0.85;
  GE.setExtras && GE.setExtras(s.id); GE.setLabels3d(s.thread ? GE.threads.data[s.thread].labels : s.labels3d); GE.roomUI.labels(s, o.post);
  // camera
  const cam = o.cam || GE.SIT.cameraFor(s);
  const hs = SH.heights();
  const shiftY = APP.isWide() ? 0 : hs.medium / hs.H;
  SH.targetShift = shiftY;
  Cam.autoSpin = 0;
  if (o.morph) { Cam.set({ ...cam, shiftY, shiftX: 0 }); Cam.flyTo({ range: cam.range * 0.82, heading: cam.heading + 0.12 }, { duration: 2.6 }); }
  else Cam.flyTo({ ...cam, shiftY, shiftX: 0 });
  W.focus = s.kind === 'recon' ? null : { lat: s.lat, lon: s.lon, k: 0.35 };
  SH.render(s);
  const el = sheetEl();
  if (APP.isWide()) { el.classList.add('wopen'); }
  else { el.classList.add('drag'); el.style.transform = 'translateY(100%)'; requestAnimationFrame(() => requestAnimationFrame(() => SH.setDetent(o.detent || 'medium'))); }
  if (o.ride && s.ride) setTimeout(() => GE.ride.start({ kind: 'heli', id: 0 }), 650);
  APP.updateChrome();
};
SH.close = function (silent, keepTime) {
  if (!SH.id) return; const id = SH.id; const W = GE.world;
  const el = sheetEl(); el.classList.remove('drag', 'wopen'); el.style.transform = APP.isWide() ? '' : 'translateY(100%)';
  SH.id = null; W.focus = null; GE.setExtras && GE.setExtras(null); GE.setLabels3d(null); GE.roomUI.composer(false);
  if (SH._savedLayers) { W.layers.forEach((l, i) => (l.on = SH._savedLayers[i])); SH._savedLayers = null; bus.emit('layers', W.layers); }
  if (!keepTime) { W.setWindow(null); W.setTime(null); } W.auroraK = 0.85;
  APP.setMode('');
  if (silent) return;
  const fromNow = !APP.isWide() && GE.now && $(`#v-now .card[data-id="${id}"]`);
  if (SH.fromTab === 'threads' || SH.fromTab === 'you') APP.setTab(SH.fromTab, { force: true });
  else if (fromNow) { APP.setTab('now', { force: true }); requestAnimationFrame(() => GE.now.foldBack(id)); }
  else { Cam.flyTo({ range: Math.max(Cam.range * 3, 0.6), shiftY: APP.isWide() ? 0 : 0.06, tilt: 0 }); }
};

/* drag */
SH.initDrag = function () {
  const el = sheetEl(); let st = null;
  const begin = (e) => {
    if (APP.isWide()) return;
    const onGrab = e.target.closest('#grab'); const sc = $('#sheetC');
    if (!onGrab && SH.detent === 'large') return;
    if (e.target.closest('button, a, input, textarea, .evid, .multi')) return;
    st = { y: e.clientY, y0: e.clientY, t: performance.now(), base: new DOMMatrix(getComputedStyle(el).transform).m42, moved: 0, id: e.pointerId, samples: [] };
    el.setPointerCapture?.(e.pointerId);
  };
  el.addEventListener('pointerdown', begin);
  el.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dy = e.clientY - st.y0; st.moved = Math.max(st.moved, Math.abs(dy));
    if (st.moved < 4) return;
    el.classList.add('drag');
    const hs = SH.heights(); const full = el.offsetHeight; const minY = full - hs.large, maxY = full - hs.peek + 40;
    let y = st.base + dy; if (y < minY) y = minY - Math.sqrt(minY - y) * 3; if (y > maxY) y = maxY + Math.sqrt(y - maxY) * 3;
    el.style.transform = `translateY(${y}px)`;
    st.samples.push({ t: performance.now(), y: e.clientY }); if (st.samples.length > 6) st.samples.shift();
    SH.targetShift = clamp((full - y) / hs.H, 0, 0.8);
  });
  const end = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const s0 = st.samples[0], s1 = st.samples[st.samples.length - 1];
    const v = s0 && s1 && s1.t > s0.t ? (s1.y - s0.y) / (s1.t - s0.t) : 0; // px/ms
    const hs = SH.heights(); const full = el.offsetHeight;
    const cur = new DOMMatrix(getComputedStyle(el).transform).m42; const visNow = full - cur + -v * 220;
    if (st.moved >= 4) {
      if (visNow < hs.peek * 0.6 && v > 0.6) { SH.close(); st = null; return; }
      const ds = ['peek', 'medium', 'large']; let best = 'medium', bd = 1e9; for (const d of ds) { const dd = Math.abs(hs[d] - visNow); if (dd < bd) { bd = dd; best = d; } }
      SH.setDetent(best); haptic(5);
    } else if (e.target.closest('#grab')) { SH.setDetent(SH.detent === 'peek' ? 'medium' : SH.detent === 'medium' ? 'large' : 'medium'); }
    st = null;
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  bus.on('globe-touch', () => { if (SH.id && SH.detent !== 'peek' && !APP.isWide()) SH.setDetent('peek'); });
  $('#back').addEventListener('click', () => { if (APP.mode === 'situation') SH.close(); });
  $('#sitFollow').addEventListener('click', () => { if (!SH.id) return; APP.following = SH.id === 'cyclone' || !SH.sit.accessory ? 'cyclone' : SH.id; APP.toast(`${ic('bell', 'sm')} Following · alerts within your radius`); haptic(10); });
  $('#sitShare').addEventListener('click', () => APP.toast(`${ic('link', 'sm')} Link copied · opens at this place &amp; time`));
};

/* ---------- content ---------- */
function sparkSVG(sr, w) {
  const hgt = 46, pad = 3; const d = sr.data; const n = d.length;
  const band = sr.band || 0;
  let mn = Math.min(...d) - band, mx = Math.max(...d) + band; if (mx - mn < 1e-6) { mx += 1; mn -= 1; }
  const X = (i) => pad + (i / (n - 1)) * (w - pad * 2 - 34), Y = (v) => pad + 6 + (1 - (v - mn) / (mx - mn)) * (hgt - pad * 2 - 12);
  const split = sr.split ?? n - 1;
  const path = (a, b) => d.slice(a, b + 1).map((v, k) => `${k ? 'L' : 'M'}${X(a + k).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  let s = '';
  if (band) { const up = d.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v + band * (i > split ? 1 + (i - split) * 0.35 : 1)).toFixed(1)}`).join(''); const lo = d.map((v, i) => [X(i), Y(v - band * (i > split ? 1 + (i - split) * 0.35 : 1))]).reverse().map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(''); s += `<path d="${up}${lo}Z" fill="rgba(124,196,255,.12)"/>`; }
  s += `<path d="${path(0, split)}" fill="none" stroke="#DCE6F5" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (split < n - 1) s += `<path d="${path(split, n - 1)}" fill="none" stroke="#8AB4F8" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  const iMax = d.indexOf(Math.max(...d)), iMin = d.indexOf(Math.min(...d));
  const f = sr.fmt || ((v) => v);
  s += `<circle cx="${X(iMax)}" cy="${Y(d[iMax])}" r="2.2" fill="#FF8A6B"/><text x="${X(iMax)}" y="${Y(d[iMax]) - 5}" font-size="9.5" fill="rgba(232,238,248,.6)" text-anchor="middle" font-family="var(--font)">${f(d[iMax])}</text>`;
  if (iMin !== iMax) s += `<circle cx="${X(iMin)}" cy="${Y(d[iMin])}" r="2.2" fill="#7CC4FF"/><text x="${X(iMin)}" y="${Y(d[iMin]) + 13}" font-size="9.5" fill="rgba(232,238,248,.6)" text-anchor="middle" font-family="var(--font)">${f(d[iMin])}</text>`;
  const ln = split; s += `<circle cx="${X(ln)}" cy="${Y(d[ln])}" r="3" fill="#fff"/><text x="${X(ln) + 6}" y="${Y(d[ln]) + 3.5}" font-size="10.5" font-weight="700" fill="#fff" font-family="var(--font)">${f(d[ln])}</text>`;
  if (split < n - 1) s += `<line x1="${X(split)}" x2="${X(split)}" y1="2" y2="${hgt - 2}" stroke="rgba(255,255,255,.18)" stroke-dasharray="2 2"/><text x="${X(split) + 3}" y="${hgt - 1}" font-size="8.5" fill="#8AB4F8" font-family="var(--font)">forecast</text>`;
  return `<svg viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}">${s}</svg>`;
}
GE.sparkSVG = sparkSVG;
function barsSVG(items, w) {
  const hgt = items.length * 22; let s = '';
  items.forEach(([k, v], i) => { const y = i * 22; s += `<text x="0" y="${y + 14}" font-size="12" fill="rgba(232,238,248,.75)" font-family="var(--font)">${k}</text><rect x="92" y="${y + 6}" width="${(w - 132) * v}" height="10" rx="3" fill="rgba(124,196,255,.55)"/><text x="${92 + (w - 132) * v + 6}" y="${y + 15}" font-size="11" fill="rgba(232,238,248,.55)" font-family="var(--font)">${Math.round(v * 100)}</text>`; });
  return `<svg viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}">${s}</svg>`;
}
const bandOfSit = (s) => (GE.now?._item?.sit === s.id ? GE.now._item.band : { orbit: 'orbit', sky: 'sky', wx: 'sky', eyes: 'ground' }[s.fam] || 'ground');
SH.render = function (s) {
  const el = $('#sheetC'); const b = bandOfSit(s); const B = GE.BANDS[b]; const room = GE.rooms.get(s.id);
  const live = s.live ? `<span class="badge live"><span class="dot pulse"></span>Live</span>` : s.d4 ? `<span class="badge d4">4D</span>` : `<span class="badge replay">Replay</span>`;
  const ppl = [...new Set(room.posts.map((p) => p.by))].slice(0, 5);
  el.innerHTML = `<div class="sh-hd"><div class="t"><div class="tags" style="--c:${B.c}"><span class="bt">${B.name.toUpperCase()}</span>${live}<span class="age num" data-sage>${fmt.ago(Date.now() - s.updatedAt)}</span></div>
    <h2>${esc(s.title)}</h2><div class="pl">${esc(s.place)} · <span class="mono">${fmt.ll(s.lat, s.lon, 2)}</span> · <b>${GE.feed.fmtDist(GE.feed.distFromMe(s.lat, s.lon))}</b> from you</div></div></div>
    <div class="presence-row"><span class="stack">${ppl.map((k) => GE.avatarHTML(k)).join('')}</span><span><b class="num" data-watch>${fmt.n(room.watching)}</b> watching</span><span class="rate">${room.rate} posts/min</span></div>
    <div class="seg2" id="shSegs"><button data-seg="room" class="${SH.seg === 'room' ? 'on' : ''}">${ic('threads', 'xs')}Room <span class="num">${room.posts.length}</span></button><button data-seg="brief" class="${SH.seg === 'brief' ? 'on' : ''}">${ic('signal', 'xs')}Brief &amp; sources</button></div>
    <div id="shSeg"></div>`;
  el.querySelectorAll('[data-seg]').forEach((bt) => bt.addEventListener('click', () => { SH.seg = bt.dataset.seg; el.querySelectorAll('[data-seg]').forEach((x) => x.classList.toggle('on', x === bt)); SH.renderSeg(s); haptic(4); }));
  SH.renderSeg(s);
};
SH.renderSeg = function (s) {
  const host = $('#shSeg'); GE.roomUI.composer(SH.seg === 'room');
  if (SH.seg === 'room') { GE.roomUI.render(host, s, { post: SH.opts?.post }); return; }
  SH.renderBrief(s, host);
};
SH.renderBrief = function (s, el) {
  const c = GE.FAM[s.fam].color;
  const ms = s.metrics();
  const live = s.live ? `<span class="badge live"><span class="dot pulse"></span>Live</span>` : s.d4 ? `<span class="badge d4">4D</span>` : `<span class="badge replay">Replay</span>`;
  const acts = [
    `<button class="act pri" data-a="follow">${ic('bellplus')}Follow</button>`,
    s.ride ? `<button class="act gold" data-a="ride">${ic('helicopter')}Ride</button>` : `<button class="act" data-a="replay">${ic('clock')}Replay</button>`,
    `<button class="act" data-a="eye">${ic('video')}Nearest eye</button>`,
    `<button class="act" data-a="thread">${ic('threads')}Thread</button>`,
  ].join('');
  const b = s.brief || {};
  el.innerHTML = `
  <div class="metrics" id="shMetrics">${ms.map((m) => `<div class="metric"><div class="v">${m.v}<small>${m.u}</small></div><div class="l">${m.l}</div><div class="s">${m.s}</div></div>`).join('')}</div>
  <div class="acts sh-acts">${acts}</div>
  <div class="brief">
    ${b.lede ? `<p>${esc(b.lede)}</p>` : ''}
    ${b.series?.length ? `<h3>Signals</h3><div id="shSeries"></div>` : ''}
    ${b.multiples ? `<h3>${esc(b.multiples.label)}</h3><div class="multi" id="shMulti"></div>` : ''}
    <h3>Evidence</h3><div class="evid" id="shEvid"></div>
    <h3>Sources</h3><div class="srcs">${(b.sources || []).map(([n, a, st]) => `<div class="r"><span class="st ${st === 'stale' ? 'stale' : ''}"></span><b style="font-weight:500">${esc(n)}</b><span>${esc(a)}</span></div>`).join('')}
      <div class="r"><span class="st"></span><b style="font-weight:500">Sun, terminator &amp; time</b><span>computed</span></div></div>
    ${s.thread ? `<div style="margin-top:18px"><button class="btn pri" data-a="thread" style="width:100%">${ic('threads')}Open the reconstruction</button></div>` : ''}
    <p style="margin-top:20px;font-size:11.5px;color:var(--text3)">Concept · illustrative data. People, handles, posts and claims shown here are fictional.</p>
  </div>`;
  const w = Math.max(240, (APP.isWide() ? $('#sheet').clientWidth : $('#app').clientWidth) - 36);
  if (b.series?.length) $('#shSeries').innerHTML = b.series.map((sr) => `<div class="sline"><span class="lab">${esc(sr.label)}</span><span class="val">${(sr.fmt || ((v) => v))(sr.data[sr.split ?? sr.data.length - 1])} ${esc(sr.unit)}</span>${sparkSVG(sr, w)}<div class="src"><span>${esc(sr.src)}</span><span>${sr.band ? '± band = uncertainty' : ''}</span></div></div>`).join('');
  if (b.multiples) {
    const mh = $('#shMulti');
    if (b.multiples.kind === 'bars') { mh.style.gridTemplateColumns = '1fr'; mh.innerHTML = barsSVG(b.multiples.items, w); }
    else for (const it of b.multiples.items) {
      const fig = h('figure'); const cv = h('canvas', { width: 180, height: 180 }); fig.append(cv, h('figcaption', { html: it.cap })); mh.append(fig);
      const spec = it.cam || { lat: s.lat, lon: s.lon, range: 0.2, heading: 0, tilt: 0.2 };
      TH.fallback(s, cv);
      TH.enqueue(() => { if (!document.body.contains(cv)) return; TH.render(spec, 180, 180, { at: Date.now() + it.h * 3600000, layers: s.layers, canvas: cv, px: 1.0 }); });
    }
  }
  // evidence strip — each tile is rendered from the globe near the place (signed captures, illustrative)
  const ev = $('#shEvid'); const people = ['tamang', 'hydro', 'sky', 'ais', 'geo', 'crowd'];
  const cam0 = GE.SIT.cameraFor(s) || { lat: s.lat, lon: s.lon, range: 0.01 };
  for (let i = 0; i < 5; i++) {
    const p = GE.PEOPLE[people[(i + s.id.length) % people.length]];
    const cv = h('canvas', { width: 232, height: 168 }); const im = h('div', { class: 'im' }); im.append(cv); cv.style.cssText = 'width:100%;height:100%;display:block';
    const near = cam0.range < 0.02;
    const spec = { lat: cam0.lat + (hash01(i + 3) - 0.5) * (near ? 0.01 : 0.6), lon: cam0.lon + (hash01(i + 9) - 0.5) * (near ? 0.012 : 0.6), range: near ? cam0.range * (0.35 + i * 0.12) : 0.004 + i * 0.003, heading: i * 1.3 + 0.4, tilt: 1.25 };
    TH.fallback({ ...s, thumbCam: spec }, cv);
    TH.enqueue(() => { if (!document.body.contains(cv)) return; TH.render(spec, 232, 168, { at: s.time?.at ?? null, layers: s.layers, canvas: cv, px: 1.0, extraSprites: GE.world.activeExtras?.sprites, extraLines: GE.world.activeExtras?.lines }); });
    im.insertAdjacentHTML('beforeend', `<svg class="seal"><use href="#i-seal"/></svg>`);
    const card = h('div', { class: 'ev' }, im, h('div', { class: 'cap', html: `<b>@${p.h}</b>${['Signed · IMU ✓ GPS ±5 m', 'Signed · horizon ✓', 'Signed · 12 s clip', 'Signed · heading ✓', 'Signed · audio sync'][i]}<br><span class="num">${fmt.ago((i + 1) * 1000 * 60 * (7 + i * 13))}</span>` }));
    ev.append(card);
  }
  el.querySelectorAll('[data-a]').forEach((btn) => btn.addEventListener('click', () => SH.action(btn.dataset.a, s)));
};
SH.tick = function () {
  if (!SH.id) return; const s = SH.sit; const ms = s.metrics(); const host = $('#shMetrics'); if (!host) return;
  host.querySelectorAll('.metric').forEach((m, i) => { const v = m.querySelector('.v'); const html = `${ms[i].v}<small>${ms[i].u}</small>`; if (v.innerHTML !== html) v.innerHTML = html; });
  const a = $('[data-sage]'); if (a) a.textContent = fmt.ago(Date.now() - s.updatedAt);
};
SH.action = function (a, s) {
  haptic(6);
  if (a === 'follow') { APP.following = s.accessory ? s.id : 'cyclone'; APP.toast(`${ic('bell', 'sm')} Following ${esc(s.title.split(' — ')[0])}`); }
  if (a === 'ride') GE.ride.start({ kind: 'heli', id: 0 });
  if (a === 'replay') { GE.world.setTime(Date.now() - 6 * 3600000); APP.toast(`${ic('clock', 'sm')} Replaying the last 6 h — drag the ribbon`); SH.setDetent('peek'); }
  if (a === 'eye') { const off = geo.dest(s.lat, s.lon, 0.7, 0.8); Cam.flyTo({ lat: off[0], lon: off[1], range: 0.0006, tilt: 1.1 }); SH.setDetent('peek'); APP.toast(`${ic('video', 'sm')} Nearest eye · public camera 0.8 km · illustrative`); }
  if (a === 'thread') { if (s.thread) { SH.close(true); APP.setTab('threads'); GE.threads.openWs(s.thread); } else APP.toast(`${ic('threads', 'sm')} Thread started · invite people to add observations`); }
};
