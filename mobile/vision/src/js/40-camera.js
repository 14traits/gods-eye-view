/* Camera: orbit (target lat/lon, range, heading, tilt, lens shift) with touch/pinch/wheel and
   inertia; fly-to along eased great-circle arcs with a log-space altitude hump (van Wijk-style);
   free rigs (ride / look / narrative) with smooth hand-off. */
const Cam = (GE.cam = {
  lat: 18, lon: 40, range: 2.7, heading: 0, tilt: 0, shiftX: 0, shiftY: 0, fovMin: 40 * D2R,
  anim: null, vel: null, rig: null, rigBlend: 0, rigFrom: null, minRange: 0.00007, maxRange: 6,
  interacting: false, lastInput: 0, enabled: true,
});
Cam.maxTilt = (r) => lerp(0.0, 1.32, smooth(1.4, 0.004, r));
Cam.basis = function () {
  const T = geo.vec(Cam.lat, Cam.lon, Cam.targetAltKm || 0);
  const { east, north, up } = geo.enu(Cam.lat, Cam.lon);
  const ch = Math.cos(Cam.heading), sh = Math.sin(Cam.heading);
  const F = v3.add(v3.scale(north, ch), v3.scale(east, sh));
  const tilt = Math.min(Cam.tilt, Cam.maxTilt(Cam.range));
  const off = v3.norm(v3.add(v3.scale(up, Math.cos(tilt)), v3.scale(F, -Math.sin(tilt))));
  const eye = v3.madd(T, off, Cam.range);
  const upv = v3.norm(v3.add(v3.scale(F, Math.cos(tilt)), v3.scale(up, Math.sin(tilt))));
  const back = off; const right = v3.norm(v3.cross(upv, back));
  return { eye, right, up: v3.cross(back, right), back, T };
};
function fovFor(w, h, fovMin) { const aspect = w / h; return aspect < 1 ? 2 * Math.atan(Math.tan(fovMin / 2) / aspect) : fovMin; }
Cam.view = function (w, h) {
  let b = Cam.basis(); let fovMin = Cam.fovMin; let range = Cam.range;
  if (Cam.rig) {
    const r = Cam.rig.pose();
    const k = ease.inOut(clamp(Cam.rigBlend, 0, 1));
    const from = Cam.rigFrom || b;
    const eye = v3.lerp(from.eye, r.eye, k);
    const back = v3.norm(v3.lerp(from.back, r.back, k)); let up = v3.norm(v3.lerp(from.up, r.up, k));
    const right = v3.norm(v3.cross(up, back)); up = v3.cross(back, right);
    b = { eye, right, up, back };
    fovMin = lerp(Cam.fovMin, r.fov || Cam.fovMin, k);
    range = lerp(Cam.range, v3.len(eye) - 1, k);
  }
  const aspect = w / h, fovY = fovFor(w, h, fovMin);
  const alt = Math.max(v3.len(b.eye) - 1, 1e-7);
  const horizon = Math.sqrt(2 * alt + alt * alt);
  const near = clamp(alt * 0.03, 1.2e-8, 0.3);
  const far = Math.max(near * 20, Math.min(12, horizon * 1.3 + 0.004));
  const [tLat, tLon] = Cam.rig ? geo.ll(b.eye) : [Cam.lat, Cam.lon];
  return { eye: b.eye, right: b.right, up: b.up, back: b.back, fovY, aspect, near, far, shiftX: Cam.shiftX, shiftY: Cam.shiftY, w, h, range, tLat, tLon };
};
Cam.ray = function (view, x, y) {
  const nx = (x / view.w) * 2 - 1, ny = 1 - (y / view.h) * 2;
  const tY = Math.tan(view.fovY / 2), tX = tY * view.aspect;
  return v3.norm(v3.add(v3.add(v3.scale(view.right, (nx - view.shiftX) * tX), v3.scale(view.up, (ny - view.shiftY) * tY)), v3.scale(view.back, -1)));
};
Cam.groundAt = function (view, x, y) {
  const rd = Cam.ray(view, x, y), ro = view.eye; const b = v3.dot(ro, rd), c = v3.dot(ro, ro) - 1, d = b * b - c;
  if (d < 0 || b > 0) return null; const t = c / (-b + Math.sqrt(d)); return geo.ll(v3.madd(ro, rd, t));
};
Cam.snapshot = () => ({ lat: Cam.lat, lon: Cam.lon, range: Cam.range, heading: Cam.heading, tilt: Cam.tilt, shiftY: Cam.shiftY, shiftX: Cam.shiftX });
Cam.set = (s) => { Object.assign(Cam, s); Cam.anim = null; Cam.vel = null; };

/* ---------- fly-to ---------- */
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
Cam.flyTo = function (to, opts = {}) {
  const from = Cam.snapshot();
  const tgt = { ...from, ...to };
  const dist = geo.dist(from.lat, from.lon, tgt.lat, tgt.lon);
  let dur = opts.duration ?? clamp(1.1 + Math.abs(Math.log(tgt.range / from.range)) * 0.22 + dist * 0.55, 1.0, 3.4);
  if (prefersReduced() || opts.instant) dur = 0;
  const peak = Math.max(from.range, tgt.range, dist * 1.25);
  Cam.vel = null;
  return new Promise((res) => {
    if (dur === 0) { Cam.set(tgt); res(); return; }
    Cam.anim = { from, to: tgt, t: 0, dur, peak, hump: peak > Math.max(from.range, tgt.range) * 1.05, res, va: geo.vec(from.lat, from.lon), vb: geo.vec(tgt.lat, tgt.lon), dh: angDiff(from.heading, tgt.heading) };
  });
};
Cam.cancel = () => { if (Cam.anim) { const r = Cam.anim.res; Cam.anim = null; r && r(); } };
Cam.update = function (dt) {
  const A = Cam.anim;
  if (A) {
    A.t += dt; const u = clamp(A.t / A.dur, 0, 1); const e = ease.inOut(u);
    const pe = A.hump ? ease.inOutSine(clamp((u - 0.08) / 0.84, 0, 1)) : e;
    const p = geo.slerp(A.va, A.vb, pe); const [la, lo] = geo.ll(p);
    Cam.lat = la; Cam.lon = lo;
    const l0 = Math.log(A.from.range), l1 = Math.log(A.to.range), lm = Math.log(A.peak);
    Cam.range = A.hump ? Math.exp((1 - e) * (1 - e) * l0 + 2 * (1 - e) * e * lm + e * e * l1) : Math.exp(lerp(l0, l1, e));
    Cam.heading = A.from.heading + A.dh * e;
    const tiltMid = A.hump ? Math.sin(Math.PI * e) : 0;
    Cam.tilt = lerp(A.from.tilt, A.to.tilt, e) * (1 - tiltMid * 0.85);
    Cam.shiftY = lerp(A.from.shiftY, A.to.shiftY, e); Cam.shiftX = lerp(A.from.shiftX, A.to.shiftX, e);
    if (u >= 1) { Cam.anim = null; Object.assign(Cam, { heading: A.to.heading, tilt: A.to.tilt, range: A.to.range, lat: A.to.lat, lon: A.to.lon }); A.res(); }
    return true;
  }
  if (Cam.rig) { Cam.rigBlend = Math.min(1, Cam.rigBlend + dt / (Cam.rig.blendTime || 1.4)); return true; }
  if (Cam.vel) {
    const v = Cam.vel; const k = Math.exp(-dt * 3.2);
    Cam.lat = clamp(Cam.lat + v.lat * dt, -86, 86); Cam.lon = ((Cam.lon + v.lon * dt + 540) % 360) - 180; Cam.heading += v.h * dt;
    v.lat *= k; v.lon *= k; v.h *= k;
    if (Math.abs(v.lat) + Math.abs(v.lon) + Math.abs(v.h) < 1e-4) Cam.vel = null;
    return true;
  }
  if (Cam.autoSpin && !Cam.interacting && performance.now() - Cam.lastInput > 2500) { Cam.lon = ((Cam.lon + dt * Cam.autoSpin + 540) % 360) - 180; return true; }
  return false;
};
Cam.setRig = function (rig) { // rig.pose() → {eye, back, up, fov}
  Cam.rigFrom = rig ? (Cam.rig ? Cam.view(400, 800) : Cam.basis()) : null;
  if (rig) { Cam.anim = null; Cam.vel = null; }
  Cam.rig = rig; Cam.rigBlend = prefersReduced() ? 1 : 0;
};
// pose helper: eye at lat/lon/alt, looking along heading/pitch (rad), optional roll
Cam.pose = function (lat, lon, altKm, hdg, pitch, roll = 0, fov) {
  const eye = geo.vec(lat, lon, altKm); const { east, north, up } = geo.enu(lat, lon);
  const F0 = v3.add(v3.scale(north, Math.cos(hdg)), v3.scale(east, Math.sin(hdg)));
  const fwd = v3.norm(v3.add(v3.scale(F0, Math.cos(pitch)), v3.scale(up, Math.sin(pitch))));
  let upv = v3.norm(v3.sub(up, v3.scale(fwd, v3.dot(up, fwd))));
  let right = v3.norm(v3.cross(fwd, upv));
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const u2 = v3.add(v3.scale(upv, c), v3.scale(right, s)); right = v3.norm(v3.cross(fwd, u2)); upv = u2; }
  return { eye, back: v3.scale(fwd, -1), up: upv, fov };
};

/* ---------- input ---------- */
Cam.attach = function (el, getView) {
  const pts = new Map(); let last = null, moved = 0, downAt = 0, samples = [];
  const metersPx = (view) => (Cam.range * 2 * Math.tan(view.fovY / 2)) / view.h * (1 + Cam.range * 0.18);
  const panBy = (dx, dy, view) => {
    const k = metersPx(view);
    const ch = Math.cos(Cam.heading), sh = Math.sin(Cam.heading);
    const tiltK = 1 + Math.min(Cam.tilt, Cam.maxTilt(Cam.range)) * 0.8;
    const de = (-dx * ch + dy * sh * tiltK) * k, dn = (dx * sh + dy * ch * tiltK) * k;
    const dLat = dn * R2D, dLon = (de * R2D) / Math.max(0.15, Math.cos(Cam.lat * D2R));
    Cam.lat = clamp(Cam.lat + dLat, -86, 86); Cam.lon = ((Cam.lon + dLon + 540) % 360) - 180;
    return [dLat, dLon];
  };
  const zoomAt = (ratio, x, y, view) => {
    const g = Cam.groundAt(view, x, y);
    const nr = clamp(Cam.range * ratio, Cam.minRange, Cam.maxRange); const f = 1 - nr / Cam.range;
    if (g && f > 0) { const p = geo.slerp(geo.vec(Cam.lat, Cam.lon), geo.vec(g[0], g[1]), f * 0.92); const [la, lo] = geo.ll(p); Cam.lat = la; Cam.lon = lo; }
    Cam.range = nr;
  };
  el.addEventListener('pointerdown', (e) => {
    if (!Cam.enabled) return;
    el.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button });
    Cam.cancel(); Cam.vel = null; Cam.interacting = true; Cam.lastInput = performance.now();
    if (pts.size === 1) { moved = 0; downAt = performance.now(); samples = []; }
    last = null; bus.emit('globe-touch');
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !Cam.enabled) return;
    const view = getView(); const p = pts.get(e.pointerId); const nx = e.clientX, ny = e.clientY;
    const dx = nx - p.x, dy = ny - p.y;
    if (pts.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      if (Cam.rig && Cam.rig.look) { Cam.rig.look(dx, dy); }
      else if (p.b === 2 || e.shiftKey || e.ctrlKey) { Cam.heading -= dx * 0.006; Cam.tilt = clamp(Cam.tilt + dy * 0.005, 0, Cam.maxTilt(Cam.range)); }
      else { const [dl, dn] = panBy(dx, dy, view); samples.push({ t: performance.now(), dl, dn }); }
      p.x = nx; p.y = ny;
    } else if (pts.size === 2) {
      const ids = [...pts.keys()]; const a = pts.get(ids[0]), b = pts.get(ids[1]);
      const before = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      p.x = nx; p.y = ny;
      const after = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      const ratio = before.d / Math.max(after.d, 1);
      const mdx = after.mx - before.mx, mdy = after.my - before.my;
      if (Cam.rig && Cam.rig.zoom) { Cam.rig.zoom(ratio); }
      else {
        if (Math.abs(ratio - 1) < 0.006 && Math.abs(mdy) > Math.abs(mdx) * 1.4) Cam.tilt = clamp(Cam.tilt - mdy * 0.006, 0, Cam.maxTilt(Cam.range));
        else { zoomAt(ratio, after.mx, after.my, view); panBy(mdx, mdy, view); Cam.heading += angDiff(before.ang, after.ang) * -1; }
      }
      moved += 99;
    }
    Cam.lastInput = performance.now();
    bus.emit('camera-move');
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const wasSingle = pts.size === 1; pts.delete(e.pointerId);
    if (wasSingle) {
      Cam.interacting = false;
      const dtp = performance.now() - downAt;
      if (moved < 9 && dtp < 450) { const r = el.getBoundingClientRect(); bus.emit('tap', { x: e.clientX - r.left, y: e.clientY - r.top }); }
      else if (!Cam.rig) {
        const now = performance.now(); const rec = samples.filter((s) => now - s.t < 90);
        if (rec.length > 1) { const span = (rec[rec.length - 1].t - rec[0].t) / 1000 || 0.016; const sl = rec.reduce((s, x) => s + x.dl, 0) / span, sn = rec.reduce((s, x) => s + x.dn, 0) / span; Cam.vel = { lat: clamp(sl, -90, 90), lon: clamp(sn, -180, 180), h: 0 }; if (prefersReduced()) Cam.vel = null; }
      }
    }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => {
    if (!Cam.enabled) return; e.preventDefault(); Cam.cancel(); Cam.vel = null; Cam.lastInput = performance.now();
    if (Cam.rig && Cam.rig.zoom) { Cam.rig.zoom(Math.exp(e.deltaY * 0.0015)); return; }
    const r = el.getBoundingClientRect(); zoomAt(Math.exp(e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top, getView()); bus.emit('camera-move');
  }, { passive: false });
};
