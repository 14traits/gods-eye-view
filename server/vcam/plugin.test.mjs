import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createVcamService, lanAddresses, PHONE_HEADERS } from './plugin.js';

/** The slice of a Vite server the service mounts on. */
function appServer() {
  const stack = [];
  const httpServer = http.createServer((req, res) => {
    const layer = stack.find(({ prefix }) => req.url.startsWith(prefix));
    if (!layer) {
      res.statusCode = 404;
      return res.end();
    }
    req.url = req.url.slice(layer.prefix.length) || '/';
    layer.handle(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  return {
    httpServer,
    middlewares: { use: (prefix, handle) => stack.push({ prefix, handle }) },
  };
}

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

function request(url, { method = 'GET', headers = {}, body, ca, checkServerIdentity } = {}) {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      { method, headers, ca, ...(checkServerIdentity ? { checkServerIdentity } : {}) },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Buffer a socket's messages from creation so back-to-back sends are never missed. */
const inboxes = new WeakMap();
function connect(url, options) {
  const ws = new WebSocket(url, options);
  const box = { queued: [], waiting: [] };
  inboxes.set(ws, box);
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const waiter = box.waiting.shift();
    if (waiter) waiter(message);
    else box.queued.push(message);
  });
  return ws;
}
function nextMessage(ws) {
  const box = inboxes.get(ws);
  if (box.queued.length) return Promise.resolve(box.queued.shift());
  return new Promise((resolve) => box.waiting.push(resolve));
}
const opened = (ws) =>
  new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });

async function harness(t) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-vcam-'));
  const service = createVcamService({
    env: {},
    cacheDir,
    port: 0,
    host: '127.0.0.1',
    // The phone reaches the listener on loopback in this test.
    addresses: () => ['127.0.0.1'],
    logger: {},
  });
  const app = appServer();
  service.install(app);
  await listen(app.httpServer);
  const appOrigin = `http://127.0.0.1:${app.httpServer.address().port}`;
  t.after(() => {
    service.destroy();
    app.httpServer.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
  const session = async () => {
    const response = await request(`${appOrigin}/api/vcam/session`, {
      method: 'POST',
      headers: { Origin: appOrigin },
    });
    assert.equal(response.status, 200);
    return JSON.parse(response.body);
  };
  const ca = () => fs.readFileSync(path.join(cacheDir, 'ca.crt'));
  return { service, appOrigin, session, ca };
}

test('the desktop pairs a phone over a trusted local CA and both legs relay', async (t) => {
  const { appOrigin, session, ca } = await harness(t);
  const created = await session();
  assert.equal(created.code.length, 6);
  assert.deepEqual(created.addresses, ['127.0.0.1']);
  const phoneOrigin = `https://127.0.0.1:${created.port}`;

  const page = await request(`${phoneOrigin}/`, { ca: ca() });
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /VIRTUAL CAMERA/);
  for (const [name, value] of Object.entries(PHONE_HEADERS))
    assert.equal(page.headers[name.toLowerCase()], value);
  assert.equal((await request(`${phoneOrigin}/api/vcam/session`, { method: 'POST', ca: ca() })).status, 404,
    'the phone listener exposes none of the desktop routes');
  const certificate = await request(`${phoneOrigin}/ca.crt`, { ca: ca() });
  assert.equal(certificate.headers['content-type'], 'application/x-x509-ca-cert');
  assert.equal(certificate.body.toString(), ca().toString());

  const host = connect(
    `ws://127.0.0.1:${new URL(appOrigin).port}/api/vcam/host?key=${created.hostKey}`,
    { origin: appOrigin },
  );
  const hostCode = nextMessage(host);
  await opened(host);
  assert.deepEqual(await hostCode, { type: 'code', code: created.code });
  await nextMessage(host); // phone not yet connected

  const join = await request(`${phoneOrigin}/api/join`, {
    method: 'POST', ca: ca(), body: JSON.stringify({ code: created.code }),
  });
  assert.equal(join.status, 200);
  const { phoneKey } = JSON.parse(join.body);
  const phone = connect(`wss://127.0.0.1:${created.port}/ws?key=${phoneKey}`, {
    ca: ca(), origin: phoneOrigin,
  });
  const hostSeesPhone = nextMessage(host);
  await opened(phone);
  assert.deepEqual(await hostSeesPhone, { type: 'peer', role: 'phone', connected: true });

  const pose = { type: 'pose', t: 1, q: [0, 0, 0, 1], p: [0, 1.5, 0] };
  const received = nextMessage(host);
  phone.send(JSON.stringify(pose));
  assert.deepEqual(await received, pose);
  await nextMessage(phone); // host presence
  const state = nextMessage(phone);
  host.send(JSON.stringify({ type: 'state', state: { recording: true } }));
  assert.deepEqual(await state, { type: 'state', state: { recording: true } });

  // The host's binary messages are preview frames the phone pulls over HTTPS.
  host.send(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7]));
  const frame = await request(`${phoneOrigin}/api/frame?after=0`, { ca: ca(), headers: { 'X-Vcam-Key': phoneKey } });
  assert.equal(frame.status, 200);
  assert.equal(frame.headers['content-type'], 'image/jpeg');
  assert.equal(frame.headers['x-frame-seq'], '1');
  assert.equal(frame.body.at(-1), 7);

  phone.close();
  host.close();
});

test('the HTTPS fallback relays poses by POST and state by server-sent events', async (t) => {
  const { appOrigin, session, ca } = await harness(t);
  const created = await session();
  const phoneOrigin = `https://127.0.0.1:${created.port}`;
  const host = connect(
    `ws://127.0.0.1:${new URL(appOrigin).port}/api/vcam/host?key=${created.hostKey}`,
    { origin: appOrigin },
  );
  await opened(host);
  const { phoneKey } = JSON.parse(
    (await request(`${phoneOrigin}/api/join`, { method: 'POST', ca: ca(), body: JSON.stringify({ code: created.code }) })).body,
  );
  const events = await new Promise((resolve) => {
    https.get(`${phoneOrigin}/api/events?key=${phoneKey}`, { ca: ca() }, resolve);
  });
  assert.equal(events.headers['content-type'], 'text/event-stream; charset=utf-8');
  const firstEvent = new Promise((resolve) => events.once('data', (chunk) => resolve(chunk.toString())));
  assert.match(await firstEvent, /^data: \{"type":"peer","role":"host","connected":true\}/);

  const relayed = [];
  const collect = async () => {
    for (;;) relayed.push(await nextMessage(host));
  };
  collect();
  const sent = await request(`${phoneOrigin}/api/send`, {
    method: 'POST', ca: ca(), headers: { 'X-Vcam-Key': phoneKey },
    body: JSON.stringify([{ type: 'cmd', cmd: 'record' }, { type: 'pose', t: 2 }, 'not an object']),
  });
  assert.deepEqual(JSON.parse(sent.body), { accepted: 2 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(relayed.filter(({ type }) => !['peer', 'code'].includes(type)), [{ type: 'cmd', cmd: 'record' }, { type: 'pose', t: 2 }]);

  const downstream = new Promise((resolve) => events.once('data', (chunk) => resolve(chunk.toString())));
  host.send(JSON.stringify({ type: 'toast', text: 'hi' }));
  assert.equal(await downstream, 'data: {"type":"toast","text":"hi"}\n\n');

  const ended = new Promise((resolve) => events.once('end', resolve));
  await request(`${appOrigin}/api/vcam/session`, { method: 'DELETE', headers: { Origin: appOrigin, 'X-Vcam-Host-Key': created.hostKey } });
  await ended;
  const after = await request(`${phoneOrigin}/api/send`, {
    method: 'POST', ca: ca(), headers: { 'X-Vcam-Key': phoneKey }, body: '[]',
  });
  assert.equal(after.status, 403, 'an ended session revokes the phone');
  host.close();
});

test('pairing refuses foreign origins, bad codes, bad keys and cross-site sockets', async (t) => {
  const { appOrigin, session, ca } = await harness(t);
  const noOrigin = await request(`${appOrigin}/api/vcam/session`, { method: 'POST' });
  assert.equal(noOrigin.status, 403, 'a session needs the page origin');
  const foreign = await request(`${appOrigin}/api/vcam/session`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  const proxied = await request(`${appOrigin}/api/vcam/session`, { method: 'POST', headers: { Origin: appOrigin, 'X-Forwarded-For': '1.2.3.4' } });
  assert.equal(proxied.status, 403);

  const created = await session();
  const phoneOrigin = `https://127.0.0.1:${created.port}`;
  const badJoin = await request(`${phoneOrigin}/api/join`, { method: 'POST', ca: ca(), body: '{"code":"222222"}' });
  assert.equal(badJoin.status, 403);
  const hugeJoin = await request(`${phoneOrigin}/api/join`, { method: 'POST', ca: ca(), body: 'x'.repeat(5000) }).catch(() => ({ status: 413 }));
  assert.equal(hugeJoin.status, 413);
  const badHost = await request(`${phoneOrigin}/`, {
    ca: ca(), headers: { Host: 'rebind.example' }, checkServerIdentity: () => undefined,
  });
  assert.equal(badHost.status, 421, 'the phone listener answers IP addresses and allowed hosts only');

  await assert.rejects(
    opened(new WebSocket(`ws://127.0.0.1:${new URL(appOrigin).port}/api/vcam/host?key=${created.hostKey}`, { origin: 'https://evil.example' })),
    /403/,
  );
  await assert.rejects(
    opened(new WebSocket(`ws://127.0.0.1:${new URL(appOrigin).port}/api/vcam/host?key=wrong`, { origin: appOrigin })),
    /403/,
  );
  const { phoneKey } = JSON.parse(
    (await request(`${phoneOrigin}/api/join`, { method: 'POST', ca: ca(), body: JSON.stringify({ code: created.code }) })).body,
  );
  await assert.rejects(
    opened(new WebSocket(`wss://127.0.0.1:${created.port}/ws?key=${phoneKey}`, { ca: ca(), origin: 'https://evil.example' })),
    /403/,
  );
  await assert.rejects(
    opened(new WebSocket(`wss://127.0.0.1:${created.port}/ws?key=wrong`, { ca: ca(), origin: phoneOrigin })),
    /403/,
  );
});

test('LAN addresses prefer private ranges and skip loopback and link-local', () => {
  assert.deepEqual(
    lanAddresses({
      lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      docker0: [{ family: 'IPv4', address: '172.17.0.1', internal: false }],
      en0: [
        { family: 'IPv6', address: 'fe80::1', internal: false },
        { family: 4, address: '192.168.1.23', internal: false },
      ],
      tun0: [{ family: 'IPv4', address: '100.64.0.2', internal: false }],
      bad: [{ family: 'IPv4', address: '169.254.3.3', internal: false }],
    }),
    ['192.168.1.23', '172.17.0.1', '100.64.0.2'],
  );
});
