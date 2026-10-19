/**
 * Desktop side of the virtual camera: pairs a phone through the local relay,
 * drives the Cesium camera from its pose, streams a preview back and records
 * takes into the Scene Director.
 *
 * Camera ownership follows the application's rules. The rig claims the camera
 * through the shared navigation seam (so Cockpit can refuse it) and lets go
 * — holds — whenever anything else takes it: a search, a scene playing, or
 * the mouse on the globe. Releasing the hold re-anchors the rig wherever the
 * camera now is, so nothing jumps.
 */
import * as Cesium from 'cesium';
import { createRig, SCALE_RANGE } from './rig.js';
import { msg, t } from '../i18n/index.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

const RECORD_INTERVAL_MS = 1000 / 30;
// The scene document's per-array limit.
export const MAX_TAKE_SAMPLES = 10000;
const PREVIEW_FPS = 12;
const PREVIEW_WIDTH = 720;
const PREVIEW_QUALITY = 0.62;
const PREVIEW_BACKLOG_BYTES = 512 * 1024;
// Sticks stop when the phone stops talking (a dropped link, a locked screen).
const STALE_POSE_MS = 400;
const STATE_HEARTBEAT_MS = 1000;
const MIN_GROUND_CLEARANCE_M = 0.5;
const MAX_STEP_SEC = 0.5;
const MAX_RECONNECT_ATTEMPTS = 5;
const RENDER_HOLD = 'vcam';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const vectorOf = (value, length) =>
  Array.isArray(value) && value.length === length && value.every(finite)
    ? value
    : null;
const round = (value, places) => {
  const k = 10 ** places;
  return Math.round(value * k) / k;
};

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {object} options.navigation - Shell navigation: `runImmediateNavigation`, `subscribeCameraHandoff`.
 * @param {object} options.director - SceneDirector (`addRecordedShot`).
 * @param {object} options.lens - Camera lens (`setFocalLength`, `setDepthOfField`, ...).
 */
export function createVcamController({
  viewer,
  navigation,
  director,
  lens,
  fetchImpl = (...args) => fetch(...args),
  WebSocketImpl = globalThis.WebSocket,
  pageLocation = globalThis.location,
  now = () => performance.now(),
}) {
  const camera = viewer.camera;
  const scene = viewer.scene;
  const listeners = new Set();
  const rig = createRig();
  const state = {
    status: 'idle',
    error: null,
    code: null,
    port: null,
    addresses: [],
    address: null,
    caFingerprint: null,
    phoneConnected: false,
    mode: null,
    driving: false,
    held: false,
    holdReason: null,
    recording: false,
    recordStartedAt: 0,
    takes: 0,
    lastTake: null,
  };
  let session = null;
  let socket = null;
  let reconnectAttempts = 0;
  let latestPose = null;
  let lastStep = null;
  let anchor = null;
  let claiming = false;
  let rendering = false;
  let samples = [];
  let lastSampleAt = -Infinity;
  let previewBusy = false;
  let lastPreviewAt = -Infinity;
  let heartbeat = null;
  let destroyed = false;
  const previewCanvas = document.createElement('canvas');
  const removers = [];

  // ---------------------------------------------------------------- state
  const snapshot = () => ({
    ...state,
    pairingUrl:
      state.address && state.port && state.code
        ? `https://${state.address}:${state.port}/#${state.code}`
        : null,
    recordingSec: state.recording ? (now() - state.recordStartedAt) / 1000 : 0,
    settings: settings(),
  });
  function settings() {
    const dof = lens?.getDepthOfField?.() || {};
    return {
      ...rig.settings,
      focalMm: round(lens?.getFocalLength?.() ?? 31.18, 2),
      fStop: dof.fStop ?? 2.8,
      dof: !!dof.enabled,
    };
  }
  function publish() {
    const current = snapshot();
    for (const listener of listeners) {
      try {
        listener(current);
      } catch (error) {
        console.error('[vcam] listener failed', error);
      }
    }
    sendPhoneState(current);
  }
  function sendPhoneState(current = snapshot()) {
    send({
      type: 'state',
      state: {
        recording: current.recording,
        elapsedSec: round(current.recordingSec, 2),
        held: current.held,
        takes: current.takes,
        ...current.settings,
      },
    });
  }
  function send(message) {
    if (socket?.readyState === 1) socket.send(JSON.stringify(message));
  }
  function toastPhone(text) {
    send({ type: 'toast', text });
  }

  // ------------------------------------------------------------- session
  /** Create a pairing session and connect the desktop end of the relay. */
  async function start() {
    if (destroyed || session) return snapshot();
    Object.assign(state, { status: 'starting', error: null });
    publish();
    let response;
    try {
      response = await fetchImpl('/api/vcam/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      return fail(msg('The phone camera service is unavailable'));
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return fail(
        body.code === 'port-in-use'
          ? msg('The phone camera port is in use (set VCAM_PORT)')
          : body.code === 'no-network'
            ? msg('No network connection for a phone to reach')
            : msg('The phone camera service is unavailable'),
      );
    if (destroyed) return snapshot();
    session = body;
    reconnectAttempts = 0;
    Object.assign(state, {
      status: 'waiting',
      code: body.code,
      port: body.port,
      addresses: body.addresses || [],
      address: body.addresses?.[0] || null,
      caFingerprint: body.caFingerprint || null,
    });
    openSocket();
    heartbeat = setInterval(() => {
      if (state.phoneConnected) sendPhoneState();
    }, STATE_HEARTBEAT_MS);
    publish();
    return snapshot();
  }

  function fail(error) {
    Object.assign(state, { status: 'error', error });
    publish();
    return snapshot();
  }

  function openSocket() {
    if (!session || destroyed) return;
    const protocol = pageLocation.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocketImpl(
      `${protocol}//${pageLocation.host}/api/vcam/host?key=${encodeURIComponent(session.hostKey)}`,
    );
    ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.onopen = () => {
      if (socket === ws) reconnectAttempts = 0;
    };
    ws.onmessage = (event) => {
      if (socket !== ws || typeof event.data !== 'string') return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      handleMessage(message);
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      setPhoneConnected(false);
      // 4000: the server ended the session; anything else may be transient.
      // A restarted server refuses the old key, which looks like a network
      // failure from here; give up rather than retry forever.
      if (
        event.code === 4000 ||
        event.code === 4003 ||
        ++reconnectAttempts > MAX_RECONNECT_ATTEMPTS
      ) {
        endLocally(msg('Phone camera session ended'));
        return;
      }
      setTimeout(() => {
        if (session && !socket) openSocket();
      }, 1500);
    };
  }

  /** End the pairing session and release the camera. */
  async function stop() {
    const ending = session;
    endLocally(null);
    if (ending)
      await fetchImpl('/api/vcam/session', {
        method: 'DELETE',
        headers: { 'X-Vcam-Host-Key': ending.hostKey },
      }).catch(() => {});
    return snapshot();
  }

  function endLocally(error) {
    if (state.recording) stopRecording();
    session = null;
    const ws = socket;
    socket = null;
    ws?.close();
    clearInterval(heartbeat);
    heartbeat = null;
    setPhoneConnected(false);
    Object.assign(state, {
      status: error ? 'error' : 'idle',
      error,
      code: null,
      port: null,
      addresses: [],
      address: null,
      mode: null,
    });
    stopDriving();
    publish();
  }

  function setPhoneConnected(connected) {
    if (state.phoneConnected === connected) return;
    state.phoneConnected = connected;
    if (!connected) {
      latestPose = null;
      stopDriving();
      if (state.recording) stopRecording();
    }
    if (connected && state.status === 'waiting') state.status = 'connected';
    if (!connected && state.status === 'connected') state.status = 'waiting';
    syncRenderHold();
    publish();
  }

  // ------------------------------------------------------------ messages
  function handleMessage(message) {
    switch (message?.type) {
      case 'code':
        if (typeof message.code === 'string') {
          state.code = message.code.slice(0, 16);
          publish();
        }
        return;
      case 'peer':
        if (message.role === 'phone') setPhoneConnected(!!message.connected);
        return;
      case 'hello':
        state.mode = message.mode === '6dof' ? '6dof' : '3dof';
        setPhoneConnected(true);
        publish();
        return;
      case 'pose':
        return receivePose(message);
      case 'cmd':
        return command(message.cmd);
      case 'set':
        return set(message.key, message.value);
      case 'focus':
        if (finite(message.x) && finite(message.y))
          focusAt(message.x, message.y);
        return;
    }
  }

  function receivePose(message) {
    const q = vectorOf(message.q, 4);
    if (!q) return;
    latestPose = {
      q,
      p: message.p === null ? null : vectorOf(message.p, 3),
      joy: (vectorOf(message.j, 4) || [0, 0, 0, 0]).map((v) =>
        Math.max(-1, Math.min(1, v)),
      ),
      at: now(),
    };
    const mode = latestPose.p ? '6dof' : '3dof';
    if (state.mode !== mode) {
      state.mode = mode;
      publish();
    }
    if (!state.phoneConnected) setPhoneConnected(true);
    if (!state.driving && !state.held) beginDriving();
  }

  function command(name) {
    if (name === 'record') startRecording();
    else if (name === 'stop') stopRecording();
    else if (name === 'hold') hold('phone');
    else if (name === 'release') release();
    else if (name === 'recenter') recenter();
  }

  /** Change one setting from either the phone or the desktop panel. */
  function set(key, value) {
    if (key === 'scale' && finite(value)) {
      const scale = Math.max(SCALE_RANGE[0], Math.min(SCALE_RANGE[1], value));
      shiftAnchor(rig.configure({ scale }));
      // Depth of field treats the world at the rig's scale: a miniature.
      lens?.setDepthOfField?.({ scale });
    } else if (key === 'smoothing' && finite(value))
      rig.configure({ smoothing: value });
    else if (
      (key === 'heightLock' || key === 'horizonLock') &&
      typeof value === 'boolean'
    )
      shiftAnchor(rig.configure({ [key]: value }));
    else if (key === 'focalMm' && finite(value)) lens?.setFocalLength?.(value);
    else if (key === 'fStop' && finite(value))
      lens?.setDepthOfField?.({ fStop: value });
    else if (key === 'dof' && typeof value === 'boolean')
      lens?.setDepthOfField?.({ enabled: value, scale: rig.settings.scale });
    else return;
    publish();
  }

  // -------------------------------------------------------------- camera
  function claimCamera() {
    if (typeof navigation?.runImmediateNavigation !== 'function') return true;
    claiming = true;
    try {
      return navigation.runImmediateNavigation('vcam', () => true) !== false;
    } finally {
      claiming = false;
    }
  }

  function beginDriving() {
    if (!latestPose || state.driving) return;
    if (!claimCamera()) {
      hold('refused');
      toastPhone(t('Camera unavailable — exit cockpit first'));
      return;
    }
    camera.cancelFlight?.();
    reanchor();
    state.driving = true;
    state.held = false;
    state.holdReason = null;
    syncRenderHold();
    publish();
  }

  function stopDriving() {
    state.driving = false;
    lastStep = null;
    syncRenderHold();
  }

  /** Start the phone's motion from the camera's current pose. */
  function reanchor() {
    anchor = Cesium.Cartesian3.clone(camera.positionWC);
    if (latestPose) {
      rig.step({ ...latestPose, joy: [0, 0, 0, 0], dt: 0 });
      rig.recenter(camera.heading);
    }
    lastStep = null;
  }

  function hold(reason = 'phone') {
    if (state.held && state.holdReason === reason) return;
    state.held = true;
    state.holdReason = reason;
    stopDriving();
    publish();
  }

  function release() {
    if (!state.held) return;
    state.held = false;
    state.holdReason = null;
    if (latestPose) beginDriving();
    publish();
  }

  function recenter() {
    if (!state.driving) return release();
    reanchor();
    publish();
  }

  function shiftAnchor(shift) {
    if (!anchor || !shift || (!shift[0] && !shift[1] && !shift[2])) return;
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(anchor);
    const delta = Cesium.Matrix4.multiplyByPointAsVector(
      frame,
      new Cesium.Cartesian3(shift[0], shift[1], shift[2]),
      new Cesium.Cartesian3(),
    );
    anchor = Cesium.Cartesian3.add(anchor, delta, anchor);
  }

  function placeCamera() {
    if (!state.driving || state.held || !latestPose || !anchor) return;
    const at = now();
    // Smoothing and sticks follow wall time, so a slow frame rate does not
    // slow the camera; only a long stall (a hidden tab) is cut short.
    const dt =
      lastStep === null ? 0 : Math.min(MAX_STEP_SEC, (at - lastStep) / 1000);
    lastStep = at;
    const stale = at - latestPose.at > STALE_POSE_MS;
    const out = rig.step({
      ...latestPose,
      joy: stale ? [0, 0, 0, 0] : latestPose.joy,
      dt,
    });
    shiftAnchor(out.anchorShift);
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(anchor);
    const destination = Cesium.Matrix4.multiplyByPoint(
      frame,
      Cesium.Cartesian3.fromArray(out.offset),
      new Cesium.Cartesian3(),
    );
    const direction = Cesium.Cartesian3.normalize(
      Cesium.Matrix4.multiplyByPointAsVector(
        frame,
        Cesium.Cartesian3.fromArray(out.forward),
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    );
    const up = Cesium.Cartesian3.normalize(
      Cesium.Matrix4.multiplyByPointAsVector(
        frame,
        Cesium.Cartesian3.fromArray(out.up),
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    );
    keepAboveGround(destination);
    camera.setView({ destination, orientation: { direction, up } });
  }

  /** Stop at the terrain surface rather than passing under it. */
  function keepAboveGround(position) {
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    if (!cartographic) return;
    const ground = scene.globe?.show
      ? scene.globe.getHeight(cartographic)
      : undefined;
    if (!finite(ground)) return;
    const floor = ground + MIN_GROUND_CLEARANCE_M;
    if (cartographic.height >= floor) return;
    cartographic.height = floor;
    Cesium.Cartographic.toCartesian(cartographic, undefined, position);
  }

  /** Tap-to-focus: focus the lens on what lies under a normalized point. */
  function focusAt(x, y) {
    const canvas = scene.canvas;
    const point = new Cesium.Cartesian2(
      Math.max(0, Math.min(1, x)) * canvas.clientWidth,
      Math.max(0, Math.min(1, y)) * canvas.clientHeight,
    );
    let target;
    try {
      if (scene.pickPositionSupported) target = scene.pickPosition(point);
    } catch {
      target = undefined;
    }
    if (!target) {
      const ray = camera.getPickRay(point);
      target = ray && scene.globe?.pick(ray, scene);
    }
    if (!target) {
      toastPhone(t('Nothing to focus on there'));
      return;
    }
    const focusM = Cesium.Cartesian3.distance(camera.positionWC, target);
    lens?.setDepthOfField?.({
      enabled: true,
      focusM,
      scale: rig.settings.scale,
    });
    publish();
  }

  // ----------------------------------------------------------- recording
  function startRecording() {
    if (state.recording || !session) return;
    samples = [];
    lastSampleAt = -Infinity;
    state.recording = true;
    state.recordStartedAt = now();
    syncRenderHold();
    publish();
  }

  function recordSample() {
    if (!state.recording) return;
    const at = now();
    if (at - lastSampleAt < RECORD_INTERVAL_MS - 1) return;
    const carto = camera.positionCartographic;
    if (!carto) return;
    lastSampleAt = at;
    const t0 = samples.length
      ? state.recordStartedAt
      : (state.recordStartedAt = at);
    samples.push([
      round((at - t0) / 1000, 3),
      round(Cesium.Math.toDegrees(carto.longitude), 7),
      round(Cesium.Math.toDegrees(carto.latitude), 7),
      round(carto.height, 2),
      round(Cesium.Math.toDegrees(camera.heading), 2),
      round(Cesium.Math.clamp(Cesium.Math.toDegrees(camera.pitch), -90, 90), 2),
      round(Cesium.Math.toDegrees(camera.roll), 2),
      round(lens?.getFocalLength?.() ?? 31.18, 2),
    ]);
    if (samples.length >= MAX_TAKE_SAMPLES) {
      stopRecording();
      toastPhone(t('Take reached its length limit and was saved'));
    }
  }

  /** Stop recording and add the take to the selected scene. */
  function stopRecording() {
    if (!state.recording) return null;
    state.recording = false;
    syncRenderHold();
    const take = samples;
    samples = [];
    let result = null;
    if (take.length >= 2) {
      // Playback takes the short arc between samples, so headings may wrap;
      // rounding can still reach 360, which stays inside the ±360 bound.
      for (const row of take)
        for (const column of [4, 6])
          row[column] = round(((row[column] % 360) + 360) % 360, 2);
      const dof = lens?.getDepthOfField?.();
      result = director?.addRecordedShot?.({
        samples: take,
        lens: {
          focalMm: take.at(-1)[7],
          ...(dof?.enabled ? { dof: { ...dof } } : {}),
        },
      });
      if (result) {
        state.takes += 1;
        state.lastTake = { ...result, durationSec: take.at(-1)[0] };
        toastPhone(t('Take saved to the scene'));
      }
    } else toastPhone(t('Take too short to keep'));
    publish();
    return result;
  }

  // ------------------------------------------------------------- preview
  function sendPreview() {
    if (!state.phoneConnected || socket?.readyState !== 1 || previewBusy)
      return;
    const at = now();
    if (at - lastPreviewAt < 1000 / PREVIEW_FPS) return;
    if (socket.bufferedAmount > PREVIEW_BACKLOG_BYTES) return;
    const source = scene.canvas;
    if (!source?.width || !source?.height) return;
    lastPreviewAt = at;
    previewBusy = true;
    const width = Math.min(PREVIEW_WIDTH, source.width);
    const height = Math.round((width * source.height) / source.width);
    if (previewCanvas.width !== width) previewCanvas.width = width;
    if (previewCanvas.height !== height) previewCanvas.height = height;
    // Copy inside postRender, while the drawing buffer still holds this frame.
    previewCanvas.getContext('2d').drawImage(source, 0, 0, width, height);
    previewCanvas.toBlob(
      async (blob) => {
        try {
          if (blob && socket?.readyState === 1)
            socket.send(await blob.arrayBuffer());
        } finally {
          previewBusy = false;
        }
      },
      'image/jpeg',
      PREVIEW_QUALITY,
    );
  }

  function syncRenderHold() {
    const wanted =
      !destroyed && (state.driving || state.phoneConnected || state.recording);
    if (wanted === rendering) return;
    rendering = wanted;
    if (wanted) holdContinuousRender(RENDER_HOLD);
    else releaseContinuousRender(RENDER_HOLD);
  }

  // ------------------------------------------------------------ wiring
  removers.push(scene.preUpdate.addEventListener(() => placeCamera()));
  removers.push(
    scene.postRender.addEventListener(() => {
      recordSample();
      sendPreview();
    }),
  );
  const yieldToNavigation = () => {
    if (!claiming && state.driving) hold('navigation');
  };
  const unsubscribeHandoff =
    navigation?.subscribeCameraHandoff?.(yieldToNavigation);
  if (unsubscribeHandoff) removers.push(unsubscribeHandoff);
  const canvas = scene.canvas;
  const yieldToMouse = () => {
    if (state.driving) hold('desktop');
  };
  for (const type of ['pointerdown', 'wheel']) {
    canvas?.addEventListener(type, yieldToMouse, { passive: true });
    removers.push(() => canvas?.removeEventListener(type, yieldToMouse));
  }

  return {
    start,
    stop,
    hold: () => hold('desktop-button'),
    release,
    recenter,
    set,
    startRecording,
    stopRecording,
    toggleRecording: () =>
      state.recording ? stopRecording() : startRecording(),
    setAddress(address) {
      if (state.addresses.includes(address)) {
        state.address = address;
        publish();
      }
    },
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    get active() {
      return !!session;
    },
    destroy() {
      if (destroyed) return;
      const ending = session;
      endLocally(null);
      if (ending)
        fetchImpl('/api/vcam/session', {
          method: 'DELETE',
          headers: { 'X-Vcam-Host-Key': ending.hostKey },
          keepalive: true,
        }).catch(() => {});
      destroyed = true;
      syncRenderHold();
      for (const remove of removers.splice(0)) remove();
      listeners.clear();
    },
  };
}
