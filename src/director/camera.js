/** Portable camera poses and authored motion. Angles are degrees; heights are ellipsoidal meters. */

/** Resolve an inline pose or a scene-local geographic anchor without modifying authored state. */
export function resolveCameraPose(scene, camera) {
  if (!camera) return null;
  const position = camera.anchorId
    ? scene?.anchors?.find(({ id }) => id === camera.anchorId)
    : camera;
  if (!position) throw new Error('Camera anchor is unavailable');
  return {
    lat: position.lat,
    lon: position.lon,
    alt: position.alt,
    heading: camera.heading ?? 0,
    pitch: camera.pitch ?? -35,
    roll: camera.roll ?? 0,
  };
}

/** Columns of one recorded track sample; focal length is optional. */
export const CAMERA_TRACK_COLUMNS = Object.freeze([
  't',
  'lon',
  'lat',
  'alt',
  'heading',
  'pitch',
  'roll',
  'focalMm',
]);

/** Expand one compact track sample into a pose; `t` stays in recorded seconds. */
export function cameraTrackSample(sample) {
  const pose = {
    t: sample[0],
    lon: sample[1],
    lat: sample[2],
    alt: sample[3],
    heading: sample[4],
    pitch: sample[5],
    roll: sample[6],
  };
  if (Number.isFinite(sample[7])) pose.focalMm = sample[7];
  return pose;
}

/** Resolve both authored endpoints. An explicit move never depends on the live viewport. */
export function resolveCameraMove(scene, shot) {
  if (!shot?.move) return null;
  if (shot.move.track) {
    const samples = shot.move.track.samples;
    return {
      from: sampleCameraTrack(samples, 0),
      to: sampleCameraTrack(samples, 1),
      track: samples,
      durationSec: shot.durationSec,
    };
  }
  return {
    from: resolveCameraPose(scene, shot.move.from),
    to: resolveCameraPose(scene, shot.camera),
    easing: shot.move.easing,
    durationSec: shot.durationSec,
  };
}

/** Wrap an interpolated camera longitude to WGS84 without changing authored endpoints. */
export function normalizeCameraLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/**
 * Sample a recorded track at normalized progress. The recording is stretched
 * to the shot duration, so editing `durationSec` retimes a take without
 * touching its samples. Angles and longitude take the short arc between
 * neighbouring samples.
 */
export function sampleCameraTrack(samples, progress) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  const last = samples.length - 1;
  const exact = (sample) => {
    const { t: _recorded, ...pose } = cameraTrackSample(sample);
    return pose;
  };
  if (t === 0) return exact(samples[0]);
  if (t === 1) return exact(samples[last]);
  const target = t * samples[last][0];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle][0] <= target) low = middle;
    else high = middle;
  }
  const a = cameraTrackSample(samples[low]);
  const b = cameraTrackSample(samples[high]);
  const span = b.t - a.t;
  const k = span > 0 ? Math.max(0, Math.min(1, (target - a.t) / span)) : 1;
  // A time that lands on a recorded sample returns it unchanged.
  if (k === 0) return exact(samples[low]);
  if (k === 1) return exact(samples[high]);
  const lerp = (from, to) => from + (to - from) * k;
  const angle = (from, to) =>
    from + (((((to - from + 540) % 360) + 360) % 360) - 180) * k;
  const pose = {
    lat: lerp(a.lat, b.lat),
    lon: normalizeCameraLongitude(angle(a.lon, b.lon)),
    alt: lerp(a.alt, b.alt),
    heading: angle(a.heading, b.heading),
    pitch: lerp(a.pitch, b.pitch),
    roll: angle(a.roll, b.roll),
  };
  if (Number.isFinite(a.focalMm) && Number.isFinite(b.focalMm))
    pose.focalMm = lerp(a.focalMm, b.focalMm);
  else if (Number.isFinite(a.focalMm ?? b.focalMm))
    pose.focalMm = a.focalMm ?? b.focalMm;
  return pose;
}

/** Sample the same authored curve for playback and seeking, taking the short longitude/angle arc. */
export function sampleCameraMove(move, progress) {
  if (move.track) return sampleCameraTrack(move.track, progress);
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  if (t === 0) return { ...move.from };
  if (t === 1) return { ...move.to };
  const eased =
    move.easing === 'linear'
      ? t
      : t < 0.5
        ? 4 * t ** 3
        : 1 - (-2 * t + 2) ** 3 / 2;
  const lerp = (a, b) => a + (b - a) * eased;
  const angle = (a, b) =>
    a + (((((b - a + 540) % 360) + 360) % 360) - 180) * eased;
  const { from, to } = move;
  return {
    lat: lerp(from.lat, to.lat),
    lon: normalizeCameraLongitude(angle(from.lon, to.lon)),
    alt: lerp(from.alt, to.alt),
    heading: angle(from.heading, to.heading),
    pitch: lerp(from.pitch, to.pitch),
    roll: angle(from.roll, to.roll),
  };
}
