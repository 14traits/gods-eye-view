// HUD for the RPO replay, sized for phone playback: a 16:9 video in a feed
// plays ~390 px wide (≈0.2×), so body copy is ≥34 px at 1080p and nothing
// that must be read is under ~24 px. Every animation is a pure function of
// the video time `s`, so frames render deterministically.

export function createHud(ctx) {
  const { D, W, H, U, PORTRAIT, sec, rate, sOfTau, sepAt, CA_T, VANTOR_T, BURNS, CUTS, project } = ctx;
  const $ = (q) => document.querySelector(q);
  const CA_M = Math.round(D.ca.m / 5) * 5;

  // -------------------------------------------------------------------------
  // Story
  // -------------------------------------------------------------------------
  const CHAPTERS = [
    { key: 'climb', label: 'Climb', s0: 4.4, s1: 12.5 },
    { key: 'drop', label: 'Drop in', s0: 12.5, s1: 22.0 },
    { key: 'close', label: 'Close in', s0: 22.0, s1: 29.7 },
    { key: 'closest', label: 'Closest', s0: 29.7, s1: 35.6 },
    { key: 'leave', label: 'Leave', s0: 35.6, s1: 41.2 },
  ];
  const CAPTIONS = [
    {
      s0: -1, s1: 4.4, hook: true,
      title: `A Russian military satellite shadowed a U.S.-registered one — to <span class="c-cos" style="white-space:nowrap">~${CA_M} m</span>`,
      body: 'How <b class="c-cos">Cosmos 2612</b> matched <b class="c-x36">ICEYE-X36</b>\'s orbit over 22 days, rebuilt from public tracking data.',
    },
    {
      s0: 4.4, s1: 12.5,
      title: 'Climb higher to fall behind',
      body: 'A higher orbit is slower. Lifted <b>47 km</b>, it drifts back and laps its target.',
    },
    {
      s0: 12.5, s1: 17.2,
      title: 'Drop into the same orbit',
      body: 'Oct 12: it dives 47 km and lands about <b>480 km behind</b>.',
    },
    {
      s0: 17.2, s1: 22.0,
      title: 'Speed up, then brake',
      body: 'Oct 15: a 2 km dip makes it faster — closing <b>~350 km a day</b> — then it brakes 3 km behind.',
    },
    {
      s0: 22.0, s1: 29.7,
      title: 'Park behind it. Creep closer.',
      body: 'Each orbit its path loops <b>1.6 km</b>, inching in for two days.',
    },
    {
      s0: 29.7, s1: 32.3,
      title: 'Into Earth\'s shadow',
      body: 'Closing at strolling pace (<b>0.9 m/s</b>) — while both fly at 27,000 km/h.',
    },
    {
      s0: 32.3, s1: 35.6,
      title: `Closest pass: <span class="c-cos">~${CA_M} m</span>`,
      body: 'Shown at true size. Published estimates: <b>150–650 m</b>.',
    },
    {
      s0: 35.6, s1: 41.2,
      title: 'Back off — and wait',
      body: 'It burns away. Today it sits <b>480 km behind</b>, in the same orbit.',
    },
  ];
  const BURN_NOTES = {
    'Phasing raise': 'raises its orbit 46 km',
    'Plane trim': 'tilts its orbit into line',
    'Descent to X36 orbit': 'drops 47 km',
    'Closing burn': 'dips 2.3 km to speed up',
    'Braking burn': 'rises 2.5 km to stop',
    'Back-off': 'rises 130 m',
    'Departure burn': 'rises 2.4 km to drift away',
    'Re-match orbit': 'drops 2.6 km to hold position',
  };
  const EVENTS = [
    ...BURNS.map((b) => ({
      t: b.t, kind: 'burn', title: 'Engine burn',
      sub: `${BURN_NOTES[b.label] || b.label} · Δv ${b.dv < 1 ? b.dv.toFixed(1) : Math.round(b.dv)} m/s`,
    })),
    { t: sec('2026-10-05T11:55:00Z'), kind: 'note', title: 'Passes overhead', sub: '~50 km above its target' },
    { t: sec('2026-10-12T00:10:00Z'), kind: 'note', title: 'Directly overhead', sub: '47 km above its target' },
    { t: VANTOR_T, kind: 'vantor', title: 'Vantor photographs the pair', sub: `from its own satellite · ~${D.vantor.km.toFixed(0)} km apart · Oct 17` },
    { t: CA_T, kind: 'ca', title: 'Closest approach', sub: `${D.ca.t.slice(11, 16)} UTC, Oct 18` },
  ].map((e) => ({ ...e, s: sOfTau(e.t) })).sort((a, b) => a.s - b.s);

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------
  const fade = (s, s0, s1, ramp = 0.4) => Math.min(1, Math.max(0, (s - s0) / ramp), Math.max(0, (s1 - s) / ramp));
  const capEl = $('#caption');
  const tagsEl = $('#tags');
  const leaders = $('#leaders');
  const evEl = $('#events');
  leaders.setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('#chapters').innerHTML = CHAPTERS.map((c) => `<div class="ch" data-k="${c.key}"><i><b></b></i><span>${c.label}</span></div>`).join('');

  // Distance-over-time strip (log scale), drawn once, revealed by a clip.
  const CH = { t0: sec('2026-09-30T00:00:00Z'), t1: sec('2026-10-21T18:00:00Z'), lo: 0.1, hi: 20000 };
  const chartBox = $('#chart');
  const chart = (() => {
    const cw = chartBox.clientWidth;
    const ch = chartBox.clientHeight;
    const padL = (PORTRAIT ? 120 : 132) * U;
    const padT = 10 * U;
    const padB = 40 * U;
    const x = (t) => padL + ((t - CH.t0) / (CH.t1 - CH.t0)) * (cw - padL);
    const y = (km) =>
      padT + (1 - (Math.log10(km) - Math.log10(CH.lo)) / (Math.log10(CH.hi) - Math.log10(CH.lo))) * (ch - padT - padB);
    const NS = D.sep_km.length;
    const cols = Math.round((cw - padL) / 2);
    let lo = '';
    for (let c = 0; c <= cols; c++) {
      const ta = CH.t0 + (c / cols) * (CH.t1 - CH.t0);
      const tb = CH.t0 + ((c + 1) / cols) * (CH.t1 - CH.t0);
      let mn = Infinity;
      for (let i = Math.floor(ta / D.dt); i <= Math.ceil(tb / D.dt); i++) mn = Math.min(mn, D.sep_km[Math.min(Math.max(i, 0), NS - 1)]);
      lo += `${c ? 'L' : 'M'}${(padL + c * 2).toFixed(1)},${y(Math.max(mn, CH.lo)).toFixed(1)}`;
    }
    const fs = (PORTRAIT ? 24 : 26) * U;
    const grid = [[10000, '10,000 km'], [100, '100 km'], [1, '1 km']]
      .map(([v, lab]) => `<line x1="${padL}" x2="${cw}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(238,242,246,0.14)" stroke-width="${1.5 * U}"/>
        <text x="${padL - 14 * U}" y="${y(v) + fs * 0.35}" text-anchor="end" font-size="${fs}" fill="rgba(238,242,246,0.6)">${lab}</text>`).join('');
    const dates = [['2026-09-30', 'SEP 30'], ['2026-10-12', 'OCT 12'], ['2026-10-18', 'OCT 18']]
      .map(([d, lab], k) => `<text x="${x(sec(`${d}T00:00:00Z`))}" y="${ch - 6 * U}" text-anchor="${k ? 'middle' : 'start'}" font-size="${fs}" fill="rgba(238,242,246,0.6)">${lab}</text>`).join('');
    const burns = BURNS.map((b) => `<circle class="burn" data-t="${b.t}" cx="${x(b.t)}" cy="${padT + 2 * U}" r="${5 * U}" fill="#ffb547"/>`).join('');
    chartBox.innerHTML = `<svg viewBox="0 0 ${cw} ${ch}">
      <defs><clipPath id="past"><rect id="pastRect" x="0" y="-40" width="0" height="${ch + 80}"/></clipPath></defs>
      ${grid}${dates}${burns}
      <path d="${lo}" fill="none" stroke="rgba(255,90,60,0.28)" stroke-width="${2.5 * U}"/>
      <g clip-path="url(#past)"><path d="${lo}" fill="none" stroke="#ff5a3c" stroke-width="${4 * U}" stroke-linejoin="round"/></g>
      <line id="playhead" x1="0" x2="0" y1="${padT}" y2="${ch - padB}" stroke="#fff" stroke-opacity="0.7" stroke-width="${2 * U}"/>
      <circle id="playdot" r="${8 * U}" fill="#fff"/>
    </svg>`;
    return { x, y };
  })();

  function tag(id, name, meta, cls) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'tag';
      el.dataset.meta = meta;
      el.innerHTML = `<div class="name ${cls}">${name}</div><div class="meta">${meta}</div>`;
      tagsEl.appendChild(el);
    }
    return el;
  }

  const fmtNum = (km) => (km >= 100 ? Math.round(km).toLocaleString('en-US') : km >= 10 ? km.toFixed(0) : km.toFixed(1));
  function fmtSep(m) {
    if (m >= 10e3) return `${fmtNum(m / 1000)}<small>km</small>`;
    if (m >= 1000) return `${(m / 1000).toFixed(1)}<small>km</small>`;
    return `${Math.round(m / 5) * 5}<small>m</small>`;
  }
  function perSecond(r) {
    if (r < 90) return `${Math.round(r)} sec`;
    if (r < 5400) return `${Math.round(r / 60)} min`;
    if (r < 129600) return `${(r / 3600).toFixed(r < 36000 ? 1 : 0)} hours`.replace('1.0 hours', '1 hour');
    return `${(r / 86400).toFixed(1)} days`.replace('.0 days', ' days');
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------
  function update(s, t, b, st) {
    const endA = fade(s, 41.2, 99, 0.5);
    const live = 1 - endA;

    // Chapters
    for (const c of CHAPTERS) {
      const el = document.querySelector(`.ch[data-k="${c.key}"]`);
      const p = Math.min(1, Math.max(0, (s - c.s0) / (c.s1 - c.s0)));
      el.classList.toggle('on', s >= c.s0 && s < c.s1);
      el.querySelector('b').style.width = `${p * 100}%`;
    }
    $('#chapters').style.opacity = fade(s, 4.2, 41.2, 0.4);

    // Caption (one at a time, quick crossfade)
    let cap = null;
    let capA = 0;
    for (const c of CAPTIONS) {
      const a = fade(s, c.s0, c.s1, 0.3);
      if (a > capA) {
        cap = c;
        capA = a;
      }
    }
    if (cap) {
      capEl.classList.toggle('hook', !!cap.hook);
      capEl.querySelector('h1').innerHTML = cap.title;
      capEl.querySelector('p').innerHTML = cap.body;
    }
    capEl.style.opacity = capA * live;
    capEl.style.transform = `translateY(${(1 - capA) * 14 * U}px)`;

    // Clock + speed
    const d = new Date(Date.parse(D.t0) + t * 1000);
    const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
    $('#clock .date').textContent = `${mon} ${d.getUTCDate()}`;
    $('#clock .time').textContent = `${d.toISOString().slice(11, 16)} UTC`;
    $('#clock .rate').innerHTML = `1 sec = ${perSecond(rate(s))}`;
    $('#clock').style.opacity = live;

    // Distance readout
    const ro = $('#readout');
    ro.style.opacity = fade(s, 4.4, 41.2, 0.4);
    ro.querySelector('.val').innerHTML = fmtSep(st.sep);
    const [r, tt] = st.rel;
    let ctxLine;
    const caS = EVENTS.find((e) => e.kind === 'ca').s;
    if (st.sep < 1500) ctxLine = `≈ ${Math.max(1, Math.round(st.sep / 100))} football fields`;
    else if (st.sep < 2e6) ctxLine = `${Math.abs(tt) >= 1e4 ? fmtNum(Math.abs(tt) / 1000) + ' km' : (Math.abs(tt) / 1000).toFixed(1) + ' km'} ${tt < 0 ? 'behind' : 'ahead'}${Math.abs(r) > 20e3 ? ` · ${fmtNum(Math.abs(r) / 1000)} km ${r > 0 ? 'higher' : 'lower'}` : ''}`;
    else ctxLine = `${Math.abs(r) > 20e3 ? `${fmtNum(Math.abs(r) / 1000)} km higher · ` : ''}far side of the orbit`;
    if (s > caS && s < 36.5) ctxLine += ` · closest ${CA_M} m`;
    ro.querySelector('.ctx').textContent = ctxLine;

    // Scale chip: amber when enlarged, white at true size.
    const magEl = $('#mag');
    const enlarged = st.mag > 1.5;
    const trueSize = !enlarged && st.camDistX < 200;
    magEl.style.opacity = (enlarged || trueSize) ? fade(s, 4.4, 41.2, 0.3) : 0;
    magEl.classList.toggle('enlarged', enlarged);
    magEl.textContent = enlarged ? `Satellites enlarged ${Math.round(st.mag)}×` : 'True size';

    // Chart
    const px = chart.x(Math.min(Math.max(t, CH.t0), CH.t1));
    document.getElementById('pastRect').setAttribute('width', px);
    const ph = document.getElementById('playhead');
    ph.setAttribute('x1', px);
    ph.setAttribute('x2', px);
    const pd = document.getElementById('playdot');
    pd.setAttribute('cx', px);
    pd.setAttribute('cy', chart.y(Math.max(sepAt(t), CH.lo)));
    for (const g of chartBox.querySelectorAll('.burn')) g.style.opacity = Number(g.dataset.t) <= t ? 1 : 0.3;
    $('#chartwrap').style.opacity = fade(s, 4.4, 41.2, 0.4);

    // Event toasts (max two, newest on top)
    let html = '';
    const quiet = s > 31.85 && s < 33.95; // true-size shot: headline + pulse carry it
    if (!quiet && st.lx < 0.5 && st.sep < 5e3 && s < 41.2) html += '<div class="event shadow"><i></i><div><div class="t">In Earth\'s shadow</div><div class="sub">orbital night · sunrise in minutes</div></div></div>';
    const active = EVENTS.map((e) => ({ e, a: fade(s, e.s, e.s + (e.kind === 'ca' ? 3.6 : e.kind === 'vantor' ? 2.8 : 2.0), 0.2) }))
      .filter((x) => x.a > 0).slice(-2).reverse();
    for (const { e, a } of quiet ? [] : active) {
      html += `<div class="event ${e.kind}" style="opacity:${a * live}"><i></i><div><div class="t">${e.title}</div><div class="sub">${e.sub}</div></div></div>`;
    }
    evEl.innerHTML = html;

    // Satellite tags + in-scene dimension line
    const pX = project(st.x36W);
    const pC = project(st.cosW);
    const tX = tag('tagX', 'ICEYE-X36', 'U.S.-registered radar satellite', 'c-x36');
    const tC = tag('tagC', 'COSMOS 2612', 'Russian military', 'c-cos');
    const tagA = fade(s, 4.0, 41.2, 0.4);
    const onScreen = (p) => p && p.x > -40 && p.y > -40 && p.x < W + 40 && p.y < H + 40;
    let svg = '';
    // Tags try four quadrants around their satellite and take the first that
    // stays on screen and clear of HUD text; the other tag counts too.
    const M = 24 * U;
    const obstacles = [];
    for (const q of ['#logo', '#clock', '#caption', '#readout', '#chartwrap', '#chapters', '#mag']) {
      const el = $(q);
      if (Number(el.style.opacity || 1) > 0.05) obstacles.push(el.getBoundingClientRect());
    }
    for (const el of evEl.children) obstacles.push(el.getBoundingClientRect());
    const overlap = (r) => obstacles.reduce((acc, o) => acc + Math.max(0, Math.min(r.r, o.right + 8 * U) - Math.max(r.l, o.left - 8 * U)) * Math.max(0, Math.min(r.b, o.bottom + 8 * U) - Math.max(r.t, o.top - 8 * U)), 0);
    const hits = (r) => obstacles.some((o) => r.l < o.right + 8 * U && r.r > o.left - 8 * U && r.t < o.bottom + 8 * U && r.b > o.top - 8 * U);
    const place = (el, p, prefer, color) => {
      if (!onScreen(p)) {
        el.style.opacity = 0;
        return;
      }
      const a = tagA;
      el.style.opacity = a;
      el.querySelector('.meta').textContent = p.hidden ? 'far side of Earth' : el.dataset.meta;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const quads = [prefer, [prefer[0], -prefer[1]], [-prefer[0], prefer[1]], [-prefer[0], -prefer[1]]];
      let best = null;
      for (const [sx, sy] of quads) {
        const lx = p.x + sx * 66 * U;
        const ly = p.y + sy * 56 * U;
        const l = sx > 0 ? lx + 10 * U : lx - 10 * U - w;
        const r = { l, r: l + w, t: ly - h / 2, b: ly + h / 2 };
        const inside = r.l > M && r.r < W - M && r.t > M && r.b < H - M;
        const cand = { sx, sy, lx, ly, r };
        cand.cost = (inside ? 0 : 1e9) + overlap(r);
        if (!best || cand.cost < best.cost) best = cand;
        if (cand.cost === 0) break;
      }
      if (best.cost >= 1e9) {
        const [sx, sy] = prefer;
        const lx = p.x + sx * 66 * U;
        const ly = p.y + sy * 56 * U;
        let l = sx > 0 ? lx + 10 * U : lx - 10 * U - w;
        l = Math.min(Math.max(l, M), W - M - w);
        best = { sx, sy, lx, ly, r: { l, r: l + w, t: ly - h / 2, b: ly + h / 2 } };
      }
      el.style.left = `${best.r.l}px`;
      el.style.top = `${best.r.t}px`;
      el.style.transform = 'none';
      el.style.textAlign = best.sx > 0 ? 'left' : 'right';
      obstacles.push({ left: best.r.l, right: best.r.r, top: best.r.t, bottom: best.r.b });
      svg += `<line x1="${p.x + best.sx * 12 * U}" y1="${p.y + best.sy * 12 * U}" x2="${best.lx}" y2="${best.ly}" stroke="${color}" stroke-opacity="${a * 0.85}" stroke-width="${2.5 * U}"/>`;
      svg += `<circle cx="${p.x}" cy="${p.y}" r="${15 * U}" fill="none" stroke="${color}" stroke-opacity="${a * 0.9}" stroke-width="${2.5 * U}"/>`;
    };
    // Dimension line + pill (offset perpendicular so it clears the line's ends).
    const dim = $('#dim');
    const gap = onScreen(pX) && onScreen(pC) ? Math.hypot(pC.x - pX.x, pC.y - pX.y) : 0;
    const dimA = st.sep < 60e3 && gap > 160 * U ? tagA : 0;
    if (dimA > 0) {
      svg += `<line x1="${pX.x}" y1="${pX.y}" x2="${pC.x}" y2="${pC.y}" stroke="#fff" stroke-opacity="${0.75 * dimA}" stroke-width="${2.5 * U}" stroke-dasharray="${10 * U} ${8 * U}"/>`;
      const nx = -(pC.y - pX.y) / gap;
      const ny = (pC.x - pX.x) / gap;
      const side = ny > 0 ? -1 : 1; // put the pill above the line
      dim.innerHTML = fmtSep(st.sep).replace(/<\/?small>/g, ' ').trim();
      const mx = (pX.x + pC.x) / 2 + side * nx * 40 * U;
      const my = (pX.y + pC.y) / 2 + side * ny * 40 * U;
      dim.style.left = `${mx}px`;
      dim.style.top = `${my}px`;
      const w = dim.offsetWidth;
      const h = dim.offsetHeight;
      obstacles.push({ left: mx - w / 2, right: mx + w / 2, top: my - h / 2, bottom: my + h / 2 });
    }
    dim.style.opacity = dimA;
    // Pulse rings on both satellites at the closest moment.
    const caS2 = EVENTS.find((e) => e.kind === 'ca').s;
    const k = (s - caS2) / 1.2;
    if (k > 0 && k < 1) {
      for (const p of [pX, pC]) {
        if (!onScreen(p)) continue;
        svg += `<circle cx="${p.x}" cy="${p.y}" r="${(18 + 90 * k) * U}" fill="none" stroke="#fff" stroke-opacity="${(1 - k) * 0.9}" stroke-width="${4 * U}"/>`;
      }
    }
    let pX0 = [1, -1];
    let pC0 = [-1, 1];
    if (onScreen(pX) && onScreen(pC)) {
      const sx = pC.x - pX.x >= 0 ? -1 : 1;
      const sy = pC.y - pX.y >= 0 ? -1 : 1;
      pX0 = [sx, sy];
      pC0 = [-sx, -sy];
    }
    place(tX, pX, pX0, '#5ce1e6');
    place(tC, pC, pC0, '#ff5a3c');

    leaders.innerHTML = svg;

    // Burn flash ring on Cosmos
    // (drawn by the scene; nothing here)

    // Dip at cuts
    let dip = 0;
    for (const c of CUTS) dip = Math.max(dip, 1 - Math.abs(s - c) / 0.14);
    $('#dip').style.opacity = Math.max(0, dip);

    // End card
    const ec = $('#endcard');
    ec.style.opacity = endA;
    ec.style.background = `rgba(2,4,8,${0.8 * endA})`;
    if (!ec.dataset.built) {
      ec.dataset.built = '1';
      ec.innerHTML = `<div class="panel">
        <div class="big">~${CA_M} m</div>
        <div class="range">estimated · published range 150–650 m</div>
        <div class="lead">Closest pass between Cosmos 2612 and ICEYE-X36 · Oct 18, in Earth's shadow</div>
        <div class="stats">
          <div><b>22</b><span>days in pursuit</span></div>
          <div><b>8</b><span>engine burns</span></div>
          <div><b>0.9 m/s</b><span>speed at closest pass</span></div>
        </div>
      </div>`;
    }
    $('#endlogo').style.opacity = endA;
    $('#logo').style.opacity = live;
  }

  return { update };
}
