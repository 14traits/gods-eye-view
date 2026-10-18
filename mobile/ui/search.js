/** Search: situations, layers and places (OpenStreetMap Nominatim via /api/geocode). */

import { icon, FAMILY_ICON } from './icons.js';
import { $, esc, haptic } from './dom.js';
import { createSheet } from './sheet.js';

const PLACES = [
  { name: 'Kathmandu', sub: 'Nepal', lon: 85.324, lat: 27.7172 },
  { name: 'Strait of Hormuz', sub: 'Persian Gulf', lon: 56.4, lat: 26.5 },
  { name: 'Panama Canal', sub: 'Panama', lon: -79.68, lat: 9.08 },
  { name: 'Heathrow', sub: 'London, UK', lon: -0.4543, lat: 51.47 },
  { name: 'Cape Canaveral', sub: 'Florida, US', lon: -80.6, lat: 28.47 },
  { name: 'Mount Etna', sub: 'Sicily, Italy', lon: 14.995, lat: 37.751 },
];

export function createSearch({
  getSituations,
  globe,
  onOpenSituation,
  onPlace,
  onLayer,
}) {
  const sheet = createSheet({
    label: 'Search',
    detents: ['large'],
    modal: true,
    dismissible: true,
    className: 'search-sheet',
    heights: { large: (H) => Math.round(H * 0.92) },
  });
  sheet.head.innerHTML = `<form class="search-row" role="search"><label class="search-field">${icon('search')}<input type="search" placeholder="Situations, lenses, places" aria-label="Search" enterkeyhint="search" autofocus data-no-drag/></label><button class="pill-btn plain search-cancel" type="button">Cancel</button></form>`;
  const input = $('input', sheet.head);
  let timer = 0;
  let geo = [];

  function match(q, ...fields) {
    const s = fields.join(' ').toLowerCase();
    return q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => s.includes(w));
  }

  async function render() {
    const q = input.value.trim();
    const sits = await getSituations();
    const s = q
      ? sits.filter((x) => match(q, x.title, x.place, x.kind, x.family))
      : sits.slice(0, 5);
    const layers = q
      ? globe
          .layers()
          .filter((l) => match(q, l.name, l.family))
          .slice(0, 8)
      : [];
    const places = q
      ? PLACES.filter((p) => match(q, p.name, p.sub))
      : PLACES.slice(0, 4);
    sheet.body.innerHTML = `
      <div class="results-h">${q ? 'Situations' : 'Live now'}</div>
      ${s.map((x) => `<button class="result" type="button" data-sit="${esc(x.id)}"><img class="result-thumb" src="${esc(x.thumbnail)}" alt="" loading="lazy"/><span><div class="result-title">${esc(x.title)}</div><div class="result-sub">${esc(x.place)}</div></span></button>`).join('') || '<p class="result-sub">No situations match.</p>'}
      ${layers.length ? `<div class="results-h">Lenses</div>${layers.map((l) => `<button class="result" type="button" data-layer="${esc(l.id)}" data-family="${esc(l.family)}"><span class="result-icon">${icon(FAMILY_ICON[l.family] || 'layers')}</span><span><div class="result-title">${esc(l.name)}</div><div class="result-sub">${esc(l.family)} · ${l.on ? 'on' : 'off'}${l.count != null ? ` · ${l.count}` : ''}</div></span></button>`).join('')}` : ''}
      <div class="results-h">Places</div>
      ${[...places, ...geo].map((p, i) => `<button class="result" type="button" data-place="${i}"><span class="result-icon">${icon('pin')}</span><span><div class="result-title">${esc(p.name)}</div><div class="result-sub">${esc(p.sub || '')}</div></span></button>`).join('')}
      ${q.length >= 3 ? '<p class="result-sub" style="padding:10px 4px">Press search to look up places · © OpenStreetMap contributors</p>' : ''}`;
    sheet.body._places = [...places, ...geo];
  }

  async function geocode() {
    const q = input.value.trim();
    if (q.length < 3) return;
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      geo = (j.results || [])
        .slice(0, 5)
        .map((x) => ({
          name: x.formatted_address?.split(',')[0] || x.name || q,
          sub: x.formatted_address || '',
          lat: Number(x.geometry?.location?.lat ?? x.lat),
          lon: Number(x.geometry?.location?.lng ?? x.lon),
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    } catch {
      geo = [];
    }
    render();
  }

  input.addEventListener('input', () => {
    geo = [];
    clearTimeout(timer);
    timer = setTimeout(render, 80);
  });
  sheet.head.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    geocode();
  });
  sheet.head
    .querySelector('.search-cancel')
    .addEventListener('click', () => sheet.close());

  sheet.body.addEventListener('click', async (e) => {
    const sit = e.target.closest('[data-sit]');
    if (sit) {
      const s = (await getSituations()).find(
        (x) => String(x.id) === sit.dataset.sit,
      );
      sheet.close();
      if (s) setTimeout(() => onOpenSituation(s), 200);
      return;
    }
    const l = e.target.closest('[data-layer]');
    if (l) {
      haptic('tick');
      sheet.close();
      onLayer(l.dataset.layer);
      return;
    }
    const p = e.target.closest('[data-place]');
    if (p) {
      const place = sheet.body._places[Number(p.dataset.place)];
      sheet.close();
      if (place) onPlace(place);
    }
  });

  return {
    open() {
      input.value = '';
      geo = [];
      render();
      sheet.open('large');
      setTimeout(() => input.focus({ preventScroll: true }), 120);
    },
  };
}
