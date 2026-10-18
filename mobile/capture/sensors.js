/**
 * Device sensors for Look and Witness: motion/orientation (with iOS
 * permission on a user gesture), compass heading, camera pose, GPS watch,
 * and a session recorder for the sealed IMU trace.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** iOS 13+: must be called from a user gesture. */
export async function requestMotionPermission() {
  const asks = [];
  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  )
    asks.push(DeviceOrientationEvent.requestPermission());
  if (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function'
  )
    asks.push(DeviceMotionEvent.requestPermission());
  if (!asks.length)
    return typeof DeviceOrientationEvent === 'undefined'
      ? 'unsupported'
      : 'granted';
  try {
    const res = await Promise.all(asks);
    return res.every((r) => r === 'granted') ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** W3C Z-X'-Y'' rotation matrix (device → East-North-Up). */
export function rotation(alpha, beta, gamma) {
  const a = alpha * D2R;
  const b = beta * D2R;
  const g = gamma * D2R;
  const cA = Math.cos(a);
  const sA = Math.sin(a);
  const cB = Math.cos(b);
  const sB = Math.sin(b);
  const cG = Math.cos(g);
  const sG = Math.sin(g);
  return [
    [cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB],
    [cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB],
    [-cB * sG, sB, cB * cG],
  ];
}

/** Back-camera pose in ENU: forward / right / up unit vectors + azimuth/elevation. */
export function cameraPose(alpha, beta, gamma, screenAngle = 0) {
  const R = rotation(alpha, beta, gamma);
  const col = (i) => [R[0][i], R[1][i], R[2][i]];
  const fwd = col(2).map((v) => -v);
  let right = col(0);
  let up = col(1);
  if (screenAngle) {
    // Landscape: rotate the screen basis about the forward axis.
    const s = screenAngle * D2R;
    const r2 = right.map((v, i) => v * Math.cos(s) + up[i] * Math.sin(s));
    const u2 = up.map((v, i) => v * Math.cos(s) - right[i] * Math.sin(s));
    right = r2;
    up = u2;
  }
  const az = (Math.atan2(fwd[0], fwd[1]) * R2D + 360) % 360;
  const el = Math.asin(Math.max(-1, Math.min(1, fwd[2]))) * R2D;
  const roll = Math.atan2(right[2], up[2]) * R2D;
  return { fwd, right, up, az, el, roll };
}

/** Pose from a simulated yaw/pitch (desktop drag-to-look). */
export function poseFromAzEl(az, el) {
  const a = az * D2R;
  const e = el * D2R;
  const fwd = [
    Math.cos(e) * Math.sin(a),
    Math.cos(e) * Math.cos(a),
    Math.sin(e),
  ];
  const right = [Math.cos(a), -Math.sin(a), 0];
  const up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  return { fwd, right, up, az: ((az % 360) + 360) % 360, el, roll: 0 };
}

export function createSensors() {
  const state = {
    orientation: null, // {alpha,beta,gamma,absolute}
    motion: null, // {ax,ay,az,lx,ly,lz,rr}
    compass: null, // degrees, iOS webkitCompassHeading
    compassAccuracy: null,
    fix: null, // {t,lat,lon,acc,alt,heading,speed}
    geoError: null,
    hasMotion: false,
    hasOrientation: false,
    absolute: false,
  };
  const trace = []; // live |a| for the HUD
  let rec = null;
  let geoWatch = null;
  let alphaOffset = 0;
  let listeners = [];

  function onOrient(e) {
    if (e.alpha == null && e.beta == null) return;
    state.hasOrientation = true;
    const absolute =
      e.absolute === true || e.type === 'deviceorientationabsolute';
    if (absolute) state.absolute = true;
    if (
      !absolute &&
      state.absolute &&
      e.type === 'deviceorientation' &&
      e.webkitCompassHeading == null
    )
      return;
    state.orientation = {
      alpha: e.alpha ?? 0,
      beta: e.beta ?? 0,
      gamma: e.gamma ?? 0,
      absolute,
    };
    if (e.webkitCompassHeading != null) {
      state.compass = e.webkitCompassHeading;
      state.compassAccuracy = e.webkitCompassAccuracy;
      // Align the arbitrary iOS alpha with magnetic north, smoothly.
      // az = −α for an upright camera, so α + (raw − compass) points at north.
      const raw = cameraPose(e.alpha, e.beta, e.gamma).az;
      const target = ((raw - e.webkitCompassHeading + 540) % 360) - 180;
      alphaOffset += (((target - alphaOffset + 540) % 360) - 180) * 0.15;
    }
    if (rec) sample();
  }
  function onMotion(e) {
    const g = e.accelerationIncludingGravity;
    const l = e.acceleration;
    if (!g || g.x == null) return;
    state.hasMotion = true;
    state.motion = {
      ax: g.x,
      ay: g.y,
      az: g.z,
      lx: l?.x,
      ly: l?.y,
      lz: l?.z,
      rr: e.rotationRate
        ? [e.rotationRate.alpha, e.rotationRate.beta, e.rotationRate.gamma]
        : null,
    };
    const mag = Math.hypot(g.x, g.y, g.z);
    trace.push({ t: performance.now(), v: mag });
    while (trace.length && performance.now() - trace[0].t > 5000) trace.shift();
    if (rec) sample();
  }

  let lastSampleT = 0;
  function sample() {
    const now = performance.now();
    if (now - lastSampleT < 15) return; // ≤ ~66 Hz
    lastSampleT = now;
    const o = state.orientation || {};
    const m = state.motion || {};
    rec.imu.push({
      t: Date.now() - rec.t0Wall,
      α: round(o.alpha),
      β: round(o.beta),
      γ: round(o.gamma),
      ax: round(m.ax, 3),
      ay: round(m.ay, 3),
      az: round(m.az, 3),
    });
    if (rec.imu.length > 4000) rec.imu.shift();
  }

  function round(v, d = 2) {
    return Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
  }

  function on(target, type, fn) {
    target.addEventListener(type, fn, { passive: true });
    listeners.push(() => target.removeEventListener(type, fn));
  }

  function start() {
    stop();
    if ('ondeviceorientationabsolute' in window)
      on(window, 'deviceorientationabsolute', onOrient);
    on(window, 'deviceorientation', onOrient);
    on(window, 'devicemotion', onMotion);
    if ('geolocation' in navigator) {
      geoWatch = navigator.geolocation.watchPosition(
        (p) => {
          state.geoError = null;
          state.fix = {
            t: p.timestamp || Date.now(),
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            acc: p.coords.accuracy,
            alt: p.coords.altitude,
            heading: p.coords.heading,
            speed: p.coords.speed,
          };
          if (rec)
            rec.gps.push({
              t: state.fix.t,
              lat: round(state.fix.lat, 6),
              lon: round(state.fix.lon, 6),
              acc: round(state.fix.acc, 1),
              alt: round(state.fix.alt, 1),
            });
        },
        (err) => (state.geoError = err.message || 'Location unavailable'),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
      );
    }
  }

  function stop() {
    listeners.forEach((f) => f());
    listeners = [];
    if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch);
    geoWatch = null;
  }

  /** Current back-camera pose, or null without orientation sensors. */
  function pose(screenAngle = screenOrientationAngle()) {
    const o = state.orientation;
    if (!o) return null;
    const alpha = state.compass != null ? o.alpha + alphaOffset : o.alpha;
    return cameraPose(alpha, o.beta, o.gamma, screenAngle);
  }

  function headingInfo() {
    const p = pose();
    if (!p) return null;
    return {
      deg: Math.round(p.az * 10) / 10,
      pitch: Math.round(p.el * 10) / 10,
      roll: Math.round(p.roll * 10) / 10,
      source:
        state.compass != null
          ? 'compass'
          : state.absolute
            ? 'absolute'
            : 'relative',
    };
  }

  return {
    state,
    trace,
    start,
    stop,
    pose,
    headingInfo,
    /** Begin recording a session (IMU + GPS). Keeps a pre-roll of what's already live. */
    beginSession() {
      rec = {
        t0Wall: Date.now(),
        start: new Date().toISOString(),
        imu: [],
        gps: [],
      };
      if (state.fix)
        rec.gps.push({
          t: state.fix.t,
          lat: round(state.fix.lat, 6),
          lon: round(state.fix.lon, 6),
          acc: round(state.fix.acc, 1),
          alt: round(state.fix.alt, 1),
        });
      return rec;
    },
    endSession() {
      if (!rec) return null;
      const r = rec;
      rec = null;
      // Keep the last 20 s of motion before the shutter.
      const cutoff = Date.now() - r.t0Wall - 20000;
      const imu = r.imu.filter((s) => s.t >= cutoff);
      if (!r.gps.length && state.fix)
        r.gps.push({
          t: state.fix.t,
          lat: round(state.fix.lat, 6),
          lon: round(state.fix.lon, 6),
          acc: round(state.fix.acc, 1),
          alt: round(state.fix.alt, 1),
        });
      return {
        start: r.start,
        end: new Date().toISOString(),
        imu,
        gps: r.gps,
        heading: headingInfo(),
      };
    },
    get recording() {
      return !!rec;
    },
  };
}

export function screenOrientationAngle() {
  const a = screen.orientation?.angle ?? window.orientation ?? 0;
  return Number(a) || 0;
}

/* ---------- AR geometry ---------- */

const A = 6378137;
const E2 = 6.69437999014e-3;

function ecef(lat, lon, h) {
  const la = lat * D2R;
  const lo = lon * D2R;
  const N = A / Math.sqrt(1 - E2 * Math.sin(la) ** 2);
  return [
    (N + h) * Math.cos(la) * Math.cos(lo),
    (N + h) * Math.cos(la) * Math.sin(lo),
    (N * (1 - E2) + h) * Math.sin(la),
  ];
}

/** Azimuth, elevation (deg) and slant range (m) from an observer to a target. */
export function lookAngles(obs, tgt) {
  const o = ecef(obs.lat, obs.lon, obs.alt || 0);
  const t = ecef(tgt.lat, tgt.lon, tgt.altM || 0);
  const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
  const la = obs.lat * D2R;
  const lo = obs.lon * D2R;
  const e = -Math.sin(lo) * d[0] + Math.cos(lo) * d[1];
  const n =
    -Math.sin(la) * Math.cos(lo) * d[0] -
    Math.sin(la) * Math.sin(lo) * d[1] +
    Math.cos(la) * d[2];
  const u =
    Math.cos(la) * Math.cos(lo) * d[0] +
    Math.cos(la) * Math.sin(lo) * d[1] +
    Math.sin(la) * d[2];
  const range = Math.hypot(e, n, u);
  return {
    az: (Math.atan2(e, n) * R2D + 360) % 360,
    el: Math.asin(u / range) * R2D,
    range,
    enu: [e / range, n / range, u / range],
  };
}

/** Project an ENU unit direction into screen pixels for a pinhole camera. */
export function projectDir(dir, pose, W, H, vfovDeg) {
  const x =
    dir[0] * pose.right[0] + dir[1] * pose.right[1] + dir[2] * pose.right[2];
  const y = dir[0] * pose.up[0] + dir[1] * pose.up[1] + dir[2] * pose.up[2];
  const z = dir[0] * pose.fwd[0] + dir[1] * pose.fwd[1] + dir[2] * pose.fwd[2];
  const fy = H / 2 / Math.tan((vfovDeg / 2) * D2R);
  if (z <= 0.01)
    return { behind: true, x: W / 2 + x * 1e4, y: H / 2 - y * 1e4 };
  return { behind: false, x: W / 2 + (x / z) * fy, y: H / 2 - (y / z) * fy, z };
}

export function dirFromAzEl(az, el) {
  const a = az * D2R;
  const e = el * D2R;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}
