/**
 * Witness provenance (DESIGN.md §6), the browser equivalent of a Secure
 * Enclave + C2PA flow:
 *
 *   media      → sha256
 *   session    { start, end, imu:[{t,α,β,γ,ax,ay,az}], gps:[{t,lat,lon,acc,alt}], heading }
 *   context    { device, ua, screen, timezone, network-time-offset, … }
 *   prev       hash of this device's previous bundle (hash chain)
 *   hash       sha256(canonical(core))   core = everything above + seq, key id, public key, sealedAt
 *   signature  ECDSA P-256 / SHA-256 over the hash bytes, with a device key that
 *              is generated non-extractable and kept in IndexedDB.
 *
 * None of this proves truth. It raises the cost of lying.
 */

import { get, put, putCapture, lastCapture, captureBySeq } from './db.js';

const subtle = globalThis.crypto?.subtle;
const enc = new TextEncoder();
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

/** Deterministic JSON: sorted keys, no whitespace, JSON number semantics. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value))
    return `[${value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined && typeof value[k] !== 'function')
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

const normalize = (v) => JSON.parse(canonical(v));

export const toHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) =>
  new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s) => {
  const b = atob(
    s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4),
  );
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export async function sha256Hex(data) {
  const bytes =
    typeof data === 'string'
      ? enc.encode(data)
      : data instanceof Blob
        ? await data.arrayBuffer()
        : data;
  return toHex(await subtle.digest('SHA-256', bytes));
}

function assertCrypto() {
  if (!subtle)
    throw new Error('WebCrypto needs a secure context (https or localhost)');
}

/** The device signing key: generated once, private half non-extractable. */
export async function deviceKey() {
  assertCrypto();
  const stored = await get('keys', 'device').catch(() => null);
  if (stored?.privateKey && stored?.publicJwk) return stored;
  const pair = await subtle.generateKey(ALG, false, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  const publicJwk = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  const keyId = (await sha256Hex(canonical(publicJwk))).slice(0, 16);
  const rec = {
    id: 'device',
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicJwk,
    keyId,
    createdAt: new Date().toISOString(),
    extractable: pair.privateKey.extractable,
  };
  await put('keys', rec);
  return rec;
}

/** Estimate the device clock's offset from the server's Date header (±1 s). */
export async function networkTimeOffset() {
  try {
    const t0 = Date.now();
    const r = await fetch(location.pathname, {
      method: 'HEAD',
      cache: 'no-store',
    });
    const t1 = Date.now();
    const d = Date.parse(r.headers.get('date') || '');
    if (!Number.isFinite(d)) return null;
    return Math.round(d + 500 - (t0 + t1) / 2);
  } catch {
    return null;
  }
}

/**
 * Seal a capture.
 * @param {{ media: Blob, session: object, context: object }} input
 * @returns {Promise<object>} the stored bundle
 */
export async function seal({ media, session, context }) {
  assertCrypto();
  const key = await deviceKey();
  const mediaHash = await sha256Hex(media);
  const last = await lastCapture().catch(() => null);
  const seq = (last?.seq || 0) + 1;
  const core = normalize({
    v: 1,
    seq,
    media: {
      sha256: mediaHash,
      type: media.type || 'application/octet-stream',
      bytes: media.size,
    },
    session,
    context,
    prev: last?.hash || null,
    keyId: key.keyId,
    publicKey: key.publicJwk,
    sealedAt: new Date().toISOString(),
  });
  const hash = await sha256Hex(canonical(core));
  const sig = await subtle.sign(SIGN, key.privateKey, fromHex(hash));
  const bundle = {
    ...core,
    id: `cap-${String(seq).padStart(4, '0')}-${hash.slice(0, 8)}`,
    hash,
    alg: 'ES256',
    signature: b64url(sig),
  };
  await putCapture(bundle, media);
  return bundle;
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Core fields covered by the hash (everything but the outputs). */
function coreOf(bundle) {
  const { id, hash, alg, signature, ...core } = bundle;
  void id;
  void hash;
  void alg;
  void signature;
  return core;
}

/**
 * Verify a bundle: hash, signature, chain, sensor plausibility.
 * @returns {Promise<{ ok: boolean, checks: Array<{id,label,status,detail}> }>}
 */
export async function verify(bundle, mediaBlob) {
  assertCrypto();
  const checks = [];
  const add = (id, label, status, detail) =>
    checks.push({ id, label, status, detail });

  // 1. Media hash
  if (mediaBlob) {
    const h = await sha256Hex(mediaBlob);
    add(
      'media',
      'Media hash',
      h === bundle.media?.sha256 ? 'pass' : 'fail',
      h === bundle.media?.sha256
        ? `sha256 ${h.slice(0, 16)}… matches ${bundle.media.bytes.toLocaleString()} bytes`
        : `recomputed ${h.slice(0, 16)}… ≠ sealed ${String(bundle.media?.sha256).slice(0, 16)}…`,
    );
  } else
    add('media', 'Media hash', 'warn', 'Media not available on this device');

  // 2. Bundle hash
  const recomputed = await sha256Hex(canonical(coreOf(bundle)));
  const hashOk = recomputed === bundle.hash;
  add(
    'hash',
    'Bundle hash',
    hashOk ? 'pass' : 'fail',
    hashOk
      ? `sha256(canonical(bundle)) = ${recomputed.slice(0, 16)}…`
      : 'Bundle was modified after sealing',
  );

  // 3. Signature
  try {
    const pub = await subtle.importKey(
      'jwk',
      { ...bundle.publicKey, ext: true },
      ALG,
      true,
      ['verify'],
    );
    const ok = await subtle.verify(
      SIGN,
      pub,
      fromB64url(bundle.signature),
      fromHex(bundle.hash),
    );
    const mine = await deviceKey().catch(() => null);
    const same = mine?.keyId === bundle.keyId;
    add(
      'signature',
      'Signature',
      ok ? (same ? 'pass' : 'warn') : 'fail',
      ok
        ? `ECDSA P-256 valid · key ${bundle.keyId}${same ? ' (this device)' : ' (another device)'}`
        : 'Signature does not verify against the embedded public key',
    );
  } catch (err) {
    add('signature', 'Signature', 'fail', `Could not verify: ${err.message}`);
  }

  // 4. Chain
  if (bundle.seq === 1)
    add(
      'chain',
      'Hash chain',
      bundle.prev === null ? 'pass' : 'fail',
      bundle.prev === null
        ? 'Genesis capture for this device key'
        : 'First capture claims a predecessor',
    );
  else {
    const prev = await captureBySeq(bundle.seq - 1).catch(() => null);
    if (!prev)
      add(
        'chain',
        'Hash chain',
        'warn',
        `Capture #${bundle.seq - 1} is not on this device`,
      );
    else if (prev.hash === bundle.prev && prev.keyId === bundle.keyId)
      add(
        'chain',
        'Hash chain',
        'pass',
        `#${bundle.seq} ← #${prev.seq} ${prev.hash.slice(0, 12)}…`,
      );
    else add('chain', 'Hash chain', 'fail', `Link to #${prev.seq} is broken`);
  }

  // 5. IMU plausibility
  const imu = bundle.session?.imu || [];
  if (imu.length < 5)
    add(
      'imu',
      'Motion trace',
      'warn',
      imu.length
        ? `Only ${imu.length} samples`
        : 'No motion sensors were available',
    );
  else {
    const dur = (imu[imu.length - 1].t - imu[0].t) / 1000;
    const rate = imu.length / Math.max(0.001, dur);
    let mono = true;
    for (let i = 1; i < imu.length; i += 1)
      if (imu[i].t < imu[i - 1].t) mono = false;
    const mags = imu
      .filter((s) => Number.isFinite(s.ax))
      .map((s) => Math.hypot(s.ax, s.ay, s.az));
    const g = median(mags);
    const mean = mags.reduce((a, b) => a + b, 0) / Math.max(1, mags.length);
    const sd = Math.sqrt(
      mags.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, mags.length),
    );
    const gravityOk = Number.isFinite(g) ? Math.abs(g - 9.81) < 1.6 : null;
    const alive = sd > 0.004;
    // Pitch from gravity should agree with the orientation β.
    let tiltAgree = null;
    const withBoth = imu.filter(
      (s) =>
        Number.isFinite(s.β) && Number.isFinite(s.ay) && Number.isFinite(s.az),
    );
    if (withBoth.length > 4) {
      // iOS reports gravity with the opposite sign to the W3C spec; accept either.
      const d = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
      const diffs = withBoth.map((s) => {
        const pitchG = (Math.atan2(s.ay, s.az) * 180) / Math.PI;
        const flipped = (Math.atan2(-s.ay, -s.az) * 180) / Math.PI;
        return Math.min(d(pitchG, s.β), d(flipped, s.β));
      });
      tiltAgree = median(diffs) < 20;
    }
    const status =
      !mono || gravityOk === false
        ? 'fail'
        : alive && tiltAgree !== false
          ? 'pass'
          : 'warn';
    add(
      'imu',
      'Motion trace',
      status,
      `${imu.length} samples · ${rate.toFixed(0)} Hz · ${dur.toFixed(1)} s · |g| ${Number.isFinite(g) ? g.toFixed(2) : '—'} m/s²${alive ? ' · hand tremor present' : ' · suspiciously still'}${tiltAgree === null ? '' : tiltAgree ? ' · tilt agrees with gravity' : ' · tilt disagrees with gravity'}`,
    );
  }

  // 6. GPS plausibility
  const gps = bundle.session?.gps || [];
  if (!gps.length) add('gps', 'Location', 'warn', 'No GPS fix during capture');
  else {
    const s0 = Date.parse(bundle.session.start);
    const s1 = Date.parse(bundle.session.end);
    const inWindow = gps.every((f) => f.t >= s0 - 120e3 && f.t <= s1 + 120e3);
    let maxSpeed = 0;
    for (let i = 1; i < gps.length; i += 1) {
      const a = gps[i - 1];
      const b = gps[i];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.5) {
        const R = 6371e3;
        const dLat = ((b.lat - a.lat) * Math.PI) / 180;
        const dLon = ((b.lon - a.lon) * Math.PI) / 180;
        const x =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((a.lat * Math.PI) / 180) *
            Math.cos((b.lat * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
        maxSpeed = Math.max(maxSpeed, (2 * R * Math.asin(Math.sqrt(x))) / dt);
      }
    }
    const acc = median(gps.map((f) => f.acc).filter(Number.isFinite));
    const last = gps[gps.length - 1];
    // The clock's timezone should be roughly where the fix says we are.
    const tzH = -(bundle.context?.tzOffsetMin ?? 0) / 60;
    const solarH = last.lon / 15;
    const tzOk = Math.abs(((tzH - solarH + 36) % 24) - 12) < 3.5;
    const speedOk = maxSpeed < 300;
    const status =
      !inWindow || !speedOk ? 'fail' : tzOk && acc < 500 ? 'pass' : 'warn';
    add(
      'gps',
      'Location',
      status,
      `${gps.length} fix${gps.length > 1 ? 'es' : ''} · ±${Number.isFinite(acc) ? Math.round(acc) : '—'} m · max ${maxSpeed.toFixed(1)} m/s${inWindow ? ' · within session' : ' · outside session window'}${tzOk ? ' · clock zone agrees with longitude' : ' · clock zone disagrees with longitude'}`,
    );
  }

  // 7. Heading
  const hd = bundle.session?.heading;
  if (hd && Number.isFinite(hd.deg))
    add(
      'heading',
      'Heading',
      hd.source === 'compass' || hd.source === 'absolute' ? 'pass' : 'warn',
      `${Math.round(hd.deg)}° (${hd.source})${Number.isFinite(hd.pitch) ? ` · camera pitch ${hd.pitch.toFixed(0)}°` : ''}`,
    );
  else add('heading', 'Heading', 'warn', 'No compass heading recorded');

  // 8. Clock
  const off = bundle.context?.networkTimeOffsetMs;
  const sealedVsEnd =
    Date.parse(bundle.sealedAt) - Date.parse(bundle.session?.end);
  const clockOk = Number.isFinite(off) ? Math.abs(off) < 5000 : null;
  add(
    'clock',
    'Clock',
    clockOk === false || sealedVsEnd > 60e3 || sealedVsEnd < -2000
      ? 'warn'
      : clockOk
        ? 'pass'
        : 'warn',
    `${Number.isFinite(off) ? `device vs network ${off >= 0 ? '+' : ''}${(off / 1000).toFixed(1)} s` : 'network time unavailable'} · sealed ${(sealedVsEnd / 1000).toFixed(1)} s after capture`,
  );

  return { ok: !checks.some((c) => c.status === 'fail'), checks };
}
