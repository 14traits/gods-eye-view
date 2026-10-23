/**
 * Dossiers (DESIGN.md §12.1): every object has identity, live state, a track
 * history, events, links and receipts. Tapping any entity anywhere (a globe
 * pick, a search result, a track in a Moment, a node in the link graph)
 * opens one. The Graph segment shows globe.graph(ref); globe, time machine
 * and graph share one selection.
 */

import { icon } from './icons.js';
import {
  $,
  $$,
  esc,
  ago,
  fmtNum,
  haptic,
  toast,
  store,
  sparkPath,
} from './dom.js';
import { createSheet } from './sheet.js';
import { createLinkGraph } from './linkGraph.js';
import { BAND_NAME, utc, llShort, mgrs, cardinal } from './bands.js';
import { bandOfKind } from './shim3.js';

export const KIND_ICON = {
  aircraft: 'sky',
  helicopter: 'heli',
  military: 'sky',
  satellite: 'satellite',
  station: 'satellite',
  vessel: 'sea',
  quake: 'hazards',
  fire: 'flame',
  camera: 'video',
  situation: 'now',
  place: 'pin',
  moment: 'film',
  track: 'scope',
  capture: 'seal',
};
export const KIND_NAME = {
  aircraft: 'Aircraft',
  helicopter: 'Helicopter',
  military: 'Military aircraft',
  satellite: 'Satellite',
  vessel: 'Vessel',
  quake: 'Earthquake',
  camera: 'Public camera',
  situation: 'Situation',
  place: 'Place',
  moment: 'Moment',
  track: 'Track',
  capture: 'Sealed capture',
};

const ID_LABEL = {
  icao24: 'ICAO 24-bit',
  callsign: 'Callsign',
  registration: 'Registration',
  norad: 'NORAD ID',
  mmsi: 'MMSI',
};

const capFirst = (x) => (x ? `${x[0].toUpperCase()}${x.slice(1)}` : x);
const cap = (x) => {
  const t = String(x || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return t ? `${t[0].toUpperCase()}${t.slice(1)}` : t;
};

function liveRows(d) {
  const L = d.live;
  if (!L) return [];
  const rows = [];
  if (Number.isFinite(L.altM) && L.altM > 0)
    rows.push([
      'Altitude',
      L.altM > 100e3
        ? fmtNum(Math.round(L.altM / 1000))
        : fmtNum(Math.round((L.altM * 3.28084) / 10) * 10),
      L.altM > 100e3 ? 'km' : 'ft',
    ]);
  if (Number.isFinite(L.speed) && L.speed > 0)
    rows.push(
      d.kind === 'satellite'
        ? ['Speed', (L.speed / 1000).toFixed(2), 'km/s']
        : ['Speed', fmtNum(Math.round(L.speed * 1.94384)), 'kt'],
    );
  if (Number.isFinite(L.heading))
    rows.push([
      'Heading',
      `${Math.round(((L.heading % 360) + 360) % 360)}°`,
      cardinal(L.heading),
    ]);
  if (L.squawk) rows.push(['Squawk', L.squawk, '']);
  if (!rows.length && Number.isFinite(L.lat))
    rows.push(['Position', llShort(L.lat, L.lon, 3), '']);
  return rows.slice(0, 4);
}

/** Altitude profile (area) + ground track (polyline), both from real points. */
function trackHtml(d) {
  const tr = (d.track || []).filter((p) => Number.isFinite(p.t));
  if (tr.length < 3) return '';
  if (Number.isFinite(tr[0].v)) {
    const W = 300;
    const H = 64;
    const path = sparkPath(
      tr.map((p) => p.v),
      W,
      H,
      3,
    );
    return `<section class="ds-block"><h3 class="ds-h">History<small>${tr.length} samples · ${esc(ago(tr[0].t))} → now</small></h3>
      <svg class="ds-alt" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="ds-area" d="${path}L${W - 3} ${H}L3 ${H}Z"/><path class="ds-line" d="${path}"/></svg></section>`;
  }
  const W = 300;
  const H = 70;
  const alts = tr.map((p) => (Number.isFinite(p.altM) ? p.altM : 0));
  const hi = Math.max(...alts);
  const lo = Math.min(0, ...alts);
  const t0 = tr[0].t;
  const t1 = tr[tr.length - 1].t;
  const px = (t) => 3 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 6);
  const py = (a) => H - 4 - ((a - lo) / Math.max(1, hi - lo)) * (H - 14);
  const line = tr
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${px(p.t).toFixed(1)} ${py(alts[i]).toFixed(1)}`,
    )
    .join('');
  // Ground track, equirectangular around its centre.
  const lons = tr.map((p) => p.lon);
  const lats = tr.map((p) => p.lat);
  const cl = Math.cos(
    ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180),
  );
  const spanX = (Math.max(...lons) - Math.min(...lons)) * cl || 1e-6;
  const spanY = Math.max(...lats) - Math.min(...lats) || 1e-6;
  const S = 84;
  const k = (S - 12) / Math.max(spanX, spanY);
  const gx = (lon) =>
    S / 2 + (lon - (Math.min(...lons) + Math.max(...lons)) / 2) * cl * k;
  const gy = (lat) =>
    S / 2 - (lat - (Math.min(...lats) + Math.max(...lats)) / 2) * k;
  const g = tr
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${gx(p.lon).toFixed(1)} ${gy(p.lat).toFixed(1)}`,
    )
    .join('');
  const last = tr[tr.length - 1];
  const isOrbit = d.kind === 'satellite';
  return `<section class="ds-block"><h3 class="ds-h">Track<small>${tr.length} points · ${esc(utc(t0, { seconds: false }))} → ${esc(utc(t1, { seconds: false }))}</small></h3>
    <div class="ds-track">
      <figure class="ds-fig"><svg class="ds-alt" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Altitude profile">
        <path class="ds-area" d="${line}L${px(t1)} ${H}L${px(t0)} ${H}Z"/><path class="ds-line" d="${line}"/>
        <circle class="ds-end" cx="${px(t1)}" cy="${py(alts[alts.length - 1])}" r="3"/></svg>
        <figcaption class="tele"><span>${isOrbit ? 'ALT' : 'ALT PROFILE'}</span><span>${esc(isOrbit ? `${fmtNum(Math.round(hi / 1000))} KM` : `${fmtNum(Math.round((hi * 3.28084) / 10) * 10)} FT MAX`)}</span></figcaption></figure>
      <figure class="ds-fig ds-ground"><svg viewBox="0 0 ${S} ${S}" aria-label="Ground track"><path class="ds-gline" d="${g}"/><circle class="ds-end" cx="${gx(last.lon)}" cy="${gy(last.lat)}" r="3.2"/></svg>
        <figcaption class="tele"><span>GROUND</span></figcaption></figure>
    </div></section>`;
}

export function createDossier({
  globe,
  host,
  onOpenSituation,
  onOpenMoment,
  onOpenRoom,
  onShowOnTime,
  watch,
}) {
  const sheet = createSheet({
    host,
    label: 'Dossier',
    detents: ['medium', 'large'],
    dismissible: true,
    closeButton: true,
    className: 'dossier-sheet',
    heights: {
      medium: (H) => Math.min(Math.round(H * 0.56), 560),
      large: (H) => Math.round(H * 0.93),
    },
  });
  let stack = [];
  let d = null;
  let seg = 'dossier';
  let graph = null;
  let refreshTimer = 0;
  let token = 0;

  sheet.on('close', () => {
    clearInterval(refreshTimer);
    graph?.destroy();
    graph = null;
    globe.select(null);
    stack = [];
    d = null;
  });

  function headHtml() {
    const band = bandOfKind(d.kind);
    const status = d.illustrative
      ? '<span class="tag-ill">Illustrative</span>'
      : d.live && Date.now() - (d.live.updatedAt || 0) < 5 * 60e3
        ? '<span class="live-tag"><span class="live-dot"></span>Live</span>'
        : '<span>Recorded</span>';
    return `<div class="ds-head" data-band="${band}">
      ${stack.length > 1 ? `<button class="ds-back icon-btn" type="button" aria-label="Back to ${esc(stack[stack.length - 2].title || 'previous')}">${icon('chevronLeft')}</button>` : ''}
      <div class="ds-kicker tele"><i class="bd"></i><span>${esc(KIND_NAME[d.kind] || d.kind)}</span><span>·</span><span>${esc(BAND_NAME[band])}</span>${status}</div>
      <div class="ds-title-row"><span class="ds-ic">${icon(KIND_ICON[d.kind] || 'scope')}</span><div><h2 class="sheet-title">${esc(d.title)}</h2><div class="sheet-sub">${esc(d.subtitle || '')}</div></div></div>
      <div class="segmented ds-seg" role="tablist" aria-label="View">
        <button role="tab" type="button" data-seg="dossier" aria-selected="${seg === 'dossier'}">Dossier</button>
        <button role="tab" type="button" data-seg="graph" aria-selected="${seg === 'graph'}">${icon('graph')}Links graph</button>
      </div></div>`;
  }

  function followKey() {
    return d.kind === 'situation' ? d.id.replace(/^situation:/, '') : d.id;
  }

  function bodyHtml() {
    const rows = liveRows(d);
    const followed = store.isFollowed(followKey());
    const ident = Object.entries(d.identity || {})
      .filter(
        ([, v]) =>
          v != null && v !== '' && v !== false && typeof v !== 'object',
      )
      .map(([k, v]) => [k, v === true ? 'Yes' : v]);
    const L = d.live;
    const isMoment = d.kind === 'moment';
    return `
      ${
        rows.length
          ? `<div class="ds-live">${rows.map(([k, v, u]) => `<div><span class="tele">${esc(k)}</span><b class="num">${esc(v)}<small>${esc(u)}</small></b></div>`).join('')}</div>
        <div class="ds-updated tele">${L?.updatedAt ? `<span class="live-dot"></span>UPDATED <span data-ago="${L.updatedAt}">${esc(ago(L.updatedAt).toUpperCase())}</span>` : ''}${Number.isFinite(L?.lat) ? ` · ${esc(mgrs(L.lat, L.lon, 4) || llShort(L.lat, L.lon, 3))}` : ''}</div>`
          : ''
      }
      <div class="ds-actions" role="group" aria-label="Actions">
        ${isMoment ? `<button class="ds-act primary" type="button" data-ds="play">${icon('play')}<span>Play</span></button>` : ''}
        <button class="ds-act" type="button" data-ds="follow" aria-pressed="${followed}">${icon(followed ? 'starFill' : 'star')}<span>${followed ? 'Following' : 'Follow'}</span></button>
        <button class="ds-act" type="button" data-ds="alert">${icon('bell')}<span>Alert me</span></button>
        <button class="ds-act" type="button" data-ds="room">${icon('rooms')}<span>Open room</span></button>
        <button class="ds-act" type="button" data-ds="time">${icon('clock')}<span>Time machine</span></button>
      </div>
      ${d.privacy ? `<div class="ds-privacy">${icon('lock')}<span><b>Owner privacy (${esc(String(d.privacy).toUpperCase())})</b> Identity is limited to what the transponder broadcasts. We never name aircraft on privacy lists.</span></div>` : d.registryMissing ? `<div class="ds-privacy ds-registry">${icon('info')}<span><b>No public registry record found</b> for this airframe.${d.identity?.operator ? ` Operator from the callsign’s airline prefix.` : ''}</span></div>` : ''}
      ${trackHtml(d)}
      ${ident.length ? `<section class="ds-block"><h3 class="ds-h">Identity</h3><dl class="ds-id">${ident.map(([k, v]) => `<dt>${esc(ID_LABEL[k] || cap(k))}</dt><dd class="${/icao|norad|mmsi|registration/.test(k) ? 'mono' : ''}">${esc(v)}</dd>`).join('')}</dl></section>` : ''}
      ${
        d.events?.length
          ? `<section class="ds-block"><h3 class="ds-h">Events<small>tap to see it on the time machine</small></h3><ol class="ds-events">${d.events
              .slice(-8)
              .map(
                (e) =>
                  `<li><button type="button" data-t="${e.t}"><span class="tele">${esc(utc(e.t, { seconds: false }))}</span><span>${esc(e.title)}</span><small>${esc(ago(e.t))}</small></button></li>`,
              )
              .join('')}</ol></section>`
          : ''
      }
      ${
        d.links?.length
          ? `<section class="ds-block"><h3 class="ds-h">Links<small>${d.links.length} · things, places and events only</small></h3><div class="ds-links">${d.links
              .slice(0, 12)
              .map(
                (l) =>
                  `<button class="ds-link" type="button" data-link="${esc(l.id)}" data-band="${bandOfKind(l.kind)}"><span class="ds-link-ic">${icon(KIND_ICON[l.kind] || 'scope')}</span><span class="ds-link-main"><b>${esc(l.title)}</b><small>${esc(capFirst(l.relation || ''))}${Number.isFinite(l.distanceKm) ? ` · ${esc(l.distanceKm < 1 ? `${Math.round(l.distanceKm * 1000)} m` : `${fmtNum(l.distanceKm, l.distanceKm < 10 ? 1 : 0)} km`)}` : ''}</small></span>${icon('chevronRight', { cls: 'chev' })}</button>`,
              )
              .join('')}</div></section>`
          : ''
      }
      <section class="ds-block"><h3 class="ds-h">${icon('receipt')}Receipts<small>every fact keeps its source</small></h3><div class="ds-receipts">${(
        d.sources || []
      )
        .map(
          (s) =>
            `<div class="ds-rc"><div><b>${esc(s.name)}</b><small>${esc(s.fetchedAt ? `fetched ${ago(s.fetchedAt)}` : '')}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(new URL(s.url, location.href).hostname)}</a>` : ''}</small></div><button class="ds-hash mono" type="button" data-hash="${esc(s.hash || '')}" title="Copy hash">${esc(
              s.hash
                ? `${String(s.hash)
                    .replace(/^sha256:/, '')
                    .slice(0, 10)}…${String(s.hash).slice(-6)}`
                : '—',
            )}</button></div>`,
        )
        .join('')}</div></section>
      <p class="ds-foot">${icon('lock')}We track things that broadcast publicly, public infrastructure and events. Never people: no person search, no faces.</p>`;
  }

  async function show(ref, { push = true, detent } = {}) {
    const my = ++token;
    if (!sheet.isOpen) {
      sheet.head.innerHTML = `<div class="ds-head"><div class="ds-kicker tele">Opening dossier…</div><h2 class="sheet-title ds-skel">&nbsp;</h2></div>`;
      sheet.body.innerHTML = '';
      sheet.open(detent || 'medium');
    }
    const res = await globe.entity(ref);
    if (my !== token) return;
    if (!res) {
      sheet.close();
      toast('No dossier for that yet', { icon: icon('info') });
      return;
    }
    d = res;
    if (push) stack.push({ ref: d.id, title: d.title });
    render();
    if (detent) sheet.setDetent(detent);
    sync();
    clearInterval(refreshTimer);
    if (d.live && !d.illustrative)
      refreshTimer = setInterval(async () => {
        if (!sheet.isOpen || seg !== 'dossier') return;
        const nd = await globe.entity(d.id);
        if (!nd || nd.id !== d?.id) return;
        d = { ...nd, links: d.links };
        const live = $('.ds-live', sheet.body);
        if (live)
          live.innerHTML = liveRows(d)
            .map(
              ([k, v, u]) =>
                `<div><span class="tele">${esc(k)}</span><b class="num">${esc(v)}<small>${esc(u)}</small></b></div>`,
            )
            .join('');
        $$('[data-ago]', sheet.body).forEach((el) => {
          el.dataset.ago = d.live?.updatedAt;
          el.textContent = ago(d.live?.updatedAt).toUpperCase();
        });
      }, 5000);
  }

  function render() {
    sheet.sheet.dataset.band = bandOfKind(d.kind);
    sheet.sheet.dataset.seg = seg;
    sheet.head.innerHTML = headHtml();
    graph?.destroy();
    graph = null;
    if (seg === 'graph') {
      sheet.body.innerHTML =
        '<div class="ds-graph"></div><p class="ds-graph-note tele">Drag a node · tap one to open its dossier</p>';
      graph = createLinkGraph($('.ds-graph', sheet.body), {
        onOpen: (n) => {
          haptic('light');
          seg = 'dossier';
          show(n.id);
        },
        onSelect: (n) => selectOnGlobe(n),
      });
      graph.set(globe.graph(d.id), d.id);
      if (sheet.detent !== 'large') sheet.setDetent('large');
    } else {
      sheet.body.innerHTML = bodyHtml();
      sheet.body.scrollTop = 0;
    }
  }

  /** One selection: the globe follows the dossier. */
  function sync() {
    const L = d.live;
    if (!L || !Number.isFinite(L.lat)) return;
    // Historical (Moment) things are shown by the Moment player, not live.
    if (d.illustrative && d.kind !== 'moment') return;
    const raw = String(d.id).replace(/^[a-z]+:/, '');
    globe.select(raw);
    const height = {
      satellite: 2600e3,
      aircraft: 60e3,
      military: 80e3,
      helicopter: 4000,
      vessel: 30e3,
      place: 6000,
      capture: 2500,
      moment: 3500,
      camera: 3000,
      quake: 400e3,
    }[d.kind];
    if (height)
      globe.flyTo({
        lon: L.lon,
        lat: L.lat,
        height,
        pitch: -55,
        duration: 1.8,
      });
  }
  function selectOnGlobe(n) {
    globe.select(String(n.id).replace(/^[a-z]+:/, ''));
  }

  sheet.head.addEventListener('click', (e) => {
    const s = e.target.closest('[data-seg]');
    if (s && s.dataset.seg !== seg) {
      haptic('tick');
      seg = s.dataset.seg;
      render();
      return;
    }
    if (e.target.closest('.ds-back')) {
      stack.pop();
      const prev = stack[stack.length - 1];
      if (prev) show(prev.ref, { push: false });
    }
  });

  sheet.body.addEventListener('click', async (e) => {
    const link = e.target.closest('[data-link]');
    if (link) {
      haptic('light');
      const id = link.dataset.link;
      if (/^situation:/.test(id) && onOpenSituation) {
        const ok = await onOpenSituation(id.replace(/^situation:/, ''), {
          fromDossier: true,
        });
        if (ok) return;
      }
      return show(id);
    }
    const ev = e.target.closest('[data-t]');
    if (ev) {
      haptic('tick');
      onShowOnTime?.(d, Number(ev.dataset.t));
      return;
    }
    const hash = e.target.closest('[data-hash]');
    if (hash) {
      try {
        await navigator.clipboard.writeText(hash.dataset.hash);
        toast('Hash copied', { icon: icon('receipt') });
      } catch {
        toast(hash.dataset.hash.slice(0, 32), { icon: icon('receipt') });
      }
      return;
    }
    const act = e.target.closest('[data-ds]')?.dataset.ds;
    if (!act || !d) return;
    haptic('light');
    if (act === 'follow') {
      const on = store.toggleFollow(followKey());
      watch?.noteFollow?.(d, on);
      toast(on ? `Following ${d.title}` : 'Unfollowed', {
        icon: icon(on ? 'starFill' : 'star'),
      });
      render();
    } else if (act === 'alert') watch?.ruleFor(d);
    else if (act === 'room') onOpenRoom?.(d);
    else if (act === 'time') onShowOnTime?.(d);
    else if (act === 'play') onOpenMoment?.(d.id.replace(/^moment:/, ''));
  });

  // Picks on the globe highlight the same node in the graph.
  globe.on('pick', (p) => {
    if (!graph || !p) return;
    const id = [
      ...[
        `flights:${p.id}`,
        `military:${p.id}`,
        `satellites:${p.id}`,
        `vessels:${p.id}`,
        `situation:${p.id}`,
        String(p.id),
      ],
    ].find((x) => graph.has(x));
    if (id) graph.select(id);
  });

  return {
    open: (ref, o = {}) => {
      seg = o.graph ? 'graph' : 'dossier';
      stack = [];
      return show(ref, { detent: o.detent || (o.graph ? 'large' : 'medium') });
    },
    close: () => sheet.close(),
    get isOpen() {
      return sheet.isOpen;
    },
    get current() {
      return d;
    },
    sheet,
  };
}
