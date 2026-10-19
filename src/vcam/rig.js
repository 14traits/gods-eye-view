/**
 * Virtual-camera rig: maps a phone's tracked pose onto a camera in the local
 * east-north-up (ENU) frame of an anchor point, with no renderer dependency.
 *
 * The phone reports a Y-up pose (+x right, +y up, -z forward, WebXR's
 * convention) whose yaw is arbitrary. Recenter aligns the phone's current
 * yaw with the camera's heading and zeroes its position, so the camera never
 * jumps in place or heading: it continues from where it is and follows the
 * phone's motion from there, multiplied by the motion scale. A 1:1000 rig
 * turns one step across the room into a kilometre over the city.
 *
 * Every step returns an `anchorShift`, an ENU translation the caller applies
 * to its geographic anchor before reading the camera offset from it. The
 * sticks, scale changes and recenters move the anchor rather than the
 * phone's origin, so the camera stays continuous.
 */

/** Motion-scale presets: walking, crane, drone, city flyover, orbit. */
export const SCALE_PRESETS = Object.freeze([1, 10, 100, 1000, 10000]);
export const SCALE_RANGE = Object.freeze([0.01, 100000]);
/** Stick travel at full deflection, in metres per second at 1:1. */
const STICK_SPEED_MPS = 2.5;
const STICK_YAW_RAD_PER_S = Math.PI / 3;
/** Longest smoothing time constant, at smoothing 1. */
const MAX_SMOOTHING_SEC = 0.6;

const scaleVector = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize(a) {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 1e-12 ? scaleVector(a, 1 / length) : [0, 0, 0];
}

/** Rotate vector `v` by unit quaternion `q` ([x, y, z, w]). */
export function rotateByQuaternion(q, v) {
  const [x, y, z, w] = q;
  const u = [x, y, z];
  const t = scaleVector(cross(u, v), 2);
  return add(add(v, scaleVector(t, w)), cross(u, t));
}

function normalizeQuaternion(q) {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  return length > 1e-12 ? q.map((v) => v / length) : [0, 0, 0, 1];
}

/** Normalized linear interpolation along the short arc. */
export function nlerpQuaternion(a, b, k) {
  const sign =
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return normalizeQuaternion(a.map((v, i) => v + (b[i] * sign - v) * k));
}

/** Y-up phone vector to ENU: +x east, -z north, +y up. */
const toEnu = (v) => [v[0], -v[2], v[1]];

/** Rotate an ENU vector clockwise about up by `yaw` radians (heading increases). */
function yawEnu(v, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
}

/** Heading (radians, clockwise from north) of an ENU direction, or null when vertical. */
export function headingOfEnu(v) {
  if (Math.hypot(v[0], v[1]) < 1e-6) return null;
  return Math.atan2(v[0], v[1]);
}

/** The phone's forward and up vectors in its own Y-up frame. */
function phoneAxes(q) {
  return {
    forward: rotateByQuaternion(q, [0, 0, -1]),
    up: rotateByQuaternion(q, [0, 1, 0]),
  };
}

/** Yaw of a phone pose: the heading of its forward (or, looking straight down, its top edge). */
function phoneYaw(q) {
  const { forward, up } = phoneAxes(q);
  return headingOfEnu(toEnu(forward)) ?? headingOfEnu(toEnu(up)) ?? 0;
}

/**
 * Create a rig. Settings may change at any time; changes that would move the
 * camera instead re-zero the phone so the camera holds still.
 *
 * @param {object} [settings]
 * @param {number} [settings.scale=1] - World metres per phone metre.
 * @param {number} [settings.smoothing=0.3] - 0 (raw) to 1 (heavily damped).
 * @param {boolean} [settings.heightLock=false] - Ignore the phone's vertical motion.
 * @param {boolean} [settings.horizonLock=false] - Keep the horizon level (no roll).
 */
export function createRig(settings = {}) {
  const state = {
    scale: clampScale(settings.scale ?? 1),
    smoothing: clamp01(settings.smoothing ?? 0.3),
    heightLock: !!settings.heightLock,
    horizonLock: !!settings.horizonLock,
    yaw: 0,
    origin: null,
    raw: null,
    smoothed: null,
    centered: false,
  };

  /** Camera offset from the anchor for the smoothed pose, in ENU metres. */
  function offset() {
    if (!state.smoothed?.p || !state.origin) return [0, 0, 0];
    const delta = subtract(state.smoothed.p, state.origin);
    if (state.heightLock) delta[1] = 0;
    return scaleVector(yawEnu(toEnu(delta), state.yaw), state.scale);
  }

  function orientation() {
    const q = state.smoothed?.q || [0, 0, 0, 1];
    const { forward, up } = phoneAxes(q);
    const f = normalize(yawEnu(toEnu(forward), state.yaw));
    let u = normalize(yawEnu(toEnu(up), state.yaw));
    if (state.horizonLock) {
      // The level up vector: world up with the forward component removed.
      const level = normalize(subtract([0, 0, 1], scaleVector(f, f[2])));
      if (Math.hypot(...level) > 0.5) u = level;
    }
    return { forward: f, up: u };
  }

  /**
   * Keep the camera where it is but restart the phone's motion from here,
   * facing `heading` (radians). Returns the anchor shift this requires.
   */
  function recenter(heading) {
    if (!state.raw) return [0, 0, 0];
    const shift = offset();
    state.smoothed = {
      p: state.raw.p && [...state.raw.p],
      q: [...state.raw.q],
    };
    state.origin = state.raw.p ? [...state.raw.p] : null;
    state.yaw =
      (Number.isFinite(heading) ? heading : 0) - phoneYaw(state.raw.q);
    state.centered = true;
    return shift;
  }

  /**
   * Advance one frame.
   * @param {object} input
   * @param {number[]} input.q - Phone orientation quaternion [x, y, z, w].
   * @param {number[]|null} [input.p] - Phone position in metres, or null (3DoF).
   * @param {number[]} [input.joy] - Sticks [moveX, moveY, panX, craneY] in -1..1.
   * @param {number} input.dt - Seconds since the previous step.
   * @returns {{ anchorShift: number[], offset: number[], forward: number[], up: number[] }}
   */
  function step({ q, p = null, joy = [0, 0, 0, 0], dt }) {
    const pose = {
      q: normalizeQuaternion(q),
      p: Array.isArray(p) ? [...p] : null,
    };
    let anchorShift = [0, 0, 0];
    // Switching between 6DoF and 3DoF tracking re-zeros position.
    if (state.raw && !!state.raw.p !== !!pose.p) {
      anchorShift = add(anchorShift, offset());
      state.origin = pose.p ? [...pose.p] : null;
      if (state.smoothed) state.smoothed.p = pose.p ? [...pose.p] : null;
    }
    state.raw = pose;
    if (!state.smoothed)
      state.smoothed = { p: pose.p && [...pose.p], q: [...pose.q] };
    else {
      const tau = state.smoothing * MAX_SMOOTHING_SEC;
      const k = tau > 0 ? 1 - Math.exp(-Math.max(0, dt) / tau) : 1;
      state.smoothed.q = nlerpQuaternion(state.smoothed.q, pose.q, k);
      if (pose.p)
        state.smoothed.p = state.smoothed.p
          ? state.smoothed.p.map((v, i) => v + (pose.p[i] - v) * k)
          : [...pose.p];
    }
    if (!state.origin && pose.p) state.origin = [...pose.p];

    const { forward, up } = orientation();
    const [moveX, moveY, panX, craneY] = joy.map(
      (v) => Math.sign(v) * Math.min(1, Math.abs(v)) ** 2,
    );
    const speed = STICK_SPEED_MPS * state.scale * Math.max(0, dt);
    if (moveX || moveY || craneY) {
      // Sticks move relative to where the camera faces, on the level plane.
      const heading = headingOfEnu(forward) ?? headingOfEnu(up) ?? 0;
      const ahead = [Math.sin(heading), Math.cos(heading), 0];
      const right = [Math.cos(heading), -Math.sin(heading), 0];
      anchorShift = add(
        anchorShift,
        add(
          add(
            scaleVector(ahead, moveY * speed),
            scaleVector(right, moveX * speed),
          ),
          [0, 0, craneY * speed],
        ),
      );
    }
    if (panX && dt > 0) {
      // Pan about the camera itself: move the anchor so the camera stays put.
      const before = offset();
      state.yaw += panX * STICK_YAW_RAD_PER_S * dt;
      anchorShift = add(anchorShift, subtract(before, offset()));
    }
    const turned = panX ? orientation() : { forward, up };
    return {
      anchorShift,
      offset: offset(),
      forward: turned.forward,
      up: turned.up,
    };
  }

  /** Apply settings; a scale change re-zeros the phone so the camera holds still. */
  function configure(next = {}) {
    let anchorShift = [0, 0, 0];
    if (Number.isFinite(next.scale) && clampScale(next.scale) !== state.scale) {
      anchorShift = offset();
      state.scale = clampScale(next.scale);
      if (state.smoothed?.p) state.origin = [...state.smoothed.p];
    }
    if (Number.isFinite(next.smoothing))
      state.smoothing = clamp01(next.smoothing);
    if (
      typeof next.heightLock === 'boolean' &&
      next.heightLock !== state.heightLock
    ) {
      anchorShift = add(anchorShift, offset());
      state.heightLock = next.heightLock;
      if (state.smoothed?.p) state.origin = [...state.smoothed.p];
    }
    if (typeof next.horizonLock === 'boolean')
      state.horizonLock = next.horizonLock;
    return anchorShift;
  }

  return {
    step,
    recenter,
    configure,
    get settings() {
      return {
        scale: state.scale,
        smoothing: state.smoothing,
        heightLock: state.heightLock,
        horizonLock: state.horizonLock,
      };
    },
    get centered() {
      return state.centered;
    },
    get tracking() {
      return state.raw ? (state.raw.p ? '6dof' : '3dof') : null;
    },
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
function clampScale(value) {
  return Math.max(SCALE_RANGE[0], Math.min(SCALE_RANGE[1], Number(value) || 1));
}
