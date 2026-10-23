/**
 * The Live lane (DESIGN.md §12.6): Twitch chat on the evidence.
 *
 * One hub per room keeps the chat log, the simulated crowd, the reaction
 * tallies, corroborations and the Clerk's timer, so closing and reopening a
 * room feels like walking back into a party that kept going. Views attach to
 * a hub: the room sheet's Live lane and the Moment player's overlay.
 *
 * Real people: the person's own lines, and lines from other tabs over
 * BroadcastChannel. Everything else is simulated and labelled as such.
 */

import { icon } from './icons.js';
import { $, $$, h, esc, haptic, toast, reducedMotion, emitter } from './dom.js';
import { fmtKm, utc, distKm } from './bands.js';
import {
  createChatSim,
  viewerCount,
  worldPoint,
  chatGenre,
  momentChat,
  personaOf,
  makeMsg,
  PERSONAS,
} from './chatSim.js';
import {
  REACT,
  REACT_KINDS,
  EMOTES,
  EMOTE_CODES,
  reactSvg,
  richText,
} from './emotes.js';
import { simTier, tierOf, hashStr } from './signal.js';
import { summarize } from './clerk.js';
import { get, put } from '../capture/db.js';

const CLERK_FIRST_MS = 45e3;
const CLERK_EVERY_MS = 3 * 60e3;
const PROMOTE_AT = 6; // Signal-weighted corroboration that promotes a line
const MAX_LOG = 400;
const MAX_DOM = 160;

/* ---------------- Globe reactions (feature-detected) ---------------- */

export function globeReact(globe, p) {
  const fn = globe?.react || globe?.raw?.react;
  if (typeof fn !== 'function') return false;
  try {
    fn.call(globe?.react ? globe : globe.raw, p);
    return true;
  } catch {
    return false;
  }
}
function globeHeat(globe, pts) {
  const fn = globe?.attentionHeat || globe?.raw?.attentionHeat;
  if (typeof fn !== 'function') return;
  try {
    fn.call(globe?.attentionHeat ? globe : globe.raw, pts);
  } catch {
    /* optional */
  }
}

/** A rough home from the time zone, when location is not shared. */
const TZ = {
  'America/Los_Angeles': [34.05, -118.24],
  'America/Denver': [39.74, -104.99],
  'America/Chicago': [41.88, -87.63],
  'America/New_York': [40.71, -74.01],
  'America/Toronto': [43.65, -79.38],
  'America/Sao_Paulo': [-23.55, -46.63],
  'Europe/London': [51.51, -0.13],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Berlin': [52.52, 13.4],
  'Asia/Tokyo': [35.68, 139.69],
  'Asia/Kolkata': [19.08, 72.88],
  'Asia/Singapore': [1.35, 103.82],
  'Australia/Sydney': [-33.87, 151.21],
};
export function guessLoc() {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const v = TZ[z];
    if (v) return { lat: v[0], lon: v[1], guessed: true };
  } catch {
    /* ignore */
  }
  return { lat: 37.77, lon: -122.42, guessed: true };
}

/* ---------------- The hub ---------------- */

/**
 * @param {object} core social core (globe, rt, rooms, signal, needs, ev)
 * @param {object} s situation (or a Moment adapted to one)
 */
export function createRoomHub(core, s) {
  const ev = emitter();
  const id = String(s.id);
  const log = [];
  let n = 0;
  let views = 0;
  let stopTimer = 0;
  let clerkTimer = 0;
  let lastClerkAt = 0;
  const clerk = [];
  // Tallies start where a room this size would be after a few minutes.
  const v0 = viewerCount(s);
  const reactions = {
    heart: Math.round(v0 * 0.21),
    fire: Math.round(v0 * 0.05),
    eyes: Math.round(v0 * 0.12),
    wow: Math.round(v0 * 0.08),
  };
  let windowReactions = { heart: 0, fire: 0, eyes: 0, wow: 0 };
  let viewers = viewerCount(s);
  const corroBy = new Map(); // msg id → Set(handles)
  let autoPromoted = 0;
  let firstEyes = null;
  const genre = chatGenre(s);

  const sim = createChatSim(s, {
    viewers,
    onMessage: (m) => push(m),
    onBackfill: (list) => list.forEach((m) => push(m, { quiet: true })),
    onReactions: (kind, count, burst) => crowd(kind, count, burst),
    onViewers: (v) => {
      viewers = v;
      ev.emit('viewers', v);
    },
    onBurst: () => ev.emit('burst'),
  });

  function push(m, { quiet = false } = {}) {
    if (!m || !m.text) return null;
    if (log.some((x) => x.id === m.id)) return null;
    n += 1;
    const msg = { corro: 0, ...m, n };
    log.push(msg);
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
    // Simulated crowd corroborates evidence lines over the next seconds.
    if (msg.sim && msg.evidence && !quiet) simCorroborate(msg);
    ev.emit('msg', { msg, quiet });
    return msg;
  }

  function simCorroborate(msg) {
    let k = 0;
    const tick = () => {
      if (!sim.running || k > 6) return;
      k += 1;
      const pool = [
        ...PERSONAS.local,
        ...PERSONAS.photo,
        ...PERSONAS.pilot,
        ...PERSONAS.wx,
        ...PERSONAS.newbie,
      ];
      const p = pool[Math.floor(Math.random() * pool.length)];
      if (p) addCorro(msg, p.handle, simTier(p.handle, p.floor).weight);
      setTimeout(tick, 1800 + Math.random() * 3200);
    };
    setTimeout(tick, 2500 + Math.random() * 2500);
  }

  function addCorro(msg, handle, w = 1) {
    const set = corroBy.get(msg.id) || new Set();
    if (set.has(handle)) return false;
    set.add(handle);
    corroBy.set(msg.id, set);
    msg.corro = Math.round(((msg.corro || 0) + w) * 10) / 10;
    msg.corroN = set.size;
    ev.emit('update', msg);
    if (
      msg.sim &&
      msg.evidence &&
      msg.corro >= PROMOTE_AT &&
      !msg.promoted &&
      autoPromoted < 1
    ) {
      autoPromoted += 1;
      promote(msg, { auto: true }).catch(() => {});
    }
    return true;
  }

  /* ---- reactions ---- */
  function at(lonlat, jitter = 0) {
    return {
      lon: lonlat.lon + (Math.random() - 0.5) * jitter,
      lat: lonlat.lat + (Math.random() - 0.5) * jitter,
    };
  }
  function crowd(kind, count, burst) {
    reactions[kind] += count;
    windowReactions[kind] += count;
    // Locals near the situation, the rest of the world wherever it is.
    const local = Math.round(count * 0.35);
    if (local && Number.isFinite(s.lat))
      globeReact(core.globe, {
        ...at(s, burst ? 0.12 : 0.05),
        kind,
        count: local,
      });
    let rest = count - local;
    for (let i = 0; i < 3 && rest > 0; i += 1) {
      const c = i === 2 ? rest : Math.ceil(rest / 2);
      rest -= c;
      globeReact(core.globe, { ...worldPoint(), kind, count: c });
    }
    ev.emit('react', { kind, count, crowd: true, burst });
  }
  function react(kind, { remote = false } = {}) {
    reactions[kind] += 1;
    windowReactions[kind] += 1;
    const loc = remote ? worldPoint() : core.myLoc();
    globeReact(core.globe, { lon: loc.lon, lat: loc.lat, kind, count: 1 });
    if (!remote) core.rt.react(id, kind);
    ev.emit('react', { kind, count: 1, self: !remote, remote });
  }

  /* ---- the person ---- */
  function meMsg(text) {
    const score = core.signal.cached;
    return {
      id: `me-${core.rt.tab}-${Date.now().toString(36)}`,
      handle: core.rt.me.handle,
      text,
      at: Date.now(),
      self: true,
      tier: tierOf(score),
      witness: !!core.myWitness?.(id),
      first: firstEyes?.self || false,
    };
  }
  function send(text) {
    const t = String(text || '')
      .trim()
      .slice(0, 300);
    if (!t) return null;
    const m = push(meMsg(t));
    if (m) {
      core.rt.chat(id, { ...m, self: false });
      sim.hear(t, core.rt.me.handle);
    }
    return m;
  }
  function corroborate(msg) {
    const w = tierOf(core.signal.cached).weight;
    const ok = addCorro(msg, core.rt.me.handle, w);
    if (ok) core.rt.corro(id, msg.id, w);
    return ok;
  }

  /** Bridge: a Live line becomes a Record post. */
  async function promote(msg, { auto = false } = {}) {
    if (msg.promoted) return msg.promoted;
    const eligible = msg.evidence || (msg.corro || 0) >= 3;
    if (!eligible && !auto) return null;
    // The same words promoted twice are one record.
    const existing = (await core.rooms.room(s)).posts.find(
      (p) => p.promotedFrom && p.promotedFrom.text === msg.text,
    );
    if (existing) {
      msg.promoted = existing.id;
      ev.emit('update', msg);
      return existing.id;
    }
    const persona = personaOf(msg.handle);
    const kind = msg.evidence
      ? 'witness'
      : /\?\s*$/.test(msg.text)
        ? 'question'
        : 'context';
    const post = await core.rooms.post(s, {
      id: `${id}~promo~${hashStr(`${msg.handle}|${msg.text}`).toString(36)}`,
      kind,
      text: msg.text,
      at: msg.at,
      author: msg.self
        ? undefined
        : {
            handle: msg.handle,
            sim: !!msg.sim,
            example: !!msg.sim,
            domain: persona?.domain || msg.domain || undefined,
            local: !!(persona?.local || msg.local),
          },
      evidence: msg.evidence
        ? {
            sealed: true,
            wasThere: Number.isFinite(msg.evidence.km)
              ? msg.evidence.km < 5
              : true,
            distanceKm: msg.evidence.km ?? null,
            example: !!msg.sim,
          }
        : {},
      votes: { up: msg.corroN || 0, dn: 0 },
      promotedFrom: {
        msgId: msg.id,
        n: msg.n,
        handle: msg.handle,
        text: msg.text,
        at: msg.at,
        corro: msg.corro || 0,
        corroN: msg.corroN || 0,
        auto,
        sim: !!msg.sim,
      },
    });
    msg.promoted = post.id;
    ev.emit('update', msg);
    push({
      id: `sys-promo-${msg.id}`,
      system: true,
      handle: 'Record',
      text: `${auto ? 'Promoted by corroboration' : 'Promoted'}: ${msg.handle}’s ${msg.evidence ? 'sealed capture' : 'line'} is now in the Record (${(msg.corro || 0).toFixed(1)} Signal-weighted).`,
      at: Date.now(),
      ref: post.id,
    });
    if (msg.self)
      core.signal.award({
        id: `promoted:${post.id}`,
        rule: 'promoted',
        text: `Your chat line was promoted to the Record in ${s.title}`,
        ref: { room: id, post: post.id },
      });
    core.ev.emit('promote', { room: id, post, msg });
    return post.id;
  }

  /* ---- clerk ---- */
  async function runClerk({ backdate = 0 } = {}) {
    const since = lastClerkAt || 0;
    const lines = log.filter((m) => m.at > since && !m.system);
    const sum = await summarize(lines.slice(-120), {
      reactions: windowReactions,
      viewers,
    });
    if (!sum) return null;
    if (backdate) sum.at -= backdate;
    lastClerkAt = Date.now();
    windowReactions = { heart: 0, fire: 0, eyes: 0, wow: 0 };
    sum.room = id;
    clerk.unshift(sum);
    clerk.splice(6);
    put('kv', { id: `clerk:${id}`, list: clerk }).catch(() => {});
    push({
      id: `sys-clerk-${sum.id}`,
      system: true,
      clerk: true,
      handle: 'Clerk',
      text: `Posted “What chat is saying” to the Record, citing ${sum.quotes.length} lines.`,
      at: Date.now(),
      ref: sum.id,
    });
    ev.emit('clerk', sum);
    core.ev.emit('clerk', sum);
    return sum;
  }
  function scheduleClerk(ms) {
    clearTimeout(clerkTimer);
    clerkTimer = setTimeout(async () => {
      await runClerk();
      scheduleClerk(CLERK_EVERY_MS);
    }, ms);
  }

  /* ---- lifecycle ---- */
  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    const rec = await get('kv', `clerk:${id}`).catch(() => null);
    if (rec?.list)
      clerk.push(...rec.list.filter((x) => !clerk.some((c) => c.id === x.id)));
    computeFirst();
  }
  async function computeFirst() {
    try {
      const r = await core.rooms.room(s);
      const sealed = r.posts
        .filter((p) => p.evidence?.sealed && p.evidence?.wasThere)
        .sort((a, b) => (a.anchor?.t || a.at) - (b.anchor?.t || b.at));
      const p = sealed[0];
      firstEyes = p
        ? {
            handle: p.author.handle,
            at: p.anchor?.t || p.at,
            km: p.evidence.distanceKm,
            example: !!(p.example || p.author?.example),
            self: !!p.author?.self,
            post: p.id,
          }
        : null;
      if (s.momentCaptures?.length) {
        const fc =
          s.momentCaptures.find((c) => c.firstEyes) ||
          [...s.momentCaptures].sort((a, b) => a.t - b.t)[0];
        if (fc && (!firstEyes || fc.t < firstEyes.at))
          firstEyes = {
            handle: fc.handle,
            at: fc.t,
            km: Number.isFinite(fc.lat) ? distKm(fc, s) : null,
            example: true,
          };
      }
      ev.emit('first', firstEyes);
    } catch {
      /* ignore */
    }
  }

  function start() {
    clearTimeout(stopTimer);
    if (sim.running) return;
    sim.start();
    load().then(async () => {
      // One summary from what was already said, so the Record has one.
      if (!clerk.length) await runClerk({ backdate: 95e3 });
      scheduleClerk(CLERK_FIRST_MS);
    });
    const pts = [];
    for (let i = 0; i < 40; i += 1) pts.push({ ...worldPoint(), weight: 0.5 });
    if (Number.isFinite(s.lat))
      for (let i = 0; i < 20; i += 1) pts.push({ ...at(s, 0.3), weight: 1 });
    globeHeat(core.globe, pts);
  }
  function stop() {
    sim.stop();
    clearTimeout(clerkTimer);
    globeHeat(core.globe, null);
  }

  return {
    id,
    s,
    genre,
    log,
    clerk,
    reactions,
    on: ev.on,
    off: ev.off,
    push,
    send,
    react,
    corroborate,
    promote,
    runClerk,
    addCorro,
    get viewers() {
      return viewers + Math.max(0, core.rt.presence(id).length - 1);
    },
    get firstEyes() {
      return firstEyes;
    },
    refreshFirst: computeFirst,
    attach() {
      views += 1;
      start();
    },
    detach() {
      views = Math.max(0, views - 1);
      if (!views) {
        clearTimeout(stopTimer);
        stopTimer = setTimeout(stop, 15000);
      }
    },
    burst: () => sim.burst(),
    corroCount: (mid) => corroBy.get(mid)?.size || 0,
    meCorroborated: (mid) => !!corroBy.get(mid)?.has(core.rt.me.handle),
  };
}

/* ---------------- Rendering ---------------- */

const fmtN = (v) =>
  v >= 10000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString();

export function badgesHtml(m) {
  const b = [];
  if (m.mod)
    b.push(`<span class="cb cb-mod" title="Moderator">${icon('lock')}</span>`);
  if (m.first)
    b.push(
      `<span class="cb cb-first" title="First eyes">${icon('eyes')}</span>`,
    );
  if (m.witness || m.evidence)
    b.push(
      `<span class="cb cb-wit" title="Sealed capture nearby">${icon('sealFill')}</span>`,
    );
  if (m.domain)
    b.push(
      `<span class="cb cb-dom tele" title="${esc(m.domain)} credential">${esc(m.domain.split(' ')[0].slice(0, 5))}</span>`,
    );
  return b.join('');
}

export function lineHtml(m, me) {
  if (m.system)
    return `<div class="cl cl-sys ${m.clerk ? 'is-clerk' : ''}" data-msg="${esc(m.id)}"${m.ref ? ` data-ref="${esc(m.ref)}"` : ''}>${icon(m.clerk ? 'sparkles' : 'sendUp')}<span>${esc(m.text)}</span>${m.ref ? `<button type="button" class="cl-go tele" data-go-record="${esc(m.ref)}">Open</button>` : ''}</div>`;
  const tier = m.tier || simTier(m.handle);
  const { html, mentionsMe } = richText(m.text, { me });
  const cls = [
    'cl',
    m.self ? 'is-me' : '',
    m.remote ? 'is-remote' : '',
    mentionsMe ? 'mentions-me' : '',
    m.witness || m.evidence ? 'is-witness' : '',
    m.promoted ? 'is-promoted' : '',
    m.evidence ? 'has-ev' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const corro = m.corro
    ? `<span class="cl-corro tele" title="Signal-weighted corroboration">${icon('agree')}${m.corro.toFixed(1)}</span>`
    : '';
  return `<div class="${cls}" data-msg="${esc(m.id)}" style="--tc:${tier.color}">
    <span class="cl-n tele" aria-hidden="true">L${m.n}</span>${badgesHtml(m)}<b class="cl-h">${esc(m.handle.replace(/^@/, ''))}</b><span class="cl-c">:</span> <span class="cl-t">${html}</span>${m.evidence ? `<span class="cl-ev tele">${icon('sealFill')}${Number.isFinite(m.evidence.km) ? esc(fmtKm(m.evidence.km)) : 'SEALED'}</span>` : ''}${corro}${m.promoted ? `<span class="cl-rec tele">${icon('sendUp')}Record</span>` : ''}${m.remote ? '<span class="cl-real tele">other tab</span>' : ''}
  </div>`;
}

function actionsHtml(m, hub) {
  const can = m.evidence || (m.corro || 0) >= 3;
  const mine = hub.meCorroborated(m.id);
  return `<div class="cl-acts" data-for="${esc(m.id)}">
    <button type="button" data-cl="reply">${icon('reply')}Reply</button>
    <button type="button" data-cl="corro" aria-pressed="${mine}" ${m.self ? 'disabled' : ''}>${icon('agree')}${mine ? 'Corroborated' : 'Corroborate'}</button>
    <button type="button" data-cl="promote" ${m.promoted ? 'disabled' : ''} class="${can ? 'can' : ''}">${icon('sendUp')}${m.promoted ? 'In the Record' : 'Promote'}</button>
    <span class="cl-who tele">${m.sim ? 'Simulated' : m.self ? 'You' : m.remote ? 'Real · other tab' : ''} · ${esc(utc(new Date(m.at)))}${m.tier ? ` · ${esc(m.tier.name)}` : ''}</span>
  </div>`;
}

/**
 * Mount the Live lane into a sheet body + dock.
 * @param {object} core
 * @param {ReturnType<typeof createRoomHub>} hub
 * @param {{ body: HTMLElement, dock: HTMLElement, onRecord?(ref), onNeedEyes?(), onCapture?() }} o
 */
export function mountLiveLane(core, hub, o) {
  const me = core.rt.me.handle;
  const root =
    h(`<div class="lc" data-lane="live" data-genre="${esc(hub.genre)}">
      <div class="lc-pins"></div>
      <div class="lc-list" role="log" aria-label="Live chat" aria-live="off" data-no-drag></div>
      <div class="lc-float" aria-hidden="true"></div>
      <button type="button" class="lc-more tele" hidden>${icon('chevronDown')}<span>New messages</span></button>
    </div>`);
  const dockEl = h(`<div class="lc-dock">
      <div class="lc-pop" hidden></div>
      <div class="lc-react" role="group" aria-label="React">
        ${REACT_KINDS.map((k) => `<button type="button" class="lr" data-react="${k}" aria-label="${REACT[k].label}">${REACT[k].svg}<span class="num" data-rn="${k}"></span></button>`).join('')}
        <span class="lc-sp"></span>
        <button type="button" class="lc-ask" data-act="need-eyes">${icon('eyes')}<span>Need eyes</span></button>
        <button type="button" class="lc-cap" data-act="capture-reply" aria-label="Reply with a sealed capture">${icon('viewfinder')}</button>
      </div>
      <form class="lc-input" autocomplete="off">
        <button type="button" class="lc-emo" data-act="emotes" aria-label="Emotes">${EMOTES.SealIt.svg}</button>
        <input type="text" maxlength="300" enterkeyhint="send" placeholder="Send a message" aria-label="Send a message" data-no-drag/>
        <button type="submit" class="lc-send" aria-label="Send">${icon('sendUp')}<i class="lc-cool"></i></button>
      </form>
      <div class="lc-meta tele"><span class="lc-sim" title="Every handle in this chat except yours and other open tabs is fictional">Simulated chat · demo</span><span data-slow></span><span class="lc-view"><i></i><b data-viewers>—</b> watching</span></div>
    </div>`);
  o.body.appendChild(root);
  o.dock.appendChild(dockEl);
  const list = $('.lc-list', root);
  const pins = $('.lc-pins', root);
  const floatL = $('.lc-float', root);
  const more = $('.lc-more', root);
  const input = $('input', dockEl);
  const pop = $('.lc-pop', dockEl);
  const sendBtn = $('.lc-send', dockEl);
  let stuck = true;
  let unread = 0;
  let openId = null;
  let coolUntil = 0;

  /* ---- pins: First eyes + Need eyes ---- */
  function renderPins() {
    const f = hub.firstEyes;
    const need = core.needs?.forRoom?.(hub.id)?.[0];
    pins.innerHTML = `${
      f
        ? `<div class="lc-first">${icon('sealFill')}<span><b>First eyes</b> ${esc(f.handle)} · ${esc(utc(new Date(f.at)))}${Number.isFinite(f.km) ? ` · ${esc(fmtKm(f.km))}` : ''}</span>${f.example ? '<em class="badge-example">Example</em>' : ''}</div>`
        : `<div class="lc-first none">${icon('seal')}<span><b>No first eyes yet.</b> The first sealed capture from here gets the byline.</span></div>`
    }${
      need
        ? `<button type="button" class="lc-need" data-need="${esc(need.id)}">${icon('eyes')}<span><b>Need eyes</b> “${esc(need.question)}”</span><em class="tele">${esc(need.distLabel || '')}</em></button>`
        : ''
    }`;
  }
  renderPins();
  const offFirst = hub.on('first', renderPins);
  const offNeed = core.needs?.on?.('change', renderPins);

  /* ---- lines ---- */
  function atBottom() {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  }
  function scrollDown() {
    list.scrollTop = list.scrollHeight;
  }
  function add(m, { quiet } = {}) {
    const el = h(lineHtml(m, me));
    if (!quiet && !reducedMotion()) el.classList.add('in');
    list.appendChild(el);
    while (list.childElementCount > MAX_DOM) list.firstElementChild.remove();
    if (stuck) scrollDown();
    else if (!quiet) {
      unread += 1;
      more.hidden = false;
      $('span', more).textContent =
        `${unread} new message${unread === 1 ? '' : 's'}`;
    }
    if (!quiet && el.classList.contains('mentions-me')) haptic('light');
  }
  for (const m of hub.log.slice(-80)) add(m, { quiet: true });
  requestAnimationFrame(scrollDown);
  const offMsg = hub.on('msg', ({ msg, quiet }) => add(msg, { quiet }));
  const offUpd = hub.on('update', (m) => {
    const el = list.querySelector(`[data-msg="${CSS.escape(m.id)}"]`);
    if (!el) return;
    const wasOpen = openId === m.id;
    const nel = h(lineHtml(m, me));
    el.replaceWith(nel);
    if (wasOpen) openActions(nel, m);
    if (m.corro) {
      const c = $('.cl-corro', nel);
      c?.classList.add('bump');
    }
  });
  list.addEventListener(
    'scroll',
    () => {
      stuck = atBottom();
      if (stuck) {
        unread = 0;
        more.hidden = true;
      }
    },
    { passive: true },
  );
  more.addEventListener('click', () => {
    stuck = true;
    scrollDown();
    more.hidden = true;
    unread = 0;
  });

  /* ---- line actions ---- */
  function closeActions() {
    $$('.cl-acts', list).forEach((x) => x.remove());
    $$('.cl.open', list).forEach((x) => x.classList.remove('open'));
    openId = null;
  }
  function openActions(el, m) {
    closeActions();
    openId = m.id;
    el.classList.add('open');
    el.insertAdjacentHTML('afterend', actionsHtml(m, hub));
    if (stuck) scrollDown();
    else {
      // Scroll only the chat list (scrollIntoView would move the sheet too).
      const acts = el.nextElementSibling;
      const over =
        acts.getBoundingClientRect().bottom -
        list.getBoundingClientRect().bottom;
      if (over > 0) list.scrollTop += over + 8;
    }
  }
  list.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go-record]');
    if (go) {
      o.onRecord?.(go.dataset.goRecord);
      return;
    }
    const act = e.target.closest('[data-cl]');
    if (act) {
      const mid = act.closest('.cl-acts').dataset.for;
      const m = hub.log.find((x) => x.id === mid);
      if (!m) return;
      haptic('tick');
      if (act.dataset.cl === 'reply') {
        input.value = `${m.handle} `;
        input.focus();
        closeActions();
      } else if (act.dataset.cl === 'corro') {
        if (hub.corroborate(m)) {
          toast(
            `Corroborated · your Signal weighs ×${tierOf(core.signal.cached).weight.toFixed(1)}`,
            { icon: icon('agree') },
          );
        }
      } else if (act.dataset.cl === 'promote') {
        const ok = await hub.promote(m);
        if (ok) {
          haptic('success');
          toast('Promoted to the Record', { icon: icon('sendUp') });
          closeActions();
        } else
          toast(
            `Needs a sealed capture or ${3} Signal-weighted corroborations first`,
            { icon: icon('info') },
          );
      }
      return;
    }
    const line = e.target.closest('.cl:not(.cl-sys)');
    if (line) {
      const m = hub.log.find((x) => x.id === line.dataset.msg);
      if (!m) return;
      if (openId === m.id) closeActions();
      else openActions(line, m);
    }
  });

  /* ---- pins actions ---- */
  pins.addEventListener('click', (e) => {
    const nb = e.target.closest('[data-need]');
    if (nb) core.needs?.openDetail?.(nb.dataset.need);
  });

  /* ---- reactions ---- */
  function float(kind, { small = false, from } = {}) {
    if (reducedMotion()) return;
    const el = h(
      `<span class="rf ${small ? 'sm' : ''}" style="--x:${from ?? Math.round(Math.random() * 40)}px">${reactSvg(kind)}</span>`,
    );
    floatL.appendChild(el);
    const dx = (Math.random() - 0.5) * 60;
    // Rise through the visible chat, not over the room's header.
    const room = Math.max(120, list.clientHeight + 30);
    const rise = Math.min(
      room,
      small ? 180 + Math.random() * 140 : 260 + Math.random() * 160,
    );
    el.animate(
      [
        { transform: 'translate(0,0) scale(.4)', opacity: 0 },
        {
          transform: `translate(${dx * 0.4}px,-30px) scale(${small ? 0.8 : 1.15})`,
          opacity: 1,
          offset: 0.15,
        },
        {
          transform: `translate(${-dx * 0.5}px,-${rise * 0.6}px) scale(${small ? 0.7 : 1})`,
          opacity: 0.9,
          offset: 0.6,
        },
        {
          transform: `translate(${dx}px,-${rise}px) scale(${small ? 0.5 : 0.8})`,
          opacity: 0,
        },
      ],
      {
        duration: small
          ? 2200 + Math.random() * 900
          : 2600 + Math.random() * 800,
        easing: 'cubic-bezier(.2,.6,.3,1)',
      },
    ).finished.then(
      () => el.remove(),
      () => el.remove(),
    );
    if (floatL.childElementCount > 60) floatL.firstElementChild?.remove();
  }
  const counts = () =>
    REACT_KINDS.forEach((k) => {
      const el = $(`[data-rn="${k}"]`, dockEl);
      if (el) el.textContent = hub.reactions[k] ? fmtN(hub.reactions[k]) : '';
    });
  counts();
  const offReact = hub.on('react', ({ kind, count, crowd, self, burst }) => {
    if (self) {
      float(kind);
      if (Math.random() < 0.5) setTimeout(() => float(kind), 90);
    } else {
      const k = Math.min(crowd ? (burst ? 5 : 2) : 1, count);
      for (let i = 0; i < k; i += 1)
        setTimeout(() => float(kind, { small: true }), i * 120);
    }
    counts();
  });
  let held = 0;
  dockEl.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-react]');
    if (!b) return;
    // Hold to stream hearts.
    clearInterval(held);
    held = setInterval(() => hub.react(b.dataset.react), 160);
    const up = () => {
      clearInterval(held);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });

  /* ---- viewers + slow mode ---- */
  const slow = () => (hub.viewers >= 1000 ? 3 : 0);
  function meta() {
    $('[data-viewers]', dockEl).textContent = hub.viewers.toLocaleString();
    const sm = slow();
    const real = core.rt.presence(hub.id).length - 1;
    $('[data-slow]', dockEl).textContent =
      real > 0
        ? `${real} real ${real === 1 ? 'person' : 'people'} here (your tabs)`
        : sm
          ? `Slow mode ${sm} s`
          : '';
  }
  meta();
  const offView = hub.on('viewers', meta);
  const offBurst = hub.on('burst', () => root.classList.add('bursting'));
  const burstOff = setInterval(() => root.classList.remove('bursting'), 6000);

  /* ---- input, mentions, emotes ---- */
  function showPop(kind) {
    if (kind === 'emotes') {
      pop.innerHTML = `<div class="emo-grid">${EMOTE_CODES.map((c) => `<button type="button" data-emote="${c}" title="${esc(EMOTES[c].hint)}">${EMOTES[c].svg}<span>${c}</span></button>`).join('')}</div>`;
      pop.hidden = false;
      pop.dataset.kind = 'emotes';
    } else pop.hidden = true;
  }
  function mentionPop() {
    const m = /(^|\s)(@[\w.-]*)$/.exec(input.value);
    if (!m) {
      if (pop.dataset.kind === 'mention') pop.hidden = true;
      return;
    }
    const q = m[2].toLowerCase();
    const seen = [];
    for (let i = hub.log.length - 1; i >= 0 && seen.length < 5; i -= 1) {
      const x = hub.log[i];
      if (x.system || x.self) continue;
      if (x.handle.toLowerCase().startsWith(q) && !seen.includes(x.handle))
        seen.push(x.handle);
    }
    if (!seen.length) {
      pop.hidden = true;
      return;
    }
    pop.dataset.kind = 'mention';
    pop.innerHTML = `<div class="men-list">${seen.map((x) => `<button type="button" data-mention="${esc(x)}" style="--tc:${simTier(x).color}">${esc(x)}</button>`).join('')}</div>`;
    pop.hidden = false;
  }
  input.addEventListener('input', mentionPop);
  input.addEventListener('focus', () => {
    stuck = true;
    scrollDown();
  });
  dockEl.addEventListener('click', (e) => {
    const r = e.target.closest('[data-react]');
    if (r) {
      haptic('tick');
      hub.react(r.dataset.react);
      return;
    }
    const em = e.target.closest('[data-emote]');
    if (em) {
      input.value =
        `${input.value.replace(/\s*$/, ' ')}${em.dataset.emote} `.trimStart();
      input.focus();
      pop.hidden = true;
      return;
    }
    const mn = e.target.closest('[data-mention]');
    if (mn) {
      input.value = input.value.replace(/@[\w.-]*$/, `${mn.dataset.mention} `);
      input.focus();
      pop.hidden = true;
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'emotes') {
      if (!pop.hidden && pop.dataset.kind === 'emotes') pop.hidden = true;
      else showPop('emotes');
    } else if (act === 'need-eyes') o.onNeedEyes?.();
    else if (act === 'capture-reply') o.onCapture?.();
  });
  $('form', dockEl).addEventListener('submit', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now < coolUntil) {
      toast(`Slow mode · ${Math.ceil((coolUntil - now) / 1000)} s`, {
        icon: icon('clock'),
      });
      return;
    }
    const m = hub.send(input.value);
    if (!m) return;
    input.value = '';
    pop.hidden = true;
    stuck = true;
    scrollDown();
    haptic('tick');
    const sm = slow();
    if (sm) {
      coolUntil = now + sm * 1000;
      sendBtn.style.setProperty('--cool', `${sm}s`);
      sendBtn.classList.remove('cooling');
      void sendBtn.offsetWidth;
      sendBtn.classList.add('cooling');
      setTimeout(() => sendBtn.classList.remove('cooling'), sm * 1000);
    }
  });

  hub.attach();
  return {
    root,
    dock: dockEl,
    input,
    float,
    destroy() {
      [offMsg, offUpd, offReact, offView, offBurst, offFirst, offNeed].forEach(
        (f) => typeof f === 'function' && f(),
      );
      clearInterval(burstOff);
      clearInterval(held);
      hub.detach();
      root.remove();
      dockEl.remove();
    },
  };
}

/* ---------------- Moment overlay ---------------- */

/**
 * Twitch-style chat over the Moment player. Replays moment.chat on the
 * Moment's clock: from 'moment' events ({ type:'chat', item }) when the
 * engine sends them, and from the clock ('playback' / setTime) otherwise.
 */
export function mountChatOverlay(core, el, ctx = {}) {
  const root = h(`<div class="co" aria-label="Moment chat">
      <div class="co-list" role="log" aria-live="off"></div>
      <div class="co-float" aria-hidden="true"></div>
      <div class="co-bar">
        <span class="co-tag tele">Chat replay · simulated</span>
        ${REACT_KINDS.map((k) => `<button type="button" data-react="${k}" aria-label="${REACT[k].label}">${REACT[k].svg}</button>`).join('')}
      </div>
    </div>`);
  el.appendChild(root);
  const list = $('.co-list', root);
  const floatL = $('.co-float', root);
  let moment = null;
  let timeline = [];
  let cursor = 0;
  let lastT = 0;
  const shown = new Set();
  const globe = ctx.globe || core.globe;
  let seqN = 0;
  let driven = false; // a player calls push(): ignore the engine's own clock
  const full = ctx.moment || null;
  const maxLines = ctx.maxLines || 9;
  if (maxLines > 9) root.classList.add('co-tall');

  function line(m, { quiet = false } = {}) {
    const key = m.id || `${m.t}|${m.handle}`;
    if (shown.has(key)) return;
    shown.add(key);
    seqN += 1;
    const persona = personaOf(m.handle);
    const msg = {
      id: key,
      n: seqN,
      handle: m.handle || '@someone',
      text: m.text,
      at: m.t || Date.now(),
      sim: m.sim !== false,
      mod: m.badge === 'mod' || !!persona?.mod,
      witness: m.badge === 'witness' || m.badge === 'first',
      first: m.badge === 'first',
      domain: persona?.domain || null,
      tier: simTier(m.handle, persona?.floor || 0),
      self: !!m.self,
    };
    const node = h(lineHtml(msg, core.rt.me.handle));
    if (!quiet) node.classList.add('in');
    list.appendChild(node);
    while (list.childElementCount > maxLines) list.firstElementChild.remove();
    if (maxLines > 9) list.scrollTop = list.scrollHeight;
    // Lines fade after a while, as on a stream overlay.
    setTimeout(() => node.classList.add('old'), 9000);
    // Chat and hearts go together.
    if (!quiet && Math.random() < 0.6) crowdFloat();
  }
  function crowdFloat(kind) {
    const k =
      kind ||
      ['heart', 'eyes', 'wow', 'heart', 'fire'][Math.floor(Math.random() * 5)];
    if (!reducedMotion()) {
      const e2 = h(`<span class="rf sm">${reactSvg(k)}</span>`);
      floatL.appendChild(e2);
      const dx = (Math.random() - 0.5) * 50;
      e2.animate(
        [
          { transform: 'translate(0,0) scale(.4)', opacity: 0 },
          {
            transform: `translate(${dx * 0.3}px,-30px) scale(.9)`,
            opacity: 1,
            offset: 0.15,
          },
          { transform: `translate(${dx}px,-220px) scale(.6)`, opacity: 0 },
        ],
        { duration: 2400, easing: 'cubic-bezier(.2,.6,.3,1)' },
      ).finished.then(
        () => e2.remove(),
        () => e2.remove(),
      );
    }
    if (moment && Number.isFinite(moment.lat))
      globeReact(globe, {
        lon: moment.lon + (Math.random() - 0.5) * 0.02,
        lat: moment.lat + (Math.random() - 0.5) * 0.02,
        kind: k,
        count: 1 + Math.floor(Math.random() * 3),
      });
  }

  function setTime(t) {
    const tt = +t;
    if (!Number.isFinite(tt) || !timeline.length) return;
    if (tt < lastT - 1000) {
      // Seeked backwards: rewind the overlay.
      list.innerHTML = '';
      shown.clear();
      cursor = 0;
      while (cursor < timeline.length && timeline[cursor].t <= tt - 30000) {
        shown.add(timeline[cursor].id);
        cursor += 1;
      }
    }
    lastT = tt;
    let k = 0;
    while (cursor < timeline.length && timeline[cursor].t <= tt) {
      const m = timeline[cursor];
      cursor += 1;
      // Big jumps forward show only the last few lines.
      if (timeline.length - cursor < 400 && k < 12) line(m);
      else shown.add(m.id);
      k += 1;
    }
  }

  /**
   * setMoment(m): a new Moment, or (from a player that drives the overlay)
   * the same Moment with `chat` holding the lines said so far after a seek.
   */
  function setMoment(m) {
    const same = moment && m && moment.id === m.id;
    moment = m;
    if (!same || !timeline.length)
      timeline = m
        ? momentChat(full?.id === m?.id && full.chat?.length ? full : m)
        : [];
    list.innerHTML = '';
    shown.clear();
    cursor = 0;
    lastT = +m?.time?.start || 0;
    // Lines already said: show the last few, quietly.
    const said = Array.isArray(m?.chat) ? m.chat : [];
    for (const c of said) shown.add(c.id || `${c.t}|${c.handle}`);
    for (const c of said.slice(maxLines > 9 ? -24 : -6)) {
      shown.delete(c.id || `${c.t}|${c.handle}`);
      line(c, { quiet: true });
    }
    if (said.length) lastT = said[said.length - 1].t;
  }

  const onMoment = (e) => {
    if (!e || driven) return;
    if (e.type === 'chat' && e.item)
      line({ ...e.item, id: e.item.id || `${e.item.t}|${e.item.handle}` });
    else if (Number.isFinite(+e.t) && e.type !== 'chat') setTime(e.t);
    if (e.type === 'capture')
      for (let i = 0; i < 6; i += 1)
        setTimeout(() => crowdFloat('wow'), i * 90);
  };
  const onPlayback = (e) =>
    !driven && e && Number.isFinite(+e.t) && setTime(e.t);
  const onTime = (e) => !driven && e?.time && setTime(+new Date(e.time));
  globe?.on?.('moment', onMoment);
  globe?.on?.('playback', onPlayback);
  globe?.on?.('time', onTime);

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-react]');
    if (!b) return;
    haptic('tick');
    crowdFloat(b.dataset.react);
    const loc = core.myLoc();
    globeReact(globe, {
      lon: loc.lon,
      lat: loc.lat,
      kind: b.dataset.react,
      count: 1,
    });
  });

  if (ctx.moment) setMoment(ctx.moment);

  return {
    push(msg) {
      driven = true;
      line({ ...msg, t: msg.t || Date.now() });
    },
    setMoment,
    setTime,
    destroy() {
      globe?.off?.('moment', onMoment);
      globe?.off?.('playback', onPlayback);
      globe?.off?.('time', onTime);
      root.remove();
    },
  };
}

export { makeMsg };
