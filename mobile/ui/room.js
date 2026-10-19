/**
 * The room view inside a situation's sheet: presence, a pinned Known /
 * Disputed / Unknown synthesis, open questions, evidence-first posts with
 * earned badges, community notes with the bridging rule drawn in the open,
 * anchors that fly the globe and scrub the ribbon, floating reactions, and
 * a reply bar that offers Capture before text.
 */

import { icon } from './icons.js';
import { $, $$, h, esc, ago, haptic, toast, reducedMotion } from './dom.js';
import { KIND, badgesFor, noteStatus, BRIDGE } from './rooms.js';
import { avatar } from './cards.js';
import { llShort, utc, fmtKm } from './bands.js';
import { mediaUrl } from './witness.js';

const REACTIONS = [
  { id: 'seen', icon: 'eyes', label: 'Seeing it too' },
  { id: 'concern', icon: 'hazards', label: 'Concerned' },
  { id: 'thanks', icon: 'hand', label: 'Thanks' },
  { id: 'q', icon: 'question', label: 'Need answers' },
];

export function createRoomView({
  rooms,
  rt,
  globe,
  getChrome,
  onCapture,
  onCompose,
}) {
  let cur = null; // { s, r, el }
  let pinIds = [];

  function clearPins() {
    for (const id of pinIds) globe.removePin(id);
    pinIds = [];
    getChrome()?.setExtraPips([]);
  }

  function pinPosts(r) {
    clearPins();
    for (const p of r.posts) {
      if (!p.anchor || !Number.isFinite(p.anchor.lat)) continue;
      const kind = p.evidence?.live
        ? 'live'
        : p.kind === 'witness'
          ? 'witness'
          : 'post';
      const id = globe.addPin({
        id: `post:${p.id}`,
        lon: p.anchor.lon,
        lat: p.anchor.lat,
        kind: p.hologram ? 'hologram' : kind,
        label: `${r.numbering.get(p.id)} ${KIND[p.kind]?.name || ''}`,
        headingDeg: p.evidence?.headingDeg,
      });
      if (id) pinIds.push(id);
    }
    getChrome()?.setExtraPips(
      r.posts
        .filter((p) => p.anchor?.t)
        .map((p) => ({
          at: p.anchor.t,
          label: r.numbering.get(p.id),
          color: p.kind === 'witness' ? '#ebc777' : '#f4f7fb',
        })),
    );
  }

  /* ---------------- rendering ---------------- */

  function citeChip(c) {
    if (!c) return '';
    const label = /^O\d/.test(c)
      ? `OBS ${c.slice(1)}`
      : c === 'O-cam'
        ? 'CAM'
        : c;
    return `<button type="button" class="cite" data-cite="${esc(c)}">${esc(label)}</button>`;
  }

  function synthHtml(r) {
    const sy = r.synth;
    const sec = (id, title, list) =>
      list.length
        ? `<div class="sy-sec" data-sy="${id}"><div class="sy-h tele"><i></i>${title}<span>${list.length}</span></div><ul>${list
            .map(
              (l) =>
                `<li><span>${esc(l.text)}</span><span class="sy-cites">${l.cites
                  .filter(Boolean)
                  .map((c) => citeChip(c))
                  .join('')}</span></li>`,
            )
            .join('')}</ul></div>`
        : '';
    return `<section class="synth" aria-label="Known, disputed, unknown">
      <div class="sy-top"><span class="tele">${icon('sparkles')}Local synthesis</span><span class="tele sy-meta">${sy.n} posts · ${sy.obs} observations · ${esc(sy.hash.slice(0, 8))}</span></div>
      ${sec('known', 'Known', sy.known)}${sec('disputed', 'Disputed', sy.disputed)}${sec('unknown', 'Unknown', sy.unknown)}
      <p class="sy-foot">Written on this device by fixed rules from the posts and the sensor data, not by an AI model. Every line cites its sources; it is rebuilt whenever the room changes.</p>
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

  function postHtml(p, r, depth = 0) {
    const s = r.situation;
    const k = KIND[p.kind] || KIND.context;
    const badges = badgesFor(p, s, rt.me);
    const replies = r.repliesOf(p);
    const num = r.numbering.get(p.id);
    const anchor =
      p.anchor && Number.isFinite(p.anchor.lat)
        ? `<button type="button" class="anchor tele" data-anchor="${esc(p.id)}">${icon('pin')}${esc(llShort(p.anchor.lat, p.anchor.lon, 3))}${p.anchor.t ? ` · ${esc(utc(new Date(p.anchor.t), { seconds: false }))}` : ''}</button>`
        : '';
    const media =
      p.evidence?.captureId || p.evidence?.uploadId
        ? `<div class="p-media" data-media="${esc(p.evidence.captureId || p.evidence.uploadId)}" data-store="${p.evidence.uploadId ? 'uploads' : 'media'}" data-video="${p.evidence.video ? 1 : ''}">${p.evidence.unverified ? '<span class="p-unv tele">Unverified upload</span>' : `<span class="p-seal">${icon('sealFill')}</span>`}</div>`
        : '';
    return `<article class="post k-${p.kind} ${p.example ? 'is-example' : ''} ${p.author?.self ? 'is-mine' : ''}" data-post="${esc(p.id)}" style="--depth:${depth}">
      <div class="p-head">
        <span class="p-kind" title="${esc(k.name)}">${icon(k.icon)}</span>
        <span class="p-meta"><b class="tele">${esc(k.name)}</b><span class="p-who">${esc(p.author.handle)}${p.author.self ? ' (you)' : ''}</span><span class="tele p-when">${esc(ago(p.at))} · ${esc(num)}</span></span>
        ${p.example ? '<span class="badge-example">Example</span>' : ''}
      </div>
      <p class="p-text">${esc(p.text)}</p>
      ${media}
      ${badges.length ? `<div class="badges">${badges.map((b) => `<span class="bdg ${b.ex ? 'ex' : ''}" data-b="${b.id}">${icon(b.id === 'there' ? 'location' : b.id === 'sealed' ? 'sealFill' : b.id === 'local' ? 'home' : b.id === 'unverified' ? 'hazards' : 'checkmark')}${esc(b.label)}${b.detail ? ` <em>${esc(b.detail)}</em>` : ''}</span>`).join('')}</div>` : ''}
      <div class="p-actions">
        ${anchor}
        <span class="p-sp"></span>
        <button type="button" class="vote ${p.myVote === 'up' ? 'on' : ''}" data-vote="up" aria-label="Agree">${icon('agree')}<span class="num">${p.votes.up}</span></button>
        <button type="button" class="vote dis ${p.myVote === 'dn' ? 'on' : ''}" data-vote="dn" aria-label="Dispute">${icon('dispute')}<span class="num">${p.votes.dn}</span></button>
        <button type="button" class="vote" data-reply aria-label="Reply">${icon('reply')}</button>
      </div>
      ${(p.notes || []).map((n) => noteHtml(n, p)).join('')}
      ${replies.length ? `<div class="replies">${replies.map((x) => postHtml(x, r, depth + 1)).join('')}</div>` : ''}
    </article>`;
  }

  function presenceHtml(r) {
    const here = rt.presence(r.id);
    const ex = r.participants.filter((a) => a.example).slice(0, 4);
    return `<div class="presence">
      <span class="avs live">${here.map((a, i) => avatar({ handle: a.handle, self: a.self }, i).replace('class="av', 'class="av live')).join('')}</span>
      <span class="pr-t tele"><b data-here>${here.length}</b> watching${here.length > 1 ? ' · live across your tabs' : ''}</span>
      <span class="avs ex">${ex.map(avatar).join('')}</span>
    </div>`;
  }

  async function render(s, el, { focusPost } = {}) {
    const r = await rooms.room(s);
    cur = { s, r, el };
    rt.join(r.id);
    el.innerHTML = `<div class="room" data-room="${esc(r.id)}">
      ${presenceHtml(r)}
      ${synthHtml(r)}
      ${r.hasExamples ? '<div class="example-note"><span class="badge-example">Example</span> Fictional people (handles end in .example) show how a room works. Only the sensor numbers are live; your own posts are real and stay on this device.</div>' : ''}
      ${r.openQ.length ? `<div class="room-h tele">${icon('question')}Open questions <span>float until answered</span></div>${r.openQ.map((p) => postHtml(p, r)).join('')}` : ''}
      <div class="room-h tele">${icon('sealFill')}Evidence first <span>then recency, never followers</span></div>
      ${r.ordered
        .filter((p) => !r.openQ.includes(p))
        .map((p) => postHtml(p, r))
        .join('')}
      <div class="room-end tele">${r.posts.length} posts · ledger ${esc(r.synth.hash.slice(0, 12))}</div>
    </div>`;
    hydrateMedia(el);
    pinPosts(r);
    if (focusPost) {
      const pe = $(`[data-post="${CSS.escape(focusPost)}"]`, el);
      pe?.scrollIntoView({ block: 'center' });
      pe?.classList.add('flash');
    }
    return r;
  }

  async function hydrateMedia(el) {
    for (const m of $$('.p-media[data-media]', el)) {
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

  /* ---------------- reactions ---------------- */

  function reactionRail() {
    return `<div class="react-rail" role="group" aria-label="React">${REACTIONS.map((x) => `<button type="button" data-react="${x.id}" aria-label="${x.label}">${icon(x.icon)}</button>`).join('')}</div>`;
  }

  function floatReaction(host, kind) {
    if (!host || reducedMotion()) return;
    const x = REACTIONS.find((r) => r.id === kind) || REACTIONS[0];
    const el = h(`<span class="react-float">${icon(x.icon)}</span>`);
    el.style.setProperty('--dx', `${Math.round(Math.random() * 24 - 12)}px`);
    host.appendChild(el);
    el.animate(
      [
        { transform: 'translate(0, 0) scale(.6)', opacity: 0 },
        {
          transform: 'translate(var(--dx), -40px) scale(1.1)',
          opacity: 1,
          offset: 0.2,
        },
        {
          transform: 'translate(calc(var(--dx) * -1), -190px) scale(.9)',
          opacity: 0,
        },
      ],
      { duration: 2200, easing: 'cubic-bezier(.2,.7,.3,1)' },
    ).finished.then(() => el.remove());
  }

  /* ---------------- events ---------------- */

  async function rerender(keepScroll) {
    if (!cur) return;
    const sc = keepScroll?.scrollTop;
    await render(cur.s, cur.el);
    if (keepScroll) keepScroll.scrollTop = sc;
  }

  async function onClick(e, { scroller, flyTo, scrub }) {
    if (!cur) return false;
    const r = cur.r;
    const postEl = e.target.closest('[data-post]');
    const post = postEl
      ? r.posts.find((p) => p.id === postEl.dataset.post)
      : null;
    const anchor = e.target.closest('[data-anchor]');
    if (anchor && post?.anchor) {
      haptic('light');
      flyTo(post.anchor, cur.s);
      if (post.anchor.t) scrub(post.anchor.t);
      return true;
    }
    const vote = e.target.closest('[data-vote]');
    if (vote && post) {
      haptic('tick');
      await rooms.vote(post, vote.dataset.vote);
      await rerender(scroller);
      return true;
    }
    if (e.target.closest('[data-reply]') && post) {
      onCompose(cur.s, { replyTo: post });
      return true;
    }
    const rate = e.target.closest('[data-rate]');
    if (rate && post) {
      const nid = rate.closest('[data-note]').dataset.note;
      const note = post.notes.find((n) => n.id === nid);
      const mine = await rooms.rate(note, rate.dataset.rate === '1');
      const { why } = await rooms.myCluster();
      haptic('success');
      const st = noteStatus(note, mine);
      toast(
        `Rated as cluster ${mine.cluster} (${why})${st.shown ? ' · note now bridged' : ''}`,
        { icon: icon('bridge') },
      );
      await rerender(scroller);
      return true;
    }
    const cite = e.target.closest('[data-cite]');
    if (cite) {
      const id = cite.dataset.cite;
      const target = [...r.numbering.entries()].find(([, v]) => v === id)?.[0];
      const el = target
        ? $(`[data-post="${CSS.escape(target)}"]`, cur.el)
        : null;
      if (el) {
        el.scrollIntoView({
          block: 'center',
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      } else
        toast(
          `${id}: ${id.startsWith('O') ? 'sensor observation from the brief' : 'cited source'}`,
          { icon: icon('info') },
        );
      return true;
    }
    const react = e.target.closest('[data-react]');
    if (react) {
      haptic('tick');
      rt.react(r.id, react.dataset.react);
      floatReaction(react.closest('.sheet-dock'), react.dataset.react);
      return true;
    }
    const tog = e.target.closest('[data-act="react-toggle"]');
    if (tog) {
      const dock = tog.closest('.sheet-dock');
      const open = !dock.classList.contains('react-open');
      dock.classList.toggle('react-open', open);
      tog.setAttribute('aria-expanded', String(open));
      haptic('tick');
      return true;
    }
    if (e.target.closest('[data-act="capture-reply"]')) {
      onCapture(cur.s);
      return true;
    }
    if (e.target.closest('[data-act="write"]')) {
      onCompose(cur.s, {});
      return true;
    }
    return false;
  }

  rt.on('react', ({ room, kind }) => {
    if (cur && room === cur.r.id)
      floatReaction(document.querySelector('.brief-sheet .sheet-dock'), kind);
  });
  rt.on('presence', () => {
    if (!cur) return;
    const pr = $('.presence', cur.el);
    if (pr) pr.outerHTML = presenceHtml(cur.r);
  });
  rooms.on('post', (p) => {
    if (cur && p.room === cur.r.id) {
      const sc = cur.el.closest('.sheet-body');
      rerender(sc);
    }
  });

  return {
    render,
    onClick,
    reactionRail,
    replyBar: () =>
      `<div class="reply-bar"><button type="button" class="rb-cap" data-act="capture-reply">${icon('viewfinder')}<span><b>Reply with evidence</b><small>Seal what you see</small></span></button><button type="button" class="rb-write" data-act="write">${icon('note')}Write</button><button type="button" class="rb-react" data-act="react-toggle" aria-expanded="false" aria-label="React">${icon('hand')}</button></div>`,
    close() {
      clearPins();
      cur = null;
      rt.leave();
    },
    get current() {
      return cur;
    },
    fmtKm,
  };
}
