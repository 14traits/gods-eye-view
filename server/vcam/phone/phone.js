/**
 * God's Eye View virtual camera — phone side.
 *
 * Streams this phone's pose to the desktop app and shows the app's render as
 * a monitor. Tracking uses WebXR `immersive-ar` (6DoF, Android Chrome with
 * ARCore) when available, otherwise device orientation (3DoF, iPhone Safari)
 * with on-screen sticks for movement. Poses are sent in one Y-up frame for
 * both: +x right, +y up, -z forward (WebXR's convention); yaw is arbitrary
 * and the desktop aligns it on recenter.
 *
 * Transport: a WebSocket when the connection allows it, otherwise HTTPS
 * requests (iOS refuses WebSockets under a tapped-through certificate). The
 * monitor always pulls the newest frame, so a slow network drops frames
 * instead of building a backlog.
 */

import { orientationQuaternion } from './orientation.js';

const $ = (id) => document.getElementById(id);
const KEY_STORAGE = 'gevVcam.phoneKey';
const CODE_STORAGE = 'gevVcam.code';
const SCALE_PRESETS = [1, 10, 100, 1000, 10000];
const FOCAL_RANGE = [12, 400];
const FSTOP_RANGE = [1.2, 22];
const STICK_DEADZONE = 0.12;

const store = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      // Private browsing: pairing still works for this page load.
    }
  },
};

const logMap = ([low, high], v) => low * (high / low) ** v;
const logUnmap = ([low, high], value) =>
  Math.log(value / low) / Math.log(high / low);
const round = (value, places = 5) => {
  const k = 10 ** places;
  return Math.round(value * k) / k;
};
const formatScale = (scale) =>
  scale >= 1000
    ? `1:${+(scale / 1000).toFixed(scale >= 10000 ? 0 : 1)}K`
    : `1:${+scale.toFixed(scale < 10 ? 1 : 0)}`;
const formatTime = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const screenAngle = () =>
  screen.orientation?.angle ?? (Number(window.orientation) || 0);

// ------------------------------------------------------------------ transport
class Link {
  constructor(key, { onMessage, onStatus, onUnpaired }) {
    this.key = key;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onUnpaired = onUnpaired;
    this.ws = null;
    this.events = null;
    this.mode = 'connecting';
    this.queue = [];
    this.pendingPose = null;
    this.inFlight = false;
    this.closed = false;
    this.webSocketFailed = false;
    this.retryTimer = null;
  }

  async start() {
    if (this.closed) return;
    this.onStatus('connecting');
    if (!this.webSocketFailed && (await this.openWebSocket())) return;
    this.webSocketFailed = true;
    this.openHttp();
  }

  openWebSocket() {
    return new Promise((resolve) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(
          `wss://${location.host}/ws?key=${encodeURIComponent(this.key)}`,
        );
      } catch {
        resolve(false);
        return;
      }
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        ws.close();
        done(false);
      }, 3500);
      ws.onopen = () => {
        this.ws = ws;
        this.mode = 'ws';
        this.onStatus('live');
        done(true);
      };
      ws.onerror = () => done(false);
      ws.onmessage = (event) => this.receive(event.data);
      ws.onclose = (event) => {
        done(false);
        if (this.ws !== ws) return;
        this.ws = null;
        this.mode = 'connecting';
        this.handleClose(event.code);
      };
    });
  }

  openHttp() {
    if (this.closed) return;
    this.mode = 'http';
    const events = new EventSource(
      `/api/events?key=${encodeURIComponent(this.key)}`,
    );
    this.events = events;
    events.onopen = () => this.onStatus('slow');
    events.onmessage = (event) => this.receive(event.data);
    events.onerror = async () => {
      if (events.readyState !== EventSource.CLOSED || this.closed) return;
      this.events = null;
      // A closed stream is either a lost network or an ended session.
      try {
        const probe = await fetch('/api/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Vcam-Key': this.key,
          },
          body: '[]',
          cache: 'no-store',
        });
        if (probe.status === 403) return this.handleClose(4003);
      } catch {
        // Offline: retry below.
      }
      this.handleClose(1006);
    };
    this.flush();
  }

  handleClose(code) {
    if (this.closed) return;
    if (code === 4003 || code === 4000) {
      this.onUnpaired(code === 4000 ? 'ended' : 'unpaired');
      return;
    }
    if (code === 4001) {
      this.onStatus('replaced');
      this.close();
      return;
    }
    this.onStatus('connecting');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.start(), 1000);
  }

  receive(text) {
    try {
      this.onMessage(JSON.parse(text));
    } catch {
      // Ignore malformed relay input.
    }
  }

  /** Poses are latest-wins; every other message is delivered in order. */
  send(message) {
    if (this.closed) return;
    // 1 is WebSocket.OPEN.
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    if (message.type === 'pose') this.pendingPose = message;
    else this.queue.push(message);
    if (this.mode === 'http') this.flush();
  }

  async flush() {
    if (this.inFlight || this.mode !== 'http' || this.closed) return;
    const batch = this.queue.splice(0, 32);
    if (this.pendingPose) batch.push(this.pendingPose);
    this.pendingPose = null;
    if (!batch.length) return;
    this.inFlight = true;
    try {
      const response = await fetch('/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vcam-Key': this.key,
        },
        body: JSON.stringify(batch),
        cache: 'no-store',
      });
      if (response.status === 403) this.handleClose(4003);
    } catch {
      // The event stream's error handling owns reconnection.
    } finally {
      this.inFlight = false;
    }
    if (this.queue.length || this.pendingPose) this.flush();
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.events?.close();
    this.ws = null;
    this.events = null;
  }
}

// --------------------------------------------------------------------- state
const app = {
  key: store.get(KEY_STORAGE),
  link: null,
  tracking: null, // { mode: '6dof'|'3dof', stop() }
  orientation: null,
  sticks: { left: [0, 0], right: [0, 0] },
  host: {
    connected: false,
    recording: false,
    elapsedSec: 0,
    scale: 1,
    focalMm: 31.18,
    fStop: 2.8,
    dof: false,
    held: false,
    smoothing: 0.3,
    heightLock: false,
    horizonLock: false,
  },
  recordingSince: 0,
  monitorRunning: false,
  wakeLock: null,
};

function show(screenId) {
  for (const id of ['pair', 'start', 'camera']) $(id).hidden = id !== screenId;
}

function setStatus(element, text, error = false) {
  element.textContent = text || '';
  element.classList.toggle('error', !!error);
}

let toastTimer = null;
function toast(text) {
  const element = $('camera-status');
  element.textContent = text;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (element.hidden = true), 2600);
}

// ------------------------------------------------------------------- pairing
async function join(code) {
  setStatus($('pair-status'), 'Pairing…');
  try {
    const response = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      cache: 'no-store',
    });
    if (response.status === 403) {
      setStatus(
        $('pair-status'),
        'That code is not active. Check the code on the desktop.',
        true,
      );
      return false;
    }
    if (!response.ok) throw new Error(String(response.status));
    const { phoneKey } = await response.json();
    app.key = phoneKey;
    store.set(KEY_STORAGE, phoneKey);
    store.set(CODE_STORAGE, code);
    setStatus($('pair-status'), '');
    connect();
    showStart();
    return true;
  } catch {
    setStatus(
      $('pair-status'),
      'Could not reach the desktop. Is it on the same network?',
      true,
    );
    return false;
  }
}

function connect() {
  app.link?.close();
  app.link = new Link(app.key, {
    onMessage: handleMessage,
    onStatus: presentLink,
    onUnpaired: async (reason) => {
      app.link?.close();
      app.link = null;
      store.set(KEY_STORAGE, null);
      stopTracking();
      const code = store.get(CODE_STORAGE);
      if (reason === 'unpaired' && code && (await join(code))) return;
      show('pair');
      setStatus(
        $('pair-status'),
        reason === 'ended'
          ? 'The desktop ended this session. Enter a new code.'
          : 'Pairing expired. Enter the code shown on the desktop.',
        true,
      );
    },
  });
  app.link.start();
}

function presentLink(status) {
  const dot = $('link-dot');
  dot.classList.toggle('live', status === 'live');
  dot.classList.toggle('slow', status === 'slow');
  dot.title =
    status === 'live'
      ? 'Live connection'
      : status === 'slow'
        ? 'Fallback connection (install the certificate for lower latency)'
        : 'Connecting…';
  if (status === 'replaced') toast('Another phone took over this session');
}

async function showStart() {
  show('start');
  const xr = await xrSupported();
  $('start-xr').hidden = !xr;
  $('support').textContent = xr
    ? 'This phone supports AR tracking. Point it like a camera.'
    : 'AR tracking is not available in this browser, so the gyro camera tracks rotation and the sticks move you.';
}

async function xrSupported() {
  try {
    return !!(await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ tracking
function sendPose(q, p) {
  const { left, right } = app.sticks;
  app.link?.send({
    type: 'pose',
    t: Math.round(performance.now()),
    mode: app.tracking?.mode,
    q: q.map((v) => round(v)),
    p: p ? p.map((v) => round(v, 4)) : null,
    j: [left[0], left[1], right[0], right[1]].map((v) => round(v, 3)),
  });
}

async function startXr() {
  setStatus($('start-status'), 'Starting AR…');
  try {
    const root = $('camera');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root },
    });
    // Screen taps on controls must not become XR select input.
    root.addEventListener('beforexrselect', (event) => event.preventDefault());
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true });
    await gl.makeXRCompatible?.();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    const space = await session.requestReferenceSpace('local');
    let stopped = false;
    const onFrame = (_time, frame) => {
      if (stopped) return;
      session.requestAnimationFrame(onFrame);
      const pose = frame.getViewerPose(space);
      if (pose) {
        const { position, orientation } = pose.transform;
        sendPose(
          [orientation.x, orientation.y, orientation.z, orientation.w],
          pose.emulatedPosition ? null : [position.x, position.y, position.z],
        );
      }
      const layer = session.renderState.baseLayer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    session.requestAnimationFrame(onFrame);
    session.addEventListener('end', () => {
      stopped = true;
      if (app.tracking?.session === session) {
        app.tracking = null;
        showStart();
      }
    });
    app.tracking = {
      mode: '6dof',
      session,
      stop: () => session.end().catch(() => {}),
    };
    enterCamera();
  } catch (error) {
    setStatus(
      $('start-status'),
      `AR could not start (${error?.message || error}). Try the gyro camera.`,
      true,
    );
  }
}

async function startGyro() {
  // iOS asks for motion access only from a tap, before anything else awaits.
  try {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      const answer = await DeviceOrientationEvent.requestPermission();
      if (answer !== 'granted') {
        setStatus(
          $('start-status'),
          'Motion access was denied. Allow it in Safari settings for this site, then reload.',
          true,
        );
        return;
      }
    }
  } catch {
    setStatus($('start-status'), 'Motion access is unavailable.', true);
    return;
  }
  let stopped = false;
  const onOrientation = (event) => {
    if (event.alpha === null && event.beta === null) return;
    app.orientation = orientationQuaternion(
      event.alpha,
      event.beta,
      event.gamma,
      screenAngle(),
    );
  };
  window.addEventListener('deviceorientation', onOrientation);
  const tick = () => {
    if (stopped) return;
    requestAnimationFrame(tick);
    if (app.orientation) sendPose(app.orientation, null);
  };
  requestAnimationFrame(tick);
  app.tracking = {
    mode: '3dof',
    stop: () => {
      stopped = true;
      window.removeEventListener('deviceorientation', onOrientation);
    },
  };
  document.documentElement.requestFullscreen?.().catch(() => {});
  enterCamera();
  setTimeout(() => {
    if (!app.orientation && !stopped)
      toast('No motion data yet — this browser may block the gyroscope');
  }, 1500);
}

function stopTracking() {
  app.tracking?.stop();
  app.tracking = null;
  app.monitorRunning = false;
}

async function enterCamera() {
  show('camera');
  $('mode-readout').textContent =
    app.tracking?.mode === '6dof' ? 'AR 6DOF' : 'GYRO 3DOF';
  app.link?.send({
    type: 'hello',
    mode: app.tracking?.mode,
    screen: [window.innerWidth, window.innerHeight],
  });
  try {
    app.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // Optional: the screen may dim during long takes.
  }
  runMonitor();
}

// ------------------------------------------------------------------- monitor
async function runMonitor() {
  if (app.monitorRunning) return;
  app.monitorRunning = true;
  const monitor = $('monitor');
  let seq = 0;
  let previousUrl = null;
  while (app.monitorRunning && app.key) {
    if (document.hidden) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    try {
      const response = await fetch(
        `/api/frame?key=${encodeURIComponent(app.key)}&after=${seq}`,
        { cache: 'no-store' },
      );
      if (response.status === 403) break;
      if (response.status !== 200) continue;
      seq = Number(response.headers.get('X-Frame-Seq')) || seq + 1;
      const url = URL.createObjectURL(await response.blob());
      await new Promise((resolve) => {
        monitor.onload = resolve;
        monitor.onerror = resolve;
        monitor.src = url;
      });
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      previousUrl = url;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  app.monitorRunning = false;
}

// ------------------------------------------------------------------ controls
function stick(element, target) {
  const knob = element.querySelector('.knob');
  let pointer = null;
  const set = (x, y) => {
    target[0] = x;
    target[1] = y;
    const radius = element.clientWidth / 2 - 26;
    knob.style.transform = `translate(${x * radius}px, ${-y * radius}px)`;
  };
  const move = (event) => {
    const rect = element.getBoundingClientRect();
    const radius = rect.width / 2;
    let x = (event.clientX - rect.left - radius) / radius;
    let y = -(event.clientY - rect.top - radius) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    // Rescale past the dead zone so small nudges stay precise.
    const live = Math.min(1, Math.hypot(x, y));
    const scale =
      live < STICK_DEADZONE
        ? 0
        : (live - STICK_DEADZONE) / (1 - STICK_DEADZONE) / live;
    set(x * scale, y * scale);
  };
  element.addEventListener('pointerdown', (event) => {
    if (pointer !== null) return;
    pointer = event.pointerId;
    element.setPointerCapture(pointer);
    move(event);
  });
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointer) move(event);
  });
  const release = (event) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    set(0, 0);
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
}

const sendSet = (key, value) => app.link?.send({ type: 'set', key, value });
const sendCommand = (command) => app.link?.send({ type: 'cmd', cmd: command });

function presentHost() {
  const h = app.host;
  $('record-btn').setAttribute('aria-pressed', String(h.recording));
  $('rec-readout').hidden = !h.recording;
  $('hold-btn').setAttribute('aria-pressed', String(h.held));
  $('scale-readout').textContent = formatScale(h.scale);
  $('scale-value').textContent = formatScale(h.scale);
  $('focal-readout').textContent = `${Math.round(h.focalMm)}mm`;
  $('focal-value').textContent = `${Math.round(h.focalMm)}mm`;
  $('fstop-value').textContent = `f/${h.fStop.toFixed(1)}`;
  $('smooth-value').textContent = `${Math.round(h.smoothing * 100)}%`;
  const active = (element) =>
    element === document.activeElement && element.matches(':active');
  if (!active($('scale-range')))
    $('scale-range').value = String(Math.log10(h.scale));
  if (!active($('focal-range')))
    $('focal-range').value = String(logUnmap(FOCAL_RANGE, h.focalMm));
  if (!active($('fstop-range')))
    $('fstop-range').value = String(logUnmap(FSTOP_RANGE, h.fStop));
  if (!active($('smooth-range')))
    $('smooth-range').value = String(Math.round(h.smoothing * 100));
  $('dof-toggle').checked = h.dof;
  $('height-lock').checked = h.heightLock;
  $('horizon-lock').checked = h.horizonLock;
  for (const button of $('scale-presets').querySelectorAll('button'))
    button.classList.toggle(
      'active',
      Math.abs(Number(button.dataset.scale) - h.scale) < 1e-6,
    );
  for (const button of $('focal-presets').querySelectorAll('button'))
    button.classList.toggle(
      'active',
      Math.abs(Number(button.dataset.focal) - h.focalMm) < 0.5,
    );
}

function handleMessage(message) {
  if (message.type === 'state') {
    const wasRecording = app.host.recording;
    Object.assign(app.host, message.state);
    if (app.host.recording && !wasRecording)
      app.recordingSince = performance.now() - app.host.elapsedSec * 1000;
    presentHost();
  } else if (message.type === 'peer' && message.role === 'host') {
    app.host.connected = message.connected;
    if (!message.connected) toast('Desktop disconnected — waiting…');
  } else if (message.type === 'toast' && typeof message.text === 'string') {
    toast(message.text.slice(0, 140));
  }
}

function toggleDrawer(name) {
  for (const other of ['scale', 'lens']) {
    const open = other === name && $(`${other}-drawer`).hidden;
    $(`${other}-drawer`).hidden = !open;
    $(`${other}-btn`).setAttribute('aria-expanded', String(open));
  }
}

function bindControls() {
  $('pair-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = $('code').value.trim().toUpperCase();
    if (code) join(code);
  });
  $('start-xr').addEventListener('click', startXr);
  $('start-gyro').addEventListener('click', startGyro);
  stick($('stick-left'), app.sticks.left);
  stick($('stick-right'), app.sticks.right);
  $('record-btn').addEventListener('click', () =>
    sendCommand(app.host.recording ? 'stop' : 'record'),
  );
  $('hold-btn').addEventListener('click', () =>
    sendCommand(app.host.held ? 'release' : 'hold'),
  );
  $('recenter-btn').addEventListener('click', () => sendCommand('recenter'));
  $('scale-btn').addEventListener('click', () => toggleDrawer('scale'));
  $('lens-btn').addEventListener('click', () => toggleDrawer('lens'));
  $('scale-presets').addEventListener('click', (event) => {
    const value = Number(event.target.closest('button')?.dataset.scale);
    if (SCALE_PRESETS.includes(value)) sendSet('scale', value);
  });
  $('scale-range').addEventListener('input', (event) => {
    const scale = 10 ** Number(event.target.value);
    $('scale-value').textContent = formatScale(scale);
    sendSet('scale', round(scale, 3));
  });
  $('smooth-range').addEventListener('input', (event) =>
    sendSet('smoothing', Number(event.target.value) / 100),
  );
  $('height-lock').addEventListener('change', (event) =>
    sendSet('heightLock', event.target.checked),
  );
  $('horizon-lock').addEventListener('change', (event) =>
    sendSet('horizonLock', event.target.checked),
  );
  $('focal-range').addEventListener('input', (event) => {
    const focal = logMap(FOCAL_RANGE, Number(event.target.value));
    $('focal-value').textContent = `${Math.round(focal)}mm`;
    sendSet('focalMm', round(focal, 2));
  });
  $('focal-presets').addEventListener('click', (event) => {
    const value = Number(event.target.closest('button')?.dataset.focal);
    if (value) sendSet('focalMm', value);
  });
  $('dof-toggle').addEventListener('change', (event) =>
    sendSet('dof', event.target.checked),
  );
  $('fstop-range').addEventListener('input', (event) => {
    const fStop = logMap(FSTOP_RANGE, Number(event.target.value));
    $('fstop-value').textContent = `f/${fStop.toFixed(1)}`;
    sendSet('fStop', round(fStop, 2));
  });
  // Tap the monitor to focus: coordinates are within the shown picture.
  $('monitor').addEventListener('click', (event) => {
    const monitor = $('monitor');
    if (!monitor.naturalWidth) return;
    const rect = monitor.getBoundingClientRect();
    const fit = Math.min(
      rect.width / monitor.naturalWidth,
      rect.height / monitor.naturalHeight,
    );
    const width = monitor.naturalWidth * fit;
    const height = monitor.naturalHeight * fit;
    const x = (event.clientX - rect.left - (rect.width - width) / 2) / width;
    const y = (event.clientY - rect.top - (rect.height - height) / 2) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    app.link?.send({ type: 'focus', x: round(x, 4), y: round(y, 4) });
    const ring = $('focus-ring');
    ring.hidden = true;
    ring.style.left = `${event.clientX}px`;
    ring.style.top = `${event.clientY}px`;
    void ring.offsetWidth;
    ring.hidden = false;
  });
  setInterval(() => {
    if (app.host.recording)
      $('rec-readout').textContent =
        `● ${formatTime((performance.now() - app.recordingSince) / 1000)}`;
  }, 250);
  // The system releases a wake lock whenever the page is hidden.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !app.tracking) return;
    if (app.wakeLock && !app.wakeLock.released) return;
    try {
      app.wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      // Optional.
    }
  });
}

function boot() {
  bindControls();
  presentHost();
  const fromLink = decodeURIComponent(location.hash.slice(1))
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  if (fromLink) {
    $('code').value = fromLink;
    store.set(CODE_STORAGE, fromLink);
    // Keep the code out of the address bar once read.
    history.replaceState(null, '', location.pathname);
  }
  if (app.key) {
    connect();
    showStart();
  } else if (fromLink) {
    join(fromLink);
  } else {
    show('pair');
  }
}

boot();
