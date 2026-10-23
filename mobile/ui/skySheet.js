/**
 * Your sky now (DESIGN.md §12.3): what is above you this minute, on a sky
 * dome (zenith in the centre, horizon at the rim, north up) and as a list.
 * Live from globe.skyNow(); refreshes every 2 s while open.
 */

import { icon } from './icons.js';
import { $, esc, fmtNum, haptic } from './dom.js';
import { createSheet } from './sheet.js';
import { cardinal, utc } from './bands.js';

/** Sky dome SVG. size in px; items: [{ el, az, kind, id, label? }]. */
export function domeSvg(sky, { size = 300, labels = true, sel = null } = {}) {
  const c = size / 2;
  const R = c - (labels ? 18 : 4);
  const pos = (el, az) => {
    const r = R * (1 - Math.max(0, el) / 90);
    const a = ((az - 90) * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const dots = [];
  for (const s of sky?.satellites || []) {
    const [x, y] = pos(s.elevationDeg, s.azimuthDeg);
    dots.push(
      `<g class="dm-sat${sel === s.id ? ' sel' : ''}" data-id="${esc(s.id)}"><rect x="${(x - 2.2).toFixed(1)}" y="${(y - 2.2).toFixed(1)}" width="4.4" height="4.4" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/></g>`,
    );
  }
  for (const a of sky?.aircraft || []) {
    if (a.elevationDeg < 0) continue;
    const [x, y] = pos(a.elevationDeg, a.azimuthDeg);
    dots.push(
      `<g class="dm-ac${sel === a.id ? ' sel' : ''}" data-id="${esc(a.id)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.round(a.headingDeg || 0)})"><path d="M0 -5.5 3.6 4 0 2 -3.6 4Z"/></g>`,
    );
  }
  const iss = sky?.iss;
  if (iss && Number.isFinite(iss.elevationDeg) && iss.elevationDeg > 0) {
    const [x, y] = pos(iss.elevationDeg, iss.azimuthDeg);
    dots.push(
      `<g class="dm-iss"><circle cx="${x}" cy="${y}" r="4"/><circle class="ring" cx="${x}" cy="${y}" r="9"/>${labels ? `<text x="${x + 12}" y="${y + 3}">ISS</text>` : ''}</g>`,
    );
  }
  return `<svg class="dome" viewBox="0 0 ${size} ${size}" role="img" aria-label="Sky dome: ${(sky?.aircraft || []).length} aircraft and ${(sky?.satellites || []).length} satellites above you">
    <defs><radialGradient id="dm-g${size}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#14203a"/><stop offset="0.75" stop-color="#0a1020"/><stop offset="1" stop-color="#05070b"/></radialGradient></defs>
    <circle cx="${c}" cy="${c}" r="${R}" fill="url(#dm-g${size})" class="dm-sky"/>
    ${[30, 60].map((e) => `<circle cx="${c}" cy="${c}" r="${R * (1 - e / 90)}" class="dm-ring"/>`).join('')}
    <path class="dm-ring" d="M${c} ${c - R}V${c + R}M${c - R} ${c}H${c + R}"/>
    <circle cx="${c}" cy="${c}" r="${R}" class="dm-horizon"/>
    ${labels ? `<text class="dm-card n" x="${c}" y="${c - R - 6}">N</text><text class="dm-card" x="${c + R + 9}" y="${c + 3}">E</text><text class="dm-card" x="${c}" y="${c + R + 14}">S</text><text class="dm-card" x="${c - R - 9}" y="${c + 3}">W</text><text class="dm-el" x="${c + 3}" y="${c - R * (1 - 60 / 90) - 3}">60°</text><text class="dm-el" x="${c + 3}" y="${c - R * (1 - 30 / 90) - 3}">30°</text>` : ''}
    ${dots.join('')}
    <circle cx="${c}" cy="${c}" r="2" class="dm-you"/>
  </svg>`;
}

export function createSkySheet({ host, globe, getHome, onOpenEntity }) {
  const sheet = createSheet({
    host,
    label: 'Your sky now',
    detents: ['medium', 'large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'sky-sheet',
    heights: {
      medium: (H) => Math.round(H * 0.62),
      large: (H) => Math.round(H * 0.93),
    },
  });
  let timer = 0;
  let sky = null;
  sheet.on('close', () => clearInterval(timer));

  function rowAc(a) {
    return `<button class="sky-row" type="button" data-ent="${esc(a.id)}" data-band="sky"><span class="sky-ic">${icon(a.kind === 'helicopter' ? 'heli' : 'sky')}</span>
      <span class="sky-main"><b>${esc(a.title)}</b><small>${esc(fmtNum(Math.round((a.altM * 3.28084) / 100) * 100))} ft · ${esc(fmtNum(a.distanceKm, 1))} km ${esc(cardinal(a.azimuthDeg))}</small></span>
      <span class="sky-el tele"><b class="num">${Math.round(a.elevationDeg)}°</b>UP</span></button>`;
  }
  function rowSat(s) {
    return `<button class="sky-row" type="button" data-ent="${esc(s.id)}" data-band="orbit"><span class="sky-ic">${icon('satellite')}</span>
      <span class="sky-main"><b>${esc(s.title)}</b><small>${esc(fmtNum(s.altKm))} km up · ${esc(fmtNum(s.rangeKm))} km away ${esc(cardinal(s.azimuthDeg))}</small></span>
      <span class="sky-el tele"><b class="num">${Math.round(s.elevationDeg)}°</b>UP</span></button>`;
  }

  async function refresh() {
    const home = getHome();
    sky = await globe.skyNow({ lon: home.lon, lat: home.lat });
    if (!sky) {
      sheet.body.innerHTML =
        '<p class="footnote">The sky feed is not available on this engine yet.</p>';
      return;
    }
    const ac = sky.aircraft || [];
    const sats = sky.satellites || [];
    const iss = sky.iss || {};
    const np = iss.nextPass;
    const hm = (t) =>
      new Date(t).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
    $('.sky-dome', sheet.body).innerHTML = domeSvg(sky, { size: 300 });
    $('.sky-count', sheet.body).innerHTML =
      `<div><b class="num">${ac.length}</b><span>aircraft</span></div><div><b class="num">${sats.length}</b><span>satellites</span></div><div><b class="num">${iss.visibleNow ? 'Now' : np ? hm(np.start) : '—'}</b><span>${iss.visibleNow ? 'ISS overhead' : 'next ISS pass'}</span></div>`;
    $('.sky-lists', sheet.body).innerHTML = `
      ${np || iss.visibleNow ? `<div class="sky-iss" data-band="orbit">${icon('satellite')}<div><b>${iss.visibleNow ? 'The ISS is above you right now' : `ISS passes over at ${hm(np.start)}`}</b><span>${np ? `Rises ${hm(np.start)} · highest ${np.maxElevationDeg ?? '—'}° at ${hm(np.max)} · sets ${np.end ? hm(np.end) : '—'}` : `${Math.round(iss.elevationDeg)}° up, ${cardinal(iss.azimuthDeg)}`}</span></div></div>` : ''}
      <div class="section-h">Aircraft<small class="num">${ac.length} within 50 km</small></div>
      <div class="group">${ac.slice(0, 12).map(rowAc).join('') || '<div class="row"><span class="row-sub">No aircraft overhead right now. A quiet sky.</span></div>'}</div>
      <div class="section-h">Satellites<small class="num">${sats.length} above the horizon</small></div>
      <div class="group">${sats.slice(0, 12).map(rowSat).join('') || '<div class="row"><span class="row-sub">None above the horizon.</span></div>'}</div>
      <p class="footnote">Live ADS-B and orbital elements, computed for ${esc(getHome().label || getHome().name)}${getHome().demo ? ' (demo location)' : ''} · ${esc(utc(new Date()))}</p>`;
  }

  sheet.body.addEventListener('click', (e) => {
    const r = e.target.closest('[data-ent]');
    if (r) {
      haptic('light');
      sheet.close();
      onOpenEntity?.(r.dataset.ent);
    }
  });

  return {
    async open() {
      const home = getHome();
      sheet.head.innerHTML = `<div class="sky-kicker tele"><span class="live-dot"></span>LIVE · ${esc(utc(new Date(), { seconds: false }))}</div><h2 class="sheet-title">Your sky now</h2><div class="sheet-sub">Above ${esc(home.label || home.name)}${home.demo ? ' · demo location' : ''}, this minute</div>`;
      sheet.body.innerHTML = `<div class="sky-top"><div class="sky-dome"></div><div class="sky-count"></div></div><div class="sky-lists"></div>`;
      sheet.open('medium');
      await refresh();
      clearInterval(timer);
      timer = setInterval(() => sheet.isOpen && refresh(), 2000);
    },
    close: () => sheet.close(),
    get isOpen() {
      return sheet.isOpen;
    },
  };
}
