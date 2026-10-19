/**
 * Renderer-independent lens math. Focal lengths are 35 mm full-frame
 * equivalents measured across the frame's longer side (36 mm), which is the
 * dimension Cesium's `PerspectiveFrustum.fov` describes.
 */
export const SENSOR_LONG_SIDE_MM = 36;

/** Cesium's default 60-degree field of view expressed as a focal length. */
export const DEFAULT_FOCAL_MM = SENSOR_LONG_SIDE_MM / 2 / Math.tan(Math.PI / 6);

/** Field of view in radians across the longer side for a focal length. */
export function focalLengthToFov(focalMm) {
  return 2 * Math.atan(SENSOR_LONG_SIDE_MM / (2 * focalMm));
}

/** Focal length in millimetres for a field of view across the longer side. */
export function fovToFocalLength(fovRad) {
  return SENSOR_LONG_SIDE_MM / (2 * Math.tan(fovRad / 2));
}

/**
 * Thin-lens circle-of-confusion radius in pixels. `sceneScale` divides world
 * distances first, so a 1:1000 rig focuses on the city as if it were a
 * tabletop model and produces the matching shallow depth of field. The
 * depth-of-field shader evaluates the same expression per pixel.
 */
export function circleOfConfusionPx({
  focalMm,
  fStop,
  focusM,
  distanceM,
  sceneScale = 1,
  viewportPx,
}) {
  const f = focalMm / 1000;
  const focus = Math.max(focusM / sceneScale, f * 1.01);
  const distance = Math.max(distanceM / sceneScale, 1e-4);
  const diameterM =
    ((f * f) / (fStop * (focus - f))) * (Math.abs(distance - focus) / distance);
  return (0.5 * diameterM * 1000 * viewportPx) / SENSOR_LONG_SIDE_MM;
}
