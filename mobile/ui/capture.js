/**
 * Capture tab: one dial, four modes (DESIGN.md §11.4).
 *  Look    — the God's-eye view projected around you (aircraft, satellites,
 *            ships) on the camera, aligned by compass + gyro. Drag to look on
 *            devices without motion sensors. Nothing is recorded.
 *  Witness — signed photo/video with IMU, GPS, heading and a hash chain.
 *  Live    — a broadcast: you appear on the globe as an eye with a frustum,
 *            segments are sealed every 10 s into a hash chain.
 *  Upload  — a photo or video from the library, EXIF read, placed on a
 *            mini-map, and marked Unverified everywhere.
 * After any capture comes the attach sheet.
 */

import { icon } from './icons.js';
import {
  $,
  h,
  esc,
  clamp,
  haptic,
  toast,
  fmtDist,
  fmtAlt,
  sparkPath,
  reducedMotion,
} from './dom.js';
import { createCamera } from '../capture/camera.js';
import {
  createSensors,
  requestMotionPermission,
  poseFromAzEl,
  lookAngles,
  projectDir,
  dirFromAzEl,
} from '../capture/sensors.js';
import { seal, networkTimeOffset, sha256Hex } from '../capture/provenance.js';
import { createLiveSession, canBroadcast } from '../capture/live.js';
import { readExif } from '../capture/exif.js';
import { put } from '../capture/db.js';
import { createMiniMap } from './minimap.js';
import { llShort, cardinal } from './bands.js';

const KIND_COLOR = {
  aircraft: '#7CC4FF',
  helicopter: '#7CC4FF',
  military: '#7CC4FF',
  ship: '#38E1C6',
  vessel: '#38E1C6',
  satellite: '#C9A7FF',
  station: '#FFFFFF',
  quake: '#FF6A3D',
  fire: '#FF6A3D',
};
const KIND_LABEL = {
  aircraft: ['aircraft', 'aircraft'],
  military: ['military', 'military'],
  helicopter: ['helicopter', 'helicopters'],
  ship: ['ship', 'ships'],
  vessel: ['ship', 'ships'],
  satellite: ['satellite', 'satellites'],
  station: ['space station', 'space stations'],
};
const FALLBACK_POS = { lat: 37.7749, lon: -122.4194, alt: 16, simulated: true };
const GATE_KEY = 'gev.mobile.capture.gate';

export function createCapture(
  view,
  { globe, onSealed, onVerify, rt, attach, getLocation },
) {
  view.innerHTML = `
    <div class="cap" data-mode="look">
      <video class="cap-video" playsinline muted autoplay></video>
      <canvas class="cap-ar" aria-hidden="true"></canvas>
      <div class="cap-level" aria-hidden="true"><i></i></div>
      <div class="cap-top">
        <div class="cap-tape glass-strong"><canvas></canvas><span class="cap-caret"></span></div>
        <div class="cap-needs" hidden></div>
        <div class="hud glass-strong" aria-live="off">
          <div class="hud-grid">
            <span>LAT</span><b class="num" data-h="lat">—</b><span>LON</span><b class="num" data-h="lon">—</b>
            <span>±</span><b class="num" data-h="acc">—</b><span>HDG</span><b class="num" data-h="hdg">—</b>
            <span>PITCH</span><b class="num" data-h="pitch">—</b><span>ROLL</span><b class="num" data-h="roll">—</b>
          </div>
          <div class="hud-trace"><canvas></canvas><span>IMU |a|</span></div>
          <div class="hud-rec"><span class="rec-dot"></span><span data-h="session">Session idle</span></div>
        </div>
      </div>
      <div class="cap-status glass-strong" hidden></div>
      <button class="cap-target" type="button" hidden aria-label="Replying in this room. Tap to clear"></button>
      <div class="live-hud" aria-live="polite">
        <div class="lh-top"><span class="lh-pill tele"><i></i><b data-lh="state">OFF AIR</b><span data-lh="elapsed">tap ● to go live</span></span><span class="lh-view tele">${icon('users')}<span data-lh="viewers">0</span> watching</span></div>
        <div class="lh-chain" aria-label="Sealed segments"></div>
        <div class="lh-tele tele" data-lh="tele">STANDBY</div>
      </div>
      <div class="cap-upload" hidden>
        <div class="up-pick">
          <span class="up-ic">${icon('upload')}</span>
          <h2>Add from your library</h2>
          <p>A photo or video you already have. We read its EXIF position and time if present, you place it on the map, and it is marked <b>Unverified</b> everywhere: without a capture-time seal it can be cited, never treated as an observation.</p>
          <label class="pill-btn primary up-btn">${icon('upload')}Choose photo or video<input type="file" accept="image/*,video/*" hidden/></label>
        </div>
        <div class="up-place" hidden></div>
      </div>
      <div class="cap-bottom">
        <div class="cap-modes" role="tablist" aria-label="Capture mode">
          <button role="tab" type="button" data-mode="look" aria-selected="true">Look</button>
          <button role="tab" type="button" data-mode="witness" aria-selected="false">Witness</button>
          <button role="tab" type="button" data-mode="live" aria-selected="false">Live</button>
          <button role="tab" type="button" data-mode="upload" aria-selected="false">Upload</button>
        </div>
        <div class="cap-controls">
          <button class="cap-thumb" type="button" aria-label="Last capture"><span>${icon('seal')}</span></button>
          <button class="shutter" type="button" aria-label="Seal a photo. Hold for video"><span class="shutter-ring"></span><span class="shutter-core"></span><span class="shutter-label tele"></span></button>
          <button class="cap-side icon-btn glass-strong" type="button" data-act="recenter" aria-label="Sensors">${icon('scope')}</button>
        </div>
        <div class="cap-legend"></div>
      </div>
      <div class="cap-gate" hidden>
        <div class="gate-card glass-strong">
          <div class="gate-ic">${icon('viewfinder')}</div>
          <h2>See the sky. Seal what you see.</h2>
          <p>Capture uses three sensors, only while this tab is open.</p>
          <ul>
            <li>${icon('camera')}<div><b>Camera</b><span>Look overlays aircraft, satellites and ships on the live view. Witness records the photo or clip you seal.</span></div></li>
            <li>${icon('north')}<div><b>Motion &amp; compass</b><span>Aligns the overlay with where your phone points, and becomes part of the signed motion trace.</span></div></li>
            <li>${icon('location')}<div><b>Location</b><span>Places contacts around you, and stamps each capture with where you stood.</span></div></li>
          </ul>
          <p class="gate-fine">${icon('lock')} Captures stay on this device. Each one is signed with a key generated here that cannot be exported.</p>
          <button class="pill-btn primary gate-go" type="button">Continue</button>
          <button class="pill-btn plain gate-skip" type="button">Not now — use a simulated sky</button>
        </div>
      </div>
      <div class="cap-seal" hidden></div>
    </div>`;

  const root = $('.cap', view);
  const video = $('.cap-video', view);
  const ar = $('.cap-ar', view);
  const actx = ar.getContext('2d');
  const tape = $('.cap-tape canvas', view);
  const tctx = tape.getContext('2d');
  const traceC = $('.hud-trace canvas', view);
  const trctx = traceC.getContext('2d');
  const gate = $('.cap-gate', view);
  const sealEl = $('.cap-seal', view);
  const status = $('.cap-status', view);
  const shutter = $('.shutter', view);
  const level = $('.cap-level i', view);
  const camera = createCamera(video);
  const sensors = createSensors();

  let mode = 'look';
  let active = false;
  let started = false;
  let camOk = false;
  let raf = 0;
  let sim = { az: 250, el: 14 };
  let contacts = [];
  let contactsAt = 0;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let lastCapture = null;
  let netOffset = null;
  let target = null; // { s, replyTo, needEyes } — the room this capture answers
  let live = null; // { session, id, t0, pin, frameTimer }
  const VFOV = 62;
  const MODES = ['look', 'witness', 'live', 'upload'];
  const upload = $('.cap-upload', view);
  const liveHud = $('.live-hud', view);
  const targetChip = $('.cap-target', view);

  /* ---------- lifecycle ---------- */
  function resize() {
    const r = root.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    ar.width = Math.round(W * dpr);
    ar.height = Math.round(H * dpr);
    const tr = tape.getBoundingClientRect();
    tape.width = Math.round(tr.width * dpr);
    tape.height = Math.round(tr.height * dpr);
    const hr = traceC.getBoundingClientRect();
    traceC.width = Math.round(hr.width * dpr);
    traceC.height = Math.round(hr.height * dpr);
  }
  new ResizeObserver(resize).observe(root);

  async function begin({ withSensors }) {
    gate.hidden = true;
    try {
      sessionStorage.setItem(GATE_KEY, '1');
    } catch {
      /* ignore */
    }
    started = true;
    if (withSensors) {
      const perm = await requestMotionPermission();
      if (perm === 'denied')
        showStatus('Motion access denied — drag to look around', 4000);
      sensors.start();
      try {
        await camera.start();
        camOk = true;
        root.classList.add('has-camera');
      } catch (err) {
        camOk = false;
        root.classList.remove('has-camera');
        showStatus(
          err?.name === 'NotAllowedError'
            ? 'Camera access was declined — showing a simulated sky'
            : 'No camera here — showing a simulated sky',
          4500,
        );
      }
    }
    networkTimeOffset().then((o) => (netOffset = o));
    if (mode === 'witness') sensors.beginSession();
    loop();
  }

  function enter() {
    active = true;
    resize();
    setTimeout(() => needsLoop(), 0);
    let seen = false;
    try {
      seen = sessionStorage.getItem(GATE_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (!started && !seen) gate.hidden = false;
    else if (!started) begin({ withSensors: true });
    else {
      if (camOk) camera.start().catch(() => {});
      sensors.start();
      if (mode === 'witness' && !sensors.recording) sensors.beginSession();
      loop();
    }
  }

  function leave() {
    if (live) {
      endLive();
      toast('Broadcast ended and sealed — find it in You', {
        icon: icon('sealFill'),
      });
    }
    active = false;
    cancelAnimationFrame(raf);
    raf = 0;
    camera.stop();
    sensors.endSession();
    sensors.stop();
  }

  $('.gate-go', view).addEventListener('click', () =>
    begin({ withSensors: true }),
  );
  $('.gate-skip', view).addEventListener('click', () =>
    begin({ withSensors: false }),
  );

  function showStatus(text, ms = 2500) {
    status.textContent = text;
    status.hidden = false;
    clearTimeout(showStatus.t);
    showStatus.t = setTimeout(() => (status.hidden = true), ms);
  }

  /* ---------- mode dial ---------- */
  function setMode(m) {
    if (m === mode || !MODES.includes(m)) return;
    if (live && m !== 'live') {
      showStatus('End the broadcast first');
      return;
    }
    mode = m;
    root.dataset.mode = m;
    view
      .querySelectorAll('.cap-modes [data-mode]')
      .forEach((b) =>
        b.setAttribute('aria-selected', String(b.dataset.mode === m)),
      );
    haptic('tick');
    if (m === 'witness' && started) sensors.beginSession();
    if (m === 'look' || m === 'upload') sensors.endSession();
    upload.hidden = m !== 'upload';
    const lbl = $('.shutter-label', view);
    lbl.textContent = m === 'live' ? 'GO LIVE' : '';
    shutter.setAttribute(
      'aria-label',
      m === 'live'
        ? 'Go live'
        : m === 'upload'
          ? 'Choose a photo or video'
          : 'Seal a photo. Hold for video',
    );
    if (m === 'live') updateLiveHud(pose());
  }
  $('.cap-modes', view).addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  // Swipe the viewfinder sideways to change mode, like Camera.
  let swipe = null;
  root.addEventListener(
    'touchstart',
    (e) =>
      (swipe = e.target.closest(
        '.cap-bottom, .cap-seal, .cap-gate, .cap-upload, .minimap',
      )
        ? null
        : { x: e.touches[0].clientX, y: e.touches[0].clientY }),
    { passive: true },
  );
  root.addEventListener(
    'touchend',
    (e) => {
      if (!swipe || mode === 'look') return (swipe = null);
      const t = e.changedTouches[0];
      const dx = t.clientX - swipe.x;
      if (Math.abs(dx) > 70 && Math.abs(t.clientY - swipe.y) < 50) {
        const i = MODES.indexOf(mode) + (dx > 0 ? -1 : 1);
        setMode(MODES[Math.max(0, Math.min(MODES.length - 1, i))]);
      }
      swipe = null;
    },
    { passive: true },
  );

  /* ---------- drag to look (no sensors) ---------- */
  let look = null;
  ar.addEventListener('pointerdown', (e) => {
    if (sensors.state.hasOrientation) return;
    look = { x: e.clientX, y: e.clientY, az: sim.az, el: sim.el };
    ar.setPointerCapture(e.pointerId);
  });
  ar.addEventListener('pointermove', (e) => {
    if (!look) return;
    const degPerPx = VFOV / H;
    sim.az = (look.az - (e.clientX - look.x) * degPerPx + 360) % 360;
    sim.el = clamp(look.el + (e.clientY - look.y) * degPerPx, -30, 85);
  });
  ar.addEventListener('pointerup', () => (look = null));
  ar.addEventListener('pointercancel', () => (look = null));
  ar.style.touchAction = 'none';

  function observer() {
    const f = sensors.state.fix;
    return f
      ? { lat: f.lat, lon: f.lon, alt: f.alt || 0, acc: f.acc }
      : FALLBACK_POS;
  }

  function pose() {
    return sensors.pose() || poseFromAzEl(sim.az, sim.el);
  }

  /* ---------- render loop ---------- */
  function loop() {
    if (!active || raf) return;
    const frame = () => {
      raf = 0;
      if (!active) return;
      const p = pose();
      if (mode === 'look') drawLook(p);
      else if (mode === 'upload') {
        actx.setTransform(dpr, 0, 0, dpr, 0, 0);
        actx.clearRect(0, 0, W, H);
      } else drawWitness(p);
      if (mode === 'live') updateLiveHud(p);
      drawTape(p);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  const stars = (() => {
    let s = 11;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 260 }, () => ({
      az: r() * 360,
      el: Math.asin(r()) * 57.3,
      m: r(),
    }));
  })();

  function drawSky(p) {
    // Horizon position at the screen centre column.
    const hz = projectDir(dirFromAzEl(p.az, 0), p, W, H, VFOV);
    const hy = hz.behind ? (p.el > 0 ? H * 2 : -H) : hz.y;
    const g = actx.createLinearGradient(0, hy - H, 0, hy);
    g.addColorStop(0, '#03060f');
    g.addColorStop(0.55, '#0a1630');
    g.addColorStop(0.9, '#1b3557');
    g.addColorStop(1, '#3b5f80');
    actx.fillStyle = g;
    actx.fillRect(0, 0, W, H);
    actx.fillStyle = '#05080d';
    actx.save();
    // Ground polygon below the horizon line, honouring roll.
    const l = projectDir(dirFromAzEl(p.az - 80, 0), p, W, H, VFOV);
    const r = projectDir(dirFromAzEl(p.az + 80, 0), p, W, H, VFOV);
    if (!l.behind && !r.behind) {
      const k = (r.y - l.y) / (r.x - l.x || 1);
      const yAt = (x) => l.y + k * (x - l.x);
      actx.beginPath();
      actx.moveTo(-10, yAt(-10));
      actx.lineTo(W + 10, yAt(W + 10));
      actx.lineTo(W + 10, H + 10);
      actx.lineTo(-10, H + 10);
      actx.closePath();
      const gg = actx.createLinearGradient(0, hy, 0, hy + H * 0.6);
      gg.addColorStop(0, '#1a2633');
      gg.addColorStop(1, '#04060a');
      actx.fillStyle = gg;
      actx.fill();
    } else if (p.el < 0) actx.fillRect(0, 0, W, H);
    actx.restore();
    for (const s of stars) {
      if (s.el < 2) continue;
      const q = projectDir(dirFromAzEl(s.az, s.el), p, W, H, VFOV);
      if (q.behind || q.x < 0 || q.y < 0 || q.x > W || q.y > H) continue;
      actx.fillStyle = `rgba(255,255,255,${0.25 + s.m * 0.6})`;
      actx.fillRect(q.x, q.y, s.m > 0.9 ? 1.8 : 1.1, s.m > 0.9 ? 1.8 : 1.1);
    }
  }

  function drawHorizon(p) {
    actx.lineWidth = 1;
    for (const el of [-20, -10, 0, 10, 20, 30, 45, 60]) {
      const pts = [];
      for (let d = -70; d <= 70; d += 5) {
        const q = projectDir(dirFromAzEl(p.az + d, el), p, W, H, VFOV);
        if (!q.behind) pts.push(q);
      }
      if (pts.length < 2) continue;
      actx.strokeStyle =
        el === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)';
      actx.setLineDash(el === 0 ? [] : [3, 6]);
      actx.beginPath();
      pts.forEach((q, i) =>
        i ? actx.lineTo(q.x, q.y) : actx.moveTo(q.x, q.y),
      );
      actx.stroke();
      actx.setLineDash([]);
      if (el && pts.length) {
        const mid = pts[Math.floor(pts.length / 2)];
        actx.fillStyle = 'rgba(255,255,255,0.35)';
        actx.font = '600 10px ui-rounded, system-ui';
        actx.fillText(`${el > 0 ? '+' : ''}${el}°`, mid.x + 6, mid.y - 3);
      }
    }
    // Cardinal labels on the horizon.
    const card = [
      ['N', 0],
      ['E', 90],
      ['S', 180],
      ['W', 270],
    ];
    actx.font = '700 13px ui-rounded, system-ui';
    actx.textAlign = 'center';
    for (const [n, az] of card) {
      const q = projectDir(dirFromAzEl(az, 0), p, W, H, VFOV);
      if (q.behind || q.x < -20 || q.x > W + 20) continue;
      actx.fillStyle = n === 'N' ? '#ff6b61' : 'rgba(255,255,255,0.8)';
      actx.fillText(n, q.x, q.y + 18);
    }
    actx.textAlign = 'left';
  }

  function refreshContacts() {
    const now = performance.now();
    if (now - contactsAt < 1000) return;
    contactsAt = now;
    const o = observer();
    contacts = globe.contactsNear(o.lon, o.lat, 150);
  }

  function rrect(x, y, w, hh, r) {
    actx.beginPath();
    actx.moveTo(x + r, y);
    actx.arcTo(x + w, y, x + w, y + hh, r);
    actx.arcTo(x + w, y + hh, x, y + hh, r);
    actx.arcTo(x, y + hh, x, y, r);
    actx.arcTo(x, y, x + w, y, r);
    actx.closePath();
  }

  function drawLook(p) {
    actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    actx.clearRect(0, 0, W, H);
    if (!camOk) drawSky(p);
    drawHorizon(p);
    refreshContacts();
    const o = observer();
    const items = [];
    const offscreen = [];
    for (const c of contacts) {
      const la = lookAngles(o, c);
      if (la.el < -2) continue;
      const q = projectDir(la.enu, p, W, H, VFOV);
      const vis = !q.behind && q.x > 0 && q.x < W && q.y > 60 && q.y < H - 40;
      (vis ? items : offscreen).push({ c, la, q });
    }
    items.sort((a, b) => a.la.range - b.la.range);
    const placed = [];
    let shown = 0;
    for (const it of items.slice(0, 24)) {
      const { c, la, q } = it;
      const col = KIND_COLOR[c.kind] || '#fff';
      const near = la.range < 40e3;
      // Marker
      actx.strokeStyle = col;
      actx.lineWidth = 1.6;
      actx.beginPath();
      if (c.kind === 'satellite' || c.kind === 'station') {
        actx.moveTo(q.x, q.y - 7);
        actx.lineTo(q.x + 7, q.y);
        actx.lineTo(q.x, q.y + 7);
        actx.lineTo(q.x - 7, q.y);
        actx.closePath();
      } else if (c.kind === 'ship' || c.kind === 'vessel') {
        actx.rect(q.x - 6, q.y - 6, 12, 12);
      } else actx.arc(q.x, q.y, near ? 9 : 6.5, 0, Math.PI * 2);
      actx.stroke();
      actx.fillStyle = col;
      actx.beginPath();
      actx.arc(q.x, q.y, 1.8, 0, Math.PI * 2);
      actx.fill();
      if (shown >= 12) continue;
      // Callout with simple de-cluttering.
      const title = c.title || c.id;
      const sub =
        c.kind === 'satellite' || c.kind === 'station'
          ? `${Math.round(c.altM / 1000)} km · ${fmtDist(la.range)}`
          : `${c.altM > 50 ? fmtAlt(c.altM) + ' · ' : ''}${fmtDist(la.range)}`;
      actx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = Math.max(
        actx.measureText(title).width,
        ((actx.font = '500 10.5px ui-rounded, system-ui'),
        actx.measureText(sub).width),
      );
      const bw = tw + 18;
      const bh = 36;
      let bx = q.x + 16;
      let by = q.y - bh - 12;
      if (bx + bw > W - 8) bx = q.x - 16 - bw;
      for (
        let k = 0;
        k < 6 &&
        placed.some(
          (r) =>
            !(
              bx + bw < r.x ||
              bx > r.x + r.w ||
              by + bh < r.y ||
              by > r.y + r.h
            ),
        );
        k += 1
      )
        by -= bh + 4;
      if (by < 64) continue;
      placed.push({ x: bx, y: by, w: bw, h: bh });
      shown += 1;
      actx.strokeStyle = 'rgba(255,255,255,0.45)';
      actx.lineWidth = 1;
      actx.beginPath();
      actx.moveTo(q.x + (bx > q.x ? 6 : -6), q.y - 6);
      actx.lineTo(bx > q.x ? bx : bx + bw, by + bh);
      actx.stroke();
      rrect(bx, by, bw, bh, 10);
      actx.fillStyle = 'rgba(8,11,17,0.72)';
      actx.fill();
      actx.strokeStyle = 'rgba(255,255,255,0.14)';
      actx.stroke();
      actx.fillStyle = col;
      actx.fillRect(bx, by + 8, 2.5, bh - 16);
      actx.fillStyle = '#fff';
      actx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
      actx.fillText(title, bx + 10, by + 15);
      actx.fillStyle = 'rgba(235,241,250,0.65)';
      actx.font = '500 10.5px ui-rounded, system-ui';
      actx.fillText(sub, bx + 10, by + 29);
    }
    // Edge arrows for the nearest contacts outside the view.
    offscreen.sort((a, b) => a.la.range - b.la.range);
    for (const it of offscreen.slice(0, 5)) {
      const d = ((it.la.az - p.az + 540) % 360) - 180;
      const x = d < 0 ? 18 : W - 18;
      const y = clamp(H / 2 - (it.la.el - p.el) * (H / VFOV), 90, H - 200);
      actx.fillStyle = KIND_COLOR[it.c.kind] || '#fff';
      actx.globalAlpha = 0.85;
      actx.beginPath();
      actx.moveTo(x + (d < 0 ? -7 : 7), y);
      actx.lineTo(x + (d < 0 ? 5 : -5), y - 7);
      actx.lineTo(x + (d < 0 ? 5 : -5), y + 7);
      actx.closePath();
      actx.fill();
      actx.globalAlpha = 1;
    }
    const counts = {};
    for (const c of contacts) counts[c.kind] = (counts[c.kind] || 0) + 1;
    const legend = Object.entries(counts)
      .map(
        ([k, n]) =>
          `<span style="--c:${KIND_COLOR[k] || '#fff'}"><i></i>${n} ${(KIND_LABEL[k] || [k, `${k}s`])[n > 1 ? 1 : 0]}</span>`,
      )
      .join('');
    const lg = $('.cap-legend', view);
    const key = `${legend}|${o.simulated}|${sensors.state.hasOrientation}`;
    if (lg.dataset.key !== key) {
      lg.dataset.key = key;
      lg.innerHTML = `${legend}<em>${o.simulated ? 'simulated position · ' : ''}${sensors.state.hasOrientation ? 'compass-aligned' : 'drag to look'}</em>`;
    }
  }

  let hudT = 0;
  function drawWitness(p) {
    actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    actx.clearRect(0, 0, W, H);
    if (!camOk) {
      drawSky(p);
      actx.fillStyle = 'rgba(255,255,255,0.5)';
      actx.font = '600 12px ui-rounded, system-ui';
      actx.textAlign = 'center';
      actx.fillText('NO CAMERA · TEST FRAME', W / 2, H / 2 + 60);
      actx.textAlign = 'left';
    }
    // Thirds grid
    actx.strokeStyle = 'rgba(255,255,255,0.14)';
    actx.lineWidth = 0.75;
    actx.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      actx.moveTo(W * k, 0);
      actx.lineTo(W * k, H);
      actx.moveTo(0, H * k);
      actx.lineTo(W, H * k);
    }
    actx.stroke();
    level.style.transform = `rotate(${(-p.roll).toFixed(1)}deg)`;
    level.parentElement.classList.toggle('level', Math.abs(p.roll) < 1.5);
    const now = performance.now();
    if (now - hudT > 100) {
      hudT = now;
      updateHud(p);
    }
  }

  function updateHud(p) {
    const f = sensors.state.fix;
    const set = (k, v) => {
      const el = view.querySelector(`[data-h="${k}"]`);
      if (el && el.textContent !== v) el.textContent = v;
    };
    set('lat', f ? f.lat.toFixed(5) : '—');
    set('lon', f ? f.lon.toFixed(5) : '—');
    set(
      'acc',
      f ? `${Math.round(f.acc)} m` : sensors.state.geoError ? 'denied' : '…',
    );
    set('hdg', `${Math.round(p.az)}°`);
    set('pitch', `${p.el >= 0 ? '+' : ''}${p.el.toFixed(0)}°`);
    set('roll', `${p.roll >= 0 ? '+' : ''}${p.roll.toFixed(0)}°`);
    const s = sensors.recording;
    set(
      'session',
      s
        ? `Recording session · ${sensors.state.hasMotion ? 'IMU live' : 'no IMU'} · ${f ? 'GPS fix' : 'no GPS'}`
        : 'Session idle',
    );
    $('.hud-rec', view).classList.toggle('on', s);
    // IMU trace (sized lazily: the HUD is hidden in Look).
    const hr = traceC.getBoundingClientRect();
    if (Math.round(hr.width * dpr) !== traceC.width) {
      traceC.width = Math.round(hr.width * dpr);
      traceC.height = Math.round(hr.height * dpr);
    }
    const tw = traceC.width / dpr;
    const th = traceC.height / dpr;
    trctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    trctx.clearRect(0, 0, tw, th);
    const tr = sensors.trace;
    if (tr.length > 2) {
      const vals = tr.map((x) => x.v);
      const d = sparkPath(vals, tw, th, 2);
      trctx.strokeStyle = '#FFD166';
      trctx.lineWidth = 1.4;
      trctx.stroke(new Path2D(d));
    } else {
      trctx.strokeStyle = 'rgba(255,255,255,0.25)';
      trctx.setLineDash([2, 3]);
      trctx.beginPath();
      trctx.moveTo(0, th / 2);
      trctx.lineTo(tw, th / 2);
      trctx.stroke();
      trctx.setLineDash([]);
    }
  }

  function drawTape(p) {
    const tr = tape.getBoundingClientRect();
    if (
      Math.round(tr.width * dpr) !== tape.width ||
      Math.round(tr.height * dpr) !== tape.height
    ) {
      tape.width = Math.round(tr.width * dpr);
      tape.height = Math.round(tr.height * dpr);
    }
    const w = tape.width / dpr;
    const hh = tape.height / dpr;
    if (!w) return;
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.clearRect(0, 0, w, hh);
    const pxPerDeg = w / 90;
    tctx.textAlign = 'center';
    for (let d = Math.floor(p.az - 50); d <= p.az + 50; d += 1) {
      const deg = ((d % 360) + 360) % 360;
      if (deg % 5) continue;
      const x = w / 2 + (d - p.az) * pxPerDeg;
      const major = deg % 15 === 0;
      tctx.strokeStyle = major
        ? 'rgba(255,255,255,0.7)'
        : 'rgba(255,255,255,0.28)';
      tctx.beginPath();
      tctx.moveTo(x, hh - 4);
      tctx.lineTo(x, hh - (major ? 12 : 7));
      tctx.stroke();
      if (deg % 45 === 0) {
        const n = {
          0: 'N',
          45: 'NE',
          90: 'E',
          135: 'SE',
          180: 'S',
          225: 'SW',
          270: 'W',
          315: 'NW',
        }[deg];
        tctx.font = '700 11px ui-rounded, system-ui';
        tctx.fillStyle = deg === 0 ? '#ff6b61' : '#fff';
        tctx.fillText(n, x, hh - 16);
      } else if (deg % 15 === 0) {
        tctx.font = '500 9px ui-rounded, system-ui';
        tctx.fillStyle = 'rgba(255,255,255,0.5)';
        tctx.fillText(String(deg), x, hh - 16);
      }
    }
    const fade = (x0, x1) => {
      const g = tctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      tctx.globalCompositeOperation = 'destination-out';
      tctx.fillStyle = g;
      tctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), hh);
      tctx.globalCompositeOperation = 'source-over';
    };
    fade(0, 30);
    fade(w, w - 30);
    $('.cap-caret', view).dataset.deg = `${Math.round(p.az)}°`;
  }

  /* ---------- shutter ---------- */
  let hold = null;
  let recording = null;
  shutter.addEventListener('pointerdown', (e) => {
    if (mode === 'look' || mode === 'live' || mode === 'upload') return;
    e.preventDefault();
    hold = setTimeout(startVideo, 380);
  });
  const release = async () => {
    if (mode === 'look' || mode === 'live' || mode === 'upload') return;
    if (hold) {
      clearTimeout(hold);
      hold = null;
      if (!recording) await takePhoto();
    }
    if (recording) await stopVideo();
  };
  shutter.addEventListener('pointerup', release);
  shutter.addEventListener('pointerleave', () => recording && release());
  shutter.addEventListener('click', (e) => {
    if (mode === 'look') {
      setMode('witness');
      return;
    }
    if (mode === 'live') {
      if (live) endLive();
      else goLive();
      return;
    }
    if (mode === 'upload') {
      $('.up-btn input', view).click();
      return;
    }
    if (e.detail === 0) takePhoto();
  });

  async function startVideo() {
    hold = null;
    if (!camOk || !camera.canRecord()) {
      showStatus('Video needs a camera — sealing a still instead');
      return takePhoto();
    }
    try {
      camera.startVideo();
    } catch (err) {
      showStatus(err.message);
      return;
    }
    recording = {
      t0: performance.now(),
      timer: setTimeout(() => stopVideo(), 15000),
    };
    root.classList.add('recording');
    haptic('medium');
  }
  async function stopVideo() {
    const r = recording;
    recording = null;
    clearTimeout(r?.timer);
    root.classList.remove('recording');
    const blob = await camera.stopVideo();
    if (blob?.size) await sealMedia(blob, 'video');
  }

  async function takePhoto() {
    flash();
    haptic('light');
    let blob;
    let test = false;
    try {
      blob = await camera.photo();
    } catch {
      test = true;
      blob = await new Promise((resolve) => {
        const c = document.createElement('canvas');
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        const x = c.getContext('2d');
        x.drawImage(ar, 0, 0);
        x.fillStyle = 'rgba(255,209,102,0.9)';
        x.font = `${Math.round(16 * dpr)}px ui-monospace, monospace`;
        x.fillText(
          `TEST FRAME ${new Date().toISOString()}`,
          16 * dpr,
          c.height - 24 * dpr,
        );
        c.toBlob(resolve, 'image/jpeg', 0.9);
      });
    }
    await sealMedia(blob, 'photo', test);
  }

  function flash() {
    const f = h('<div class="cap-flash"></div>');
    root.appendChild(f);
    f.animate([{ opacity: 0.85 }, { opacity: 0 }], {
      duration: reducedMotion() ? 80 : 320,
      easing: 'ease-out',
    }).finished.then(() => f.remove());
  }

  async function sealMedia(blob, kind, test = false, preset = null) {
    const session = preset ||
      sensors.endSession() || {
        start: new Date().toISOString(),
        end: new Date().toISOString(),
        imu: [],
        gps: [],
        heading: null,
      };
    if (!session.heading) {
      const p = pose();
      session.heading = {
        deg: Math.round(p.az * 10) / 10,
        pitch: Math.round(p.el * 10) / 10,
        roll: 0,
        source: 'simulated',
      };
    }
    session.mode = kind;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const context = {
      app: 'gods-eye-mobile-prototype/0.1',
      device:
        navigator.userAgentData?.platform || navigator.platform || 'unknown',
      mobile:
        navigator.userAgentData?.mobile ?? /Mobi/i.test(navigator.userAgent),
      ua: navigator.userAgent,
      screen: {
        w: screen.width,
        h: screen.height,
        dpr: devicePixelRatio,
        orientation: screen.orientation?.type || null,
      },
      timezone: tz,
      tzOffsetMin: new Date().getTimezoneOffset(),
      networkTimeOffsetMs: netOffset,
      camera: camera.info(),
      sensors: {
        motion: sensors.state.hasMotion,
        orientation: sensors.state.hasOrientation,
        absoluteHeading:
          sensors.state.absolute || sensors.state.compass != null,
      },
      testFrame: test || undefined,
    };
    const url = URL.createObjectURL(blob);
    showSealing(url, kind, test);
    try {
      const bundle = await seal({ media: blob, session, context });
      lastCapture = { bundle, url };
      setThumb(url, kind === 'live' ? 'video' : kind);
      showSealed(bundle, url, kind, test);
      onSealed?.(bundle);
    } catch (err) {
      console.error(err);
      sealEl.hidden = true;
      toast(`Could not seal: ${err.message}`);
    }
    if (active && mode === 'witness') sensors.beginSession();
  }

  function setThumb(url, kind) {
    const t = $('.cap-thumb', view);
    t.innerHTML =
      kind === 'video'
        ? `<video src="${url}" muted playsinline></video>`
        : `<img src="${url}" alt="Last sealed capture"/>`;
    t.classList.add('has');
  }

  /* ---------- seal ceremony ---------- */
  const SEAL_D = (() => {
    let d = '';
    for (let i = 0; i <= 96; i += 1) {
      const a = (i / 96) * Math.PI * 2;
      const r = 40 + 4.2 * Math.cos(a * 12);
      d += `${i ? 'L' : 'M'}${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
    }
    return `${d}Z`;
  })();

  function showSealing(url, kind, test) {
    sealEl.hidden = false;
    sealEl.innerHTML = `<div class="seal-card glass-strong">
        <div class="seal-media">${kind === 'video' || kind === 'live' ? `<video src="${url}" muted playsinline autoplay loop></video>` : `<img src="${url}" alt="Captured frame"/>`}${test ? '<span class="badge-example">Test frame</span>' : ''}</div>
        <div class="seal-glyph"><svg viewBox="0 0 100 100" aria-hidden="true"><path class="seal-ring" d="${SEAL_D}"/><path class="seal-check" d="M33 51 l11 11 l23 -24"/></svg></div>
        <div class="seal-state">Sealing…</div>
        <div class="seal-hash mono" aria-label="Bundle hash"></div>
      </div>`;
    scramble($('.seal-hash', sealEl), null);
  }

  function scramble(el, finalText) {
    const hex = '0123456789abcdef';
    const len = 64;
    let n = 0;
    clearInterval(scramble.t);
    scramble.t = setInterval(
      () => {
        n += 1;
        let s = '';
        for (let i = 0; i < len; i += 1) {
          const settled = finalText && i < (n - 6) * 4;
          s += settled ? finalText[i] : hex[(Math.random() * 16) | 0];
        }
        el.innerHTML = s
          .match(/.{16}/g)
          .map((g) => `<span>${g}</span>`)
          .join('');
        if (finalText && (n - 6) * 4 >= len) clearInterval(scramble.t);
      },
      reducedMotion() ? 1 : 28,
    );
  }

  function showSealed(bundle, url, kind, test) {
    const card = $('.seal-card', sealEl);
    card.classList.add('sealed');
    haptic('seal');
    $('.seal-state', sealEl).innerHTML =
      bundle.session?.mode === 'live'
        ? `<b>Sealed live</b> · ${bundle.session.segments?.length || 0} segments · capture #${bundle.seq}`
        : `<b>Sealed</b> · capture #${bundle.seq}`;
    scramble($('.seal-hash', sealEl), bundle.hash);
    const imu = bundle.session.imu;
    const mags = imu.map((s) => Math.hypot(s.ax ?? 0, s.ay ?? 0, s.az ?? 0));
    const dur = imu.length > 1 ? (imu[imu.length - 1].t - imu[0].t) / 1000 : 0;
    const gps = bundle.session.gps;
    const f = gps[gps.length - 1];
    card.insertAdjacentHTML(
      'beforeend',
      `<div class="seal-spark">${mags.length > 2 ? `<svg viewBox="0 0 240 34" preserveAspectRatio="none"><path d="${sparkPath(mags, 240, 34, 2)}"/></svg>` : '<div class="seal-nospark">No motion sensors on this device</div>'}<span>IMU ${imu.length} samples${dur ? ` · ${dur.toFixed(1)} s` : ''}</span></div>
      <dl class="seal-facts">
        <dt>Signed</dt><dd>ECDSA P-256 · key <span class="mono">${esc(bundle.keyId)}</span></dd>
        <dt>Chain</dt><dd>#${bundle.seq} ← ${bundle.prev ? `<span class="mono">${esc(bundle.prev.slice(0, 12))}…</span>` : 'genesis'}</dd>
        <dt>Where</dt><dd>${f ? `<span class="mono">${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}</span> ±${Math.round(f.acc)} m` : 'no GPS fix'}</dd>
        <dt>Heading</dt><dd>${bundle.session.heading ? `${Math.round(bundle.session.heading.deg)}° · ${esc(bundle.session.heading.source)}` : '—'}</dd>
        <dt>Media</dt><dd>${esc(bundle.media.type)} · ${(bundle.media.bytes / 1024).toFixed(0)} KB</dd>
      </dl>
      <div class="seal-actions"><button class="pill-btn primary" type="button" data-seal="post">${icon(target?.needEyes ? 'eyes' : 'sendUp')}${target?.needEyes ? 'Answer the request' : target ? 'Post to the room' : 'Post to a room'}</button><button class="pill-btn seal" type="button" data-seal="verify">${icon('seal')}Verify</button><button class="pill-btn plain" type="button" data-seal="done">Keep private</button></div>`,
    );
  }

  sealEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-seal]')?.dataset.seal;
    if (a === 'done') sealEl.hidden = true;
    if (a === 'verify' && lastCapture) onVerify?.(lastCapture.bundle);
    if (a === 'post' && lastCapture) {
      sealEl.hidden = true;
      openAttach(lastCapture.bundle, lastCapture.url);
    }
  });

  /** Hand a sealed bundle to the attach sheet. */
  function openAttach(bundle, url) {
    const g = bundle.session?.gps || [];
    const f = g[g.length - 1];
    const sim = observer();
    const fix = f
      ? { lat: f.lat, lon: f.lon, acc: f.acc }
      : sim.simulated
        ? null
        : { lat: sim.lat, lon: sim.lon, acc: sim.acc };
    attach?.open(
      {
        kind: bundle.session?.mode === 'live' ? 'live' : 'capture',
        id: bundle.id,
        seq: bundle.seq,
        at: Date.parse(bundle.session?.end || bundle.sealedAt),
        fix,
        sealed: true,
        previewUrl: url,
        isVideo: /video/.test(bundle.media?.type || ''),
        headingDeg: bundle.session?.heading?.deg ?? null,
        segments: bundle.session?.segments?.length || 0,
      },
      {
        preset: target?.s || null,
        replyTo: target?.replyTo || null,
        needEyes: target?.needEyes || null,
      },
    );
  }

  $('.cap-thumb', view).addEventListener('click', () => {
    if (lastCapture) onVerify?.(lastCapture.bundle);
    else toast('No captures yet — switch to Witness and tap the shutter');
  });
  view.querySelector('[data-act="recenter"]').addEventListener('click', () => {
    const s = sensors.state;
    showStatus(
      `${camOk ? 'Camera on' : 'No camera'} · ${s.hasOrientation ? (s.compass != null ? 'compass' : s.absolute ? 'absolute orientation' : 'relative orientation') : 'no motion sensors'} · ${s.fix ? `GPS ±${Math.round(s.fix.acc)} m` : s.geoError ? 'location denied' : 'locating…'}`,
      3500,
    );
  });

  /* ---------- live broadcast ---------- */
  let hudLiveT = 0;
  function updateLiveHud(p) {
    const now = performance.now();
    if (now - hudLiveT < 250) return;
    hudLiveT = now;
    const o = observer();
    const q = (k) => liveHud.querySelector(`[data-lh="${k}"]`);
    q('state').textContent = live ? 'LIVE' : 'OFF AIR';
    if (!live) q('elapsed').textContent = 'tap the shutter to go live';
    if (live) {
      const sec = Math.round((Date.now() - live.t0) / 1000);
      q('elapsed').textContent =
        `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      q('viewers').textContent = String(rt.viewersOf(live.id));
    }
    q('tele').textContent = [
      `HDG ${String(Math.round(p.az)).padStart(3, '0')}° ${cardinal(p.az)}`,
      `PITCH ${p.el >= 0 ? '+' : ''}${Math.round(p.el)}°`,
      `${llShort(o.lat, o.lon, 4)}${o.simulated ? ' SIM' : ` ±${Math.round(o.acc || 0)} M`}`,
      `IMU ${sensors.state.hasMotion ? 'ON' : 'OFF'}`,
      live ? `SEG ${live.session.segments.length}` : 'STANDBY',
    ].join(' · ');
  }

  async function goLive() {
    const stream = video.srcObject;
    if (!camOk || !canBroadcast(stream)) {
      showStatus('Live needs a camera on this device');
      return;
    }
    const id = `${rt.tab}-${Date.now().toString(36)}`;
    const session = createLiveSession({
      stream,
      sensors,
      pose,
      fix: () => {
        const o = observer();
        return o.simulated ? null : o;
      },
      onSegment: addSegment,
    });
    try {
      session.start();
    } catch (err) {
      showStatus(`Could not start: ${err.message}`);
      return;
    }
    live = { id, session, t0: Date.now(), pin: null, lastHd: null, timer: 0 };
    root.classList.add('is-live');
    $('.shutter-label', view).textContent = 'END';
    shutter.setAttribute('aria-label', 'End broadcast');
    $('.lh-chain', view).innerHTML =
      '<span class="seg pending tele"><i></i>sealing every 10 s</span>';
    haptic('medium');
    broadcastTick();
    live.timer = setInterval(broadcastTick, 1000);
  }

  function broadcastTick() {
    if (!live) return;
    const p = pose();
    const o = observer();
    const hd = Math.round(p.az / 5) * 5;
    if (live.lastHd !== hd) {
      if (live.pin) globe.removePin(live.pin);
      live.pin = globe.addPin({
        id: `live:${live.id}`,
        kind: 'live',
        lon: o.lon,
        lat: o.lat,
        headingDeg: p.az,
        fovDeg: VFOV,
        label: 'You · live',
      });
      live.lastHd = hd;
    }
    let frame = null;
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const c =
          live.canvas || (live.canvas = document.createElement('canvas'));
        c.width = 320;
        c.height = 180;
        const x = c.getContext('2d');
        const sc = Math.max(320 / vw, 180 / vh);
        x.drawImage(
          video,
          (320 - vw * sc) / 2,
          (180 - vh * sc) / 2,
          vw * sc,
          vh * sc,
        );
        frame = c.toDataURL('image/jpeg', 0.6);
      }
    } catch {
      frame = null;
    }
    rt.liveTick(
      {
        id: live.id,
        handle: rt.me.handle,
        startedAt: live.t0,
        lat: o.lat,
        lon: o.lon,
        acc: o.acc,
        simulated: !!o.simulated,
        headingDeg: p.az,
        segments: live.session.segments.length,
        viewers: rt.viewersOf(live.id),
        situationTitle: target?.s?.title || null,
      },
      frame,
    );
  }

  function addSegment(seg) {
    const chain = $('.lh-chain', view);
    chain.querySelector('.pending')?.remove();
    chain.appendChild(
      h(
        `<span class="seg tele" title="sha256 ${esc(seg.hash)}"><i></i>#${seg.i + 1} ${esc(seg.hash.slice(0, 6))}${seg.prev ? ` ← ${esc(seg.prev.slice(0, 4))}` : ''}</span>`,
      ),
    );
    while (chain.children.length > 4) chain.firstElementChild.remove();
    haptic('tick');
  }

  async function endLive() {
    const l = live;
    if (!l) return;
    live = null;
    clearInterval(l.timer);
    root.classList.remove('is-live');
    $('.shutter-label', view).textContent = 'GO LIVE';
    shutter.setAttribute('aria-label', 'Go live');
    rt.liveEnd(l.id);
    if (l.pin) globe.removePin(l.pin);
    showStatus('Sealing the broadcast…', 2500);
    const out = await l.session.stop();
    const p = pose();
    const session = {
      ...out.session,
      heading: out.session.heading || {
        deg: Math.round(p.az * 10) / 10,
        pitch: Math.round(p.el * 10) / 10,
        roll: 0,
        source: sensors.state.hasOrientation ? 'relative' : 'simulated',
      },
      segments: out.segments,
      liveId: l.id,
    };
    if (out.blob.size) await sealMedia(out.blob, 'live', false, session);
  }

  /* ---------- upload ---------- */
  const fileInput = $('.up-btn input', view);
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) await placeUpload(f);
  });

  const toLocalInput = (ms) => {
    const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };

  async function placeUpload(file) {
    const isJpeg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name);
    const exif = isJpeg ? await readExif(file).catch(() => null) : null;
    const url = URL.createObjectURL(file);
    const isVideo = /^video/.test(file.type);
    const me = getLocation?.() || sensors.state.fix;
    const loc =
      exif?.lat != null
        ? { lat: exif.lat, lon: exif.lon, src: 'EXIF GPS' }
        : target?.s
          ? { lat: target.s.lat, lon: target.s.lon, src: 'ROOM LOCATION' }
          : me
            ? { lat: me.lat, lon: me.lon, src: 'YOUR LOCATION' }
            : { lat: FALLBACK_POS.lat, lon: FALLBACK_POS.lon, src: 'DEFAULT' };
    const taken = exif?.takenAt || file.lastModified || Date.now();
    const place = $('.up-place', view);
    $('.up-pick', view).hidden = true;
    place.hidden = false;
    const rows = [
      [
        'Position',
        exif?.lat != null
          ? `${llShort(exif.lat, exif.lon, 5)} (EXIF)`
          : 'none in file',
      ],
      [
        'Taken',
        exif?.takenAt
          ? `${new Date(exif.takenAt).toLocaleString()}${exif.takenAtHasZone ? '' : ' (no time zone in file)'}`
          : `unknown · file date ${new Date(file.lastModified).toLocaleDateString()}`,
      ],
      [
        'Camera',
        (exif?.model && exif?.make && exif.model.startsWith(exif.make)
          ? exif.model
          : [exif?.make, exif?.model].filter(Boolean).join(' ')) || '—',
      ],
      [
        'Direction',
        Number.isFinite(exif?.headingDeg)
          ? `${Math.round(exif.headingDeg)}° ${cardinal(exif.headingDeg)}`
          : '—',
      ],
    ];
    place.innerHTML = `
      <div class="up-head"><span class="up-thumb">${isVideo ? `<video src="${esc(url)}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${esc(url)}" alt="Chosen file"/>`}</span>
        <div class="up-name"><b>${esc(file.name || 'Untitled')}</b><span class="tele">${esc((file.type || 'file').toUpperCase())} · ${(file.size / 1024).toFixed(0)} KB</span></div>
        <span class="bdg" data-b="unverified">${icon('hazards')}Unverified</span></div>
      <dl class="up-exif">${rows.map(([k, v]) => `<dt class="tele">${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="up-h tele">${icon('pin')}Place it — drag the map under the pin</div>
      <div class="up-map"></div>
      <div class="up-h tele">${icon('clock')}When was it taken</div>
      <input class="up-time" type="datetime-local" value="${toLocalInput(taken)}" aria-label="When it was taken"/>
      <p class="up-why">${icon('info')}<span>Marked <b>Unverified</b> everywhere. EXIF is easy to edit and nothing was sealed when this was taken, so it can be cited by a hypothesis but never counted as an observation or earn Was there.</span></p>
      <div class="up-actions"><button class="pill-btn plain" type="button" data-up="cancel">Cancel</button><button class="pill-btn primary" type="button" data-up="next">${icon('chevronRight')}Continue</button></div>`;
    let moved = false;
    const map = createMiniMap($('.up-map', place), {
      lat: loc.lat,
      lon: loc.lon,
      spanDeg: exif?.lat != null ? 0.008 : 0.05,
      label: loc.src,
      onChange: () => (moved = true),
    });
    place.onclick = async (e) => {
      const a = e.target.closest('[data-up]')?.dataset.up;
      if (a === 'cancel') return resetUpload(url);
      if (a !== 'next') return;
      const c = map.center;
      const t = Date.parse($('.up-time', place).value) || taken;
      const rec = {
        id: `up-${Date.now().toString(36)}`,
        name: file.name,
        type: file.type,
        size: file.size,
        sha256: await sha256Hex(file),
        lat: c.lat,
        lon: c.lon,
        takenAt: t,
        placedBy: moved ? 'hand' : loc.src.toLowerCase(),
        exif: exif
          ? {
              lat: exif.lat,
              lon: exif.lon,
              takenAt: exif.takenAt,
              make: exif.make,
              model: exif.model,
              headingDeg: exif.headingDeg,
            }
          : null,
        addedAt: Date.now(),
        blob: file,
      };
      await put('uploads', rec).catch((err) =>
        console.warn('upload not stored', err),
      );
      resetUpload();
      onSealed?.(null);
      attach?.open(
        {
          kind: 'upload',
          id: rec.id,
          at: t,
          fix: { lat: c.lat, lon: c.lon },
          unverified: true,
          sealed: false,
          previewUrl: url,
          isVideo,
          headingDeg: exif?.headingDeg ?? null,
        },
        {
          preset: target?.s || null,
          replyTo: target?.replyTo || null,
          needEyes: target?.needEyes || null,
        },
      );
    };
  }

  function resetUpload(url) {
    if (url) URL.revokeObjectURL(url);
    const place = $('.up-place', view);
    place.hidden = true;
    place.innerHTML = '';
    $('.up-pick', view).hidden = false;
  }

  /* ---------- reply target ---------- */
  function attachTo(s, { replyTo = null, needEyes = null } = {}) {
    target = s ? { s, replyTo, needEyes } : null;
    targetChip.hidden = !target;
    targetChip.classList.toggle('is-need', !!needEyes);
    if (target) {
      targetChip.innerHTML = needEyes
        ? `${icon('eyes')}<span>Need eyes · <b>${esc(needEyes.question.length > 46 ? `${needEyes.question.slice(0, 45)}…` : needEyes.question)}</b></span>${icon('close')}`
        : `${icon('reply')}<span>Answering in <b>${esc(s.title)}</b>${replyTo ? ` · ${esc(replyTo.author.handle)}` : ''}</span>${icon('close')}`;
      if (mode === 'look' || mode === 'upload') setMode('witness');
    }
    renderNeeds();
  }
  targetChip.addEventListener('click', () => attachTo(null));

  /* ---------- Need eyes near you (top of Capture) ---------- */
  const needsEl = $('.cap-needs', view);
  let needs = [];
  let needsOpen = false;
  async function refreshNeeds() {
    try {
      const m = await import('./social.js');
      const o = observer();
      const ll = o.simulated ? getLocation?.() || m.socialCore().myLoc() : o;
      needs = m
        .needEyesNear({ lat: ll.lat, lon: ll.lon }, 30)
        .filter((r) => r.status === 'open');
    } catch {
      needs = [];
    }
    renderNeeds();
  }
  function renderNeeds() {
    const list = needs.filter((r) => r.id !== target?.needEyes?.id);
    needsEl.hidden = !list.length || mode === 'live';
    if (needsEl.hidden) return;
    const r0 = list[0];
    needsEl.innerHTML = `<button type="button" class="cn-pill glass-strong" data-cn="toggle" aria-expanded="${needsOpen}">${icon('eyes')}<span><b>${list.length} Need eyes near you</b><small>“${esc(r0.question.length > 44 ? `${r0.question.slice(0, 43)}…` : r0.question)}” · ${esc(r0.distLabel || '')}</small></span>${icon(needsOpen ? 'chevronUp' : 'chevronDown')}</button>${
      needsOpen
        ? `<div class="cn-list glass-strong">${list
            .slice(0, 4)
            .map(
              (r) =>
                `<button type="button" class="cn-row" data-cn="answer" data-id="${esc(r.id)}"><span><b>“${esc(r.question)}”</b><small class="tele">${esc(r.distLabel || '')} · ${esc(r.by)} · +40 SIGNAL${r.example ? ' · EXAMPLE' : ''}</small></span><em>Answer</em></button>`,
            )
            .join('')}</div>`
        : ''
    }`;
  }
  needsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cn]');
    if (!b) return;
    haptic('tick');
    if (b.dataset.cn === 'toggle') {
      needsOpen = !needsOpen;
      renderNeeds();
      return;
    }
    const r = needs.find((x) => x.id === b.dataset.id);
    if (!r) return;
    needsOpen = false;
    attachTo(r.situation, { needEyes: r });
    showStatus('Seal a photo from inside the radius to answer', 3200);
  });
  let needsTimer = 0;
  const needsLoop = () => {
    clearTimeout(needsTimer);
    if (!active) return;
    refreshNeeds();
    needsTimer = setTimeout(needsLoop, 30000);
  };

  return {
    enter,
    leave,
    attachTo,
    get live() {
      return !!live;
    },
    setMode,
    get mode() {
      return mode;
    },
    sensors,
  };
}
