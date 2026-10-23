/**
 * Round-three API shim (mobile/globe/API.md, "Round three").
 *
 * The engine owns the real recorder, playback, Moments, dossiers, search,
 * graph, reactions and "your sky now". This module fills ONLY the calls an
 * engine does not provide yet, from the round-one/two calls it does provide,
 * so the shell can be designed and demoed before the engine lands and still
 * works if one call is missing. The offline stub installs it natively.
 *
 * Everything here is honest about what it is: shimmed sources say so.
 */

import {
  buildHeroMoment,
  trackAt,
  bearing,
  distM,
  ESB,
} from './stubMoments.js';

/* ------------------------------------------------------------------ */
/* Gazetteer (places are entities too)                                 */
/* ------------------------------------------------------------------ */

export const PLACES = [
  {
    slug: 'empire-state-building',
    name: 'Empire State Building',
    sub: '350 5th Ave, New York',
    lon: ESB.lon,
    lat: ESB.lat,
  },
  {
    slug: 'midtown-manhattan',
    name: 'Midtown Manhattan',
    sub: 'New York, US',
    lon: -73.9851,
    lat: 40.7549,
  },
  {
    slug: 'times-square',
    name: 'Times Square',
    sub: 'New York, US',
    lon: -73.9855,
    lat: 40.758,
  },
  {
    slug: 'piccadilly-circus',
    name: 'Piccadilly Circus',
    sub: 'London, UK',
    lon: -0.1347,
    lat: 51.51,
  },
  {
    slug: 'heathrow',
    name: 'Heathrow Airport',
    sub: 'London, UK',
    lon: -0.4543,
    lat: 51.47,
  },
  {
    slug: 'shibuya-crossing',
    name: 'Shibuya Crossing',
    sub: 'Tokyo, Japan',
    lon: 139.7005,
    lat: 35.6595,
  },
  {
    slug: 'fort-novosel',
    name: 'Fort Novosel',
    sub: 'Alabama, US',
    lon: -85.72,
    lat: 31.36,
  },
  {
    slug: 'kathmandu',
    name: 'Kathmandu',
    sub: 'Nepal',
    lon: 85.324,
    lat: 27.7172,
  },
  {
    slug: 'strait-of-hormuz',
    name: 'Strait of Hormuz',
    sub: 'Persian Gulf',
    lon: 56.4,
    lat: 26.5,
  },
  {
    slug: 'panama-canal',
    name: 'Panama Canal',
    sub: 'Panama',
    lon: -79.68,
    lat: 9.08,
  },
  {
    slug: 'cape-canaveral',
    name: 'Cape Canaveral',
    sub: 'Florida, US',
    lon: -80.6,
    lat: 28.47,
  },
  {
    slug: 'starbase',
    name: 'Starbase',
    sub: 'Boca Chica, Texas',
    lon: -97.157,
    lat: 25.997,
  },
  {
    slug: 'suez-canal',
    name: 'Suez Canal',
    sub: 'Egypt',
    lon: 32.55,
    lat: 30.0,
  },
  {
    slug: 'congress-ave',
    name: 'Congress Avenue',
    sub: 'Austin, Texas',
    lon: -97.7431,
    lat: 30.2672,
  },
];

const R_E = 6371008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const ll = (o) => ({ lon: o.lon, lat: o.lat });
const km = (a, b) => distM(a, b) / 1000;

function fnv(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i += 1) {
    h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ str.charCodeAt(i), 2246822519);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

/** SHA-256 of a record (the receipt). FNV only where WebCrypto is absent. */
export async function hashOf(record) {
  const s = JSON.stringify(record);
  try {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(s),
    );
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return `fnv:${fnv(s)}${fnv(s.split('').reverse().join(''))}`;
  }
}

const KIND_BAND = {
  aircraft: 'sky',
  helicopter: 'sky',
  military: 'sky',
  track: 'sky',
  satellite: 'orbit',
  station: 'orbit',
  vessel: 'ground',
  ship: 'ground',
  quake: 'ground',
  fire: 'ground',
  camera: 'ground',
  place: 'ground',
  capture: 'inside',
  moment: 'inside',
};
export const bandOfKind = (k, s) =>
  k === 'situation' && s?.band ? s.band : KIND_BAND[k] || 'ground';

function normKind(k) {
  if (k === 'ship') return 'vessel';
  if (k === 'earthquake') return 'quake';
  if (k === 'cctv') return 'camera';
  return k;
}

/* ------------------------------------------------------------------ */

export function installRound3(
  engine,
  { kind = 'cesium', historyHours = 0 } = {},
) {
  const shimmed = [];
  const has = (n) => typeof engine[n] === 'function';
  const put = (name, fn) => {
    if (has(name)) return;
    engine[name] = fn;
    shimmed.push(name);
  };

  /* ---------- events: multiplex the shim's own events ---------- */
  const local = new Map();
  const emit = (ev, d) => local.get(ev)?.forEach((fn) => fn(d));
  const origOn = engine.on?.bind(engine);
  const origOff = engine.off?.bind(engine);
  engine.on = (ev, fn) => {
    if (!local.has(ev)) local.set(ev, new Set());
    local.get(ev).add(fn);
    return origOn?.(ev, fn);
  };
  engine.off = (ev, fn) => {
    local.get(ev)?.delete(fn);
    return origOff?.(ev, fn);
  };

  /* ---------- the clock ---------- */
  let clock = null; // epoch ms, null = live
  const origSetTime = engine.setTime?.bind(engine);
  engine.setTime = (d) => {
    clock = d == null ? null : +new Date(d);
    return origSetTime?.(d);
  };
  const clockNow = () => clock ?? Date.now();

  /* ---------- situations cache ---------- */
  let sits = [];
  const origSituations = engine.situations?.bind(engine);
  const nativeCached = false; // the engine's own cached path is used when it exists
  engine.situations = async (opts = {}) => {
    if (opts?.cached && !nativeCached && sits.length)
      return sits.map((s) => ({ ...s, cached: true }));
    const list = (await origSituations?.(opts)) || [];
    if (Array.isArray(list) && list.length && !list[0]?.cached) sits = list;
    return list;
  };
  if (!has('cachedThumbnail'))
    put('cachedThumbnail', (s) => s?.thumbUrl || null);

  const contacts = (lon, lat, r) => {
    try {
      return engine.contactsNear?.(lon, lat, r) || [];
    } catch {
      return [];
    }
  };

  /* ---------- recorder ---------- */
  const boot = Date.now();
  put('history', () => {
    const start = historyHours ? Date.now() - historyHours * 3600e3 : boot;
    return { start, end: Date.now(), entities: 0, points: 0 };
  });
  put('trackOf', async () => []);

  /* ---------- Moments ---------- */
  let hero = null;
  const clips = new Map();
  async function loadHero() {
    if (hero) return hero;
    try {
      const r = await fetch(
        new URL('../demo/moments/empire-state.json', import.meta.url).href,
      );
      if (r.ok && /json/.test(r.headers.get('content-type') || '')) {
        const j = await r.json();
        if (j?.tracks?.length) hero = j;
      }
    } catch {
      /* bundled hero not present yet */
    }
    if (!hero) hero = buildHeroMoment();
    return hero;
  }
  put('moments', async () => [await loadHero(), ...clips.values()]);
  put('moment', async (id) => {
    if (clips.has(id)) return clips.get(id);
    const h = await loadHero();
    return h.id === id ? h : null;
  });
  put('momentOfTheDay', async () => loadHero());
  /** Shell-only: register a clip the time machine made. */
  engine._addClip = (m) => clips.set(m.id, m);

  /* ---------- playback ---------- */
  if (!engine.playback || typeof engine.playback.play !== 'function') {
    shimmed.push('playback');
    let playing = false;
    let speed = 60;
    let raf = 0;
    let last = 0;
    let lastEmit = 0;
    const state = () => ({ playing, speed, t: clockNow() });
    const step = (ts) => {
      raf = 0;
      if (!playing) return;
      const dt = Math.min(250, ts - (last || ts));
      last = ts;
      let t = clockNow() + dt * speed;
      const end = active ? active.time.end : Date.now();
      if (t >= end) {
        t = end;
        engine.setTime(active ? new Date(t) : null);
        tickMoment(t);
        playing = false;
        emit('playback', state());
        if (active) emit('moment', { type: 'end', t, momentId: active.id });
        return;
      }
      engine.setTime(new Date(t));
      tickMoment(t);
      if (ts - lastEmit > 240) {
        lastEmit = ts;
        emit('playback', state());
      }
      raf = requestAnimationFrame(step);
    };
    engine.playback = {
      play({ speed: s = 60 } = {}) {
        speed = s;
        if (clock == null) engine.setTime(new Date(Date.now() - 1000));
        if (active && clockNow() >= active.time.end - 500)
          engine.setTime(new Date(active.time.start));
        playing = true;
        last = 0;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(step);
        emit('playback', state());
      },
      stop() {
        playing = false;
        cancelAnimationFrame(raf);
        raf = 0;
        emit('playback', state());
      },
      state,
    };
  }

  /* ---------- the active Moment ---------- */
  let active = null;
  let lastMomentT = 0;
  let momentPins = [];
  let unhook = null;
  function tickMoment(t) {
    if (!active) return;
    const a = Math.min(lastMomentT, t);
    const b = t;
    if (b > lastMomentT) {
      for (const c of active.captures || [])
        if (c.t > a && c.t <= b)
          emit('moment', {
            type: 'capture',
            item: c,
            t: c.t,
            momentId: active.id,
          });
      for (const c of active.chat || [])
        if (c.t > a && c.t <= b)
          emit('moment', {
            type: 'chat',
            item: c,
            t: c.t,
            momentId: active.id,
          });
      for (const p of active.posts || [])
        if (p.t > a && p.t <= b)
          emit('moment', {
            type: 'post',
            item: p,
            t: p.t,
            momentId: active.id,
          });
    }
    lastMomentT = t;
    if (!unhook) syncPins(t);
  }
  /** Engines without a draw hook get moving pins (2 Hz) instead of trails. */
  let pinT = 0;
  function syncPins(t) {
    if (!engine.addPin || Math.abs(t - pinT) < 500 / 1) return;
    pinT = t;
    for (const id of momentPins) engine.removePin?.(id);
    momentPins = [];
    for (const tr of active.tracks || []) {
      const p = trackAt(tr, t);
      if (!p) continue;
      momentPins.push(
        engine.addPin({
          id: `m:${tr.id}`,
          lon: p.lon,
          lat: p.lat,
          altM: p.altM,
          kind: 'post',
          label: tr.label,
        }),
      );
    }
    for (const c of active.captures || [])
      if (c.t <= t)
        momentPins.push(
          engine.addPin({
            id: `m:${c.id}`,
            lon: c.lon,
            lat: c.lat,
            kind: c.live ? 'live' : 'eye',
            headingDeg: c.headingDeg,
            fovDeg: c.fovDeg,
            rangeM: Math.min(900, c.distanceM || 300),
            label: c.handle,
          }),
        );
  }

  const BAND_COL = {
    sky: '#a3d8ff',
    inside: '#ebc777',
    ground: '#ffb547',
    orbit: '#b39dff',
  };
  const TRACK_COL = ['#a3d8ff', '#ffd27a', '#ff9db0', '#9be15d'];
  function drawMoment(ctx, { project, t, ts }) {
    if (!active) return false;
    // Ghost trails (last 90 s) with a bright head and a label.
    (active.tracks || []).forEach((tr, i) => {
      const col = tr.color || TRACK_COL[i % TRACK_COL.length];
      const head = trackAt(tr, t);
      if (!head) return;
      const pts = tr.points;
      ctx.lineCap = 'round';
      let prev = null;
      for (let j = Math.max(0, head.i - 30); j <= head.i; j += 1) {
        const q = project(pts[j].lon, pts[j].lat, pts[j].altM);
        if (!q) continue;
        if (prev) {
          const k = 1 - (head.i - j) / 30;
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.08 + 0.75 * k * k;
          ctx.lineWidth = 1 + 1.6 * k;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        prev = q;
      }
      ctx.globalAlpha = 1;
      const p = project(head.lon, head.lat, head.altM);
      if (!p) return;
      // Drop line to the ground: altitude made visible.
      const g = project(head.lon, head.lat, 0);
      if (g) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(g.x, g.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((head.headingDeg || 0) * D2R);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(4.6, 5);
      ctx.lineTo(0, 2.6);
      ctx.lineTo(-4.6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // Rotor shimmer
      ctx.strokeStyle = `${col}88`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + Math.sin(ts / 70) * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(5,7,11,0.7)';
      const label = `${tr.callsign || tr.label} · ${Math.round(head.altM * 3.28084).toLocaleString()} FT`;
      const w = ctx.measureText(label).width;
      ctx.fillRect(p.x + 12, p.y - 17, w + 10, 15);
      ctx.fillStyle = col;
      ctx.fillText(label, p.x + 17, p.y - 6);
    });
    // Capture view cones (appear at their timestamps).
    for (const c of active.captures || []) {
      if (c.t > t) continue;
      const p = project(c.lon, c.lat, c.altM || 0);
      if (!p) continue;
      const subj = active.subject || active;
      const tgt = project(subj.lon, subj.lat, 0);
      const rangePx = tgt
        ? Math.max(40, Math.hypot(tgt.x - p.x, tgt.y - p.y) * 1.15)
        : 60;
      const hd = Math.atan2(tgt ? tgt.y - p.y : -1, tgt ? tgt.x - p.x : 0);
      const fov = (c.fovDeg || 52) * D2R;
      const age = (t - c.t) / 1000;
      const flash = Math.max(0, 1 - age / 6);
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, rangePx);
      g.addColorStop(0, `rgba(235,199,119,${0.42 + flash * 0.4})`);
      g.addColorStop(1, 'rgba(235,199,119,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, rangePx, hd - fov / 2, hd + fov / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = BAND_COL.inside;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + flash * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#050607';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (flash > 0) {
        ctx.strokeStyle = `rgba(235,199,119,${flash})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8 + (1 - flash) * 28, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // The subject.
    const subj = active.subject || active;
    const s = project(subj.lon, subj.lat, 0);
    if (s) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      const r = 9;
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(s.x + dx * r, s.y + dy * (r - 4));
        ctx.lineTo(s.x + dx * r, s.y + dy * r);
        ctx.lineTo(s.x + dx * (r - 4), s.y + dy * r);
        ctx.stroke();
      }
    }
    return true;
  }

  put(
    'playMoment',
    async (idOrMoment, { speed = 1, camera = true, autoplay = true } = {}) => {
      const m =
        typeof idOrMoment === 'string'
          ? await engine.moment(idOrMoment)
          : idOrMoment;
      if (!m) return null;
      engine._exitMomentQuiet?.();
      active = m;
      lastMomentT = m.time.start;
      engine.setTime(new Date(m.time.start));
      if (typeof engine._hook === 'function') unhook = engine._hook(drawMoment);
      if (camera && kind === 'stub') {
        // The stub looks straight down: frame the subject and its orbits.
        const c = m.subject
          ? { lon: m.subject.lon, lat: m.subject.lat - 0.0015, height: 3400 }
          : m.cameraPath?.[0] || { lon: m.lon, lat: m.lat, height: 400e3 };
        engine.flyTo?.({
          lon: c.lon,
          lat: c.lat,
          height: c.height,
          duration: 2.2,
        });
      } else if (camera) {
        const c = m.cameraPath?.[0] || { lon: m.lon, lat: m.lat, height: 3000 };
        engine.flyTo?.({
          lon: c.lon ?? m.lon,
          lat: c.lat ?? m.lat,
          height: c.height || 3000,
          heading: c.heading,
          pitch: c.pitch,
          duration: 2.2,
        });
      }
      emit('moment', { type: 'start', t: m.time.start, momentId: m.id });
      if (autoplay) engine.playback.play({ speed });
      return m;
    },
  );
  engine._exitMomentQuiet = () => {
    if (!active) return;
    unhook?.();
    unhook = null;
    for (const id of momentPins) engine.removePin?.(id);
    momentPins = [];
    active = null;
  };
  put('exitMoment', () => {
    engine.playback.stop();
    const id = active?.id;
    engine._exitMomentQuiet();
    engine.setTime(null);
    if (id) emit('moment', { type: 'end', t: Date.now(), momentId: id });
  });
  put('activeMoment', () =>
    active
      ? {
          id: active.id,
          title: active.title,
          t: clockNow(),
          start: active.time.start,
          end: active.time.end,
          playing: engine.playback.state().playing,
        }
      : null,
  );
  put('seekMoment', (t) => {
    if (!active) return;
    const ms =
      t <= 1 && t >= 0
        ? active.time.start + t * (active.time.end - active.time.start)
        : Math.max(active.time.start, Math.min(active.time.end, t));
    lastMomentT = Math.min(lastMomentT, ms);
    engine.setTime(new Date(ms));
    tickMoment(ms);
  });

  /* ---------- timeline ---------- */
  const SIT_KIND = (s) => {
    const k = `${s.kind || ''}`;
    if (/quake/.test(k)) return 'quake';
    if (/launch/.test(k)) return 'launch';
    if (/squawk/.test(k)) return 'squawk';
    if (/cyclone|typhoon|hurricane/.test(k)) return 'cyclone';
    if (/circling|heli/.test(k)) return 'circling';
    if (/lightning|storm/.test(k)) return 'lightning';
    if (/fire/.test(k)) return 'fire';
    return null;
  };
  put('timeline', ({ from = -Infinity, to = Infinity } = {}) => {
    const out = [];
    for (const s of sits) {
      const kind = SIT_KIND(s);
      for (const e of s.events || []) {
        out.push({
          t: +new Date(e.at),
          kind: kind || 'post',
          band: s.band || 'ground',
          title: `${e.label} · ${s.title}`,
          severity: Math.min(3, Math.round((s.severity || 0) / 1.6)),
          situationId: s.id,
          lon: s.lon,
          lat: s.lat,
        });
      }
      if (kind && s.updatedAt && !(s.events || []).length)
        out.push({
          t: +new Date(s.updatedAt) - (kind === 'squawk' ? 9 * 60e3 : 0),
          kind,
          band: s.band || 'ground',
          title: s.title,
          severity: Math.min(3, Math.round((s.severity || 0) / 1.6)),
          situationId: s.id,
          lon: s.lon,
          lat: s.lat,
        });
    }
    const h = hero;
    if (h) {
      out.push({
        t: h.time.start,
        kind: 'moment',
        band: 'inside',
        title: h.title,
        severity: 2,
        momentId: h.id,
        lon: h.lon,
        lat: h.lat,
      });
      for (const c of h.captures || [])
        out.push({
          t: c.t,
          kind: 'capture',
          band: 'inside',
          title: `${c.handle} · ${c.title}`,
          severity: c.firstEyes ? 2 : 1,
          momentId: h.id,
          entityId: `capture:${h.id}:${c.id}`,
          lon: c.lon,
          lat: c.lat,
        });
      for (const tr of h.tracks || [])
        out.push({
          t: tr.arriveAt || tr.points[0]?.t,
          kind: 'circling',
          band: 'sky',
          title: `${tr.label} on scene`,
          severity: 1,
          momentId: h.id,
          entityId: `moment:${h.id}:${tr.id}`,
          lon: h.lon,
          lat: h.lat,
        });
    }
    for (const m of clips.values())
      out.push({
        t: m.time.start,
        kind: 'moment',
        band: 'inside',
        title: m.title,
        severity: 1,
        momentId: m.id,
        lon: m.lon,
        lat: m.lat,
      });
    return out
      .filter((e) => Number.isFinite(e.t) && e.t >= from && e.t <= to)
      .sort((a, b) => a.t - b.t);
  });
  loadHero();

  put('detections', () =>
    sits.filter((s) => /circling|squawk|quake-cluster/.test(s.kind || '')),
  );

  /* ---------- entities ---------- */
  function allContacts() {
    return contacts(0, 0, 20040);
  }
  function findContact(id) {
    const raw = String(id).replace(/^[a-z]+:/, '');
    return (
      allContacts().find(
        (c) => String(c.id) === raw || String(c.id) === String(id),
      ) || null
    );
  }
  function placeNear(p, maxKm = 30) {
    let best = null;
    for (const pl of PLACES) {
      const d = km(p, pl);
      if (d <= maxKm && (!best || d < best.d)) best = { pl, d };
    }
    return best;
  }

  /** Resolve a ref to { node, base } synchronously (no network). */
  function resolve(ref) {
    if (ref && typeof ref === 'object') {
      if (ref.kind === 'situation') ref = `situation:${ref.id}`;
      else if (ref.kind === 'pin') ref = String(ref.id);
      else if (ref.id && /:/.test(String(ref.id))) ref = String(ref.id);
      else if (ref.id) {
        const c = findContact(ref.id);
        if (c) return contactNode(c, ref);
        return {
          id: `${normKind(ref.kind)}:${ref.id}`,
          kind: normKind(ref.kind) || 'track',
          title: ref.title || String(ref.id),
          subtitle: ref.subtitle || '',
          lon: ref.lon,
          lat: ref.lat,
          meta: ref.meta,
        };
      }
    }
    const id = String(ref || '');
    let m;
    if ((m = /^moment:([^:]+):(.+)$/.exec(id))) {
      const mo = momentById(m[1]);
      const tr = mo?.tracks?.find((x) => x.id === m[2]);
      if (tr)
        return {
          id,
          kind: 'helicopter',
          title: tr.label,
          subtitle: `${tr.type} · ${tr.operator}`,
          track: tr,
          moment: mo,
        };
    }
    if ((m = /^capture:([^:]+):(.+)$/.exec(id))) {
      const mo = momentById(m[1]);
      const c = mo?.captures?.find((x) => x.id === m[2]);
      if (c)
        return {
          id,
          kind: 'capture',
          title: c.title,
          subtitle: `${c.handle} · ${c.where || ''}`,
          capture: c,
          moment: mo,
          lon: c.lon,
          lat: c.lat,
        };
    }
    if ((m = /^moment:([^:]+)$/.exec(id))) {
      const mo = momentById(m[1]);
      if (mo)
        return {
          id,
          kind: 'moment',
          title: mo.title,
          subtitle: mo.place,
          moment: mo,
          lon: mo.lon,
          lat: mo.lat,
        };
    }
    if ((m = /^situation:(.+)$/.exec(id))) {
      const s = sits.find((x) => String(x.id) === m[1]);
      if (s)
        return {
          id,
          kind: 'situation',
          title: s.title,
          subtitle: s.place,
          situation: s,
          lon: s.lon,
          lat: s.lat,
        };
    }
    if ((m = /^place:(.+)$/.exec(id))) {
      const pl = PLACES.find((x) => x.slug === m[1]);
      if (pl)
        return {
          id,
          kind: 'place',
          title: pl.name,
          subtitle: pl.sub,
          place: pl,
          lon: pl.lon,
          lat: pl.lat,
        };
    }
    if ((m = /^cctv:(.+)$/.exec(id)))
      return {
        id,
        kind: 'camera',
        title: `Camera ${m[1]}`,
        subtitle: 'Public camera',
      };
    const c = findContact(id);
    if (c) return contactNode(c);
    const s = sits.find((x) => String(x.id) === id);
    if (s)
      return {
        id: `situation:${s.id}`,
        kind: 'situation',
        title: s.title,
        subtitle: s.place,
        situation: s,
        lon: s.lon,
        lat: s.lat,
      };
    return null;
  }
  function contactNode(c, pick) {
    const k = normKind(
      c.kind === 'aircraft' && /^(RCH|ARMY)/.test(c.title || '')
        ? 'military'
        : c.kind,
    );
    const layer =
      {
        aircraft: 'flights',
        military: 'military',
        helicopter: 'flights',
        satellite: 'satellites',
        vessel: 'vessels',
        quake: 'earthquakes',
      }[k] || k;
    return {
      id: `${layer}:${c.id}`,
      kind: k,
      title: c.title || pick?.title || String(c.id),
      subtitle: pick?.subtitle || '',
      lon: c.lon,
      lat: c.lat,
      contact: c,
      meta: pick?.meta,
    };
  }
  function momentById(id) {
    if (hero?.id === id) return hero;
    return clips.get(id) || null;
  }

  /** Links: everything a node touches. Only things, places and events. */
  function linksOf(n) {
    const out = [];
    const add = (o, relation, d) => {
      if (!o || o.id === n.id || out.some((x) => x.id === o.id)) return;
      out.push({
        id: o.id,
        kind: o.kind,
        title: o.title,
        relation,
        ...(Number.isFinite(d) ? { distanceKm: Math.round(d * 10) / 10 } : {}),
      });
    };
    const momentNode = (mo) => ({
      id: `moment:${mo.id}`,
      kind: 'moment',
      title: mo.title,
    });
    const trackNode = (mo, tr) => ({
      id: `moment:${mo.id}:${tr.id}`,
      kind: 'helicopter',
      title: tr.label,
    });
    const capNode = (mo, c) => ({
      id: `capture:${mo.id}:${c.id}`,
      kind: 'capture',
      title: `${c.handle} · ${c.where || c.title}`,
    });
    const placeNode = (pl) => ({
      id: `place:${pl.slug}`,
      kind: 'place',
      title: pl.name,
    });
    const sitNode = (s) => ({
      id: `situation:${s.id}`,
      kind: 'situation',
      title: s.title,
    });
    if (n.kind === 'moment' && n.moment) {
      const mo = n.moment;
      mo.tracks?.forEach((tr) => add(trackNode(mo, tr), 'track in'));
      mo.captures?.forEach((c) =>
        add(
          capNode(mo, c),
          c.firstEyes ? 'first eyes' : 'captured',
          c.distanceM / 1000,
        ),
      );
      const pl = placeNear(mo, 2);
      if (pl) add(placeNode(pl.pl), 'at');
      return out;
    }
    if (n.track && n.moment) {
      const mo = n.moment;
      add(momentNode(mo), 'part of');
      const pl = placeNear(mo, 2);
      if (pl)
        add(placeNode(pl.pl), 'orbiting', (n.track.radiusM || 500) / 1000);
      mo.tracks.forEach(
        (tr) => tr.id !== n.track.id && add(trackNode(mo, tr), 'orbiting with'),
      );
      mo.captures.forEach(
        (c) => c.t > (n.track.arriveAt || 0) && add(capNode(mo, c), 'seen by'),
      );
      return out;
    }
    if (n.capture && n.moment) {
      const mo = n.moment;
      add(momentNode(mo), 'part of');
      const pl = placeNear(mo, 2);
      if (pl) add(placeNode(pl.pl), 'looking at', n.capture.distanceM / 1000);
      mo.tracks.forEach(
        (tr) =>
          (tr.arriveAt || 0) < n.capture.t &&
          add(trackNode(mo, tr), 'in frame'),
      );
      return out;
    }
    const p = Number.isFinite(n.lat) ? ll(n) : null;
    if (!p) return out;
    if (n.situation) {
      const s = n.situation;
      const r = Math.max(
        20,
        Math.min(400, (s.camera?.height || 200e3) / 1000 / 2),
      );
      contacts(s.lon, s.lat, r)
        .filter((c) => c.kind !== 'satellite')
        .slice(0, 8)
        .forEach((c) => add(contactNode(c), 'in area', km(p, c)));
      if (s.momentId) {
        const mo = momentById(s.momentId);
        if (mo) add(momentNode(mo), 'moment');
      }
    } else {
      sits
        .filter((s) => Number.isFinite(s.lat) && km(p, s) < 600)
        .sort((a, b) => km(p, a) - km(p, b))
        .slice(0, 3)
        .forEach((s) => add(sitNode(s), 'near situation', km(p, s)));
      if (n.contact) {
        contacts(p.lon, p.lat, n.kind === 'satellite' ? 1500 : 40)
          .filter(
            (c) =>
              String(c.id) !== String(n.contact.id) &&
              (n.kind === 'satellite') === (c.kind === 'satellite'),
          )
          .slice(0, 6)
          .forEach((c) =>
            add(
              contactNode(c),
              n.kind === 'satellite' ? 'same sky' : 'nearby',
              km(p, c),
            ),
          );
      }
    }
    const pl = placeNear(p, 60);
    if (pl) add(placeNode(pl.pl), 'near', pl.d);
    if (hero && km(p, hero) < 30 && n.kind !== 'moment')
      add(momentNode(hero), 'moment nearby', km(p, hero));
    if (n.place) {
      contacts(p.lon, p.lat, 30)
        .slice(0, 6)
        .forEach((c) => add(contactNode(c), 'overhead now', km(p, c)));
    }
    return out;
  }

  put('entity', async (ref) => {
    const n = resolve(ref);
    if (!n) return null;
    const fetchedAt = Date.now();
    const identity = {};
    let live = null;
    let track = [];
    const events = [];
    const sources = [];
    if (n.track) {
      const tr = n.track;
      Object.assign(identity, {
        callsign: tr.callsign || tr.label,
        type: tr.type,
        operator: tr.operator,
        registration: tr.registration || 'Withheld (illustrative)',
        role: tr.role,
      });
      const p = trackAt(
        tr,
        Math.max(tr.points[0].t, Math.min(clockNow(), tr.points.at(-1).t)),
      );
      if (p)
        live = {
          lon: p.lon,
          lat: p.lat,
          altM: p.altM,
          speed: p.speedMps,
          heading: p.headingDeg,
          updatedAt: p.t,
        };
      track = tr.points;
      events.push({ t: tr.points[0].t, title: 'Departs base' });
      if (tr.arriveAt)
        events.push({
          t: tr.arriveAt,
          title: `On scene · orbit ${tr.radiusM} m`,
        });
      for (const b of n.moment.beats || [])
        if (
          new RegExp(
            String(tr.callsign || tr.label).split(/[\s(-]/)[0],
            'i',
          ).test(b.title) ||
          (/police/i.test(b.title) && tr.role === 'police')
        )
          events.push({ t: b.t, title: b.title });
      if (tr.radiusM && tr.speedKt) {
        const laps = Math.floor(
          ((n.moment.time.end - (tr.arriveAt || n.moment.time.start)) / 1000) *
            ((tr.speedKt * 0.5144) / (2 * Math.PI * tr.radiusM)),
        );
        events.push({
          t: n.moment.time.end,
          title: `${laps} orbits completed`,
        });
      }
      events.push({ t: tr.points.at(-1).t, title: 'Last recorded point' });
      sources.push({
        name: 'Illustrative track',
        fetchedAt,
        record: { id: tr.id, points: tr.points.length },
      });
    } else if (n.capture) {
      const c = n.capture;
      Object.assign(identity, {
        handle: c.handle,
        where: c.where || c.place,
        media: c.media || c.kind,
        sealed: c.sealed ? 'Yes · ECDSA P-256' : 'No',
        heading: `${c.headingDeg}°`,
        'field of view': `${c.fovDeg}°`,
      });
      live = { lon: c.lon, lat: c.lat, altM: c.altM, updatedAt: c.t };
      events.push({
        t: c.t,
        title: c.firstEyes
          ? 'First eyes · first sealed capture'
          : 'Sealed capture',
      });
      sources.push({ name: 'Illustrative capture', fetchedAt, record: c });
    } else if (n.moment && n.kind === 'moment') {
      const mo = n.moment;
      Object.assign(identity, {
        window: `${Math.round((mo.time.end - mo.time.start) / 60e3)} min`,
        tracks: mo.tracks?.length || 0,
        captures: mo.captures?.length || 0,
        illustrative: mo.illustrative ? 'Yes' : 'No',
      });
      live = { lon: mo.lon, lat: mo.lat, updatedAt: mo.time.end };
      events.push({ t: mo.time.start, title: 'Moment starts' });
      for (const c of mo.captures || [])
        events.push({
          t: c.t,
          title: `${c.handle} capture${c.firstEyes ? ' · first eyes' : ''}`,
        });
      for (const s of mo.sources || [])
        sources.push({ name: s.name, fetchedAt, record: s });
    } else if (n.situation) {
      const s = n.situation;
      Object.assign(identity, {
        kind: s.kind,
        band: s.band,
        archetype: s.archetype,
        telemetry: s.telemetry,
      });
      for (const m of s.metrics || [])
        identity[String(m.label).toLowerCase()] =
          `${m.value}${m.unit ? ` ${m.unit}` : ''}`;
      live = { lon: s.lon, lat: s.lat, updatedAt: s.updatedAt };
      track = (s.series || []).map((p) => ({ t: p.t, v: p.v }));
      for (const e of s.events || [])
        events.push({ t: +new Date(e.at), title: e.label });
      events.push({ t: +new Date(s.updatedAt), title: 'Last update' });
      sources.push({
        name: s.source || 'Live feed',
        fetchedAt: +new Date(s.updatedAt) || fetchedAt,
        record: { id: s.id, metrics: s.metrics, updatedAt: s.updatedAt },
      });
    } else if (n.place) {
      const pl = n.place;
      Object.assign(identity, {
        address: pl.sub,
        coordinates: `${pl.lat.toFixed(4)}, ${pl.lon.toFixed(4)}`,
      });
      live = { lon: pl.lon, lat: pl.lat, updatedAt: fetchedAt };
      sources.push({ name: 'Gazetteer', fetchedAt, record: pl });
    } else if (n.contact) {
      const c = n.contact;
      const isSat = n.kind === 'satellite';
      if (isSat)
        Object.assign(identity, {
          name: c.title,
          norad: String(
            25544 + (fnv(String(c.id)).charCodeAt(0) % 9) * 1111,
          ).slice(0, 5),
          orbit: `${Math.round((c.altM || 0) / 1000)} km`,
        });
      else if (n.kind === 'vessel')
        Object.assign(identity, {
          name: c.title,
          mmsi: `2${parseInt(fnv(String(c.id)).slice(0, 7), 16) % 100000000}`.slice(
            0,
            9,
          ),
          type: 'Cargo',
        });
      else
        Object.assign(identity, {
          callsign: c.title,
          icao24: fnv(String(c.id)).slice(0, 6),
          type:
            n.kind === 'military'
              ? 'C-17A'
              : /ARMY/.test(c.title)
                ? 'UH-72 Lakota'
                : 'A320neo',
          operator:
            n.kind === 'military'
              ? 'Military (public ADS-B)'
              : 'Airline (from callsign)',
        });
      live = {
        lon: c.lon,
        lat: c.lat,
        altM: c.altM,
        speed: c.speed ?? (isSat ? 7660 : n.kind === 'vessel' ? 6 : 230),
        heading: c.headingDeg,
        updatedAt: fetchedAt,
      };
      try {
        track = (await engine.trackOf?.(c.id)) || [];
      } catch {
        track = [];
      }
      if (track.length)
        events.push({ t: track[0].t, title: 'First recorded position' });
      events.push({ t: fetchedAt, title: 'Live position' });
      sources.push({
        name:
          kind === 'stub'
            ? 'Simulated contact · offline stub'
            : 'Live feed (shell shim)',
        fetchedAt,
        record: { id: c.id, lon: c.lon, lat: c.lat, altM: c.altM },
      });
    } else {
      live = Number.isFinite(n.lat)
        ? { lon: n.lon, lat: n.lat, updatedAt: fetchedAt }
        : null;
      sources.push({ name: 'Pick', fetchedAt, record: { id: n.id } });
    }
    for (const s of sources) {
      s.hash = await hashOf(s.record);
      delete s.record;
    }
    return {
      id: n.id,
      kind: n.kind,
      title: n.title,
      subtitle: n.subtitle,
      identity,
      live,
      track,
      events: events
        .filter((e) => Number.isFinite(e.t))
        .sort((a, b) => a.t - b.t),
      links: linksOf(n),
      sources,
      ...(n.moment?.illustrative ? { illustrative: true } : {}),
    };
  });

  put('graph', (ref) => {
    const root = resolve(ref);
    if (!root) return { nodes: [], edges: [] };
    const nodes = new Map([
      [root.id, { id: root.id, kind: root.kind, title: root.title }],
    ]);
    const edges = [];
    const queue = [[root, 0]];
    while (queue.length && nodes.size < 40) {
      const [n, depth] = queue.shift();
      for (const l of linksOf(n)) {
        if (!nodes.has(l.id)) {
          if (nodes.size >= 40) break;
          nodes.set(l.id, { id: l.id, kind: l.kind, title: l.title });
          if (depth < 1) {
            const nn = resolve(l.id);
            if (nn) queue.push([nn, depth + 1]);
          }
        }
        if (
          !edges.some(
            (e) =>
              (e.from === n.id && e.to === l.id) ||
              (e.from === l.id && e.to === n.id),
          )
        )
          edges.push({ from: n.id, to: l.id, relation: l.relation });
      }
    }
    return { nodes: [...nodes.values()], edges };
  });

  /* ---------- search ---------- */
  put('search', async (query) => {
    const q = String(query || '')
      .trim()
      .toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const hit = (...f) => {
      const s = f.join(' ').toLowerCase();
      return words.every((w) => s.includes(w));
    };
    const out = [];
    await loadHero();
    for (const s of sits)
      if (
        hit(
          s.title,
          s.place,
          s.kind,
          s.telemetry,
          (s.metrics || []).map((m) => `${m.value}`).join(' '),
          s.subtitle,
        )
      )
        out.push({
          id: `situation:${s.id}`,
          kind: 'situation',
          title: s.title,
          subtitle: s.place,
          band: s.band,
          lon: s.lon,
          lat: s.lat,
        });
    for (const m of [hero, ...clips.values()].filter(Boolean))
      if (hit(m.title, m.place, 'moment'))
        out.push({
          id: `moment:${m.id}`,
          kind: 'moment',
          title: m.title,
          subtitle: `${m.place}${m.illustrative ? ' · illustrative' : ''}`,
          lon: m.lon,
          lat: m.lat,
        });
    for (const tr of hero?.tracks || [])
      if (hit(tr.label, tr.operator, tr.type, 'helicopter'))
        out.push({
          id: `moment:${hero.id}:${tr.id}`,
          kind: 'helicopter',
          title: tr.label,
          subtitle: `${tr.type} · ${hero.title}`,
        });
    for (const pl of PLACES)
      if (hit(pl.name, pl.sub))
        out.push({
          id: `place:${pl.slug}`,
          kind: 'place',
          title: pl.name,
          subtitle: pl.sub,
          lon: pl.lon,
          lat: pl.lat,
        });
    let n = 0;
    for (const c of allContacts()) {
      if (n >= 12) break;
      const k = normKind(c.kind);
      if (hit(c.title, String(c.id), k)) {
        n += 1;
        const node = contactNode(c);
        out.push({
          id: node.id,
          kind: node.kind,
          title: node.title,
          subtitle: `${k[0].toUpperCase()}${k.slice(1)}${Number.isFinite(c.altM) && c.altM > 0 ? ` · ${c.altM > 100e3 ? `${Math.round(c.altM / 1000)} km` : `${Math.round(c.altM * 3.28084).toLocaleString()} ft`}` : ''}`,
          lon: c.lon,
          lat: c.lat,
        });
      }
    }
    return out;
  });

  /* ---------- reactions ---------- */
  const glyphs = [];
  let reactHook = null;
  const GLYPH = {
    heart: '#ff5a7a',
    fire: '#ff9f43',
    eyes: '#f4f7fb',
    wow: '#ffd166',
  };
  function drawGlyph(ctx, kind, x, y, s, a) {
    ctx.globalAlpha = a;
    ctx.fillStyle = GLYPH[kind] || '#fff';
    ctx.strokeStyle = GLYPH[kind] || '#fff';
    if (kind === 'heart') {
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.35);
      ctx.bezierCurveTo(
        x - s,
        y - s * 0.3,
        x - s * 0.4,
        y - s,
        x,
        y - s * 0.45,
      );
      ctx.bezierCurveTo(
        x + s * 0.4,
        y - s,
        x + s,
        y - s * 0.3,
        x,
        y + s * 0.35,
      );
      ctx.fill();
    } else if (kind === 'fire') {
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.quadraticCurveTo(x + s * 0.8, y - s * 0.1, x + s * 0.45, y + s * 0.5);
      ctx.quadraticCurveTo(x, y + s * 0.75, x - s * 0.45, y + s * 0.5);
      ctx.quadraticCurveTo(x - s * 0.8, y - s * 0.1, x, y - s);
      ctx.fill();
    } else if (kind === 'eyes') {
      for (const dx of [-0.42, 0.42]) {
        ctx.beginPath();
        ctx.ellipse(x + dx * s, y, s * 0.36, s * 0.48, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#050607';
      for (const dx of [-0.36, 0.48]) {
        ctx.beginPath();
        ctx.arc(x + dx * s, y + s * 0.1, s * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(x, y, s * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#050607';
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.18, s * 0.16, s * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  put('react', ({ lon, lat, kind: k = 'heart', count = 1 } = {}) => {
    if (!Number.isFinite(lat)) return;
    const n0 = performance.now();
    for (let i = 0; i < Math.min(12, count); i += 1)
      glyphs.push({
        lon,
        lat,
        kind: k,
        t0: n0 + i * 90,
        dx: (Math.random() - 0.5) * 40,
        ph: Math.random() * 6,
      });
    while (glyphs.length > 300) glyphs.shift();
    if (!reactHook && typeof engine._hook === 'function')
      reactHook = engine._hook((ctx, { project }) => {
        const now = performance.now();
        for (let i = glyphs.length - 1; i >= 0; i -= 1) {
          const g = glyphs[i];
          const age = (now - g.t0) / 2600;
          if (age < 0) continue;
          if (age > 1) {
            glyphs.splice(i, 1);
            continue;
          }
          const p = project(g.lon, g.lat, 0);
          if (!p) continue;
          const y = p.y - age * 150;
          const x = p.x + g.dx * age + Math.sin(age * 9 + g.ph) * 8;
          drawGlyph(
            ctx,
            g.kind,
            x,
            y,
            7 + age * 4,
            Math.min(1, (1 - age) * 1.6),
          );
        }
        return glyphs.length > 0;
      });
  });
  put('attentionHeat', () => {});

  /* ---------- your sky now ---------- */
  function lookAngles(o, c) {
    const d = distM(o, c);
    const h = c.altM || 0;
    const th = d / R_E;
    const el = Math.atan2(Math.cos(th) - R_E / (R_E + h), Math.sin(th)) * R2D;
    return {
      elevationDeg: Math.round(el * 10) / 10,
      azimuthDeg: Math.round(bearing(o, c)),
      distanceKm: Math.round(d / 100) / 10,
    };
  }
  put('skyNow', async ({ lon, lat } = {}) => {
    const o = { lon, lat };
    const aircraft = contacts(lon, lat, 50)
      .filter((c) => /aircraft|helicopter|military/.test(c.kind))
      .map((c) => ({
        id: contactNode(c).id,
        title: c.title,
        kind: c.kind,
        lon: c.lon,
        lat: c.lat,
        altM: c.altM,
        headingDeg: c.headingDeg,
        speedMps: c.speed ?? 220,
        ...lookAngles(o, c),
      }))
      .sort((a, b) => b.elevationDeg - a.elevationDeg);
    const satellites = contacts(lon, lat, 2600)
      .filter((c) => c.kind === 'satellite')
      .map((c) => {
        const la = lookAngles(o, c);
        return {
          id: contactNode(c).id,
          title: c.title,
          norad: null,
          altKm: Math.round((c.altM || 0) / 1000),
          elevationDeg: la.elevationDeg,
          azimuthDeg: la.azimuthDeg,
          rangeKm: Math.round(Math.hypot(la.distanceKm, (c.altM || 0) / 1000)),
        };
      })
      .filter((s) => s.elevationDeg > 0)
      .sort((a, b) => b.elevationDeg - a.elevationDeg);
    const issC = contacts(lon, lat, 20040).find((c) =>
      /iss|zarya/i.test(`${c.id} ${c.title}`),
    );
    const issLa = issC ? lookAngles(o, issC) : null;
    let nextPass = null;
    if (typeof engine._issPass === 'function')
      nextPass = engine._issPass(lon, lat);
    else {
      const s = sits.find((x) => /iss/.test(x.kind || ''));
      if (s?.time?.start)
        nextPass = {
          start: +s.time.start,
          max: +s.time.start + 3 * 60e3,
          end: +s.time.start + 6 * 60e3,
          maxElevationDeg: null,
        };
    }
    return {
      aircraft,
      satellites,
      iss: {
        visibleNow: !!issLa && issLa.elevationDeg > 10,
        elevationDeg: issLa?.elevationDeg ?? null,
        azimuthDeg: issLa?.azimuthDeg ?? null,
        nextPass,
      },
    };
  });

  return { shimmed };
}
