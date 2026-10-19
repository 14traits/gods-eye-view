import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraLens } from './cameraLens.js';
import { focalLengthToFov } from '../director/lens.js';

function harness() {
  const stages = [];
  const renders = [];
  const viewer = {
    camera: { frustum: { fov: Math.PI / 3 } },
    scene: {
      postProcessStages: {
        add: (stage) => stages.push(stage),
        remove: (stage) => stages.splice(stages.indexOf(stage), 1),
      },
    },
  };
  const lens = createCameraLens(viewer, {
    requestRender: (reason) => renders.push(reason),
    createStage: (options) => ({ ...options, uniforms: { ...options.uniforms } }),
  });
  return { viewer, lens, stages, renders };
}

test('focal length owns the frustum and restores the application view', () => {
  const { viewer, lens, stages, renders } = harness();
  assert.equal(lens.getState(), null);
  lens.setFocalLength(85);
  assert.equal(viewer.camera.frustum.fov, focalLengthToFov(85));
  assert.deepEqual(lens.getState(), { focalMm: 85 });
  lens.setFocalLength(1);
  assert.equal(lens.getFocalLength(), 4, 'focal lengths clamp to the document range');
  lens.setFocalLength(null);
  assert.equal(viewer.camera.frustum.fov, Math.PI / 3);
  assert.equal(lens.getState(), null);
  assert.equal(stages.length, 0, 'no depth-of-field stage exists until it is enabled');
  assert.ok(renders.length >= 3);
});

test('depth of field creates one stage, tracks the lens and resets with the shot', () => {
  const { viewer, lens, stages } = harness();
  const seen = [];
  const unsubscribe = lens.subscribe((state) => seen.push(state));
  lens.apply({ focalMm: 50, dof: { enabled: true, focusM: 300, fStop: 2, scale: 500 } });
  assert.equal(stages.length, 1);
  const [stage] = stages;
  assert.equal(stage.enabled, true);
  assert.deepEqual(
    [stage.uniforms.focusDistance, stage.uniforms.focalLength, stage.uniforms.fStop, stage.uniforms.sceneScale],
    [300, 0.05, 2, 500],
  );
  assert.deepEqual(lens.getState(), { focalMm: 50, dof: { enabled: true, focusM: 300, fStop: 2, scale: 500 } });
  lens.setDepthOfField({ focusM: -1, fStop: 100 });
  assert.equal(stage.uniforms.focusDistance, 300, 'invalid focus is ignored');
  assert.equal(stage.uniforms.fStop, 64);
  lens.apply(null);
  assert.equal(stage.enabled, false);
  assert.equal(viewer.camera.frustum.fov, Math.PI / 3);
  assert.equal(lens.getState(), null);
  assert.ok(seen.length >= 3);
  unsubscribe();
  lens.setFocalLength(35);
  lens.destroy();
  assert.equal(stages.length, 0);
  assert.equal(viewer.camera.frustum.fov, Math.PI / 3, 'destroy restores the view');
});
