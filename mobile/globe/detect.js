/**
 * Detection on real data (DESIGN.md §12.4). Runs over the recorder, never
 * over anything invented: when nothing in the record matches, nothing is
 * raised.
 *
 * Circling: an aircraft "orbits" when, within the last ~20 min, its ground
 * track turns through at least 360° in one direction while its positions stay
 * within ~1.5 km of their centroid. Rotorcraft and low-and-slow contacts are
 * preferred (airliners in a holding stack are excluded by altitude and
 * speed). Two or more orbiters whose centres lie within ~1.5 km of a common
 * centre make a detection: "3 helicopters circling Midtown Manhattan". A
 * single aircraft on its second full orbit is a lesser detection
 * ("Helicopter circling Lower Manhattan").
 *
 * Quake clusters: three or more M2.5+ events within 50 km of each other in
 * 24 h, from the USGS feed.
 */
import { haversineKm } from './geo.js';
import { localPlace, describePlace } from './gazetteer.js';

const WINDOW_MS = 20 * 60_000;
const MAX_CENTER_KM = 1.5;
const MAX_ALT_M = 2400; // ~8,000 ft
const MAX_SPEED_MPS = 80; // ~155 kt
const D2R = Math.PI / 180;

function bearing(a, b) {
  const dx = (b.lon - a.lon) * Math.cos(a.lat * D2R);
  const dy = b.lat - a.lat;
  return (Math.atan2(dx, dy) / D2R + 360) % 360;
}
const metres = (a, b) =>
  Math.hypot(
    (b.lon - a.lon) * 111_320 * Math.cos(a.lat * D2R),
    (b.lat - a.lat) * 110_574,
  );

/**
 * Orbit analysis of one track (samples sorted by t). Returns the most recent
 * full orbit: { center:{lon,lat}, radiusM, turns, dir, from, to, points } or null.
 */
export function analyseOrbit(samples) {
  if (samples.length < 6) return null;
  // Thin to points at least 60 m apart so jitter does not fake turning.
  const pts = [samples[0]];
  for (const p of samples) if (metres(pts.at(-1), p) >= 60) pts.push(p);
  if (pts.length < 6) return null;
  // Walk backwards from the newest point accumulating signed turn.
  let turn = 0;
  let prevB = bearing(pts.at(-2), pts.at(-1));
  let startIdx = -1;
  for (let i = pts.length - 2; i >= 1; i--) {
    // A gap in the record breaks the orbit.
    if (pts[i + 1].t - pts[i].t > 4 * 60_000) break;
    const b = bearing(pts[i - 1], pts[i]);
    let d = ((prevB - b + 540) % 360) - 180;
    // A step that turns > 150° is a sampling artefact, not a turn.
    if (Math.abs(d) > 150) d = 0;
    turn += d;
    prevB = b;
    if (Math.abs(turn) >= 360) {
      startIdx = i - 1;
      break;
    }
  }
  if (startIdx < 0) return null;
  const orbit = pts.slice(startIdx);
  let lon = 0;
  let lat = 0;
  for (const p of orbit) {
    lon += p.lon;
    lat += p.lat;
  }
  const center = { lon: lon / orbit.length, lat: lat / orbit.length };
  let r = 0;
  let rMax = 0;
  for (const p of orbit) {
    const d = metres(center, p);
    r += d;
    rMax = Math.max(rMax, d);
  }
  r /= orbit.length;
  if (r > MAX_CENTER_KM * 1000 || rMax > MAX_CENTER_KM * 1600) return null;
  if (r < 80) return null; // hovering jitter, not an orbit
  // Count full turns over the whole window (for "on its 6th orbit").
  let total = 0;
  for (let i = 2; i < pts.length; i++) {
    let d =
      ((bearing(pts[i - 1], pts[i]) - bearing(pts[i - 2], pts[i - 1]) + 540) %
        360) -
      180;
    if (Math.abs(d) > 150) d = 0;
    total += d;
  }
  return {
    center,
    radiusM: Math.round(r),
    turns: Math.max(1, Math.floor(Math.abs(total) / 360)),
    dir: turn > 0 ? 'cw' : 'ccw',
    from: orbit[0].t,
    to: orbit.at(-1).t,
  };
}

/** "near Port-Olry, Vanuatu" from a USGS place, else from the gazetteer. */
function clusterPlace(q) {
  const usgs = q.place ? q.place.replace(/^.*\bof\s+/, '').trim() : '';
  if (usgs) return `near ${usgs}`;
  const p = describePlace(q.lat, q.lon);
  if (!p) return '';
  return /\bkm\b/.test(p) ? `, ${p}` : `near ${p}`;
}

const isCandidate = (meta, s) =>
  meta &&
  meta.kind !== 'vessel' &&
  !meta.onGround &&
  s.altM < MAX_ALT_M &&
  (meta.helicopter || s.speed < MAX_SPEED_MPS);

/**
 * @param {ReturnType<import('./recorder.js').createRecorder>} recorder
 */
export function createDetector(recorder) {
  /** Detections by id (kept while they last, plus a history for pips). */
  const live = new Map();
  const history = [];
  let lastRun = 0;
  let lastOrbiters = [];

  function circling(now = Date.now()) {
    const from = now - WINDOW_MS;
    const orbiters = [];
    for (const key of recorder.keys()) {
      const meta = recorder.meta(key);
      if (!meta || meta.kind === 'vessel') continue;
      const samples = recorder.samples(key, from, now);
      if (samples.length < 6) continue;
      const lastS = samples.at(-1);
      if (now - lastS.t > 5 * 60_000) continue; // gone quiet
      if (!isCandidate(meta, lastS)) continue;
      const orbit = analyseOrbit(samples);
      if (orbit) orbiters.push({ key, meta, orbit, last: lastS });
    }
    lastOrbiters = orbiters;
    // Greedy clustering on orbit centres.
    const used = new Set();
    const groups = [];
    orbiters.sort(
      (a, b) =>
        Number(b.meta.helicopter) - Number(a.meta.helicopter) ||
        b.orbit.turns - a.orbit.turns,
    );
    for (const a of orbiters) {
      if (used.has(a.key)) continue;
      const g = [a];
      for (const b of orbiters) {
        if (b === a || used.has(b.key)) continue;
        const km = haversineKm(
          a.orbit.center.lat,
          a.orbit.center.lon,
          b.orbit.center.lat,
          b.orbit.center.lon,
        );
        if (km <= MAX_CENTER_KM) g.push(b);
      }
      if (g.length >= 2) {
        for (const m of g) used.add(m.key);
        groups.push(g);
      }
    }
    // A single aircraft on its second full orbit is a detection too (a
    // police or news helicopter holding over a scene), ranked below groups.
    const singles = orbiters
      .filter((a) => !used.has(a.key) && a.orbit.turns >= 2)
      .sort((a, b) => b.orbit.turns - a.orbit.turns)
      .slice(0, 4);
    for (const a of singles) groups.push([a]);
    const out = [];
    for (const g of groups) {
      let lon = 0;
      let lat = 0;
      for (const m of g) {
        lon += m.orbit.center.lon;
        lat += m.orbit.center.lat;
      }
      lon /= g.length;
      lat /= g.length;
      const helis = g.filter((m) => m.meta.helicopter).length;
      const place = localPlace(lat, lon);
      const noun =
        g.length === 1
          ? helis
            ? 'Helicopter'
            : 'Aircraft'
          : helis === g.length
            ? 'helicopters'
            : helis
              ? 'aircraft'
              : 'low aircraft';
      let id = `circling-${lat.toFixed(2)}_${lon.toFixed(2)}`;
      const firstOrbit = Math.min(...g.map((m) => m.orbit.from));
      // The same aircraft drifting a few hundred metres is the same
      // detection: keep its id and start time.
      for (const [oid, d] of live)
        if (
          oid !== id &&
          d.members.some((m) => g.some((x) => x.key === m.key)) &&
          haversineKm(d.lat, d.lon, lat, lon) < 3
        ) {
          id = oid;
          break;
        }
      const prev = live.get(id);
      const det = {
        id,
        kind: 'circling',
        title:
          g.length === 1
            ? `${noun} circling ${place.name}`
            : `${g.length} ${noun} circling ${place.name}`,
        single: g.length === 1,
        place: place.name,
        lon,
        lat,
        since: prev?.since ?? firstOrbit,
        updatedAt: now,
        members: g.map((m) => ({
          key: m.key,
          layer: m.meta.layer,
          callsign: m.meta.callsign || m.key,
          helicopter: Boolean(m.meta.helicopter),
          radiusM: m.orbit.radiusM,
          turns: m.orbit.turns,
          dir: m.orbit.dir,
          altM: Math.round(m.last.altM),
          speed: m.last.speed,
          lon: m.last.lon,
          lat: m.last.lat,
        })),
      };
      live.set(id, det);
      if (!prev)
        history.push({
          t: firstOrbit,
          kind: 'circling',
          title: det.title,
          situationId: id,
          momentId: `live-${id}`,
          lon,
          lat,
        });
      out.push(det);
    }
    // Detections that stopped circling linger 10 min, then go.
    for (const [id, d] of live)
      if (now - d.updatedAt > 10 * 60_000) live.delete(id);
    if (history.length > 200) history.splice(0, history.length - 200);
    return out;
  }

  function quakeClusters(records, now = Date.now()) {
    const recent = (records || []).filter(
      (q) => Number.isFinite(q.time) && now - q.time < 86_400_000,
    );
    const used = new Set();
    const out = [];
    const sorted = recent.slice().sort((a, b) => b.mag - a.mag);
    for (const q of sorted) {
      if (used.has(q.stableId)) continue;
      const near = recent.filter(
        (o) =>
          !used.has(o.stableId) &&
          haversineKm(q.lat, q.lon, o.lat, o.lon) <= 50,
      );
      if (near.length < 3) continue;
      for (const o of near) used.add(o.stableId);
      const times = near.map((o) => o.time).sort((a, b) => a - b);
      out.push({
        id: `quake-cluster-${q.stableId}`,
        kind: 'quake-cluster',
        title: `${near.length} earthquakes in 24 h ${clusterPlace(q)}`.trim(),
        lon: q.lon,
        lat: q.lat,
        maxMag: q.mag,
        count: near.length,
        since: times[0],
        updatedAt: times.at(-1),
        members: near.map((o) => ({
          id: o.stableId,
          mag: o.mag,
          time: o.time,
          lon: o.lon,
          lat: o.lat,
          place: o.place,
        })),
      });
    }
    return out;
  }

  return {
    /** Run the circling detector at most every `minGapMs`. */
    run({ force = false, minGapMs = 20_000 } = {}) {
      const now = Date.now();
      if (!force && now - lastRun < minGapMs) return [...live.values()];
      lastRun = now;
      circling(now);
      return [...live.values()];
    },
    current: () => [...live.values()],
    get: (id) => live.get(id) || null,
    history: () => history.slice(),
    /** Single orbiters seen in the last run (diagnostics and dossiers). */
    orbiters: () => lastOrbiters.slice(),
    quakeClusters,
  };
}
