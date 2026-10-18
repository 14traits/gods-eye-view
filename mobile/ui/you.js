/** You: captures and their seals, followed situations, holograms, settings. */

import { icon, FAMILY_ICON } from './icons.js';
import { $, $$, esc, ago, haptic, store, applyMotionPref } from './dom.js';
import { all, get } from '../capture/db.js';
import { deviceKey } from '../capture/provenance.js';

export function createYou(
  view,
  { bindScroll, getSituations, onOpenSituation, onVerify, onCredits },
) {
  let urls = [];
  view.addEventListener(
    'scroll',
    () => view.classList.toggle('is-scrolled', view.scrollTop > 44),
    { passive: true },
  );
  bindScroll(view);

  async function render() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    const [captures, key, sits] = await Promise.all([
      all('captures').catch(() => []),
      deviceKey().catch(() => null),
      getSituations().catch(() => []),
    ]);
    captures.sort((a, b) => b.seq - a.seq);
    const followed = store.get('followed') || [];
    const fol = followed
      .map((id) => sits.find((s) => String(s.id) === id))
      .filter(Boolean);
    const contacts = followed.filter((id) => id.startsWith('contact:'));
    const thumbs = await Promise.all(
      captures.slice(0, 30).map(async (c) => {
        const m = await get('media', c.id).catch(() => null);
        if (!m?.blob) return '';
        const u = URL.createObjectURL(m.blob);
        urls.push(u);
        return u;
      }),
    );
    const q = store.get('quality');
    const rm = store.get('reduceMotion');
    const radius = store.get('alertRadiusKm');
    view.innerHTML = `
      <header class="navbar"><span class="nav-title">You</span></header>
      <h1 class="large-title">You</h1>
      <div class="you-id"><span class="avatar">${icon('you')}</span><div><b>This device</b>
        <span>${key ? `Signing key <span class="mono">${esc(key.keyId)}</span> · P-256 · ${key.extractable ? 'extractable' : 'non-extractable'}` : 'Signing key unavailable (needs a secure context)'}</span>
        <span>${captures.length} sealed capture${captures.length === 1 ? '' : 's'} · ${followed.length} followed</span></div></div>

      <div class="section-h">Captures <small>tap to verify</small></div>
      ${
        captures.length
          ? `<div class="captures">${captures
              .slice(0, 30)
              .map(
                (c, i) =>
                  `<button class="capture-tile" type="button" data-cap="${esc(c.id)}" aria-label="Capture ${c.seq}, ${esc(ago(c.sealedAt))}">${thumbs[i] ? (/video/.test(c.media.type) ? `<video src="${thumbs[i]}" muted playsinline preload="metadata"></video>` : `<img src="${thumbs[i]}" alt="" loading="lazy" decoding="async"/>`) : ''}<span class="ct-n num">#${c.seq}</span><span class="ct-seal">${icon('sealFill')}</span></button>`,
              )
              .join('')}</div>`
          : `<div class="empty">${icon('seal')}<div>No sealed captures yet.</div><div>Open Capture → Witness and tap the shutter.</div></div>`
      }

      <div class="section-h">Following</div>
      ${
        fol.length || contacts.length
          ? `<div class="group">${fol
              .map(
                (s) =>
                  `<button class="row" type="button" data-sit="${esc(s.id)}" data-family="${esc(s.family)}"><span class="row-icon">${icon(FAMILY_ICON[s.family] || 'now')}</span><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(s.place)} · ${esc(ago(s.updatedAt))}</span></span>${icon('chevronRight', { cls: 'chev' })}</button>`,
              )
              .join(
                '',
              )}${contacts.map((c) => `<div class="row"><span class="row-icon" style="--fam:var(--sky)">${icon('scope')}</span><span class="row-main"><span class="row-title mono">${esc(c.slice(8))}</span><span class="row-sub">Contact</span></span></div>`).join('')}</div>`
          : '<div class="empty">Follow a situation from its brief and it appears here and in the tab-bar accessory.</div>'
      }

      <div class="section-h">Holograms <small><span class="badge-example">Concept</span></small></div>
      <div class="holo">${icon('cube')}<div><b>Leave something in a place</b>Pin a 3D note to a spot on Earth for people who visit with Look. Concept placeholder in this prototype.</div></div>

      <div class="section-h">Settings</div>
      <div class="group">
        <div class="row"><span class="row-icon" style="--fam:var(--sky)">${icon('globe')}</span><span class="row-main"><span class="row-title">Globe quality</span><span class="row-sub">Applies on next launch</span></span></div>
        <div class="seg-row"><div class="segmented" data-set="quality">${['auto', 'high', 'battery'].map((v) => `<button type="button" data-v="${v}" aria-pressed="${q === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}<span class="seg-thumb"></span></div></div>
        <div class="row"><span class="row-icon" style="--fam:var(--orbit)">${icon('sparkles')}</span><span class="row-main"><span class="row-title">Reduce motion</span><span class="row-sub">Cross-fades instead of flights and morphs</span></span></div>
        <div class="seg-row"><div class="segmented" data-set="reduceMotion">${['system', 'on', 'off'].map((v) => `<button type="button" data-v="${v}" aria-pressed="${rm === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}<span class="seg-thumb"></span></div></div>
        <div class="row"><span class="row-icon" style="--fam:var(--hazards)">${icon('pin')}</span><span class="row-main"><span class="row-title">Alert radius</span><span class="row-sub">Situations inside it ping you</span></span><span class="row-value num" data-radius>${radius.toLocaleString()} km</span></div>
        <div class="slider-row"><input class="slider" type="range" min="25" max="2000" step="25" value="${radius}" aria-label="Alert radius in kilometres" style="--p:${((radius - 25) / 1975) * 100}%"/></div>
        <div class="row"><span class="row-icon" style="--fam:var(--eyes)">${icon('hand')}</span><span class="row-main"><span class="row-title">Haptics</span><span class="row-sub">Ribbon detents and seals only</span></span><button class="switch" type="button" role="switch" aria-checked="${store.get('haptics')}" aria-label="Haptics" data-switch="haptics"></button></div>
      </div>

      <div class="section-h">About</div>
      <div class="group">
        <button class="row" type="button" data-act="credits"><span class="row-icon" style="--fam:var(--infra)">${icon('info')}</span><span class="row-main"><span class="row-title">Data &amp; attribution</span><span class="row-sub">Esri, NASA, Vantor, GeoPera, OpenStreetMap</span></span>${icon('chevronRight', { cls: 'chev' })}</button>
        <div class="row"><span class="row-icon" style="--fam:var(--seal)">${icon('lock')}</span><span class="row-main"><span class="row-title">Provenance</span><span class="row-sub">Prototype uses WebCrypto ECDSA P-256 with a non-extractable key in IndexedDB. Native builds use the Secure Enclave and C2PA.</span></span></div>
      </div>
      <p class="footnote">God’s Eye mobile prototype. The window through which you see the world, and the eye through which the world sees itself.</p>`;
    $$('.segmented', view).forEach(placeThumb);
  }

  function placeThumb(seg) {
    const b = $('[aria-pressed="true"]', seg) || $('button', seg);
    const th = $('.seg-thumb', seg);
    if (!b || !th) return;
    th.style.width = `${b.offsetWidth}px`;
    th.style.transform = `translateX(${b.offsetLeft}px)`;
  }

  view.addEventListener('click', async (e) => {
    const cap = e.target.closest('[data-cap]');
    if (cap) {
      const c = (await all('captures')).find((x) => x.id === cap.dataset.cap);
      if (c) onVerify(c);
      return;
    }
    const sit = e.target.closest('[data-sit]');
    if (sit) {
      const s = (await getSituations()).find(
        (x) => String(x.id) === sit.dataset.sit,
      );
      if (s) onOpenSituation(s);
      return;
    }
    const segBtn = e.target.closest('.segmented[data-set] button');
    if (segBtn) {
      const seg = segBtn.parentElement;
      $$('button', seg).forEach((b) =>
        b.setAttribute('aria-pressed', String(b === segBtn)),
      );
      placeThumb(seg);
      store.set(seg.dataset.set, segBtn.dataset.v);
      if (seg.dataset.set === 'reduceMotion') applyMotionPref();
      haptic('tick');
      return;
    }
    const sw = e.target.closest('[data-switch]');
    if (sw) {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      store.set(sw.dataset.switch, on);
      haptic('tick');
      return;
    }
    if (e.target.closest('[data-act="credits"]')) onCredits();
  });
  view.addEventListener('input', (e) => {
    if (!e.target.matches('.slider')) return;
    const v = Number(e.target.value);
    e.target.style.setProperty('--p', `${((v - 25) / 1975) * 100}%`);
    $('[data-radius]', view).textContent = `${v.toLocaleString()} km`;
  });
  view.addEventListener('change', (e) => {
    if (e.target.matches('.slider'))
      store.set('alertRadiusKm', Number(e.target.value));
  });

  new ResizeObserver(() => $$('.segmented', view).forEach(placeThumb)).observe(
    view,
  );
  return { render };
}
