/**
 * The Rooms tab (DESIGN.md §12.7): live rooms now (watching, heat, a live
 * line of chat), Moments (today's hero, live detections, your clips), Need
 * eyes near you, and crews: yours, and ones to discover.
 */

import { icon } from './icons.js';
import { $, esc, ago, haptic, toast, esriThumb, reducedMotion } from './dom.js';
import { BAND_COLOR, bandOf } from './bands.js';
import { viewerCount, sampleLines, chatGenre } from './chatSim.js';
import { richText } from './emotes.js';
import { simTier, hashStr } from './signal.js';
import { crewAvatar, fmtM } from './crews.js';

const fmtV = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

export function createRoomsTab(el, core) {
  let tickers = [];
  let tickTimer = 0;
  let live = [];
  let moments = [];
  el.classList.add('rooms-tab');
  core.ctx.bindScroll?.(el);
  el.addEventListener(
    'scroll',
    () => el.classList.toggle('is-scrolled', el.scrollTop > 44),
    { passive: true },
  );

  function heatBars(s) {
    let x = hashStr(s.id);
    const bars = [];
    for (let i = 0; i < 12; i += 1) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      bars.push(0.25 + ((x >>> 8) % 100) / 133 + i / 30);
    }
    return `<span class="heat" aria-hidden="true">${bars.map((b, i) => `<i style="--h:${Math.min(1, b).toFixed(2)};--d:${i}"></i>`).join('')}</span>`;
  }

  function liveRow(s, i) {
    const band = bandOf(s);
    const v =
      viewerCount(s) + Math.max(0, core.rt.presence(String(s.id)).length - 1);
    const thumb =
      core.globe?.cachedThumbnail?.(s) || s.thumbUrl || s.thumbnail || '';
    return `<button type="button" class="lr-row" data-room="${esc(s.id)}" style="--band:${BAND_COLOR[band]}">
        <span class="lr-thumb" ${thumb ? `style="background-image:url('${esc(thumb)}')"` : ''}><span class="lr-live tele"><i></i>LIVE</span><span class="lr-v tele">${fmtV(v)}</span></span>
        <span class="lr-main">
          <b>${esc(s.title)}</b>
          <span class="lr-meta tele"><span>${esc(s.place || '')}</span>${heatBars(s)}</span>
          <span class="lr-ticker" data-tick="${i}"></span>
        </span>
      </button>`;
  }

  function momentHero(m) {
    const ms = Math.max(
      1,
      Math.round(((+m.time?.end || 0) - (+m.time?.start || 0)) / 60e3),
    );
    return `<div class="mo-hero" data-moment="${esc(m.id)}" style="background-image:url('${esc(esriThumb(m.lon, m.lat, 0.018, 720, 520))}')">
        <span class="fr" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <div class="mo-top tele"><span class="mo-k">${icon('sparkles')}Today’s Moment</span>${m.illustrative ? '<span class="badge-ill">Illustrative</span>' : '<span class="mo-real">Detected · ADS-B</span>'}</div>
        <div class="mo-body">
          <h3>${esc(m.title)}</h3>
          <div class="mo-sub tele">${esc(m.place || '')} · ${ms} min · ${(m.tracks || []).length || 3} aircraft · ${(m.captures || []).length} sealed captures</div>
          <div class="mo-acts">
            <button type="button" class="pill-btn primary sm" data-mo="play" data-id="${esc(m.id)}">${icon('play')}Replay</button>
            <button type="button" class="pill-btn glass sm" data-mo="party" data-id="${esc(m.id)}">${icon('users')}Watch party</button>
            <button type="button" class="pill-btn glass sm" data-mo="record" data-id="${esc(m.id)}">${icon('note')}Record</button>
          </div>
        </div>
      </div>`;
  }

  async function render() {
    const sits = (await core.situations()) || [];
    moments = await core.moments();
    const scored = sits
      .filter((s) => Number.isFinite(s.lat))
      .map((s) => ({ s, v: viewerCount(s) * (1 + (s.severity || 0) * 0.2) }))
      .sort((a, b) => b.v - a.v);
    // Diversity: one per chat genre.
    const seen = new Set();
    live = [];
    for (const x of scored) {
      const g = chatGenre(x.s);
      if (seen.has(g)) continue;
      seen.add(g);
      live.push(x.s);
      if (live.length >= 6) break;
    }
    const detections = sits
      .filter((s) => s.momentId || /circling/.test(s.kind || ''))
      .slice(0, 4);
    const loc = core.myLoc();
    const needs = core.needs
      .near(loc, 60)
      .filter((r) => r.status === 'open')
      .slice(0, 3);
    const crews = core.crews.list();
    const mine = crews.filter((c) => c.joined);
    const other = crews.filter((c) => !c.joined);
    const hero = moments[0];
    el.innerHTML = `
      <header class="navbar"><span class="nav-title">Rooms</span></header>
      <h1 class="large-title">Rooms</h1>
      <p class="rt-lede">Live is fast. The Record is true. Signal rewards being right, early, with receipts.</p>

      <div class="section-h">Live now <small>${live.reduce((a, s) => a + viewerCount(s), 0).toLocaleString()} watching</small></div>
      <div class="lr-list">${live.map(liveRow).join('') || '<div class="empty">Nothing unusual right now. That’s a valid state.</div>'}</div>

      <div class="section-h">Moments <small>4D replays with chat and the record</small></div>
      ${hero ? momentHero(hero) : ''}
      ${
        detections.length || moments.length > 1
          ? `<div class="mo-chips" data-hscroll>${[
              ...moments
                .slice(1)
                .map(
                  (m) =>
                    `<button type="button" class="mo-chip" data-mo="party" data-id="${esc(m.id)}">${icon('sky')}<span><b>${esc(m.title)}</b><small class="tele">${m.illustrative ? 'Illustrative' : 'Live detection'}</small></span></button>`,
                ),
              ...detections.map(
                (s) =>
                  `<button type="button" class="mo-chip" data-room="${esc(s.id)}">${icon('sky')}<span><b>${esc(s.title)}</b><small class="tele">Detected · ${esc(ago(s.updatedAt))}</small></span></button>`,
              ),
            ].join('')}</div>`
          : ''
      }
      <div class="mo-clips"><span class="mo-clip-ic">${icon('clock')}</span><span><b>Your clips</b><small>Select a range on the time machine and “Clip this Moment”. It lands here with its receipts.</small></span></div>

      <div class="section-h">Need eyes near you <small>${loc?.guessed ? 'approximate · share location for distances' : 'one quiet ask each'}</small></div>
      ${needs.length ? needs.map((n) => core.needs.cardHtml(n)).join('') : '<div class="empty">No open requests near you. Calm is a feature.</div>'}

      <div class="section-h">Your crews <small>${mine.length ? `${mine.length} joined` : 'communities, not followers'}</small></div>
      <div class="crew-strip" data-hscroll>${mine.map((c) => `<button type="button" class="crew-card" data-crew="${esc(c.id)}" style="--hue:${c.hue}">${crewAvatar(c)}<b>${esc(c.name)}</b><small class="tele">${fmtM(c.members)} members · ${c.feed.length} new</small><span class="crew-last">${esc(c.feed[1]?.h || '')}: ${richText((c.feed[1]?.t || '').slice(0, 70)).html}…</span></button>`).join('') || '<div class="empty">Join a crew to see its feed here.</div>'}</div>
      ${
        other.length
          ? `<div class="section-h">Discover crews</div><div class="group">${other.map((c) => `<div class="row crew-row" data-crew="${esc(c.id)}">${crewAvatar(c)}<span class="row-main"><span class="row-title">${esc(c.name)}</span><span class="row-sub">${esc(c.tagline)}</span></span><button type="button" class="pill-btn primary sm" data-join="${esc(c.id)}">Join</button></div>`).join('')}</div>`
          : ''
      }
      <p class="footnote">Simulated chat and example crews are labelled. Your posts, votes, captures and Signal are real and stay on this device.</p>`;
    // Tickers: a real-feeling line of each room's chat.
    tickers = live.map((s) => ({ s, lines: sampleLines(s, 8), i: 0 }));
    tickAll(true);
    clearInterval(tickTimer);
    tickTimer = setInterval(() => tickAll(false), 2600);
  }

  function tickAll(first) {
    if (!el.isConnected || (el.offsetParent === null && !first)) return;
    tickers.forEach((t, k) => {
      const node = $(`[data-tick="${k}"]`, el);
      if (!node || !t.lines.length) return;
      // Stagger so the list shimmers rather than blinks.
      if (!first && Math.random() < 0.45) return;
      const m = t.lines[t.i % t.lines.length];
      t.i += 1;
      const tier = m.tier || simTier(m.handle);
      node.innerHTML = `<span class="tk ${first || reducedMotion() ? '' : 'in'}"><b style="color:${tier.color}">${esc(m.handle.slice(1))}</b> ${richText(m.text).html}</span>`;
    });
  }

  el.addEventListener('click', async (e) => {
    const room = e.target.closest('[data-room]');
    if (room) {
      const sits = await core.situations();
      const s = sits.find((x) => String(x.id) === room.dataset.room);
      if (s) core.openRoom(s, { lane: 'live' });
      return;
    }
    const mo = e.target.closest('[data-mo]');
    if (mo) {
      haptic('light');
      const m =
        moments.find((x) => x.id === mo.dataset.id) ||
        (await core.moment(mo.dataset.id));
      if (mo.dataset.mo === 'play') {
        if (core.ctx.onPlayMoment) core.ctx.onPlayMoment(m);
        else core.openRoom(m, { lane: 'live' });
      } else
        core.openRoom(m, {
          lane: mo.dataset.mo === 'record' ? 'record' : 'live',
        });
      return;
    }
    const nd = e.target.closest('[data-need-act]');
    if (nd) {
      core.needs.act(nd.dataset.needAct, nd.dataset.need);
      return;
    }
    const jn = e.target.closest('[data-join]');
    if (jn) {
      core.crews.toggle(jn.dataset.join);
      haptic('success');
      toast('Joined', { icon: icon('users') });
      render();
      return;
    }
    const cr = e.target.closest('[data-crew]');
    if (cr) core.crews.open(cr.dataset.crew);
  });
  const offN = core.needs.on('change', () => el.isConnected && render());
  const offC = core.crews.on('change', () => el.isConnected && render());

  render();
  return {
    refresh: render,
    destroy() {
      clearInterval(tickTimer);
      offN?.();
      offC?.();
      el.innerHTML = '';
    },
  };
}
