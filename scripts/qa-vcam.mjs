#!/usr/bin/env node
/**
 * qa-vcam.mjs — phone virtual camera, end to end.
 *
 * Drives the real desktop app and the real phone page (served by the HTTPS
 * phone listener) in one browser, plus a scripted 6DoF phone over the same
 * relay:
 *
 * 1. SCENES ▸ VCAM starts a session and draws a QR code for the pairing URL.
 * 2. The phone page pairs from the URL fragment, falls back to HTTPS requests
 *    when WebSockets are refused (as iOS does under a certificate warning),
 *    starts the gyro camera and turns the desktop camera with device
 *    orientation; the desktop's render arrives on the phone's monitor.
 * 3. The phone's lens preset and REC button reach the desktop; the recorded
 *    take becomes a validated track shot in the selected scene and replays.
 * 4. A scripted 6DoF phone moves one metre at 1:100 and the camera moves
 *    about a hundred metres; desktop navigation holds the rig.
 *
 * Needs the dev server (default http://localhost:4173, or QA_BASE_URL) and
 * its phone listener on VCAM_PORT (default 4174), reachable on loopback.
 * Screenshots go to qa-shots/vcam/.
 *
 *   npm run dev            # in another terminal
 *   node scripts/qa-vcam.mjs
 */
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import puppeteer from 'puppeteer';
import WebSocket from 'ws';

const BASE = process.env.QA_BASE_URL || 'http://localhost:4173';
const output = path.resolve('qa-shots/vcam');
fs.mkdirSync(output, { recursive: true });
let failed = 0;
function check(name, passed, detail = '') {
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed++;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Separate browsers, like separate devices: a background tab would hide the
// desktop page, which suspends its render loop.
const launch = () =>
  puppeteer.launch({
    headless: true,
    acceptInsecureCerts: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
const browser = await launch();
const phoneBrowser = await launch();
const errors = [];
try {
  const desk = await browser.newPage();
  desk.on('pageerror', (error) => errors.push(`desktop: ${error.message}`));
  if (process.env.QA_VCAM_DEBUG) desk.on('pageerror', (error) => console.log('DESKTOP ERROR', error.stack || error.message));
  await desk.setViewport({ width: 1280, height: 800 });
  await desk.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
  await desk.waitForFunction(
    () =>
      window.__godsEyeView?.vcam &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90000 },
  );
  // A shader that fails to compile stops Cesium's render loop.
  await desk.evaluate(() => {
    window.__vcamRenderErrors = [];
    window.__godsEyeView.viewer.scene.renderError.addEventListener((_scene, error) =>
      window.__vcamRenderErrors.push(String(error?.message || error)),
    );
  });
  // Start from a known city view.
  await desk.evaluate(() =>
    window.__godsEyeView.styleManager.applyCameraState(
      { lat: 30.2672, lon: -97.7431, alt: 1200, heading: 0, pitch: -30, roll: 0 },
      0.2,
    ),
  );
  await sleep(800);

  // 1. Pairing UI.
  await desk.evaluate(() => {
    const panel = document.getElementById('scene-panel');
    if (panel.classList.contains('collapsed'))
      panel.querySelector('.panel-collapse-btn')?.click();
  });
  await desk.click('#vcam-toggle-btn');
  if (process.env.QA_VCAM_DEBUG)
    await desk.evaluate(() => {
      window.__vcamSeen = [];
      window.__godsEyeView.vcam.subscribe((s) =>
        window.__vcamSeen.push([s.status, s.phoneConnected, s.driving, s.held, s.holdReason].join(',')),
      );
    });
  await desk.waitForFunction(() => window.__godsEyeView.vcam.getState().code, { timeout: 15000 });
  const pairing = await desk.evaluate(() => {
    const state = window.__godsEyeView.vcam.getState();
    const qr = document.getElementById('vcam-qr');
    return {
      state,
      shownCode: document.getElementById('vcam-code').textContent,
      qrDrawn: !qr.hidden && qr.width > 100,
      link: document.getElementById('vcam-url').textContent,
    };
  });
  check('VCAM opens a pairing session with a code and QR', pairing.qrDrawn && pairing.shownCode === pairing.state.code, pairing.link);
  const phoneUrl = `https://127.0.0.1:${pairing.state.port}/#${pairing.state.code}`;

  // 2. The real phone page, with WebSockets refused as on iOS.
  const phone = await phoneBrowser.newPage();
  phone.on('pageerror', (error) => errors.push(`phone: ${error.message}`));
  if (process.env.QA_VCAM_DEBUG)
    phone.on('request', (request) => {
      if (request.url().includes('/api/') && !request.url().includes('/api/frame'))
        console.log('PHONE', request.method(), request.url().split('?')[0], request.postData()?.slice(0, 90) ?? '');
    });
  await phone.emulate({
    viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await phone.evaluateOnNewDocument(() => {
    window.WebSocket = class {
      static OPEN = 1;
      readyState = 0;
      constructor() {
        setTimeout(() => {
          this.onerror?.(new Event('error'));
          this.onclose?.({ code: 1006 });
        }, 50);
      }
      close() {}
    };
  });
  await phone.goto(phoneUrl, { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('#start:not([hidden])', { timeout: 10000 });
  check('the phone pairs from the QR link and clears the code from the address bar',
    !(await phone.evaluate(() => location.hash)));
  await phone.click('#start-gyro');
  await phone.waitForSelector('#camera:not([hidden])', { timeout: 5000 });
  const orient = (alpha, beta = 90, gamma = 0) =>
    phone.evaluate((a, b, g) => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: a, beta: b, gamma: g }));
    }, alpha, beta, gamma);
  await orient(0);
  await desk
    .waitForFunction(() => window.__godsEyeView.vcam.getState().driving, { timeout: 10000 })
    .catch(async (error) => {
      const { status, phoneConnected, held, holdReason, mode } = await desk.evaluate(() =>
        window.__godsEyeView.vcam.getState(),
      );
      if (process.env.QA_VCAM_DEBUG)
        console.log('SEEN', await desk.evaluate(() => JSON.stringify([...new Set(window.__vcamSeen)])));
      throw new Error(`rig never drove: ${JSON.stringify({ status, phoneConnected, held, holdReason, mode })}`, {
        cause: error,
      });
    });
  const linkState = await phone.evaluate(() => document.getElementById('link-dot').className);
  check('the phone falls back to HTTPS requests when WebSockets fail', linkState.includes('slow'), linkState);
  const before = await desk.evaluate(() => window.__godsEyeView.styleManager.getCameraState());
  for (let alpha = 0; alpha <= 45; alpha += 3) {
    await orient(alpha);
    await sleep(40);
  }
  // Headless WebGL renders a few frames a second; wait for the rig to settle.
  const headingAfter = (target) =>
    desk
      .waitForFunction(
        (from, wanted) => {
          const { heading } = window.__godsEyeView.styleManager.getCameraState();
          return Math.abs((((from - heading + 540) % 360) - 180) - wanted) < 1;
        },
        { timeout: 15000, polling: 100 },
        before.heading,
        target,
      )
      .catch(() => {});
  await headingAfter(45);
  const turned = await desk.evaluate(() => window.__godsEyeView.styleManager.getCameraState());
  const headingDelta = ((before.heading - turned.heading + 540) % 360) - 180;
  check('turning the phone 45° left turns the camera 45° left', Math.abs(headingDelta - 45) < 1,
    `heading ${before.heading.toFixed(1)} → ${turned.heading.toFixed(1)}`);
  check('an upright phone looks at the horizon', Math.abs(turned.pitch) < 5, `pitch ${turned.pitch.toFixed(1)}`);
  const vcamMode = await desk.evaluate(() => window.__godsEyeView.vcam.getState().mode);
  check('the desktop reports gyro (3DoF) tracking', vcamMode === '3dof');
  await phone.waitForFunction(() => document.getElementById('monitor').naturalWidth > 0, { timeout: 10000 });
  check('the desktop render reaches the phone monitor', true);

  // 3. Lens and a take from the phone.
  await phone.click('#lens-btn');
  await phone.click('#focal-presets button[data-focal="85"]');
  await desk.waitForFunction(() => Math.abs(window.__godsEyeView.lens.getFocalLength() - 85) < 0.01, { timeout: 5000 });
  const fov = await desk.evaluate(() => window.__godsEyeView.viewer.camera.frustum.fov);
  check('the phone lens preset sets the desktop focal length', Math.abs(fov - 2 * Math.atan(18 / 85)) < 1e-6);
  await phone.click('#lens-btn');
  const shotsBefore = await desk.evaluate(() => {
    const d = window.__godsEyeView.sceneDirector;
    return d._getSelectedScene().shots.length;
  });
  await phone.click('#record-btn');
  await desk.waitForFunction(() => window.__godsEyeView.vcam.getState().recording, { timeout: 5000 });
  for (let alpha = 45; alpha >= -20; alpha -= 2) {
    await orient(alpha, 80);
    await sleep(50);
  }
  await phone.click('#record-btn');
  await desk.waitForFunction(() => !window.__godsEyeView.vcam.getState().recording, { timeout: 5000 });
  const take = await desk.evaluate(() => {
    const d = window.__godsEyeView.sceneDirector;
    const scene = d._getSelectedScene();
    const shot = scene.shots.at(-1);
    return {
      count: scene.shots.length,
      title: shot.title,
      samples: shot.move?.track?.samples?.length || 0,
      duration: shot.durationSec,
      focal: shot.move?.track?.samples?.[0]?.[7],
      listed: document.getElementById('scene-shot-list').textContent.includes(shot.title),
      saved: JSON.parse(localStorage.getItem('godsEyeView.sceneProject.v2')).scenes.some((s) => s.shots.some((x) => x.id === shot.id)),
      sceneId: scene.id,
      shotId: shot.id,
      last: shot.move?.track?.samples?.at(-1),
    };
  });
  // One sample per rendered frame, at most 30 a second.
  check('REC on the phone adds a track shot to the selected scene',
    take.count === shotsBefore + 1 && take.samples >= 2 && take.duration > 2 &&
      take.samples <= take.duration * 30 + 2 && take.listed && take.saved,
    `${take.title}: ${take.samples} samples over ${take.duration}s`);
  check('the take records the focal length per sample', take.focal === 85);
  await desk.screenshot({ path: path.join(output, 'desktop-take.png') });
  await phone.screenshot({ path: path.join(output, 'phone-camera.png') });

  // Replaying the take ends exactly on its last sample.
  await desk.evaluate(() => window.__godsEyeView.vcam.hold());
  await desk.evaluate(({ sceneId, shotId }) =>
    window.__godsEyeView.sceneDirector.loadShot(sceneId, shotId), take);
  await desk.waitForFunction(({ last }) => {
    const c = window.__godsEyeView.styleManager.getCameraState();
    return Math.abs(c.lat - last[2]) < 1e-5 && Math.abs(c.lon - last[1]) < 1e-5;
  }, { timeout: 20000 }, take).catch(() => {});
  const replayed = await desk.evaluate(() => window.__godsEyeView.styleManager.getCameraState());
  check('loading the take plays it to its final recorded pose',
    Math.abs(replayed.lat - take.last[2]) < 1e-5 && Math.abs(replayed.alt - take.last[3]) < 0.5,
    `alt ${replayed.alt.toFixed(1)} vs ${take.last[3]}`);
  await phone.close();

  // 4. A scripted 6DoF phone: translation follows the motion scale.
  const join = await new Promise((resolve) => {
    const request = https.request(
      `https://127.0.0.1:${pairing.state.port}/api/join`,
      { method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' } },
      (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ ok: response.statusCode === 200, body }));
      },
    );
    request.on('error', () => resolve({ ok: false }));
    request.end(JSON.stringify({ code: pairing.state.code }));
  });
  let sixDof = null;
  if (join.ok) {
    const { phoneKey } = JSON.parse(join.body);
    sixDof = new WebSocket(`wss://127.0.0.1:${pairing.state.port}/ws?key=${phoneKey}`, {
      origin: `https://127.0.0.1:${pairing.state.port}`,
      rejectUnauthorized: false,
    });
    await new Promise((resolve, reject) => {
      sixDof.once('open', resolve);
      sixDof.once('error', reject);
    });
  }
  check('a second phone can pair over a WebSocket', !!sixDof);
  if (sixDof) {
    const pose = (z, extra = {}) =>
      sixDof.send(JSON.stringify({ type: 'pose', t: Date.now(), q: [0, 0, 0, 1], p: [0, 1.5, z], j: [0, 0, 0, 0], ...extra }));
    sixDof.send(JSON.stringify({ type: 'set', key: 'scale', value: 100 }));
    sixDof.send(JSON.stringify({ type: 'set', key: 'smoothing', value: 0 }));
    sixDof.send(JSON.stringify({ type: 'cmd', cmd: 'release' }));
    for (let i = 0; i < 10; i++) {
      pose(0);
      await sleep(30);
    }
    await desk.waitForFunction(() => window.__godsEyeView.vcam.getState().driving && window.__godsEyeView.vcam.getState().mode === '6dof', { timeout: 5000 });
    const position = () =>
      desk.evaluate(() => {
        const { x, y, z } = window.__godsEyeView.viewer.camera.positionWC;
        return [x, y, z];
      });
    const start = await position();
    for (let i = 1; i <= 20; i++) {
      pose(-i / 20);
      await sleep(30);
    }
    await desk
      .waitForFunction(
        (from) => {
          const { x, y, z } = window.__godsEyeView.viewer.camera.positionWC;
          return Math.abs(Math.hypot(x - from[0], y - from[1], z - from[2]) - 100) < 1;
        },
        { timeout: 15000, polling: 100 },
        start,
      )
      .catch(() => {});
    const end = await position();
    const moved = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    check('one metre of phone motion at 1:100 moves the camera 100 m', Math.abs(moved - 100) < 1, `${moved.toFixed(1)} m`);

    // Depth of field at a miniature scale, focused by a tap at the centre.
    sixDof.send(JSON.stringify({ type: 'set', key: 'scale', value: 1000 }));
    sixDof.send(JSON.stringify({ type: 'set', key: 'dof', value: true }));
    sixDof.send(JSON.stringify({ type: 'set', key: 'fStop', value: 4 }));
    // Pitch down 30 degrees, let the rig settle, then focus on the ground ahead.
    for (let i = 0; i < 20; i++) {
      pose(-1, { q: [-0.2588, 0, 0, 0.9659] });
      await sleep(50);
    }
    await desk
      .waitForFunction(() => window.__godsEyeView.styleManager.getCameraState().pitch < -29, {
        timeout: 15000,
        polling: 100,
      })
      .catch(() => {});
    sixDof.send(JSON.stringify({ type: 'focus', x: 0.5, y: 0.5 }));
    await sleep(2000);
    const dof = await desk.evaluate(() => {
      const { lens, viewer } = window.__godsEyeView;
      const stage = viewer.scene.postProcessStages;
      let found = null;
      for (let i = 0; i < stage.length; i++)
        if (stage.get(i).name === 'godsEyeView_depthOfField') found = stage.get(i);
      return {
        state: lens.getDepthOfField(),
        enabled: !!found?.enabled,
        ready: !!found?.ready,
        errors: window.__vcamRenderErrors,
      };
    });
    check('tap-to-focus enables depth of field at the rig scale',
      dof.enabled && dof.state.scale === 1000 && dof.state.focusM > 1000 && dof.state.focusM < 5000 && dof.state.fStop === 4,
      `focus ${dof.state.focusM?.toFixed?.(0)} m at 1:${dof.state.scale}`);
    check('the depth-of-field shader compiles and renders', dof.ready && dof.errors.length === 0, dof.errors.join(' | '));
    await desk.screenshot({ path: path.join(output, 'desktop-dof.png') });

    // Mouse navigation on the globe holds the rig instead of fighting it.
    await desk.mouse.click(640, 400);
    const held = await desk.evaluate(() => window.__godsEyeView.vcam.getState());
    check('desktop mouse input holds the rig', held.held && !held.driving, held.holdReason);
    sixDof.close();
  }
  await desk.click('#vcam-end-btn');
  await desk.waitForFunction(() => window.__godsEyeView.vcam.getState().status === 'idle', { timeout: 5000 });
  check('END closes the session', true);
} catch (error) {
  console.error(error);
  failed++;
} finally {
  await browser.close();
  await phoneBrowser.close();
}
const relevant = errors.filter((message) => !/Failed to fetch|NetworkError|tile|imagery/i.test(message));
check('no page errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));
console.log(failed ? `\n${failed} check(s) failed` : '\nAll VCAM checks passed');
process.exit(failed ? 1 : 0);
