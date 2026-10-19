/* Live, Upload and the Attach sheet.
   Live: a simulated broadcast (rendered lakefront in a gale) that seals a segment every 10 s into a real
   SHA-256 hash chain signed with the device key; you appear on the globe as an eye with a view cone.
   Upload: a real file input; EXIF GPS/time are read with a tiny parser; you place it on a map; it is
   labelled Unverified everywhere. Attach: suggests where it belongs, kind, precision, hologram; posting
   lands in the room, the feed and on the globe. */
const LV = (GE.live = { on: false, segs: [], viewers: 0 });
GE.capture.live = LV;
const CAPm = GE.capture; const SPOTm = CAPm.spot;
/* ---------- eyes on the globe (people and cameras that are looking right now) ---------- */
GE.EYES = [
  { id: 'basco', lat: 20.4485, lon: 121.9705, hdg: 205, fov: 64, label: '@nadia_basco', kind: 'witness', live: true, sit: 'cyclone', post: 'cy1' },
  { id: 'kaoh', lat: 22.612, lon: 120.268, hdg: 250, fov: 72, label: 'HBR-07', kind: 'cctv', sit: 'cyclone', post: 'cy5' },
  { id: 'shib', lat: 35.6597, lon: 139.7002, hdg: 135, fov: 84, label: 'CAM 0412', kind: 'cctv', sit: 'shibuya' },
  { id: 'ines', lat: 40.13, lon: -8.05, hdg: 80, fov: 60, label: '@ines_coimbra', kind: 'witness', sit: 'fires', post: 'fi1' },
  { id: 'ola', lat: 69.649, lon: 18.957, hdg: 10, fov: 74, label: '@ola_tromso', kind: 'witness', sit: 'aurora' },
  { id: 'sak', lat: 31.597, lon: 130.56, hdg: 95, fov: 48, label: 'VOLCANO CAM 2', kind: 'cctv', sit: 'sakurajima' },
  { id: 'rafa', lat: 18.357, lon: 121.637, hdg: 40, fov: 60, label: '@rafa_aparri', kind: 'witness', sit: 'cyclone', post: 'cy6' },
];
GE.eyeLines = function (rangeR) {
  const out = []; const D = clamp((rangeR || 1) * EARTH_KM * 0.032, 0.2, 160);
  for (const e of GE.EYES) {
    const col = e.kind === 'you' ? [1, 0.86, 0.5, 0.95] : e.kind === 'cctv' ? [1, 0.66, 0.26, 0.7] : [0.96, 0.82, 0.48, 0.8];
    const tip = geo.vec(e.lat, e.lon, 0.03 + D * 0.004); const half = (e.fov / 2) * D2R; const h0 = e.hdg * D2R; const cs = [];
    for (const [da, z] of [[-half, 0], [half, 0], [half, D * 0.32], [-half, D * 0.32]]) { const [la, lo] = geo.dest(e.lat, e.lon, h0 + da, D); cs.push(geo.vec(la, lo, z)); }
    for (const c of cs) out.push({ pts: [tip, c], col });
    out.push({ pts: [...cs, cs[0]], col: [col[0], col[1], col[2], col[3] * 0.8] });
    const mid = geo.dest(e.lat, e.lon, h0, D); out.push({ pts: [tip, geo.vec(mid[0], mid[1], D * 0.16)], col: [col[0], col[1], col[2], 0.35], dashed: 1 });
  }
  return out;
};

/* ---------- Live ---------- */
const CHAT_LIVE = [['amara', 'Same at Oak Street — the trail is underwater'], ['kora', 'Stay back from the edge please 🙏'], ['sky', 'That spray must be 8 m'], ['geo', 'Buoy says 3.4 m waves, matches what we see'], ['hydro', 'Is the harbour gate closed?'], ['amara', 'Streaming this into the gale room'], ['ais', 'Two freighters sheltering off the breakwater'], ['kora', 'The sealed badge is so reassuring tbh']];
const nearestSits = (lat, lon, n = 3) => GE.SIT.list.filter((s) => !s.dyn).map((s) => ({ s, km: RM.kmBetween(lat, lon, s.lat, s.lon) })).sort((a, b) => a.km - b.km).slice(0, n);
LV.renderUI = function (host) {
  const near = nearestSits(SPOTm.lat, SPOTm.lon, 2); LV.sit = near[0].s;
  if (!LV.on) {
    host.innerHTML = `<div class="lv-pre glass strong"><div class="lvph"><span class="lvpill pre"><i></i>READY</span><b>Go live as a sealed eye</b></div>
      <p>Your camera becomes a sensor on the globe. Every 10 seconds the stream is sealed into a hash chain and signed on this device, with GPS, heading and motion. Rooms nearby can watch.</p>
      <div class="lvnear">${near.map(({ s, km }) => `<span>${ic('threads', 'xs')}${esc(s.short || s.title.split(' — ')[0])} · ${GE.feed.fmtDist(km)}</span>`).join('')}</div>
      <div class="lvfine mono">SIMULATED CAMERA · RENDERED SCENE · NO CAMERA OR MIC IS USED</div></div>`;
    return;
  }
  host.innerHTML = `<div class="lv-top"><span class="lvpill"><i></i>LIVE <b class="num" id="lvT">00:00</b></span><span class="lvv glass">${ic('eye', 'xs')}<b class="num" id="lvV">${LV.viewers}</b></span><span class="lvseal">${ic('seal', 'xs')}SEALED LIVE</span></div>
    <div class="lv-to glass">${ic('threads', 'xs')}<span>In the <b>${esc(LV.sit.short || LV.sit.title)}</b> room · ${GE.feed.fmtDist(RM.kmBetween(SPOTm.lat, SPOTm.lon, LV.sit.lat, LV.sit.lon))}</span></div>
    <div class="lv-chat" id="lvChat"></div><div class="lvrx" id="lvRx"></div>
    <div class="lv-tele mono" id="lvTele"></div><div class="lv-chain" id="lvChain"></div>`;
  LV.drawChain(); LV.chatRestore();
};
LV.start = async function () {
  if (LV.on) return; await GE.crypto.KEY.get();
  Object.assign(LV, { on: true, t0: Date.now(), segT: Date.now(), segs: [], viewers: 3, prev: '0'.repeat(64), chat: [], hdg: 64 });
  GE.EYES.push({ id: 'you', lat: SPOTm.lat, lon: SPOTm.lon, hdg: LV.hdg, fov: 62, label: 'You · LIVE', kind: 'you', live: true, sit: LV.sit?.id });
  LV.timer = setInterval(() => LV.seal(), 10000); LV.soc = setInterval(() => LV.social(), 1500);
  haptic([10, 30, 10]); CAPm.render(); APP.renderAccessory(); APP.toast(`${ic('live', 'sm')} You’re live · first segment seals in 10 s`);
};
LV.stop = function () {
  if (!LV.on) return; clearInterval(LV.timer); clearInterval(LV.soc); LV.on = false; LV.t1 = Date.now();
  const me = GE.EYES.find((e) => e.id === 'you'); if (me) { me.live = false; me.label = 'You · replay'; }
  CAPm.render(); APP.renderAccessory();
  const seg = LV.segs[LV.segs.length - 1];
  GE.attach.open({ kind: 'witness', tier: 'sealed-live', img: LV.posterImg || seg?.thumb, lat: SPOTm.lat, lon: SPOTm.lon, at: LV.t0, place: SPOTm.name, segs: LV.segs.length, dur: (LV.t1 - LV.t0) / 1000, hash: seg?.hash, hdg: LV.hdg, live: true });
};
LV.seal = async function () {
  const cv = $('#liveCv'); const small = GE.paint.mk(320, 180);
  if (cv && cv.width) small.getContext('2d').drawImage(cv, 0, 0, 320, 180); else GE.paint.draw('seawall', small, { skyline: true, noOSD: true, seed: 53, t: performance.now() / 1000 });
  const blob = await new Promise((r) => small.toBlob(r, 'image/jpeg', 0.7)); const bytes = new Uint8Array(await blob.arrayBuffer());
  const seg = { i: LV.segs.length, t0: LV.segT, t1: Date.now(), frame: await sha256(bytes), bytes: bytes.length, gps: { lat: +SPOTm.lat.toFixed(6), lon: +SPOTm.lon.toFixed(6), acc: 4 }, hdg: LV.hdg, imu: 500, prev: LV.prev };
  seg.hash = await sha256(canon(seg)); seg.sig = await GE.crypto.signHex(seg.hash); seg.thumb = small.toDataURL('image/jpeg', 0.6);
  if (!LV.posterImg) { const pc = GE.paint.mk(480, 300); pc.getContext('2d').drawImage(cv || small, 0, 0, 480, 300); LV.posterImg = pc.toDataURL('image/jpeg', 0.8); }
  LV.segs.push(seg); LV.prev = seg.hash; LV.segT = seg.t1; haptic(6);
  LV.drawChain(true); APP.renderAccessory();
};
LV.drawChain = function (flash) {
  const host = $('#lvChain'); if (!host) return;
  const blocks = LV.segs.map((s) => `<div class="seg ok" title="segment ${s.i} · ${s.hash}"><span class="si mono">#${String(s.i + 1).padStart(3, '0')}</span><img src="${s.thumb}" alt=""><span class="sh mono">${s.hash.slice(0, 8)}</span><span class="sk">${ic('seal', 'xs')}${s.sig ? 'signed' : 'hashed'}</span></div>`).join('<i class="ln"></i>');
  host.innerHTML = `${blocks}${LV.segs.length ? '<i class="ln"></i>' : ''}<div class="seg cur"><span class="si mono">#${String(LV.segs.length + 1).padStart(3, '0')}</span><div class="fill"><i id="lvFill"></i></div><span class="sh mono">sealing…</span></div>`;
  host.scrollLeft = host.scrollWidth; if (flash) host.lastElementChild.previousElementSibling?.previousElementSibling?.classList.add('flash');
};
LV.social = function () {
  if (!LV.on) return; LV.viewers += 1 + Math.floor(Math.random() * (LV.viewers > 60 ? 18 : 6));
  const chat = $('#lvChat'); const k = Math.floor((Date.now() - LV.t0) / 1500);
  const ev = k % 3 === 0 ? { join: ['amara', 'kora', 'sky', 'geo', 'hydro', 'ais', 'ola'][k % 7] } : { msg: CHAT_LIVE[k % CHAT_LIVE.length] };
  LV.chat.push(ev); if (LV.chat.length > 4) LV.chat.shift(); if (chat) LV.chatRestore();
  const rx = $('#lvRx'); if (rx) for (let i = 0; i < 2; i++) { const sp = h('span', { html: ic(['heart', 'eye', 'heart', 'bolt'][Math.floor(Math.random() * 4)], 'sm'), style: `--dx:${(Math.random() - 0.5) * 30}px` }); rx.append(sp); setTimeout(() => sp.remove(), 2700); }
};
LV.chatRestore = function () {
  const chat = $('#lvChat'); if (!chat) return;
  chat.innerHTML = LV.chat.map((e) => e.join ? `<div class="lj">${GE.avatarHTML(e.join)}<span><b>@${esc(GE.PEOPLE[e.join].h)}</b> joined</span></div>` : `<div class="bub">${GE.avatarHTML(e.msg[0])}<div class="bx glass"><b>@${esc(GE.PEOPLE[e.msg[0]].h)}</b>${esc(e.msg[1])}</div></div>`).join('');
};
LV.frame = function () {
  const cv = $('#liveCv'); if (!cv || CAPm.mode !== 'live') return;
  const W0 = Math.round(cv.clientWidth * 0.8), H0 = Math.round(cv.clientHeight * 0.8); if (!W0 || !H0) return;
  if (cv.width !== W0 || cv.height !== H0) { cv.width = W0; cv.height = H0; }
  const now = performance.now(); if (LV._lf && now - LV._lf < 40) return; LV._lf = now;
  GE.paint.draw('seawall', cv, { skyline: true, handheld: true, noOSD: true, seed: 53, t: now / 1000 });
  if (!LV.on) return;
  const tEl = $('#lvT'); if (tEl) tEl.textContent = fmt.dur((Date.now() - LV.t0) / 1000).slice(3);
  const vEl = $('#lvV'); if (vEl) vEl.textContent = fmt.n(LV.viewers);
  const f = $('#lvFill'); if (f) f.style.width = clamp((Date.now() - LV.segT) / 10000, 0, 1) * 100 + '%';
  const te = $('#lvTele'); if (te) te.textContent = `${GE.feed.llz(SPOTm.lat, SPOTm.lon)} · HDG ${String(LV.hdg + Math.round(Math.sin(now / 900) * 3)).padStart(3, '0')}° · ±4 M · ALT 182 M · SEG ${String(LV.segs.length + 1).padStart(3, '0')} · ${GE.feed.hmsZ()}`;
};
LV.showOnGlobe = function () {
  const back = LV.on; APP.setTab('globe'); Cam.flyTo({ lat: SPOTm.lat - 0.035, lon: SPOTm.lon - 0.05, range: 0.016, heading: 0.75, tilt: 1.0, shiftY: 0.06, shiftX: 0 }, { duration: 2.4 });
  APP.toast(back ? `${ic('eye', 'sm')} That cone is you — still live` : `${ic('eye', 'sm')} Your view cone on the globe`, 2600);
};

/* ---------- EXIF (read + write) ---------- */
const EX = (GE.exif = {});
EX.parse = function (buf) {
  try {
    const v = new DataView(buf); if (v.getUint16(0) !== 0xffd8) return null; let o = 2;
    while (o < v.byteLength - 4) { const m = v.getUint16(o); if ((m & 0xff00) !== 0xff00) break; const len = v.getUint16(o + 2); if (m === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return EX.tiff(v, o + 10); if (m === 0xffda) break; o += 2 + len; }
  } catch (e) { console.warn('exif', e); }
  return null;
};
EX.tiff = function (v, t) {
  const le = v.getUint16(t) === 0x4949; const u16 = (p) => v.getUint16(p, le), u32 = (p) => v.getUint32(p, le);
  const ifd = (p) => { const n = u16(p); const e = {}; for (let i = 0; i < n; i++) { const q = p + 2 + i * 12; e[u16(q)] = { type: u16(q + 2), count: u32(q + 4), off: q + 8 }; } return e; };
  const val = (en) => {
    if (!en) return null; const { type, count } = en; const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1; const p = size * count > 4 ? t + u32(en.off) : en.off;
    if (type === 2) { let s = ''; for (let i = 0; i < count; i++) { const c = v.getUint8(p + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); }
    if (type === 5 || type === 10) { const out = []; for (let i = 0; i < count; i++) { const a = type === 5 ? u32(p + i * 8) : v.getInt32(p + i * 8, le), b = type === 5 ? u32(p + i * 8 + 4) : v.getInt32(p + i * 8 + 4, le); out.push(b ? a / b : 0); } return count === 1 ? out[0] : out; }
    if (type === 3) return u16(p); if (type === 4) return u32(p); return v.getUint8(p);
  };
  const i0 = ifd(t + u32(t + 4)); const out = { make: val(i0[0x010f]), model: val(i0[0x0110]), date: val(i0[0x0132]) };
  if (i0[0x8769]) { const ex = ifd(t + val(i0[0x8769])); out.date = val(ex[0x9003]) || out.date; }
  if (i0[0x8825]) { const g = ifd(t + val(i0[0x8825])); const dms = (a) => (a && a.length === 3 ? a[0] + a[1] / 60 + a[2] / 3600 : null); const la = dms(val(g[2])), lo = dms(val(g[4])); if (la != null && lo != null) { out.lat = la * (val(g[1]) === 'S' ? -1 : 1); out.lon = lo * (val(g[3]) === 'W' ? -1 : 1); } const al = val(g[6]); if (al != null) out.alt = al; }
  return out;
};
EX.when = (s) => { const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; };
// write a little-endian TIFF/EXIF block with Make, Model, DateTimeOriginal and GPS (used by the sample)
EX.build = function ({ make, model, date, lat, lon, alt }) {
  const B = []; const u8 = (x) => B.push(x & 255), u16 = (x) => { u8(x); u8(x >> 8); }, u32 = (x) => { u16(x & 0xffff); u16(x >>> 16); };
  const str = (s) => { const a = [...new TextEncoder().encode(s), 0]; if (a.length % 2) a.push(0); return a; };
  const mk = str(make), md = str(model), dt = str(date);
  const IFD0 = 8, D0 = IFD0 + 2 + 5 * 12 + 4, pMk = D0, pMd = pMk + mk.length, pDt = pMd + md.length, EXIF = pDt + dt.length, pDo = EXIF + 2 + 12 + 4, GPS = pDo + dt.length, pLa = GPS + 2 + 7 * 12 + 4, pLo = pLa + 24, pAl = pLo + 24;
  const ent = (tag, type, count, v) => { u16(tag); u16(type); u32(count); u32(v); };
  const asc2 = (c) => c.charCodeAt(0);
  u16(0x4949); u16(42); u32(IFD0);
  u16(5); ent(0x010f, 2, mk.length - (mk[mk.length - 1] === 0 && mk[mk.length - 2] === 0 ? 1 : 0), pMk); ent(0x0110, 2, md.length - (md[md.length - 1] === 0 && md[md.length - 2] === 0 ? 1 : 0), pMd); ent(0x0132, 2, 20, pDt); ent(0x8769, 4, 1, EXIF); ent(0x8825, 4, 1, GPS); u32(0);
  B.push(...mk, ...md, ...dt);
  u16(1); ent(0x9003, 2, 20, pDo); u32(0); B.push(...dt);
  u16(7); ent(0, 1, 4, 0x00000302); ent(1, 2, 2, asc2(lat >= 0 ? 'N' : 'S')); ent(2, 5, 3, pLa); ent(3, 2, 2, asc2(lon >= 0 ? 'E' : 'W')); ent(4, 5, 3, pLo); ent(5, 1, 1, 0); ent(6, 5, 1, pAl); u32(0);
  const rat = (x) => { const d = Math.floor(x), mm = Math.floor((x - d) * 60), ss = Math.round(((x - d) * 60 - mm) * 60 * 100); u32(d); u32(1); u32(mm); u32(1); u32(ss); u32(100); };
  rat(Math.abs(lat)); rat(Math.abs(lon)); u32(Math.round((alt || 0) * 10)); u32(10);
  const tiff = new Uint8Array(B); const seg = new Uint8Array(4 + 6 + tiff.length); const L = 2 + 6 + tiff.length;
  seg.set([0xff, 0xe1, L >> 8, L & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]); seg.set(tiff, 10); return seg;
};
EX.inject = (jpeg, app1) => { const out = new Uint8Array(jpeg.length + app1.length); out.set(jpeg.subarray(0, 2)); out.set(app1, 2); out.set(jpeg.subarray(2), 2 + app1.length); return out; };
const exifDate = (ms) => { const d = new Date(ms); const z = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}:${z(d.getUTCMonth() + 1)}:${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`; };

/* ---------- Upload ---------- */
const UP = (GE.upload = { f: null });
UP.renderUI = function (host) {
  const f = UP.f;
  if (!f) {
    host.innerHTML = `<div class="up glass strong"><div class="uph"><b>Add a photo or video of a place</b><span class="tierb unv">UNVERIFIED</span></div>
      <p>Uploads weren’t sealed when they were taken, so they carry an <b>Unverified</b> label everywhere. A hypothesis can cite one, but it can never become an observation.</p>
      <label class="drop"><input type="file" id="upFile" accept="image/*,video/*" hidden>${ic('gallery', 'lg')}<b>Choose from your library</b><span>A JPEG with location in its EXIF places itself</span></label>
      <button class="btn sm" id="upSample" style="width:100%">${ic('sparkles', 'sm')}No photo handy? Use a sample with GPS in its EXIF</button>
      <p class="fine mono">READ LOCALLY WITH FILEREADER · NOTHING LEAVES THIS PAGE</p></div>`;
    $('#upFile').addEventListener('change', (e) => { const file = e.target.files && e.target.files[0]; if (file) UP.load(file); });
    $('#upSample').addEventListener('click', () => UP.sample());
    return;
  }
  const ex = f.exif || {}; const has = f.lat != null;
  host.innerHTML = `<div class="up glass strong loaded"><div class="upimg"><img src="${f.img}" alt="Your upload"><span class="tierb unv">UNVERIFIED</span></div>
    <div class="exif mono"><div><span>FILE</span><b>${esc(f.name)} · ${fmt.k(f.size / 1024)} KB</b></div><div><span>CAMERA</span><b>${esc([ex.make, ex.model].filter(Boolean).join(' ') || '—')}</b></div><div><span>TAKEN</span><b>${ex.date ? esc(ex.date) : '—'}</b></div><div><span>GPS</span><b>${ex.lat != null ? GE.feed.llz(ex.lat, ex.lon) + ' · from EXIF' : 'none in file — place it'}</b></div></div>
    <div class="placer"><canvas id="upMap" width="640" height="300"></canvas><div class="pin" id="upPin">${ic('location', 'sm')}</div><div class="hint mono" id="upLL"></div></div>
    <div class="uptime"><span>When</span><input type="range" id="upT" min="-4320" max="0" step="5" value="${Math.round(((f.at || Date.now()) - Date.now()) / 60000)}"><b class="num" id="upTv"></b></div>
    <div class="btnrow"><button class="btn sm" id="upRe">Choose another</button><button class="btn gold sm" id="upGo">${ic('threads', 'sm')}Continue</button></div></div>`;
  UP.drawMap(); UP.bindPin();
  const t = $('#upT'); const tv = $('#upTv'); const upd = () => { f.at = Date.now() + +t.value * 60000; tv.textContent = `${fmt.hm(f.at)} UTC · ${fmt.ago(Date.now() - f.at)}`; }; t.addEventListener('input', upd); upd();
  $('#upRe').addEventListener('click', () => { UP.f = null; UP.renderUI(host); });
  $('#upGo').addEventListener('click', () => GE.attach.open({ kind: 'witness', tier: 'unverified', img: f.img, lat: f.lat, lon: f.lon, at: f.at, place: f.name, upload: true }));
};
UP.load = function (file) {
  const r = new FileReader();
  r.onload = () => {
    const buf = r.result; const ex = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name) ? EX.parse(buf) : null;
    const f = { name: file.name || 'upload', size: file.size, type: file.type, exif: ex, lat: ex?.lat ?? null, lon: ex?.lon ?? null, at: EX.when(ex?.date) || file.lastModified || Date.now() };
    if (f.lat == null) { f.lat = GE.ME.lat; f.lon = GE.ME.lon; f.guess = true; }
    const url = URL.createObjectURL(file);
    const done = (cv) => { f.img = cv.toDataURL('image/jpeg', 0.82); UP.f = f; URL.revokeObjectURL(url); UP.renderUI($('#modeHost')); APP.toast(ex?.lat != null ? `${ic('location', 'sm')} Placed from EXIF GPS · ${GE.feed.llz(f.lat, f.lon)}` : `${ic('location', 'sm')} No GPS in this file — drag the pin`, 2600); };
    if (file.type.startsWith('video')) { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.src = url; v.addEventListener('loadeddata', () => { v.currentTime = Math.min(0.5, v.duration / 2 || 0); }, { once: true }); v.addEventListener('seeked', () => { const cv = GE.paint.mk(640, Math.round(640 * (v.videoHeight / v.videoWidth || 0.56))); cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); done(cv); }, { once: true }); v.addEventListener('error', () => APP.toast('Could not read that video here'), { once: true }); return; }
    const im = new Image(); im.onload = () => { const sc = Math.min(1, 1280 / Math.max(im.width, im.height)); const cv = GE.paint.mk(im.width * sc, im.height * sc); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); done(cv); }; im.onerror = () => APP.toast('Could not read that image'); im.src = url;
  };
  r.onerror = () => APP.toast('Could not read that file'); r.readAsArrayBuffer(file);
};
UP.sample = async function () {
  const cv = GE.paint.mk(1200, 900); GE.paint.draw('volcano', cv, { noOSD: true, t: 1 });
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.86)); const jpg = new Uint8Array(await blob.arrayBuffer());
  const app1 = EX.build({ make: 'Concept', model: 'Sample Phone', date: exifDate(Date.now() - 23 * 60000), lat: 31.5937, lon: 130.5626, alt: 4.2 });
  const file = new File([EX.inject(jpg, app1)], 'IMG_4021.JPG', { type: 'image/jpeg', lastModified: Date.now() - 20 * 60000 }); UP.load(file);
};
UP.drawMap = function () {
  const f = UP.f; const cv = $('#upMap'); if (!cv) return; const span = 4.2; const mv = GE.paint.mapView(f.lat, f.lon, span, cv.width, cv.height); UP.mv = mv;
  const ctx = cv.getContext('2d'); GE.paint.mapBase(ctx, mv, { lights: 1.1, relief: 0.8, land: '#18202b', sea: '#05080c', coast: '#5b6e86' }); GE.paint.graticule(ctx, mv, 1);
  for (const { s, km } of nearestSits(f.lat, f.lon, 6)) { const x = mv.X(s.lon), y = mv.Y(s.lat); if (x < 0 || y < 0 || x > cv.width || y > cv.height) continue; ctx.fillStyle = '#FF6A3D'; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill(); GE.paint.label(ctx, (s.short || s.title).toUpperCase(), x + 10, y, 15, '#fff'); }
  GE.paint.scaleBar(ctx, mv, 50, 18, cv.height - 18);
};
UP.bindPin = function () {
  const f = UP.f; const pin = $('#upPin'), cv = $('#upMap'); const place = () => { const r = cv.getBoundingClientRect(); const sx = r.width / cv.width; pin.style.left = UP.mv.X(f.lon) * sx + 'px'; pin.style.top = UP.mv.Y(f.lat) * sx + 'px'; $('#upLL').textContent = `${GE.feed.llz(f.lat, f.lon)} · ${f.guess ? 'GUESSED — DRAG ME' : f.moved ? 'PLACED BY YOU' : 'FROM EXIF'}`; };
  requestAnimationFrame(place); let drag = false;
  const mv = (e) => { if (!drag) return; const r = cv.getBoundingClientRect(); const sx = cv.width / r.width; const x = clamp((e.clientX - r.left) * sx, 0, cv.width), y = clamp((e.clientY - r.top) * sx, 0, cv.height); f.lat = UP.mv.lat(y); f.lon = UP.mv.lon(x); f.moved = true; f.guess = false; place(); };
  pin.addEventListener('pointerdown', (e) => { drag = true; pin.setPointerCapture(e.pointerId); e.preventDefault(); }); pin.addEventListener('pointermove', mv); pin.addEventListener('pointerup', () => { drag = false; haptic(4); });
  cv.addEventListener('click', (e) => { drag = true; mv(e); drag = false; });
};

/* ---------- Attach sheet ---------- */
const AT = (GE.attach = {});
const bandOfFam = (f) => ({ orbit: 'orbit', sky: 'sky', wx: 'sky', eyes: 'ground' })[f] || 'ground';
AT.open = function (c) {
  AT.c = c; const near = nearestSits(c.lat, c.lon, 3); const pre = CAPm.replyTo?.sit || (near[0].km < 400 ? near[0].s.id : 'new');
  AT.sel = pre; AT.kind = c.kind || 'witness'; AT.prec = c.upload ? '100' : 'exact'; AT.holo = !c.upload;
  const opts = [...(CAPm.replyTo && !near.some((n) => n.s.id === CAPm.replyTo.sit) ? [{ s: GE.SIT.byId[CAPm.replyTo.sit], km: RM.kmBetween(c.lat, c.lon, GE.SIT.byId[CAPm.replyTo.sit].lat, GE.SIT.byId[CAPm.replyTo.sit].lon) }] : []), ...near];
  const tier = c.tier === 'sealed-live' ? `SEALED LIVE · ${c.segs} SEGMENTS · ${fmt.dur(c.dur || 0).slice(3)}` : c.tier === 'sealed' ? 'SEALED · ECDSA P-256' : 'UNVERIFIED UPLOAD';
  const ov = $('#attachOv');
  ov.innerHTML = `<div class="att glass strong"><div class="grab"></div>
    <div class="ath"><div class="atimg"><img src="${c.img || ''}" alt=""><span class="tierb ${c.tier === 'unverified' ? 'unv' : ''}">${c.tier === 'unverified' ? '' : ic('seal', 'xs')}${tier}</span></div><div><h2>Where does this belong?</h2><p class="mono">${GE.feed.llz(c.lat, c.lon)} · ${fmt.hm(c.at)} UTC${c.hash ? ' · ' + c.hash.slice(0, 10) + '…' : ''}</p></div></div>
    <div class="ath2">Suggested from where and when it was taken</div>
    <div class="sugs">${opts.map(({ s, km }) => `<button class="sug ${AT.sel === s.id ? 'on' : ''}" data-s="${s.id}" style="--c:${GE.BANDS[bandOfFam(s.fam)].c}"><i></i><span><b>${esc(s.short || s.title.split(' — ')[0])}</b><small>${GE.feed.fmtDist(km)} away · ${s.live ? 'live now' : 'replay'} · ${fmt.k(GE.rooms.watching(s.id))} in room</small></span><em>${ic('check', 'xs')}</em></button>`).join('')}
      <button class="sug ${AT.sel === 'new' ? 'on' : ''}" data-s="new" style="--c:#fff"><i></i><span><b>New place</b><small>Start a room at ${GE.feed.llz(c.lat, c.lon)}</small></span><em>${ic('check', 'xs')}</em></button></div>
    <div class="ath2">Post as</div><div class="kinds2">${Object.entries(GE.rooms.KINDS).map(([k, K]) => `<button data-k="${k}" class="${AT.kind === k ? 'on' : ''}">${K.name}</button>`).join('')}</div>
    <textarea id="atNote" rows="2" placeholder="${c.live ? 'Waves are coming over the lakefront trail…' : 'What does this show? (optional)'}"></textarea>
    <div class="ath2">Share location as</div><div class="prec">${[['exact', 'Exact'], ['100', '100 m'], ['1000', '1 km']].map(([k, l]) => `<button data-p="${k}" class="${AT.prec === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="fine2">${c.tier === 'unverified' ? 'An upload has no seal, so precision is all anyone gets.' : 'The seal still proves the exact point to verifiers without publishing it.'}</p>
    <div class="row2 holo"><span class="ri" style="--c:var(--b-inside)">${ic('cube')}</span><span class="rt">Leave it here as a hologram<small>People who come to this spot later can find it</small></span><button class="sw2 ${AT.holo ? 'on' : ''}" id="atHolo" role="switch" aria-label="Hologram"></button></div>
    <p class="fine2 priv">${ic('eyeslash', 'xs')} Faces and plates are blurred on-device before upload in the native build. This web concept does not blur — a disclosed limitation.</p>
    <div class="btnrow"><button class="btn" id="atX">Cancel</button><button class="btn gold" id="atGo">${ic('arrowup', 'sm')}Post</button></div></div>`;
  ov.classList.add('on');
  ov.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { AT.sel = b.dataset.s; ov.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); AT.label(); haptic(4); }));
  ov.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { AT.kind = b.dataset.k; ov.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); haptic(3); }));
  ov.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { AT.prec = b.dataset.p; ov.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); haptic(3); }));
  $('#atHolo').addEventListener('click', (e) => { AT.holo = !AT.holo; e.currentTarget.classList.toggle('on', AT.holo); });
  $('#atX').addEventListener('click', () => ov.classList.remove('on'));
  $('#atGo').addEventListener('click', () => AT.post());
  AT.label();
};
AT.label = function () { const b = $('#atGo'); if (!b) return; const s = GE.SIT.byId[AT.sel]; b.innerHTML = `${ic('arrowup', 'sm')}Post to ${esc(s ? (s.short || s.title.split(' — ')[0]) : 'a new room')}`; };
AT.post = async function () {
  const c = AT.c; let sitId = AT.sel;
  if (sitId === 'new') { sitId = 'mine-' + Date.now(); GE.SIT.list.push({ id: sitId, short: 'Your place', fam: 'eyes', kind: 'place', title: 'New place · ' + (c.place || 'your capture'), place: GE.feed.llz(c.lat, c.lon), lat: c.lat, lon: c.lon, camera: { lat: c.lat - 0.01, lon: c.lon - 0.01, range: 0.01, heading: 0.4, tilt: 1.0 }, layers: ['signed', 'holo', 'cctv'], source: 'You', live: true, watchers: 12, updatedAt: Date.now(), metric: () => ['', ''], metrics: () => [{ v: 1, u: '', l: 'Captures', s: 'You' }, { v: 0, u: '', l: 'Replies', s: '' }, { v: '—', u: '', l: 'Nearby rooms', s: '' }], brief: { lede: 'A place you started. Others nearby will see it.', series: [], sources: [] } }); GE.SIT.byId[sitId] = GE.SIT.list[GE.SIT.list.length - 1]; }
  const s = GE.SIT.byId[sitId]; const room = GE.rooms.get(sitId);
  const q = AT.prec === 'exact' ? 0 : AT.prec === '100' ? 0.001 : 0.01; const rd = (x) => (q ? Math.round(x / q) * q : x);
  const km = RM.kmBetween(c.lat, c.lon, s.lat, s.lon);
  const note = ($('#atNote').value || '').trim() || (c.live ? 'Live from the lakefront: waves are breaking over the trail and the path is closed.' : c.upload ? 'Photo from my library, placed from its EXIF.' : 'Sealed capture from here.');
  const p = { id: 'y' + Date.now(), kind: AT.kind, by: 'you', at: c.at || Date.now(), text: note, mine: true, place: { lat: rd(c.lat), lon: rd(c.lon), label: c.place || 'Your capture' }, att: { img: c.img, tier: c.tier, segs: c.segs, distKm: c.tier === 'unverified' ? null : Math.min(km, 4.9) }, reacts: {}, replies: 0, prec: AT.prec };
  if (CAPm.replyTo?.post) p.replyTo = CAPm.replyTo.post;
  room.posts.push(p); const e = await GE.rooms.append(room, 'post.' + AT.kind, 'you', { id: p.id, text: note, att: { tier: c.tier, hash: c.hash || null, segs: c.segs || 0 }, place: p.place, precision: AT.prec });
  // feed
  const tierT = c.tier === 'sealed-live' ? 'SEALED LIVE' : c.tier === 'sealed' ? 'SEALED' : 'UNVERIFIED';
  GE.feed.user.unshift({ id: 'f' + p.id, mine: true, arch: 'witness', band: 'inside', sit: sitId, post: p.id, by: 'you', img: c.img, aspect: 0.75, title: note.length > 90 ? note.slice(0, 88) + '…' : note, place: c.place || s.place, lat: c.lat, lon: c.lon, ago: 0, at: Date.now(), dist: 0, prio: 999,
    tele: () => `WITNESS · ${tierT} · ${AT.prec === 'exact' ? '±4 M' : AT.prec === '100' ? '±100 M' : '±1 KM'} · ${GE.feed.fmtDist(km).toUpperCase()} FROM EVENT` });
  // globe: hologram + an eye with a cone for sealed captures
  if (AT.holo) GE.world.userHolos.push({ lat: rd(c.lat), lon: rd(c.lon), title: 'Your capture · ' + (c.place || ''), by: 'you', at: c.at });
  if (c.tier !== 'unverified' && !GE.EYES.some((x) => x.id === 'you')) GE.EYES.push({ id: 'you', lat: c.lat, lon: c.lon, hdg: c.hdg ?? 64, fov: 62, label: 'You', kind: 'you', sit: sitId, post: p.id });
  const me = GE.EYES.find((x) => x.id === 'you'); if (me) { me.sit = sitId; me.post = p.id; }
  $('#attachOv').classList.remove('on'); CAPm.replyTo = null; if (c.upload) UP.f = null;
  GE.now.renderRail?.(); GE.now.renderFeed(); GE.you.render();
  APP.toast(`${ic('threads', 'sm')} Posted to ${esc(s.short || s.title.split(' — ')[0])} · ledger #${e.i}`, 2600); haptic([8, 30, 8]);
  GE.now._item = { band: 'inside', sit: sitId }; APP.setTab('globe', { force: true });
  setTimeout(() => { GE.sheet.open(sitId, { post: p.id }); setTimeout(() => GE.roomUI.resynth(GE.rooms.get(sitId), s, { auto: true }), 900); }, 250);
};
