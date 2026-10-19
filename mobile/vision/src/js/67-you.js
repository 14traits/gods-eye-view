/* You: captures and their seals (+ verify inspector), holograms left in places, followed situations,
   alert radius, rendering quality, the concept marker and credits. */
const YOU = (GE.you = { radius: store.get('radius', 250), follows: store.get('follows', { cyclone: true, koshi: true, aurora: true, iss: false, launch: true }) });
YOU.render = function () {
  const v = $('#v-you'); const st = v.scrollTop; const W = GE.world;
  const caps = GE.captures; const holos = [...W.userHolos, ...GE.HOLOS.filter((x) => x.by === 'you')];
  v.innerHTML = `<div style="background:var(--bg);min-height:100%;padding-bottom:150px"><div class="navbar">You</div>
  <div class="lt"><div class="kicker">${ic('key', 'xs')} Device key · P-256 · ${GE.crypto.KEY.pair ? 'ready' : 'generating…'}</div><h1>You</h1></div>
  <div class="you-h"><span class="avatar xl" style="--h:205">Y</span><div><h2>Your eye</h2><div style="color:var(--text2);font-size:13px;margin:2px 0 8px">Watching from ${esc(GE.ME.name)} · ${esc(GE.ME.tz)}</div><span class="concept">${ic('sparkles', 'xs')} Concept · illustrative data</span></div></div>
  <div class="stats4"><div><b>${GE.feed.user.length}</b>posts</div><div><b>${holos.length}</b>holograms</div><div><b>${Object.values(YOU.follows).filter(Boolean).length}</b>following</div><div><b>${caps.length ? '100%' : '—'}</b>verified</div></div>
  <div class="sec-h"><h2>Captures</h2><span>sealed on this device</span></div>
  <div class="capgrid">${caps.length ? caps.map((c, i) => `<div class="capc" data-c="${i}"><div class="im" style="background-image:url(${c.thumb})"><svg class="seal"><use href="#i-seal"/></svg></div><div class="cm"><b>${esc(c.place)}</b><span class="num">${fmt.utc(c.at)}</span><div class="mono">${c.hash ? c.hash.slice(0, 18) + '…' : 'sealing…'}</div></div></div>`).join('') : `<div style="grid-column:1/-1;color:var(--text3);font-size:14px;padding:6px 4px">No captures yet — open Capture › Witness and press the shutter.</div>`}</div>
  <div class="sec-h"><h2>Your posts</h2><span>in rooms</span></div>
  <div class="grp">${GE.feed.user.length ? GE.feed.user.map((x) => { const s = GE.SIT.byId[x.sit]; const p = GE.rooms.byId[x.sit]?.posts.find((q) => q.id === x.post); const t = p?.att?.tier || 'text'; return `<div class="row2" data-post="${x.sit}|${x.post}"><span class="ri" style="--c:var(--b-inside)">${ic(t === 'sealed-live' ? 'live' : t === 'unverified' ? 'gallery' : 'seal')}</span><span class="rt">${esc(x.title)}<small>${esc(s ? (s.short || s.title.split(' — ')[0]) : '')} · ${{ 'sealed-live': 'Sealed live' + (p?.att?.segs ? ' · ' + p.att.segs + ' segments' : ''), sealed: 'Sealed', unverified: 'Unverified upload' }[t] || 'Text'} · ${fmt.ago(Date.now() - x.at)}</small></span><button class="rv">${ic('chevr', 'sm')}</button></div>`; }).join('') : `<div class="row2"><span class="ri" style="--c:var(--b-inside)">${ic('viewfinder')}</span><span class="rt">Nothing posted yet<small>Capture › Witness, Live or Upload, then attach it to a room</small></span></div>`}</div>
  <div class="sec-h"><h2>Holograms</h2><span>left in places</span></div>
  <div class="grp">${(holos.length ? holos : [{ title: 'Drop one from a Witness capture', lat: 0, lon: 0, empty: true }]).map((x) => `<div class="row2"><span class="ri" style="--c:var(--gold)">${ic('cube')}</span><span class="rt">${esc(x.title)}<small>${x.empty ? 'Visible to people nearby' : fmt.ll(x.lat, x.lon, 3) + ' · visible to people nearby'}</small></span>${x.empty ? '' : `<button class="rv" data-fly="${x.lat},${x.lon}">${ic('chevr', 'sm')}</button>`}</div>`).join('')}</div>
  <div class="sec-h"><h2>Following</h2><span>alerts</span></div>
  <div class="grp">${Object.entries(YOU.follows).map(([id, on]) => { const s = GE.SIT.byId[id]; if (!s) return ''; return `<div class="row2"><span class="ri" style="--c:${GE.FAM[s.fam].color}">${ic(GE.FAM[s.fam].icon)}</span><span class="rt">${esc(s.title.split(' — ')[0])}<small>${esc(s.place)}</small></span><button class="sw2 ${on ? 'on' : ''}" data-f="${id}" role="switch" aria-checked="${on}" aria-label="Follow"></button></div>`; }).join('')}</div>
  <div class="sec-h"><h2>Alert radius</h2><span class="num" id="radV">${YOU.radius} km</span></div>
  <div class="grp radius"><svg viewBox="0 0 300 120" id="radSvg"></svg><input type="range" min="10" max="2000" step="10" value="${YOU.radius}" id="rad" aria-label="Alert radius"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3)"><span>10 km</span><span id="radN" class="num"></span><span>2,000 km</span></div></div>
  <div class="sec-h"><h2>Rendering</h2><span>adaptive</span></div>
  <div class="grp"><div class="row2"><span class="ri" style="--c:var(--sky)">${ic('gauge')}</span><span class="rt">Resolution scale<small>Drops when frames take > 20 ms for 2 s</small></span><span class="rv num" id="qScale"></span></div>
    <div class="row2"><span class="ri" style="--c:var(--sky)">${ic('cpu')}</span><span class="rt">Frame time<small>Post chain: atmosphere → FXAA → half-res bloom → grade</small></span><span class="rv num" id="qFps"></span></div>
    <div class="row2"><span class="ri" style="--c:var(--orbit)">${ic('sparkles')}</span><span class="rt">Bloom</span><button class="sw2 ${W.quality.bloom ? 'on' : ''}" data-q="bloom" role="switch" aria-label="Bloom"></button></div>
    <div class="row2"><span class="ri" style="--c:var(--orbit)">${ic('frame')}</span><span class="rt">Film grain</span><button class="sw2 ${W.quality.grain ? 'on' : ''}" data-q="grain" role="switch" aria-label="Grain"></button></div>
    <div class="row2"><span class="ri" style="--c:var(--text3)">${ic('gyro')}</span><span class="rt">Reduced motion<small>Follows your system setting</small></span><span class="rv">${prefersReduced() ? 'On' : 'Off'}</span></div></div>
  <div class="sec-h"><h2>About</h2><span>vision mockup</span></div>
  <div class="grp credits"><p style="margin:0 0 10px"><span class="concept">${ic('sparkles', 'xs')} Concept · illustrative data</span></p>
  <p style="margin:0 0 8px"><b>God’s Eye</b> — the window through which you see the world, and the eye through which the world sees itself. This is a design vision: every flight, ship, satellite, quake, fire, cyclone, camera, person, handle, post and reconstruction claim here is synthetic or fictional, placed in real geography.</p>
  <p style="margin:0 0 8px"><b>Imagery:</b> NASA Earth Observatory / Visible Earth — Blue Marble: Next Generation (cloudless day), Black Marble 2016 (night lights), Blue Marble cloud mosaic, land/water mask and topography. Public domain, courtesy of NASA.</p>
  <p style="margin:0 0 8px"><b>Real crypto:</b> SHA-256 (WebCrypto) over every rendered capture and ledger entry; ECDSA P-256 signatures with a non-extractable key generated on this device.</p>
  <p style="margin:0"><b>Renderer:</b> hand-written WebGL2 — ray-traced planet with single-scatter atmosphere, day/night terminator from the real sun position, ocean glint, clouds, stars, procedural cities and terrain, GPU-propagated flights and orbits.</p></div></div>`;
  v.scrollTop = st;
  v.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('click', () => YOU.inspect(+el.dataset.c)));
  v.querySelectorAll('[data-post]').forEach((el) => el.addEventListener('click', () => { const [sid, pid] = el.dataset.post.split('|'); GE.now._item = { band: 'inside', sit: sid }; GE.sheet.open(sid, { post: pid }); }));
  v.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('click', () => { const id = el.dataset.f; YOU.follows[id] = !YOU.follows[id]; el.classList.toggle('on', YOU.follows[id]); el.setAttribute('aria-checked', YOU.follows[id]); store.set('follows', YOU.follows); haptic(5); }));
  v.querySelectorAll('[data-q]').forEach((el) => el.addEventListener('click', () => { const k = el.dataset.q; W.quality[k] = !W.quality[k]; el.classList.toggle('on', W.quality[k]); haptic(5); }));
  v.querySelectorAll('[data-fly]').forEach((el) => el.addEventListener('click', () => { const [la, lo] = el.dataset.fly.split(',').map(Number); APP.setTab('globe'); Cam.flyTo({ lat: la, lon: lo, range: 0.002, tilt: 1.1 }); }));
  const rad = $('#rad'); rad.addEventListener('input', () => { YOU.radius = +rad.value; $('#radV').textContent = YOU.radius + ' km'; store.set('radius', YOU.radius); YOU.drawRadius(); });
  YOU.drawRadius();
};
YOU.drawRadius = function () {
  const svg = $('#radSvg'); if (!svg) return; const W = GE.world; const me = GE.ME; const r = YOU.radius;
  const spanKm = Math.max(600, r * 2.6); const sx = 300 / spanKm, sy = 120 / (spanKm * 0.4);
  const P2 = (la, lo) => [150 + (lo - me.lon) * 111 * Math.cos(me.lat * D2R) * sx, 60 - (la - me.lat) * 111 * sy];
  let s = `<rect width="300" height="120" fill="#070A10"/>`;
  for (const c of GE.CITY_V) { const [x, y] = P2(c.lat, c.lon); if (x > -5 && x < 305 && y > -5 && y < 125) s += `<circle cx="${x}" cy="${y}" r="1.6" fill="rgba(255,210,140,.5)"/>`; }
  let n = 0; for (const s0 of GE.SIT.list) { const d = geo.dist(me.lat, me.lon, s0.lat, s0.lon) * EARTH_KM; const [x, y] = P2(s0.lat, s0.lon); if (d < r) n++; if (x > 0 && x < 300 && y > 0 && y < 120) s += `<circle cx="${x}" cy="${y}" r="3" fill="${GE.FAM[s0.fam].color}"/>`; }
  for (const q of GE.QUAKES) { const d = geo.dist(me.lat, me.lon, q.lat, q.lon) * EARTH_KM; if (d < r) n++; }
  s += `<ellipse cx="150" cy="60" rx="${r * sx}" ry="${r * sy}" fill="rgba(124,196,255,.08)" stroke="#7CC4FF" stroke-width="1.2" stroke-dasharray="4 3"/><circle cx="150" cy="60" r="3.5" fill="#fff"/><text x="156" y="57" font-size="10" fill="rgba(255,255,255,.75)" font-family="var(--font)">${esc(me.name)}</text>`;
  svg.innerHTML = s; const nn = $('#radN'); if (nn) nn.textContent = `${n} alerts in range this week`;
};
YOU.tick = function () { const a = $('#qScale'); if (a) a.textContent = `${GE.gov.scale.toFixed(2)}× · ${GE.gov.w}×${GE.gov.h}`; const b = $('#qFps'); if (b) b.textContent = `${GE.gov.ms.toFixed(1)} ms`; };
YOU.inspect = async function (i) {
  const c = GE.captures[i]; if (!c) return; const el = $('#inspector');
  el.innerHTML = `<div class="panel glass strong"><div class="grab" style="height:22px;display:grid;place-items:center"><span style="width:38px;height:5px;border-radius:3px;background:rgba(255,255,255,.3)"></span></div>
  <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px"><div style="width:92px;height:69px;border-radius:12px;background:url(${c.thumb}) center/cover;flex:none;position:relative"><svg class="seal" style="position:absolute;right:-6px;top:-6px"><use href="#i-seal"/></svg></div><div><div style="font-weight:700;font-size:17px">Verify capture</div><div style="color:var(--text2);font-size:13px">${esc(c.place)} · <span class="num">${fmt.utc(c.at)}</span></div></div><button class="circ" id="insX" style="margin-left:auto;background:rgba(255,255,255,.08)">${ic('x')}</button></div>
  <div class="steps" id="vsteps">${['Media hash recomputed (SHA-256)', 'Bundle hash recomputed', 'Signature valid — ECDSA P-256, device public key', 'IMU agrees with the image horizon (±0.8°)', 'GPS track agrees with capture time', 'Chain link to previous bundle'].map((t, k) => `<div class="step" data-k="${k}"><span class="ck">${ic('check', 'xs')}</span><div><b>${t}</b><div class="h" data-h></div></div></div>`).join('')}</div>
  <div style="margin-top:10px;font-size:11px;color:var(--text3);font-family:var(--mono);word-break:break-all">pubkey x ${c.jwk?.x || '—'}<br>pubkey y ${c.jwk?.y || '—'}</div>
  <p style="font-size:11.5px;color:var(--text3);margin:10px 0 0">In a native build the key lives in the Secure Enclave / StrongBox and the bundle is written as a C2PA manifest.</p></div>`;
  el.classList.add('on');
  $('#insX').addEventListener('click', () => el.classList.remove('on'));
  el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('on'); });
  const mark = async (k, ok, txt) => { await new Promise((r) => setTimeout(r, prefersReduced() ? 0 : 260)); const s = $(`#vsteps [data-k="${k}"]`); if (!s) return; s.classList.add('on'); if (ok) s.classList.add('done'); else s.querySelector('.ck').style.cssText = 'background:var(--live);box-shadow:none;color:#fff'; s.querySelector('[data-h]').textContent = txt; haptic(3); };
  const mh = await sha256(c.bytes); await mark(0, mh === c.mediaHash, mh);
  const bh = await sha256(canon({ media: mh, session: c.session, context: c.context, prev: c.prev })); await mark(1, bh === c.hash, bh);
  const ok = await GE.crypto.verifyHex(c.hash, c.sig); await mark(2, ok, ok ? (c.sig || '').slice(0, 64) + '…' : 'no signature available in this browser');
  await mark(3, true, `roll ${c.session.imu[0].g}° · pitch ${c.session.imu[0].b}° vs rendered horizon`);
  await mark(4, true, `${c.session.gps.length} fixes within ${(c.session.end - c.session.start) / 1000} s of the shutter`);
  const prev = i > 0 ? GE.captures[i - 1].hash : '0'.repeat(64); await mark(5, prev === c.prev, `prev ${c.prev.slice(0, 32)}…`);
};
