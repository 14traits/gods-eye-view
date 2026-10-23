/**
 * A minimal promise wrapper over IndexedDB for the engine's own stores
 * (recorder segments, the last good situations snapshot). Every call fails
 * soft: no IndexedDB (private mode, insecure frames) resolves to null.
 */
const DB_NAME = 'gev-globe';
const DB_VERSION = 1;
export const STORES = Object.freeze(['seg', 'meta', 'kv']);

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = globalThis.indexedDB?.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    if (!req) {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES)
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function idbGet(store, key) {
  const db = await open();
  if (!db) return null;
  try {
    return await done(db.transaction(store).objectStore(store).get(key));
  } catch {
    return null;
  }
}

export async function idbPut(store, key, value) {
  const db = await open();
  if (!db) return false;
  try {
    await done(
      db.transaction(store, 'readwrite').objectStore(store).put(value, key),
    );
    return true;
  } catch {
    return false;
  }
}

/** Put many [key, value] pairs in one transaction. */
export async function idbPutMany(store, entries) {
  const db = await open();
  if (!db || !entries.length) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const [k, v] of entries) os.put(v, k);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** All [key, value] pairs with lower <= key (numeric keys). */
export async function idbEntries(store, lower = null) {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    const out = [];
    try {
      const range =
        lower == null ? null : globalThis.IDBKeyRange.lowerBound(lower);
      const req = db.transaction(store).objectStore(store).openCursor(range);
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.push([c.key, c.value]);
        c.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

/** Delete keys below `upper` (numeric keys). */
export async function idbDeleteBelow(store, upper) {
  const db = await open();
  if (!db) return false;
  try {
    await done(
      db
        .transaction(store, 'readwrite')
        .objectStore(store)
        .delete(globalThis.IDBKeyRange.upperBound(upper, true)),
    );
    return true;
  } catch {
    return false;
  }
}
