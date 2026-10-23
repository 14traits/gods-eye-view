/**
 * Globe chrome: camera readout, lens switcher, compass/home, attribution,
 * the lens dock of eight families, Control-Center-style layer grids,
 * the time ribbon and the pick card.
 */

import { icon, FAMILIES, FAMILY_ICON } from './icons.js';
import {
  $,
  $$,
  h,
  esc,
  fmtNum,
  haptic,
  toast,
  store,
  onLongPress,
} from './dom.js';
import { createSheet } from './sheet.js';
import { createTimeRibbon } from './timeRibbon.js';
import { createEyeViewer } from './eyeViewer.js';
import { BAND_NAME, BAND_COLOR, llShort, mgrs } from './bands.js';

/** Altitude → band: where the virtual sensor is. */
const bandAt = (h) => (h > 100e3 ? 'orbit' : h > 2500 ? 'sky' : 'ground');
const ALT_MAX = 36000e3;
const ALT_MIN = 100;
const altFrac = (h) =>
  Math.min(
    1,
    Math.max(
      0,
      Math.log(Math.max(ALT_MIN, h) / ALT_MIN) / Math.log(ALT_MAX / ALT_MIN),
    ),
  );

const LENSES = [
  {
    id: 'cinematic',
    name: 'Cinematic',
    sw: 'linear-gradient(135deg,#0b2a4a,#3a77b8 55%,#f3b46b)',
  },
  {
    id: 'clear',
    name: 'Clear',
    sw: 'linear-gradient(135deg,#2a6fb0,#7fb7e6 60%,#e8f1f8)',
  },
  {
    id: 'night',
    name: 'Night',
    sw: 'radial-gradient(circle at 40% 60%,#ffcf6b 0,#c27a2a 8%,#0b1020 26%,#03050a)',
  },
  {
    id: 'thermal',
    name: 'Thermal',
    sw: 'linear-gradient(135deg,#120428,#7a1fa2 35%,#ff5a1f 70%,#ffe26b)',
  },
  {
    id: 'nvg',
    name: 'NVG',
    sw: 'radial-gradient(circle,#7dff9c 0,#1fa64a 45%,#04140a)',
  },
];

const STATUS_LABEL = {
  live: 'Live',
  stale: 'Stale',
  off: 'Off',
  error: 'Error',
};

export function createGlobeChrome({
  chrome,
  stage,
  leadView,
  globe,
  onOpenSituation,
  onThread,
  getSituations,
  isTwoPane,
  onPin,
  onClock,
  onClip,
  onTimelineEvent,
  onPick,
}) {
  const eyeViewer = createEyeViewer({
    globe,
    onFly: (e) => {
      globe.flyTo({
        lon: e.lon,
        lat: e.lat,
        height: 900,
        heading: e.headingDeg || 0,
        pitch: -30,
        duration: 2,
      });
      const id = globe.addPin({
        id: `eye:${e.id}`,
        kind: 'eye',
        lon: e.lon,
        lat: e.lat,
        headingDeg: e.headingDeg || 0,
        fovDeg: 50,
        label: e.title,
      });
      if (id) setTimeout(() => globe.removePin(id), 60000);
    },
  });

  /** Nearest public camera to a point, opened live. */
  async function nearestEye(lon, lat, from, km = 60) {
    const eye = await globe.nearestEye(lon, lat, km);
    if (eye) eyeViewer.open(eye, { from });
    else toast(`No public camera within ${km} km`, { icon: icon('video') });
    return eye;
  }

  /* ---------- top chrome ---------- */
  const top = h(`<div class="gc-top">
      <div class="gc-readout"><span class="tele gc-alt">—</span><span class="tele gc-ll">—</span></div>
      <div class="gc-buttons">
        <button class="icon-btn glass-strong liquid" type="button" data-act="lens" aria-label="Layers" aria-haspopup="dialog">${icon('layers')}</button>
        <button class="icon-btn glass-strong liquid gc-compass" type="button" data-act="home" aria-label="Reset view to the whole planet"><span class="compass-n">${icon('north')}</span></button>
        <button class="icon-btn glass-strong liquid" type="button" data-act="credits" aria-label="Map data attribution">${icon('info')}</button>
      </div>
    </div>`);
  // The altimeter: orbit → sky → ground, tap a band to descend or climb.
  const alt = h(`<div class="alt-rail" role="group" aria-label="Altitude band">
      ${[
        ['orbit', 'ORBIT', 9000e3, 1],
        ['sky', 'SKY', 60e3, 0.5],
        ['ground', 'GROUND', 1500, 0.2],
      ]
        .map(
          ([b, l, hgt, top]) =>
            `<button type="button" data-alt="${b}" data-h="${hgt}" data-band="${b}" style="--y:${(1 - altFrac(hgt)) * 100}%" aria-label="Go to ${BAND_NAME[b]} altitude"><span class="tele">${l}</span></button>`,
        )
        .join('')}
      <span class="alt-ticks" aria-hidden="true">${[36000e3, 400e3, 15e3, 1e3]
        .map((x) => `<i style="--y:${(1 - altFrac(x)) * 100}%"></i>`)
        .join('')}</span>
      <span class="alt-mark" aria-hidden="true"><i></i></span>
    </div>`);
  alt.addEventListener('click', (e) => {
    const b = e.target.closest('[data-alt]');
    if (!b) return;
    haptic('tick');
    const c = lastCam || { lon: 0, lat: 20 };
    const hgt = Number(b.dataset.h);
    globe.flyTo({
      lon: c.lon,
      lat: c.lat,
      height: hgt,
      pitch:
        b.dataset.alt === 'ground' ? -35 : b.dataset.alt === 'sky' ? -60 : -90,
      duration: 2,
    });
  });
  let lastCam = null;
  const attribution = h(
    '<button class="gc-attr" type="button" data-act="credits" aria-label="Attribution">Esri · Maxar · Earthstar · NASA</button>',
  );
  const lensPop =
    h(`<div class="lens-pop glass-strong" role="menu" aria-label="Visual lens" hidden>
      ${LENSES.map((l) => `<button role="menuitemradio" type="button" data-lens="${l.id}" aria-checked="false"><span class="lens-sw" style="background:${l.sw}"></span><span>${l.name}</span></button>`).join('')}
    </div>`);
  const dock =
    h(`<div class="lens-dock" role="toolbar" aria-label="Lens families" data-hscroll>
      ${FAMILIES.map((f) => `<button class="chip fam-chip" type="button" data-family="${f.id}" aria-haspopup="dialog" aria-label="${f.name} layers. Long-press to solo">${icon(FAMILY_ICON[f.id])}<span>${f.name}</span><b class="num fam-count"></b></button>`).join('')}
    </div>`);
  const pick = h(
    `<div class="pick-card glass-strong" role="dialog" aria-label="Selected contact" hidden></div>`,
  );
  const bottom = h('<div class="gc-bottom"></div>');
  chrome.append(top, attribution, alt, lensPop, pick, bottom);
  bottom.append(dock);

  const ribbon = createTimeRibbon(bottom, {
    getWindow: () => globe.timeWindow(),
    onTime: (d) => {
      // A playing Moment owns the clock until it closes.
      if (globe.activeMoment()) return;
      globe.setTime(d);
      onClock?.(d);
    },
    playback: globe.playback,
    getHistory: () => globe.history(),
    onClip: (r) => onClip?.(r),
    onPip: (p) => onTimelineEvent?.(p.ev || p),
  });
  // While the planet plays, the time machine (and everything else) follows.
  globe.on('playback', (st) => {
    if (!st || globe.activeMoment()) return;
    ribbon.onPlayback(st);
    onClock?.(ribbon.time);
  });

  /* ---------- HTML labels (engine draws none; ≤ 40, DESIGN.md §5) ---------- */
  const labelLayer = h('<div class="gc-labels" aria-hidden="true"></div>');
  chrome.prepend(labelLayer);
  let labelRaf = 0;
  const KIND_FAM_L = {
    aircraft: 'sky',
    helicopter: 'sky',
    military: 'sky',
    vessel: 'sea',
    ship: 'sea',
    satellite: 'orbit',
    station: 'orbit',
    launch: 'orbit',
    earthquake: 'hazards',
    quake: 'hazards',
    fire: 'hazards',
    cyclone: 'hazards',
    camera: 'eyes',
    cctv: 'eyes',
    post: 'inside',
    witness: 'inside',
    hologram: 'inside',
    live: 'inside',
    eye: 'ground',
  };
  function drawLabels() {
    labelRaf = 0;
    if (document.hidden || getComputedStyle(chrome).visibility === 'hidden')
      return;
    const list = globe.labels(40);
    const W = chrome.clientWidth;
    const html = list
      .map((l) => {
        // Launch names run to 60 characters; a label names, the pick card explains.
        const title =
          l.title.length > 26 ? `${l.title.slice(0, 25).trimEnd()}…` : l.title;
        const flip = l.x > W - 9 * title.length - 40;
        const tf = `translate(${Math.round(l.x)}px,${Math.round(l.y)}px)${flip ? ' translateX(calc(-100% - 16px))' : ''}`;
        const pin = l.layer === 'pins';
        return `<span ${pin ? `class="lb-pin" data-band="${KIND_FAM_L[l.kind] || 'inside'}"` : ''} data-family="${KIND_FAM_L[l.kind] || 'infra'}" style="transform:${tf}"><i></i>${esc(title)}</span>`;
      })
      .join('');
    if (labelLayer.innerHTML !== html) labelLayer.innerHTML = html;
  }
  const queueLabels = () => {
    if (!labelRaf) labelRaf = requestAnimationFrame(drawLabels);
  };
  globe.on('camera', queueLabels);
  globe.on('layers', queueLabels);
  setInterval(queueLabels, 1000);

  /** Provider credits flagged onScreen (e.g. Google 3D Tiles) must stay visible. */
  let attrKey = '';
  function refreshAttribution() {
    const list = globe.credits() || [];
    const onScreen = list
      .filter((c) => c.onScreen)
      .map((c) => c.text || String(c.html || '').replace(/<[^>]+>/g, ''));
    const text = ['Esri · Maxar · Earthstar · NASA', ...onScreen].join(' · ');
    if (text === attrKey) return;
    attrKey = text;
    attribution.textContent = text;
    attribution.classList.toggle('has-onscreen', onScreen.length > 0);
  }
  let attrTimer = 0;
  globe.on('camera', () => {
    clearTimeout(attrTimer);
    attrTimer = setTimeout(refreshAttribution, 300);
  });
  setTimeout(refreshAttribution, 500);

  /* ---------- camera readout ---------- */
  globe.on('camera', (c) => {
    if (!c) return;
    lastCam = c;
    const altTxt =
      c.height > 10000
        ? `${fmtNum(Math.round(c.height / 1000))} KM`
        : `${fmtNum(Math.round(c.height))} M`;
    const band = bandAt(c.height);
    const ro = $('.gc-readout', top);
    ro.dataset.band = band;
    alt.dataset.band = band;
    alt.style.setProperty('--h', `${(1 - altFrac(c.height)) * 100}%`);
    $('.gc-alt', top).innerHTML =
      `<i></i>${BAND_NAME[band].toUpperCase()} · ${altTxt}`;
    $('.gc-ll', top).textContent =
      c.height < 300e3
        ? `${llShort(c.lat, c.lon, 3)} · ${mgrs(c.lat, c.lon, 3)}`
        : llShort(c.lat, c.lon, 2);
    if (Number.isFinite(c.heading))
      $('.compass-n', top).style.transform = `rotate(${-c.heading}deg)`;
  });

  /* ---------- lens switcher ---------- */
  function setLens(id) {
    globe.setLens(id);
    store.set('lens', id);
    $$('[data-lens]', lensPop).forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.lens === id)),
    );
    chrome.dataset.lens = id;
  }
  setLens(store.get('lens') || 'cinematic');
  lensPop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lens]');
    if (!b) return;
    haptic('tick');
    setLens(b.dataset.lens);
    setTimeout(() => (lensPop.hidden = true), 160);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!lensPop.hidden && !e.target.closest('.lens-pop, [data-act="lens"]'))
      lensPop.hidden = true;
  });

  /* ---------- family counts + dock ---------- */
  function familyState() {
    const layers = globe.layers();
    const st = {};
    for (const f of FAMILIES)
      st[f.id] = { on: 0, total: 0, count: 0, layers: [] };
    for (const l of layers) {
      const s = st[l.family];
      if (!s) continue;
      if (l.available !== false) s.total += 1;
      s.layers.push(l);
      if (l.on) {
        s.on += 1;
        s.count += Number(l.count) || 0;
      }
    }
    return st;
  }
  function refreshDock() {
    const st = familyState();
    $$('.fam-chip', dock).forEach((b) => {
      const s = st[b.dataset.family];
      b.classList.toggle('on', s.on > 0);
      b.querySelector('.fam-count').textContent = s.on ? fmtNum(s.count) : '';
    });
    if (gridFamily) renderGrid(gridFamily);
    if (isTwoPane()) renderLeadView();
  }
  globe.on('layers', () => refreshDock());

  let solo = null;
  dock.addEventListener('click', (e) => {
    const b = e.target.closest('.fam-chip');
    if (b) openGrid(b.dataset.family);
  });
  $$('.fam-chip', dock).forEach((b) =>
    onLongPress(b, () => {
      haptic('medium');
      const fam = b.dataset.family;
      if (solo?.family === fam) {
        for (const l of globe.layers())
          globe.setLayer(l.id, solo.prev.has(l.id));
        solo = null;
        toast('All lenses restored', { icon: icon('layers') });
      } else {
        const prev =
          solo?.prev ||
          new Set(
            globe
              .layers()
              .filter((l) => l.on)
              .map((l) => l.id),
          );
        for (const f of FAMILIES)
          if (f.id !== fam) globe.setFamily(f.id, false);
        globe.setFamily(fam, true);
        solo = { family: fam, prev };
        toast(
          `Solo · ${FAMILIES.find((f) => f.id === fam).name}. Long-press again to restore`,
          { icon: icon(FAMILY_ICON[fam]) },
        );
      }
      dock.dataset.solo = solo?.family || '';
      refreshDock();
    }),
  );

  /* ---------- layer grid (Control Center) ---------- */
  const grid = createSheet({
    label: 'Layers',
    detents: ['medium', 'large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'grid-sheet',
    heights: {
      medium: (H) => Math.min(Math.round(H * 0.62), 560),
      large: (H) => Math.round(H * 0.92),
    },
  });
  let gridFamily = null;
  grid.on('close', () => (gridFamily = null));

  function tileHtml(l) {
    if (l.available === false)
      return `<button class="tile soon" type="button" aria-disabled="true" data-soon="${esc(l.id)}" data-msg="${esc(l.message || 'Not in the prototype yet')}">
      <span class="tile-ic">${icon(FAMILY_ICON[l.family] || 'layers')}</span>
      <span class="tile-name">${esc(l.name)}</span>
      <span class="tile-meta"><span class="tile-status">Coming soon</span></span>
    </button>`;
    return `<button class="tile ${l.on ? 'on' : ''}" type="button" role="switch" aria-checked="${!!l.on}" data-layer="${esc(l.id)}" data-status="${esc(l.status)}">
      <span class="tile-ic">${icon(FAMILY_ICON[l.family] || 'layers')}</span>
      <span class="tile-name">${esc(l.name)}</span>
      <span class="tile-meta"><span class="tile-status"><i></i>${esc(STATUS_LABEL[l.status] || l.status)}</span><b class="num">${l.count != null ? esc(fmtNum(l.count)) : ''}</b></span>
    </button>`;
  }

  /** Every family in one sheet, with the visual looks on top. */
  function renderAllGrid() {
    const st = familyState();
    const active = store.get('lens') || 'cinematic';
    const on = Object.values(st).reduce((a, x) => a + x.on, 0);
    const count = Object.values(st).reduce((a, x) => a + x.count, 0);
    grid.sheet.dataset.family = 'all';
    grid.head.innerHTML = `<div class="grid-head"><span class="grid-ic">${icon('layers')}</span>
      <div><h2 class="sheet-title">Layers</h2><div class="sheet-sub num">${on} on · ${fmtNum(count)} contacts</div></div></div>`;
    grid.body.innerHTML = `<div class="section-h">Look</div>
      <div class="lens-row" data-hscroll>${LENSES.map((l) => `<button type="button" class="lens-card ${l.id === active ? 'on' : ''}" data-lens3="${l.id}"><span class="lens-sw" style="background:${l.sw}"></span>${l.name}</button>`).join('')}</div>
      ${FAMILIES.map((f) => {
        const x = st[f.id];
        const layers = [...x.layers].sort(
          (a, b) => (b.available !== false) - (a.available !== false),
        );
        return `<div class="section-h" data-family="${f.id}"><span class="lead-fam">${icon(FAMILY_ICON[f.id])}${f.name}</span><small class="num">${x.on}/${x.total} · ${fmtNum(x.count)}</small></div>
        <div class="tiles">${layers.map(tileHtml).join('')}</div>`;
      }).join('')}
      <p class="footnote" style="padding:14px 2px 0">Counts are live from each feed; dotted means stale.</p>`;
  }

  function renderGrid(fam) {
    if (fam === 'all') return renderAllGrid();
    const st = familyState()[fam];
    const f = FAMILIES.find((x) => x.id === fam);
    grid.sheet.dataset.family = fam;
    grid.head.innerHTML = `<div class="grid-head"><span class="grid-ic">${icon(FAMILY_ICON[fam])}</span>
      <div><h2 class="sheet-title">${f.name}</h2><div class="sheet-sub num">${st.on} of ${st.total} on · ${fmtNum(st.count)} contacts</div></div>
      <button class="switch" type="button" role="switch" aria-checked="${st.on > 0}" aria-label="All ${f.name} layers" data-fam-toggle></button></div>`;
    grid.body.innerHTML = `<div class="tiles">${st.layers.map(tileHtml).join('')}</div>
      <p class="footnote" style="padding:14px 2px 0">Long-press ${f.name} in the dock to solo it. Counts are live from each feed; dotted means stale.</p>`;
  }

  function openGrid(fam) {
    gridFamily = fam;
    renderGrid(fam);
    grid.open('medium');
  }

  grid.root.addEventListener('click', (e) => {
    const look = e.target.closest('[data-lens3]');
    if (look) {
      haptic('tick');
      setLens(look.dataset.lens3);
      $$('[data-lens3]', grid.root).forEach((b) =>
        b.classList.toggle('on', b === look),
      );
      return;
    }
    const soon = e.target.closest('[data-soon]');
    if (soon) {
      toast(
        `${soon.querySelector('.tile-name').textContent} · ${soon.dataset.msg}`,
        { icon: icon('clock') },
      );
      return;
    }
    const t = e.target.closest('[data-layer]');
    if (t) {
      const on = t.getAttribute('aria-checked') !== 'true';
      haptic('tick');
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', String(on));
      globe.setLayer(t.dataset.layer, on);
      setTimeout(refreshDock, 30);
      return;
    }
    if (e.target.closest('[data-fam-toggle]')) {
      const sw = e.target.closest('[data-fam-toggle]');
      const on = sw.getAttribute('aria-checked') !== 'true';
      haptic('light');
      globe.setFamily(gridFamily, on);
      setTimeout(refreshDock, 30);
    }
  });

  /* ---------- credits ---------- */
  const credits = createSheet({
    label: 'Attribution',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    heights: { large: (H) => Math.round(H * 0.7) },
  });
  function openCredits() {
    const list = globe.credits() || [];
    const fixed = [
      {
        name: 'Bhote Koshi event pack',
        text: 'GeoPera reconstruction centerline; Vantor WorldView-2/3 Open Data; GeoGeorgeShadrach public geolocation map. CC BY-NC 4.0 — not covered by the app’s MIT license.',
        url: 'https://creativecommons.org/licenses/by-nc/4.0/',
      },
      {
        name: 'Esri World Imagery (feed thumbnails)',
        text: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        url: 'https://www.esri.com',
      },
      {
        name: 'Place search',
        text: '© OpenStreetMap contributors, via Nominatim',
        url: 'https://www.openstreetmap.org/copyright',
      },
    ];
    const all = [
      ...list,
      ...fixed.filter((f) => !list.some((l) => l.name === f.name)),
    ];
    credits.head.innerHTML = `<h2 class="sheet-title">Data &amp; attribution</h2><div class="sheet-sub">Imagery, feeds and the people who made them</div>`;
    credits.body.innerHTML = `<div class="credit-list">${all
      .map((c) => {
        const text =
          c.text ||
          c.attribution ||
          String(c.html || '').replace(/<[^>]+>/g, '');
        const [head, ...rest] =
          c.name || c.title
            ? [c.name || c.title, text]
            : text.split(/:\s(.+)/s);
        return `<div class="credit"><b>${esc(head)}</b>${rest.filter(Boolean).length ? `<span>${esc(rest.filter(Boolean).join(' '))}</span>` : ''}${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(new URL(c.url, location.href).hostname)}</a>` : ''}</div>`;
      })
      .join('')}</div>`;
    credits.open('large');
  }

  top.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'lens') {
      haptic('tick');
      openGrid('all');
    } else if (act === 'home') {
      haptic('tick');
      hidePick();
      globe.home();
    } else if (act === 'credits') openCredits();
  });
  attribution.addEventListener('click', openCredits);

  /* ---------- pick card ---------- */
  const KIND_ICON = {
    aircraft: 'sky',
    helicopter: 'sky',
    military: 'sky',
    ship: 'sea',
    vessel: 'sea',
    satellite: 'orbit',
    station: 'orbit',
    launch: 'orbit',
    quake: 'hazards',
    earthquake: 'hazards',
    fire: 'flame',
    cyclone: 'weather',
    camera: 'eyes',
    cctv: 'eyes',
  };
  const KIND_FAM = {
    aircraft: 'sky',
    helicopter: 'sky',
    military: 'sky',
    ship: 'sea',
    vessel: 'sea',
    satellite: 'orbit',
    station: 'orbit',
    launch: 'orbit',
    quake: 'hazards',
    earthquake: 'hazards',
    fire: 'hazards',
    cyclone: 'hazards',
    flood: 'hazards',
    camera: 'eyes',
    cctv: 'eyes',
  };
  let picked = null;
  /** Human rows from a pick's meta: known units formatted, internals dropped. */
  function metaRows(m) {
    if (!m || typeof m !== 'object') return [];
    const rows = [];
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    if (num(m.altitudeM) && m.altitudeM > 0)
      rows.push([
        'altitude',
        m.altitudeM > 100000
          ? `${fmtNum(Math.round(m.altitudeM / 1000))} km`
          : `${fmtNum(Math.round((m.altitudeM * 3.28084) / 100) * 100)} ft`,
      ]);
    if (num(m.speedMps))
      rows.push(['speed', `${Math.round(m.speedMps * 1.944)} kt`]);
    if (num(m.headingDeg))
      rows.push(['heading', `${Math.round(m.headingDeg)}°`]);
    if (num(m.verticalRateMps) && Math.abs(m.verticalRateMps) > 0.5)
      rows.push(['climb', `${Math.round(m.verticalRateMps * 196.85)} fpm`]);
    const skip = new Set([
      'layer',
      'source',
      'altitudeM',
      'speedMps',
      'headingDeg',
      'verticalRateMps',
      'onGround',
      'class',
      'situation',
    ]);
    for (const [k, v] of Object.entries(m)) {
      if (
        skip.has(k) ||
        v == null ||
        v === '' ||
        typeof v === 'object' ||
        typeof v === 'boolean'
      )
        continue;
      rows.push([
        k.replace(/([A-Z])/g, ' $1').toLowerCase(),
        num(v) ? fmtNum(v, v % 1 ? 1 : 0) : String(v),
      ]);
    }
    return rows;
  }
  function hidePick() {
    pick.hidden = true;
    picked = null;
    chrome.classList.remove('has-pick');
  }
  async function showPick(p) {
    if (!p) return hidePick();
    if (p.kind === 'pin') {
      if (onPin?.(p)) return;
      if (p.pinKind === 'eye') return nearestEye(p.lon, p.lat, p.title, 1);
    }
    if (onPick?.(p)) return;
    if (p.kind === 'situation') {
      const s = (await getSituations()).find(
        (x) => String(x.id) === String(p.id),
      );
      if (s) onOpenSituation(s);
      return;
    }
    picked = p;
    const fam = KIND_FAM[p.kind] || 'infra';
    const meta = metaRows(p.meta);
    const followed = store.isFollowed(`contact:${p.id}`);
    pick.dataset.family = fam;
    pick.innerHTML = `<div class="pick-top"><span class="pick-ic">${icon(KIND_ICON[p.kind] || 'scope')}</span>
        <div class="pick-titles"><div class="pick-title">${esc(p.title || p.id)}</div><div class="pick-sub">${esc(p.subtitle || p.kind)}</div></div>
        <button class="icon-btn pick-close" type="button" aria-label="Dismiss">${icon('close')}</button></div>
      ${
        meta.length
          ? `<div class="pick-meta">${meta
              .slice(0, 6)
              .map(
                ([k, v]) =>
                  `<div><span>${esc(k)}</span><b class="num">${esc(v)}</b></div>`,
              )
              .join('')}</div>`
          : ''
      }
      <div class="pick-src">${esc(p.meta?.source || '')}${Number.isFinite(p.lat) ? ` · <span class="mono">${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}</span>` : ''}</div>
      <div class="pick-actions">
        <button class="pill-btn tinted" type="button" data-pick="follow" aria-pressed="${followed}">${icon(followed ? 'starFill' : 'star')}${followed ? 'Following' : 'Follow'}</button>
        <button class="pill-btn plain" type="button" data-pick="ride">${icon('ride')}Ride</button>
        <button class="pill-btn plain" type="button" data-pick="eye">${icon('video')}Eye</button>
        <button class="pill-btn plain" type="button" data-pick="thread">${icon('threads')}Thread</button>
      </div>`;
    pick.hidden = false;
    chrome.classList.add('has-pick');
    pick.animate(
      [
        { transform: 'translateY(14px) scale(.97)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 380, easing: 'cubic-bezier(.32,1.25,.4,1)' },
    );
    haptic('light');
  }
  globe.on('pick', showPick);
  pick.addEventListener('click', async (e) => {
    if (e.target.closest('.pick-close')) {
      globe.select(null);
      return hidePick();
    }
    const a = e.target.closest('[data-pick]')?.dataset.pick;
    if (!a || !picked) return;
    const p = picked;
    haptic('light');
    if (a === 'follow') {
      const on = store.toggleFollow(`contact:${p.id}`);
      toast(on ? `Following ${p.title}` : 'Unfollowed', {
        icon: icon(on ? 'starFill' : 'star'),
      });
      showPick(p);
    } else if (a === 'ride') {
      globe.select(p.id);
      await globe.flyTo({
        lon: p.lon,
        lat: p.lat,
        height: p.kind === 'satellite' ? 1200e3 : 6000,
        pitch: -12,
        duration: 2,
      });
      if (globe.isStub)
        toast('Ride view needs the live engine — following from above', {
          icon: icon('ride'),
        });
    } else if (a === 'eye') {
      await nearestEye(p.lon, p.lat, p.title);
    } else if (a === 'thread')
      onThread?.({
        id: `contact:${p.id}`,
        title: p.title,
        place: p.subtitle,
        lon: p.lon,
        lat: p.lat,
        family: KIND_FAM[p.kind] || 'infra',
      });
  });

  /* ---------- two-pane leading view (Globe tab) ---------- */
  function renderLeadView() {
    const st = familyState();
    const active = store.get('lens') || 'cinematic';
    leadView.innerHTML = `<header class="navbar"><span class="nav-title">Globe</span></header>
      <h1 class="large-title">Globe</h1>
      <div class="title-sub">${Object.values(st).reduce((a, s) => a + s.on, 0)} lenses on · drag the planet, pinch to descend</div>
      <div class="section-h">Visual lens</div>
      <div class="lens-row" data-hscroll>${LENSES.map((l) => `<button type="button" class="lens-card ${l.id === active ? 'on' : ''}" data-lens2="${l.id}"><span class="lens-sw" style="background:${l.sw}"></span>${l.name}</button>`).join('')}</div>
      ${FAMILIES.map((f) => {
        const s = st[f.id];
        return `<div class="section-h" data-family="${f.id}"><span class="lead-fam">${icon(FAMILY_ICON[f.id])}${f.name}</span><small class="num">${s.on}/${s.total} · ${fmtNum(s.count)}</small></div>
        <div class="tiles lead-tiles" data-family="${f.id}">${s.layers.map(tileHtml).join('')}</div>`;
      }).join('')}
      <p class="footnote"><button class="link-btn" type="button" data-act2="credits">Data &amp; attribution</button></p>`;
  }
  leadView.addEventListener('click', (e) => {
    const soon = e.target.closest('[data-soon]');
    if (soon) {
      toast(
        `${soon.querySelector('.tile-name').textContent} · ${soon.dataset.msg}`,
        { icon: icon('clock') },
      );
      return;
    }
    const t = e.target.closest('[data-layer]');
    if (t) {
      const on = t.getAttribute('aria-checked') !== 'true';
      haptic('tick');
      globe.setLayer(t.dataset.layer, on);
      setTimeout(refreshDock, 30);
      return;
    }
    const l = e.target.closest('[data-lens2]');
    if (l) {
      setLens(l.dataset.lens2);
      renderLeadView();
    }
    if (e.target.closest('[data-act2="credits"]')) openCredits();
  });

  refreshDock();
  let basePips = [];
  let extraPips = [];

  return {
    ribbon,
    refreshDock,
    renderLeadView,
    hidePick,
    showPick,
    openGrid,
    openCredits,
    setPips(p) {
      basePips = p || [];
      ribbon.setPips([...basePips, ...extraPips]);
    },
    /** Timeline events (globe.timeline()) become band-coloured pips. */
    setTimeline(evts) {
      basePips = (evts || []).map((ev) => ({
        at: ev.t,
        label: ev.title,
        color: BAND_COLOR[ev.band] || '#fff',
        severity: ev.severity || 0,
        ev,
      }));
      ribbon.setPips([...basePips, ...extraPips]);
    },
    /** Room posts anchored in time (cleared with []). */
    setExtraPips(p) {
      extraPips = p || [];
      ribbon.setPips([...basePips, ...extraPips]);
    },
    showEye: (...a) => eyeViewer.open(...a),
    nearestEye,
  };
}
