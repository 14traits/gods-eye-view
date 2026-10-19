/**
 * Pairing and message relay between the desktop app (host) and one phone.
 *
 * Transport-agnostic: a peer is `{ send(text), close(code, reason) }`, so the
 * WebSocket and HTTP-fallback transports share every rule here. The desktop
 * creates a session from a loopback request and receives a host key. The
 * phone proves possession of the short pairing code shown on the desktop
 * (carried in the QR code's URL fragment) and receives its own key. Too many
 * wrong codes rotate the code, so guessing cannot outlast the session.
 *
 * Messages are small JSON texts the relay forwards without interpreting,
 * bounded in size and rate. The newest preview frame (a JPEG the host sends)
 * is held for the phone to pull, so a slow phone drops frames instead of
 * queueing them.
 */
import crypto from 'node:crypto';

// No 0/O, 1/I/L: the code is read off a screen.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PAIRING_CODE_LENGTH = 6;
export const MAX_TEXT_BYTES = 4096;
export const MAX_FRAME_BYTES = 768 * 1024;
const MAX_CODE_FAILURES = 8;
const MESSAGE_BURST = 240;
const MESSAGES_PER_SECOND = 120;
// A host that disappears (a reload, a closed tab) may come back this soon.
const HOST_GRACE_MS = 60000;
const MAX_SESSIONS = 4;

const randomKey = () => crypto.randomBytes(24).toString('base64url');
function pairingCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}
const sameSecret = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const normalizeCode = (code) =>
  String(code ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 32);

/**
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {(session: object) => void} [options.onSessionClosed]
 */
export function createVcamRelay({
  now = () => Date.now(),
  onSessionClosed = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  /** @type {Map<string, object>} */
  const sessions = new Map();

  const bucket = () => ({ tokens: MESSAGE_BURST, at: now() });
  function admit(rate) {
    const at = now();
    rate.tokens = Math.min(
      MESSAGE_BURST,
      rate.tokens + ((at - rate.at) / 1000) * MESSAGES_PER_SECOND,
    );
    rate.at = at;
    if (rate.tokens < 1) return false;
    rate.tokens -= 1;
    return true;
  }

  function notify(peer, message) {
    try {
      peer?.send(JSON.stringify(message));
    } catch {
      // A failed send belongs to that transport's own close handling.
    }
  }

  function closeSession(session, reason = 'ended') {
    if (!sessions.has(session.id)) return;
    sessions.delete(session.id);
    clearTimer(session.hostTimer);
    for (const role of ['host', 'phone']) {
      const peer = session[role];
      session[role] = null;
      try {
        peer?.close(4000, reason);
      } catch {
        // Already closed.
      }
    }
    for (const waiter of session.frameWaiters.splice(0)) waiter(null);
    onSessionClosed(session);
  }

  function scheduleHostExpiry(session) {
    clearTimer(session.hostTimer);
    session.hostTimer = setTimer(() => {
      if (!session.host) closeSession(session, 'host-gone');
    }, HOST_GRACE_MS);
    session.hostTimer?.unref?.();
  }

  /** Create a session for the desktop; older sessions beyond the cap close. */
  function createSession() {
    while (sessions.size >= MAX_SESSIONS)
      closeSession(sessions.values().next().value, 'replaced');
    const session = {
      id: crypto.randomUUID(),
      hostKey: randomKey(),
      code: pairingCode(),
      phoneKey: null,
      failures: 0,
      host: null,
      phone: null,
      hostRate: bucket(),
      phoneRate: bucket(),
      frame: null,
      frameSeq: 0,
      frameWaiters: [],
      createdAt: now(),
    };
    sessions.set(session.id, session);
    scheduleHostExpiry(session);
    return session;
  }

  const sessionForHost = (hostKey) =>
    [...sessions.values()].find((s) => sameSecret(s.hostKey, hostKey)) || null;
  const sessionForPhone = (phoneKey) =>
    (phoneKey &&
      [...sessions.values()].find(
        (s) => s.phoneKey && sameSecret(s.phoneKey, phoneKey),
      )) ||
    null;

  /**
   * Exchange a pairing code for a phone key. A new join replaces the previous
   * phone. Wrong codes count against every session; enough of them rotate
   * the codes and tell the desktop to show the new one.
   *
   * @returns {{ ok: true, phoneKey: string, sessionId: string } | { ok: false, reason: string }}
   */
  function joinPhone(code) {
    const wanted = normalizeCode(code);
    const session =
      wanted.length === PAIRING_CODE_LENGTH
        ? [...sessions.values()].find((s) => sameSecret(s.code, wanted))
        : null;
    if (!session) {
      for (const candidate of sessions.values()) {
        candidate.failures += 1;
        if (candidate.failures >= MAX_CODE_FAILURES) {
          candidate.failures = 0;
          candidate.code = pairingCode();
          notify(candidate.host, { type: 'code', code: candidate.code });
        }
      }
      return { ok: false, reason: 'invalid-code' };
    }
    session.failures = 0;
    session.phoneKey = randomKey();
    if (session.phone) {
      const previous = session.phone;
      session.phone = null;
      try {
        previous.close(4001, 'replaced');
      } catch {
        // Already closed.
      }
    }
    return { ok: true, phoneKey: session.phoneKey, sessionId: session.id };
  }

  /** Attach a desktop transport; returns the session or null for a bad key. */
  function attachHost(hostKey, peer) {
    const session = sessionForHost(hostKey);
    if (!session) return null;
    const previous = session.host;
    session.host = peer;
    clearTimer(session.hostTimer);
    if (previous && previous !== peer) {
      try {
        previous.close(4001, 'replaced');
      } catch {
        // Already closed.
      }
    }
    notify(peer, { type: 'code', code: session.code });
    notify(peer, { type: 'peer', role: 'phone', connected: !!session.phone });
    return session;
  }

  /** Attach a phone transport; returns the session or null for a bad key. */
  function attachPhone(phoneKey, peer) {
    const session = sessionForPhone(phoneKey);
    if (!session) return null;
    const previous = session.phone;
    session.phone = peer;
    if (previous && previous !== peer) {
      try {
        previous.close(4001, 'replaced');
      } catch {
        // Already closed.
      }
    }
    notify(session.host, { type: 'peer', role: 'phone', connected: true });
    notify(peer, { type: 'peer', role: 'host', connected: !!session.host });
    return session;
  }

  /** Detach a transport if it is still the session's current one. */
  function detach(session, role, peer) {
    if (!session || session[role] !== peer) return;
    session[role] = null;
    const other = role === 'host' ? session.phone : session.host;
    notify(other, { type: 'peer', role, connected: false });
    if (role === 'host') scheduleHostExpiry(session);
  }

  /**
   * Forward one text message to the other peer. Refuses oversize, non-JSON
   * and over-rate input; the caller may close a peer that keeps sending it.
   *
   * @returns {boolean} Whether the message was admitted.
   */
  function relay(session, role, text) {
    if (!session || !sessions.has(session.id)) return false;
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_TEXT_BYTES)
      return false;
    if (!admit(role === 'host' ? session.hostRate : session.phoneRate))
      return false;
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return false;
    } catch {
      return false;
    }
    const target = role === 'host' ? session.phone : session.host;
    if (target) {
      try {
        target.send(text);
      } catch {
        // The target transport owns its own close handling.
      }
    }
    return true;
  }

  /** Hold the host's newest JPEG preview frame and wake waiting phones. */
  function publishFrame(session, bytes) {
    if (!session || !sessions.has(session.id)) return false;
    if (!Buffer.isBuffer(bytes) || !bytes.length) return false;
    if (bytes.length > MAX_FRAME_BYTES) return false;
    // JPEG start-of-image marker: the phone page only ever shows JPEG.
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
    session.frame = bytes;
    session.frameSeq += 1;
    for (const waiter of session.frameWaiters.splice(0)) waiter(session);
    return true;
  }

  /**
   * Resolve with the newest frame after `afterSeq`, waiting up to `waitMs`.
   * @returns {Promise<{ seq: number, bytes: Buffer } | null>}
   */
  function nextFrame(session, afterSeq, waitMs = 2000) {
    const current = () =>
      session.frame && session.frameSeq > afterSeq
        ? { seq: session.frameSeq, bytes: session.frame }
        : null;
    const ready = current();
    if (ready || waitMs <= 0) return Promise.resolve(ready);
    return new Promise((resolve) => {
      let timer = null;
      const waiter = (live) => {
        clearTimer(timer);
        resolve(live ? current() : null);
      };
      session.frameWaiters.push(waiter);
      timer = setTimer(() => {
        const index = session.frameWaiters.indexOf(waiter);
        if (index >= 0) session.frameWaiters.splice(index, 1);
        resolve(current());
      }, waitMs);
    });
  }

  return {
    createSession,
    joinPhone,
    attachHost,
    attachPhone,
    detach,
    relay,
    publishFrame,
    nextFrame,
    sessionForHost,
    sessionForPhone,
    closeSession,
    endSession(hostKey) {
      const session = sessionForHost(hostKey);
      if (session) closeSession(session, 'ended');
      return !!session;
    },
    get size() {
      return sessions.size;
    },
    closeAll() {
      for (const session of [...sessions.values()])
        closeSession(session, 'shutdown');
    },
  };
}
