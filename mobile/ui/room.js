/**
 * A room with two lanes (DESIGN.md §12.6): Live (Twitch: fast chat,
 * emotes, the heart stream rising from the globe) and Record (Reddit and
 * X: threaded, evidence-ranked, Signal-weighted, with notes and the
 * synthesis). The bridge between them is promotion and the Clerk.
 *
 * `createRoomPanel` mounts both lanes into any sheet (body + dock).
 * `createRoomView` keeps the round-two contract the world's brief sheet
 * uses: render(s, el, opts) · onClick(e, { flyTo, scrub }) · replyBar() ·
 * reactionRail() · close() · current.
 */

import { icon } from './icons.js';
import { $, h, esc, haptic } from './dom.js';
import { fmtKm } from './bands.js';
import { mountLiveLane } from './liveChat.js';
import { mountRecordLane } from './record.js';

const fmtV = (v) =>
  v >= 10000 ? `${(v / 1000).toFixed(1)}k` : v.toLocaleString();

/**
 * @param {object} core social core
 * @param {object} s situation (or adapted Moment)
 * @param {{ body, dock, switchHost?, lane?, focusPost?, flyTo?, scrub?,
 *   onCompose(s,o), onCapture(s,o), onLane?(lane) }} o
 */
export function createRoomPanel(core, s, o) {
  const hub = core.hub(s);
  let lane = o.lane === 'record' ? 'record' : 'live';
  let view = null;
  const sw = h(`<div class="lane-switch" role="tablist" aria-label="Room lanes">
      <button type="button" role="tab" data-lane="live"><i class="ls-dot"></i>Live<span class="ls-n tele" data-ls="live"></span></button>
      <button type="button" role="tab" data-lane="record">${icon('note')}Record<span class="ls-n tele" data-ls="record"></span></button>
      <span class="ls-thumb"></span>
    </div>`);
  const host = o.switchHost || o.body;
  if (o.switchHost) o.switchHost.appendChild(sw);
  const wrap = h(`<div class="room-panel" data-lane="${lane}"></div>`);
  if (!o.switchHost) wrap.appendChild(sw);
  o.body.appendChild(wrap);
  core.rt.join(hub.id);

  function counts() {
    $('[data-ls="live"]', sw).textContent = fmtV(hub.viewers);
    core.rooms
      .room(s)
      .then((r) => {
        const el = $('[data-ls="record"]', sw);
        if (el) el.textContent = String(r.posts.length + hub.clerk.length);
      })
      .catch(() => {});
  }
  counts();
  const offV = hub.on('viewers', () => {
    const el = $('[data-ls="live"]', sw);
    if (el) el.textContent = fmtV(hub.viewers);
  });
  const offC = hub.on('clerk', counts);
  const offP = core.rooms.on('post', (p) => p.room === hub.id && counts());

  function mount() {
    view?.destroy();
    wrap.dataset.lane = lane;
    o.body.dataset.lane = lane;
    o.dock.dataset.lane = lane;
    $$sel(sw).forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.lane === lane)),
    );
    sw.dataset.lane = lane;
    const common = {
      s,
      body: wrap,
      dock: o.dock,
      onNeedEyes: () => core.needs.openCreate(s),
      onCapture: (x, y) => o.onCapture(x || s, y || {}),
    };
    if (lane === 'live')
      view = mountLiveLane(core, hub, {
        ...common,
        onCapture: () => o.onCapture(s, {}),
        onRecord: (ref) => setLane('record', { focusPost: ref }),
      });
    else
      view = mountRecordLane(core, hub, {
        ...common,
        flyTo: o.flyTo,
        scrub: o.scrub,
        focusPost: o.focusPost,
        onCompose: o.onCompose,
      });
    o.onLane?.(lane);
  }
  function setLane(l, { focusPost } = {}) {
    if (l === lane && !focusPost) return;
    lane = l;
    if (focusPost) o.focusPost = focusPost;
    haptic('tick');
    mount();
  }
  sw.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lane]');
    if (b) setLane(b.dataset.lane);
  });
  mount();
  void host;

  return {
    hub,
    get lane() {
      return lane;
    },
    get view() {
      return view;
    },
    setLane,
    destroy() {
      view?.destroy();
      view = null;
      offV();
      offC();
      offP();
      sw.remove();
      wrap.remove();
      delete o.body.dataset.lane;
      delete o.dock.dataset.lane;
      core.rt.leave();
    },
  };
}
const $$sel = (sw) => [...sw.querySelectorAll('[data-lane]')];

/**
 * Round-two contract for the world's brief sheet (world.js). It needs the
 * social core; `getCore` resolves it lazily so world.js need not change.
 */
export function createRoomView({
  rooms,
  rt,
  globe,
  getChrome,
  onCapture,
  onCompose,
  getCore,
}) {
  let cur = null; // { s, el, panel }
  let coreP = null;
  const core = async () =>
    (coreP =
      coreP ||
      (getCore
        ? Promise.resolve(getCore())
        : import('./social.js').then((m) =>
            m.socialCore({ rooms, rt, globe }),
          )));

  async function render(s, el, { focusPost, lane } = {}) {
    const c = await core();
    cur?.panel?.destroy();
    el.innerHTML = '';
    const sheet = el.closest('.sheet');
    const dock = sheet?.querySelector('.sheet-dock') || el;
    dock.innerHTML = '';
    const panel = createRoomPanel(c, s, {
      body: el,
      dock,
      lane: lane || (focusPost ? 'record' : 'live'),
      focusPost,
      onCompose: (x, y) => onCompose(x, y),
      onCapture: (x, y) => onCapture(x, y),
      flyTo: null,
      scrub: (t) => getChrome?.()?.ribbon?.scrubTo?.(t),
    });
    cur = { s, el, panel, r: await rooms.room(s) };
    return cur.r;
  }

  return {
    render,
    /** Anchors need the world's camera; everything else the lanes handle. */
    async onClick(e, { flyTo, scrub } = {}) {
      if (!cur) return false;
      const a = e.target.closest?.('[data-anchor]');
      if (!a) return false;
      const r = await rooms.room(cur.s);
      const p = r.posts.find((x) => x.id === a.dataset.anchor);
      if (!p?.anchor) return false;
      haptic('light');
      flyTo?.(p.anchor, cur.s);
      if (p.anchor.t) scrub?.(p.anchor.t);
      return true;
    },
    reactionRail: () => '',
    replyBar: () => '',
    close() {
      cur?.panel?.destroy();
      cur = null;
    },
    get current() {
      return cur;
    },
    fmtKm,
    esc,
  };
}
