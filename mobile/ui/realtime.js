/**
 * Cross-tab realtime over BroadcastChannel: presence, posts, reactions and
 * live broadcasts. Two tabs of the app on one device see each other live,
 * which is the whole multiplayer loop, minus a server.
 */

import { emitter } from './dom.js';

const CHANNEL = 'gev-mobile-live-v1';
const ME_KEY = 'gev.mobile.me.v1';
const HEARTBEAT = 4000;
const EXPIRE = 12000;

function loadMe() {
  try {
    const v = JSON.parse(localStorage.getItem(ME_KEY) || 'null');
    if (v?.handle) return v;
  } catch {
    /* ignore */
  }
  const id = Math.random().toString(36).slice(2, 6);
  const me = { handle: `@you.${id}`, home: null, createdAt: Date.now() };
  try {
    localStorage.setItem(ME_KEY, JSON.stringify(me));
  } catch {
    /* ignore */
  }
  return me;
}

export function createRealtime() {
  const ev = emitter();
  const tab = Math.random().toString(36).slice(2, 8);
  const me = loadMe();
  const peers = new Map(); // tab → { handle, room, at, watching }
  const lives = new Map(); // live id → { live, frame, at, viewers:Map }
  let room = null;
  let watching = null; // live id this tab is watching
  let ch = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
  } catch {
    ch = null;
  }

  const send = (msg) => {
    try {
      ch?.postMessage({ ...msg, tab, handle: me.handle, at: Date.now() });
    } catch {
      /* ignore (e.g. un-cloneable) */
    }
  };

  function hello() {
    send({ t: 'here', room, watching, visible: !document.hidden });
  }

  function prune() {
    const now = Date.now();
    let changed = false;
    for (const [k, p] of peers)
      if (now - p.at > EXPIRE) {
        peers.delete(k);
        changed = true;
      }
    for (const [id, l] of lives)
      if (now - l.at > EXPIRE) {
        lives.delete(id);
        ev.emit('live-end', { id });
        changed = true;
      } else
        for (const [v, at] of l.viewers)
          if (now - at > EXPIRE) l.viewers.delete(v);
    if (changed) ev.emit('presence', presence(room));
  }

  ch?.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.tab === tab) return;
    if (m.t === 'here' || m.t === 'hello') {
      const prev = peers.get(m.tab);
      peers.set(m.tab, {
        handle: m.handle,
        room: m.room,
        at: Date.now(),
        watching: m.watching,
      });
      if (m.watching)
        for (const l of lives.values())
          if (l.live.id === m.watching) l.viewers.set(m.tab, Date.now());
      if (!prev || prev.room !== m.room) ev.emit('presence', presence(room));
      if (m.t === 'hello') hello();
    } else if (m.t === 'bye') {
      peers.delete(m.tab);
      ev.emit('presence', presence(room));
    } else if (m.t === 'post') ev.emit('post', m.post);
    else if (m.t === 'react')
      ev.emit('react', { room: m.room, kind: m.kind, remote: true });
    else if (m.t === 'rate') ev.emit('rate', m);
    else if (m.t === 'chat')
      ev.emit('chat', { room: m.room, msg: { ...m.msg, remote: true } });
    else if (m.t === 'corro')
      ev.emit('corro', { room: m.room, id: m.id, w: m.w, remote: true });
    else if (m.t === 'need') ev.emit('need', m.req);
    else if (m.t === 'live') {
      const cur = lives.get(m.live.id);
      lives.set(m.live.id, {
        live: m.live,
        frame: m.frame || cur?.frame || null,
        at: Date.now(),
        viewers: cur?.viewers || new Map(),
      });
      ev.emit('live', { ...m.live, frame: m.frame || cur?.frame || null });
    } else if (m.t === 'live-end') {
      lives.delete(m.id);
      ev.emit('live-end', { id: m.id });
    } else if (m.t === 'watch') {
      ev.emit('watch', { live: m.live, tab: m.tab });
    }
  });

  send({ t: 'hello', room, watching });
  setInterval(() => {
    hello();
    prune();
  }, HEARTBEAT);
  addEventListener('pagehide', () => send({ t: 'bye' }));
  document.addEventListener('visibilitychange', hello);

  function presence(r) {
    const list = [{ tab, handle: me.handle, self: true }];
    for (const [k, p] of peers)
      if (!r || p.room === r)
        list.push({ tab: k, handle: p.handle, self: false });
    return list;
  }

  return {
    tab,
    me,
    on: ev.on,
    off: ev.off,
    setHome(home) {
      me.home = home;
      try {
        localStorage.setItem(ME_KEY, JSON.stringify(me));
      } catch {
        /* ignore */
      }
    },
    join(r) {
      room = r;
      hello();
      ev.emit('presence', presence(room));
    },
    leave() {
      room = null;
      hello();
    },
    get room() {
      return room;
    },
    presence,
    /** Tabs on this device currently anywhere in the app. */
    tabs: () => peers.size + 1,
    post: (post) => send({ t: 'post', post }),
    react: (r, kind) => send({ t: 'react', room: r, kind }),
    rate: (payload) => send({ t: 'rate', ...payload }),
    /** Live lane: one chat line to every other tab in the same room. */
    chat: (r, msg) => send({ t: 'chat', room: r, msg }),
    corro: (r, id, w) => send({ t: 'corro', room: r, id, w }),
    need: (req) => send({ t: 'need', req }),
    /* live broadcasts */
    liveTick: (live, frame) => send({ t: 'live', live, frame }),
    liveEnd: (id) => send({ t: 'live-end', id }),
    watch(id) {
      watching = id;
      hello();
    },
    lives: () =>
      [...lives.values()].map((l) => ({ ...l.live, frame: l.frame })),
    /** Viewers of my own broadcast (other tabs that report watching it). */
    viewersOf(id) {
      let n = 0;
      const now = Date.now();
      for (const p of peers.values())
        if (p.watching === id && now - p.at < EXPIRE) n += 1;
      return n;
    },
  };
}
