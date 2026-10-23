/**
 * Instant first frame (DESIGN.md §12.8): the last good situations and their
 * thumbnails, so the feed paints before any live feed answers.
 *
 *   1. IndexedDB: the last live situations() result in this browser
 *   2. else the bundled snapshot, mobile/demo/snapshot.json (real data,
 *      captured by mobile/demo/capture-snapshot.mjs; see `capturedAt`)
 *
 * Thumbnails: the last rendered JPEG per situation id from the Cache API
 * (secure contexts), else the bundled mobile/demo/thumbs/<id>.jpg.
 */
import { idbGet, idbPut } from './idb.js';

const SNAPSHOT_URL = new URL('../demo/snapshot.json', import.meta.url).href;
const BUNDLED_THUMBS = import.meta.glob('../demo/thumbs/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
});
const LAST_CACHE = 'gev-thumbs-last-v1';
const cacheApi = () =>
  typeof caches !== 'undefined' && globalThis.isSecureContext;

const bundledThumb = new Map();
for (const [path, url] of Object.entries(BUNDLED_THUMBS)) {
  const id = decodeURIComponent(
    path
      .split('/')
      .pop()
      .replace(/\.jpg$/, ''),
  );
  bundledThumb.set(id, url);
}
const cachedThumb = new Map(); // id → blob: URL from the Cache API

export function thumbFileName(id) {
  return `${String(id).replace(/[^\w.-]+/g, '_')}.jpg`;
}

function bundledFor(id) {
  return (
    bundledThumb.get(thumbFileName(id).replace(/\.jpg$/, '')) ||
    bundledThumb.get(id) ||
    null
  );
}

/** Sync: the best cached thumbnail URL for a situation, or null. */
export function cachedThumbnail(situation) {
  const id = situation?.id;
  if (!id) return null;
  return cachedThumb.get(id) || bundledFor(id) || situation.thumbUrl || null;
}

/** Remember the last rendered thumbnail for an id (Cache API). */
export async function rememberThumbnail(id, blob) {
  if (!cacheApi() || !blob) return;
  try {
    const c = await caches.open(LAST_CACHE);
    await c.put(
      `${location.origin}/__gev-last/${encodeURIComponent(id)}`,
      new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }),
    );
  } catch {
    /* quota or private mode */
  }
}

async function hydrateThumbs(list) {
  if (!cacheApi()) return;
  try {
    const c = await caches.open(LAST_CACHE);
    await Promise.all(
      list.map(async (s) => {
        if (cachedThumb.has(s.id)) return;
        const hit = await c.match(
          `${location.origin}/__gev-last/${encodeURIComponent(s.id)}`,
        );
        if (hit) cachedThumb.set(s.id, URL.createObjectURL(await hit.blob()));
      }),
    );
  } catch {
    /* ignore */
  }
}

let bundledPromise = null;
function loadBundled() {
  if (!bundledPromise)
    bundledPromise = fetch(SNAPSHOT_URL)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  return bundledPromise;
}
// Start the bundled fetch at import so a cached call never waits on it.
loadBundled();

function decorate(list, capturedAt, origin) {
  return list.map((s) => ({
    ...s,
    cached: true,
    cacheOrigin: origin,
    capturedAt,
    live: false,
    thumbUrl: cachedThumb.get(s.id) || bundledFor(s.id) || s.thumbUrl || null,
  }));
}

/**
 * The last good situations, fast. Resolves [] only when there is nothing at
 * all (no IndexedDB snapshot and no bundled file).
 */
export async function loadCachedSituations() {
  const stored = await Promise.race([
    idbGet('kv', 'situations'),
    new Promise((r) => setTimeout(() => r(null), 60)),
  ]);
  if (stored?.list?.length) {
    hydrateThumbs(stored.list);
    return decorate(stored.list, stored.capturedAt, 'device');
  }
  const bundled = await loadBundled();
  if (bundled?.situations?.length)
    return decorate(
      bundled.situations,
      Date.parse(bundled.capturedAt) || bundled.capturedAt,
      'bundled',
    );
  return [];
}

/** Store a live situations() result as the next first frame. */
export function saveSituations(list) {
  if (!list?.length) return;
  const clean = list.map((s) => {
    const { thumbUrl, cached, cacheOrigin, ...rest } = s;
    void thumbUrl;
    void cached;
    void cacheOrigin;
    return rest;
  });
  idbPut('kv', 'situations', { capturedAt: Date.now(), list: clean }).catch(
    () => {},
  );
}

export const hasBundledThumb = (id) => Boolean(bundledFor(id));
