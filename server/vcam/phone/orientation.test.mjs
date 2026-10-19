import test from 'node:test';
import assert from 'node:assert/strict';
import { orientationQuaternion } from './orientation.js';
import { rotateByQuaternion } from '../../../src/vcam/rig.js';

const close = (actual, expected, message) =>
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-9, `${message}: ${actual} vs ${expected}`),
  );
const axes = (q) => ({
  forward: rotateByQuaternion(q, [0, 0, -1]),
  up: rotateByQuaternion(q, [0, 1, 0]),
});

test('an upright portrait phone looks out of its back along the Y-up forward axis', () => {
  // beta 90: stood up from flat, screen toward the user, back toward north.
  const { forward, up } = axes(orientationQuaternion(0, 90, 0, 0));
  close(forward, [0, 0, -1], 'faces north (-z)');
  close(up, [0, 1, 0], 'top edge up');
});

test('alpha turns the phone counterclockwise seen from above', () => {
  const { forward } = axes(orientationQuaternion(90, 90, 0, 0));
  close(forward, [-1, 0, 0], 'faces west');
});

test('a landscape screen reports the picture\'s up, not the device\'s top edge', () => {
  // Rotated a quarter turn counterclockwise: the top edge points west and the
  // right edge up, the back still faces north, and the screen angle is 90.
  const { forward, up } = axes(orientationQuaternion(90, 0, -90, 90));
  close(forward, [0, 0, -1], 'still faces north');
  close(up, [0, 1, 0], 'picture up is world up');
});

test('a phone lying flat, screen up, looks straight down', () => {
  const { forward, up } = axes(orientationQuaternion(0, 0, 0, 0));
  close(forward, [0, -1, 0], 'down');
  close(up, [0, 0, -1], 'top edge toward north');
});
