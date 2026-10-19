/**
 * The person's own contributions as feed items: sealed captures, sealed live
 * bundles and (unverified) uploads, joined with the room posts they became.
 */

import { all, get } from '../capture/db.js';
import { distKm } from './bands.js';

const urlCache = new Map(); // id → object URL (kept for the session)

export async function mediaUrl(id, store = 'media') {
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await get(store, id).catch(() => null);
  const blob = rec?.blob;
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urlCache.set(id, u);
  return u;
}

export function lastFix(bundle) {
  const g = bundle?.session?.gps || [];
  const f = g[g.length - 1];
  return f && Number.isFinite(f.lat) ? f : null;
}

/** All local witness items, newest first. */
export async function localWitness({ rooms, situations = [] }) {
  const [caps, ups, posts] = await Promise.all([
    all('captures').catch(() => []),
    all('uploads').catch(() => []),
    rooms.myPosts().catch(() => []),
  ]);
  const allPosts = await rooms.allLocalPosts().catch(() => []);
  const byEvidence = new Map();
  for (const p of posts) {
    const k = p.evidence?.captureId || p.evidence?.uploadId;
    if (k) byEvidence.set(k, p);
  }
  const sitById = new Map(situations.map((s) => [String(s.id), s]));
  const out = [];
  for (const c of caps) {
    const post = byEvidence.get(c.id) || null;
    const s = post ? sitById.get(post.room) : null;
    const f = lastFix(c);
    const live = c.session?.mode === 'live';
    out.push({
      id: c.id,
      type: live ? 'live' : c.session?.mode === 'video' ? 'video' : 'capture',
      seq: c.seq,
      sealed: true,
      at: Date.parse(c.sealedAt),
      fix: f,
      acc: f?.acc,
      isVideo: /video/.test(c.media?.type || ''),
      url: await mediaUrl(c.id),
      bundle: c,
      post,
      situation: s,
      km: s && f ? distKm(f, s) : NaN,
      replies: post ? allPosts.filter((r) => r.replyTo === post.id).length : 0,
      title: post?.text
        ? post.text
        : live
          ? `Live broadcast · ${Math.round((c.session?.segments?.length || 0) * 10)} s sealed`
          : `Sealed ${/video/.test(c.media?.type || '') ? 'clip' : 'photo'} #${c.seq}`,
      sub: s
        ? `Posted to ${s.title}`
        : 'Not posted yet · tap to verify or post',
    });
  }
  for (const u of ups) {
    const post = byEvidence.get(u.id) || null;
    const s = post ? sitById.get(post.room) : null;
    out.push({
      id: u.id,
      type: 'upload',
      sealed: false,
      unverified: true,
      at: u.takenAt || u.addedAt,
      fix: Number.isFinite(u.lat) ? { lat: u.lat, lon: u.lon } : null,
      isVideo: /video/.test(u.type || ''),
      url: await mediaUrl(u.id, 'uploads'),
      upload: u,
      post,
      situation: s,
      km: s && Number.isFinite(u.lat) ? distKm(u, s) : NaN,
      replies: post ? allPosts.filter((r) => r.replyTo === post.id).length : 0,
      title: post?.text || u.name || 'Upload',
      sub: s ? `Posted to ${s.title} · Unverified` : 'Unverified upload',
    });
  }
  return out.sort((a, b) => b.at - a.at);
}
