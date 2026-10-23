/**
 * You (DESIGN.md §12.2, §12.7): Signal with its receipts, First eyes
 * bylines, your sealed captures and uploads, your posts and holograms,
 * what you watch, calm-by-default notifications, location precision, the
 * privacy line we don't cross, and settings.
 */

import { icon, FAMILY_ICON } from './icons.js';
import { $, $$, esc, ago, haptic, store, applyMotionPref } from './dom.js';
import { all, get } from '../capture/db.js';
import { deviceKey } from '../capture/provenance.js';
import { KIND, badgesFor } from './rooms.js';
import { llShort, utc } from './bands.js';
import { RULES, tierOf, TIERS } from './signal.js';

/** Shown, dimmed and labelled, until the person has receipts of their own. */
const EXAMPLE_LEDGER = [
  {
    delta: 40,
    text: 'Fulfilled Need eyes: “Is the 7th St underpass flooded?”',
    m: 1440,
  },
  { delta: 50, text: 'First eyes on Heavy rain cell over Houston', m: 1440 },
  {
    delta: 20,
    text: 'ADS-B: 4 aircraft within 8 km at the sealed time',
    m: 1441,
  },
  {
    delta: 5,
    text: '@wxdan (Corroborated, ×1.9) corroborated your capture',
    m: 1420,
  },
  {
    delta: -25,
    text: 'A bridged correction: your “Cat 5” claim used the wrong scale',
    m: 4320,
  },
];

const NOTIFY = [
  {
    id: 'severe',
    label: 'Severe, near me',
    sub: 'Only things that can hurt people, inside your alert radius',
  },
  {
    id: 'notable',
    label: 'Notable',
    sub: 'Plus wonder: ISS passes, launches, aurora over you',
  },
  {
    id: 'all',
    label: 'Everything',
    sub: 'Every situation inside the radius. Not recommended.',
  },
];

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
    core: coreIn,
  },
) {
  let core = coreIn || null;
  const getCore = async () =>
    (core =
      core ||
      (await import('./social.js')).socialCore({ rooms, rt, getSituations }));
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
    const c = await getCore();
    const [score, receipts] = await Promise.all([
      c.signal.score(),
      c.signal.receipts(),
    ]);
    const tier = tierOf(score);
    const firsts = receipts.filter((r) => r.rule === 'first');
    const exampleLedger = !receipts.length;
    const ledger = exampleLedger
      ? EXAMPLE_LEDGER.map((x) => ({
          ...x,
          at: Date.now() - x.m * 60e3,
          example: true,
        }))
      : receipts;
    const loc = c.myLoc();
    const needs = c.needs.near(loc, 60).filter((x) => x.status === 'open');
    const notify = store.get('notifyLevel') || 'severe';
    const asks = store.get('needAsks') || 'daily';
    const quiet = store.get('quietHours') ?? true;
    const prec = store.get('precisionDefault') || '100m';
    const watchSummary = c.ctx.watch?.summary?.() || null;
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

      <section class="sig-card" style="--tc:${tier.color}" aria-label="Signal">
        <div class="sig-top"><span class="tele">${icon('sparkles')}Signal</span><span class="sig-tier">${esc(tier.name)}</span></div>
        <div class="sig-score"><b class="num">${score.toLocaleString()}</b><span class="sig-w tele">votes weigh ×${tier.weight.toFixed(1)}</span></div>
        <div class="sig-bar"><i style="--p:${Math.round(tier.progress * 100)}%"></i>${TIERS.map((t) => `<em style="--at:${Math.min(100, (t.min / 1500) * 100)}%" title="${esc(t.name)}"></em>`).join('')}</div>
        <div class="sig-next tele">${tier.next ? `${(tier.next.min - score).toLocaleString()} to ${esc(tier.next.name)}` : 'Top tier'} · ${receipts.length} receipt${receipts.length === 1 ? '' : 's'} · ${firsts.length} first eyes</div>
        <p class="sig-why">Signal rises when your sealed captures are corroborated by people and by sensors, and falls when your claims are corrected. It weighs your votes and notes. <b>No follower counts, ever.</b></p>
        <details class="sig-rules"><summary>How Signal is calculated</summary><ul>${RULES.map((r) => `<li><b class="num ${r.delta < 0 ? 'neg' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</b><span>${esc(r.text)}</span></li>`).join('')}</ul><p>Tiers: ${TIERS.map((t) => `<span style="color:${t.color}">${esc(t.name)} ${t.min}+ (×${t.weight})</span>`).join(' · ')}</p></details>
      </section>

      ${
        firsts.length
          ? `<div class="section-h">First eyes <small>permanent bylines on the record</small></div><div class="bylines">${firsts
              .map(
                (r) =>
                  `<button type="button" class="byline" data-ref-room="${esc(r.ref?.room || '')}" data-ref-post="${esc(r.ref?.post || '')}"><span class="by-seal">${icon('sealFill')}</span><span><b class="tele">FIRST EYES · ${esc(rt.me.handle)} · ${esc(utc(new Date(r.at)))}</b><small>${esc(r.text.replace(/^First eyes on /, ''))}</small></span></button>`,
              )
              .join('')}</div>`
          : ''
      }

      <div class="section-h">Receipts <small>${exampleLedger ? 'example until you earn your own' : 'every change, with its reason'}</small></div>
      <div class="group ledger ${exampleLedger ? 'is-example' : ''}">${ledger
        .slice(0, 14)
        .map(
          (r) =>
            `<div class="row rx ${r.ref?.room ? 'tap' : ''}" ${r.ref?.room ? `data-ref-room="${esc(r.ref.room)}" data-ref-post="${esc(r.ref.post || '')}"` : ''}><b class="rx-d num ${r.delta < 0 ? 'neg' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</b><span class="row-main"><span class="row-title">${esc(r.text)}</span><span class="row-sub">${esc(ago(r.at))}${r.source ? ` · ${esc(r.source)}` : ''}${r.sim ? ' · simulated' : ''}${r.example ? ' · <span class="badge-example">Example</span>' : ''}</span></span></div>`,
        )
        .join('')}</div>
      ${
        exampleLedger
          ? `<div class="sig-cta">${icon('eyes')}<span><b>${needs.length ? `${needs.length} Need eyes request${needs.length === 1 ? '' : 's'} near you` : 'Earn your first receipt'}</b>Answer one with a sealed capture: +40 Signal and the First eyes byline.</span>${needs[0] ? `<button type="button" class="pill-btn primary sm" data-need-act="fulfil" data-need="${esc(needs[0].id)}">Answer</button>` : ''}</div>`
          : ''
      }

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

      <div class="section-h">Watching <small>${watchSummary ? esc(watchSummary) : 'places and things you follow'}</small>${c.ctx.watch?.open ? '<button type="button" class="linkish" data-act="watch">Alerts</button>' : ''}</div>
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

      <div class="section-h">Notifications <small>calm by default</small></div>
      <div class="group">
        <div class="row"><span class="row-icon" style="--fam:var(--b-ground)">${icon('hazards')}</span><span class="row-main"><span class="row-title">Tell me about</span><span class="row-sub">${esc(NOTIFY.find((x) => x.id === notify).sub)}</span></span></div>
        <div class="seg-row"><div class="segmented" data-set="notifyLevel">${NOTIFY.map((v) => `<button type="button" data-v="${v.id}" aria-pressed="${notify === v.id}">${v.label}</button>`).join('')}<span class="seg-thumb"></span></div></div>
        <div class="row"><span class="row-icon" style="--fam:var(--eyes)">${icon('eyes')}</span><span class="row-main"><span class="row-title">Need eyes asks</span><span class="row-sub">At most one quiet ask a day, only when you’re inside a request’s radius</span></span></div>
        <div class="seg-row"><div class="segmented" data-set="needAsks">${[
          ['daily', 'One a day'],
          ['off', 'Off'],
        ]
          .map(
            ([v, l]) =>
              `<button type="button" data-v="${v}" aria-pressed="${asks === v}">${l}</button>`,
          )
          .join('')}<span class="seg-thumb"></span></div></div>
        <div class="row"><span class="row-icon" style="--fam:var(--orbit)">${icon('clock')}</span><span class="row-main"><span class="row-title">Quiet hours</span><span class="row-sub">22:00–07:00 · severe and local only</span></span><button class="switch" type="button" role="switch" aria-checked="${quiet}" aria-label="Quiet hours" data-switch="quietHours"></button></div>
        <div class="row calm-now"><span class="row-icon" style="--fam:var(--ok)">${icon('checkmark')}</span><span class="row-main"><span class="row-title">Nothing unusual near you</span><span class="row-sub">That’s a valid state. No alarm feed, no upsell.</span></span></div>
      </div>

      <div class="section-h">Location you share <small>default for new captures</small></div>
      <div class="group">
        <div class="seg-row"><div class="segmented" data-set="precisionDefault">${[
          ['exact', 'Exact'],
          ['100m', '100 m'],
          ['1km', '1 km'],
        ]
          .map(
            ([v, l]) =>
              `<button type="button" data-v="${v}" aria-pressed="${prec === v}">${l}</button>`,
          )
          .join('')}<span class="seg-thumb"></span></div></div>
        <div class="row"><span class="row-icon" style="--fam:var(--seal)">${icon('lock')}</span><span class="row-main"><span class="row-sub">The seal still proves the exact position to verifiers without publishing it. You can change it per capture.</span></span></div>
      </div>

      <div class="section-h">The line we don’t cross</div>
      <div class="privacy-card">${icon('eyes')}<div><b>We track things that broadcast, never people.</b><span>Trackable entities are transponders, AIS, orbital elements, public infrastructure and events. Contributors are pseudonymous. There is no face recognition and no person search, and aircraft on owner-privacy lists (LADD/PIA) are never named.</span></div></div>

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
    const nd = e.target.closest('[data-need-act]');
    if (nd) {
      (await getCore()).needs.act(nd.dataset.needAct, nd.dataset.need);
      return;
    }
    if (e.target.closest('[data-act="watch"]')) {
      (await getCore()).ctx.watch?.open?.();
      return;
    }
    const ref = e.target.closest('[data-ref-room]');
    if (ref && ref.dataset.refRoom) {
      const sits = await getSituations();
      const st = sits.find((x) => String(x.id) === ref.dataset.refRoom);
      if (st) onOpenRoom(st, ref.dataset.refPost || undefined);
      return;
    }
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
      if (seg.dataset.set === 'notifyLevel') render();
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
  // Signal changes (a corroboration, a fulfilled request) refresh You live.
  getCore()
    .then((c) =>
      c.signal.on('change', () => {
        if (view.isConnected && !view.hidden) render();
      }),
    )
    .catch(() => {});
  return { render };
}
