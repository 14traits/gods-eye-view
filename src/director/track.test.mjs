import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneDocument, stringifySceneDocument } from './document.js';
import { normalizeProject } from '../scenes/project.js';
import {
  resolveCameraMove,
  sampleCameraMove,
  sampleCameraTrack,
} from './camera.js';
import { sceneSeekState } from './timeline.js';
import {
  DEFAULT_FOCAL_MM,
  circleOfConfusionPx,
  focalLengthToFov,
  fovToFocalLength,
} from './lens.js';

const samples = () => [
  [0, 179.9, 10, 500, 350, -30, 0, 24],
  [1, -179.9, 10.5, 600, 10, -20, 2, 50],
  [3, -179.7, 11, 400, 30, -10, 4, 50],
];
const fixture = (move = { track: { altitudeReference: 'ellipsoid', samples: samples() } }) => ({
  version: 7,
  scenes: [
    {
      id: 'scene',
      shots: [
        {
          id: 'take',
          title: 'Take 1',
          durationSec: 3,
          holdSec: 1,
          camera: { lat: 11, lon: -179.7, alt: 400, heading: 30, pitch: -10, roll: 4, altitudeReference: 'ellipsoid' },
          move,
          lens: { focalMm: 50, dof: { enabled: true, focusM: 250, fStop: 1.8, scale: 1000 } },
        },
      ],
    },
  ],
});

test('a recorded track round trips through the document and project migration', () => {
  const project = normalizeProject(parseSceneDocument(JSON.stringify(fixture())));
  const shot = project.scenes[0].shots[0];
  assert.deepEqual(shot.move.track.samples, samples());
  assert.deepEqual(shot.lens, fixture().scenes[0].shots[0].lens);
  assert.deepEqual(parseSceneDocument(stringifySceneDocument(project)).scenes[0].shots[0].move, fixture().scenes[0].shots[0].move);
});

test('track samples interpolate by recorded time, take short arcs and keep exact endpoints', () => {
  const rows = samples();
  assert.deepEqual(sampleCameraTrack(rows, 0), { lon: 179.9, lat: 10, alt: 500, heading: 350, pitch: -30, roll: 0, focalMm: 24 });
  assert.deepEqual(sampleCameraTrack(rows, 1), { lon: -179.7, lat: 11, alt: 400, heading: 30, pitch: -10, roll: 4, focalMm: 50 });
  const mid = sampleCameraTrack(rows, 1 / 6); // 0.5 s, halfway through the first segment
  assert.ok(Math.abs(Math.abs(mid.lon) - 180) < 1e-9, 'longitude crosses the dateline, not the globe');
  assert.ok(Math.abs(mid.heading - 360) < 1e-9 || Math.abs(mid.heading) < 1e-9);
  assert.equal(mid.alt, 550);
  assert.equal(mid.focalMm, 37);
  const late = sampleCameraTrack(rows, 2 / 3); // 2 s, halfway through the second segment
  assert.equal(late.alt, 500);
  assert.equal(late.heading, 20);
  const noFocal = sampleCameraTrack(rows.map((row) => row.slice(0, 7)), 0.5);
  assert.equal(Object.hasOwn(noFocal, 'focalMm'), false);
});

test('a track stretches to its shot duration and drives scene seeking', () => {
  const scene = normalizeProject(parseSceneDocument(JSON.stringify(fixture()))).scenes[0];
  const shot = scene.shots[0];
  const move = resolveCameraMove(scene, shot);
  assert.equal(move.from.alt, 500);
  assert.equal(move.to.alt, 400);
  assert.deepEqual(sampleCameraMove(move, 2 / 3), sampleCameraTrack(shot.move.track.samples, 2 / 3));
  // Doubling the duration plays the same path at half speed.
  shot.durationSec = 6;
  const seek = sceneSeekState(scene, 2 / 7, (_, item) => item.durationSec + item.holdSec, (_, item) => item.holdSec);
  assert.equal(seek.cameraProgress, 1 / 3);
  assert.equal(seek.camera.alt, 600);
});

test('malformed tracks and lenses are rejected with a field path', () => {
  const bad = (mutate, pattern) => {
    const doc = fixture();
    mutate(doc.scenes[0].shots[0]);
    assert.throws(() => parseSceneDocument(JSON.stringify(doc)), pattern);
  };
  bad((shot) => { shot.move.track.samples = [shot.move.track.samples[0]]; }, /at least two samples/);
  bad((shot) => { shot.move.track.samples[0][0] = 0.1; }, /first sample at 0/);
  bad((shot) => { shot.move.track.samples[2][0] = 1; }, /increasing sample times/);
  bad((shot) => { shot.move.track.samples[1] = [1, 0, 0]; }, /samples\[1\]: expected \[t, lon/);
  bad((shot) => { shot.move.track.samples[1][2] = 91; }, /samples\[1\]\[2\]/);
  bad((shot) => { shot.move.track.samples[1][7] = 1; }, /samples\[1\]\[7\]/);
  bad((shot) => { delete shot.move.track.altitudeReference; }, /altitudeReference/);
  bad((shot) => { shot.move.easing = 'linear'; }, /move\.easing: unsupported field/);
  bad((shot) => { shot.lens.focalMm = 1; }, /lens\.focalMm/);
  bad((shot) => { shot.lens.dof.enabled = 'yes'; }, /lens\.dof\.enabled/);
  bad((shot) => { shot.lens.aperture = 2; }, /lens\.aperture: unsupported field/);
  const v6 = fixture();
  v6.version = 6;
  assert.throws(() => parseSceneDocument(JSON.stringify(v6)), /lens: unsupported field/);
  delete v6.scenes[0].shots[0].lens;
  assert.throws(() => parseSceneDocument(JSON.stringify(v6)), /move\.track: unsupported field/);
});

test('focal lengths convert to Cesium field of view and back', () => {
  assert.ok(Math.abs(focalLengthToFov(DEFAULT_FOCAL_MM) - Math.PI / 3) < 1e-12);
  assert.ok(Math.abs(fovToFocalLength(focalLengthToFov(85)) - 85) < 1e-9);
  assert.ok(focalLengthToFov(14) > focalLengthToFov(200));
});

test('the miniature scale turns invisible real-world blur into tabletop depth of field', () => {
  const lens = { focalMm: 35, fStop: 2.8, focusM: 500, distanceM: 1000, viewportPx: 1920 };
  assert.ok(circleOfConfusionPx(lens) < 0.05, 'a real 35 mm lens barely blurs a city');
  const miniature = circleOfConfusionPx({ ...lens, sceneScale: 1000 });
  assert.ok(miniature > 10 && miniature < 20, `1:1000 blurs like a model (${miniature})`);
  assert.equal(circleOfConfusionPx({ ...lens, distanceM: 500, sceneScale: 1000 }), 0);
  assert.ok(circleOfConfusionPx({ ...lens, sceneScale: 1000, fStop: 16 }) < miniature / 4);
});
