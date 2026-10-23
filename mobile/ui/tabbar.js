/**
 * iOS 26-style floating glass tab bar with a tab-bar accessory
 * ("now playing" for the planet) and a search button in the same row.
 * Minimises to a compact pill while the feed scrolls down.
 */

import { icon, FAMILY_ICON } from './icons.js';
import { $, $$, esc, ago, fmtNum, haptic } from './dom.js';

export const TABS = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'live', label: 'Live', icon: 'globe' },
  { id: 'capture', label: 'Capture', icon: 'viewfinder' },
  { id: 'rooms', label: 'Rooms', icon: 'rooms' },
  { id: 'you', label: 'You', icon: 'you' },
];

export function createTabBar(nav, { onSelect, onSearch, onAccessory }) {
  nav.innerHTML = `
    <div class="tb-full">
      <button class="tb-accessory glass" type="button" hidden aria-label="Followed situation"></button>
      <div class="tb-tabs glass" role="tablist" aria-label="Sections">
        <span class="tb-lens" aria-hidden="true"></span>
        ${TABS.map(
          (
            t,
          ) => `<button class="tb-tab" role="tab" type="button" id="tab-${t.id}" data-tab="${t.id}" aria-selected="false" aria-controls="view-${t.id}">
              ${icon(t.icon)}<span class="tb-label">${t.label}</span></button>`,
        ).join('')}
      </div>
      <button class="tb-search glass" type="button" aria-label="Search">${icon('search')}</button>
    </div>
    <div class="tb-mini" aria-hidden="true">
      <button class="tb-mini-tab glass" type="button" tabindex="-1" aria-label="Show tabs"></button>
      <button class="tb-mini-acc glass liquid" type="button" tabindex="-1" hidden></button>
      <button class="tb-search glass" type="button" tabindex="-1" aria-label="Search">${icon('search')}</button>
    </div>`;

  const lens = $('.tb-lens', nav);
  const tabsEl = $('.tb-tabs', nav);
  const acc = $('.tb-accessory', nav);
  const miniTab = $('.tb-mini-tab', nav);
  const miniAcc = $('.tb-mini-acc', nav);
  let current = 'today';
  let minimized = false;
  let accSituation = null;

  function placeLens() {
    const idx = TABS.findIndex((t) => t.id === current);
    const w = (tabsEl.clientWidth - 8) / TABS.length;
    lens.style.width = `${w}px`;
    lens.style.transform = `translateX(${idx * w}px)`;
  }

  function select(id, { silent = false } = {}) {
    current = id;
    $$('.tb-tab', nav).forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.tab === id)),
    );
    const t = TABS.find((x) => x.id === id);
    miniTab.innerHTML = icon(t.icon);
    placeLens();
    if (!silent) setMinimized(false);
  }

  function setMinimized(v) {
    if (v === minimized) return;
    minimized = v;
    nav.classList.toggle('min', v);
    $('.tb-full', nav).toggleAttribute('inert', v);
    $('.tb-mini', nav).setAttribute('aria-hidden', String(!v));
    $$('.tb-mini button', nav).forEach((b) => (b.tabIndex = v ? 0 : -1));
  }

  function accessoryHtml(s) {
    const m = s.metrics?.[0];
    return `<span class="acc-glyph" data-family="${esc(s.family)}">${icon(s.icon || FAMILY_ICON[s.family] || 'now')}</span>
      <span class="acc-text"><span class="acc-title">${esc(s.title)}</span>
      <span class="acc-meta">${esc(s.status || `${s.place || ''} · ${ago(s.updatedAt)}`)}</span></span>
      ${m ? `<span class="acc-metric num" data-family="${esc(s.family)}">${esc(fmtNum(m.value))}${m.unit ? ` <small>${esc(m.unit)}</small>` : ''}</span>` : ''}`;
  }

  function setAccessory(s) {
    accSituation = s;
    acc.hidden = !s;
    miniAcc.hidden = !s;
    nav.classList.toggle('has-accessory', !!s);
    document.documentElement.classList.toggle('has-accessory', !!s);
    if (!s) return;
    acc.dataset.family = s.family;
    miniAcc.dataset.family = s.family;
    acc.innerHTML = accessoryHtml(s);
    miniAcc.innerHTML = accessoryHtml(s);
    acc.setAttribute('aria-label', `Following ${s.title}`);
  }

  nav.addEventListener('click', (e) => {
    const tab = e.target.closest('.tb-tab');
    if (tab) {
      if (tab.dataset.tab !== current) haptic('tick');
      onSelect(tab.dataset.tab, { reselect: tab.dataset.tab === current });
      return;
    }
    if (e.target.closest('.tb-search')) return onSearch();
    if (e.target.closest('.tb-accessory, .tb-mini-acc'))
      return accSituation && onAccessory(accSituation);
    if (e.target.closest('.tb-mini-tab')) setMinimized(false);
  });

  // Arrow-key roving focus across the tablist (ARIA tabs pattern).
  tabsEl.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = $$('.tb-tab', nav);
    const i = tabs.indexOf(document.activeElement);
    const n =
      tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    n.focus();
  });

  new ResizeObserver(placeLens).observe(tabsEl);

  /** Minimise while scrolling down; restore on scroll up or when scrolling stops. */
  function bindScroll(scroller) {
    let lastY = scroller.scrollTop;
    let acc = 0;
    let idle = 0;
    scroller.addEventListener(
      'scroll',
      () => {
        const y = scroller.scrollTop;
        const dy = y - lastY;
        lastY = y;
        acc = Math.sign(dy) === Math.sign(acc) ? acc + dy : dy;
        if (y < 40) setMinimized(false);
        else if (acc > 28) setMinimized(true);
        else if (acc < -18) setMinimized(false);
        clearTimeout(idle);
        idle = setTimeout(() => setMinimized(false), 1400);
      },
      { passive: true },
    );
  }

  return {
    select,
    setMinimized,
    setAccessory,
    bindScroll,
    get current() {
      return current;
    },
  };
}
