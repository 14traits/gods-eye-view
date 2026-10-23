/**
 * Signal (DESIGN.md §12.2): reputation for being right, early, with
 * receipts. It rises when sealed captures are corroborated (cited by
 * others, matched by sensor data), when a Need eyes request is fulfilled
 * and when a note you rated ends up bridged; it falls when your claims are
 * corrected. Every change is a receipt with its reason and its source, so
 * the score is never a mystery. Follower counts do not exist.
 *
 * Simulated participants get a deterministic tier from their handle, so the
 * chat's colours and vote weights are stable across reloads.
 */

import { emitter } from './dom.js';
import { get, put } from '../capture/db.js';

export const TIERS = [
  { id: 'new', name: 'New eyes', min: 0, color: '#a7b0bb', weight: 1 },
  { id: 'observer', name: 'Observer', min: 100, color: '#8fd0ff', weight: 1.2 },
  { id: 'spotter', name: 'Spotter', min: 300, color: '#6fe3b4', weight: 1.5 },
  {
    id: 'corroborated',
    name: 'Corroborated',
    min: 700,
    color: '#f2c96d',
    weight: 1.9,
  },
  { id: 'anchor', name: 'Anchor', min: 1500, color: '#c7a6ff', weight: 2.4 },
];

/** What each kind of receipt is worth, in the open. */
export const RULES = [
  { id: 'sealed', delta: 10, text: 'You posted a sealed capture to a room' },
  { id: 'there', delta: 15, text: 'Your capture was inside the event radius' },
  {
    id: 'sensor',
    delta: 20,
    text: 'Sensor data matched your capture (ADS-B, radar, quakes)',
  },
  { id: 'first', delta: 50, text: 'First eyes: the first sealed capture' },
  { id: 'fulfil', delta: 40, text: 'You fulfilled a Need eyes request' },
  {
    id: 'corroborated',
    delta: 3,
    text: 'Someone corroborated your post (× their Signal weight)',
  },
  {
    id: 'note',
    delta: 5,
    text: 'A note you rated helpful became bridged',
  },
  { id: 'promoted', delta: 8, text: 'Your chat message was promoted' },
  {
    id: 'corrected',
    delta: -25,
    text: 'A bridged correction showed your claim was wrong',
  },
  {
    id: 'disputed',
    delta: -5,
    text: 'An unverified upload you posted was disputed',
  },
];
export const RULE = Object.fromEntries(RULES.map((r) => [r.id, r]));

export function tierOf(score = 0) {
  let i = 0;
  for (let k = 0; k < TIERS.length; k += 1) if (score >= TIERS[k].min) i = k;
  const tier = TIERS[i];
  const next = TIERS[i + 1] || null;
  const progress = next
    ? (score - tier.min) / Math.max(1, next.min - tier.min)
    : 1;
  return {
    ...tier,
    index: i,
    next,
    progress: Math.max(0, Math.min(1, progress)),
  };
}

export function hashStr(s) {
  let x = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1)
    x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return x >>> 0;
}

/**
 * A stable simulated Signal score for a fictional handle. Personas can pin
 * a minimum (moderators and domain experts are rarely New eyes).
 */
export function simScore(handle, floor = 0) {
  const h = hashStr(handle);
  // Skewed: most chatters are New eyes or Observers, few are Anchors.
  const u = (h % 1000) / 1000;
  const raw = Math.round(1900 * u ** 2.3);
  return Math.max(floor, raw);
}

export function simTier(handle, floor = 0) {
  return tierOf(simScore(handle, floor));
}

/** Vote weight shown next to a corroboration: "× 1.5". */
export const weightOf = (score) => tierOf(score).weight;

export function createSignal({ me } = {}) {
  const ev = emitter();
  let st = null; // Promise<{ id, receipts: [] }>

  const load = () =>
    (st =
      st ||
      get('kv', 'signal')
        .catch(() => null)
        .then((r) => r || { id: 'signal', receipts: [] }));

  async function save() {
    const s = await load();
    await put('kv', s).catch(() => {});
  }

  async function receipts() {
    const s = await load();
    return [...s.receipts].sort((a, b) => b.at - a.at);
  }

  async function score() {
    const s = await load();
    return Math.max(
      0,
      Math.round(s.receipts.reduce((a, r) => a + (r.delta || 0), 0)),
    );
  }

  /**
   * Record a receipt. Idempotent by id, so replays never double count.
   * @param {{ id: string, rule: string, delta?: number, text: string,
   *   ref?: object, source?: string }} r
   */
  async function award(r) {
    const s = await load();
    if (s.receipts.some((x) => x.id === r.id)) return null;
    const before = await score();
    const rec = {
      at: Date.now(),
      delta: r.delta ?? RULE[r.rule]?.delta ?? 0,
      ...r,
    };
    s.receipts.push(rec);
    await save();
    const after = await score();
    const t0 = tierOf(before);
    const t1 = tierOf(after);
    const out = {
      receipt: rec,
      before,
      after,
      tier: t1,
      up: t1.index > t0.index,
    };
    ev.emit('change', out);
    return out;
  }

  /** The person's tier right now (sync best effort for rendering). */
  let cached = 0;
  score().then((v) => (cached = v));
  ev.on('change', (o) => (cached = o.after));

  return {
    on: ev.on,
    off: ev.off,
    receipts,
    score,
    award,
    get cached() {
      return cached;
    },
    tier: () => tierOf(cached),
    me,
  };
}
