/**
 * The Clerk (DESIGN.md §12.6): every few minutes it reads the Live lane and
 * posts "What chat is saying" into the Record, citing the chat lines it used.
 *
 * Prototype honesty: this is a local, deterministic summarizer (fixed rules
 * over keywords, corroborations and evidence flags), not an AI model. It
 * never states anything it cannot cite, and it keeps the cited lines inside
 * the summary so the receipts survive after chat scrolls away.
 */

import { canonical, sha256Hex } from '../capture/provenance.js';

const THEMES = [
  {
    id: 'aircraft',
    re: /\b(heli|helicopter|chopper|orbit|circling|police|news|ft|aviation|track|squawk|7700|gear|runway|final|holding)\b/i,
    label: 'the aircraft overhead',
  },
  {
    id: 'weather',
    re: /\b(rain|flash|lightning|thunder|gust|wind|pressure|eye|eyewall|storm|core|radar|flood|underpass)\b/i,
    label: 'the weather on the ground',
  },
  {
    id: 'scene',
    re: /\b(street|ave|st\b|floor|deck|corner|block|crowd|roof|banner|building|harbou?r|pier|ridge|road)\b/i,
    label: 'what people can see from the street',
  },
  {
    id: 'shaking',
    re: /\b(shak|rolling|aftershock|felt|rattled|swing)/i,
    label: 'the shaking people felt',
  },
  {
    id: 'sky',
    re: /\b(iss|pass|bright|satellite|clouds|launch|liftoff|pad|plume)\b/i,
    label: 'the sky',
  },
  {
    id: 'safety',
    re: /\b(safe|power|evac|ems|esu|rescue|fire trucks|medic|n95|aqi|gas)\b/i,
    label: 'safety',
  },
];
const DOUBT =
  /\b(fake|source\??|not a|unconfirmed|from 20\d\d|last (year|spring)|isn’t|isn't|not evidence|stop|overstates|doesn’t|doesn't)\b/i;
const EVIDENCE = /\b(seal|sealed|sealing|clip|photo|capture)\b/i;

const clip = (t, n = 90) => {
  const s = String(t || '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};
const rankOf = (m) =>
  (m.corro || 0) * 2 +
  (m.evidence ? 4 : 0) +
  (m.witness ? 2 : 0) +
  (m.tier?.index || 0) +
  (m.mod ? 1 : 0);

/**
 * @param {object[]} msgs chat lines in the window (oldest first), each
 *   { id, n, handle, text, at, corro?, evidence?, witness?, tier?, mod? }
 * @param {{ reactions?: Record<string, number>, viewers?: number, since?: number }} o
 * @returns {Promise<object|null>} a Clerk summary
 */
export async function summarize(msgs, o = {}) {
  const lines = msgs.filter((m) => m && m.text && !m.system);
  if (lines.length < 5) return null;
  const used = new Map(); // id → line
  const cite = (m) => {
    used.set(m.id, m);
    return m.id;
  };
  const bullets = [];

  // 1. What most of chat is about.
  const counts = THEMES.map((t) => ({
    t,
    hits: lines.filter((m) => t.re.test(m.text)),
  }))
    .filter((x) => x.hits.length >= 2)
    .sort((a, b) => b.hits.length - a.hits.length);
  if (counts[0]) {
    const top = counts[0];
    const best = [...top.hits]
      .sort((a, b) => rankOf(b) - rankOf(a))
      .slice(0, 2);
    bullets.push({
      kind: 'theme',
      text: `${top.hits.length} of ${lines.length} messages are about ${top.t.label}. Most-backed: “${clip(best[0].text, 80)}”${best[1] ? ` and “${clip(best[1].text, 60)}”` : ''}.`,
      cites: best.map(cite),
    });
  }
  if (counts[1]) {
    const x = counts[1];
    const best = [...x.hits].sort((a, b) => rankOf(b) - rankOf(a))[0];
    bullets.push({
      kind: 'theme',
      text: `Also: ${x.t.label} (${x.hits.length}), e.g. “${clip(best.text, 70)}”.`,
      cites: [cite(best)],
    });
  }

  // 2. Evidence offered, and whether it reached the Record.
  const ev = lines.filter(
    (m) => m.evidence || (EVIDENCE.test(m.text) && m.witness),
  );
  if (ev.length) {
    const promoted = ev.filter((m) => m.promoted);
    bullets.push({
      kind: 'evidence',
      text: `${ev.length} ${ev.length === 1 ? 'person says they have' : 'people say they have'} a sealed capture${promoted.length ? `; ${promoted.length} ${promoted.length === 1 ? 'is' : 'are'} now in the Record` : '; none is in the Record yet'}.`,
      cites: ev.slice(0, 3).map(cite),
    });
  }

  // 3. Disputes: doubt lines, strongest first.
  const doubt = lines
    .filter((m) => DOUBT.test(m.text))
    .sort((a, b) => rankOf(b) - rankOf(a));
  if (doubt.length)
    bullets.push({
      kind: 'disputed',
      text: `Pushback: “${clip(doubt[0].text, 90)}”${doubt.length > 1 ? ` (${doubt.length} skeptical messages)` : ''}.`,
      cites: doubt.slice(0, 2).map(cite),
    });

  // 4. Open questions.
  const qs = lines.filter((m) => /\?\s*$/.test(m.text) && !m.mod);
  if (qs.length)
    bullets.push({
      kind: 'question',
      text: `Unanswered in chat: “${clip(qs[qs.length - 1].text, 80)}”${qs.length > 1 ? ` and ${qs.length - 1} more` : ''}.`,
      cites: qs.slice(-2).map(cite),
    });

  // 5. Mood, from reactions (counted, not cited lines).
  const r = o.reactions || {};
  const rt = Object.values(r).reduce((a, b) => a + b, 0);
  if (rt)
    bullets.push({
      kind: 'mood',
      text: `Reactions: ${['heart', 'eyes', 'wow', 'fire']
        .filter((k) => r[k])
        .map(
          (k) =>
            `${r[k].toLocaleString()} ${k === 'eyes' ? 'eyes' : k === 'wow' ? 'wow' : k === 'fire' ? 'fire' : 'hearts'}`,
        )
        .join(
          ' · ',
        )}${o.viewers ? ` from ${o.viewers.toLocaleString()} watching` : ''}.`,
      cites: [],
    });

  if (!bullets.some((b) => b.cites.length)) return null;
  const quotes = [...used.values()].map((m) => ({
    id: m.id,
    n: m.n,
    handle: m.handle,
    text: m.text,
    at: m.at,
    sim: !!m.sim,
  }));
  const from = lines[0].at;
  const to = lines[lines.length - 1].at;
  const hash = await sha256Hex(
    canonical({
      from,
      to,
      ids: lines.map((m) => m.id),
      bullets: bullets.map((b) => b.text),
    }),
  ).catch(() => '00000000');
  return {
    id: `clerk-${to.toString(36)}`,
    kind: 'clerk',
    at: Date.now(),
    window: { from, to, n: lines.length },
    bullets,
    quotes,
    hash,
  };
}
