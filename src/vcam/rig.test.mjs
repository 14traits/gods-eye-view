import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig, headingOfEnu, rotateByQuaternion } from './rig.js';

const close = (actual, expected, message, epsilon = 1e-9) => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < epsilon, `${message}: ${actual} vs ${expected}`),
  );
};
const axisAngle = (axis, angle) => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const IDENTITY = [0, 0, 0, 1];
const DEG = Math.PI / 180;

test('recenter aligns the phone with the camera heading and keeps the camera in place', () => {
  const rig = createRig({ smoothing: 0 });
  // The phone starts turned 30 degrees left of its arbitrary tracking yaw.
  const turned = axisAngle([0, 1, 0], 30 * DEG);
  rig.step({ q: turned, p: [0.2, 1.4, -0.3], dt: 0 });
  close(rig.recenter(90 * DEG), [0, 0, 0], 'recentering a still phone moves nothing');
  const first = rig.step({ q: turned, p: [0.2, 1.4, -0.3], dt: 0.016 });
  close(first.offset, [0, 0, 0], 'no jump on recenter');
  close(first.forward, [1, 0, 0], 'phone forward now faces the camera heading (east)');
  close(first.up, [0, 0, 1], 'level phone, level camera');
  assert.equal(rig.tracking, '6dof');
});

test('phone motion maps through the aligned yaw and the motion scale', () => {
  const rig = createRig({ smoothing: 0, scale: 100 });
  rig.step({ q: IDENTITY, p: [0, 0, 0], dt: 0 });
  rig.recenter(90 * DEG);
  // One metre forward (phone -z) and half a metre up.
  const moved = rig.step({ q: IDENTITY, p: [0, 0.5, -1], dt: 0.016 });
  close(moved.offset, [100, 0, 50], 'forward is east at 1:100');
  // A step to the phone's right is south when facing east.
  close(rig.step({ q: IDENTITY, p: [1, 0, 0], dt: 0.016 }).offset, [0, -100, 0], 'right is south');
});

test('scale and height-lock changes re-zero the phone so the camera holds still', () => {
  const rig = createRig({ smoothing: 0, scale: 10 });
  rig.step({ q: IDENTITY, p: [0, 0, 0], dt: 0 });
  rig.recenter(0);
  const before = rig.step({ q: IDENTITY, p: [0, 1, -2], dt: 0.016 }).offset;
  close(before, [0, 20, 10], 'north and up at 1:10');
  const shift = rig.configure({ scale: 1000 });
  const after = rig.step({ q: IDENTITY, p: [0, 1, -2], dt: 0.016 });
  close([...shift.map((v, i) => v + after.offset[i] + after.anchorShift[i])], before, 'camera unchanged');
  const further = rig.step({ q: IDENTITY, p: [0, 1, -2.001], dt: 0.016 });
  close(further.offset, [0, 1, 0], 'one more millimetre is a metre at 1:1000', 1e-6);
  rig.configure({ heightLock: true });
  close(rig.step({ q: IDENTITY, p: [0, 3, -2.001], dt: 0.016 }).offset, [0, 0, 0], 'vertical motion ignored');
  assert.deepEqual(rig.settings, { scale: 1000, smoothing: 0, heightLock: true, horizonLock: false });
});

test('horizon lock removes roll but keeps pitch and heading', () => {
  const rig = createRig({ smoothing: 0, horizonLock: true });
  // Pitch down 20 degrees, then roll 25 degrees.
  const pitched = axisAngle([1, 0, 0], -20 * DEG);
  const rolled = axisAngle([0, 0, 1], 25 * DEG);
  const q = [
    pitched[3] * rolled[0] + pitched[0] * rolled[3] + pitched[1] * rolled[2] - pitched[2] * rolled[1],
    pitched[3] * rolled[1] - pitched[0] * rolled[2] + pitched[1] * rolled[3] + pitched[2] * rolled[0],
    pitched[3] * rolled[2] + pitched[0] * rolled[1] - pitched[1] * rolled[0] + pitched[2] * rolled[3],
    pitched[3] * rolled[3] - pitched[0] * rolled[0] - pitched[1] * rolled[1] - pitched[2] * rolled[2],
  ];
  rig.step({ q, p: null, dt: 0 });
  rig.recenter(0);
  const { forward, up } = rig.step({ q, p: null, dt: 0.016 });
  assert.ok(Math.abs(Math.asin(forward[2]) + 20 * DEG) < 1e-9, 'pitch kept');
  assert.ok(Math.abs(headingOfEnu(forward)) < 1e-9, 'heading kept');
  assert.ok(Math.abs(up[0]) < 1e-9, 'no sideways tilt of the up vector');
  assert.equal(rig.tracking, '3dof');
  rig.configure({ horizonLock: false });
  assert.ok(Math.abs(rig.step({ q, p: null, dt: 0.016 }).up[0]) > 0.3, 'roll returns without the lock');
});

test('sticks dolly along the camera heading and pan about the camera', () => {
  const rig = createRig({ smoothing: 0, scale: 10 });
  rig.step({ q: IDENTITY, p: null, dt: 0 });
  rig.recenter(90 * DEG);
  const dolly = rig.step({ q: IDENTITY, p: null, joy: [0, 1, 0, 0], dt: 1 });
  close(dolly.anchorShift, [25, 0, 0], 'full stick for a second at 1:10 is 25 m east');
  const half = rig.step({ q: IDENTITY, p: null, joy: [0, 0, 0, 0.5], dt: 1 });
  close(half.anchorShift, [0, 0, 6.25], 'sticks respond with a squared curve');

  const moved = createRig({ smoothing: 0, scale: 10 });
  moved.step({ q: IDENTITY, p: [0, 0, 0], dt: 0 });
  moved.recenter(0);
  const before = moved.step({ q: IDENTITY, p: [0, 0, -1], dt: 0.016 }).offset;
  const panned = moved.step({ q: IDENTITY, p: [0, 0, -1], joy: [0, 0, 1, 0], dt: 0.5 });
  close(panned.anchorShift.map((v, i) => v + panned.offset[i]), before, 'the camera turns in place');
  assert.ok(Math.abs(headingOfEnu(panned.forward) - 30 * DEG) < 1e-9, 'half a second of full pan is 30 degrees');
});

test('smoothing damps motion and reaches the target over time', () => {
  const rig = createRig({ smoothing: 0.5, scale: 1 });
  rig.step({ q: IDENTITY, p: [0, 0, 0], dt: 0 });
  rig.recenter(0);
  const first = rig.step({ q: IDENTITY, p: [0, 0, -1], dt: 1 / 60 });
  assert.ok(first.offset[1] > 0 && first.offset[1] < 0.1, 'one frame moves a little');
  let last = first;
  for (let i = 0; i < 240; i++) last = rig.step({ q: IDENTITY, p: [0, 0, -1], dt: 1 / 60 });
  close(last.offset, [0, 1, 0], 'converges', 1e-4);
});

test('switching between 6DoF and 3DoF keeps the camera continuous', () => {
  const rig = createRig({ smoothing: 0, scale: 5 });
  rig.step({ q: IDENTITY, p: [0, 0, 0], dt: 0 });
  rig.recenter(0);
  const tracked = rig.step({ q: IDENTITY, p: [0, 0, -2], dt: 0.016 });
  const lost = rig.step({ q: IDENTITY, p: null, dt: 0.016 });
  close(lost.anchorShift.map((v, i) => v + lost.offset[i]), tracked.offset, 'tracking loss holds position');
});

test('quaternion rotation matches the WebXR forward convention', () => {
  close(rotateByQuaternion(axisAngle([0, 1, 0], 90 * DEG), [0, 0, -1]), [-1, 0, 0], 'yaw left 90');
  assert.equal(headingOfEnu([0, 0, -1]), null);
});
