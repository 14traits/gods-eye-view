/**
 * The Record lane (DESIGN.md §12.6): Reddit's threads and X's quote-posts,
 * on the evidence. Considered posts with kinds (§11.3), threaded replies,
 * quote-posts, sealed attachments, Corroborate / Dispute weighted by Signal,
 * sort by Evidence / New / Disputed, community notes with bridging, the
 * Known / Disputed / Unknown synthesis, and the Clerk's "What chat is
 * saying" summaries with citations back to Live lines.
 */

import { icon } from './icons.js';
import { $, $$, h, esc, ago, haptic, toast, reducedMotion } from './dom.js';
import { KIND, badgesFor, noteStatus, BRIDGE } from './rooms.js';
import { llShort, utc, fmtKm } from './bands.js';
import { mediaUrl } from './witness.js';
import { simTier, tierOf, hashStr } from './signal.js';
import { richText } from './emotes.js';

export const SORTS = [
  { id: 'evidence', name: 'Evidence' },
  { id: 'new', name: 'New' },
  { id: 'disputed', name: 'Disputed' },
];

/** Center an element inside its scroller without moving outer layers. */
function centerIn(sc, el, smooth) {
  const top =
    el.getBoundingClientRect().top -
    sc.getBoundingClientRect().top +
    sc.scrollTop -
    sc.clientHeight / 2 +
    el.offsetHeight / 2;
  sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

/** Signal-weighted tallies: seeded voters carry a stable average weight. */
export function weighted(p, core) {
  const h = hashStr(p.id);
  const wUp = 1 + (h % 90) / 100;
  const wDn = 1 + ((h >>> 8) % 60) / 100;
  const myW = tierOf(core.signal.cached).weight;
  const sim = core.simCorro?.(p.id) || [];
  const simW = sim.reduce((a, x) => a + x.w, 0);
  const baseUp = Math.max(0, (p.votes?.up || 0) - (p.myVote === 'up' ? 1 : 0));
  const baseDn = Math.max(0, (p.votes?.dn || 0) - (p.myVote === 'dn' ? 1 : 0));
  const up = baseUp * wUp + (p.myVote === 'up' ? myW : 0) + simW;
  const dn = baseDn * wDn + (p.myVote === 'dn' ? myW : 0);
  return {
    up,
    dn,
    nUp: (p.votes?.up || 0) + sim.length,
    nDn: p.votes?.dn || 0,
    share: up / Math.max(0.001, up + dn),
    myW,
  };
}

const disputeScore = (p, r, core) => {
  const w = weighted(p, core);
  const corr = r.repliesOf(p).filter((x) => x.kind === 'correction').length;
  return w.dn / Math.max(1, w.up + w.dn) + corr * 0.4;
};

function authorTier(p, core) {
  if (p.author?.self) return tierOf(core.signal.cached);
  return simTier(p.author?.handle || '', p.author?.domain ? 300 : 0);
}

function citeChip(c, label) {
  if (!c) return '';
  const l =
    label || (/^O\d/.test(c) ? `OBS ${c.slice(1)}` : c === 'O-cam' ? 'CAM' : c);
  return `<button type="button" class="cite" data-cite="${esc(c)}">${esc(l)}</button>`;
}

export function synthHtml(r, { compact = true } = {}) {
  const sy = r.synth;
  const total = sy.known.length + sy.disputed.length + sy.unknown.length;
  const sec = (id, title, list) =>
    list.length
      ? `<div class="sy-sec" data-sy="${id}"><div class="sy-h tele"><i></i>${title}<span>${list.length}</span></div><ul>${list
          .map(
            (l, i) =>
              `<li class="${i >= 2 ? 'more' : ''}"><span>${richText(l.text).html}</span><span class="sy-cites">${l.cites
                .filter(Boolean)
                .map((c) => citeChip(c))
                .join('')}</span></li>`,
          )
          .join('')}</ul></div>`
      : '';
  const hidden = [sy.known, sy.disputed, sy.unknown].reduce(
    (a, l) => a + Math.max(0, l.length - 2),
    0,
  );
  void total;
  return `<section class="synth ${compact && hidden ? 'compact' : ''}" aria-label="Known, disputed, unknown">
      <div class="sy-top"><span class="tele">${icon('sparkles')}Synthesis</span><span class="tele sy-meta">${sy.n} posts · ${sy.obs} obs · ${esc(sy.hash.slice(0, 8))}</span></div>
      ${sec('known', 'Known', sy.known)}${sec('disputed', 'Disputed', sy.disputed)}${sec('unknown', 'Unknown', sy.unknown)}
      ${compact && hidden ? `<button type="button" class="sy-more" data-act="synth-all">Show ${hidden} more line${hidden === 1 ? '' : 's'}</button>` : ''}
      <p class="sy-foot">Written on this device by fixed rules from the posts and the sensor data. Every line cites its sources, and it is rebuilt whenever the room changes.</p>
    </section>`;
}

export function clerkHtml(sum, { older = 0 } = {}) {
  if (!sum) return '';
  const q = new Map(sum.quotes.map((x) => [x.id, x]));
  return `<section class="clerk" data-clerk="${esc(sum.id)}" aria-label="What chat is saying">
      <div class="ck-top"><span class="ck-av">${icon('sparkles')}</span><span class="ck-who"><b>What chat is saying</b><span class="tele">Clerk · ${esc(ago(sum.at))} · ${sum.window.n} lines · ${esc(utc(new Date(sum.window.from), { seconds: false }))}–${esc(utc(new Date(sum.window.to), { seconds: false }))}</span></span><span class="badge-sim">Synthesis</span></div>
      <ul>${sum.bullets
        .map(
          (b) =>
            `<li data-k="${b.kind}"><span>${esc(b.text)}</span>${b.cites.length ? `<span class="sy-cites">${b.cites.map((c) => citeChip(`chat:${c}`, `L${q.get(c)?.n ?? '?'}`)).join('')}</span>` : ''}</li>`,
        )
        .join('')}</ul>
      <div class="ck-quotes" hidden>${sum.quotes
        .map(
          (x) =>
            `<div class="ck-q" data-q="${esc(x.id)}"><span class="tele">L${x.n}</span><b>${esc(x.handle)}</b><span>${richText(x.text).html}</span></div>`,
        )
        .join('')}</div>
      <p class="sy-foot">Summarized on this device by fixed rules from the Live lane${sum.quotes.some((x) => x.sim) ? ' (simulated chat)' : ''}, not an AI model. Chat is not evidence; cited lines are kept here as receipts · ${esc(sum.hash.slice(0, 8))}${older ? ` · <button type="button" class="linkish" data-act="older-clerk">${older} earlier</button>` : ''}</p>
    </section>`;
}

function noteHtml(n, p) {
  const st = noteStatus(n, n.mine);
  const bar = (c) => {
    const x = st.by[c];
    const pct = x.n ? Math.round((x.h / x.n) * 100) : 0;
    return `<span class="br" data-c="${c}"><b>${c}</b><i style="--p:${pct}%"></i><em class="num">${x.h}/${x.n}</em></span>`;
  };
  const why = st.shown
    ? 'Raters who usually disagree both found it helpful'
    : st.status === 'not-bridged'
      ? `Not shown: one cluster rates it below ${Math.round(BRIDGE.minHelpful * 100)} %`
      : `Not shown yet: needs ${BRIDGE.minPerCluster}+ raters from cluster ${st.status.replace('needs-', '').split('').join(' and ')}`;
  return `<div class="note ${st.shown ? 'shown' : 'pending'}" data-note="${esc(n.id)}">
      <div class="note-h tele">${icon('note')}${st.shown ? 'Community note' : 'Proposed note'}${p.example ? ' · example' : ''}</div>
      ${st.shown ? `<p>${esc(n.text)}</p>` : `<details><summary>Show the proposed note</summary><p>${esc(n.text)}</p></details>`}
      <div class="bridge"><span class="tele">${icon('bridge')}Bridging</span>${bar('A')}${bar('B')}<span class="why">${esc(why)}</span></div>
      <div class="note-rate">${n.mine ? `<span class="tele">You rated ${n.mine.helpful ? 'helpful' : 'not helpful'} as cluster ${esc(n.mine.cluster)}</span>` : `<button type="button" class="pill-btn plain sm" data-rate="1">Helpful</button><button type="button" class="pill-btn plain sm" data-rate="0">Not helpful</button>`}</div>
    </div>`;
}

function quoteHtml(q, r) {
  if (!q) return '';
  const k = KIND[q.kind] || KIND.context;
  return `<button type="button" class="p-quote" data-jump="${esc(q.id)}"><span class="tele">${icon(k.icon)}${esc(k.name)} · ${esc(q.author.handle)} · ${esc(r.numbering.get(q.id) || '')}</span><span>${esc(q.text.length > 160 ? `${q.text.slice(0, 159)}…` : q.text)}</span></button>`;
}

function promotedHtml(pf) {
  if (!pf) return '';
  return `<div class="p-promo"><span class="tele">${icon('sendUp')}From Live chat · L${esc(pf.n ?? '')} · ${esc(utc(new Date(pf.at)))} · ${pf.auto ? 'promoted by corroboration' : 'promoted'} · ${Number(pf.corro || 0).toFixed(1)} weighted</span></div>`;
}

export function postHtml(p, r, core, { depth = 0, first = null } = {}) {
  const s = r.situation;
  const k = KIND[p.kind] || KIND.context;
  const badges = badgesFor(p, s, core.rt.me);
  const replies = r.repliesOf(p);
  const num = r.numbering.get(p.id);
  const tier = authorTier(p, core);
  const w = weighted(p, core);
  const isFirst = first && first.post === p.id;
  const sim = p.author?.sim;
  const anchor =
    p.anchor && Number.isFinite(p.anchor.lat)
      ? `<button type="button" class="anchor tele" data-anchor="${esc(p.id)}">${icon('pin')}${esc(llShort(p.anchor.lat, p.anchor.lon, 3))}${p.anchor.t ? ` · ${esc(utc(new Date(p.anchor.t), { seconds: false }))}` : ''}</button>`
      : '';
  const media =
    p.evidence?.captureId || p.evidence?.uploadId
      ? `<div class="p-media" data-media="${esc(p.evidence.captureId || p.evidence.uploadId)}" data-store="${p.evidence.uploadId ? 'uploads' : 'media'}" data-video="${p.evidence.video ? 1 : ''}">${p.evidence.unverified ? '<span class="p-unv tele">Unverified upload</span>' : `<span class="p-seal">${icon('sealFill')}</span>`}</div>`
      : '';
  const quoted = p.quoteOf ? r.posts.find((x) => x.id === p.quoteOf) : null;
  const pct = Math.round(w.share * 100);
  return `<article class="post k-${p.kind} ${p.example || sim ? 'is-example' : ''} ${p.author?.self ? 'is-mine' : ''} ${isFirst ? 'is-first' : ''}" data-post="${esc(p.id)}" style="--depth:${depth};--tc:${tier.color}">
      <div class="p-head">
        <span class="p-kind" title="${esc(k.name)}">${icon(k.icon)}</span>
        <span class="p-meta"><b class="tele">${esc(k.name)}</b><span class="p-who">${esc(p.author.handle)}${p.author.self ? ' (you)' : ''}</span><span class="p-tier tele" title="Signal tier">${esc(tier.name)}</span><span class="tele p-when">${esc(ago(p.at))} · ${esc(num)}</span></span>
        ${sim ? '<span class="badge-sim">Simulated</span>' : p.example ? '<span class="badge-example">Example</span>' : ''}
      </div>
      ${isFirst ? `<div class="p-first tele">${icon('sealFill')}First eyes · ${esc(p.author.handle)} · ${esc(utc(new Date(first.at)))}${Number.isFinite(first.km) ? ` · ${esc(fmtKm(first.km))}` : ''}</div>` : ''}
      ${p.needEyes ? `<div class="p-need tele">${icon('eyes')}Answered Need eyes · “${esc(p.needEyes.question || '')}”</div>` : ''}
      <p class="p-text">${richText(p.text).html}</p>
      ${promotedHtml(p.promotedFrom)}
      ${quoteHtml(quoted, r)}
      ${media}
      ${badges.length ? `<div class="badges">${badges.map((b) => `<span class="bdg ${b.ex ? 'ex' : ''}" data-b="${b.id}">${icon(b.id === 'there' ? 'location' : b.id === 'sealed' ? 'sealFill' : b.id === 'local' ? 'home' : b.id === 'unverified' ? 'hazards' : 'checkmark')}${esc(b.label)}${b.detail ? ` <em>${esc(b.detail)}</em>` : ''}</span>`).join('')}</div>` : ''}
      <div class="p-actions">
        <button type="button" class="vote ${p.myVote === 'up' ? 'on' : ''}" data-vote="up" aria-label="Corroborate">${icon('agree')}<span class="num">${w.nUp}</span></button>
        <button type="button" class="vote dis ${p.myVote === 'dn' ? 'on' : ''}" data-vote="dn" aria-label="Dispute">${icon('dispute')}<span class="num">${w.nDn}</span></button>
        <span class="p-wbar ${w.up + w.dn ? '' : 'none'}" title="Signal-weighted: ${w.up.toFixed(1)} corroborate · ${w.dn.toFixed(1)} dispute"><i style="--p:${pct}%"></i><em class="tele">${w.up.toFixed(0)}:${w.dn.toFixed(0)}</em></span>
        <span class="p-sp"></span>
        ${anchor}
        <button type="button" class="vote" data-reply aria-label="Reply">${icon('reply')}${replies.length ? `<span class="num">${replies.length}</span>` : ''}</button>
        <button type="button" class="vote" data-quote aria-label="Quote">${icon('share')}</button>
      </div>
      ${(p.notes || []).map((n) => noteHtml(n, p)).join('')}
      ${replies.length ? `<div class="replies">${replies.map((x) => postHtml(x, r, core, { depth: depth + 1, first })).join('')}</div>` : ''}
    </article>`;
}

async function hydrateMedia(el) {
  for (const m of $$('.p-media[data-media]', el)) {
    if (m.querySelector('img,video')) continue;
    const u = await mediaUrl(m.dataset.media, m.dataset.store);
    if (!u) continue;
    m.insertAdjacentHTML(
      'afterbegin',
      m.dataset.video
        ? `<video src="${esc(u)}#t=0.1" muted playsinline preload="metadata"></video>`
        : `<img src="${esc(u)}" alt="Attached capture" loading="lazy"/>`,
    );
  }
}

/**
 * Mount the Record lane.
 * @param {object} core
 * @param {object} hub the room's Live hub (for Clerk summaries), optional
 * @param {{ s, body, dock, flyTo?, scrub?, onCompose(s, o), onCapture(s, o),
 *   onNeedEyes?(), focusPost?, onLive?() }} o
 */
export function mountRecordLane(core, hub, o) {
  const s = o.s;
  let sort = 'evidence';
  let r = null;
  let showOlder = false;
  const root = h('<div class="rec" data-lane="record"></div>');
  const dockEl = h(
    `<div class="reply-bar"><button type="button" class="rb-cap" data-act="capture-reply">${icon('viewfinder')}<span><b>Reply with evidence</b><small>Seal what you see</small></span></button><button type="button" class="rb-write" data-act="write">${icon('note')}Write</button><button type="button" class="rb-react" data-act="need-eyes" aria-label="Ask for eyes">${icon('eyes')}</button></div>`,
  );
  o.body.appendChild(root);
  o.dock.appendChild(dockEl);
  const scroller = () => o.body;

  async function render({ keep = true, focusPost } = {}) {
    const sc = keep ? scroller().scrollTop : 0;
    r = await core.rooms.room(s);
    const first = hub?.firstEyes || null;
    const roots = r.posts.filter((p) => !p.replyTo);
    let list;
    if (sort === 'new') list = [...roots].sort((a, b) => b.at - a.at);
    else if (sort === 'disputed')
      list = [...roots]
        .filter((p) => disputeScore(p, r, core) > 0.12)
        .sort((a, b) => disputeScore(b, r, core) - disputeScore(a, r, core));
    else list = r.ordered.filter((p) => !r.openQ.includes(p));
    const clerk = hub?.clerk || [];
    const needs = core.needs?.forRoom?.(r.id) || [];
    root.innerHTML = `
      <div class="rec-sort" role="tablist" aria-label="Sort the Record">${SORTS.map((x) => `<button type="button" role="tab" data-sort="${x.id}" aria-selected="${x.id === sort}">${x.name}</button>`).join('')}<span class="rec-sp"></span><span class="tele rec-n">${r.posts.length} posts</span></div>
      ${synthHtml(r)}
      ${clerk[0] ? clerkHtml(clerk[0], { older: clerk.length - 1 }) : ''}
      ${
        showOlder
          ? clerk
              .slice(1)
              .map((c) => clerkHtml(c))
              .join('')
          : ''
      }
      ${needs.map((n) => core.needs.cardHtml(n)).join('')}
      ${r.hasExamples ? '<div class="example-note"><span class="badge-example">Example</span> Fictional people (handles end in .example) show how a room works. Only the sensor numbers are live; your own posts are real and stay on this device.</div>' : ''}
      ${sort === 'evidence' && r.openQ.length ? `<div class="room-h tele">${icon('question')}Open questions <span>float until answered</span></div>${r.openQ.map((p) => postHtml(p, r, core, { first })).join('')}` : ''}
      <div class="room-h tele">${icon(sort === 'disputed' ? 'dispute' : sort === 'new' ? 'clock' : 'sealFill')}${sort === 'evidence' ? 'Evidence first <span>sealed, corroborated, close beats loud</span>' : sort === 'new' ? 'Newest first' : 'Most disputed <span>weighted by Signal</span>'}</div>
      ${list.length ? list.map((p) => postHtml(p, r, core, { first })).join('') : '<div class="empty">Nothing disputed here. Votes and corrections move posts into this view.</div>'}
      <div class="room-end tele">${r.posts.length} posts · ledger ${esc(r.synth.hash.slice(0, 12))}</div>`;
    hydrateMedia(root);
    pinPosts();
    if (keep) scroller().scrollTop = sc;
    if (focusPost) {
      const pe = $(`[data-post="${CSS.escape(focusPost)}"]`, root);
      if (pe) centerIn(scroller(), pe, false);
      pe?.classList.add('flash');
    }
    return r;
  }

  /* ---- globe pins for anchored posts ---- */
  let pinIds = [];
  function clearPins() {
    for (const id of pinIds) core.globe?.removePin?.(id);
    pinIds = [];
  }
  function pinPosts() {
    clearPins();
    if (!core.globe?.addPin) return;
    for (const p of r.posts) {
      if (!p.anchor || !Number.isFinite(p.anchor.lat)) continue;
      const kind = p.evidence?.live
        ? 'live'
        : p.kind === 'witness'
          ? 'witness'
          : 'post';
      const id = core.globe.addPin({
        id: `post:${p.id}`,
        lon: p.anchor.lon,
        lat: p.anchor.lat,
        kind: p.hologram ? 'hologram' : kind,
        label: `${r.numbering.get(p.id)} ${KIND[p.kind]?.name || ''}`,
        headingDeg: p.evidence?.headingDeg,
      });
      if (id) pinIds.push(id);
    }
  }

  function flash(el) {
    if (!el) return;
    centerIn(scroller(), el, !reducedMotion());
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  root.addEventListener('click', async (e) => {
    const srt = e.target.closest('[data-sort]');
    if (srt) {
      sort = srt.dataset.sort;
      haptic('tick');
      await render({ keep: false });
      scroller().scrollTop = 0;
      return;
    }
    if (e.target.closest('[data-act="synth-all"]')) {
      $('.synth', root)?.classList.remove('compact');
      e.target.closest('[data-act]').remove();
      return;
    }
    if (e.target.closest('[data-act="older-clerk"]')) {
      showOlder = !showOlder;
      await render();
      return;
    }
    const need = e.target.closest('[data-need-act]');
    if (need) {
      core.needs.act(need.dataset.needAct, need.dataset.need);
      return;
    }
    const cite = e.target.closest('[data-cite]');
    if (cite) {
      const id = cite.dataset.cite;
      if (id.startsWith('chat:')) {
        const box = cite.closest('.clerk');
        const qs = $('.ck-quotes', box);
        qs.hidden = false;
        const q = $(`[data-q="${CSS.escape(id.slice(5))}"]`, qs);
        $$('.ck-q', qs).forEach((x) => x.classList.toggle('hl', x === q));
        haptic('tick');
        return;
      }
      const target = [...r.numbering.entries()].find(([, v]) => v === id)?.[0];
      const el = target ? $(`[data-post="${CSS.escape(target)}"]`, root) : null;
      if (el) flash(el);
      else
        toast(
          `${id}: ${id.startsWith('O') ? 'sensor observation from the brief' : 'cited source'}`,
          { icon: icon('info') },
        );
      return;
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      flash($(`[data-post="${CSS.escape(jump.dataset.jump)}"]`, root));
      return;
    }
    const postEl = e.target.closest('[data-post]');
    const post = postEl
      ? r.posts.find((p) => p.id === postEl.dataset.post)
      : null;
    if (!post) return;
    const anchor = e.target.closest('[data-anchor]');
    if (anchor && post.anchor) {
      haptic('light');
      o.flyTo?.(post.anchor, s);
      if (post.anchor.t) o.scrub?.(post.anchor.t);
      return;
    }
    const vote = e.target.closest('[data-vote]');
    if (vote) {
      haptic('tick');
      const was = post.myVote;
      await core.rooms.vote(post, vote.dataset.vote);
      if (was !== vote.dataset.vote) {
        const wgt = tierOf(core.signal.cached).weight;
        toast(
          `${vote.dataset.vote === 'up' ? 'Corroborated' : 'Disputed'} · your vote weighs ×${wgt.toFixed(1)}`,
          { icon: icon(vote.dataset.vote === 'up' ? 'agree' : 'dispute') },
        );
      }
      await render();
      return;
    }
    if (e.target.closest('[data-reply]')) {
      o.onCompose(s, { replyTo: post });
      return;
    }
    if (e.target.closest('[data-quote]')) {
      o.onCompose(s, { quote: post });
      return;
    }
    const rate = e.target.closest('[data-rate]');
    if (rate) {
      const nid = rate.closest('[data-note]').dataset.note;
      const note = post.notes.find((n) => n.id === nid);
      const mine = await core.rooms.rate(note, rate.dataset.rate === '1');
      const { why } = await core.rooms.myCluster();
      haptic('success');
      const st = noteStatus(note, mine);
      if (st.shown && mine.helpful)
        core.signal.award({
          id: `note:${note.id}`,
          rule: 'note',
          text: `A note you rated helpful is bridged in ${s.title}`,
          ref: { room: r.id, post: post.id },
        });
      toast(
        `Rated as cluster ${mine.cluster} (${why})${st.shown ? ' · note now bridged' : ''}`,
        { icon: icon('bridge') },
      );
      await render();
    }
  });
  dockEl.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'capture-reply') o.onCapture(s, {});
    else if (act === 'write') o.onCompose(s, {});
    else if (act === 'need-eyes') o.onNeedEyes?.();
  });

  const offPost = core.rooms.on('post', (p) => {
    if (p.room === String(s.id)) render();
  });
  const offClerk = hub?.on('clerk', () => render());
  const offNeeds = core.needs?.on?.('change', () => render());
  const offSig = core.on?.(
    'simcorro',
    (x) => x.room === String(s.id) && render(),
  );

  const ready = render({ keep: false, focusPost: o.focusPost });
  return {
    root,
    ready,
    render,
    get room() {
      return r;
    },
    destroy() {
      clearPins();
      [offPost, offClerk, offNeeds, offSig].forEach(
        (f) => typeof f === 'function' && f(),
      );
      root.remove();
      dockEl.remove();
    },
  };
}
