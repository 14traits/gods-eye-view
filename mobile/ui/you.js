/**
 * You: your sealed captures and live bundles, unverified uploads, your room
 * posts and holograms, followed situations, home area, and settings.
 */

import { icon, FAMILY_ICON } from './icons.js';
import { $, $$, esc, ago, haptic, store, applyMotionPref } from './dom.js';
import { all, get } from '../capture/db.js';
import { deviceKey } from '../capture/provenance.js';
import { KIND, badgesFor } from './rooms.js';
import { llShort } from './bands.js';

export function createYou(
  view,
  {
    bindScroll,
    getSituations,
    onOpenSituation,
    onVerify,
    onCredits,
    rooms,
    rt,
    onOpenRoom,
    onLocate,
  },
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
    const [captures, key, sits, uploads, posts] = await Promise.all([
      all('captures').catch(() => []),
      deviceKey().catch(() => null),
      getSituations().catch(() => []),
      all('uploads').catch(() => []),
      rooms.myPosts().catch(() => []),
    ]);
    uploads.sort((a, b) => b.addedAt - a.addedAt);
    posts.sort((a, b) => b.at - a.at);
    const sitOf = (id) => sits.find((x) => String(x.id) === id);
    const upThumbs = uploads.slice(0, 12).map((u) => {
      if (!u.blob) return '';
      const url = URL.createObjectURL(u.blob);
      urls.push(url);
      return url;
    });
    const holos = posts.filter((p) => p.hologram);
    const home = rt.me.home;
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
      <div class="you-id"><span class="avatar">${icon('you')}</span><div><b>${esc(rt.me.handle)} · this device</b>
        <span>${key ? `Signing key <span class="mono">${esc(key.keyId)}</span> · P-256 · ${key.extractable ? 'extractable' : 'non-extractable'}` : 'Signing key unavailable (needs a secure context)'}</span>
        <span>${captures.length} sealed capture${captures.length === 1 ? '' : 's'} · ${uploads.length} upload${uploads.length === 1 ? '' : 's'} · ${posts.length} post${posts.length === 1 ? '' : 's'} · ${followed.length} followed</span></div></div>

      <div class="section-h">Captures <small>tap to verify</small></div>
      ${
        captures.length
          ? `<div class="captures">${captures
              .slice(0, 30)
              .map(
                (c, i) =>
                  `<button class="capture-tile" type="button" data-cap="${esc(c.id)}" aria-label="Capture ${c.seq}, ${esc(ago(c.sealedAt))}">${thumbs[i] ? (/video/.test(c.media.type) ? `<video src="${thumbs[i]}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${thumbs[i]}" alt="" loading="lazy" decoding="async"/>`) : ''}<span class="ct-n num">#${c.seq}</span>${c.session?.mode === 'live' ? `<span class="ct-live tele">LIVE · ${c.session.segments?.length || 0} SEG</span>` : ''}<span class="ct-seal">${icon('sealFill')}</span></button>`,
              )
              .join('')}</div>`
          : `<div class="empty">${icon('seal')}<div>No sealed captures yet.</div><div>Open Capture → Witness and tap the shutter.</div></div>`
      }

      ${
        uploads.length
          ? `<div class="section-h">Uploads <small>unverified · no capture-time seal</small></div><div class="captures">${uploads
              .slice(0, 12)
              .map(
                (u, i) =>
                  `<div class="capture-tile is-unverified" aria-label="Upload ${esc(u.name)}">${upThumbs[i] ? (/video/.test(u.type) ? `<video src="${upThumbs[i]}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${upThumbs[i]}" alt="" loading="lazy" decoding="async"/>`) : ''}<span class="ct-live tele">UNVERIFIED</span></div>`,
              )
              .join('')}</div>`
          : ''
      }

      <div class="section-h">Your posts <small>${posts.length ? 'tap to open the room' : ''}</small></div>
      ${
        posts.length
          ? `<div class="group">${posts
              .slice(0, 20)
              .map((p) => {
                const st = sitOf(p.room);
                const k = KIND[p.kind] || KIND.context;
                const b = st ? badgesFor(p, st, rt.me) : [];
                return `<button class="row" type="button" data-post-room="${esc(p.room)}" data-post="${esc(p.id)}"><span class="row-icon" style="--fam:var(--b-inside)">${icon(k.icon)}</span><span class="row-main"><span class="row-title">${esc(p.text)}</span><span class="row-sub">${esc(k.name)} · ${esc(st?.title || p.room)} · ${esc(ago(p.at))}${b.length ? ` · ${b.map((x) => esc(x.label)).join(' · ')}` : ''}</span></span>${icon('chevronRight', { cls: 'chev' })}</button>`;
              })
              .join('')}</div>`
          : '<div class="empty">Nothing posted yet. Every situation has a room: open one and reply with evidence.</div>'
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

      <div class="section-h">Holograms <small>${holos.length ? `${holos.length} left in places` : ''}</small></div>
      ${
        holos.length
          ? `<div class="group">${holos.map((p) => `<button class="row" type="button" data-post-room="${esc(p.room)}" data-post="${esc(p.id)}"><span class="row-icon" style="--fam:var(--b-inside)">${icon('cube')}</span><span class="row-main"><span class="row-title">${esc(p.text)}</span><span class="row-sub mono">${esc(llShort(p.anchor?.lat, p.anchor?.lon, 4))} · ${esc(ago(p.at))}</span></span>${icon('chevronRight', { cls: 'chev' })}</button>`).join('')}</div>`
          : `<div class="holo">${icon('cube')}<div><b>Leave something in a place</b>When you post a capture, turn on “Leave as a hologram here”: it stays pinned on the globe at that spot for people who visit with Look.</div></div>`
      }

      <div class="section-h">Home area</div>
      <div class="group"><button class="row" type="button" data-act="home"><span class="row-icon" style="--fam:var(--b-ground)">${icon('home')}</span><span class="row-main"><span class="row-title">${home ? `Set near ${esc(llShort(home.lat, home.lon, 1))}` : 'Set your home area'}</span><span class="row-sub">Earns the Local badge on posts within 50 km. Stored on this device at 10 km precision.</span></span>${icon('chevronRight', { cls: 'chev' })}</button></div>

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
    const pr = e.target.closest('[data-post-room]');
    if (pr) {
      const s = (await getSituations()).find(
        (x) => String(x.id) === pr.dataset.postRoom,
      );
      if (s) onOpenRoom(s, pr.dataset.post);
      return;
    }
    if (e.target.closest('[data-act="home"]')) {
      const loc = await onLocate();
      if (loc) {
        rt.setHome({
          lat: Math.round(loc.lat * 10) / 10,
          lon: Math.round(loc.lon * 10) / 10,
        });
        haptic('success');
        render();
      }
    }
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
