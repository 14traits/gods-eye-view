/**
 * Hand-drawn SF Symbols–style glyphs on a 24-unit grid.
 * Stroke 1.8, round caps/joins; `.f` parts fill when the glyph is "active".
 * No icon fonts: the repo's Material Symbols font is subset.
 */

const F = 'fill="currentColor" stroke="none"';

/** Rounded seal outline (checkmark.seal) generated from a wavy circle. */
function sealPath(cx = 12, cy = 12, r = 8.6, bumps = 12, amp = 1.05) {
  const steps = bumps * 8;
  let d = '';
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r + amp * Math.cos(a * bumps);
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

const SEAL = sealPath();

const P = {
  now: `<circle cx="12" cy="12" r="2.3" ${F}/><path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8M8.6 8.6a4.8 4.8 0 0 0 0 6.8M18.3 5.7a8.9 8.9 0 0 1 0 12.6M5.7 5.7a8.9 8.9 0 0 0 0 12.6"/>`,
  globe: `<circle class="f" cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="9.2"/><ellipse cx="12" cy="12" rx="3.9" ry="9.2"/><path d="M2.8 12h18.4M4.3 7.2c2.2 1 4.8 1.5 7.7 1.5s5.5-.5 7.7-1.5M4.3 16.8c2.2-1 4.8-1.5 7.7-1.5s5.5.5 7.7 1.5"/>`,
  viewfinder: `<path d="M3.8 8.6V6.6a2.8 2.8 0 0 1 2.8-2.8h2M15.4 3.8h2a2.8 2.8 0 0 1 2.8 2.8v2M20.2 15.4v2a2.8 2.8 0 0 1-2.8 2.8h-2M8.6 20.2h-2a2.8 2.8 0 0 1-2.8-2.8v-2"/><circle class="f" cx="12" cy="12" r="3.3"/><circle cx="12" cy="12" r="3.3"/>`,
  threads: `<path d="M7.4 15.4 10.9 8M13.4 7.7l3.7 5.6M8.5 17.2h6.9" stroke-dasharray="0.2 2.6"/><circle class="f" cx="12" cy="5.9" r="2.3"/><circle cx="12" cy="5.9" r="2.3"/><circle class="f" cx="6.2" cy="17.4" r="2.3"/><circle cx="6.2" cy="17.4" r="2.3"/><circle class="f" cx="18.2" cy="15.6" r="2.3"/><circle cx="18.2" cy="15.6" r="2.3"/>`,
  you: `<circle class="f" cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="10" r="3.2"/><path d="M6.1 18.4c1.3-2.2 3.4-3.3 5.9-3.3s4.6 1.1 5.9 3.3"/>`,
  search: `<circle cx="10.6" cy="10.6" r="6.4"/><path d="m15.4 15.4 4.8 4.8"/>`,
  chevronLeft: `<path d="M14.6 4.8 7.4 12l7.2 7.2" stroke-width="2.2"/>`,
  chevronRight: `<path d="m9.4 4.8 7.2 7.2-7.2 7.2" stroke-width="2"/>`,
  chevronDown: `<path d="m5.8 9.2 6.2 6.2 6.2-6.2" stroke-width="2.1"/>`,
  chevronUp: `<path d="m5.8 14.8 6.2-6.2 6.2 6.2" stroke-width="2.1"/>`,
  close: `<path d="m6.6 6.6 10.8 10.8M17.4 6.6 6.6 17.4" stroke-width="2.1"/>`,
  info: `<circle cx="12" cy="12" r="9.2"/><path d="M12 10.9v5.8"/><circle cx="12" cy="7.6" r="1.15" ${F}/>`,
  north: `<path d="M12 3.6 16.8 18 12 15.3 7.2 18Z" ${F}/>`,
  home: `<path d="M3.8 11.2 12 4.2l8.2 7"/><path d="M6.3 9.4v9.4c0 .6.4 1 1 1h3.2v-5.1h3v5.1h3.2c.6 0 1-.4 1-1V9.4"/>`,
  layers: `<path class="f" d="m12 3.8 8.6 4.6-8.6 4.6-8.6-4.6Z"/><path d="m12 3.8 8.6 4.6-8.6 4.6-8.6-4.6Z"/><path d="m3.4 12.4 8.6 4.6 8.6-4.6M3.4 16.4l8.6 4.6 8.6-4.6"/>`,
  sky: `<path d="M12 2.6c.9 0 1.5.8 1.5 1.7v5.1l7.4 4.6v1.9l-7.4-2.3v4.9l2 1.5v1.5L12 20.6l-3.5.9V20l2-1.5v-4.9l-7.4 2.3V14l7.4-4.6V4.3c0-.9.6-1.7 1.5-1.7Z" ${F}/>`,
  sea: `<path d="M2.8 15.3h18.4l-2.4 4.2a1.6 1.6 0 0 1-1.4.8H6.6a1.6 1.6 0 0 1-1.4-.8Z" ${F}/><path d="M6.4 15.3v-4.4h11.2v4.4M9.4 10.9V7.6h5.2v3.3M12 7.6V4"/>`,
  orbit: `<path d="m12 8.9 3.1 3.1-3.1 3.1L8.9 12Z" ${F}/><path d="M5.4 9.6 9.6 5.4 7 2.8 2.8 7ZM18.6 14.4l-4.2 4.2 2.6 2.6 4.2-4.2ZM10.4 10.4 7.6 7.6M13.6 13.6l2.8 2.8M15.2 5.6a3.6 3.6 0 0 1 3.2 3.2"/>`,
  hazards: `<path d="M10.3 4.4a2 2 0 0 1 3.4 0l7.3 12.7a2 2 0 0 1-1.7 3H4.7a2 2 0 0 1-1.7-3Z"/><path d="M12 9.4v4.4" stroke-width="2"/><circle cx="12" cy="16.9" r="1.15" ${F}/>`,
  flame: `<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-2.9 1.9-4.6 3-6.3.8 1.5 1.8 2.3 2.6 2.4-.3-2.9.6-5.6 3.2-7.9.2 3 1.4 4.6 2.8 6.2 1.3 1.5 2.4 3.1 2.4 5.6 0 3.6-2.6 6.2-6.5 6.2Z"/>`,
  eyes: `<path d="M2.4 12c2.3-4.4 5.7-6.6 9.6-6.6s7.3 2.2 9.6 6.6c-2.3 4.4-5.7 6.6-9.6 6.6S4.7 16.4 2.4 12Z"/><circle cx="12" cy="12" r="3.3"/><circle cx="12" cy="12" r="1.3" ${F}/>`,
  ground: `<path d="M3.8 16.6v-4c0-.6.2-1.1.5-1.6L6 7.7c.4-.9 1.2-1.4 2.1-1.4h7.8c.9 0 1.7.5 2.1 1.4l1.7 3.3c.3.5.5 1 .5 1.6v4ZM6 16.6v1.8c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1.8M15 16.6v1.8c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1.8M5.4 10.9h13.2"/><circle cx="7.6" cy="13.7" r="1" ${F}/><circle cx="16.4" cy="13.7" r="1" ${F}/>`,
  weather: `<path d="M7.4 19.2h9.9a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-10 1.3 3 3 0 0 0-.2 5.9Z"/><path d="M5.6 11.3a3.3 3.3 0 0 1 5.6-4M8.4 2.9v1.4M3 8.4h1.4M4.6 4.6l1 1"/>`,
  infra: `<path d="M13.2 2.8 5.6 13.3h5.8l-1 7.9 7.6-10.5h-5.8Z"/>`,
  star: `<path class="f" d="m12 3.6 2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.6l-5.1 2.8L8 13.6l-4.3-4 5.8-.7Z"/><path d="m12 3.6 2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.6l-5.1 2.8L8 13.6l-4.3-4 5.8-.7Z"/>`,
  starFill: `<path d="m12 3.6 2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.6l-5.1 2.8L8 13.6l-4.3-4 5.8-.7Z" fill="currentColor"/>`,
  ride: `<circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="2.4"/><path d="M3.2 10.6c2.8-.9 5.7-1.3 8.8-1.3s6 .4 8.8 1.3M10.2 14 7.4 20M13.8 14l2.8 6"/>`,
  video: `<rect x="2.4" y="6.8" width="13.4" height="10.4" rx="2.4"/><path d="m15.8 10.6 5.4-3.1v9l-5.4-3.1"/>`,
  share: `<path d="M12 3.4v11.2M8.2 7.2 12 3.4l3.8 3.8M8.6 10H7a2 2 0 0 0-2 2v6.6c0 1.1.9 2 2 2h10a2 2 0 0 0 2-2V12a2 2 0 0 0-2-2h-1.6"/>`,
  seal: `<path class="f" d="${SEAL}"/><path d="${SEAL}"/><path d="m8.3 12.2 2.5 2.5 4.9-5" stroke-width="2"/>`,
  sealFill: `<path d="${SEAL}" fill="currentColor"/><path d="m8.3 12.2 2.5 2.5 4.9-5" stroke="var(--seal-ink, #2a1a00)" stroke-width="2.1"/>`,
  play: `<path d="M8 5.2v13.6l10.6-6.8Z" fill="currentColor"/>`,
  pause: `<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>`,
  sparkles: `<path d="M11 3.2c.6 3.7 2.4 5.5 6.1 6.1-3.7.6-5.5 2.4-6.1 6.1-.6-3.7-2.4-5.5-6.1-6.1 3.7-.6 5.5-2.4 6.1-6.1Z" fill="currentColor"/><path d="M18 14.4c.3 1.8 1.1 2.6 2.9 2.9-1.8.3-2.6 1.1-2.9 2.9-.3-1.8-1.1-2.6-2.9-2.9 1.8-.3 2.6-1.1 2.9-2.9Z" fill="currentColor"/>`,
  agree: `<circle cx="12" cy="12" r="9.2"/><path d="m8 12.3 2.8 2.8 5.2-5.4"/>`,
  dispute: `<circle cx="12" cy="12" r="9.2"/><path d="M8.2 12h7.6"/>`,
  sliders: `<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>`,
  refresh: `<path d="M19.4 12.6a7.5 7.5 0 1 1-2.1-6.1"/><path d="M19.6 4.4v4.3h-4.3"/>`,
  lock: `<rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.2"/><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8"/>`,
  key: `<circle cx="8" cy="15.5" r="4.2"/><path d="m11 12.5 8.6-8.6M16.4 7.1l2.4 2.4M14.2 9.3l1.8 1.8"/>`,
  location: `<path d="M20.2 3.8 3.8 11l7.2 2 2 7.2Z" fill="currentColor" stroke-linejoin="round"/>`,
  camera: `<path d="M4 8h3l1.5-2.3h7L17 8h3c.8 0 1.5.7 1.5 1.5V18c0 .8-.7 1.5-1.5 1.5H4c-.8 0-1.5-.7-1.5-1.5V9.5C2.5 8.7 3.2 8 4 8Z"/><circle cx="12" cy="13.4" r="3.6"/>`,
  cube: `<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>`,
  download: `<path d="M12 3.4v11.2M8.2 10.8 12 14.6l3.8-3.8M5 15.5V18c0 1.1.9 2 2 2h10a2 2 0 0 0 2-2v-2.5"/>`,
  lens: `<circle cx="12" cy="8.6" r="5"/><circle cx="8.6" cy="14.6" r="5"/><circle cx="15.4" cy="14.6" r="5"/>`,
  checkmark: `<path d="m5 12.6 4.4 4.4L19 7.4" stroke-width="2.2"/>`,
  xmark: `<path d="m7 7 10 10M17 7 7 17" stroke-width="2.2"/>`,
  minus: `<path d="M6 12h12" stroke-width="2.2"/>`,
  plus: `<path d="M12 5.5v13M5.5 12h13" stroke-width="2"/>`,
  ellipsis: `<circle cx="6" cy="12" r="1.6" ${F}/><circle cx="12" cy="12" r="1.6" ${F}/><circle cx="18" cy="12" r="1.6" ${F}/>`,
  clock: `<circle cx="12" cy="12" r="9.2"/><path d="M12 7v5.3l3.4 2.1"/>`,
  pin: `<path d="M12 21s-6.4-5.6-6.4-11a6.4 6.4 0 0 1 12.8 0c0 5.4-6.4 11-6.4 11Z"/><circle cx="12" cy="10" r="2.3"/>`,
  sidebar: `<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15M5.5 8.5h1.6M5.5 11.5h1.6"/>`,
  waveform: `<path d="M3 12h2M6.5 8v8M10 4.5v15M13.5 9v6M17 6.5v11M20.5 10.5v3"/>`,
  arrowUpRight: `<path d="M7 17 17 7M8.5 7H17v8.5"/>`,
  scope: `<circle cx="12" cy="12" r="7.6"/><path d="M12 2.4v4M12 17.6v4M2.4 12h4M17.6 12h4"/><circle cx="12" cy="12" r="1.2" ${F}/>`,
  question: `<circle cx="12" cy="12" r="9.2"/><path d="M9.4 9.4a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.3 1-1.3 1.9v.6"/><circle cx="12" cy="17" r="1.1" ${F}/>`,
  context: `<path d="M4.2 5.4c2.6-.9 5.2-.7 7.8.8v13.2c-2.6-1.5-5.2-1.7-7.8-.8ZM19.8 5.4c-2.6-.9-5.2-.7-7.8.8v13.2c2.6-1.5 5.2-1.7 7.8-.8Z"/>`,
  correction: `<path d="M4 19.6h4.2L19 8.8a2.4 2.4 0 0 0-3.4-3.4L4.8 16.2Z"/><path d="m13.8 7.2 3.4 3.4"/>`,
  prediction: `<path d="M3.6 17.4 9 12l3.4 3.4 7.6-7.6"/><path d="M15.2 7.8H20v4.8" /><path d="M3.6 20.4h16.8" stroke-dasharray="1.6 2.4"/>`,
  witness: `<path d="M2.6 12c2.2-4.2 5.4-6.3 9.4-6.3s7.2 2.1 9.4 6.3c-2.2 4.2-5.4 6.3-9.4 6.3S4.8 16.2 2.6 12Z"/><circle cx="12" cy="12" r="3.1"/><path d="M12 2v1.6M12 20.4V22M2 12h.6M21.4 12h.6"/>`,
  live: `<circle cx="12" cy="12" r="2.4" ${F}/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 7.8a6 6 0 0 0 0 8.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4M4.8 4.8a10.2 10.2 0 0 0 0 14.4"/>`,
  upload: `<path d="M12 15.4V4.2M8.2 8 12 4.2 15.8 8"/><path d="M4.6 13.6v4.2c0 1.2 1 2.2 2.2 2.2h10.4c1.2 0 2.2-1 2.2-2.2v-4.2"/>`,
  reply: `<path d="M9.6 6.2 4 11.6l5.6 5.4"/><path d="M4.4 11.6h9.4c3.4 0 6.2 2.8 6.2 6.2v.6"/>`,
  note: `<path d="M5.2 3.8h9.6l4 4v12.4H5.2Z"/><path d="M14.6 3.8v4.2h4.2M8.4 12.4h7.2M8.4 15.8h5"/>`,
  bridge: `<path d="M2.8 16.6h18.4M5 16.6v3.2M19 16.6v3.2M3.4 12.6c2.6-4.6 14.6-4.6 17.2 0"/><path d="M8 9.6v7M12 8.4v8.2M16 9.6v7"/>`,
  users: `<circle cx="9" cy="8.6" r="3.2"/><path d="M3.2 19c.9-3 3.1-4.6 5.8-4.6s4.9 1.6 5.8 4.6"/><circle cx="16.6" cy="9.2" r="2.6"/><path d="M15.4 14.6c2.4-.3 4.4.9 5.4 3.6"/>`,
  frustum: `<circle cx="12" cy="18.2" r="2" ${F}/><path d="M12 16.2 5.2 4.6M12 16.2l6.8-11.6M5.2 4.6c4.4-1.6 9.2-1.6 13.6 0"/>`,
  bolt: `<path d="M13.4 2.6 5.8 13.2h5.6l-1.2 8.2 8-11.2h-5.8Z" ${F}/>`,
  sendUp: `<path d="M12 19V5.6M6.6 11 12 5.6l5.4 5.4" stroke-width="2.2"/>`,
  dot: `<circle cx="12" cy="12" r="4" ${F}/>`,
  hand: `<path d="M8.4 12.6V5.8a1.4 1.4 0 0 1 2.8 0v5.4M11.2 10.8V4.4a1.4 1.4 0 0 1 2.8 0v6.4M14 10.8V5.6a1.4 1.4 0 0 1 2.8 0v7.6M8.4 12.6l-1.3-1.7a1.5 1.5 0 0 0-2.3 1.9l3.4 5.3c1.2 1.8 3 2.9 5.2 2.9h.4c2.6 0 4.9-2.1 4.9-4.8V8.5a1.4 1.4 0 0 0-2.8 0"/>`,
  today: `<path class="f" d="M4 15.6a8 8 0 0 1 16 0Z"/><path d="M4 15.6a8 8 0 0 1 16 0M2.6 15.6h18.8M12 3.4v2.2M5.3 6.2l1.5 1.5M18.7 6.2l-1.5 1.5M6.4 19h11.2"/>`,
  rooms: `<path class="f" d="M4.2 5.4h10.4c.9 0 1.6.7 1.6 1.6v6.2c0 .9-.7 1.6-1.6 1.6H9.1l-3.4 2.8v-2.8H4.2c-.9 0-1.6-.7-1.6-1.6V7c0-.9.7-1.6 1.6-1.6Z"/><path d="M4.2 5.4h10.4c.9 0 1.6.7 1.6 1.6v6.2c0 .9-.7 1.6-1.6 1.6H9.1l-3.4 2.8v-2.8H4.2c-.9 0-1.6-.7-1.6-1.6V7c0-.9.7-1.6 1.6-1.6Z"/><path d="M16.2 9.2h3.6c.9 0 1.6.7 1.6 1.6v5.4c0 .9-.7 1.6-1.6 1.6h-1.2v2.6l-3.1-2.6h-4.2c-.9 0-1.6-.7-1.6-1.6v-.6"/>`,
  bell: `<path d="M6.2 16.4V10.6a5.8 5.8 0 0 1 11.6 0v5.8l1.6 2H4.6Z"/><path d="M10 20.2a2.1 2.1 0 0 0 4 0"/>`,
  graph: `<circle cx="6" cy="7" r="2.3"/><circle cx="18" cy="6" r="2.3"/><circle cx="12" cy="17.6" r="2.6"/><circle cx="19" cy="15" r="1.7"/><path d="M8.2 7.8 16 6.4M7.2 9l3.6 6.4M17 8.2l-3.8 7.4M14.6 17l2.9-1.4"/>`,
  dome: `<path d="M3 17.2a9 9 0 0 1 18 0Z"/><path d="M7.2 17.2a4.8 4.8 0 0 1 9.6 0M12 8.2v9"/><circle cx="15.6" cy="11.4" r="1.1" ${F}/><circle cx="8.6" cy="13.4" r="0.9" ${F}/>`,
  heli: `<path d="M3 5.4h14M10 5.4v3"/><path d="M6.6 11.2c0-1.6 1.3-2.8 3-2.8h2.2c2.6 0 4.6 1.8 4.6 4.2v.6H8.8c-1.2 0-2.2-.9-2.2-2Z" ${F}/><path d="M16.4 12.2h4.4M20.4 10.4v3.6M9.4 13.2l-1 3.2M13.6 13.2l1 3.2M6.8 16.4h10"/>`,
  satellite: `<path d="m12 8.9 3.1 3.1-3.1 3.1L8.9 12Z" ${F}/><path d="M5.4 9.6 9.6 5.4 7 2.8 2.8 7ZM18.6 14.4l-4.2 4.2 2.6 2.6 4.2-4.2ZM10.4 10.4 7.6 7.6M13.6 13.6l2.8 2.8"/>`,
  building: `<path d="M8 21V8.4l4-2.2 4 2.2V21M12 2.6v3.6M10 11h4M10 14h4M10 17h4M4.6 21h14.8"/>`,
  film: `<rect x="3.4" y="5" width="17.2" height="14" rx="2.4"/><path d="M7.4 5v14M16.6 5v14M3.4 9.6h4M3.4 14.4h4M16.6 9.6h4M16.6 14.4h4"/>`,
  scissors: `<circle cx="6.4" cy="7" r="2.6"/><circle cx="6.4" cy="17" r="2.6"/><path d="m8.6 8.4 11 8.8M8.6 15.6l11-8.8"/>`,
  receipt: `<path d="M6 3.6h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4Z"/><path d="M9 8.4h6M9 11.6h6M9 14.8h3.6"/>`,
  director: `<rect x="3.4" y="9.2" width="17.2" height="11" rx="1.8"/><path d="m3.6 9.2 2.2-5.4 15 2.6-1.1 2.8M8.4 4.6l1.6 3.6M13.4 5.4l1.6 3.6"/>`,
  forward: `<path d="M4 6.6v10.8L11.4 12ZM12.6 6.6v10.8L20 12Z" ${F}/>`,
};

/**
 * Inline SVG markup for a glyph.
 * @param {string} name
 * @param {{ label?: string, cls?: string }} [opts]
 */
export function icon(name, { label = '', cls = '' } = {}) {
  const body = P[name] || P.ellipsis;
  const a11y = label
    ? `role="img" aria-label="${label}"`
    : 'aria-hidden="true" focusable="false"';
  return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}

export const FAMILY_ICON = {
  sky: 'sky',
  sea: 'sea',
  orbit: 'orbit',
  hazards: 'hazards',
  eyes: 'eyes',
  ground: 'ground',
  weather: 'weather',
  infra: 'infra',
};

export const FAMILIES = [
  { id: 'sky', name: 'Sky', color: '#7CC4FF' },
  { id: 'sea', name: 'Sea', color: '#38E1C6' },
  { id: 'orbit', name: 'Orbit', color: '#C9A7FF' },
  { id: 'hazards', name: 'Hazards', color: '#FF6A3D' },
  { id: 'eyes', name: 'Eyes', color: '#FFD166' },
  { id: 'ground', name: 'Ground', color: '#9BE15D' },
  { id: 'weather', name: 'Weather', color: '#8AB4F8' },
  { id: 'infra', name: 'Infra', color: '#B8C0CC' },
];

export const FAMILY_COLOR = Object.fromEntries(
  FAMILIES.map((f) => [f.id, f.color]),
);
