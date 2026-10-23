/**
 * The social agent's mount points (rooms, chat, You) live in ./social.js.
 * Feature-detected: a checkout without it still builds and the shell shows
 * its own fallbacks. A glob (not a bare dynamic import) lets Vite pick the
 * file up as soon as it appears.
 */

let mod;
export function social() {
  if (mod !== undefined) return mod;
  const loaders = import.meta.glob('./social.js');
  const load = loaders['./social.js'];
  mod = load
    ? load().catch((err) => {
        console.warn('[social] social.js failed to load', err);
        return null;
      })
    : Promise.resolve(null);
  return mod;
}

/** Call an export if it exists; resolves to { ok, value }. */
export async function callSocial(name, ...args) {
  const m = await social();
  const fn = m?.[name];
  if (typeof fn !== 'function') return { ok: false };
  try {
    return { ok: true, value: await fn(...args) };
  } catch (err) {
    console.warn(`[social] ${name} failed`, err);
    return { ok: false, error: err };
  }
}
