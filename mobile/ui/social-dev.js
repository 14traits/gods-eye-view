/**
 * Social harness (dev only): mounts the Rooms tab, a room in both lanes, the
 * You tab, Capture with Need eyes, and the Moment chat overlay against the
 * offline stub globe, so the social layer can be tested on its own.
 *   /mobile/ui/social-dev.html?tab=rooms|you|globe|capture|overlay
 *     &room=<situation id>|moment&lane=live|record&lat=&lon=
 */

import { $, $$ } from './dom.js';
import { mountGlobe } from './globeHost.js';
import { createRealtime } from './realtime.js';
import { createRooms } from './rooms.js';
import { createAttach } from './attach.js';
import {
  configureSocial,
  mountRoomsTab,
  mountYouTab,
  openRoom,
  chatOverlay,
  needEyesNear,
  momentRoom,
} from './social.js';

const q = new URLSearchParams(location.search);
const app = $('#app');
let loc =
  q.get('lat') && q.get('lon')
    ? { lat: Number(q.get('lat')), lon: Number(q.get('lon')) }
    : null;

const g = await mountGlobe($('#globe'), { preferStub: true });
const rt = createRealtime();
const rooms = createRooms({ rt });
const getSituations = () => g.situations(loc ? { observer: loc } : undefined);

let capture = null;
const core = configureSocial({
  globe: g,
  rt,
  rooms,
  getSituations,
  getLocation: () => loc,
  onShowGlobe: (s) => {
    if (tab !== 'globe' && tab !== 'overlay') select('globe');
    if (Number.isFinite(s.lat))
      g.flyTo({
        lon: s.lon,
        lat: s.lat,
        height: s.momentId ? 30e3 : 400e3,
        duration: 1.2,
      });
  },
  onCapture: async (s, o) => {
    await select('capture');
    capture?.attachTo(s, o);
  },
  onPlayMoment: (m) => {
    select('overlay');
    playOverlay(m);
  },
});

const rtab = mountRoomsTab($('#view-rooms'), {});
const you = mountYouTab($('#view-you'), {});

const attach = createAttach({
  rooms,
  globe: g,
  getSituations,
  onPosted: () => {
    rtab.refresh();
    you.render();
  },
});

let tab = 'rooms';
async function select(t) {
  if (t === tab) return;
  const prev = tab;
  tab = t;
  app.dataset.tab = t;
  $$('.sd-tabs [data-sd]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.sd === t)),
  );
  $('#view-rooms').hidden = t !== 'rooms';
  $('#view-you').hidden = t !== 'you';
  $('#view-capture').hidden = t !== 'capture';
  $('.sd-overlay').hidden = t !== 'overlay';
  if (prev === 'capture') capture?.leave();
  if (t === 'capture') {
    if (!capture) {
      const { createCapture } = await import('./capture.js');
      capture = createCapture($('#view-capture'), {
        globe: g,
        rt,
        attach,
        getLocation: () => loc,
        onSealed: () => you.render(),
        onVerify: () => {},
      });
      window.__sd.capture = capture;
    }
    capture.enter();
  }
  if (t === 'you') you.render();
  if (t === 'overlay' && !overlay) playOverlay((await core.moments())[0]);
}
$('.sd-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sd]');
  if (b) select(b.dataset.sd);
});

/* Moment chat overlay on a simple clock. */
let overlay = null;
let clock = 0;
function playOverlay(m) {
  overlay?.destroy();
  clearInterval(clock);
  const el = $('.sd-overlay');
  el.innerHTML = '';
  overlay = chatOverlay(el, { globe: g, moment: m });
  let t = +m.time.start;
  overlay.setTime(t);
  g.flyTo({ lon: m.lon, lat: m.lat, height: 5000, duration: 1 });
  clock = setInterval(() => {
    t += 15000;
    if (t > +m.time.end) t = +m.time.start;
    overlay.setTime(t);
  }, 700);
}

window.__sd = {
  g,
  rt,
  rooms,
  core,
  openRoom,
  select,
  needEyesNear,
  momentRoom,
  setLoc: (l) => (loc = l),
  playOverlay,
};

const t0 = q.get('tab');
if (t0) await select(t0);
const rid = q.get('room');
if (rid) {
  const target =
    rid === 'moment'
      ? (await core.moments())[0]
      : (await getSituations()).find((s) => String(s.id) === rid);
  if (target) await openRoom(target, { lane: q.get('lane') || 'live' });
}
document.documentElement.dataset.ready = '1';
