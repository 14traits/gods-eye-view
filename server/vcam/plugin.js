/**
 * Virtual camera: lets a phone on the same network act as the app's camera.
 *
 * Two surfaces, deliberately separate:
 *
 * - On the app's own server (loopback only, behind the same gate as /mcp):
 *   `POST /api/vcam/session` creates a pairing session, `DELETE` ends it,
 *   `GET /api/vcam/ca.crt` downloads the local CA, and the desktop page joins
 *   its session over the `/api/vcam/host` WebSocket.
 * - A separate HTTPS listener on the LAN (VCAM_PORT, default 4174) that starts
 *   only when the desktop creates a session and stops after the last one
 *   ends. It serves the static phone page and the phone side of the relay
 *   and nothing else, so pairing a phone never exposes the app's provider
 *   proxies or API keys to the network.
 *
 * The phone transport prefers a WebSocket and falls back to plain HTTPS
 * requests (POST for poses, server-sent events for state), which work under
 * a tapped-through certificate warning where iOS refuses WebSockets.
 */
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { isAllowedHost } from '../../build/allowedHosts.js';
import { isSharingEnabled } from '../../src/keySetupCore.mjs';
import { isLocalMcpRequest } from '../mcp/plugin.js';
import { MAX_FRAME_BYTES, MAX_TEXT_BYTES, createVcamRelay } from './relay.js';
import { loadLocalCertificates } from './tls.js';

const PHONE_DIR = fileURLToPath(new URL('./phone/', import.meta.url));
const PHONE_FILES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/phone.js': ['phone.js', 'text/javascript; charset=utf-8'],
  '/orientation.js': ['orientation.js', 'text/javascript; charset=utf-8'],
  '/phone.css': ['phone.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
});
const DEFAULT_PORT = 4174;
const MAX_BATCH_BYTES = 64 * 1024;
const BODY_TIMEOUT_MS = 10000;
const SSE_KEEPALIVE_MS = 15000;
// The listener lingers after the last session in case the desktop reloads.
const IDLE_SHUTDOWN_MS = 120000;
const CA_CONTENT_TYPE = 'application/x-x509-ca-cert';

/** Headers for every phone-listener response; the page is static. */
export const PHONE_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "connect-src 'self' wss:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'xr-spatial-tracking=(self), camera=(self)',
});

/**
 * IPv4 addresses a phone on the same network could reach, private ranges
 * first (home and office Wi-Fi), then others. Loopback and link-local are
 * left out.
 */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const rank = (address) =>
    address.startsWith('192.168.')
      ? 0
      : address.startsWith('10.')
        ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(address)
          ? 2
          : 3;
  const found = [];
  for (const entries of Object.values(interfaces || {}))
    for (const entry of entries || []) {
      const family = entry.family === 4 ? 'IPv4' : entry.family;
      if (family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      if (!found.includes(entry.address)) found.push(entry.address);
    }
  return found.sort((a, b) => rank(a) - rank(b));
}

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('timeout'), { status: 408 }));
      req.destroy();
    }, BODY_TIMEOUT_MS);
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        clearTimeout(timer);
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Whether a desktop request may control pairing (loopback, same-origin). */
function isDesktopRequest(req, env, { requireOrigin = true } = {}) {
  if (requireOrigin && !req.headers.origin) return false;
  return isLocalMcpRequest({
    remoteAddress: req.socket?.remoteAddress,
    localPort: req.socket?.localPort,
    host: req.headers.host || '',
    origin: req.headers.origin,
    headers: req.headers,
    env,
  });
}

/**
 * Create the virtual-camera service: the relay, the lazily started phone
 * listener and the handlers both servers mount.
 */
export function createVcamService({
  env = process.env,
  cacheDir = path.join(process.cwd(), '.gev-cache', 'vcam'),
  port = Number.parseInt(env.VCAM_PORT, 10) || DEFAULT_PORT,
  host = env.VCAM_HOST || '0.0.0.0',
  addresses = () => lanAddresses(),
  allowedHosts = [],
  logger = console,
} = {}) {
  let listener = null;
  let listenerNames = '';
  let starting = null;
  let idleTimer = null;
  let certificates = null;
  const relay = createVcamRelay({
    onSessionClosed: () => {
      if (relay.size === 0) scheduleIdleShutdown();
    },
  });
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });

  function scheduleIdleShutdown() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (relay.size === 0) stopListener();
    }, IDLE_SHUTDOWN_MS);
    idleTimer.unref?.();
  }

  function stopListener() {
    const current = listener;
    listener = null;
    listenerNames = '';
    current?.closeAllConnections?.();
    current?.close();
  }

  /** Start (or restart for a changed address) the HTTPS phone listener. */
  async function ensureListener(requested) {
    clearTimeout(idleTimer);
    const names = [...new Set(requested)];
    const key = names.join(',');
    if (listener && listenerNames === key) return;
    if (starting) await starting.catch(() => {});
    if (listener && listenerNames === key) return;
    stopListener();
    certificates = loadLocalCertificates(cacheDir, names);
    const server = https.createServer(
      { cert: certificates.cert, key: certificates.key },
      (req, res) => handlePhoneRequest(req, res),
    );
    server.on('upgrade', (req, socket, head) =>
      handlePhoneUpgrade(req, socket, head),
    );
    server.on('clientError', (_error, socket) => socket.destroy());
    starting = new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    try {
      await starting;
    } finally {
      starting = null;
    }
    listener = server;
    listenerNames = key;
    logger.info?.(
      `[vcam] phone listener on https://${names[0]}:${port}/ (pairing session only)`,
    );
  }

  const phoneHostAllowed = (req) =>
    isAllowedHost(req.headers.host, allowedHosts);

  function servePhoneFile(req, res, pathname) {
    const entry = PHONE_FILES[pathname];
    if (!entry) return false;
    const [file, type] = entry;
    let body;
    try {
      body = fs.readFileSync(path.join(PHONE_DIR, file));
    } catch {
      json(res, 500, { error: 'phone page unavailable' });
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  function sendCa(res) {
    res.statusCode = 200;
    res.setHeader('Content-Type', CA_CONTENT_TYPE);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="gods-eye-view-vcam-ca.crt"',
    );
    res.end(certificates?.ca || '');
  }

  function phoneSession(req, url) {
    const key = req.headers['x-vcam-key'] || url.searchParams.get('key');
    return relay.sessionForPhone(key);
  }

  async function handlePhoneRequest(req, res) {
    for (const [name, value] of Object.entries(PHONE_HEADERS))
      res.setHeader(name, value);
    if (!phoneHostAllowed(req)) return json(res, 421, { error: 'bad host' });
    let url;
    try {
      url = new URL(req.url, 'https://phone.invalid');
    } catch {
      return json(res, 400, { error: 'bad request' });
    }
    const { pathname } = url;
    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (servePhoneFile(req, res, pathname)) return;
        if (pathname === '/ca.crt') return sendCa(res);
      }
      if (pathname === '/api/join' && req.method === 'POST') {
        let code = '';
        try {
          code = JSON.parse(await readBody(req, 1024))?.code;
        } catch (error) {
          if (error?.status) throw error;
        }
        const joined = relay.joinPhone(code);
        if (!joined.ok) return json(res, 403, { error: joined.reason });
        return json(res, 200, {
          phoneKey: joined.phoneKey,
          sessionId: joined.sessionId,
          limits: { text: MAX_TEXT_BYTES },
        });
      }
      if (pathname === '/api/send' && req.method === 'POST') {
        const session = phoneSession(req, url);
        if (!session) return json(res, 403, { error: 'unpaired' });
        let messages;
        try {
          messages = JSON.parse(await readBody(req, MAX_BATCH_BYTES));
        } catch (error) {
          if (error?.status) throw error;
          return json(res, 400, { error: 'expected a JSON array' });
        }
        if (!Array.isArray(messages) || messages.length > 64)
          return json(res, 400, { error: 'expected a JSON array' });
        let accepted = 0;
        for (const message of messages)
          if (relay.relay(session, 'phone', JSON.stringify(message)))
            accepted += 1;
        return json(res, 200, { accepted });
      }
      if (pathname === '/api/events' && req.method === 'GET')
        return openEventStream(req, res, phoneSession(req, url));
      if (pathname === '/api/frame' && req.method === 'GET') {
        const session = phoneSession(req, url);
        if (!session) return json(res, 403, { error: 'unpaired' });
        const after = Number.parseInt(url.searchParams.get('after'), 10) || 0;
        const frame = await relay.nextFrame(session, after, 2000);
        if (!frame) {
          res.statusCode = 204;
          return res.end();
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('X-Frame-Seq', String(frame.seq));
        return res.end(frame.bytes);
      }
      json(res, 404, { error: 'not found' });
    } catch (error) {
      if (!res.headersSent)
        json(res, error?.status || 500, { error: 'request failed' });
      else res.end();
    }
  }

  function openEventStream(req, res, session) {
    if (!session) return json(res, 403, { error: 'unpaired' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const keepAlive = setInterval(
      () => res.write(': keep-alive\n\n'),
      SSE_KEEPALIVE_MS,
    );
    const peer = {
      send: (text) => res.write(`data: ${text}\n\n`),
      close: () => res.end(),
    };
    const attached = relay.attachPhone(
      req.headers['x-vcam-key'] ||
        new URL(req.url, 'https://phone.invalid').searchParams.get('key'),
      peer,
    );
    if (!attached) {
      clearInterval(keepAlive);
      return res.end();
    }
    req.on('close', () => {
      clearInterval(keepAlive);
      relay.detach(attached, 'phone', peer);
    });
  }

  function refuseUpgrade(socket, status) {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  }

  function handlePhoneUpgrade(req, socket, head) {
    let url;
    try {
      url = new URL(req.url, 'https://phone.invalid');
    } catch {
      return refuseUpgrade(socket, '400 Bad Request');
    }
    if (url.pathname !== '/ws' || !phoneHostAllowed(req))
      return refuseUpgrade(socket, '404 Not Found');
    // A WebSocket is not subject to CORS: only this page's own origin may open one.
    if (req.headers.origin !== `https://${req.headers.host}`)
      return refuseUpgrade(socket, '403 Forbidden');
    const key = url.searchParams.get('key');
    if (!relay.sessionForPhone(key))
      return refuseUpgrade(socket, '403 Forbidden');
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const peer = {
        send: (text) => ws.readyState === ws.OPEN && ws.send(text),
        close: (code, reason) => ws.close(code, reason),
      };
      const session = relay.attachPhone(key, peer);
      if (!session) return ws.close(4003, 'unpaired');
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        relay.relay(session, 'phone', data.toString('utf8'));
      });
      ws.on('close', () => relay.detach(session, 'phone', peer));
      ws.on('error', () => ws.terminate());
    });
  }

  /** Mount the desktop routes on the app's own (dev or preview) server. */
  function install(server) {
    server.middlewares.use('/api/vcam', async (req, res, next) => {
      const pathname = (req.url || '/').split('?')[0];
      try {
        if (pathname === '/ca.crt' && req.method === 'GET') {
          if (!isDesktopRequest(req, env, { requireOrigin: false }))
            return json(res, 403, { error: 'local only' });
          if (!certificates)
            certificates = loadLocalCertificates(cacheDir, [
              ...addresses(),
              'localhost',
              '127.0.0.1',
            ]);
          return sendCa(res);
        }
        if (pathname !== '/session') return next();
        if (!isDesktopRequest(req, env))
          return json(res, 403, { error: 'local only' });
        if (isSharingEnabled(env))
          return json(res, 403, { error: 'sharing is enabled' });
        if (req.method === 'POST') {
          const lan = addresses();
          if (!lan.length)
            return json(res, 503, {
              error: 'no network address',
              code: 'no-network',
            });
          try {
            await ensureListener([...lan, 'localhost', '127.0.0.1']);
          } catch (error) {
            return json(res, 503, {
              error: 'phone listener unavailable',
              code: error?.code === 'EADDRINUSE' ? 'port-in-use' : 'listen',
              port,
            });
          }
          const session = relay.createSession();
          return json(res, 200, {
            sessionId: session.id,
            hostKey: session.hostKey,
            code: session.code,
            port: listener.address()?.port ?? port,
            addresses: lan,
            caFingerprint: certificates.caFingerprint,
          });
        }
        if (req.method === 'DELETE') {
          relay.endSession(req.headers['x-vcam-host-key']);
          return json(res, 200, { ended: true });
        }
        return json(res, 405, { error: 'method not allowed' });
      } catch {
        if (!res.headersSent) json(res, 500, { error: 'request failed' });
      }
    });

    server.httpServer?.on('upgrade', (req, socket, head) => {
      let url;
      try {
        url = new URL(req.url, 'http://local.invalid');
      } catch {
        return;
      }
      if (url.pathname !== '/api/vcam/host') return;
      // Browsers always send Origin on a WebSocket; it must be this app.
      if (!isDesktopRequest(req, env))
        return refuseUpgrade(socket, '403 Forbidden');
      const key = url.searchParams.get('key');
      if (!relay.sessionForHost(key))
        return refuseUpgrade(socket, '403 Forbidden');
      sockets.handleUpgrade(req, socket, head, (ws) => {
        const peer = {
          send: (text) => ws.readyState === ws.OPEN && ws.send(text),
          close: (code, reason) => ws.close(code, reason),
        };
        const session = relay.attachHost(key, peer);
        if (!session) return ws.close(4003, 'unknown session');
        ws.on('message', (data, isBinary) => {
          if (isBinary) relay.publishFrame(session, Buffer.from(data));
          else relay.relay(session, 'host', data.toString('utf8'));
        });
        ws.on('close', () => relay.detach(session, 'host', peer));
        ws.on('error', () => ws.terminate());
      });
    });
    server.httpServer?.once('close', () => destroy());
  }

  function destroy() {
    clearTimeout(idleTimer);
    relay.closeAll();
    stopListener();
    sockets.close();
  }

  return {
    install,
    destroy,
    relay,
    ensureListener,
    get listening() {
      return !!listener;
    },
    get port() {
      return listener?.address()?.port ?? port;
    },
  };
}

/** Vite plugin mounting the virtual-camera desktop routes and phone listener. */
export function vcamPlugin(options = {}) {
  let service = null;
  const install = (server) => {
    service ??= createVcamService({
      allowedHosts: server.config?.server?.allowedHosts || [],
      logger: server.config?.logger || console,
      ...options,
    });
    service.install(server);
  };
  return {
    name: 'gev-vcam',
    configureServer: install,
    configurePreviewServer: install,
  };
}
