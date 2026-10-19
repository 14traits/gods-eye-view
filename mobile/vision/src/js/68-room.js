/* Room UI (inside the situation sheet): AI synthesis that cites every line, evidence-first posts with
   earned badges, place + time anchors that fly the globe and scrub the ribbon, community notes with the
   bridging rule explained, presence + floating reactions, and Reply → Capture first. */
const RUI = (GE.roomUI = { sort: 'evidence' });
const KIND_ICON = { witness: 'eye', context: 'layers', question: 'bubble', correction: 'flag', prediction: 'clock' };
const tierLabel = (a) => ({ 'sealed-live': `SEALED LIVE${a.segs ? ' · ' + a.segs + ' SEGMENTS' : ''}`, sealed: 'SEALED', unverified: 'UNVERIFIED UPLOAD', eye: 'PUBLIC CAMERA' })[a.tier] || a.tier.toUpperCase();
function citeChips(cites) { return (cites || []).map((c) => `<button class="cite" data-cite="${c}">${c}</button>`).join(''); }
RUI.postHTML = function (room, p) {
  const who = GE.PEOPLE[p.by] || { h: p.by, hue: 205 }; const K = GE.rooms.KINDS[p.kind]; const pid = GE.rooms.pid(room, p);
  const bd = GE.rooms.badges(room, p).map(([k, l]) => `<span class="bdg ${k}">${k === 'sealed' ? ic('seal', 'xs') : ''}${esc(l)}</span>`).join('');
  const att = p.att ? `<div class="patt ${p.att.tier}"><canvas width="${p.att.img ? 480 : 480}" height="300" data-att></canvas><span class="tier">${p.att.tier.startsWith('sealed') ? ic('seal', 'xs') : ''}${tierLabel(p.att)}</span>${p.live ? '<span class="plive"><span class="dot pulse"></span>LIVE</span>' : ''}</div>` : '';
  const anc = [p.place ? `<button class="anc" data-anc="place">${ic('location', 'xs')}${esc(p.place.label)}</button>` : '', `<button class="anc" data-anc="time">${ic('clock', 'xs')}${fmt.hm(p.time || p.at)}Z</button>`].join('');
  const ans = p.answered ? (() => { const a = room.posts.find((q) => q.id === p.answered); return a ? `<div class="answered">${ic('check', 'xs')}Answered by <b>@${esc(GE.PEOPLE[a.by].h)}</b> · ${GE.rooms.badges(room, a).map(([, l]) => esc(l)).join(' · ')}</div>` : ''; })() : p.kind === 'question' ? `<div class="answered open">${ic('arrowup', 'xs')}Open question · pinned to the top until someone answers with evidence</div>` : '';
  const note = p.note ? `<div class="note"><div class="nh">${ic('people', 'xs')}Readers added context</div><p>${esc(p.note.text)} ${citeChips(p.note.cites)}</p>
    <div class="bridge"><div class="br"><span>Raters who usually lean <b>A</b></span><i style="--v:${p.note.helpfulA}"></i><b class="num">${Math.round(p.note.helpfulA * 100)}%</b></div><div class="br"><span>Raters who usually lean <b>B</b></span><i style="--v:${p.note.helpfulB}"></i><b class="num">${Math.round(p.note.helpfulB * 100)}%</b></div></div>
    <details><summary>Why is this note showing?</summary><p>A note only appears when people who usually <i>disagree</i> with each other both rate it helpful. Raters are grouped by how they have voted on past notes, not by what they say about themselves. Here ${p.note.ratersA} raters from one side and ${p.note.ratersB} from the other agreed, so it is shown. Brigading by one side can't make a note visible.</p></details></div>` : '';
  const rx = p.reacts || {}; const rxs = [['eye', rx.eye], ['heart', rx.heart], ['exclamation', rx.alert]].filter(([, n]) => n).map(([i, n]) => `<button class="rxb" data-rx="${i}">${ic(i, 'xs')}<span class="num">${fmt.k(n)}</span></button>`).join('');
  return `<article class="post k-${p.kind}${p.note ? ' noted' : ''}${p.mine ? ' mine' : ''}" data-p="${p.id}">
    <div class="ph">${GE.avatarHTML(p.by)}<div class="pw"><div><b>@${esc(who.h)}</b><span class="pid">${pid}</span><span class="tm">${fmt.ago(Date.now() - p.at)}</span></div><div class="bds">${bd}</div></div><span class="kind k-${p.kind}">${ic(KIND_ICON[p.kind], 'xs')}${K.name.toUpperCase()}</span></div>
    <div class="pt">${esc(p.text)}${p.resolves ? `<span class="resolves">resolves ${esc(p.resolves)}</span>` : ''}</div>
    ${att}<div class="ancs">${anc}${citeChips(p.cites)}</div>${note}${ans}
    <div class="pf">${rxs}<span class="rep">${ic('bubble', 'xs')}<span class="num">${p.replies || 0}</span></span><button class="rcap" data-reply>${ic('viewfinder', 'xs')}Reply with a capture</button></div></article>`;
};
RUI.synthHTML = function (room) {
  const S = room.synth; const sec = (k, lab, cls) => (S[k] || []).length ? `<div class="sy ${cls}"><b>${lab}</b>${S[k].map(([t, c]) => `<p>${esc(t)} ${citeChips(c)}</p>`).join('')}</div>` : `<div class="sy ${cls}"><b>${lab}</b><p class="none">Nothing ${k} right now.</p></div>`;
  const L = room.ledger; const last = room.synthEntry || L[L.length - 1];
  return `<div class="synth" id="synth"><div class="syh">${ic('sparkles', 'xs')}<span>AI synthesis · every line cites a post or an observation</span><button class="regen" id="regen">${ic('wand', 'xs')}Re-synthesize</button></div>
    <div id="syBody">${sec('known', 'KNOWN', 'kn')}${sec('disputed', 'DISPUTED', 'di')}${sec('unknown', 'UNKNOWN', 'un')}</div>
    <div class="syf mono" id="syFoot">${room.synthModel ? esc(room.synthModel) + ' · ' : ''}${room.dropped ? room.dropped + ' uncited line removed · ' : ''}prompt + ${room.posts.length + Object.keys(room.src || {}).length} inputs in the ledger${last ? ` · #${last.i} ${last.hash.slice(0, 10)}…` : ''}</div></div>`;
};
RUI.render = function (host, s, o = {}) {
  const room = GE.rooms.get(s.id); RUI.room = room; RUI.sit = s;
  const list = GE.rooms.ordered(room, RUI.sort);
  host.innerHTML = `${RUI.synthHTML(room)}
    <div class="sortrow"><span class="sl mono">ORDER</span>${[['evidence', 'Evidence first'], ['latest', 'Latest'], ['questions', 'Questions']].map(([k, l]) => `<button class="chip sm ${RUI.sort === k ? 'on' : ''}" data-sort="${k}">${l}</button>`).join('')}</div>
    <div class="posts" id="posts">${list.map((p) => RUI.postHTML(room, p)).join('')}</div>
    <div class="srcs room-srcs"><div class="h3">Sources in this room</div>${Object.entries(room.src || {}).map(([k, v]) => `<div class="r"><span class="tagid">${k}</span><b style="font-weight:500">${esc(v)}</b></div>`).join('')}</div>
    <p class="fine">Posts are ordered by evidence, then time — never by followers. Concept · illustrative data; people and posts are fictional.</p>`;
  RUI.bind(host, room, s);
  if (o.post) setTimeout(() => RUI.focusPost(o.post, false), 60);
};
RUI.bind = function (host, room, s) {
  host.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { RUI.sort = b.dataset.sort; RUI.render(host, s); haptic(4); }));
  $('#regen')?.addEventListener('click', () => RUI.resynth(room, s));
  host.querySelectorAll('.post').forEach((el) => {
    const p = room.posts.find((q) => q.id === el.dataset.p);
    const cv = el.querySelector('[data-att]'); if (cv && p.att) RUI.paintAtt(cv, p);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button, summary, details'); if (b && !b.matches('[data-anc]')) return;
      RUI.anchor(p, b?.dataset.anc); });
    el.querySelector('[data-reply]')?.addEventListener('click', (e) => { e.stopPropagation(); RUI.replyCapture(s, p); });
    el.querySelectorAll('[data-rx]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); RUI.float(b.dataset.rx); const k = { eye: 'eye', heart: 'heart', exclamation: 'alert' }[b.dataset.rx]; p.reacts = p.reacts || {}; p.reacts[k] = (p.reacts[k] || 0) + 1; b.querySelector('.num').textContent = fmt.k(p.reacts[k]); haptic(4); }));
  });
  host.querySelectorAll('[data-cite]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); RUI.cite(b.dataset.cite); }));
};
RUI.paintAtt = function (cv, p) {
  if (p.att.img) { const im = new Image(); im.onload = () => { const cx = cv.getContext('2d'); const sc = Math.max(cv.width / im.width, cv.height / im.height); cx.drawImage(im, (cv.width - im.width * sc) / 2, (cv.height - im.height * sc) / 2, im.width * sc, im.height * sc); }; im.src = p.att.img; return; }
  const draw = () => GE.paint.draw(p.att.paint, cv, { ...p.att.o, t: performance.now() / 1000 });
  GE.thumbs.enqueue(draw);
  if (GE.paint.animated(p.att.paint)) { RUI.animCvs = RUI.animCvs || new Set(); RUI.animCvs.add([cv, p]); }
};
setInterval(() => { if (!RUI.animCvs || APP.mode !== 'situation') return; for (const e of RUI.animCvs) { const [cv, p] = e; if (!document.body.contains(cv)) { RUI.animCvs.delete(e); continue; } const r = cv.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue; GE.paint.draw(p.att.paint, cv, { ...p.att.o, t: performance.now() / 1000 }); } }, 160);
RUI.focusPost = function (id, fly) {
  const el = $(`.post[data-p="${id}"]`); if (!el) return; el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 2200);
  const sc = $('#sheetC'); if (sc && GE.sheet.detent === 'large') sc.scrollTo({ top: el.offsetTop - 80, behavior: 'smooth' });
  if (fly) { const p = RUI.room.posts.find((q) => q.id === id); if (p?.place) RUI.anchor(p, 'place', true); }
};
RUI.anchor = function (p, which, quiet) {
  const W = GE.world; const s = RUI.sit;
  if (p.place && which !== 'time') { const wide = APP.isWide(); const hs = GE.sheet.heights(); Cam.flyTo({ lat: p.place.lat - 0.35, lon: p.place.lon - 0.15, range: 0.075, heading: 0.4, tilt: 0.8, shiftY: wide ? 0 : hs[GE.sheet.detent === 'large' ? 'medium' : GE.sheet.detent] / hs.H, shiftX: 0 }, { duration: 1.8 }); GE.roomUI.labels(s, p.id); }
  const at = p.time || p.at; if (which !== 'place') W.setTime(at);
  if (!quiet) APP.toast(`${ic(p.place && which !== 'time' ? 'location' : 'clock', 'sm')} ${p.place && which !== 'time' ? esc(p.place.label) + ' · ' : ''}${fmt.hm(at)} UTC · ${fmt.ago(Date.now() - at)}`);
  if (GE.sheet.detent === 'large' && !APP.isWide()) GE.sheet.setDetent('medium');
  haptic(5);
};
RUI.cite = function (c) {
  const room = RUI.room; if (!room) return;
  if (c[0] === 'P') { const p = GE.rooms.byPid(room, c); if (p) { if (GE.sheet.detent !== 'large' && !APP.isWide()) GE.sheet.setDetent('large'); setTimeout(() => RUI.focusPost(p.id), 120); } return; }
  if (c[0] === 'N') { const p = room.posts.find((q) => q.note); if (p) { if (GE.sheet.detent !== 'large' && !APP.isWide()) GE.sheet.setDetent('large'); setTimeout(() => RUI.focusPost(p.id), 120); } return; }
  APP.toast(`${ic('hash', 'sm')} ${c} · ${esc((room.src || {})[c] || 'observation')}`, 2600);
};
// speech glyphs on the globe for anchored posts
RUI.labels = function (s, hl) {
  const room = GE.rooms.get(s.id); for (const k of [...GE.extraLabels.keys()]) if (k.startsWith('p:')) GE.extraLabels.delete(k);
  for (const p of room.posts) { if (!p.place) continue; const who = GE.PEOPLE[p.by] || { h: p.by }; GE.extraLabels.set('p:' + p.id, { lat: p.place.lat, lon: p.place.lon, alt: 0.03, html: `<i class="sg k-${p.kind}">${ic(KIND_ICON[p.kind], 'xs')}</i><span>@${esc(who.h)}</span>`, w: who.h.length * 6.4 + 46, cls: 'glass speech' + (p.id === hl ? ' hl' : ''), onclick: () => { if (GE.sheet.detent === 'peek') GE.sheet.setDetent('medium'); RUI.focusPost(p.id); } }); }
};
/* presence & reactions */
RUI.float = function (icon) { const host = $('#rx'); if (!host) return; const sp = h('span', { html: ic(icon || ['heart', 'eye', 'heart', 'exclamation', 'bolt'][Math.floor(Math.random() * 5)], 'sm'), style: `--dx:${(Math.random() - 0.5) * 30}px` }); sp.dataset.i = icon || ''; host.append(sp); setTimeout(() => sp.remove(), 2700); };
setInterval(() => { if (APP.mode === 'situation' && GE.sheet.seg === 'room' && !document.hidden) { if (Math.random() < 0.7) RUI.float(); const w = $('#sheetC [data-watch]'); if (w && RUI.room) w.textContent = fmt.n(RUI.room.watching); } }, 900);

/* composer: Capture first, text second */
RUI.composer = function (show) {
  const c = $('#roomComp'); if (!c) return; c.classList.toggle('on', !!show); if (!show) return;
  if (c.dataset.bound) return; c.dataset.bound = '1';
  c.innerHTML = `<button class="capbtn" id="rcCap" aria-label="Reply with a capture">${ic('viewfinder')}<span>Capture</span></button><div class="rcin glass"><div class="kinds" id="rcKinds">${Object.entries(GE.rooms.KINDS).map(([k, K]) => `<button data-k="${k}" class="${k === 'context' ? 'on' : ''}">${ic(KIND_ICON[k], 'xs')}${K.name}</button>`).join('')}<i class="ksep"></i><button data-pin="place">${ic('location', 'xs')}Pin this view</button><button data-pin="time" class="on">${ic('clock', 'xs')}Pin ribbon time</button></div><div class="rcrow"><input id="rcText" placeholder="Add context, ask, correct…" autocomplete="off"><button class="send" id="rcSend" aria-label="Post">${ic('arrowup', 'sm')}</button></div></div>`;
  let kind = 'context'; const pins = { place: false, time: true };
  c.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault())); c.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  c.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => { pins[b.dataset.pin] = !pins[b.dataset.pin]; b.classList.toggle('on', pins[b.dataset.pin]); haptic(3); }));
  c.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k; c.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); haptic(3); }));
  $('#rcCap').addEventListener('click', () => RUI.replyCapture(RUI.sit));
  const inp = $('#rcText'); inp.addEventListener('focus', () => c.classList.add('typing')); inp.addEventListener('blur', () => setTimeout(() => c.classList.remove('typing'), 150));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#rcSend').click(); } });
  $('#rcSend').addEventListener('click', async () => {
    const t = inp.value.trim(); if (!t || !RUI.room) return; inp.value = '';
    const p = { id: 'u' + Date.now(), kind, by: 'you', at: Date.now(), text: t, mine: true, reacts: {}, replies: 0 };
    if (pins.place) p.place = { lat: +Cam.lat.toFixed(4), lon: +Cam.lon.toFixed(4), label: 'Pinned view' }; if (pins.time) p.time = GE.world.simMs;
    RUI.room.posts.push(p); const e = await GE.rooms.append(RUI.room, 'post.' + kind, 'you', { id: p.id, text: t });
    RUI.render($('#shSeg'), RUI.sit); RUI.labels(RUI.sit, p.id); setTimeout(() => RUI.focusPost(p.id), 80);
    APP.toast(`${ic('link', 'sm')} Posted · ledger #${e.i} · text ranks below evidence`, 2600); haptic(8);
  });
};
RUI.replyCapture = function (s, p) {
  GE.capture.replyTo = { sit: s.id, post: p?.id };
  APP.toast(`${ic('viewfinder', 'sm')} Capture a reply for ${esc(s.short || s.title.split(' — ')[0])}`, 2000);
  GE.sheet.close(true); APP.setTab('capture'); GE.capture.setMode('witness');
};

/* AI synthesis: window.claude sample on click, scripted fallback; uncited lines are dropped */
RUI.resynth = async function (room, s, o = {}) {
  const btn = $('#regen'); if (!btn || btn.disabled) return; btn.disabled = true; btn.classList.add('busy');
  const body = $('#syBody'); const foot = $('#syFoot');
  const posts = room.posts.map((p) => `[${GE.rooms.pid(room, p)}] ${GE.rooms.KINDS[p.kind].name} by @${(GE.PEOPLE[p.by] || { h: p.by }).h} (${GE.rooms.badges(room, p).map((b) => b[1]).join(', ') || 'no evidence badges'}), ${fmt.ago(Date.now() - p.at)}: ${p.text}${p.note ? ` — Community note [N1]: ${p.note.text}` : ''}`).join('\n');
  const srcs = Object.entries(room.src || {}).map(([k, v]) => `[${k}] ${v}`).join('\n');
  const prompt = `You summarise a live discussion about a real-world situation for an app that separates evidence from claims.\nSituation: ${s.title} — ${s.place}. Posts and people are illustrative.\nObservations:\n${srcs}\nPosts:\n${posts}\nWrite at most 6 lines, each starting with exactly one of "KNOWN:", "DISPUTED:" or "UNKNOWN:". Every line must end with one or more citations in square brackets like [P1] [O2] [N1]. Prefer sealed witness posts and observations over unverified posts. Never state anything you cannot cite. Plain text, no markdown.`;
  body.innerHTML = '<div class="sy kn"><b>WRITING</b><p class="stream" id="syStream">…</p></div>';
  let out = '', model = 'scripted fallback (no AI available here)';
  const show = (t) => { out = t; const el = $('#syStream'); if (el) el.textContent = t || '…'; };
  let sample = null; if (!o.auto) { try { sample = window.claude?.use ? await window.claude.use('sample') : null; } catch { sample = null; } }
  if (o.auto) model = 'auto-update (scripted) · tap Re-synthesize to ask AI';
  if (sample) { try { const r = await sample(prompt, { onText: ({ text }) => show(text) }); show(r?.text ?? out); model = 'claude · window.claude sample'; } catch { sample = null; } }
  if (!sample) {
    const S = room.synth; const lines = [...S.known.map(([t, c]) => `KNOWN: ${t} ${c.map((x) => `[${x}]`).join(' ')}`), ...S.disputed.map(([t, c]) => `DISPUTED: ${t} ${c.map((x) => `[${x}]`).join(' ')}`), ...S.unknown.map(([t, c]) => `UNKNOWN: ${t} ${c.map((x) => `[${x}]`).join(' ')}`)];
    const mine = room.posts.filter((p) => p.mine && p.att); if (mine.length) { const p = mine[mine.length - 1]; lines.splice(1, 0, `KNOWN: A new ${p.att.tier.startsWith('sealed') ? 'sealed' : 'unverified'} capture from @you at ${p.place?.label || 'the scene'} adds a view of the situation. [${GE.rooms.pid(room, p)}]`); }
    lines.push('UNKNOWN: Whether conditions improve in the next hour — the posts do not say.');
    const full = lines.join('\n'); for (let i = 1; i <= full.length; i += 4) { show(full.slice(0, i)); await new Promise((r) => setTimeout(r, prefersReduced() ? 0 : 8)); } show(full);
  }
  // parse: keep only cited lines
  const next = { known: [], disputed: [], unknown: [] }; let dropped = 0;
  for (const ln of out.split('\n')) { const m = /^\s*(KNOWN|DISPUTED|UNKNOWN)\s*:\s*(.+)$/i.exec(ln); if (!m) continue; const cites = [...m[2].matchAll(/\[([PONS]\d+)\]/g)].map((x) => x[1]); const text = m[2].replace(/\s*\[[^\]]+\]/g, '').trim(); if (!cites.length) { dropped++; continue; } next[m[1].toLowerCase()].push([text, [...new Set(cites)]]); }
  if (next.known.length + next.disputed.length + next.unknown.length) room.synth = next;
  room.dropped = dropped; room.synthModel = model;
  const e = await GE.rooms.append(room, 'ai.synthesis', 'claude', { prompt: await sha256(prompt), inputs: room.posts.map((p) => GE.rooms.pid(room, p)).concat(Object.keys(room.src || {})), model, output: await sha256(out), dropped });
  room.synthEntry = e;
  const wrap = $('#synth'); if (wrap) { wrap.outerHTML = RUI.synthHTML(room); $('#regen')?.addEventListener('click', () => RUI.resynth(room, s)); $('#synth').querySelectorAll('[data-cite]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); RUI.cite(b.dataset.cite); })); }
  APP.toast(`${ic('sparkles', 'sm')} Synthesis recorded · ledger #${e.i}${dropped ? ' · ' + dropped + ' uncited line dropped' : ''}`, 2800);
};
