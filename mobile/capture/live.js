/**
 * Live broadcast session (DESIGN.md §11.4 "Live"): MediaRecorder timeslice
 * chunks are hashed and sealed every 10 s into a hash chain of segments,
 * each carrying the pose and position at that moment. Stopping returns the
 * whole recording, the chain and the sensor session, ready for `seal()`.
 *
 * Segment i covers bytes [offset, offset + bytes) of the final file, so a
 * verifier can re-split the file and recompute every link.
 */

import { sha256Hex, canonical } from './provenance.js';

const TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1',
  'video/mp4',
];

export function canBroadcast(stream) {
  return !!stream && typeof MediaRecorder !== 'undefined';
}

/**
 * @param {{ stream: MediaStream, sensors: object, pose: () => object,
 *   fix: () => object|null, segmentMs?: number, onSegment?: (seg) => void }} o
 */
export function createLiveSession(o) {
  const segmentMs = o.segmentMs || 10000;
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
  const chunks = [];
  let pending = [];
  const segments = [];
  let recorder = null;
  let timer = 0;
  let prev = null;
  let offset = 0;
  let t0 = 0;
  let segT0 = 0;
  let sealing = Promise.resolve();

  async function sealSegment() {
    const parts = pending;
    pending = [];
    if (!parts.length) return null;
    const blob = new Blob(parts, { type: mimeType || 'video/webm' });
    const t1 = Date.now();
    const p = o.pose?.() || {};
    const f = o.fix?.() || null;
    const seg = {
      i: segments.length,
      t0: segT0,
      t1,
      offset,
      bytes: blob.size,
      media: await sha256Hex(blob),
      pose: {
        headingDeg: Number.isFinite(p.az) ? Math.round(p.az * 10) / 10 : null,
        pitchDeg: Number.isFinite(p.el) ? Math.round(p.el * 10) / 10 : null,
      },
      gps: f
        ? {
            lat: +f.lat.toFixed(6),
            lon: +f.lon.toFixed(6),
            acc: Math.round(f.acc || 0),
          }
        : null,
      prev,
    };
    seg.hash = await sha256Hex(canonical(seg));
    prev = seg.hash;
    offset += blob.size;
    segT0 = t1;
    segments.push(seg);
    o.onSegment?.(seg);
    return seg;
  }

  function start() {
    recorder = new MediaRecorder(
      o.stream,
      mimeType ? { mimeType, videoBitsPerSecond: 2.5e6 } : undefined,
    );
    recorder.ondataavailable = (e) => {
      if (!e.data?.size) return;
      chunks.push(e.data);
      pending.push(e.data);
    };
    recorder.start(1000);
    t0 = Date.now();
    segT0 = t0;
    o.sensors?.beginSession?.();
    timer = setInterval(() => {
      sealing = sealing
        .then(sealSegment)
        .catch((err) => console.warn('segment', err));
    }, segmentMs);
  }

  async function stop() {
    clearInterval(timer);
    if (recorder && recorder.state !== 'inactive')
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
    await sealing;
    await sealSegment();
    const session = o.sensors?.endSession?.() || {
      start: new Date(t0).toISOString(),
      end: new Date().toISOString(),
      imu: [],
      gps: [],
      heading: null,
    };
    return {
      blob: new Blob(chunks, { type: mimeType || 'video/webm' }),
      segments,
      session,
      startedAt: t0,
      endedAt: Date.now(),
      mimeType: mimeType || 'video/webm',
    };
  }

  return {
    start,
    stop,
    get segments() {
      return segments;
    },
    get startedAt() {
      return t0;
    },
    get active() {
      return !!recorder && recorder.state === 'recording';
    },
  };
}

/** Re-split a live file at the sealed offsets and recompute the chain. */
export async function verifySegments(blob, segments) {
  let prev = null;
  for (const s of segments) {
    const part = blob.slice(s.offset, s.offset + s.bytes);
    const media = await sha256Hex(part);
    const { hash, ...core } = s;
    const h = await sha256Hex(canonical(core));
    if (media !== s.media || h !== hash || s.prev !== prev)
      return { ok: false, at: s.i };
    prev = hash;
  }
  return { ok: true, n: segments.length, head: prev };
}
