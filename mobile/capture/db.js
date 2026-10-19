/**
 * Minimal promise wrapper over the device's IndexedDB: signing keys, sealed
 * captures (+ media), and round two's room posts, uploads and small state.
 */

const DB_NAME = 'gev-mobile';
const DB_VERSION = 2;
let dbp = null;

export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys'))
        db.createObjectStore('keys', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('captures')) {
        const s = db.createObjectStore('captures', { keyPath: 'id' });
        s.createIndex('seq', 'seq');
      }
      if (!db.objectStoreNames.contains('media'))
        db.createObjectStore('media', { keyPath: 'id' });
      // v2: rooms and uploads.
      if (!db.objectStoreNames.contains('posts')) {
        const p = db.createObjectStore('posts', { keyPath: 'id' });
        p.createIndex('room', 'room');
      }
      if (!db.objectStoreNames.contains('uploads'))
        db.createObjectStore('uploads', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv'))
        db.createObjectStore('kv', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: let it, and reopen next time.
      db.onversionchange = () => {
        db.close();
        dbp = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, key) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await openDb();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

export async function del(store, key) {
  const db = await openDb();
  return wrap(
    db.transaction(store, 'readwrite').objectStore(store).delete(key),
  );
}

export async function all(store) {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

/** Write a capture bundle and its media atomically. */
export async function putCapture(bundle, mediaBlob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['captures', 'media'], 'readwrite');
    tx.objectStore('captures').put(bundle);
    tx.objectStore('media').put({ id: bundle.id, blob: mediaBlob });
    tx.oncomplete = () => resolve(bundle);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function lastCapture() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction('captures')
      .objectStore('captures')
      .index('seq')
      .openCursor(null, 'prev');
    req.onsuccess = () => resolve(req.result?.value || null);
    req.onerror = () => reject(req.error);
  });
}

export async function captureBySeq(seq) {
  const db = await openDb();
  return wrap(
    db.transaction('captures').objectStore('captures').index('seq').get(seq),
  );
}

export async function byIndex(store, index, key) {
  const db = await openDb();
  return wrap(
    db.transaction(store).objectStore(store).index(index).getAll(key),
  );
}
