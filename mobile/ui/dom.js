/** Small DOM, formatting, motion and haptic helpers shared by the shell. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
/** Escape untrusted text for HTML interpolation. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Build one element from an HTML string. */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** "2 min ago", "just now", "3 h ago". */
export function ago(ts, now = Date.now()) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function fmtNum(v, digits = 0) {
  if (v == null || v === '') return '—';
  if (typeof v !== 'number') return String(v);
  if (Math.abs(v) >= 10000)
    return new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(v);
  return v.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function fmtCoord(lat, lon, d = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(d)}° ${ns}  ${Math.abs(lon).toFixed(d)}° ${ew}`;
}

export function fmtDist(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString()} km`;
}

export function fmtAlt(m) {
  if (!Number.isFinite(m)) return '—';
  if (m > 100000) return `${Math.round(m / 1000).toLocaleString()} km`;
  const ft = m * 3.28084;
  return `${Math.round(ft / 100) * 100 >= 1000 ? (Math.round(ft / 100) * 100).toLocaleString() : Math.round(ft)} ft`;
}

/* ---------- Settings (per-viewer conveniences only) ---------- */

const SETTINGS_KEY = 'gev.mobile.settings.v1';
const defaults = {
  quality: 'auto',
  reduceMotion: 'system',
  alertRadiusKm: 250,
  haptics: true,
  followed: [],
  lens: 'cinematic',
};

let settings = { ...defaults };
try {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) settings = { ...defaults, ...JSON.parse(raw) };
} catch {
  /* storage unavailable: defaults */
}

const subs = new Set();
export const store = {
  get: (k) => settings[k],
  set(k, v) {
    settings[k] = v;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    subs.forEach((fn) => fn(k, v));
  },
  on(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  isFollowed: (id) => settings.followed.includes(id),
  toggleFollow(id) {
    const list = settings.followed.includes(id)
      ? settings.followed.filter((x) => x !== id)
      : [id, ...settings.followed];
    store.set('followed', list);
    return list.includes(id);
  },
};

/* ---------- Motion ---------- */

const rmQuery = matchMedia('(prefers-reduced-motion: reduce)');
export function reducedMotion() {
  const pref = settings.reduceMotion;
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return rmQuery.matches;
}

export function applyMotionPref() {
  const pref = settings.reduceMotion;
  if (pref === 'system') delete document.documentElement.dataset.reduceMotion;
  else document.documentElement.dataset.reduceMotion = pref;
}

/** Spring easing string for WAAPI (falls back to cubic-bezier). */
export const SPRING = (() => {
  try {
    if (CSS.supports('transition-timing-function', 'linear(0, 1)'))
      return 'linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017 19.8%, 1.067, 1.089 25.9%, 1.085 29.1%, 1.05 35.4%, 1.016 42.4%, 0.999 51.8%, 0.996 58.3%, 1)';
  } catch {
    /* ignore */
  }
  return 'cubic-bezier(0.32, 1.25, 0.4, 1)';
})();

export const SPRING_SOFT = (() => {
  try {
    if (CSS.supports('transition-timing-function', 'linear(0, 1)'))
      return 'linear(0, 0.06 3%, 0.25 7.5%, 0.6 15%, 0.84 22%, 0.96 30%, 1.012 38%, 1.02 46%, 1.006 60%, 1)';
  } catch {
    /* ignore */
  }
  return 'cubic-bezier(0.25, 1.1, 0.4, 1)';
})();

export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const nextFrame = () =>
  new Promise((r) => requestAnimationFrame(() => r()));

/* ---------- Haptics ---------- */

const PATTERNS = {
  tick: 5,
  light: 8,
  medium: 14,
  success: [10, 40, 18],
  seal: [12, 60, 12, 60, 28],
  warn: [20, 50, 20],
};
export function haptic(kind = 'tick') {
  if (!settings.haptics) return;
  try {
    // Chrome logs an intervention for vibrate() before any user gesture.
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false)
      navigator.vibrate(PATTERNS[kind] ?? 5);
  } catch {
    /* ignore */
  }
}

/* ---------- Toast ---------- */

let toastTimer = 0;
export function toast(text, { icon: iconHtml = '' } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h(
      '<div id="toast" class="toast glass-strong" role="status" aria-live="polite"></div>',
    );
    document.body.appendChild(el);
  }
  el.innerHTML = `${iconHtml}<span>${esc(text)}</span>`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/** Inline SVG sparkline path for a numeric series. */
export function sparkPath(values, w, h, pad = 1.5) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return '';
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  return v
    .map((y, i) => {
      const px = pad + (i / (v.length - 1)) * (w - pad * 2);
      const py = pad + (1 - (y - lo) / (hi - lo)) * (h - pad * 2);
      return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
    })
    .join('');
}

/** Long press helper; returns a disposer. */
export function onLongPress(el, fn, ms = 480) {
  let timer = 0;
  let sx = 0;
  let sy = 0;
  let fired = false;
  const down = (e) => {
    fired = false;
    sx = e.clientX;
    sy = e.clientY;
    timer = setTimeout(() => {
      fired = true;
      fn(e);
    }, ms);
  };
  const move = (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clearTimeout(timer);
  };
  const up = () => clearTimeout(timer);
  el.addEventListener('pointerdown', down, { passive: true });
  el.addEventListener('pointermove', move, { passive: true });
  el.addEventListener('pointerup', up, { passive: true });
  el.addEventListener('pointercancel', up, { passive: true });
  el.addEventListener(
    'click',
    (e) => {
      if (fired) {
        e.stopImmediatePropagation();
        e.preventDefault();
        fired = false;
      }
    },
    true,
  );
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** A tiny event emitter. */
export function emitter() {
  const m = new Map();
  return {
    on(ev, fn) {
      if (!m.has(ev)) m.set(ev, new Set());
      m.get(ev).add(fn);
      return () => m.get(ev)?.delete(fn);
    },
    off(ev, fn) {
      m.get(ev)?.delete(fn);
    },
    emit(ev, data) {
      m.get(ev)?.forEach((fn) => {
        try {
          fn(data);
        } catch (err) {
          console.error(err);
        }
      });
    },
  };
}

/** Esri World Imagery export URL for a lon/lat box around a point. */
export function esriThumb(lon, lat, spanDeg = 1.2, w = 480, hgt = 600) {
  const aspect = hgt / w;
  const dLon = spanDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLat = spanDeg * aspect;
  const west = lon - dLon / 2;
  const east = lon + dLon / 2;
  const south = Math.max(-85, lat - dLat / 2);
  const north = Math.min(85, lat + dLat / 2);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}&bboxSR=4326&imageSR=3857&size=${w},${hgt}&format=jpg&f=image`;
}

/** Safe-area insets in px (env() read through a probe element). */
let insetProbe = null;
export function safeInsets() {
  if (!insetProbe) {
    insetProbe = document.createElement('div');
    insetProbe.style.cssText =
      'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(insetProbe);
  }
  const cs = getComputedStyle(insetProbe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}
