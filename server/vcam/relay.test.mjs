import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FRAME_BYTES,
  MAX_TEXT_BYTES,
  PAIRING_CODE_LENGTH,
  createVcamRelay,
} from './relay.js';

function peer() {
  const sent = [];
  const closed = [];
  return {
    sent,
    closed,
    messages: () => sent.map((text) => JSON.parse(text)),
    send: (text) => sent.push(text),
    close: (code, reason) => closed.push([code, reason]),
  };
}

function clock() {
  let at = 0;
  const timers = new Set();
  return {
    now: () => at,
    advance(ms) {
      at += ms;
      for (const timer of [...timers])
        if (timer.due <= at) {
          timers.delete(timer);
          timer.fn();
        }
    },
    setTimer: (fn, ms) => {
      const timer = { fn, due: at + ms };
      timers.add(timer);
      return timer;
    },
    clearTimer: (timer) => timers.delete(timer),
  };
}

test('a phone pairs with the displayed code and relays both ways', () => {
  const relay = createVcamRelay();
  const session = relay.createSession();
  assert.equal(session.code.length, PAIRING_CODE_LENGTH);
  assert.match(session.code, /^[2-9A-HJKMNP-Z]+$/, 'no ambiguous characters');
  const host = peer();
  assert.equal(relay.attachHost(session.hostKey, host), session);
  assert.deepEqual(host.messages(), [
    { type: 'code', code: session.code },
    { type: 'peer', role: 'phone', connected: false },
  ]);
  const joined = relay.joinPhone(` ${session.code.toLowerCase().slice(0, 3)}-${session.code.slice(3)} `);
  assert.equal(joined.ok, true, 'codes are case- and separator-insensitive');
  const phone = peer();
  assert.equal(relay.attachPhone(joined.phoneKey, phone), session);
  assert.deepEqual(host.messages().at(-1), { type: 'peer', role: 'phone', connected: true });
  assert.ok(relay.relay(session, 'phone', '{"type":"pose","q":[0,0,0,1]}'));
  assert.equal(host.sent.at(-1), '{"type":"pose","q":[0,0,0,1]}');
  assert.ok(relay.relay(session, 'host', '{"type":"state"}'));
  assert.equal(phone.sent.at(-1), '{"type":"state"}');
  relay.detach(session, 'phone', phone);
  assert.deepEqual(host.messages().at(-1), { type: 'peer', role: 'phone', connected: false });
});

test('keys are per role and a new phone join replaces the previous phone', () => {
  const relay = createVcamRelay();
  const session = relay.createSession();
  assert.equal(relay.attachPhone(session.hostKey, peer()), null);
  assert.equal(relay.attachHost('nope', peer()), null);
  const first = relay.joinPhone(session.code);
  const phone = peer();
  relay.attachPhone(first.phoneKey, phone);
  const second = relay.joinPhone(session.code);
  assert.notEqual(first.phoneKey, second.phoneKey);
  assert.deepEqual(phone.closed, [[4001, 'replaced']]);
  assert.equal(relay.sessionForPhone(first.phoneKey), null, 'the old key is revoked');
});

test('wrong codes rotate the pairing code and tell the desktop', () => {
  const relay = createVcamRelay();
  const session = relay.createSession();
  const host = peer();
  relay.attachHost(session.hostKey, host);
  const original = session.code;
  for (let i = 0; i < 7; i++) assert.equal(relay.joinPhone('ZZZZZZ').ok, false);
  assert.equal(session.code, original);
  relay.joinPhone('ZZZZZZ');
  assert.notEqual(session.code, original);
  assert.deepEqual(host.messages().at(-1), { type: 'code', code: session.code });
  assert.equal(relay.joinPhone(original).ok, false, 'the old code no longer pairs');
  assert.equal(relay.joinPhone(session.code).ok, true);
});

test('oversize, non-object and over-rate messages are refused', () => {
  const time = clock();
  const relay = createVcamRelay(time);
  const session = relay.createSession();
  const host = peer();
  relay.attachHost(session.hostKey, host);
  const big = JSON.stringify({ type: 'x', pad: 'a'.repeat(MAX_TEXT_BYTES) });
  assert.equal(relay.relay(session, 'phone', big), false);
  assert.equal(relay.relay(session, 'phone', 'not json'), false);
  assert.equal(relay.relay(session, 'phone', '[1,2]'), false);
  let admitted = 0;
  for (let i = 0; i < 400; i++) if (relay.relay(session, 'phone', '{}')) admitted++;
  // The two malformed messages above already spent their tokens.
  assert.equal(admitted, 238, 'a burst is capped, malformed input included');
  time.advance(500);
  assert.equal(relay.relay(session, 'phone', '{}'), true, 'tokens refill over time');
});

test('the newest preview frame is pulled, not queued', async () => {
  const relay = createVcamRelay();
  const session = relay.createSession();
  const jpeg = (n) => Buffer.from([0xff, 0xd8, n]);
  assert.equal(relay.publishFrame(session, Buffer.from('GIF89a')), false, 'only JPEG');
  assert.equal(relay.publishFrame(session, Buffer.alloc(MAX_FRAME_BYTES + 1, 0xff)), false);
  assert.equal(await relay.nextFrame(session, 0, 0), null);
  const waiting = relay.nextFrame(session, 0, 5000);
  relay.publishFrame(session, jpeg(1));
  relay.publishFrame(session, jpeg(2));
  const first = await waiting;
  assert.equal(first.seq, 1);
  const latest = await relay.nextFrame(session, first.seq, 0);
  assert.equal(latest.seq, 2, 'a slow phone skips straight to the newest frame');
  assert.equal(latest.bytes[2], 2);
  relay.closeSession(session);
  assert.equal(relay.publishFrame(session, jpeg(3)), false);
});

test('a session outlives a desktop reload but not a departed desktop', () => {
  const time = clock();
  const closed = [];
  const relay = createVcamRelay({ ...time, onSessionClosed: (s) => closed.push(s.id) });
  const session = relay.createSession();
  const host = peer();
  relay.attachHost(session.hostKey, host);
  const phone = peer();
  relay.attachPhone(relay.joinPhone(session.code).phoneKey, phone);
  relay.detach(session, 'host', host);
  assert.deepEqual(phone.messages().at(-1), { type: 'peer', role: 'host', connected: false });
  time.advance(30000);
  relay.attachHost(session.hostKey, peer());
  time.advance(60000);
  assert.equal(relay.size, 1, 'a reattached host keeps the session');
  relay.detach(session, 'host', relay.sessionForHost(session.hostKey).host);
  time.advance(60001);
  assert.equal(relay.size, 0);
  assert.deepEqual(closed, [session.id]);
  assert.deepEqual(phone.closed, [[4000, 'host-gone']]);
});

test('ending a session closes both peers and only the host key can end it', () => {
  const relay = createVcamRelay();
  const session = relay.createSession();
  const phone = peer();
  relay.attachPhone(relay.joinPhone(session.code).phoneKey, phone);
  assert.equal(relay.endSession('wrong'), false);
  assert.equal(relay.endSession(session.hostKey), true);
  assert.deepEqual(phone.closed, [[4000, 'ended']]);
  for (let i = 0; i < 6; i++) relay.createSession();
  assert.equal(relay.size, 4, 'sessions are capped');
});
