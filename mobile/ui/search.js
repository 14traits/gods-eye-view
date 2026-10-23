/**
 * Universal search (DESIGN.md §12.1, §12.7): instant results from
 * globe.search(), grouped into Things, Situations, Places and Moments, plus
 * lenses. Search leads to dossiers, not to a list of pins. Recent searches
 * and suggestions ("7700", "ISS", "Piccadilly") fill the empty state.
 */

import { icon, FAMILY_ICON } from './icons.js';
import { $, $$, esc, haptic } from './dom.js';
import { createSheet } from './sheet.js';
import { bandOfKind } from './shim3.js';
import { KIND_ICON, KIND_NAME } from './dossier.js';
import { bandOf } from './bands.js';

const RECENT_KEY = 'gev.search.recent';
const SUGGEST = [
  '7700',
  'ISS',
  'Piccadilly',
  'Empire State',
  'M6',
  'Starlink',
  'helicopter',
];
const THING = new Set([
  'aircraft',
  'helicopter',
  'military',
  'satellite',
  'vessel',
  'quake',
  'camera',
  'track',
  'capture',
]);
const GROUPS = [
  ['things', 'Things'],
  ['situations', 'Situations'],
  ['places', 'Places'],
  ['moments', 'Moments'],
  ['lenses', 'Lenses'],
];

function recent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}
function remember(q) {
  const list = [
    q,
    ...recent().filter((x) => x.toLowerCase() !== q.toLowerCase()),
  ].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function createSearch({
  host,
  getSituations,
  globe,
  onOpenSituation,
  onOpenEntity,
  onOpenMoment,
  onLayer,
}) {
  const sheet = createSheet({
    host,
    label: 'Search',
    detents: ['large'],
    modal: true,
    dismissible: true,
    className: 'search-sheet',
    heights: { large: (H) => Math.round(H * 0.93) },
  });
  sheet.head.innerHTML = `<form class="search-row" role="search"><label class="search-field">${icon('search')}<input type="search" placeholder="Aircraft, ships, places, 7700, M5.2…" aria-label="Search everything" enterkeyhint="search" autocomplete="off" spellcheck="false" autofocus data-no-drag/></label><button class="pill-btn plain search-cancel" type="button">Cancel</button></form>`;
  const input = $('input', sheet.head);
  let timer = 0;
  let geo = [];
  let items = [];
  let seq = 0;
  let cursor = -1;

  function row(r, i) {
    const band =
      r.kind === 'situation' ? r.band || 'ground' : bandOfKind(r.kind);
    const ic =
      r.kind === 'lens'
        ? FAMILY_ICON[r.family] || 'layers'
        : KIND_ICON[r.kind] || 'scope';
    const tag =
      r.kind === 'lens' ? (r.on ? 'On' : 'Off') : KIND_NAME[r.kind] || r.kind;
    return `<button class="sr" type="button" data-i="${i}" data-band="${esc(band)}" role="option" aria-selected="${i === cursor}"><span class="sr-ic">${icon(ic)}</span><span class="sr-main"><b>${esc(r.title)}</b><small>${esc(r.subtitle || '')}</small></span><span class="sr-tag tele">${esc(tag)}</span></button>`;
  }

  function emptyState() {
    const rec = recent();
    sheet.body.innerHTML = `
      ${rec.length ? `<div class="results-h">Recent<button class="link-btn" type="button" data-clear>Clear</button></div><div class="sr-chips">${rec.map((q) => `<button class="chip" type="button" data-q="${esc(q)}">${icon('clock')}${esc(q)}</button>`).join('')}</div>` : ''}
      <div class="results-h">Try</div>
      <div class="sr-chips">${SUGGEST.map((q) => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="results-h">Live now</div><div class="sr-list" data-live></div>
      <p class="sr-note">${icon('lock')}Search finds things that broadcast publicly (transponders, AIS, orbital elements), places and events. It never finds people.</p>`;
    getSituations().then((sits) => {
      const live = $('[data-live]', sheet.body);
      if (!live) return;
      items = sits.slice(0, 5).map((s) => ({
        id: `situation:${s.id}`,
        kind: 'situation',
        title: s.title,
        subtitle: s.place,
        band: bandOf(s),
      }));
      live.innerHTML = items.map(row).join('');
    });
  }

  async function render() {
    const q = input.value.trim();
    cursor = -1;
    if (!q) return emptyState();
    const my = ++seq;
    const res = await globe.search(q);
    if (my !== seq) return;
    const sits = await getSituations().catch(() => []);
    const ql = q.toLowerCase();
    const lenses = globe
      .layers()
      .filter((l) => `${l.name} ${l.family}`.toLowerCase().includes(ql))
      .slice(0, 4)
      .map((l) => ({
        id: l.id,
        kind: 'lens',
        title: l.name,
        subtitle: `${l.family} lens${l.count != null ? ` · ${l.count}` : ''}`,
        family: l.family,
        on: l.on,
      }));
    const grouped = {
      things: [],
      situations: [],
      places: [],
      moments: [],
      lenses,
    };
    for (const r of res) {
      if (r.kind === 'situation') {
        const s = sits.find((x) => `situation:${x.id}` === r.id);
        grouped.situations.push({
          ...r,
          band: r.band || (s ? bandOf(s) : 'ground'),
        });
      } else if (r.kind === 'place') grouped.places.push(r);
      else if (r.kind === 'moment') grouped.moments.push(r);
      else if (THING.has(r.kind)) grouped.things.push(r);
    }
    for (const g of geo) grouped.places.push(g);
    items = [];
    const html = GROUPS.map(([k, label]) => {
      const list = grouped[k].slice(0, k === 'things' ? 8 : 5);
      if (!list.length) return '';
      const rows = list.map((r) => {
        items.push(r);
        return row(r, items.length - 1);
      });
      return `<div class="results-h">${label}<small>${grouped[k].length}</small></div><div class="sr-list" role="listbox">${rows.join('')}</div>`;
    }).join('');
    sheet.body.innerHTML =
      html ||
      `<div class="sr-empty"><b>No matches for “${esc(q)}”</b><span>Press return to look it up as a place.</span></div>`;
    if (q.length >= 3 && !geo.length)
      sheet.body.insertAdjacentHTML(
        'beforeend',
        `<p class="sr-note">Return looks “${esc(q)}” up as a place · © OpenStreetMap contributors</p>`,
      );
  }

  async function geocode() {
    const q = input.value.trim();
    if (q.length < 3) return;
    remember(q);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      geo = (j.results || [])
        .slice(0, 5)
        .map((x, i) => ({
          id: `geo:${i}`,
          kind: 'place',
          title: x.formatted_address?.split(',')[0] || x.name || q,
          subtitle: x.formatted_address || '',
          lat: Number(x.geometry?.location?.lat ?? x.lat),
          lon: Number(x.geometry?.location?.lng ?? x.lon),
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    } catch {
      geo = [];
    }
    render();
  }

  function choose(r) {
    if (!r) return;
    haptic('light');
    const q = input.value.trim();
    if (q) remember(q);
    sheet.close();
    setTimeout(() => {
      if (r.kind === 'lens') onLayer(r.id);
      else if (r.kind === 'situation')
        onOpenSituation(r.id.replace(/^situation:/, ''));
      else if (r.kind === 'moment') onOpenMoment(r.id.replace(/^moment:/, ''));
      else if (/^geo:/.test(r.id))
        globe.flyTo({ lon: r.lon, lat: r.lat, height: 30e3, duration: 2 });
      else onOpenEntity(r.id);
    }, 160);
  }

  input.addEventListener('input', () => {
    geo = [];
    clearTimeout(timer);
    timer = setTimeout(render, 60);
  });
  input.addEventListener('keydown', (e) => {
    const rows = $$('.sr', sheet.body);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = Math.max(
        0,
        Math.min(rows.length - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)),
      );
      rows.forEach((r, i) =>
        r.setAttribute('aria-selected', String(i === cursor)),
      );
      rows[cursor]?.scrollIntoView({ block: 'nearest' });
    }
  });
  sheet.head.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (cursor >= 0 && items[cursor]) return choose(items[cursor]);
    if (items.length && input.value.trim() && !$('.sr-empty', sheet.body))
      return choose(items[0]);
    geocode();
  });
  sheet.head
    .querySelector('.search-cancel')
    .addEventListener('click', () => sheet.close());

  sheet.body.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-q]');
    if (chip) {
      haptic('tick');
      input.value = chip.dataset.q;
      render();
      return;
    }
    if (e.target.closest('[data-clear]')) {
      try {
        localStorage.removeItem(RECENT_KEY);
      } catch {
        /* ignore */
      }
      emptyState();
      return;
    }
    const r = e.target.closest('[data-i]');
    if (r) choose(items[Number(r.dataset.i)]);
  });

  return {
    open(q = '') {
      input.value = q;
      geo = [];
      render();
      sheet.open('large');
      setTimeout(() => input.focus({ preventScroll: true }), 120);
    },
    close: () => sheet.close(),
    get isOpen() {
      return sheet.isOpen;
    },
  };
}
