/**
 * Threads: reconstructions people build together, always in three strata —
 * Observations (immutable, sourced, hashed) → Hypotheses (person / AI,
 * confidence, citations, agree / dispute) → Narrative (a camera path through
 * space and time). Every change lands in a hash-chained ledger.
 */

import { icon } from './icons.js';
import {
  $,
  $$,
  esc,
  ago,
  haptic,
  toast,
  fmtCoord,
  reducedMotion,
} from './dom.js';
import { canonical, sha256Hex } from '../capture/provenance.js';
import { loadEventPack } from './world.js';
import { KIND } from './rooms.js';
import { avatar } from './cards.js';
import { BAND_NAME, bandOf, fmtKm } from './bands.js';

const LOCAL_KEY = 'gev.mobile.threads.local.v1';
const DRAFTS_KEY = 'gev.mobile.threads.drafts.v1';

function readLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Thread models                                                       */
/* ------------------------------------------------------------------ */

/** Example hypotheses: fictional authors, written to show the format. */
const EXAMPLE_HYPOTHESES = [
  {
    id: 'H1',
    author: { kind: 'person', handle: '@rivergauge_example' },
    at: '2026-08-28T09:12:00Z',
    text: 'The outburst began at the debris-dammed lake (O2) after the second landslide (O3) loaded the dam.',
    confidence: 0.7,
    cites: ['O2', 'O3'],
    agree: 12,
    dispute: 3,
  },
  {
    id: 'H2',
    author: { kind: 'ai', handle: 'AI · example model' },
    at: '2026-08-28T11:40:00Z',
    text: 'Treat the Timure cluster (O5) as one timing observation: it groups five map placements, not five independent timings.',
    confidence: 0.55,
    cites: ['O5'],
    agree: 8,
    dispute: 0,
    prompt: 'Which observations are not independent for timing?',
  },
  {
    id: 'H3',
    author: { kind: 'person', handle: '@northbank_example' },
    at: '2026-08-29T06:05:00Z',
    text: 'The Rasuwagadhi witness clip (W1) was filmed from the north bank, upstream of the border gate (O4).',
    confidence: 0.4,
    cites: ['W1', 'O4'],
    agree: 4,
    dispute: 5,
  },
];

async function bhoteThread() {
  const pack = await loadEventPack();
  const obs = [];
  obs.push({
    id: 'B0',
    title: 'Historical reference image',
    phase: 'imagery',
    lat: (pack.imagery.rectangle.north + pack.imagery.rectangle.south) / 2,
    lon: (pack.imagery.rectangle.east + pack.imagery.rectangle.west) / 2,
    source: pack.imagery.before.source,
    via: 'Vantor Open Data Program',
    time: pack.imagery.before.observedAt,
    timeConf: 'acquisition date',
    locConf: 'orthorectified scene',
    url: '/events/bhote-koshi-2026/pre.webp',
    record: pack.imagery.before,
  });
  obs.push({
    id: 'A0',
    title: 'Post-event image',
    phase: 'imagery',
    lat: obs[0].lat,
    lon: obs[0].lon,
    source: pack.imagery.after.source,
    via: 'Vantor Open Data Program',
    time: pack.imagery.after.observedAt,
    timeConf: 'acquisition date',
    locConf: 'orthorectified scene',
    url: '/events/bhote-koshi-2026/post.webp',
    record: pack.imagery.after,
  });
  for (const w of pack.witnessAnchors) {
    obs.push({
      id: 'W1',
      title: 'Rasuwagadhi witness video',
      phase: 'witness',
      lat: w.lat,
      lon: w.lon,
      source: 'IndoWatchOSINT post (GeoConfirmed)',
      via: w.provenance,
      time: null,
      timeConf: 'capture time unverified',
      locConf: 'source geoconfirmed',
      url: w.sourceUrl,
      record: w,
    });
  }
  for (const e of pack.evidenceSpine) {
    obs.push({
      id: `O${e.sequence}`,
      seq: e.sequence,
      title: e.title,
      summary: e.summary,
      phase: e.phase,
      lat: e.lat,
      lon: e.lon,
      source: `${e.media?.platform || 'Source'} post`,
      via: e.provenance?.via,
      time: e.timing?.capturedAt,
      timeConf: e.timing?.note || e.confidence?.time,
      locConf: e.confidence?.location,
      url: e.media?.sourceUrl,
      poster: e.media?.posterUrl,
      progress: e.trigger?.storyProgress,
      rights: e.media?.rightsStatus,
      record: e,
    });
  }
  obs.push({
    id: 'C1',
    title: 'River centreline corridor',
    phase: 'geometry',
    lat: pack.reconstruction.corridor[0].lat,
    lon: pack.reconstruction.corridor[0].lon,
    source: 'GeoPera reconstruction (commit 59ee5bd)',
    via: `${pack.reconstruction.corridor.length} points, every fourth published point inside the image bounds`,
    time: null,
    timeConf: 'not a modelled arrival time',
    locConf: 'published centreline',
    record: { corridor: pack.reconstruction.corridor },
  });
  for (const o of obs) o.hash = await sha256Hex(canonical(o.record));
  const steps = pack.evidenceSpine.map((e) => ({
    id: `O${e.sequence}`,
    title: e.shortTitle || e.title,
    phase: e.phase,
    lat: e.lat,
    lon: e.lon,
    elev: e.fallbackElevationM,
    progress: e.trigger?.storyProgress ?? 0,
  }));
  return {
    id: pack.id,
    real: true,
    title: pack.title,
    place: 'Rasuwa, Nepal ↔ Gyirong, Tibet',
    observedDate: pack.observedDate,
    created: `${pack.observedDate}T00:00:00Z`,
    caveat: pack.reconstruction.caveat,
    label: pack.reconstruction.label,
    elapsedSeconds: pack.reconstruction.elapsedSeconds,
    license:
      'CC BY-NC 4.0 · GeoPera · Vantor Open Data · GeoGeorgeShadrach map',
    before: '/events/bhote-koshi-2026/pre.webp',
    after: '/events/bhote-koshi-2026/post.webp',
    viewpoint: pack.viewpoints.corridor,
    corridor: pack.reconstruction.corridor,
    observations: obs,
    hypotheses: EXAMPLE_HYPOTHESES.map((x) => ({ ...x, example: true })),
    steps,
  };
}

async function draftThread(d) {
  const o = {
    id: 'O1',
    title: d.title,
    phase: 'situation snapshot',
    lat: d.lat,
    lon: d.lon,
    source: d.source || 'Live feed',
    via: 'Snapshot when the thread was started',
    time: d.createdAt,
    timeConf: 'snapshot time',
    locConf: 'feed position',
    record: d.snapshot || d,
  };
  o.hash = await sha256Hex(canonical(o.record));
  return {
    id: d.id,
    real: false,
    draft: true,
    title: d.title,
    place: d.place,
    created: d.createdAt,
    observations: [o],
    hypotheses: [],
    steps: [{ id: 'O1', title: d.title, lat: d.lat, lon: d.lon, progress: 0 }],
  };
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

async function buildLedger(thread, local) {
  const entries = [];
  const push = async (type, actor, at, payload) => {
    const prev = entries.length ? entries[entries.length - 1].hash : null;
    const payloadHash = await sha256Hex(canonical(payload));
    const seq = entries.length;
    const hash = await sha256Hex(
      canonical({ seq, at, type, actor, payloadHash, prev }),
    );
    entries.push({ seq, at, type, actor, payload, payloadHash, prev, hash });
  };
  await push(
    'thread.create',
    thread.real ? 'event pack' : 'you (this device)',
    thread.created,
    { id: thread.id, title: thread.title, license: thread.license || null },
  );
  for (const o of thread.observations)
    await push('observation.add', o.source, o.time || thread.created, {
      id: o.id,
      title: o.title,
      recordHash: o.hash,
    });
  for (const hy of [...thread.hypotheses, ...(local.proposals || [])]) {
    await push(
      hy.author.kind === 'ai'
        ? hy.simulated
          ? 'ai.proposal'
          : 'hypothesis.propose'
        : 'hypothesis.propose',
      hy.author.handle,
      hy.at,
      {
        id: hy.id,
        text: hy.text,
        cites: hy.cites,
        confidence: hy.confidence,
        example: hy.example || undefined,
        ...(hy.simulated
          ? {
              prompt: hy.prompt,
              model: hy.model,
              inputs: hy.inputs,
              simulated: true,
            }
          : {}),
      },
    );
  }
  for (const v of local.votes || [])
    await push(`vote.${v.kind}`, 'you (this device)', v.at, {
      hypothesis: v.id,
    });
  return entries;
}

async function verifyLedger(entries) {
  let prev = null;
  for (const e of entries) {
    const ph = await sha256Hex(canonical(e.payload));
    const hh = await sha256Hex(
      canonical({
        seq: e.seq,
        at: e.at,
        type: e.type,
        actor: e.actor,
        payloadHash: ph,
        prev,
      }),
    );
    if (ph !== e.payloadHash || hh !== e.hash || e.prev !== prev)
      return { ok: false, at: e.seq };
    prev = e.hash;
  }
  return { ok: true, n: entries.length, head: prev };
}

/* ------------------------------------------------------------------ */
/* Simulated AI refinement (no network)                                */
/* ------------------------------------------------------------------ */

function simulateRefinement(thread, prompt) {
  const words = prompt.toLowerCase().match(/[a-z]{4,}/g) || [];
  const scored = thread.observations
    .map((o) => {
      const hay = `${o.title} ${o.summary || ''} ${o.phase}`.toLowerCase();
      return { o, s: words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0) };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.o);
  const cites = scored.length ? scored : thread.observations.slice(0, 2);
  const anchors = cites
    .map((o) => `${o.id} ${o.title} (${o.lat.toFixed(4)}, ${o.lon.toFixed(4)})`)
    .join('; ');
  return {
    text: `Proposed refinement for “${prompt.trim()}”: candidate anchors ${anchors}. Needs a person to check the anchors against the imagery before it can be cited.`,
    cites: cites.map((o) => o.id),
    inputs: cites.map((o) => ({ id: o.id, recordHash: o.hash })),
  };
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function createThreads(
  view,
  { bindScroll, onPlay, onShowOnGlobe, rooms, rt, getSituations, onOpenRoom },
) {
  view.innerHTML = `
    <div class="th-list">
      <header class="navbar"><span class="nav-title">Threads</span></header>
      <h1 class="large-title">Threads</h1>
      <div class="title-sub tele">Rooms on the evidence · 4D reconstructions</div>
      <div class="th-rooms"></div>
      <div class="th-cards"></div>
    </div>
    <div class="th-detail" hidden></div>`;
  const list = $('.th-list', view);
  const detail = $('.th-detail', view);
  const cards = $('.th-cards', view);
  let bhote = null;
  let open = null; // { thread, ledger }

  view.addEventListener(
    'scroll',
    () => view.classList.toggle('is-scrolled', view.scrollTop > 44),
    { passive: true },
  );
  bindScroll(view);

  function roomRow(r) {
    const s = r.situation;
    const band = bandOf(s);
    const here = rt.presence(r.id).length;
    const k = r.top ? KIND[r.top.kind] : null;
    return `<button class="rm-row" type="button" data-room="${esc(s.id)}" data-band="${band}" data-status="${esc(r.status.id)}">
      <div class="rm-top"><span class="c-band tele" data-band="${band}"><i class="bd"></i>${esc(BAND_NAME[band])}<b>·</b>${esc(ago(r.lastAt))}${Number.isFinite(s.distanceKm) ? `<b>·</b>${esc(fmtKm(s.distanceKm))}` : ''}</span>${here > 1 ? `<span class="c-watch tele"><i></i>${here} here</span>` : ''}</div>
      <h3>${esc(s.title)}</h3>
      ${r.top ? `<p class="rm-claim">${k ? icon(k.icon) : ''}<span>${esc(r.top.text)}</span></p>` : ''}
      <div class="rm-foot"><span class="c-status tele" data-status="${esc(r.status.id)}">${icon(r.status.id === 'disputed' ? 'dispute' : r.status.id === 'open' ? 'question' : 'sealFill')}${esc(r.status.label)}</span>
        <span class="avs">${r.participants.slice(0, 4).map(avatar).join('')}</span>
        <span class="tele rm-n">${r.posts.length} posts${r.openQ.length ? ` · ${r.openQ.length} open` : ''}${r.ownCount ? ` · ${r.ownCount} yours` : ''}</span></div>
    </button>`;
  }

  async function renderRooms() {
    const host = $('.th-rooms', view);
    if (!getSituations || !rooms) return;
    const sits = (await getSituations().catch(() => [])).filter(
      (x) => x.kind !== 'reconstruction',
    );
    if (!sits.length) return;
    const list = await rooms.hot(sits, 8);
    host.innerHTML = `<div class="section-h">Rooms <small>hottest first · every situation has one</small></div>
      <div class="rm-list">${list.map(roomRow).join('')}</div>
      <p class="footnote" style="padding:6px 2px 0">Example posts in rooms are written by fictional people (handles end in .example) to show the format. Your own posts are real, stored on this device, and appear live in your other tabs.</p>
      <div class="section-h">Reconstructions <small>observations · hypotheses · ledger</small></div>`;
  }
  $('.th-rooms', view).addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]');
    if (!b) return;
    haptic('light');
    getSituations().then((sits) => {
      const s = sits.find((x) => String(x.id) === b.dataset.room);
      if (s) onOpenRoom?.(s);
    });
  });
  rooms?.on('post', () => {
    if (!view.hidden && !open) renderRooms();
  });

  async function renderList() {
    renderRooms();
    bhote =
      bhote || (await bhoteThread().catch((err) => (console.error(err), null)));
    const drafts = readLocal(DRAFTS_KEY, []);
    const local = readLocal(LOCAL_KEY, {})[bhote?.id] || {};
    cards.innerHTML = `
      ${
        bhote
          ? `<button class="th-card" type="button" data-thread="${esc(bhote.id)}">
        <div class="th-ba"><img src="${bhote.before}" alt="" loading="lazy" decoding="async"/><img src="${bhote.after}" alt="" loading="lazy" decoding="async"/><span class="th-ba-l">2021</span><span class="th-ba-r">2026</span></div>
        <div class="th-card-body">
          <div class="th-kicker" data-family="hazards"><span class="fam-tag">${icon('hazards')}Flood</span><span>Real event pack</span></div>
          <h3>${esc(bhote.title)}</h3>
          <div class="th-place">${esc(bhote.place)} · ${esc(new Date(bhote.observedDate).toLocaleDateString(undefined, { dateStyle: 'medium' }))}</div>
          <div class="th-stats num"><span><b>${bhote.observations.length}</b> observations</span><span><b>${bhote.hypotheses.length + (local.proposals?.length || 0)}</b> hypotheses</span><span><b>${bhote.steps.length}</b> narrative stops</span></div>
          <div class="th-lic">${esc(bhote.license)}</div>
        </div></button>`
          : '<p class="footnote">The bundled event pack could not be loaded.</p>'
      }
      ${drafts
        .map(
          (
            d,
          ) => `<button class="th-card th-small" type="button" data-draft="${esc(d.id)}" data-family="${esc(d.family || 'infra')}">
          <span class="th-small-ic">${icon('threads')}</span><div class="th-card-body"><div class="th-kicker"><span>Your draft</span><span>${esc(ago(d.createdAt))}</span></div><h3>${esc(d.title)}</h3><div class="th-place">${esc(d.place || '')}</div></div>${icon('chevronRight', { cls: 'chev' })}</button>`,
        )
        .join('')}
      <div class="section-h">More reconstructions <small><span class="badge-example">Example</span></small></div>
      ${[
        {
          t: 'Stadium encore, rebuilt from crowd captures',
          p: '42 signed captures · 3 hypotheses',
          f: 'eyes',
          i: 'eyes',
        },
        {
          t: '7700 squawk replay over the Channel',
          p: 'ADS-B track · 2 witness clips',
          f: 'sky',
          i: 'sky',
        },
        {
          t: 'Ferry crossing in fog, harbour pilots',
          p: 'AIS tracks · radar · 1 hypothesis',
          f: 'sea',
          i: 'sea',
        },
      ]
        .map(
          (x) =>
            `<button class="th-card th-small example" type="button" data-example data-family="${x.f}"><span class="th-small-ic">${icon(x.i)}</span><div class="th-card-body"><div class="th-kicker"><span class="badge-example">Example</span><span>concept</span></div><h3>${esc(x.t)}</h3><div class="th-place">${esc(x.p)}</div></div>${icon('chevronRight', { cls: 'chev' })}</button>`,
        )
        .join('')}
      <p class="footnote">Example threads are placeholders showing the genres the format supports; they contain no real records.</p>`;
  }

  cards.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-thread]');
    if (t && bhote) return openThread(bhote);
    const d = e.target.closest('[data-draft]');
    if (d) {
      const rec = readLocal(DRAFTS_KEY, []).find(
        (x) => x.id === d.dataset.draft,
      );
      if (rec) openThread(await draftThread(rec));
      return;
    }
    if (e.target.closest('[data-example]'))
      toast('Example thread — concept only, no records', {
        icon: icon('threads'),
      });
  });

  /* ---------- detail ---------- */
  function hypHtml(hy, votes) {
    const v = votes.filter((x) => x.id === hy.id);
    const agree = (hy.agree || 0) + v.filter((x) => x.kind === 'agree').length;
    const dispute =
      (hy.dispute || 0) + v.filter((x) => x.kind === 'dispute').length;
    const mine = v.at(-1)?.kind;
    const total = agree + dispute || 1;
    const ai = hy.author.kind === 'ai';
    return `<article class="hyp ${hy.simulated ? 'proposed' : ''}" data-h="${esc(hy.id)}">
      <div class="hyp-top"><span class="hyp-id">${esc(hy.id)}</span><span class="hyp-author ${ai ? 'ai' : ''}">${ai ? icon('sparkles') : ''}${esc(hy.author.handle)}</span>
        ${hy.example ? '<span class="badge-example">Example</span>' : ''}${hy.simulated ? '<span class="badge-example badge-sim">Proposed · local simulation</span>' : ''}<span class="hyp-ago">${esc(ago(hy.at))}</span></div>
      <p class="hyp-text">${esc(hy.text)}</p>
      <div class="hyp-cites">${hy.cites.map((c) => `<button type="button" class="cite" data-cite="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      ${hy.simulated ? `<dl class="hyp-prov"><dt>prompt</dt><dd>${esc(hy.prompt)}</dd><dt>model</dt><dd class="mono">${esc(hy.model)}</dd><dt>inputs</dt><dd class="mono">${hy.inputs.map((i) => `${esc(i.id)}:${esc(i.recordHash.slice(0, 10))}`).join(' ')}</dd></dl>` : ''}
      <div class="hyp-foot">
        <div class="conf" title="Confidence"><span>Confidence</span><i style="--v:${hy.confidence ?? 0}"></i><b class="num">${hy.confidence == null ? 'unscored' : `${Math.round(hy.confidence * 100)}%`}</b></div>
        <div class="votes"><div class="vote-bar"><i style="width:${(agree / total) * 100}%"></i></div>
          <button type="button" class="vote ${mine === 'agree' ? 'on' : ''}" data-vote="agree" aria-label="Agree">${icon('agree')}<span class="num">${agree}</span></button>
          <button type="button" class="vote dis ${mine === 'dispute' ? 'on' : ''}" data-vote="dispute" aria-label="Dispute">${icon('dispute')}<span class="num">${dispute}</span></button></div>
      </div></article>`;
  }

  function obsHtml(o) {
    return `<li class="obs" data-o="${esc(o.id)}">
      <button class="obs-row" type="button" aria-expanded="false">
        <span class="obs-id">${esc(o.id)}</span>
        <span class="obs-main"><b>${esc(o.title)}</b><span>${esc(o.phase)} · ${esc(o.source)}</span></span>
        <span class="obs-hash mono">${icon('lock')}${esc(o.hash.slice(0, 8))}</span>
      </button>
      <div class="obs-more" hidden>
        ${o.summary ? `<p>${esc(o.summary)}</p>` : ''}
        <dl class="facts"><dt>Where</dt><dd class="mono">${esc(fmtCoord(o.lat, o.lon, 5))}</dd>
          <dt>Location</dt><dd>${esc(o.locConf || '—')}</dd><dt>Time</dt><dd>${esc(o.time || '—')} · ${esc(o.timeConf || '')}</dd>
          <dt>Via</dt><dd>${esc(o.via || '—')}</dd>${o.rights ? `<dt>Rights</dt><dd>${esc(o.rights)}</dd>` : ''}
          <dt>sha256</dt><dd class="mono">${esc(o.hash)}</dd></dl>
        <div class="obs-actions">${o.url ? `<a class="pill-btn plain" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${icon('arrowUpRight')}Original</a>` : ''}<button class="pill-btn tinted" type="button" data-globe="${esc(o.id)}">${icon('globe')}Show on globe</button></div>
      </div></li>`;
  }

  async function renderDetail() {
    const { thread } = open;
    const local = readLocal(LOCAL_KEY, {})[thread.id] || {};
    const votes = local.votes || [];
    const proposals = local.proposals || [];
    open.ledger = await buildLedger(thread, local);
    const L = open.ledger;
    detail.innerHTML = `
      <header class="navbar"><div class="nav-leading"><button class="icon-btn back-btn" type="button" aria-label="Back to threads">${icon('chevronLeft')}<span>Threads</span></button></div><span class="nav-title">${esc(thread.title)}</span></header>
      <div class="th-hero">
        ${thread.before ? `<div class="th-ba big"><figure><img src="${thread.before}" alt="2021 reference imagery" decoding="async"/><figcaption>2021 · reference</figcaption></figure><figure><img src="${thread.after}" alt="2026 post-event imagery" decoding="async"/><figcaption>27 Aug 2026 · post-event</figcaption></figure></div>` : ''}
        <h1 class="th-title">${esc(thread.title)}</h1>
        <div class="title-sub" style="padding:0">${esc(thread.place || '')}${thread.real ? ' · real event pack' : ' · your draft'}</div>
        ${thread.label ? `<div class="caveat"><b>${esc(thread.label)}</b>${esc(thread.caveat)}</div>` : ''}
      </div>
      <nav class="strata-nav" aria-label="Strata"><div class="segmented">
        <button type="button" data-jump="obs" aria-pressed="true">Observations</button><button type="button" data-jump="hyp" aria-pressed="false">Hypotheses</button><button type="button" data-jump="nar" aria-pressed="false">Narrative</button><button type="button" data-jump="led" aria-pressed="false">Ledger</button>
        <span class="seg-thumb"></span></div></nav>

      <section class="stratum" id="st-obs"><div class="stratum-h"><span class="st-n">1</span><div><h2>Observations</h2><p>Immutable. Each has a source, a time and a hash. Nobody edits an observation.</p></div></div>
        <ol class="obs-list">${thread.observations.map(obsHtml).join('')}</ol></section>

      <section class="stratum" id="st-hyp"><div class="stratum-h"><span class="st-n">2</span><div><h2>Hypotheses</h2><p>Claims that connect observations. Cite, dispute or supersede — never edit.</p></div></div>
        ${thread.hypotheses.some((x) => x.example) ? '<div class="example-note"><span class="badge-example">Example content</span> These hypotheses, authors and vote counts are fictional, written to show the format. The observations above are real.</div>' : ''}
        <div class="hyps">${[...thread.hypotheses, ...proposals].map((x) => hypHtml(x, votes)).join('') || '<p class="footnote" style="padding:0">No hypotheses yet.</p>'}</div>
        <form class="composer" autocomplete="off">
          <label for="ai-prompt">${icon('sparkles')}Ask AI to refine</label>
          <textarea id="ai-prompt" rows="2" placeholder="Align the witness clip to the corridor using the bridge as a landmark" data-no-drag></textarea>
          <div class="composer-row"><span>Creates a <b>proposed</b> hypothesis with its prompt, model and inputs in the ledger. Local simulation — no network model is called.</span><button class="pill-btn primary" type="submit">Propose</button></div>
        </form></section>

      <section class="stratum" id="st-nar"><div class="stratum-h"><span class="st-n">3</span><div><h2>Narrative</h2><p>A camera path through space and time that cites the strata below it.</p></div></div>
        <div class="narr-card">
          <button class="narr-play" type="button" aria-label="Play narrative">${icon('play')}</button>
          <div><b>${thread.steps.length} stops${thread.elapsedSeconds ? ` · ${Math.round(thread.elapsedSeconds / 60)} min schematic` : ''}</b><span>Flies the globe down the valley, scrubbing the time ribbon.</span></div>
        </div>
        <ol class="narr-steps">${thread.steps.map((s, i) => `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${esc(s.title)}</b><em>${esc(s.phase || '')}</em></li>`).join('')}</ol></section>

      <section class="stratum" id="st-led"><div class="stratum-h"><span class="st-n">#</span><div><h2>Ledger</h2><p>Every change, hash-chained with SHA-256 on this device. Anyone can export and verify it.</p></div></div>
        <div class="ledger-actions"><button class="pill-btn plain" type="button" data-led="verify">${icon('checkmark')}Verify chain</button><button class="pill-btn plain" type="button" data-led="export">${icon('download')}Export ledger</button><span class="led-status num"></span></div>
        <ol class="ledger">${L.map(
          (
            e,
          ) => `<li class="led ${e.type.split('.')[0]}"><button type="button" class="led-row" aria-expanded="false"><span class="led-seq num">${e.seq}</span><span class="led-main"><b>${esc(e.type)}</b><span>${esc(e.actor)} · ${esc(e.at ? String(e.at).slice(0, 10) : '')}</span></span><span class="led-hash mono">${esc(e.hash.slice(0, 10))}</span></button>
          <pre class="led-json mono" hidden>${esc(JSON.stringify({ ...e, payload: e.payload }, null, 2))}</pre></li>`,
        ).join('')}</ol>
        <p class="footnote" style="padding:8px 0 0">Head <span class="mono">${esc(L.at(-1)?.hash.slice(0, 24) || '')}…</span> · ${L.length} entries</p>
      </section>`;
    placeSeg();
  }

  function placeSeg(id) {
    const seg = $('.strata-nav .segmented', detail);
    if (!seg) return;
    const btn = id
      ? $(`[data-jump="${id}"]`, seg)
      : $('[aria-pressed="true"]', seg);
    $$('[data-jump]', seg).forEach((b) =>
      b.setAttribute('aria-pressed', String(b === btn)),
    );
    const th = $('.seg-thumb', seg);
    th.style.width = `${btn.offsetWidth}px`;
    th.style.transform = `translateX(${btn.offsetLeft}px)`;
  }

  async function openThread(thread) {
    open = { thread };
    await renderDetail();
    detail.hidden = false;
    view.classList.add('in-detail');
    view.scrollTop = 0;
    if (!reducedMotion()) {
      detail.animate(
        [{ transform: 'translateX(100%)' }, { transform: 'none' }],
        { duration: 480, easing: 'cubic-bezier(.32,1.1,.4,1)' },
      );
      list.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: 'translateX(-28%)', opacity: 0.4 },
        ],
        { duration: 480, easing: 'cubic-bezier(.32,1.1,.4,1)' },
      );
    }
    list.hidden = true;
    requestAnimationFrame(() => placeSeg());
  }

  function closeThread() {
    list.hidden = false;
    view.classList.remove('in-detail');
    if (!reducedMotion()) {
      list.animate(
        [
          { transform: 'translateX(-28%)', opacity: 0.4 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 420, easing: 'cubic-bezier(.32,1.1,.4,1)' },
      );
      detail
        .animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], {
          duration: 380,
          easing: 'cubic-bezier(.4,0,.6,1)',
        })
        .finished.then(() => (detail.hidden = true));
    } else detail.hidden = true;
    open = null;
    renderList();
  }

  function saveLocal(fn) {
    const all = readLocal(LOCAL_KEY, {});
    const cur = all[open.thread.id] || { votes: [], proposals: [] };
    fn(cur);
    all[open.thread.id] = cur;
    writeLocal(LOCAL_KEY, all);
  }

  detail.addEventListener('click', async (e) => {
    if (e.target.closest('.back-btn')) return closeThread();
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      placeSeg(jump.dataset.jump);
      const sec = $(`#st-${jump.dataset.jump}`, detail);
      view.scrollTo({
        top: sec.offsetTop - 110,
        behavior: reducedMotion() ? 'auto' : 'smooth',
      });
      return;
    }
    const row = e.target.closest('.obs-row');
    if (row) {
      const more = row.nextElementSibling;
      more.hidden = !more.hidden;
      row.setAttribute('aria-expanded', String(!more.hidden));
      return;
    }
    const g = e.target.closest('[data-globe]');
    if (g) {
      const o = open.thread.observations.find((x) => x.id === g.dataset.globe);
      if (o) onShowOnGlobe?.(open.thread, o);
      return;
    }
    const cite = e.target.closest('[data-cite]');
    if (cite) {
      const li = $(`.obs[data-o="${cite.dataset.cite}"]`, detail);
      if (li) {
        const more = $('.obs-more', li);
        more.hidden = false;
        li.scrollIntoView({
          block: 'center',
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
        li.classList.remove('flash');
        void li.offsetWidth;
        li.classList.add('flash');
      }
      return;
    }
    const vote = e.target.closest('[data-vote]');
    if (vote) {
      const id = vote.closest('[data-h]').dataset.h;
      haptic('tick');
      saveLocal((cur) =>
        cur.votes.push({
          id,
          kind: vote.dataset.vote,
          at: new Date().toISOString(),
        }),
      );
      await renderDetail();
      placeSeg('hyp');
      toast(
        `${vote.dataset.vote === 'agree' ? 'Agreed with' : 'Disputed'} ${id} · ledger +1`,
        { icon: icon('threads') },
      );
      return;
    }
    if (e.target.closest('.narr-play')) {
      onPlay?.(open.thread);
      return;
    }
    const led = e.target.closest('[data-led]')?.dataset.led;
    if (led === 'verify') {
      const t0 = performance.now();
      const r = await verifyLedger(open.ledger);
      const st = $('.led-status', detail);
      st.textContent = r.ok
        ? `✓ ${r.n} entries linked · ${Math.round(performance.now() - t0)} ms`
        : `✕ broken at #${r.at}`;
      st.className = `led-status num ${r.ok ? 'ok' : 'bad'}`;
      haptic(r.ok ? 'success' : 'warn');
    } else if (led === 'export') {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              thread: open.thread.id,
              title: open.thread.title,
              exportedAt: new Date().toISOString(),
              algorithm:
                'sha256(canonical({seq,at,type,actor,payloadHash,prev}))',
              entries: open.ledger,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${open.thread.id}.ledger.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Ledger exported', { icon: icon('download') });
    }
    const lr = e.target.closest('.led-row');
    if (lr) {
      const pre = lr.nextElementSibling;
      pre.hidden = !pre.hidden;
      lr.setAttribute('aria-expanded', String(!pre.hidden));
    }
  });

  detail.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = $('#ai-prompt', detail);
    const prompt = ta.value.trim() || ta.placeholder;
    const sim = simulateRefinement(open.thread, prompt);
    const n =
      (readLocal(LOCAL_KEY, {})[open.thread.id]?.proposals?.length || 0) +
      open.thread.hypotheses.length +
      1;
    saveLocal((cur) =>
      cur.proposals.push({
        id: `H${n}`,
        author: { kind: 'ai', handle: 'AI · local simulation' },
        at: new Date().toISOString(),
        text: sim.text,
        confidence: null,
        cites: sim.cites,
        agree: 0,
        dispute: 0,
        simulated: true,
        prompt,
        model: 'local-simulation-v0 (no network)',
        inputs: sim.inputs,
      }),
    );
    haptic('success');
    await renderDetail();
    placeSeg('hyp');
    $(`[data-h="H${n}"]`, detail)?.scrollIntoView({
      block: 'center',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    toast(`Proposed H${n} · recorded in the ledger`, {
      icon: icon('sparkles'),
    });
  });

  new ResizeObserver(() => placeSeg()).observe(view);
  renderList();

  return {
    refresh: renderList,
    async openById(id) {
      if (!bhote) bhote = await bhoteThread();
      if (id === bhote.id) return openThread(bhote);
      const rec = readLocal(DRAFTS_KEY, []).find((x) => x.id === id);
      if (rec) return openThread(await draftThread(rec));
    },
    /** Start a local draft thread from a situation or contact. */
    startDraft(s) {
      const drafts = readLocal(DRAFTS_KEY, []);
      const id = `draft-${String(s.id).replace(/[^a-z0-9-]/gi, '')}`;
      if (!drafts.some((d) => d.id === id))
        drafts.unshift({
          id,
          title: s.title,
          place: s.place,
          lat: s.lat,
          lon: s.lon,
          family: s.family,
          source: s.source,
          createdAt: new Date().toISOString(),
          snapshot: {
            id: s.id,
            title: s.title,
            metrics: s.metrics || null,
            source: s.source || null,
            updatedAt: s.updatedAt || null,
            lon: s.lon,
            lat: s.lat,
          },
        });
      writeLocal(DRAFTS_KEY, drafts.slice(0, 20));
      return id;
    },
    thread: () => open?.thread || null,
    bhote: async () => (bhote = bhote || (await bhoteThread())),
  };
}
