/**
 * Need eyes (DESIGN.md §12.2): any room can ask for coverage at a place
 * ("Is the 7th St underpass flooded?"). People nearby get one quiet ask;
 * fulfilling it with a sealed capture earns Signal and the byline. This is
 * the incentive Citizen never had: curiosity turned into coverage.
 *
 * Seeded requests are EXAMPLES tied to live situations (fictional askers);
 * requests the person makes are real, stored on this device and shared with
 * their other tabs.
 */

import { icon } from './icons.js';
import {
  $,
  $$,
  h,
  esc,
  ago,
  haptic,
  toast,
  emitter,
  esriThumb,
  reducedMotion,
} from './dom.js';
import { createSheet } from './sheet.js';
import { createMiniMap } from './minimap.js';
import { distKm, fmtKm, llShort, utc, bandOf } from './bands.js';
import { genre as roomGenre } from './rooms.js';
import { get, put } from '../capture/db.js';
import { tierOf, RULE, hashStr } from './signal.js';

/** Per-genre questions, written like people actually ask. */
const ASKS = {
  circling: [
    'What are the helicopters circling? Anyone on 34th St with a view up?',
    'Can someone at street level see what’s on the building?',
  ],
  lightning: [
    'Anyone on the coast with a view of the line? Need a sealed photo of the shelf cloud.',
  ],
  storm: [
    'Is the 7th St underpass flooded? Radar has the core right over it.',
    'Are the streetlights out along the waterfront?',
  ],
  cyclone: [
    'Is the seawall at the harbour overtopping yet?',
    'How high is the water at the fish port right now?',
  ],
  fire: [
    'Flames or just smoke from the ridge road? Need a photo facing east.',
    'Is the smoke reaching the school on the valley floor?',
  ],
  quake: [
    'Any visible damage to the old brick blocks downtown?',
    'Is the bridge open? Need a photo from either end.',
  ],
  squawk: [
    'Anyone at the airport fence to see the landing?',
    'Are there fire trucks on the taxiway?',
  ],
  orbit: [
    'Clear enough to see the pass tonight? Need a sky photo facing west.',
    'Is it cloudy where you are? Need a sky check before the pass.',
  ],
  eye: [
    'Is the lane closure still on? The camera angle can’t tell.',
    'How long is the line at the corner right now?',
  ],
  sea: ['How many ships can you count from the breakwater?'],
  air: [
    'Which runway are they landing on? Need a photo from the viewing area.',
  ],
  gnss: ['Anyone flying through tonight with a nav display photo?'],
  recon: ['Can anyone photograph the upstream bridge abutment?'],
  default: ['What does it look like from street level right now?'],
};
const ASKERS = [
  '@riverside.example',
  '@lena.example',
  '@datadesk.example',
  '@metdesk.example',
  '@skeptic.example',
];

/** Modal sheets created early must still open above later ones. */
export const front = (sh) => sh.root.parentElement?.appendChild(sh.root);

export function createNeeds(core) {
  const ev = emitter();
  let seeds = []; // examples from situations
  let near = new Map(); // key → examples near a point
  let mine = []; // the person's requests and fulfilments
  let done = {}; // id → fulfilment
  const ready = (async () => {
    const rec = await get('kv', 'needEyes').catch(() => null);
    mine = rec?.list || [];
    done = rec?.done || {};
    ev.emit('change');
  })();
  async function save() {
    await put('kv', { id: 'needEyes', list: mine, done }).catch(() => {});
  }
  core.rt.on('need', (req) => {
    if (!req?.id) return;
    const i = mine.findIndex((x) => x.id === req.id);
    if (i >= 0) mine[i] = { ...mine[i], ...req };
    else mine.unshift({ ...req, remote: true });
    if (req.fulfilledBy) done[req.id] = req.fulfilledBy;
    ev.emit('change');
  });

  /** Seeds: one example request for each of the most active situations. */
  function seedFrom(sits) {
    const out = [];
    const seen = new Set();
    for (const s of sits) {
      if (!Number.isFinite(s.lat)) continue;
      const g = roomGenre(s);
      const k = /lightning/.test(s.kind || '') ? 'lightning' : g;
      if (seen.has(k) || out.length >= 14) continue;
      seen.add(k);
      const list = ASKS[k] || ASKS[g] || ASKS.default;
      const hs = hashStr(s.id);
      const q = list[hs % list.length];
      // A spot near the situation, not on top of it (a street, a pier).
      const km =
        g === 'cyclone'
          ? 60
          : g === 'eye'
            ? 0.15
            : g === 'circling'
              ? 0.25
              : 1.2;
      const ang = ((hs % 360) * Math.PI) / 180;
      const dLat = (km / 111) * Math.cos(ang);
      const dLon =
        (km / (111 * Math.cos((s.lat * Math.PI) / 180))) * Math.sin(ang);
      out.push({
        id: `need-${s.id}`,
        room: String(s.id),
        roomTitle: s.title,
        situation: s,
        question: q,
        lat: s.lat + dLat,
        lon: s.lon + dLon,
        radiusKm: g === 'cyclone' ? 25 : 2,
        at:
          (Number(new Date(s.updatedAt)) || Date.now()) -
          (8 + (hs % 30)) * 60e3,
        by: ASKERS[hs % ASKERS.length],
        asked: 12 + (hs % 70),
        example: true,
        genre: g,
      });
    }
    seeds = out;
    ev.emit('change');
  }
  core
    .situations?.()
    .then(seedFrom)
    .catch(() => {});

  /** Example requests near any point (Your sky, a street check). */
  function nearSeeds(ll) {
    if (!ll || !Number.isFinite(ll.lat)) return [];
    const key = `${ll.lat.toFixed(1)},${ll.lon.toFixed(1)}`;
    if (near.has(key)) return near.get(key);
    const place = (title, dLat, dLon, extra = {}) => ({
      id: `place-near-${key}-${hashStr(title).toString(36)}`,
      kind: 'place',
      family: 'eyes',
      band: 'inside',
      archetype: 'sensor',
      title,
      place: llShort(ll.lat + dLat, ll.lon + dLon, 2),
      lat: ll.lat + dLat,
      lon: ll.lon + dLon,
      live: true,
      updatedAt: Date.now(),
      source: 'Need eyes request',
      metrics: [],
      layers: [],
      camera: {
        lon: ll.lon + dLon,
        lat: ll.lat + dLat,
        height: 3000,
        heading: 0,
        pitch: -45,
      },
      adhoc: true,
      ...extra,
    });
    const sky = place('Sky check before tonight’s ISS pass', 0.006, -0.004, {
      kind: 'iss',
      band: 'orbit',
    });
    const street = place('Street check near you', -0.009, 0.007);
    const list = [
      {
        id: `need-near-${key}-sky`,
        room: sky.id,
        roomTitle: sky.title,
        situation: sky,
        question:
          'Is the sky clear enough for the ISS pass? Need a sealed photo facing west.',
        lat: sky.lat,
        lon: sky.lon,
        radiusKm: 5,
        at: Date.now() - 14 * 60e3,
        by: '@pass_predictor',
        asked: 23,
        example: true,
        genre: 'orbit',
      },
      {
        id: `need-near-${key}-street`,
        room: street.id,
        roomTitle: street.title,
        situation: street,
        question:
          'Traffic sensors show a slowdown on the main road. Crash or roadworks?',
        lat: street.lat,
        lon: street.lon,
        radiusKm: 2,
        at: Date.now() - 6 * 60e3,
        by: '@datadesk.example',
        asked: 9,
        example: true,
        genre: 'default',
      },
    ];
    near.set(key, list);
    return list;
  }

  const decorate = (r) => {
    const loc = core.getLocation?.() || null;
    const km = loc ? distKm(loc, r) : NaN;
    const f = done[r.id] || r.fulfilledBy || null;
    return {
      ...r,
      km,
      distLabel:
        Number.isFinite(km) && km <= 150
          ? `${fmtKm(km)} from you`
          : `${fmtKm(r.radiusKm)} radius`,
      status: f ? 'fulfilled' : 'open',
      fulfilledBy: f,
    };
  };
  function allList() {
    const ids = new Set();
    const nearAll = [...near.values()].flat();
    return [...mine, ...seeds, ...nearAll]
      .filter((r) => (ids.has(r.id) ? false : ids.add(r.id)))
      .map(decorate);
  }
  function forRoom(roomId) {
    return allList().filter(
      (r) => r.room === String(roomId) && r.status === 'open',
    );
  }
  function nearPoint(ll, km = 25) {
    if (!ll || !Number.isFinite(ll.lat)) return [];
    nearSeeds(ll);
    return allList()
      .map((r) => ({ ...r, km: distKm(ll, r) }))
      .filter((r) => r.km <= Math.max(km, r.radiusKm || 0))
      .sort((a, b) =>
        a.status === b.status ? a.km - b.km : a.status === 'open' ? -1 : 1,
      )
      .map((r) => ({ ...r, distLabel: `${fmtKm(r.km)} away` }));
  }
  const byId = (id) => allList().find((r) => r.id === id) || null;

  /* ---------------- UI: card ---------------- */
  function cardHtml(r) {
    const f = r.fulfilledBy;
    return `<div class="need-card ${f ? 'is-done' : ''}" data-need="${esc(r.id)}" data-band="${esc(bandOf(r.situation || {}))}">
      <div class="nc-top tele">${icon('eyes')}<b>Need eyes</b><span>· ${esc(r.distLabel || '')}</span>${r.example ? '<em class="badge-example">Example</em>' : ''}</div>
      <p class="nc-q">“${esc(r.question)}”</p>
      <div class="nc-by tele">${esc(r.by)} · ${esc(ago(r.at))} · ${r.asked} nearby asked once</div>
      ${
        f
          ? `<div class="nc-done tele">${icon('sealFill')}Fulfilled · ${esc(f.handle)} · ${esc(utc(new Date(f.at)))}${Number.isFinite(f.km) ? ` · ${esc(fmtKm(f.km))}` : ''}</div>`
          : r.self
            ? `<div class="nc-done tele mine">${icon('clock')}Your request · waiting for a sealed answer · expires in 2 h</div>`
            : `<div class="nc-acts"><button type="button" class="pill-btn primary sm" data-need-act="fulfil" data-need="${esc(r.id)}">${icon('viewfinder')}I’m nearby · answer</button><span class="tele nc-reward">+${RULE.fulfil.delta} Signal · byline</span><button type="button" class="pill-btn plain sm" data-need-act="detail" data-need="${esc(r.id)}">Details</button></div>`
      }
    </div>`;
  }

  /* ---------------- UI: create ---------------- */
  const createS = createSheet({
    label: 'Ask for eyes',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'need-sheet opaque',
    heights: { large: (H) => Math.round(Math.min(H * 0.9, 820)) },
  });
  let cctx = null;
  function openCreate(s) {
    front(createS);
    const g = roomGenre(s);
    cctx = { s, center: { lat: s.lat, lon: s.lon }, radius: 2 };
    createS.head.innerHTML = `<div class="c-band tele" data-band="inside"><i class="bd"></i>Need eyes<b>·</b>${esc(s.title)}</div>
      <h2 class="sheet-title">Ask for eyes on a spot</h2>
      <div class="sheet-sub">People within the radius get one quiet ask. The first sealed answer gets the byline and Signal.</div>`;
    createS.body.innerHTML = `<div class="need-map"></div>
      <div class="att-h tele">Your question</div>
      <textarea class="cmp-text need-q" rows="2" maxlength="160" data-no-drag placeholder="What should someone there look at?"></textarea>
      <div class="need-sugg">${(ASKS[g] || ASKS.default).map((q) => `<button type="button" class="chip" data-sugg="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="att-h tele">Ask people within</div>
      <div class="seg-chips" data-radius>${[0.5, 2, 10].map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === 2}">${fmtKm(v)}</button>`).join('')}</div>
      <p class="att-fine">Calm by default: each person gets at most one ask a day, only inside the radius, never with a sound. Requests expire after 2 hours.</p>
      <button class="pill-btn primary att-post" type="button" data-act="ask">${icon('eyes')}Ask for eyes</button>`;
    createS.open('large');
    requestAnimationFrame(() => {
      const mm = createMiniMap($('.need-map', createS.body), {
        lat: s.lat,
        lon: s.lon,
        spanDeg: g === 'cyclone' ? 1.2 : 0.03,
        label: 'Drag the map to the spot',
        onChange: (c) => (cctx.center = c),
      });
      cctx.mm = mm;
    });
  }
  createS.root.addEventListener('click', async (e) => {
    if (!cctx) return;
    const sg = e.target.closest('[data-sugg]');
    if (sg) {
      $('.need-q', createS.body).value = sg.dataset.sugg;
      haptic('tick');
      return;
    }
    const rb = e.target.closest('[data-radius] button');
    if (rb) {
      cctx.radius = Number(rb.dataset.v);
      $$('[data-radius] button', createS.body).forEach((b) =>
        b.setAttribute('aria-pressed', String(b === rb)),
      );
      haptic('tick');
      return;
    }
    if (e.target.closest('[data-act="ask"]')) {
      const q = $('.need-q', createS.body).value.trim();
      if (!q) {
        $('.need-q', createS.body).focus();
        toast('Write the question first');
        return;
      }
      const s = cctx.s;
      const req = {
        id: `need-${core.rt.tab}-${Date.now().toString(36)}`,
        room: String(s.id),
        roomTitle: s.title,
        situation: slim(s),
        question: q,
        lat: cctx.center.lat,
        lon: cctx.center.lon,
        radiusKm: cctx.radius,
        at: Date.now(),
        by: core.rt.me.handle,
        self: true,
        asked: Math.max(3, Math.round(cctx.radius * 17 + (hashStr(q) % 20))),
        genre: roomGenre(s),
      };
      mine.unshift(req);
      await save();
      core.rt.need(req);
      ev.emit('change');
      haptic('success');
      createS.close();
      toast(
        `Asked · about ${req.asked} people nearby get one quiet ask (simulated)`,
        {
          icon: icon('eyes'),
        },
      );
      core.hub(s)?.push({
        id: `sys-need-${req.id}`,
        system: true,
        handle: 'Need eyes',
        text: `${req.by} asked for eyes: “${q}” · ${fmtKm(req.radiusKm)} radius`,
        at: Date.now(),
      });
    }
  });
  const slim = (s) => ({
    id: s.id,
    kind: s.kind,
    family: s.family,
    band: s.band,
    archetype: s.archetype,
    title: s.title,
    place: s.place,
    lat: s.lat,
    lon: s.lon,
    live: s.live,
    updatedAt: s.updatedAt,
    source: s.source,
    metrics: s.metrics || [],
    layers: s.layers || [],
    camera: s.camera,
    momentId: s.momentId,
    adhoc: s.adhoc,
  });

  /* ---------------- UI: detail ---------------- */
  const detailS = createSheet({
    label: 'Need eyes',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'need-sheet opaque',
    heights: { large: (H) => Math.round(Math.min(H * 0.72, 640)) },
  });
  function openDetail(id) {
    const r = byId(id);
    if (!r) return;
    front(detailS);
    detailS.head.innerHTML = `<div class="c-band tele" data-band="inside"><i class="bd"></i>Need eyes<b>·</b>${esc(r.roomTitle || '')}</div>
      <h2 class="sheet-title">“${esc(r.question)}”</h2>
      <div class="sheet-sub">Asked by ${esc(r.by)} · ${esc(ago(r.at))} · ${r.asked} people nearby asked once${r.example ? ' · <span class="badge-example">Example</span>' : ''}</div>`;
    detailS.body.innerHTML = `<div class="need-shot" style="background-image:url('${esc(esriThumb(r.lon, r.lat, r.radiusKm > 10 ? 0.8 : 0.02, 640, 360))}')"><span class="ns-pin">${icon('pin')}</span><span class="ns-ring" style="--r:${Math.min(46, 18 + r.radiusKm * 4)}%"></span><span class="ns-tele tele">${esc(llShort(r.lat, r.lon, 4))} · ${esc(fmtKm(r.radiusKm))} RADIUS</span></div>
      <ul class="need-why">
        <li>${icon('sealFill')}<span><b>Answer with a sealed capture</b> from inside the radius. Text answers don’t fulfil a request.</span></li>
        <li>${icon('eyes')}<span><b>First eyes</b> on a request is a permanent byline on the record.</span></li>
        <li>${icon('sparkles')}<span><b>+${RULE.fulfil.delta} Signal</b>, more if sensors corroborate it. Signal weighs your votes and notes.</span></li>
      </ul>
      ${
        r.fulfilledBy
          ? `<div class="nc-done tele">${icon('sealFill')}Fulfilled by ${esc(r.fulfilledBy.handle)} · ${esc(utc(new Date(r.fulfilledBy.at)))}</div>`
          : `<button class="pill-btn primary att-post" type="button" data-need-act="fulfil" data-need="${esc(r.id)}">${icon('viewfinder')}I’m nearby · answer with a capture</button>`
      }`;
    detailS.open('large');
  }
  detailS.root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-need-act]');
    if (b) {
      detailS.close();
      act(b.dataset.needAct, b.dataset.need);
    }
  });

  function act(action, id) {
    const r = byId(id);
    if (!r) return;
    haptic('light');
    if (action === 'detail') openDetail(id);
    else if (action === 'fulfil') {
      if (r.status === 'fulfilled') {
        toast('Already fulfilled · thank you');
        return;
      }
      core.onCapture?.(r.situation, { needEyes: r });
    }
  }

  /** Called after a sealed capture is posted against a request. */
  async function fulfil(req, post, { km = NaN } = {}) {
    await ready;
    const f = {
      handle: core.rt.me.handle,
      at: post.anchor?.t || post.at,
      post: post.id,
      room: post.room,
      km,
      self: true,
    };
    done[req.id] = f;
    const i = mine.findIndex((x) => x.id === req.id);
    if (i >= 0) mine[i] = { ...mine[i], fulfilledBy: f };
    await save();
    core.rt.need({
      ...req,
      situation: req.situation ? slim(req.situation) : null,
      fulfilledBy: f,
    });
    ev.emit('change');
    return f;
  }

  return {
    on: ev.on,
    off: ev.off,
    ready,
    all: allList,
    forRoom,
    near: nearPoint,
    byId,
    cardHtml,
    openCreate,
    openDetail,
    act,
    fulfil,
    seedFrom,
  };
}

/* ---------------- The byline moment ---------------- */

/**
 * A satisfying, honest moment after a capture earns Signal: the seal
 * stamps, the byline types out, the score counts up receipt by receipt.
 * @param {{ byline?: string, first?: boolean, need?: object,
 *   receipts: { delta, text }[], before: number, after: number,
 *   onRecord?(): void }} o
 */
export function celebrate(o) {
  const t0 = tierOf(o.before);
  const t1 = tierOf(o.after);
  const el =
    h(`<div class="byline-moment" role="dialog" aria-label="${o.first ? 'First eyes' : 'Signal earned'}">
      <div class="bm-card">
        <div class="bm-seal">${icon('sealFill')}<i></i><i></i></div>
        <div class="bm-kicker tele">${o.need ? 'Need eyes fulfilled' : 'Sealed capture posted'}</div>
        <h2>${o.first ? 'First eyes' : 'On the record'}</h2>
        ${o.need ? `<p class="bm-q">“${esc(o.need.question)}”</p>` : ''}
        <div class="bm-byline tele"><span data-type></span><b class="caret"></b></div>
        <ul class="bm-rx">${o.receipts.map((r, i) => `<li style="--i:${i}"><span>${esc(r.text)}</span><b class="num ${r.delta < 0 ? 'neg' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</b></li>`).join('')}</ul>
        <div class="bm-score"><span class="tele">Signal</span><b class="num" data-score>${o.before}</b><span class="bm-tier" style="--tc:${t1.color}">${esc(t1.name)}</span></div>
        <div class="bm-bar" style="--tc:${t1.color}"><i style="--p:${Math.round(t0.progress * 100)}%"></i></div>
        <div class="bm-next tele">${t1.next ? `${t1.next.min - o.after} to ${esc(t1.next.name)} · your votes now weigh ×${t1.weight.toFixed(1)}` : `Top tier · votes weigh ×${t1.weight.toFixed(1)}`}</div>
        ${t1.index > t0.index ? `<div class="bm-up tele">${icon('sparkles')}Tier up · ${esc(t0.name)} → ${esc(t1.name)}</div>` : ''}
        <div class="bm-acts"><button type="button" class="pill-btn plain" data-bm="done">Done</button>${o.onRecord ? `<button type="button" class="pill-btn primary" data-bm="record">${icon('note')}See it in the Record</button>` : ''}</div>
        <p class="bm-fine">Receipts are kept in You → Signal, each with its reason and source.</p>
      </div>
    </div>`);
  document.body.appendChild(el);
  haptic('seal');
  requestAnimationFrame(() => el.classList.add('show'));
  // Type the byline.
  const tgt = $('[data-type]', el);
  const text = o.byline || '';
  let i = 0;
  const typer = setInterval(
    () => {
      i += 2;
      tgt.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(typer);
    },
    reducedMotion() ? 0 : 28,
  );
  // Count the score up.
  const sc = $('[data-score]', el);
  const bar = $('.bm-bar i', el);
  const start = performance.now() + 700;
  const dur = reducedMotion() ? 1 : 1600;
  const step = (now) => {
    const k = Math.max(0, Math.min(1, (now - start) / dur));
    const e = 1 - (1 - k) ** 3;
    const v = Math.round(o.before + (o.after - o.before) * e);
    sc.textContent = v.toLocaleString();
    const tv = tierOf(v);
    bar.style.setProperty('--p', `${Math.round(tv.progress * 100)}%`);
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  const close = () => {
    clearInterval(typer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 380);
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bm]');
    if (b?.dataset.bm === 'record') {
      close();
      o.onRecord?.();
    } else if (b || e.target === el) close();
  });
  return { close, el };
}
