/**
 * The recorder (DESIGN.md §12.5, "it remembers"): every live contact's
 * position on every poll, kept for about six hours.
 *
 * Memory layout: one growable Int32Array per entity, five ints per sample:
 *   t (epoch s) · lon×1e6 · lat×1e6 · alt (m) · heading×10 << 12 | speed (dm/s)
 * That is 20 bytes a sample. Low traffic (helicopters, approaches, anything
 * below ~6 km) keeps every poll (≥ 6 s apart); cruise traffic keeps one fix
 * every 50 s, since straight lines interpolate. Samples older than 30 min
 * are thinned (1/min low, 1/3 min cruise), and the whole buffer is capped at
 * 1.2 M samples (~24 MB; oldest minutes are evicted first).
 *
 * Persistence: once a minute the new samples go to IndexedDB as one segment
 * (at most one sample per entity per 30 s, per 2 min for cruise), with each
 * entity's metadata.
 * Segments older than the window are deleted. On start the recorder replays
 * the stored segments, so a reload keeps its history.
 */
import { idbDeleteBelow, idbEntries, idbPut, idbPutMany } from './idb.js';

const STRIDE = 5;
const MIN_GAP_S = 6;
// Cruise traffic (above ~6 km) flies straight lines: one fix a minute
// interpolates to within metres of the truth, so it is recorded sparsely.
// Low traffic (helicopters, approaches, circling) keeps every poll.
const CRUISE_ALT_M = 6000;
const CRUISE_GAP_S = 50;
const FINE_WINDOW_S = 30 * 60;
const COARSE_GAP_S = 60;
const CRUISE_COARSE_GAP_S = 180;
const PERSIST_GAP_S = 30;
const CRUISE_PERSIST_GAP_S = 120;
const MAX_INTERP_GAP_S = 6 * 60;
const D2R = Math.PI / 180;

function packHs(heading, speed) {
  const h = Math.round(((((heading ?? 0) % 360) + 360) % 360) * 10) & 0xfff;
  const s = Math.max(0, Math.min(4095, Math.round((speed ?? 0) * 10)));
  return (h << 12) | s;
}
const unpackH = (v) => ((v >>> 12) & 0xfff) / 10;
const unpackS = (v) => (v & 0xfff) / 10;

class Track {
  constructor(key, meta) {
    this.key = key;
    this.meta = meta;
    this.buf = new Int32Array(STRIDE * 16);
    this.n = 0;
    this.persistedT = 0;
  }
  get firstT() {
    return this.n ? this.buf[0] : 0;
  }
  get lastT() {
    return this.n ? this.buf[(this.n - 1) * STRIDE] : 0;
  }
  push(t, lon, lat, alt, hs) {
    if (this.n && t <= this.lastT) {
      // Out-of-order (a merged backfill): insert in place.
      return this.insert(t, lon, lat, alt, hs);
    }
    if ((this.n + 1) * STRIDE > this.buf.length) {
      const next = new Int32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    const o = this.n * STRIDE;
    this.buf[o] = t;
    this.buf[o + 1] = lon;
    this.buf[o + 2] = lat;
    this.buf[o + 3] = alt;
    this.buf[o + 4] = hs;
    this.n++;
    return true;
  }
  insert(t, lon, lat, alt, hs) {
    const i = this.lowerBound(t);
    if (i < this.n && Math.abs(this.buf[i * STRIDE] - t) < 2) return false;
    if (i > 0 && Math.abs(this.buf[(i - 1) * STRIDE] - t) < 2) return false;
    if ((this.n + 1) * STRIDE > this.buf.length) {
      const next = new Int32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf.copyWithin((i + 1) * STRIDE, i * STRIDE, this.n * STRIDE);
    const o = i * STRIDE;
    this.buf[o] = t;
    this.buf[o + 1] = lon;
    this.buf[o + 2] = lat;
    this.buf[o + 3] = alt;
    this.buf[o + 4] = hs;
    this.n++;
    return true;
  }
  /** First index with t >= value. */
  lowerBound(t) {
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.buf[mid * STRIDE] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  sample(i) {
    const o = i * STRIDE;
    const b = this.buf;
    return {
      t: b[o] * 1000,
      lon: b[o + 1] / 1e6,
      lat: b[o + 2] / 1e6,
      altM: b[o + 3],
      headingDeg: unpackH(b[o + 4]),
      speed: unpackS(b[o + 4]),
    };
  }
  /** Remove samples before t; thin samples between t and fineFrom. */
  compact(dropBefore, fineFrom) {
    const b = this.buf;
    let w = 0;
    let lastKept = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const o = i * STRIDE;
      const t = b[o];
      if (t < dropBefore) continue;
      const isLast = i === this.n - 1;
      const gap = b[o + 3] > CRUISE_ALT_M ? CRUISE_COARSE_GAP_S : COARSE_GAP_S;
      if (t < fineFrom && !isLast && t - lastKept < gap) continue;
      if (w !== i) b.copyWithin(w * STRIDE, o, o + STRIDE);
      lastKept = t;
      w++;
    }
    const removed = this.n - w;
    this.n = w;
    if (this.buf.length > 64 && this.n * STRIDE * 4 < this.buf.length) {
      this.buf = this.buf.slice(0, Math.max(STRIDE * 16, this.n * STRIDE * 2));
    }
    return removed;
  }
}

const lerp = (a, b, f) => a + (b - a) * f;
function lerpAngle(a, b, f) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

/**
 * @param {{ windowMs?: number, maxSamples?: number, persist?: boolean }} [opts]
 */
export function createRecorder({
  windowMs = 6 * 3600_000,
  maxSamples = 1_200_000,
  persist = true,
  archive = false,
  maxInterpGapS = MAX_INTERP_GAP_S,
} = {}) {
  const tracks = new Map();
  let total = 0;
  let pending = []; // [key, t, lon, lat, alt, hs]
  let segSeq = 0;
  const dirtyMeta = new Set();
  const listeners = new Set();
  const events = []; // { t, kind, key, title } (first squawk, first seen helicopters…)
  let loaded = false;
  let loading = null;
  let minT = Infinity;
  let maxT = -Infinity;

  function bounds() {
    minT = Infinity;
    maxT = -Infinity;
    for (const tr of tracks.values()) {
      if (!tr.n) continue;
      if (tr.firstT < minT) minT = tr.firstT;
      if (tr.lastT > maxT) maxT = tr.lastT;
    }
  }

  function append(key, meta, t, lon, lat, alt, hs, { fromStore = false } = {}) {
    let tr = tracks.get(key);
    if (!tr) {
      tr = new Track(key, meta);
      tracks.set(key, tr);
    } else if (meta) {
      const prev = tr.meta;
      if (
        !prev ||
        prev.squawk !== meta.squawk ||
        prev.callsign !== meta.callsign ||
        (meta.registration && prev.registration !== meta.registration)
      ) {
        // Flags learned from any source stick (one feed may omit the
        // rotorcraft category another one reported).
        tr.meta = { ...prev, ...meta };
        for (const flag of ['helicopter', 'military', 'pia', 'ladd'])
          if (prev?.[flag]) tr.meta[flag] = true;
        if (!fromStore) dirtyMeta.add(key);
      }
    }
    const cruise = alt > CRUISE_ALT_M;
    if (
      tr.n &&
      t > tr.lastT &&
      t - tr.lastT < (cruise && !fromStore ? CRUISE_GAP_S : MIN_GAP_S)
    )
      return false;
    if (!tr.push(t, lon, lat, alt, hs)) return false;
    total++;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
    if (
      !fromStore &&
      persist &&
      t - tr.persistedT >= (cruise ? CRUISE_PERSIST_GAP_S : PERSIST_GAP_S)
    ) {
      tr.persistedT = t;
      pending.push([key, t, lon, lat, alt, hs]);
    }
    return true;
  }

  /**
   * Record a feed's records. `kind` names the source family:
   * 'aircraft' (flights / regional), 'military', 'vessel'.
   */
  function ingest(records, { kind = 'aircraft', at = Date.now() } = {}) {
    if (!records?.length) return 0;
    let n = 0;
    const nowS = Math.floor(at / 1000);
    for (const r of records) {
      if (!Number.isFinite(r.lon) || !Number.isFinite(r.lat)) continue;
      // The transponder's own last-contact time is the truth: a stale
      // upstream repeats old positions with old times, never "now".
      const seen = Number.isFinite(r.seenAt)
        ? Math.floor(Math.min(r.seenAt, at + 5000) / 1000)
        : nowS;
      if (nowS - seen > 15 * 60) continue;
      const key = kind === 'vessel' ? `v:${r.id}` : String(r.id);
      const meta =
        kind === 'vessel'
          ? { kind: 'vessel', layer: 'vessels', title: r.name, type: r.type }
          : {
              kind: r.military
                ? 'military'
                : r.helicopter
                  ? 'helicopter'
                  : 'aircraft',
              layer: r.military ? 'military' : 'flights',
              callsign: r.callsign,
              registration: r.registration || undefined,
              type: r.type || undefined,
              country: r.country || undefined,
              squawk: r.squawk || undefined,
              helicopter: Boolean(r.helicopter),
              military: Boolean(r.military),
              ga: Boolean(r.ga),
              category: r.category ?? undefined,
              onGround: Boolean(r.onGround),
              ...(r.pia ? { pia: true } : {}),
              ...(r.ladd ? { ladd: true } : {}),
            };
      const before = tracks.get(key);
      const hadEmergency = before?.meta?.emergency;
      if (r.emergency) meta.emergency = true;
      if (
        append(
          key,
          meta,
          seen,
          Math.round(r.lon * 1e6),
          Math.round(r.lat * 1e6),
          Math.round(r.altM ?? 0),
          packHs(r.heading, r.speed),
        )
      )
        n++;
      if (r.emergency && !hadEmergency)
        events.push({
          t: seen * 1000,
          kind: 'squawk',
          key,
          title: `${r.callsign || r.id} squawking ${r.squawk}`,
          lon: r.lon,
          lat: r.lat,
        });
    }
    if (events.length > 400) events.splice(0, events.length - 400);
    if (n) for (const fn of listeners) fn({ added: n, kind });
    return n;
  }

  /** Merge an externally fetched track ([{t, lon, lat, altM, headingDeg?, speed?}]). */
  function merge(key, points, meta) {
    let n = 0;
    for (const p of points) {
      if (!Number.isFinite(p.t) || !Number.isFinite(p.lon)) continue;
      if (
        append(
          key,
          meta,
          Math.floor(p.t / 1000),
          Math.round(p.lon * 1e6),
          Math.round(p.lat * 1e6),
          Math.round(p.altM ?? 0),
          packHs(p.headingDeg, p.speed),
          { fromStore: true },
        )
      )
        n++;
    }
    return n;
  }

  function compactAll() {
    // An archive (a bundled recording) is already sparse and never expires.
    if (archive) return;
    const nowS = Math.floor(Date.now() / 1000);
    let dropBefore = nowS - Math.floor(windowMs / 1000);
    const fineFrom = nowS - FINE_WINDOW_S;
    let removed = 0;
    for (const [key, tr] of tracks) {
      removed += tr.compact(dropBefore, fineFrom);
      if (!tr.n) tracks.delete(key);
    }
    total -= removed;
    // Over budget: evict the oldest ten minutes at a time.
    while (total > maxSamples && dropBefore < nowS - 600) {
      dropBefore += 600;
      for (const [key, tr] of tracks) {
        total -= tr.compact(dropBefore, fineFrom);
        if (!tr.n) tracks.delete(key);
      }
    }
    bounds();
  }

  async function flush() {
    if (!persist || !pending.length) return;
    const rows = pending;
    pending = [];
    const keys = [];
    const index = new Map();
    const data = new Int32Array(rows.length * 6);
    rows.forEach(([key, t, lon, lat, alt, hs], i) => {
      let k = index.get(key);
      if (k == null) {
        k = keys.length;
        keys.push(key);
        index.set(key, k);
      }
      data.set([k, t, lon, lat, alt, hs], i * 6);
    });
    const segKey = rows[0][1] + (segSeq++ % 1000) / 1000;
    await idbPut('seg', segKey, { keys, data: data.buffer });
    if (dirtyMeta.size) {
      const metas = [];
      for (const key of dirtyMeta) {
        const tr = tracks.get(key);
        if (tr?.meta) metas.push([key, tr.meta]);
      }
      dirtyMeta.clear();
      await idbPutMany('meta', metas);
    }
    idbDeleteBelow(
      'seg',
      Math.floor((Date.now() - windowMs) / 1000) - 60,
    ).catch(() => {});
  }

  async function load() {
    if (loaded) return;
    if (loading) return loading;
    loading = (async () => {
      if (!persist) return;
      const since = Math.floor((Date.now() - windowMs) / 1000);
      const [segs, metas] = await Promise.all([
        idbEntries('seg', since),
        idbEntries('meta'),
      ]);
      const metaBy = new Map(metas);
      for (const [, seg] of segs) {
        if (!seg?.keys || !seg.data) continue;
        const d = new Int32Array(seg.data);
        for (let i = 0; i + 5 < d.length; i += 6) {
          const key = seg.keys[d[i]];
          append(
            key,
            metaBy.get(key) || { kind: 'aircraft' },
            d[i + 1],
            d[i + 2],
            d[i + 3],
            d[i + 4],
            d[i + 5],
            { fromStore: true },
          );
        }
      }
      // Stored history is coarse (30 s); new polls continue each track.
      for (const tr of tracks.values()) tr.persistedT = tr.lastT;
    })().finally(() => {
      loaded = true;
    });
    return loading;
  }

  const flushTimer = archive
    ? 0
    : setInterval(() => flush().catch(() => {}), 60_000);
  const compactTimer = archive ? 0 : setInterval(compactAll, 5 * 60_000);
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush().catch(() => {});
  };
  if (!archive) document.addEventListener('visibilitychange', onHide);

  /** Interpolated state of one track at `ms`, or null outside its record. */
  function stateAt(tr, ms, { holdMs = 45_000 } = {}) {
    if (!tr?.n) return null;
    const s = ms / 1000;
    const first = tr.firstT;
    const last = tr.lastT;
    if (s < first - 5 || s > last + holdMs / 1000) return null;
    const i = tr.lowerBound(s);
    if (i >= tr.n) {
      // Past the last fix: dead-reckon briefly along the last heading.
      const p = tr.sample(tr.n - 1);
      const dt = s - last;
      if (p.speed > 1 && dt > 0) {
        const h = p.headingDeg * D2R;
        const d = p.speed * Math.min(dt, 45);
        p.lat += (d * Math.cos(h)) / 111_320;
        p.lon += (d * Math.sin(h)) / (111_320 * Math.cos(p.lat * D2R));
      }
      p.t = ms;
      return p;
    }
    if (i === 0) return { ...tr.sample(0), t: ms };
    const a = tr.sample(i - 1);
    const b = tr.sample(i);
    const gap = (b.t - a.t) / 1000;
    if (gap > maxInterpGapS) return null;
    const f = (ms - a.t) / (b.t - a.t || 1);
    return {
      t: ms,
      lon: lerp(a.lon, b.lon, f),
      lat: lerp(a.lat, b.lat, f),
      altM: lerp(a.altM, b.altM, f),
      headingDeg: lerpAngle(a.headingDeg, b.headingDeg, f),
      speed: lerp(a.speed, b.speed, f),
    };
  }

  return {
    ingest,
    merge,
    load,
    flush,
    compact: compactAll,
    events: () => events.slice(),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** { start, end, entities, points } in epoch ms; null start/end when empty. */
    range() {
      if (!Number.isFinite(minT)) bounds();
      return {
        start: Number.isFinite(minT) ? minT * 1000 : null,
        end: Number.isFinite(maxT) ? maxT * 1000 : null,
        entities: tracks.size,
        points: total,
        bytes: total * STRIDE * 4,
      };
    },
    covers(ms, slackMs = 60_000) {
      if (!Number.isFinite(minT)) return false;
      return ms >= minT * 1000 - slackMs && ms <= maxT * 1000 + slackMs;
    },
    has: (key) => tracks.has(String(key)),
    meta: (key) => tracks.get(String(key))?.meta || null,
    keys: () => tracks.keys(),
    /** All samples of one entity: [{ t, lon, lat, altM, headingDeg, speed }]. */
    samples(key, fromMs = -Infinity, toMs = Infinity) {
      const tr = tracks.get(String(key));
      if (!tr) return [];
      const out = [];
      const i0 = Number.isFinite(fromMs) ? tr.lowerBound(fromMs / 1000) : 0;
      for (let i = i0; i < tr.n; i++) {
        const p = tr.sample(i);
        if (p.t > toMs) break;
        out.push(p);
      }
      return out;
    },
    stateAt(key, ms, opts) {
      return stateAt(tracks.get(String(key)), ms, opts);
    },
    /**
     * Every entity with a state at `ms` (optionally inside `rect`):
     * [{ key, meta, lon, lat, altM, headingDeg, speed }].
     */
    snapshotAt(ms, { rect = null, holdMs = 45_000 } = {}) {
      const out = [];
      for (const tr of tracks.values()) {
        if (!tr.n) continue;
        const s = ms / 1000;
        if (s < tr.firstT - 5 || s > tr.lastT + holdMs / 1000) continue;
        if (rect) {
          // Cheap reject on the nearest raw fix before interpolating.
          const i = Math.min(tr.n - 1, tr.lowerBound(s));
          const lat = tr.buf[i * STRIDE + 2] / 1e6;
          const lon = tr.buf[i * STRIDE + 1] / 1e6;
          if (lat < rect.south - 1 || lat > rect.north + 1) continue;
          if (
            rect.west <= rect.east &&
            (lon < rect.west - 1.5 || lon > rect.east + 1.5)
          )
            continue;
        }
        const p = stateAt(tr, ms, { holdMs });
        if (!p) continue;
        if (rect && !inRectLL(rect, p.lon, p.lat)) continue;
        out.push({ key: tr.key, meta: tr.meta, ...p });
      }
      return out;
    },
    /** Positions of one entity between two instants (for ghost trails). */
    trail(key, fromMs, toMs, maxPoints = 120) {
      const tr = tracks.get(String(key));
      if (!tr?.n) return [];
      const i0 = tr.lowerBound(fromMs / 1000);
      const i1 = tr.lowerBound(toMs / 1000);
      const step = Math.max(1, Math.ceil((i1 - i0) / maxPoints));
      const out = [];
      for (let i = i0; i < i1; i += step) {
        const p = tr.sample(i);
        out.push([p.lon, p.lat, p.altM]);
      }
      const end = stateAt(tr, toMs);
      if (end) out.push([end.lon, end.lat, end.altM]);
      return out;
    },
    destroy() {
      clearInterval(flushTimer);
      clearInterval(compactTimer);
      document.removeEventListener('visibilitychange', onHide);
      flush().catch(() => {});
    },
  };
}

function inRectLL(rect, lon, lat) {
  if (lat < rect.south || lat > rect.north) return false;
  if (rect.west <= rect.east) return lon >= rect.west && lon <= rect.east;
  return lon >= rect.west || lon <= rect.east;
}
