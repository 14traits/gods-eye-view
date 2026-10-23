/**
 * The bundled recording (DESIGN.md §12.5): a few hours of real recorded
 * positions over the busiest regions, captured with
 * `node mobile/demo/capture-history.mjs` into mobile/demo/history/*.json.
 *
 * It ships so the time machine always has real ghosts to replay, even on a
 * first run when the device's own recorder holds only minutes. Timestamps
 * are the true capture times and are never shifted: the time machine shows
 * the recording where it really happened (the director navigates there).
 *
 * The archive is a second recorder (no expiry, no persistence). `history`
 * is a read-only view over both that ghosts, the dossier and search use; on
 * a key present in both, the device's own recorder wins.
 */
import { createRecorder } from './recorder.js';

// Literal URLs so Vite copies the files into the production build.
const FILES = [
  new URL('../demo/history/nyc.json', import.meta.url).href,
  new URL('../demo/history/london.json', import.meta.url).href,
  new URL('../demo/history/gulf.json', import.meta.url).href,
];

/** Decode one `gev-history/1` file into [{ key, meta, points }]. */
export function decodeHistory(j) {
  if (j?.format !== 'gev-history/1' || !Array.isArray(j.tracks)) return [];
  const out = [];
  for (const tr of j.tracks) {
    const p = typeof tr.p === 'string' ? tr.p.split(',').map(Number) : tr.p;
    if (!Array.isArray(p) || p.length < 12) continue;
    let t = j.t0;
    let lon = 0;
    let lat = 0;
    let alt = 0;
    const points = [];
    for (let i = 0; i + 5 < p.length; i += 6) {
      t += p[i];
      lon += p[i + 1];
      lat += p[i + 2];
      alt += p[i + 3];
      points.push({
        t: t * 1000,
        lon: lon / 1e4,
        lat: lat / 1e4,
        altM: alt * 10,
        headingDeg: p[i + 4],
        speed: p[i + 5],
      });
    }
    out.push({ key: String(tr.k), meta: tr.m || { kind: 'aircraft' }, points });
  }
  return out;
}

export function createArchive() {
  const rec = createRecorder({
    persist: false,
    archive: true,
    windowMs: Infinity,
    maxInterpGapS: 11 * 60,
  });
  const regions = [];
  let loading = null;

  function load() {
    if (loading) return loading;
    loading = Promise.all(
      FILES.map((url) =>
        fetch(url)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((files) => {
      for (const j of files) {
        if (!j) continue;
        const tracks = decodeHistory(j);
        let start = Infinity;
        let end = -Infinity;
        for (const tr of tracks) {
          rec.merge(tr.key, tr.points, tr.meta);
          start = Math.min(start, tr.points[0].t);
          end = Math.max(end, tr.points[tr.points.length - 1].t);
        }
        if (!tracks.length) continue;
        regions.push({
          id: j.region,
          label: j.label,
          bbox: j.bbox,
          source: j.source,
          start,
          end,
          tracks: tracks.length,
          busiest: busiestInstant(tracks, start, end),
        });
      }
      return regions;
    });
    return loading;
  }

  return {
    recorder: rec,
    load,
    get loaded() {
      return regions.length > 0;
    },
    regions: () => regions.slice(),
    range() {
      if (!regions.length) return null;
      return {
        start: Math.min(...regions.map((r) => r.start)),
        end: Math.max(...regions.map((r) => r.end)),
        regions: regions.map((r) => ({ ...r })),
      };
    },
  };
}

/** The 5-minute bucket with the most aircraft in the air. */
function busiestInstant(tracks, start, end) {
  const B = 5 * 60_000;
  const n = Math.max(1, Math.ceil((end - start) / B));
  const counts = new Array(n).fill(0);
  for (const tr of tracks) {
    const a = Math.floor((tr.points[0].t - start) / B);
    const b = Math.floor((tr.points[tr.points.length - 1].t - start) / B);
    for (let i = Math.max(0, a); i <= Math.min(n - 1, b); i++) counts[i]++;
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (counts[i] > counts[best]) best = i;
  return { t: start + best * B + B / 2, aircraft: counts[best] };
}

/**
 * A read-only view over the device's recorder and the archive, with the
 * recorder's query surface (covers, snapshotAt, trail, samples, stateAt…).
 */
export function historyView(live, archive) {
  const a = archive.recorder;
  const pick = (key) => (live.has(key) ? live : a.has(key) ? a : null);
  return {
    covers: (ms, slack) => live.covers(ms, slack) || a.covers(ms, slack),
    has: (key) => live.has(key) || a.has(key),
    meta: (key) => live.meta(key) || a.meta(key),
    *keys() {
      yield* live.keys();
      for (const k of a.keys()) if (!live.has(k)) yield k;
    },
    samples(key, from, to) {
      const own = live.samples(key, from, to);
      return own.length ? own : a.samples(key, from, to);
    },
    stateAt(key, ms, opts) {
      return live.stateAt(key, ms, opts) || a.stateAt(key, ms, opts);
    },
    snapshotAt(ms, opts) {
      const own = live.snapshotAt(ms, opts);
      if (!a.covers(ms, 60_000)) return own;
      const seen = new Set(own.map((s) => s.key));
      for (const s of a.snapshotAt(ms, opts)) if (!seen.has(s.key)) own.push(s);
      return own;
    },
    trail(key, from, to, max) {
      const r = live.trail(key, from, to, max);
      return r.length >= 2 ? r : a.trail(key, from, to, max);
    },
    events: () => live.events(),
    range: () => live.range(),
    source: (key) => (pick(key) === a ? 'archive' : 'device'),
  };
}
