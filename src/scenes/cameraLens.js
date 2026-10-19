import * as Cesium from 'cesium';
import {
  DEFAULT_FOCAL_MM,
  focalLengthToFov,
  fovToFocalLength,
} from '../director/lens.js';
import { FOCAL_LENGTH_MM } from '../director/cameraDocument.js';

/**
 * Thin-lens depth of field. Distances are divided by `sceneScale` before the
 * circle of confusion is computed (see circleOfConfusionPx), and each tap is
 * weighted by whether its own blur reaches the centre pixel, so a sharp
 * foreground does not smear into a blurred background.
 */
const DEPTH_OF_FIELD_SHADER = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float focusDistance;
uniform float focalLength;
uniform float fStop;
uniform float sceneScale;
uniform float maxRadius;
in vec2 v_textureCoordinates;

float eyeDistance(vec2 uv) {
  float depth = czm_readDepth(depthTexture, uv);
  vec2 xy = vec2(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0);
  vec4 eye = czm_inverseProjection * vec4(xy, depth, 1.0);
  return -eye.z / eye.w;
}

float cocRadius(float distance) {
  float f = focalLength;
  float s1 = max(focusDistance / sceneScale, f * 1.01);
  float s2 = max(distance / sceneScale, 1.0e-4);
  float c = (f * f) / (fStop * (s1 - f)) * abs(s2 - s1) / s2;
  return min(maxRadius, 0.5 * c / 0.036 * czm_viewport.z);
}

void main(void) {
  vec4 base = texture(colorTexture, v_textureCoordinates);
  float radius = cocRadius(eyeDistance(v_textureCoordinates));
  if (radius < 0.5) {
    out_FragColor = base;
    return;
  }
  vec2 texel = 1.0 / czm_viewport.zw;
  vec3 sum = base.rgb;
  float weight = 1.0;
  for (int i = 1; i < 32; i++) {
    float fi = float(i);
    float r = sqrt(fi / 32.0) * radius;
    float theta = fi * 2.39996323;
    vec2 uv = v_textureCoordinates + vec2(cos(theta), sin(theta)) * r * texel;
    float reach = cocRadius(eyeDistance(uv));
    float w = clamp(reach - r + 1.0, 0.0, 1.0);
    sum += texture(colorTexture, uv).rgb * w;
    weight += w;
  }
  out_FragColor = vec4(sum / weight, base.a);
}
`;

const clampFocal = (mm) =>
  Math.max(FOCAL_LENGTH_MM[0], Math.min(FOCAL_LENGTH_MM[1], Number(mm)));

/**
 * Own the viewer camera's focal length and the depth-of-field stage. The
 * lens records the frustum's field of view when it first changes it and
 * restores that on reset, so shots without a lens keep the application's
 * ordinary view.
 *
 * @param {Cesium.Viewer} viewer
 * @param {object} [options]
 * @param {(reason: string) => void} [options.requestRender]
 * @param {(options: object) => object} [options.createStage]
 */
export function createCameraLens(
  viewer,
  {
    requestRender = () => viewer.scene?.requestRender?.(),
    createStage = (options) => new Cesium.PostProcessStage(options),
  } = {},
) {
  let baseFov = null;
  let focalMm = null;
  let stage = null;
  let destroyed = false;
  const dof = { enabled: false, focusM: 500, fStop: 2.8, scale: 1 };
  const frustum = () => viewer.camera?.frustum;
  const listeners = new Set();
  const notify = () => {
    const state = getState();
    for (const listener of listeners) listener(state);
  };

  function ensureStage() {
    if (stage || destroyed) return stage;
    stage = createStage({
      name: 'godsEyeView_depthOfField',
      fragmentShader: DEPTH_OF_FIELD_SHADER,
      uniforms: {
        focusDistance: dof.focusM,
        focalLength: (focalMm ?? DEFAULT_FOCAL_MM) / 1000,
        fStop: dof.fStop,
        sceneScale: dof.scale,
        maxRadius: 18,
      },
    });
    stage.enabled = false;
    viewer.scene.postProcessStages.add(stage);
    return stage;
  }

  function syncStage() {
    if (!stage && !dof.enabled) return;
    const target = ensureStage();
    if (!target) return;
    Object.assign(target.uniforms, {
      focusDistance: dof.focusM,
      focalLength: currentFocalMm() / 1000,
      fStop: dof.fStop,
      sceneScale: dof.scale,
    });
    target.enabled = dof.enabled;
  }

  function currentFocalMm() {
    if (focalMm !== null) return focalMm;
    const fov = frustum()?.fov;
    return Number.isFinite(fov) ? fovToFocalLength(fov) : DEFAULT_FOCAL_MM;
  }

  /** Set the focal length; `null` restores the application's field of view. */
  function setFocalLength(mm, { silent = false } = {}) {
    if (destroyed) return;
    const target = frustum();
    if (!target || !('fov' in target)) return;
    if (mm === null || mm === undefined) {
      if (baseFov !== null) target.fov = baseFov;
      baseFov = null;
      focalMm = null;
    } else {
      if (!Number.isFinite(Number(mm))) return;
      baseFov ??= target.fov;
      focalMm = clampFocal(mm);
      target.fov = focalLengthToFov(focalMm);
    }
    syncStage();
    requestRender('camera-lens');
    if (!silent) notify();
  }

  /** Merge depth-of-field settings; unspecified fields keep their values. */
  function setDepthOfField(next = {}) {
    if (destroyed) return;
    if (typeof next.enabled === 'boolean') dof.enabled = next.enabled;
    if (Number.isFinite(next.focusM) && next.focusM > 0)
      dof.focusM = Math.min(1e8, Math.max(0.1, next.focusM));
    if (Number.isFinite(next.fStop))
      dof.fStop = Math.min(64, Math.max(0.5, next.fStop));
    if (Number.isFinite(next.scale) && next.scale > 0)
      dof.scale = Math.min(1e7, Math.max(1e-3, next.scale));
    syncStage();
    requestRender('camera-lens');
    notify();
  }

  /** Serializable shot lens, or null when the lens is at its defaults. */
  function getState() {
    if (focalMm === null && !dof.enabled) return null;
    return {
      ...(focalMm !== null ? { focalMm: Math.round(focalMm * 100) / 100 } : {}),
      ...(dof.enabled ? { dof: { ...dof } } : {}),
    };
  }

  /** Apply a shot lens exactly; missing fields return to the defaults. */
  function apply(lens) {
    if (destroyed) return;
    setFocalLength(lens?.focalMm ?? null, { silent: true });
    setDepthOfField({ enabled: false, ...lens?.dof });
  }

  return {
    setFocalLength,
    setDepthOfField,
    getState,
    apply,
    reset: () => apply(null),
    getFocalLength: currentFocalMm,
    getDepthOfField: () => ({ ...dof }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      apply(null);
      destroyed = true;
      listeners.clear();
      if (stage && !viewer.isDestroyed?.())
        viewer.scene.postProcessStages.remove(stage);
      stage = null;
    },
  };
}
