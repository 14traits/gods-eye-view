/** Verify inspector: recompute and show every check, Tufte-clean. */

import { icon } from './icons.js';
import { esc, sparkPath, esriThumb, haptic } from './dom.js';
import { createSheet } from './sheet.js';
import { verify } from '../capture/provenance.js';
import { get } from '../capture/db.js';

const GLYPH = {
  pass: 'checkmark',
  warn: 'hazards',
  fail: 'xmark',
  na: 'minus',
};

export function createInspector() {
  const sheet = createSheet({
    label: 'Verify capture',
    detents: ['large'],
    modal: true,
    dismissible: true,
    closeButton: true,
    className: 'opaque inspector',
    heights: { large: (H) => Math.round(H * 0.94) },
  });
  let urls = [];

  function small(label, values, unit) {
    const v = values.filter(Number.isFinite);
    if (v.length < 3)
      return `<div class="sm"><span>${label}</span><em>—</em></div>`;
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return `<div class="sm"><span>${label}</span><svg viewBox="0 0 120 26" preserveAspectRatio="none"><path d="${sparkPath(v, 120, 26, 2)}"/></svg><em class="num">${lo.toFixed(1)}–${hi.toFixed(1)}${unit}</em></div>`;
  }

  async function open(bundle) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    const rec = await get('media', bundle.id).catch(() => null);
    const blob = rec?.blob || null;
    const url = blob ? URL.createObjectURL(blob) : '';
    if (url) urls.push(url);
    const isVideo = /video/.test(bundle.media.type);
    const when = new Date(bundle.sealedAt);
    sheet.head.innerHTML = `<div class="insp-head">
        <div class="insp-thumb">${url ? (isVideo ? `<video src="${url}" muted playsinline></video>` : `<img src="${url}" alt="Capture ${bundle.seq}"/>`) : ''}<span>${icon('sealFill')}</span></div>
        <div><h2 class="sheet-title">Capture #${bundle.seq}</h2><div class="sheet-sub">${esc(when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }))}${bundle.context?.testFrame ? ' · <span class="badge-example">Test frame</span>' : ''}</div></div>
      </div>`;
    sheet.body.innerHTML = `<div class="insp-banner running"><span class="spinner"></span>Recomputing hashes and checking the signature…</div>`;
    sheet.open('large');
    const t0 = performance.now();
    const res = await verify(bundle, blob);
    const ms = Math.round(performance.now() - t0);
    const fails = res.checks.filter((c) => c.status === 'fail').length;
    const warns = res.checks.filter((c) => c.status === 'warn').length;
    haptic(fails ? 'warn' : 'success');
    const imu = bundle.session?.imu || [];
    const gps = bundle.session?.gps || [];
    const f = gps[gps.length - 1];
    sheet.body.innerHTML = `
      <div class="insp-banner ${fails ? 'fail' : warns ? 'warn' : 'pass'}">${icon(fails ? 'xmark' : 'seal')}<div><b>${fails ? `${fails} check${fails > 1 ? 's' : ''} failed` : warns ? `Verified with ${warns} caveat${warns > 1 ? 's' : ''}` : 'All checks passed'}</b><span>Recomputed on this device in ${ms} ms. None of this proves truth; it raises the cost of lying.</span></div></div>
      <ol class="checks">${res.checks
        .map(
          (c) =>
            `<li class="check ${c.status}"><span class="ck">${icon(GLYPH[c.status] || 'minus')}</span><div><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></div></li>`,
        )
        .join('')}</ol>
      <div class="block"><div class="block-h">Motion during capture<small>${imu.length} samples</small></div>
        <div class="smalls">${small(
          'α',
          imu.map((s) => s.α),
          '°',
        )}${small(
          'β',
          imu.map((s) => s.β),
          '°',
        )}${small(
          'γ',
          imu.map((s) => s.γ),
          '°',
        )}${small(
          '|a|',
          imu.map((s) => Math.hypot(s.ax ?? NaN, s.ay ?? NaN, s.az ?? NaN)),
          '',
        )}</div></div>
      ${f ? `<div class="block"><div class="block-h">Where it was sealed<small>±${Math.round(f.acc)} m</small></div><div class="insp-map"><img src="${esc(esriThumb(f.lon, f.lat, 0.012, 600, 300))}" alt="" loading="lazy"/><i></i><span class="mono">${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}</span></div></div>` : ''}
      <div class="block"><div class="block-h">Bundle</div><dl class="facts mono-facts">
        <dt>hash</dt><dd class="mono">${esc(bundle.hash)}</dd>
        <dt>media</dt><dd class="mono">${esc(bundle.media.sha256)}</dd>
        <dt>prev</dt><dd class="mono">${esc(bundle.prev || 'null (genesis)')}</dd>
        <dt>key</dt><dd class="mono">${esc(bundle.keyId)} · P-256</dd>
        <dt>sig</dt><dd class="mono">${esc(bundle.signature.slice(0, 48))}…</dd>
        <dt>device</dt><dd>${esc(bundle.context?.device || '')} · ${esc(bundle.context?.timezone || '')}</dd></dl></div>
      <div class="insp-actions"><button class="pill-btn plain" type="button" data-insp="export">${icon('download')}Export bundle</button><button class="pill-btn plain" type="button" data-insp="reverify">${icon('refresh')}Verify again</button></div>
      <p class="footnote" style="padding:12px 0 0">In a native build the key lives in the Secure Enclave / StrongBox with App Attest / Play Integrity, and the bundle is written as a C2PA manifest.</p>`;
    sheet.body.querySelector('[data-insp="export"]').onclick = () => {
      const a = document.createElement('a');
      const u = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], {
          type: 'application/json',
        }),
      );
      a.href = u;
      a.download = `${bundle.id}.bundle.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 2000);
    };
    sheet.body.querySelector('[data-insp="reverify"]').onclick = () =>
      open(bundle);
  }

  return { open, sheet };
}
