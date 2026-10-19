import {
  fields,
  string,
  number,
  optional,
  array,
  fail,
  uniqueId,
} from './documentFields.js';

const POSITION = { lat: [-90, 90], lon: [-180, 180], alt: [-12000, 1e9] };
const ORIENTATION = {
  heading: [-360, 360],
  pitch: [-90, 90],
  roll: [-360, 360],
};
function coordinates(value, path, bounds, required, legacy) {
  for (const [key, range] of Object.entries(bounds)) {
    if (required || Object.hasOwn(value, key))
      number(value[key], `${path}.${key}`, ...range, legacy);
  }
}
function reference(value, path) {
  if (value !== 'ellipsoid')
    fail(
      path,
      'expected ellipsoid height in meters; terrain-relative heights are not supported',
    );
}
function pose(value, path, version, anchorIds, explicit = false) {
  const anchored = version >= 4 && Object.hasOwn(value || {}, 'anchorId');
  fields(value, path, [
    ...Object.keys(ORIENTATION),
    ...(anchored
      ? ['anchorId']
      : [
          ...Object.keys(POSITION),
          ...(version >= 4 ? ['altitudeReference'] : []),
        ]),
  ]);
  coordinates(value, path, ORIENTATION, false, version < 3);
  if (anchored) {
    string(value.anchorId, `${path}.anchorId`);
    if (!anchorIds.has(value.anchorId))
      fail(`${path}.anchorId`, 'unknown scene anchor');
  } else {
    coordinates(value, path, POSITION, explicit, version < 3);
    if (explicit || Object.hasOwn(value, 'altitudeReference'))
      reference(value.altitudeReference, `${path}.altitudeReference`);
  }
}

// Recorded focal lengths are 35 mm-equivalent; the range spans fisheye to supertele.
export const FOCAL_LENGTH_MM = Object.freeze([4, 2000]);
const TRACK_COLUMNS = [
  [-1, 86400],
  POSITION.lon,
  POSITION.lat,
  POSITION.alt,
  ORIENTATION.heading,
  ORIENTATION.pitch,
  ORIENTATION.roll,
  FOCAL_LENGTH_MM,
];
function track(value, path) {
  fields(value, path, ['altitudeReference', 'samples']);
  reference(value.altitudeReference, `${path}.altitudeReference`);
  array(value.samples, `${path}.samples`);
  if (value.samples.length < 2)
    fail(`${path}.samples`, 'expected at least two samples');
  let previous = -1;
  value.samples.forEach((sample, i) => {
    const at = `${path}.samples[${i}]`;
    if (!Array.isArray(sample) || sample.length < 7 || sample.length > 8)
      fail(at, 'expected [t, lon, lat, alt, heading, pitch, roll, focalMm?]');
    sample.forEach((item, column) =>
      number(item, `${at}[${column}]`, ...TRACK_COLUMNS[column], false),
    );
    if (i === 0 ? sample[0] !== 0 : sample[0] <= previous)
      fail(
        `${at}[0]`,
        i === 0
          ? 'expected the first sample at 0 seconds'
          : 'expected increasing sample times',
      );
    previous = sample[0];
  });
}

/** Validate a shot lens: focal length and an optional depth-of-field focus. */
export function validateShotLens(lens, path) {
  fields(lens, path, ['focalMm', 'dof']);
  optional(lens, 'focalMm', path, (v, p) =>
    number(v, p, ...FOCAL_LENGTH_MM, false),
  );
  optional(lens, 'dof', path, (dof, field) => {
    fields(dof, field, ['enabled', 'focusM', 'fStop', 'scale']);
    if (typeof dof.enabled !== 'boolean')
      fail(`${field}.enabled`, 'expected a boolean');
    optional(dof, 'focusM', field, (v, p) => number(v, p, 0.1, 1e8, false));
    optional(dof, 'fStop', field, (v, p) => number(v, p, 0.5, 64, false));
    optional(dof, 'scale', field, (v, p) => number(v, p, 1e-3, 1e7, false));
  });
}

/** Validate scene-local anchor IDs, camera references and explicit motion without reading terrain or applying state. */
export function validateSceneCameras(scene, path, version) {
  const anchorIds = new Set();
  optional(scene, 'anchors', path, (anchors, field) => {
    array(anchors, field, 1024);
    anchors.forEach((anchor, i) => {
      const at = `${field}[${i}]`;
      fields(anchor, at, [
        'id',
        'title',
        ...Object.keys(POSITION),
        'altitudeReference',
      ]);
      string(anchor.id, `${at}.id`);
      uniqueId(anchor, at, anchorIds);
      optional(anchor, 'title', at, (v, p) => string(v, p, 4096));
      coordinates(anchor, at, POSITION, true, false);
      reference(anchor.altitudeReference, `${at}.altitudeReference`);
    });
  });
  scene.shots.forEach((shot, index) => {
    const at = `${path}.shots[${index}]`;
    optional(shot, 'move', at, (move, field) => {
      if (version >= 7 && Object.hasOwn(move || {}, 'track')) {
        fields(move, field, ['track']);
        track(move.track, `${field}.track`);
        pose(shot.camera, `${at}.camera`, version, anchorIds, true);
        number(shot.durationSec, `${at}.durationSec`, 0.2, 86400, false);
        number(shot.holdSec, `${at}.holdSec`, 0, 86400, false);
        return;
      }
      fields(move, field, ['from', 'easing']);
      if (!['linear', 'cubic-in-out'].includes(move.easing))
        fail(`${field}.easing`, 'expected linear or cubic-in-out');
      pose(move.from, `${field}.from`, version, anchorIds, true);
      pose(shot.camera, `${at}.camera`, version, anchorIds, true);
      number(shot.durationSec, `${at}.durationSec`, 0.2, 86400, false);
      number(shot.holdSec, `${at}.holdSec`, 0, 86400, false);
    });
    optional(shot, 'camera', at, (camera, field) =>
      pose(camera, field, version, anchorIds),
    );
  });
}
