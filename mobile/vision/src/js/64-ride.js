/* Ride: drop into a cockpit-follow camera on a helicopter circuit or an airliner, with a minimal HUD
   and a social reaction layer (fictional handles) — the communication aspect of watching together. */
const RIDE = (GE.ride = { on: false });
const CHAT_HELI = [
  ['rotorwash_ret', 'I flew that exact circuit 40 times. Downwind is where your instructor goes quiet.'],
  ['kora_maps', 'Watching from Lisbon. The stagefields look like a chessboard from here'],
  ['skywatch_ana', 'Look at the spacing — four aircraft in the pattern and nobody bunching up'],
  ['rotorwash_ret', 'Turning base now. Watch the airspeed bleed off'],
  ['hydro_nerd', 'is this live?? the shadows match my window right now'],
  ['geodesy_dan', 'MLAT puts them at ±15 m here. Cool to see it smooth'],
  ['ais_owl', 'Came from the Suez queue thread. This is so much calmer'],
  ['rotorwash_ret', 'Short final. Hover check. Then do it again. And again.'],
];
const CHAT_JET = [
  ['skywatch_ana', 'Cruise is the best seat in the house. Look at the terminator out the left side'],
  ['kora_maps', 'You can see the cloud deck the forecast promised'],
  ['geodesy_dan', 'Ground speed is up — jet stream tailwind'],
  ['ais_owl', 'There’s a whole convoy of ships under us right now'],
];
RIDE.start = function (p) {
  const W = GE.world;
  if (APP.mode === 'situation') { GE.sheet.close(true, true); }
  RIDE.p = p; RIDE.on = true; RIDE.yaw = 0; RIDE.pitch = 0; RIDE.zoom = 1;
  if (APP.tab !== 'globe') { APP.tab = 'globe'; $('#app').dataset.tab = 'globe'; $$('.pane .view').forEach((v) => v.classList.remove('on')); }
  APP.setMode('ride');
  W.layerById.helis.on = true;
  const isHeli = p.kind === 'heli' || p.kind === 'situation';
  const hc = isHeli ? GE.HELI_CIRCUITS[p.id || 0] : null; const fl = !isHeli ? GE.FLIGHTS[p.id] : null;
  RIDE.hc = hc; RIDE.fl = fl;
  const state = () => {
    const t = W.t;
    if (hc) { const a = GE.heliAt(hc, t), b = GE.heliAt(hc, t + 1.5); const hd = geo.bearing(a.lat, a.lon, b.lat, b.lon); const c = GE.heliAt(hc, t - 1.5); const hd0 = geo.bearing(c.lat, c.lon, a.lat, a.lon); let turn = hd - hd0; if (turn > Math.PI) turn -= TAU; if (turn < -Math.PI) turn += TAU; return { lat: a.lat, lon: a.lon, alt: a.altKm, hdg: hd, roll: clamp(turn * 6, -0.45, 0.45), spd: a.spd, vs: (b.altKm - c.altKm) / 3 * 3281 * 60 }; }
    const a = GE.flightAt(fl, t) || GE.flightAt(fl, t + 600); const b = GE.flightAt(fl, t + 4) || a;
    return { lat: a.lat, lon: a.lon, alt: a.altKm, hdg: geo.bearing(a.lat, a.lon, b.lat, b.lon), roll: 0, spd: fl.speed / 1.852, vs: (b.altKm - a.altKm) / 4 * 3281 * 60 };
  };
  RIDE.state = state;
  const rig = {
    blendTime: 1.8,
    pose() { const s = state(); RIDE.s = s; const pitch = (hc ? -0.16 : -0.05) + RIDE.pitch; return Cam.pose(s.lat, s.lon, s.alt + (hc ? 0.003 : 0.002), s.hdg + RIDE.yaw, pitch, s.roll * 0.6, (hc ? 64 : 58) * D2R / RIDE.zoom); },
    look(dx, dy) { RIDE.yaw -= dx * 0.004; RIDE.pitch = clamp(RIDE.pitch - dy * 0.003, -0.9, 0.5); },
    zoom(r) { RIDE.zoom = clamp(RIDE.zoom / r, 0.6, 3); },
  };
  Cam.setRig(rig);
  RIDE.renderUI(isHeli);
  RIDE.chatI = 0; clearInterval(RIDE._ci); RIDE._ci = setInterval(() => RIDE.nextChat(), 2600); setTimeout(() => RIDE.nextChat(), 900);
  clearInterval(RIDE._ri); RIDE._ri = setInterval(() => { if (Math.random() < 0.7) RIDE.heart(); }, 700);
  haptic([10, 40, 10]);
};
RIDE.renderUI = function (isHeli) {
  const el = $('#ride'); const nm = isHeli ? RIDE.hc.cs : RIDE.fl.cs; const tp = isHeli ? `${RIDE.hc.type} · ${RIDE.hc.field || 'orbit'} circuit` : `${RIDE.fl.type} · ${GE.flightAt(RIDE.fl, GE.world.t)?.from.iata} → ${GE.flightAt(RIDE.fl, GE.world.t)?.to.iata}`;
  el.innerHTML = `<div class="hud" id="hud"><svg id="hudSvg"></svg><div class="tape" style="left:14px" id="hSpd"></div><div class="tape" style="right:14px;text-align:right" id="hAlt"></div></div>
  <div class="top"><button class="circ glass" id="rideX" aria-label="Exit ride">${ic('chevd')}</button><div class="who glass"><span class="badge live" style="background:rgba(255,69,58,.2)"><span class="dot pulse"></span>Ride</span><span style="min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"><b>${esc(nm)}</b> · ${esc(tp)}</span><span style="margin-left:auto;display:flex;align-items:center;gap:5px;color:var(--text2)">${ic('people', 'sm')}<span class="num" id="rideN">2,318</span></span></div></div>
  <div class="chat" id="chat"></div><div class="react" id="react"></div>
  <div class="compose"><div class="in glass"><input id="rideIn" placeholder="Say something to everyone riding…" enterkeyhint="send" maxlength="120"></div><button class="circ glass" id="rideHeart" aria-label="React" style="width:48px;height:48px;color:var(--live)">${ic('heartf')}</button></div>`;
  el.classList.add('on');
  $('#rideX').addEventListener('click', () => RIDE.exit());
  $('#rideHeart').addEventListener('click', () => { for (let i = 0; i < 4; i++) setTimeout(RIDE.heart, i * 90); haptic(6); });
  $('#rideIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { RIDE.bubble('you', e.target.value.trim(), true); e.target.value = ''; } });
};
RIDE.bubble = function (who, text, mine) {
  const p = Object.values(GE.PEOPLE).find((x) => x.h === who) || GE.PEOPLE.you;
  const c = $('#chat'); if (!c) return;
  const b = h('div', { class: 'bub' }); b.innerHTML = `<span class="avatar sm" style="--h:${p.hue}">${p.h[0].toUpperCase()}</span><div class="bx glass" ${mine ? 'style="background:rgba(124,196,255,.22)"' : ''}><b>@${esc(p.h)}${who === 'rotorwash_ret' ? ' · former instructor' : ''}</b>${esc(text)}</div>`;
  c.append(b); while (c.children.length > 6) c.firstChild.remove();
};
RIDE.nextChat = function () { const L = RIDE.hc ? CHAT_HELI : CHAT_JET; const [w, t] = L[RIDE.chatI++ % L.length]; RIDE.bubble(w, t); const n = $('#rideN'); if (n) n.textContent = fmt.n(2318 + Math.round(Math.sin(Date.now() / 4000) * 40 + RIDE.chatI * 7)); };
RIDE.heart = function () { const r = $('#react'); if (!r || prefersReduced()) return; const s = h('span'); s.innerHTML = ic('heartf'); s.style.setProperty('--dx', (Math.random() * 40 - 20) + 'px'); s.style.left = (Math.random() * 16) + 'px'; s.style.color = ['#FF453A', '#FF9F0A', '#FFD166', '#7CC4FF'][Math.floor(Math.random() * 4)]; r.append(s); setTimeout(() => s.remove(), 2700); };
RIDE.frame = function (view) {
  if (!RIDE.on || !RIDE.s) return; const s = RIDE.s; const svg = $('#hudSvg'); if (!svg) return;
  const w = svg.clientWidth, hh = svg.clientHeight; const cx = w / 2, cy = hh * 0.42;
  const hdg = (((s.hdg + RIDE.yaw) * R2D) % 360 + 360) % 360; const roll = -s.roll * 0.6 * R2D; const pitchPx = (RIDE.pitch + (RIDE.hc ? -0.16 : -0.05)) * R2D * 6;
  let g = `<g transform="rotate(${roll.toFixed(2)} ${cx} ${cy})" stroke="rgba(190,255,200,.8)" fill="rgba(190,255,200,.85)" font-size="10" font-family="var(--mono)">`;
  g += `<line x1="${cx - 150}" y1="${cy + pitchPx}" x2="${cx - 40}" y2="${cy + pitchPx}" stroke-width="1.5"/><line x1="${cx + 40}" y1="${cy + pitchPx}" x2="${cx + 150}" y2="${cy + pitchPx}" stroke-width="1.5"/>`;
  for (const pd of [-10, -5, 5, 10]) { const y = cy + pitchPx - pd * 6; g += `<line x1="${cx - 50}" y1="${y}" x2="${cx - 26}" y2="${y}" stroke-width="1" ${pd < 0 ? 'stroke-dasharray="4 3"' : ''}/><line x1="${cx + 26}" y1="${y}" x2="${cx + 50}" y2="${y}" stroke-width="1" ${pd < 0 ? 'stroke-dasharray="4 3"' : ''}/><text x="${cx + 56}" y="${y + 3}" stroke="none">${pd}</text>`; }
  g += `</g>`;
  g += `<g stroke="rgba(190,255,200,.95)" fill="none" stroke-width="1.6"><circle cx="${cx}" cy="${cy}" r="5"/><line x1="${cx - 18}" y1="${cy}" x2="${cx - 5}" y2="${cy}"/><line x1="${cx + 5}" y1="${cy}" x2="${cx + 18}" y2="${cy}"/><line x1="${cx}" y1="${cy - 5}" x2="${cx}" y2="${cy - 12}"/></g>`;
  // heading tape
  const ty = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0) + 100;
  g += `<g font-size="11" font-family="var(--mono)" fill="rgba(190,255,200,.85)" stroke="rgba(190,255,200,.6)" text-anchor="middle">`;
  for (let d = Math.floor(hdg / 5) * 5 - 40; d <= hdg + 40; d += 5) { const x = cx + (d - hdg) * 4; const dd = ((d % 360) + 360) % 360; g += `<line x1="${x}" y1="${ty}" x2="${x}" y2="${ty + (dd % 10 === 0 ? 9 : 5)}"/>`; if (dd % 30 === 0) g += `<text x="${x}" y="${ty + 22}" stroke="none">${{ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] ?? String(dd / 10).padStart(2, '0')}</text>`; }
  g += `<rect x="${cx - 24}" y="${ty - 22}" width="48" height="18" rx="4" fill="rgba(0,20,8,.35)"/><text x="${cx}" y="${ty - 9}" stroke="none" font-weight="700">${String(Math.round(hdg)).padStart(3, '0')}</text></g>`;
  svg.innerHTML = g;
  $('#hSpd').innerHTML = `${Math.round(s.spd)}<small>KT GS</small>`;
  $('#hAlt').innerHTML = `${fmt.n(Math.round(s.alt * 3281 / 10) * 10)}<small>FT ${RIDE.hc ? 'AGL' : 'MSL'} · ${s.vs > 0 ? '+' : ''}${Math.round(s.vs / 50) * 50} FPM</small>`;
};
RIDE.exit = function (silent) {
  if (!RIDE.on) return; RIDE.on = false; clearInterval(RIDE._ci); clearInterval(RIDE._ri);
  $('#ride').classList.remove('on'); $('#ride').innerHTML = '';
  const v = Cam.view(400, 800); const [la, lo] = geo.ll(v.eye);
  Cam.setRig(null); Cam.set({ lat: la, lon: lo, range: Math.max(0.002, v3.len(v.eye) - 1 + 0.002), tilt: 0.9, heading: RIDE.s ? RIDE.s.hdg : 0, shiftY: 0.06 });
  APP.setMode(''); GE.world.setWindow(null); GE.world.setTime(null);
  if (!silent) Cam.flyTo({ range: 0.012, tilt: 0.8 });
};
