/**
 * Chat emotes and reaction glyphs, hand-drawn as inline SVG so they look
 * the same on every platform (no emoji fonts). Emote codes are typed as
 * words, Twitch-style: "SealIt", "o7", "HeliSpin".
 */

import { esc } from './dom.js';

const S = (body, vb = '0 0 32 32') =>
  `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;

/** Reaction glyphs (the heart stream). Filled, with a soft highlight. */
export const REACT = {
  heart: {
    label: 'Heart',
    color: '#ff5a7a',
    svg: S(
      `<path d="M16 27.5C9.2 22.6 3.6 18 3.6 11.6 3.6 7.7 6.6 4.6 10.4 4.6c2.4 0 4.3 1.2 5.6 3.2 1.3-2 3.2-3.2 5.6-3.2 3.8 0 6.8 3.1 6.8 7 0 6.4-5.6 11-12.4 15.9Z" fill="#ff4f73"/><path d="M8.2 9.4c.7-1.6 2.2-2.4 3.6-2.2" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round" fill="none"/>`,
    ),
  },
  fire: {
    label: 'Fire',
    color: '#ff8a3d',
    svg: S(
      `<path d="M16 29c-6 0-10-4-10-9.4 0-4.4 2.9-7 4.6-9.6 1.2 2.3 2.7 3.5 4 3.6-.5-4.4.9-8.6 4.9-12.1.3 4.6 2.1 7 4.3 9.5 2 2.3 3.7 4.7 3.7 8.6C27.5 25 22 29 16 29Z" fill="#ff7a2f"/><path d="M16 29c-3.2 0-5.3-2.1-5.3-5 0-2.6 1.8-4 2.8-5.6.7 1.2 1.6 1.8 2.3 1.9-.2-2.4.5-4.6 2.6-6.5.2 2.5 1.2 3.8 2.3 5.1 1.1 1.3 2 2.6 2 4.7 0 3.1-3.1 5.4-6.7 5.4Z" fill="#ffd166"/>`,
    ),
  },
  eyes: {
    label: 'Eyes',
    color: '#a3d8ff',
    svg: S(
      `<ellipse cx="10.4" cy="16" rx="6.4" ry="8.6" fill="#f4f7fb"/><ellipse cx="21.6" cy="16" rx="6.4" ry="8.6" fill="#f4f7fb"/><circle cx="12" cy="17.6" r="3.2" fill="#14181f"/><circle cx="23.2" cy="17.6" r="3.2" fill="#14181f"/><circle cx="13" cy="16.4" r="1" fill="#fff"/><circle cx="24.2" cy="16.4" r="1" fill="#fff"/>`,
    ),
  },
  wow: {
    label: 'Wow',
    color: '#ffd166',
    svg: S(
      `<circle cx="16" cy="16" r="12.6" fill="#ffcf4a"/><ellipse cx="11.6" cy="13" rx="1.7" ry="2.4" fill="#3a2600"/><ellipse cx="20.4" cy="13" rx="1.7" ry="2.4" fill="#3a2600"/><ellipse cx="16" cy="21.2" rx="3.4" ry="4.2" fill="#3a2600"/><path d="M8.6 8.8c1-1.1 2.3-1.7 3.6-1.8M23.4 8.8c-1-1.1-2.3-1.7-3.6-1.8" stroke="#3a2600" stroke-width="1.6" stroke-linecap="round"/>`,
    ),
  },
};
export const REACT_KINDS = ['heart', 'fire', 'eyes', 'wow'];

/** Chat emotes. */
export const EMOTES = {
  SealIt: {
    hint: 'Seal it or it didn’t happen',
    svg: S(
      `<path d="M16 3.4l2.6 2 3.2-.5 1.2 3 3 1.2-.5 3.2 2 2.6-2 2.6.5 3.2-3 1.2-1.2 3-3.2-.5-2.6 2-2.6-2-3.2.5-1.2-3-3-1.2.5-3.2-2-2.6 2-2.6-.5-3.2 3-1.2 1.2-3 3.2.5Z" fill="#ebc777"/><path d="m11 16.4 3.4 3.4 6.8-7" stroke="#2a1a00" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    ),
  },
  o7: {
    hint: 'Salute',
    svg: S(
      `<circle cx="13" cy="17" r="9" fill="#8fd0ff"/><circle cx="10.2" cy="15.6" r="1.4" fill="#0b1a28"/><circle cx="15.8" cy="15.6" r="1.4" fill="#0b1a28"/><path d="M10 20.6c1.8 1.3 4.2 1.3 6 0" stroke="#0b1a28" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M20.4 11.2 27.6 4" stroke="#f4f7fb" stroke-width="3.2" stroke-linecap="round"/><path d="M18.6 13.6l2.6-2.6" stroke="#f4f7fb" stroke-width="4" stroke-linecap="round"/>`,
    ),
  },
  EyesUp: {
    hint: 'Look up',
    svg: S(
      `<ellipse cx="10.4" cy="17" rx="6" ry="8" fill="#f4f7fb"/><ellipse cx="21.6" cy="17" rx="6" ry="8" fill="#f4f7fb"/><circle cx="11" cy="12.6" r="3" fill="#14181f"/><circle cx="22.2" cy="12.6" r="3" fill="#14181f"/><path d="M9 4.6 16 1.6l7 3" stroke="#a3d8ff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ),
  },
  HeliSpin: {
    hint: 'Helicopter circling',
    svg: S(
      `<path d="M3 7.6h26" stroke="#a3d8ff" stroke-width="2.2" stroke-linecap="round"/><path d="M16 7.6v4" stroke="#a3d8ff" stroke-width="2"/><path d="M8.6 15.2c0-2.2 1.8-3.8 4-3.8h5.2c3.4 0 6 2.6 6 6v1.2c0 1.6-1.3 2.8-2.8 2.8H11.4c-1.6 0-2.8-1.2-2.8-2.8Z" fill="#dfe8f2"/><path d="M19 14h4.4" stroke="#14181f" stroke-width="1.6"/><path d="M8.6 16.6H2.4l-1-3" stroke="#dfe8f2" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M11 24.6h11M13 21.4l-1 3.2M20 21.4l1 3.2" stroke="#dfe8f2" stroke-width="1.6" stroke-linecap="round"/>`,
    ),
  },
  Receipts: {
    hint: 'Show the receipts',
    svg: S(
      `<path d="M8 3.4h16v25.2l-2.7-1.8-2.6 1.8-2.7-1.8-2.6 1.8-2.7-1.8L8 28.6Z" fill="#f4f7fb"/><path d="M11.4 9h9.2M11.4 13h9.2M11.4 17h5.6" stroke="#59616c" stroke-width="1.6" stroke-linecap="round"/><path d="m16.8 20.4 2 2 4-4.2" stroke="#2fbf71" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    ),
  },
  Doubt: {
    hint: 'Doubt',
    svg: S(
      `<circle cx="16" cy="16" r="12.4" fill="#c7a6ff"/><path d="M9.4 11.4l4-1.2M18.8 10.6l3.8 1" stroke="#1d1030" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="14.6" r="1.6" fill="#1d1030"/><circle cx="20.2" cy="14.6" r="1.6" fill="#1d1030"/><path d="M11.6 21.6c2.6-1 5.8-1 8.6.4" stroke="#1d1030" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    ),
  },
  StormMode: {
    hint: 'Storm mode',
    svg: S(
      `<path d="M9 19.6h14.4a5.2 5.2 0 0 0 .4-10.4 7.4 7.4 0 0 0-14.3 1.8A4.3 4.3 0 0 0 9 19.6Z" fill="#8a96a8"/><path d="m17.6 17.4-4.6 6.4h3.6l-1.4 5.8 5.6-7.6h-3.6l1.8-4.6Z" fill="#ffd166"/>`,
    ),
  },
  LiftOff: {
    hint: 'Launch',
    svg: S(
      `<path d="M16 2.6c4 3.2 5.8 7.8 5.4 13.2l-2.4 4.2h-6l-2.4-4.2C10.2 10.4 12 5.8 16 2.6Z" fill="#f4f7fb"/><circle cx="16" cy="11.4" r="2.2" fill="#7cc4ff"/><path d="m10.6 15.8-3.4 3.6.4 3.4 4.8-2.8M21.4 15.8l3.4 3.6-.4 3.4-4.8-2.8" fill="#ff7a2f"/><path d="M13.6 21.4c.4 3.4 1.2 6 2.4 8 1.2-2 2-4.6 2.4-8Z" fill="#ffd166"/>`,
    ),
  },
};
export const EMOTE_CODES = Object.keys(EMOTES);

export const reactSvg = (kind) => (REACT[kind] || REACT.heart).svg;

/**
 * Chat line → HTML: escapes text, turns emote codes into glyphs and
 * @mentions into highlighted handles.
 * @param {string} text
 * @param {{ me?: string }} o
 */
export function richText(text, { me = '' } = {}) {
  const parts = String(text || '').split(/(\s+)/);
  let mentionsMe = false;
  const html = parts
    .map((w) => {
      if (/^\s+$/.test(w)) return w;
      const bare = w.replace(/[.,!?]+$/, '');
      const tail = w.slice(bare.length);
      if (EMOTES[bare])
        return `<span class="emote" title="${bare}" data-emote="${bare}">${EMOTES[bare].svg}</span>${esc(tail)}`;
      if (/^@[\w.-]{2,}$/.test(bare)) {
        const mine =
          me && bare.toLowerCase() === String(me).toLowerCase().trim();
        if (mine) mentionsMe = true;
        return `<b class="mention ${mine ? 'me' : ''}">${esc(bare)}</b>${esc(tail)}`;
      }
      return esc(w);
    })
    .join('');
  return { html, mentionsMe };
}
