/**
 * Local certificate authority for the virtual-camera phone listener.
 *
 * Phones only expose camera tracking (WebXR, DeviceOrientation) to secure
 * contexts, so the LAN listener must speak HTTPS. A tapped-through
 * self-signed certificate is not enough on iOS: Safari loads the page but
 * refuses its WebSocket. Instead this module keeps one long-lived local CA,
 * which a phone can install and trust once, and issues the listener a short
 * server certificate for this machine's current LAN addresses.
 *
 * Certificates are encoded here with node:crypto (EC P-256, ECDSA-SHA256), so
 * no OpenSSL binary or dependency is needed. Keys never leave the cache
 * directory, which is git-ignored and outside the dev server's watcher.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';

const DAY_MS = 86400000;
// Apple rejects user-trusted TLS server certificates valid for over 825 days.
const SERVER_VALIDITY_DAYS = 397;
const CA_VALIDITY_DAYS = 3650;
// Reissue the server certificate this long before it expires.
const RENEW_MARGIN_DAYS = 30;

const length = (n) =>
  n < 0x80
    ? Buffer.from([n])
    : n < 0x100
      ? Buffer.from([0x81, n])
      : Buffer.from([0x82, n >> 8, n & 0xff]);
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const explicit = (n, ...parts) => tlv(0xa0 + n, ...parts);
const octets = (buffer) => tlv(0x04, buffer);
const bits = (buffer, unused = 0) => tlv(0x03, Buffer.from([unused]), buffer);
const boolean = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0]));
const utf8 = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
function integer(buffer) {
  let bytes = Buffer.from(buffer);
  while (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80))
    bytes = bytes.subarray(1);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(0x02, bytes);
}
function oid(dotted) {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * first + second];
  for (const part of rest) {
    const group = [part & 0x7f];
    for (let v = part >>> 7; v; v >>>= 7) group.unshift((v & 0x7f) | 0x80);
    bytes.push(...group);
  }
  return tlv(0x06, Buffer.from(bytes));
}
function time(date) {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  // RFC 5280: UTCTime through 2049, GeneralizedTime from 2050.
  return date.getUTCFullYear() < 2050
    ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`))
    : tlv(0x18, Buffer.from(`${iso}Z`));
}
const name = (commonName) =>
  sequence(
    set(sequence(oid('2.5.4.10'), utf8("God's Eye View"))),
    set(sequence(oid('2.5.4.3'), utf8(commonName))),
  );
const extension = (id, critical, value) =>
  sequence(oid(id), ...(critical ? [boolean(true)] : []), octets(value));
const ECDSA_SHA256 = sequence(oid('1.2.840.10045.4.3.2'));
const spkiOf = (publicKey) => publicKey.export({ type: 'spki', format: 'der' });
// RFC 5280 method 1: SHA-1 of the subjectPublicKey bit string's contents.
const keyIdentifier = (spki) =>
  crypto.createHash('sha1').update(spki.subarray(-65)).digest();

function subjectAltNames(names) {
  return sequence(
    ...names.map((entry) =>
      isIP(entry) === 4
        ? tlv(0x87, Buffer.from(entry.split('.').map(Number)))
        : tlv(0x82, Buffer.from(entry, 'ascii')),
    ),
  );
}

function sign({ subject, issuer, publicKey, signingKey, days, extensions }) {
  const now = Date.now();
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(crypto.randomBytes(16)),
    ECDSA_SHA256,
    issuer,
    sequence(time(new Date(now - DAY_MS)), time(new Date(now + days * DAY_MS))),
    subject,
    spkiOf(publicKey),
    explicit(3, sequence(...extensions)),
  );
  const signature = crypto.sign('sha256', tbs, signingKey);
  return sequence(tbs, ECDSA_SHA256, bits(signature));
}

const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n-----END ${label}-----\n`;
const keyPem = (key) => key.export({ type: 'pkcs8', format: 'pem' });

const CA_COMMON_NAME = "God's Eye View Local VCam CA";

/** Create a CA that may only sign server certificates (path length 0). */
export function createCertificateAuthority(commonName = CA_COMMON_NAME) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const subject = name(commonName);
  const der = sign({
    subject,
    issuer: subject,
    publicKey,
    signingKey: privateKey,
    days: CA_VALIDITY_DAYS,
    extensions: [
      extension(
        '2.5.29.19',
        true,
        sequence(boolean(true), integer(Buffer.from([0]))),
      ),
      // keyCertSign and cRLSign.
      extension('2.5.29.15', true, bits(Buffer.from([0x06]), 1)),
      extension('2.5.29.14', false, octets(keyIdentifier(spkiOf(publicKey)))),
    ],
  });
  return { cert: pem('CERTIFICATE', der), key: keyPem(privateKey) };
}

/** Issue a TLS server certificate for the given IP addresses and DNS names. */
export function issueServerCertificate(authority, names) {
  const caKey = crypto.createPrivateKey(authority.key);
  const caCert = new crypto.X509Certificate(authority.cert);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const caSpki = spkiOf(caCert.publicKey);
  const der = sign({
    subject: name(names[0]),
    issuer: name(caCert.subject.match(/CN=([^\n]+)/)?.[1] ?? CA_COMMON_NAME),
    publicKey,
    signingKey: caKey,
    days: SERVER_VALIDITY_DAYS,
    extensions: [
      extension('2.5.29.19', true, sequence()),
      // digitalSignature.
      extension('2.5.29.15', true, bits(Buffer.from([0x80]), 7)),
      extension('2.5.29.37', false, sequence(oid('1.3.6.1.5.5.7.3.1'))),
      extension('2.5.29.17', false, subjectAltNames(names)),
      extension('2.5.29.35', false, sequence(tlv(0x80, keyIdentifier(caSpki)))),
    ],
  });
  return { cert: pem('CERTIFICATE', der), key: keyPem(privateKey) };
}

function readPair(directory, base) {
  try {
    return {
      cert: fs.readFileSync(path.join(directory, `${base}.crt`), 'utf8'),
      key: fs.readFileSync(path.join(directory, `${base}.key`), 'utf8'),
    };
  } catch {
    return null;
  }
}

function writePair(directory, base, pair) {
  fs.writeFileSync(path.join(directory, `${base}.key`), pair.key, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(directory, `${base}.crt`), pair.cert);
}

function serverCertificateCovers(pair, authority, names) {
  try {
    const cert = new crypto.X509Certificate(pair.cert);
    if (!cert.verify(new crypto.X509Certificate(authority.cert).publicKey))
      return false;
    if (Date.parse(cert.validTo) - Date.now() < RENEW_MARGIN_DAYS * DAY_MS)
      return false;
    const listed = new Set(
      String(cert.subjectAltName || '')
        .split(',')
        .map((entry) => entry.trim().replace(/^(DNS|IP Address):/, '')),
    );
    return names.every((entry) => listed.has(entry));
  } catch {
    return false;
  }
}

/**
 * Load or create the cached CA and a server certificate covering `names`.
 * The CA survives restarts so a phone's one-time trust keeps working; the
 * server certificate is reissued when an address changes or it nears expiry.
 *
 * @param {string} directory - Cache directory, created with owner-only access.
 * @param {string[]} names - IPv4 addresses and DNS names; the first is the subject.
 * @returns {{ ca: string, cert: string, key: string, caFingerprint: string }}
 */
export function loadLocalCertificates(directory, names) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let authority = readPair(directory, 'ca');
  try {
    if (authority && !new crypto.X509Certificate(authority.cert).ca)
      authority = null;
  } catch {
    authority = null;
  }
  if (!authority) {
    authority = createCertificateAuthority();
    writePair(directory, 'ca', authority);
  }
  let server = readPair(directory, 'server');
  if (!server || !serverCertificateCovers(server, authority, names)) {
    server = issueServerCertificate(authority, names);
    writePair(directory, 'server', server);
  }
  return {
    ca: authority.cert,
    cert: server.cert,
    key: server.key,
    caFingerprint: new crypto.X509Certificate(authority.cert).fingerprint256,
  };
}
