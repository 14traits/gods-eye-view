/**
 * Attach sheet (DESIGN.md §11.4): after any capture, suggest where it
 * belongs from distance and time ("Typhoon · 4.2 km from track", "Times
 * Square camera · 180 m"), or a new place; pick a post kind, add a note,
 * choose how precisely to share the location, and optionally leave it as a
 * hologram. Posting creates a room post, a Witness card and a globe pin.
 */

import { icon } from './icons.js';
import { $, $$, esc, haptic, toast, store } from './dom.js';
import { createSheet } from './sheet.js';
import { KINDS, KIND, wasThere } from './rooms.js';
import {
  BAND_NAME,
  bandOf,
  distKm,
  fmtKm,
  llShort,
  presenceRadiusKm,
  utc,
} from './bands.js';

const PRECISION = [
  { id: 'exact', label: 'Exact', round: null },
  { id: '100m', label: '100 m', round: 3 },
  { id: '1km', label: '1 km', round: 2 },
];

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i += 1)
    x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return (x >>> 0).toString(36);
}

export function createAttach({ rooms, globe, getSituations, onPosted }) {
  const sheet = createSheet({
    label: 'Post this capture',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'attach-sheet opaque',
    heights: { large: (H) => Math.round(Math.min(H * 0.92, 880)) },
  });
  let ctx = null;

  async function suggestions(item, preset) {
    const sits = (await getSituations()).filter((s) => Number.isFinite(s.lat));
    const fix = item.fix;
    const scored = sits.map((s) => {
      const km = fix ? distKm(fix, s) : NaN;
      const there =
        item.sealed && fix ? wasThere(s, fix, item.at).there : false;
      return { s, km, there };
    });
    let list;
    if (fix)
      list = scored
        .filter(
          (x) =>
            x.km < Math.max(presenceRadiusKm(x.s) * 4, 60) ||
            x.s.id === preset?.id,
        )
        .sort((a, b) => a.km - b.km)
        .slice(0, 4);
    else
      list = [...scored]
        .sort((a, b) => (b.s.severity || 0) - (a.s.severity || 0))
        .slice(0, 4);
    if (preset && !list.some((x) => x.s.id === preset.id)) {
      const p = scored.find((x) => x.s.id === preset.id) || {
        s: preset,
        km: fix ? distKm(fix, preset) : NaN,
        there: false,
      };
      list.unshift(p);
    } else if (preset)
      list.sort((a, b) =>
        a.s.id === preset.id ? -1 : b.s.id === preset.id ? 1 : 0,
      );
    // The nearest public camera is a place too.
    if (fix) {
      const eye = await globe.nearestEye(fix.lon, fix.lat, 3).catch(() => null);
      if (eye && !list.some((x) => x.s.media?.cameraId === eye.id)) {
        const s = {
          id: `eye-${eye.id}`,
          kind: 'camera',
          family: 'eyes',
          band: 'ground',
          archetype: 'eye',
          title: `${eye.title} camera`,
          place: [eye.city, eye.provider].filter(Boolean).join(' · '),
          lat: eye.lat,
          lon: eye.lon,
          live: true,
          updatedAt: Date.now(),
          source: eye.provider
            ? `${eye.provider} public camera`
            : 'Public camera',
          metrics: [],
          media: {
            kind: 'image',
            url: eye.imageUrl,
            cameraId: eye.id,
            headingDeg: eye.headingDeg,
            refreshMs: 15000,
            city: eye.city,
            provider: eye.provider,
          },
          camera: {
            lon: eye.lon,
            lat: eye.lat,
            height: 900,
            heading: eye.headingDeg || 0,
            pitch: -30,
          },
          layers: [],
        };
        list.push({
          s,
          km: distKm(fix, s),
          there: item.sealed && distKm(fix, s) <= 1.5,
          eye: true,
        });
      }
    }
    return list;
  }

  function row(x, i) {
    const s = x.s;
    const band = bandOf(s);
    const near = Number.isFinite(x.km)
      ? `${fmtKm(x.km)} from ${/cyclone|typhoon|hurricane/.test(s.kind) ? 'track' : x.eye ? 'camera' : 'it'}`
      : 'no location on this capture';
    return `<button type="button" role="radio" class="att-row" data-i="${i}" aria-checked="${i === ctx.sel}" data-band="${band}">
      <span class="ar-dot"></span>
      <span class="ar-main"><b>${esc(s.title)}</b><span class="tele">${esc(BAND_NAME[band])} · ${esc(near)}</span></span>
      ${x.there ? `<span class="bdg" data-b="there">${icon('location')}Was there</span>` : ''}
    </button>`;
  }

  function render() {
    const it = ctx.item;
    const head = it.unverified
      ? 'UPLOAD · UNVERIFIED'
      : it.kind === 'live'
        ? `WITNESS · SEALED LIVE · ${it.segments || 0} SEGMENTS`
        : `WITNESS · SEALED${it.seq ? ` #${it.seq}` : ''}`;
    sheet.head.innerHTML = `<div class="att-head">
        <span class="att-thumb ${it.unverified ? 'un' : ''}">${it.previewUrl ? (it.isVideo ? `<video src="${esc(it.previewUrl)}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${esc(it.previewUrl)}" alt=""/>`) : ''}<span>${icon(it.unverified ? 'upload' : 'sealFill')}</span></span>
        <div><div class="tele att-tele">${esc(head)}</div>
        <div class="tele att-sub">${it.fix ? `${esc(llShort(it.fix.lat, it.fix.lon, 4))}${Number.isFinite(it.fix.acc) ? ` ±${Math.round(it.fix.acc)} M` : ''}` : 'NO POSITION'} · ${esc(utc(new Date(it.at), { seconds: false }))}</div>
        <h2 class="sheet-title">${ctx.needEyes ? 'Answer the request' : 'Where does this belong?'}</h2></div>
      </div>${ctx.needEyes ? `<div class="att-need">${icon('eyes')}<span><b>Need eyes</b> “${esc(ctx.needEyes.question)}”<small class="tele">${esc(ctx.needEyes.by || '')} · ${it.unverified ? 'uploads can’t fulfil a request' : 'first sealed answer gets the byline'}</small></span></div>` : ''}`;
    sheet.body.innerHTML = `
      <div class="att-list" role="radiogroup" aria-label="Situation">
        ${ctx.list.map(row).join('')}
        <button type="button" role="radio" class="att-row new" data-i="new" aria-checked="${ctx.sel === 'new'}" data-band="inside">
          <span class="ar-dot"></span><span class="ar-main"><b>New place</b><span class="tele">Start a room here${it.fix ? ` · ${esc(llShort(it.fix.lat, it.fix.lon, 3))}` : ''}</span></span>${icon('plus')}
        </button>
        <input class="att-name" type="text" maxlength="80" placeholder="Name this place" ${ctx.sel === 'new' ? '' : 'hidden'} data-no-drag/>
      </div>
      <div class="att-h tele">Post as</div>
      <div class="kind-row" role="radiogroup" aria-label="Kind of post">${KINDS.map((k) => `<button type="button" role="radio" class="kind-chip" data-kind="${k.id}" aria-checked="${k.id === ctx.kind}">${icon(k.icon)}<span>${k.name}</span></button>`).join('')}</div>
      <textarea class="cmp-text att-note" rows="3" maxlength="2000" placeholder="What are we looking at? (optional)" data-no-drag aria-label="Note"></textarea>
      <div class="att-h tele">Share location at</div>
      <div class="seg-chips" data-prec>${PRECISION.map((p) => `<button type="button" data-v="${p.id}" aria-pressed="${p.id === ctx.precision}">${p.label}</button>`).join('')}</div>
      <p class="att-fine">${it.unverified ? 'Uploads carry no capture-time seal: they are marked Unverified everywhere and can be cited, never treated as an observation.' : 'The seal still proves the exact position to verifiers without publishing it.'}</p>
      <label class="att-holo"><span class="ah-ic">${icon('cube')}</span><span class="ah-t"><b>Leave as a hologram here</b><span>People who stand here with Look will find it, pinned in place.</span></span><button class="switch" type="button" role="switch" aria-checked="${ctx.hologram}" data-holo aria-label="Leave as hologram"></button></label>
      <button class="pill-btn primary att-post" type="button" data-act="post">${icon('sendUp')}Post to the room</button>`;
  }

  async function open(
    item,
    { preset = null, replyTo = null, needEyes = null } = {},
  ) {
    ctx = {
      item,
      list: [],
      sel: 0,
      kind: replyTo
        ? replyTo.kind === 'question'
          ? 'witness'
          : 'correction'
        : 'witness',
      precision: item.unverified
        ? '100m'
        : store.get('precisionDefault') || '100m',
      hologram: false,
      replyTo,
      preset: preset || needEyes?.situation || null,
      needEyes,
    };
    ctx.list = await suggestions(item, ctx.preset);
    if (!ctx.list.length) ctx.sel = 'new';
    render();
    sheet.open('large');
  }

  sheet.root.addEventListener('click', async (e) => {
    if (!ctx) return;
    const r = e.target.closest('.att-row');
    if (r) {
      ctx.sel = r.dataset.i === 'new' ? 'new' : Number(r.dataset.i);
      $$('.att-row', sheet.body).forEach((b) =>
        b.setAttribute('aria-checked', String(b === r)),
      );
      const name = $('.att-name', sheet.body);
      name.hidden = ctx.sel !== 'new';
      if (!name.hidden) name.focus();
      haptic('tick');
      return;
    }
    const k = e.target.closest('[data-kind]');
    if (k) {
      ctx.kind = k.dataset.kind;
      $$('[data-kind]', sheet.body).forEach((b) =>
        b.setAttribute('aria-checked', String(b === k)),
      );
      haptic('tick');
      return;
    }
    const pr = e.target.closest('[data-prec] button');
    if (pr) {
      ctx.precision = pr.dataset.v;
      $$('[data-prec] button', sheet.body).forEach((b) =>
        b.setAttribute('aria-pressed', String(b === pr)),
      );
      haptic('tick');
      return;
    }
    const holo = e.target.closest('[data-holo]');
    if (holo) {
      e.preventDefault();
      ctx.hologram = !ctx.hologram;
      holo.setAttribute('aria-checked', String(ctx.hologram));
      haptic('tick');
      return;
    }
    if (e.target.closest('[data-act="post"]')) await post();
  });

  async function post() {
    const it = ctx.item;
    let s;
    if (ctx.sel === 'new') {
      const name = $('.att-name', sheet.body).value.trim();
      const ll = it.fix || { lat: 0, lon: 0 };
      s = await rooms.addPlace({
        id: `place-${hash(`${ll.lat.toFixed(3)},${ll.lon.toFixed(3)},${name}`)}`,
        kind: 'place',
        family: 'eyes',
        band: 'inside',
        archetype: 'sensor',
        title: name || `Place near ${llShort(ll.lat, ll.lon, 2)}`,
        place: llShort(ll.lat, ll.lon, 3),
        subtitle: 'Started by a witness on this device',
        lat: ll.lat,
        lon: ll.lon,
        live: true,
        updatedAt: Date.now(),
        source: 'Your capture',
        metrics: [],
        layers: ['eyes.signed-captures'],
        camera: {
          lon: ll.lon,
          lat: ll.lat,
          height: 3000,
          heading: 0,
          pitch: -45,
        },
        local: true,
      });
    } else {
      s = ctx.list[ctx.sel].s;
      if (ctx.list[ctx.sel].eye) await rooms.addPlace(s);
    }
    const p = PRECISION.find((x) => x.id === ctx.precision);
    const round = (v) => (p.round == null ? v : Number(v.toFixed(p.round)));
    const fix = it.fix;
    let there =
      it.sealed && fix
        ? wasThere(s, fix, it.at)
        : { there: false, km: fix ? distKm(fix, s) : NaN };
    // Answering a Need eyes request: "there" means inside its radius.
    if (ctx.needEyes && it.sealed && fix) {
      const nk = distKm(fix, ctx.needEyes);
      if (nk <= (ctx.needEyes.radiusKm || 2)) there = { there: true, km: nk };
    }
    const text = $('.att-note', sheet.body).value.trim() || defaultText(it, s);
    const postRec = await rooms.post(s, {
      kind: ctx.kind,
      text,
      replyTo: ctx.replyTo?.id || null,
      hologram: ctx.hologram,
      anchor: fix
        ? {
            lat: round(fix.lat),
            lon: round(fix.lon),
            t: it.at,
            precision: ctx.precision,
          }
        : { t: it.at },
      needEyes:
        ctx.needEyes && !it.unverified
          ? { id: ctx.needEyes.id, question: ctx.needEyes.question }
          : null,
      evidence: {
        captureId: it.unverified ? undefined : it.id,
        uploadId: it.unverified ? it.id : undefined,
        sealed: !!it.sealed,
        live: it.kind === 'live',
        unverified: !!it.unverified,
        wasThere: !!there.there,
        distanceKm: Number.isFinite(there.km)
          ? Math.round(there.km * 100) / 100
          : null,
        precision: ctx.precision,
        headingDeg: it.headingDeg ?? null,
        video: !!it.isVideo,
      },
    });
    if (fix)
      globe.addPin({
        id: `post:${postRec.id}`,
        lon: round(fix.lon),
        lat: round(fix.lat),
        kind: ctx.hologram ? 'hologram' : 'witness',
        label: ctx.hologram ? 'Hologram' : `${KIND[ctx.kind].name} · you`,
        headingDeg: it.headingDeg ?? undefined,
      });
    haptic('success');
    sheet.close();
    const need = ctx.needEyes && !it.unverified ? ctx.needEyes : null;
    if (need && s.adhoc) await rooms.addPlace(s);
    toast(`Posted to ${s.title}${there.there ? ' · Was there' : ''}`, {
      icon: icon(it.unverified ? 'upload' : 'sealFill'),
    });
    onPosted?.(s, postRec);
    // Signal, First eyes, Need eyes and the Moment timeline (social layer).
    import('./social.js')
      .then((m) => m.socialCore().afterPost(s, postRec, it, { needEyes: need }))
      .catch((err) => console.warn('social afterPost failed', err));
  }

  function defaultText(it, s) {
    if (it.unverified)
      return `Uploaded a ${it.isVideo ? 'video' : 'photo'} for ${s.title}.`;
    if (it.kind === 'live')
      return `Broadcast live from here: ${it.segments || 0} sealed segments.`;
    return `Sealed ${it.isVideo ? 'clip' : 'photo'} from here.`;
  }

  return { open, close: () => sheet.close() };
}
