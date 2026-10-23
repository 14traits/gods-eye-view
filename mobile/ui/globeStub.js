/**
 * Offline stand-in for mobile/globe (DESIGN.md §10 Globe API contract).
 *
 * A WebGL2 orthographic planet: Esri World Imagery day mosaic, NASA Black
 * Marble night lights blended across the real terminator, an atmosphere rim,
 * and a sharper Esri export for the view when you descend. Contacts and
 * situations are SIMULATED so the shell is always demoable; every card and
 * pick from this engine says so.
 */

import {
  buildStubSituations,
  STUB_CAMS,
  camFrameUrl,
} from './stubSituations.js';
import { stubThumbnail } from './stubCompositor.js';
import { installRound3 } from './shim3.js';

const R_EARTH = 6371008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const FOV_HALF = Math.tan(20 * D2R);
const MIN_H = 1500;
const MAX_H = 42000e3;
const HOME = { lon: 20, lat: 18, height: 15500e3 };

const SIM = 'Simulated · offline stub engine';

const DAY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=-180,-90,180,90&bboxSR=4326&imageSR=4326&size=4096,2048&format=jpg&f=image';
const NIGHT_URL =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_Black_Marble&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/jpeg';

/* ------------------------------------------------------------------ */
/* Catalog (DESIGN.md §8)                                              */
/* ------------------------------------------------------------------ */

const CATALOG = {
  sky: [
    'Commercial flights',
    'Military aircraft',
    'Helicopters',
    'Private / GA',
    'Emergency squawks',
    'Drones (Remote ID)',
    'Airport boards',
    'Holding patterns',
  ],
  sea: [
    'AIS vessels',
    'Ports',
    'Tankers / cargo',
    'Fishing effort',
    'Dark vessels',
    'Submarine cables',
  ],
  orbit: [
    'Satellites (TLE)',
    'ISS & crewed',
    'Starlink trains',
    'Launches',
    'Debris',
    'Ground tracks',
  ],
  hazards: [
    'Earthquakes',
    'Active fires',
    'Fire perimeters',
    'Floods',
    'Tropical cyclones',
    'Volcanoes',
    'Air quality',
  ],
  eyes: [
    'Public CCTV',
    'Signed captures',
    'Street-level',
    'Holograms',
    'Live streams',
  ],
  ground: [
    'Transit vehicles',
    'Traffic flow',
    'Bike share',
    'Rail',
    'Events & venues',
    'ALPR cameras',
  ],
  weather: ['Radar', 'Clouds', 'Lightning', 'Wind', 'Forecast models'],
  infra: [
    'Datacenters',
    'Dams',
    'Power plants',
    'Military installations',
    'GNSS interference',
    'Recent imagery',
  ],
};

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const DEFAULT_ON = new Set([
  'sky.commercial-flights',
  'sky.helicopters',
  'sea.ais-vessels',
  'orbit.iss-crewed',
  'orbit.satellites-tle',
  'hazards.earthquakes',
  'hazards.active-fires',
  'hazards.tropical-cyclones',
  'hazards.floods',
]);

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

function toVec(lon, lat) {
  const cl = Math.cos(lat * D2R);
  return [
    cl * Math.cos(lon * D2R),
    cl * Math.sin(lon * D2R),
    Math.sin(lat * D2R),
  ];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function haversine(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

function destination(lon, lat, bearingDeg, distM) {
  const d = distM / R_EARTH;
  const b = bearingDeg * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return [((l2 * R2D + 540) % 360) - 180, p2 * R2D];
}

function subsolar(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86400000;
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const hours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const lon = -(hours - 12) * 15;
  return toVec(lon, decl);
}

/* ------------------------------------------------------------------ */
/* Simulated world                                                     */
/* ------------------------------------------------------------------ */

const HUBS = [
  [-84.43, 33.64],
  [-87.9, 41.98],
  [-0.45, 51.47],
  [55.36, 25.25],
  [139.78, 35.55],
  [2.55, 49.01],
  [8.57, 50.04],
  [103.99, 1.36],
  [-118.41, 33.94],
  [-73.78, 40.64],
  [-122.38, 37.62],
  [77.1, 28.56],
  [151.18, -33.94],
  [-46.47, -23.43],
  [28.75, 41.26],
  [4.76, 52.31],
  [126.45, 37.46],
  [114.2, 22.3],
  [-99.07, 19.44],
  [18.6, -33.97],
];
const PORTS = [
  [32.55, 29.9, 'Suez approach'],
  [103.85, 1.22, 'Singapore Strait'],
  [4.05, 51.95, 'Maasvlakte'],
  [-122.5, 37.79, 'Golden Gate'],
  [-5.6, 35.95, 'Gibraltar'],
  [121.6, 31.2, 'Yangshan'],
  [-79.7, 9.2, 'Panama'],
  [56.3, 26.4, 'Hormuz'],
];
const PREFIX = ['AEX', 'NVA', 'PLR', 'HLX', 'TRN', 'KTX', 'ORV', 'SNW'];
const SHIP = [
  'Aster',
  'Nordlys',
  'Kestrel',
  'Meridian',
  'Halcyon',
  'Sable',
  'Tern',
  'Cobalt',
  'Brightwater',
  'Pelagia',
];

function buildContacts() {
  const r = rng(7);
  const out = [];
  HUBS.forEach(([lon, lat], hi) => {
    for (let i = 0; i < 34; i += 1) {
      const [x, y] = destination(lon, lat, r() * 360, 20e3 + r() * 900e3);
      out.push({
        kind: 'aircraft',
        layer: 'sky.commercial-flights',
        id: `ac-${hi}-${i}`,
        title: `${PREFIX[(hi + i) % PREFIX.length]}${100 + Math.floor(r() * 8900)}`,
        lon: x,
        lat: y,
        altM: 2500 + r() * 9800,
        headingDeg: r() * 360,
        speed: 170 + r() * 90,
      });
    }
  });
  for (let i = 0; i < 23; i += 1) {
    const [x, y] = destination(-85.72, 31.36, r() * 360, 3e3 + r() * 18e3);
    out.push({
      kind: 'helicopter',
      layer: 'sky.helicopters',
      id: `heli-${i}`,
      title: `ARMY ${String(20000 + Math.floor(r() * 900))}`,
      lon: x,
      lat: y,
      altM: 150 + r() * 300,
      headingDeg: r() * 360,
      speed: 45 + r() * 20,
      circuit: true,
    });
  }
  for (let i = 0; i < 14; i += 1) {
    const [x, y] = destination(3.5, 55.5, r() * 360, r() * 260e3);
    out.push({
      kind: 'aircraft',
      layer: 'sky.military-aircraft',
      id: `mil-${i}`,
      title: `RCH${300 + i}`,
      lon: x,
      lat: y,
      altM: 6000 + r() * 4000,
      headingDeg: r() * 360,
      speed: 190,
    });
  }
  PORTS.forEach(([lon, lat], pi) => {
    for (let i = 0; i < 26; i += 1) {
      const [x, y] = destination(lon, lat, r() * 360, r() * 60e3);
      out.push({
        kind: 'ship',
        layer: 'sea.ais-vessels',
        id: `ship-${pi}-${i}`,
        title: `${SHIP[(pi * 3 + i) % SHIP.length]} ${['Star', 'Spirit', 'Trader', 'Bay', 'Venture', 'Dawn', 'Pioneer'][(i + pi) % 7]}${i >= 10 ? ` ${['II', 'III', 'IV'][i % 3]}` : ''}`,
        lon: x,
        lat: y,
        altM: 0,
        headingDeg: r() * 360,
        speed: r() < 0.6 ? 0.3 : 6 + r() * 6,
      });
    }
  });
  const sats = [
    {
      id: 'iss',
      title: 'ISS (ZARYA)',
      layer: 'orbit.iss-crewed',
      inc: 51.6,
      alt: 418e3,
      raan: 40,
      phase: 0,
    },
  ];
  for (let i = 0; i < 48; i += 1) {
    sats.push({
      id: `sat-${i}`,
      title: i < 18 ? `STARLINK-${31000 + i * 7}` : `SAT-${40000 + i * 113}`,
      layer: 'orbit.satellites-tle',
      inc: i < 18 ? 53 : 45 + r() * 53,
      alt: i < 18 ? 550e3 : 480e3 + r() * 800e3,
      raan: i < 18 ? 120 : r() * 360,
      phase: i < 18 ? i * 3.2 : r() * 360,
    });
  }
  sats.forEach((s) =>
    out.push({
      kind: 'satellite',
      layer: s.layer,
      id: s.id,
      title: s.title,
      orbit: s,
      lon: 0,
      lat: 0,
      altM: s.alt,
      headingDeg: 0,
    }),
  );
  const quakes = [
    [144.2, 42.1, 6.4],
    [-70.9, -30.2, 5.1],
    [27.8, 38.4, 4.6],
    [-155.3, 19.4, 4.2],
    [95.9, 2.9, 5.3],
  ];
  quakes.forEach(([lon, lat, m], i) =>
    out.push({
      kind: 'quake',
      layer: 'hazards.earthquakes',
      id: `eq-${i}`,
      title: `M${m.toFixed(1)}`,
      lon,
      lat,
      altM: 0,
      headingDeg: 0,
      mag: m,
    }),
  );
  for (let i = 0; i < 40; i += 1) {
    const [x, y] = destination(-120.9, 39.0, r() * 360, r() * 90e3);
    out.push({
      kind: 'fire',
      layer: 'hazards.active-fires',
      id: `fire-${i}`,
      title: 'FIRMS hotspot',
      lon: x,
      lat: y,
      altM: 0,
      headingDeg: 0,
    });
  }
  return out;
}

function propagate(c, t0, t) {
  if (c.kind === 'satellite') {
    const o = c.orbit;
    const mu = 3.986004418e14;
    const a = R_EARTH + o.alt;
    const n = Math.sqrt(mu / a ** 3);
    const u = o.phase * D2R + n * (t / 1000);
    const inc = o.inc * D2R;
    const lat = Math.asin(Math.sin(inc) * Math.sin(u));
    const lonI = Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u));
    const earth = 7.2921159e-5 * (t / 1000);
    const lon = (((lonI + o.raan * D2R - earth) * R2D + 540) % 360) - 180;
    c.lon = lon;
    c.lat = lat * R2D;
    c.headingDeg = 90 - o.inc * Math.cos(u);
    return;
  }
  if (!c.speed) return;
  const dt = (t - t0) / 1000;
  if (!c.base) c.base = { lon: c.lon, lat: c.lat, h: c.headingDeg };
  if (c.circuit) {
    const w = c.speed / 2500;
    const h = c.base.h + ((dt * w * R2D) % 360);
    const [x, y] = destination(c.base.lon, c.base.lat, h, 2500);
    c.lon = x;
    c.lat = y;
    c.headingDeg = (h + 90) % 360;
    return;
  }
  const [x, y] = destination(c.base.lon, c.base.lat, c.base.h, c.speed * dt);
  c.lon = x;
  c.lat = y;
}

/* ------------------------------------------------------------------ */
/* Situations                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* WebGL planet                                                        */
/* ------------------------------------------------------------------ */

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 u_c; uniform float u_R; uniform vec2 u_res;
uniform vec3 u_right, u_up, u_fwd, u_sun;
uniform sampler2D u_day, u_night, u_det;
uniform vec4 u_box; uniform float u_detOn, u_tex, u_lens, u_nightTex, u_close;
out vec4 o;
const float PI = 3.14159265;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec4 sampleEq(sampler2D t, vec2 uv){
  vec2 uv2 = vec2(fract(uv.x+0.5), uv.y);
  vec2 dx1 = dFdx(uv), dy1 = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  vec2 dx = abs(dx1.x) < abs(dx2.x) ? dx1 : dx2;
  vec2 dy = abs(dy1.x) < abs(dy2.x) ? dy1 : dy2;
  return textureGrad(t, uv, dx, dy);
}
void main(){
  vec2 f = gl_FragCoord.xy;
  vec2 p = (f - u_c) / u_R;
  float r2 = dot(p,p);
  vec3 col;
  if (r2 > 1.0) {
    float r = sqrt(r2);
    float k = (r - 1.0) * u_R / (u_R * 0.045 + 5.0);
    float halo = exp(-k * 1.6);
    vec3 dirW = normalize(p.x*u_right + p.y*u_up);
    float sunSide = 0.25 + 0.75*smoothstep(-0.5, 0.7, dot(dirW, u_sun));
    vec3 atm = mix(vec3(0.18,0.36,0.85), vec3(0.55,0.78,1.0), halo) * halo * sunSide;
    vec2 g = floor(f / 1.5);
    float st = step(0.9975, hash(g)) * (0.4 + 0.6*hash(g+7.7));
    vec2 q = f / u_res;
    vec3 neb = vec3(0.02,0.03,0.06) * (0.6 + 0.4*sin(q.x*3.0+q.y*2.0));
    col = vec3(0.008,0.012,0.022) + neb + atm*0.95 + vec3(st)*(1.0-halo)*0.85;
  } else {
    float z = sqrt(1.0 - r2);
    vec3 n = normalize(p.x*u_right + p.y*u_up + z*u_fwd);
    float lat = asin(clamp(n.z,-1.,1.));
    float lon = atan(n.y, n.x);
    vec2 uv = vec2((lon + PI) / (2.0*PI), (PI*0.5 - lat) / PI);
    vec3 day;
    if (u_tex > 0.5) {
      day = sampleEq(u_day, uv).rgb;
      float polar = smoothstep(84.0, 85.0, abs(lat*180.0/PI));
      vec3 pole = lat > 0.0 ? vec3(0.78,0.84,0.9) : vec3(0.9,0.93,0.96);
      day = mix(day, pole, polar);
    } else {
      day = mix(vec3(0.03,0.10,0.22), vec3(0.08,0.22,0.38), 0.5 + 0.5*sin(lat*3.0));
    }
    if (u_detOn > 0.001) {
      float lonD = lon*180.0/PI, latD = lat*180.0/PI;
      vec2 duv = vec2((lonD - u_box.x)/(u_box.z - u_box.x), (u_box.w - latD)/(u_box.w - u_box.y));
      if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0) {
        vec2 e = min(duv, 1.0-duv);
        float edge = smoothstep(0.0, 0.06, min(e.x, e.y));
        day = mix(day, texture(u_det, duv).rgb, edge * u_detOn);
      }
    }
    vec3 nightL = u_nightTex > 0.5 ? sampleEq(u_night, uv).rgb : vec3(0.0);
    float mu = dot(n, u_sun);
    float dayK = smoothstep(-0.10, 0.16, mu);
    if (u_lens > 1.5 && u_lens < 2.5) dayK *= 0.0;
    vec3 lit = day * (0.18 + 1.05*clamp(mu*1.4+0.2, 0.0, 1.0));
    vec3 nightC = pow(nightL, vec3(1.9)) * vec3(1.65,1.25,0.78) * 2.2 * (1.0 - u_close) + day * mix(0.035, 0.3, u_close);
    col = mix(nightC, lit, dayK);
    col += vec3(1.0,0.42,0.14) * 0.16 * exp(-pow(mu/0.07, 2.0)) * (1.0 - u_lens*0.0);
    float rim = pow(1.0 - z, 2.6);
    col = mix(col, vec3(0.42,0.68,1.0) * (0.25 + 0.9*dayK), rim * 0.62);
  }
  // Lens grade: 0 cinematic, 1 clear, 2 night, 3 thermal, 4 nvg
  vec2 q = f / u_res;
  if (u_lens < 0.5) {
    col = pow(col, vec3(0.95)) * vec3(1.02,1.0,1.04);
    float v = smoothstep(1.25, 0.35, length(q - 0.5) * 1.35);
    col *= mix(0.62, 1.0, v);
  } else if (u_lens > 2.5 && u_lens < 3.5) {
    float l = dot(col, vec3(0.299,0.587,0.114));
    col = clamp(vec3(l*2.6-0.2, l*1.6-0.25, sin(l*6.28)*0.5+0.1 - l*0.4), 0.0, 1.0);
  } else if (u_lens > 3.5) {
    float l = dot(col, vec3(0.299,0.587,0.114));
    float gr = hash(f + fract(u_res.x*0.37)) * 0.08;
    col = vec3(0.12, 1.0, 0.38) * (pow(l, 0.7)*1.4 + gr);
    float v = smoothstep(0.75, 0.3, length(q - 0.5));
    col *= v;
  } else if (u_lens > 1.5) {
    col *= vec3(0.9, 0.95, 1.1);
  }
  col = col / (1.0 + col * 0.12);
  o = vec4(col, 1.0);
}`;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/* ------------------------------------------------------------------ */
/* createGlobe                                                         */
/* ------------------------------------------------------------------ */

export async function createGlobe(container, options = {}) {
  const listeners = new Map();
  const emit = (ev, data) => listeners.get(ev)?.forEach((fn) => fn(data));

  const root = document.createElement('div');
  root.className = 'stub-globe';
  root.style.cssText =
    'position:absolute;inset:0;overflow:hidden;touch-action:none;background:#05070b';
  const canvas = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  for (const c of [canvas, overlay])
    c.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block';
  overlay.style.pointerEvents = 'none';
  root.append(canvas, overlay);
  container.appendChild(root);

  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  const ctx = overlay.getContext('2d');

  const quality = options.quality || 'auto';
  let dpr = Math.min(
    window.devicePixelRatio || 1,
    quality === 'battery' ? 1.25 : 2,
  );

  const cam = { ...HOME, heading: 0 };
  let W = 1;
  let H = 1;
  let paused = false;
  let dirty = true;
  let lens = 0;
  let timeOverride = null;
  let selected = null;
  let flight = null;
  const t0 = Date.now();
  const contacts = buildContacts();
  const layers = [];
  for (const [fam, names] of Object.entries(CATALOG))
    for (const name of names) {
      const id = `${fam}.${slug(name)}`;
      layers.push({
        id,
        family: fam,
        name,
        on: DEFAULT_ON.has(id),
        count: 0,
        status: DEFAULT_ON.has(id) ? 'live' : 'off',
      });
    }
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const counts = {};
  for (const c of contacts) counts[c.layer] = (counts[c.layer] || 0) + 1;
  const r = rng(99);
  for (const l of layers) {
    l.count = counts[l.id] ?? Math.floor(5 + r() * 900);
    if (r() < 0.06 && !l.on) l.status = 'off';
  }
  layerById.get('ground.alpr-cameras').status = 'off';
  let situations = null;
  let viewer = null;

  /* ---------- GL ---------- */
  let prog = null;
  let U = {};
  const tex = { day: null, night: null, det: null };
  let texOn = 0;
  let nightOn = 0;
  const det = { on: 0, target: 0, box: [0, 0, 0, 0], key: '', pending: null };

  function makeTex(unit, img) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (img) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGB,
        1,
        1,
        0,
        gl.RGB,
        gl.UNSIGNED_BYTE,
        new Uint8Array([10, 30, 60]),
      );
    }
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    return t;
  }

  if (gl) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of [
      'u_c',
      'u_R',
      'u_res',
      'u_right',
      'u_up',
      'u_fwd',
      'u_sun',
      'u_day',
      'u_night',
      'u_det',
      'u_box',
      'u_detOn',
      'u_tex',
      'u_lens',
      'u_nightTex',
      'u_close',
    ])
      U[n] = gl.getUniformLocation(prog, n);
    tex.day = makeTex(0);
    tex.night = makeTex(1);
    tex.det = makeTex(2);
    gl.uniform1i(U.u_day, 0);
    gl.uniform1i(U.u_night, 1);
    gl.uniform1i(U.u_det, 2);
    loadImage(DAY_URL)
      .then((img) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex.day);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        texOn = 1;
        dirty = true;
        emit('ready', { imagery: 'esri' });
      })
      .catch(() =>
        emit('quality', { scale: dpr, fps: 0, note: 'imagery offline' }),
      );
    loadImage(NIGHT_URL)
      .then((img) => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tex.night);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        nightOn = 1;
        dirty = true;
      })
      .catch(() => {});
  } else {
    root.style.background =
      'radial-gradient(circle at 42% 38%, #3d7fbf 0, #123a66 30%, #071526 46%, #05070b 47%)';
  }

  function resize() {
    const rect = root.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    for (const c of [canvas, overlay]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  /* ---------- camera math ---------- */
  const radiusPx = (height = cam.height) => {
    const d = R_EARTH + height;
    const tanT = R_EARTH / Math.sqrt(d * d - R_EARTH * R_EARTH);
    const half = Math.min(W, H) / 2;
    const sil = (tanT / FOV_HALF) * half * 1.05;
    // Close in, the silhouette fit under-zooms badly (a 2.5 km camera saw
    // 200 km). Blend toward the true nadir scale below 1,000 km so a city
    // block reads at street altitude (Moments orbit at 400–700 m).
    const nadir = (R_EARTH / (Math.max(1, height) * FOV_HALF)) * half;
    if (nadir <= sil) return sil;
    const k = Math.min(
      1,
      Math.max(0, Math.log(1000e3 / height) / Math.log(1000e3 / 30e3)),
    );
    return sil * (nadir / sil) ** k;
  };
  function basis() {
    const lo = cam.lon * D2R;
    const la = cam.lat * D2R;
    const fwd = toVec(cam.lon, cam.lat);
    const e = [-Math.sin(lo), Math.cos(lo), 0];
    const nn = [
      -Math.sin(la) * Math.cos(lo),
      -Math.sin(la) * Math.sin(lo),
      Math.cos(la),
    ];
    const h = (cam.heading || 0) * D2R;
    const ch = Math.cos(h);
    const s = Math.sin(h);
    const up = [
      nn[0] * ch + e[0] * s,
      nn[1] * ch + e[1] * s,
      nn[2] * ch + e[2] * s,
    ];
    const right = [
      e[0] * ch - nn[0] * s,
      e[1] * ch - nn[1] * s,
      e[2] * ch - nn[2] * s,
    ];
    return { fwd, up, right };
  }
  let B = basis();
  const centerY = () => H * (options.centerBias ?? 0.5);
  function project(lon, lat, altM = 0) {
    const v = toVec(lon, lat);
    const z = dot(v, B.fwd);
    const k = 1 + altM / R_EARTH;
    if (z < (altM > 0 ? -0.15 : 0.02)) return null;
    const R = radiusPx();
    return {
      x: W / 2 + R * k * dot(v, B.right),
      y: centerY() - R * k * dot(v, B.up),
      z,
    };
  }
  function unproject(x, y) {
    const R = radiusPx();
    const px = (x - W / 2) / R;
    const py = (centerY() - y) / R;
    const r2 = px * px + py * py;
    if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2);
    const n = [0, 1, 2].map(
      (i) => px * B.right[i] + py * B.up[i] + z * B.fwd[i],
    );
    return { lon: Math.atan2(n[1], n[0]) * R2D, lat: Math.asin(n[2]) * R2D };
  }

  const now = () => (timeOverride ? timeOverride.getTime() : Date.now());

  /* ---------- detail imagery ---------- */
  function updateDetail() {
    if (!gl || cam.height > 3200e3) {
      det.target = 0;
      return;
    }
    const R = radiusPx();
    const halfW = Math.min(80, (W / 2 / R) * R2D * 1.25);
    const halfH = Math.min(60, (H / 2 / R) * R2D * 1.25);
    const clat = Math.cos(cam.lat * D2R);
    const box = [
      cam.lon - halfW / Math.max(0.15, clat),
      Math.max(-85, cam.lat - halfH),
      cam.lon + halfW / Math.max(0.15, clat),
      Math.min(85, cam.lat + halfH),
    ];
    const key = box.map((v) => v.toFixed(2)).join(',');
    if (
      det.on > 0.5 &&
      det.box[0] <= box[0] &&
      det.box[2] >= box[2] &&
      det.box[1] <= box[1] &&
      det.box[3] >= box[3] &&
      det.box[2] - det.box[0] < (box[2] - box[0]) * 3
    )
      return;
    if (key === det.key) return;
    det.key = key;
    clearTimeout(det.pending);
    det.pending = setTimeout(() => {
      const pad = 0.15;
      const bw = box[2] - box[0];
      const bh = box[3] - box[1];
      const b = [
        box[0] - bw * pad,
        Math.max(-85, box[1] - bh * pad),
        box[2] + bw * pad,
        Math.min(85, box[3] + bh * pad),
      ];
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${b.map((v) => v.toFixed(5)).join(',')}&bboxSR=4326&imageSR=4326&size=1536,1536&format=jpg&f=image`;
      loadImage(url)
        .then((img) => {
          if (det.key !== key) return;
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, tex.det);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGB,
            gl.RGB,
            gl.UNSIGNED_BYTE,
            img,
          );
          gl.generateMipmap(gl.TEXTURE_2D);
          det.box = b;
          det.on = 0;
          det.target = 1;
          dirty = true;
        })
        .catch(() => {});
    }, 380);
  }

  /* ---------- render loop ---------- */
  let raf = 0;
  let lastOverlay = 0;
  let frames = 0;
  let fpsT = performance.now();
  function frame(ts) {
    raf = 0;
    if (paused) return;
    if (flight) stepFlight(ts);
    if (inertia) stepInertia();
    if (det.on !== det.target) {
      det.on += (det.target - det.on) * 0.12;
      if (Math.abs(det.on - det.target) < 0.01) det.on = det.target;
      dirty = true;
    }
    if (dirty && gl) {
      B = basis();
      gl.viewport(0, 0, canvas.width, canvas.height);
      const R = radiusPx() * dpr;
      gl.uniform2f(U.u_c, (W / 2) * dpr, (H - centerY()) * dpr);
      gl.uniform1f(U.u_R, R);
      gl.uniform2f(U.u_res, canvas.width, canvas.height);
      gl.uniform3fv(U.u_right, B.right);
      gl.uniform3fv(U.u_up, B.up);
      gl.uniform3fv(U.u_fwd, B.fwd);
      gl.uniform3fv(U.u_sun, subsolar(new Date(now())));
      gl.uniform4fv(U.u_box, det.box);
      gl.uniform1f(U.u_detOn, det.on);
      gl.uniform1f(U.u_tex, texOn);
      gl.uniform1f(U.u_nightTex, nightOn);
      gl.uniform1f(U.u_lens, lens);
      // Close in, the 2 km/px night mosaic is mush: fade it for moonlit imagery.
      gl.uniform1f(
        U.u_close,
        Math.max(0, Math.min(1, (900e3 - cam.height) / 700e3)),
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      dirty = false;
    } else if (dirty) {
      B = basis();
      dirty = false;
    }
    if (ts - lastOverlay > 33) {
      lastOverlay = ts;
      drawOverlay(ts);
    }
    frames += 1;
    if (ts - fpsT > 2000) {
      emit('quality', {
        scale: dpr,
        fps: Math.round((frames * 1000) / (ts - fpsT)),
      });
      frames = 0;
      fpsT = ts;
    }
    raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && !paused) raf = requestAnimationFrame(frame);
  };

  const KIND_COLOR = {
    aircraft: '#7CC4FF',
    helicopter: '#7CC4FF',
    ship: '#38E1C6',
    satellite: '#C9A7FF',
    quake: '#FF6A3D',
    fire: '#FF6A3D',
  };
  let drawn = [];
  function drawOverlay(ts) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawn = [];
    const t = now();
    const planetary = cam.height > 2500e3;
    for (const c of contacts) {
      const layer = layerById.get(c.layer);
      if (!layer?.on) continue;
      propagate(c, t0, t);
      const p = project(c.lon, c.lat, c.kind === 'satellite' ? c.altM : 0);
      if (!p || p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20)
        continue;
      const col = KIND_COLOR[c.kind] || '#fff';
      const isSel = selected === c.id;
      ctx.globalAlpha = planetary ? 0.75 : 1;
      if (c.kind === 'aircraft' || c.kind === 'helicopter') {
        if (planetary) {
          ctx.fillStyle = col;
          ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(((c.headingDeg - (cam.heading || 0)) * Math.PI) / 180);
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(0, -6);
          ctx.lineTo(4.2, 5);
          ctx.lineTo(0, 2.6);
          ctx.lineTo(-4.2, 5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      } else if (c.kind === 'satellite') {
        ctx.fillStyle = c.id === 'iss' ? '#fff' : col;
        const s = c.id === 'iss' ? 3.2 : 1.8;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        if (c.id === 'iss') {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6 + Math.sin(ts / 300) * 1.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (c.kind === 'quake') {
        const rr = 3 + (c.mag - 4) * 3.5;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr + ((ts / 40) % 14), 0, Math.PI * 2);
        ctx.globalAlpha = 1 - ((ts / 40) % 14) / 14;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else if (c.kind === 'fire') {
        ctx.fillStyle = 'rgba(255,106,61,0.85)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, planetary ? 1.4 : 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, planetary ? 1 : 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (isSel) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
        ctx.stroke();
        if (c.speed) {
          ctx.strokeStyle = col;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          for (let i = 0; i <= 20; i += 1) {
            const [x, y] = destination(
              c.lon,
              c.lat,
              c.headingDeg + 180,
              c.speed * i * 30,
            );
            const q = project(x, y);
            if (!q) break;
            if (i) ctx.lineTo(q.x, q.y);
            else ctx.moveTo(q.x, q.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      drawn.push({ c, x: p.x, y: p.y });
    }
    if (situations && options.showSituations !== false) {
      for (const s of situations) {
        const p = project(s.lon, s.lat);
        if (!p) continue;
        const col = {
          sky: '#7CC4FF',
          sea: '#38E1C6',
          orbit: '#C9A7FF',
          hazards: '#FF6A3D',
          eyes: '#FFD166',
          ground: '#9BE15D',
          weather: '#8AB4F8',
          infra: '#B8C0CC',
        }[s.family];
        const ph = (((ts / 1600 + s.lon) % 1) + 1) % 1;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 1 - ph;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 + ph * 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(5,7,11,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        drawn.push({ s, x: p.x, y: p.y });
      }
    }
    drawWeather(ts);
    drawPins(ts);
    for (const fn of hooks) {
      try {
        fn(ctx, { project, t, ts, W, H, cam });
      } catch (err) {
        console.warn('[stub] overlay hook failed', err);
        hooks.delete(fn);
      }
    }
  }
  /** Round three: shell overlays (Moment trails, reactions) draw here. */
  const hooks = new Set();

  /* ---------- weather (simulated look of the engine's weather family) ---------- */
  const wx = (() => {
    const rr = rng(7);
    const cells = Array.from({ length: 40 }, () => ({
      lon: -105 + rr() * 30,
      lat: 25 + rr() * 22,
      r: 40e3 + rr() * 160e3,
      v: rr(),
    }));
    const strikes = Array.from({ length: 160 }, () => ({
      lon: -97 + rr() * 14,
      lat: 23 + rr() * 9,
      p: rr(),
    }));
    const streaks = Array.from({ length: 220 }, () => ({
      lon: -180 + rr() * 360,
      lat: -60 + rr() * 130,
      p: rr(),
    }));
    return { cells, strikes, streaks };
  })();
  function drawWeather(ts) {
    const on = (id) => layerById.get(id)?.on;
    const R = radiusPx();
    if (on('weather.radar')) {
      for (const c of wx.cells) {
        const p = project(c.lon, c.lat);
        if (!p) continue;
        const rad = (c.r / R_EARTH) * R;
        for (const [f, col] of [
          [1, 'rgba(40,200,90,0.28)'],
          [0.6, 'rgba(240,220,40,0.34)'],
          [0.3, c.v > 0.6 ? 'rgba(255,70,40,0.5)' : 'rgba(240,220,40,0.2)'],
        ]) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1, rad * f), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (on('weather.lightning')) {
      for (const st of wx.strikes) {
        const p = project(st.lon, st.lat);
        if (!p) continue;
        const flick = Math.sin(ts / 90 + st.p * 50) > 0.6;
        ctx.fillStyle = flick ? '#fff' : 'rgba(200,180,255,0.6)';
        ctx.fillRect(p.x - 1, p.y - 1, flick ? 2.6 : 1.6, flick ? 2.6 : 1.6);
      }
      dirty = true;
    }
    if (on('weather.wind')) {
      ctx.strokeStyle = 'rgba(230,240,255,0.35)';
      ctx.lineWidth = 1;
      for (const st of wx.streaks) {
        const ph = ((ts / 4000 + st.p) % 1) * 6;
        const lon = st.lon + ph;
        const lat = st.lat + Math.sin((st.lon + ph) / 12) * 2;
        const a = project(lon, lat);
        const b = project(lon + 2.2, lat + Math.cos(lon / 12) * 0.5);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      dirty = true;
    }
    if (on('weather.clouds')) {
      ctx.fillStyle = 'rgba(235,240,250,0.07)';
      for (const st of wx.streaks.slice(0, 90)) {
        const p = project(st.lon, st.lat);
        if (!p) continue;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 26, 12, st.p * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ---------- pins (API.md: post / witness / eye / live / hologram) ---------- */
  const pins = new Map();
  const PIN_COLOR = {
    post: '#f4f7fb',
    witness: '#ebc777',
    hologram: '#ebc777',
    live: '#ebc777',
    eye: '#ffb547',
  };
  function drawPins(ts) {
    for (const pin of pins.values()) {
      const p = project(pin.lon, pin.lat, pin.altM || 0);
      if (!p) continue;
      const col = pin.color || PIN_COLOR[pin.kind] || '#fff';
      if (pin.kind === 'live' || pin.kind === 'eye') {
        const hd =
          (((pin.headingDeg ?? 0) - (cam.heading || 0)) * Math.PI) / 180;
        const fov = ((pin.fovDeg ?? 60) * Math.PI) / 180;
        const len = 46;
        const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, len);
        g.addColorStop(0, `${col}aa`);
        g.addColorStop(1, `${col}00`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(
          p.x,
          p.y,
          len,
          hd - Math.PI / 2 - fov / 2,
          hd - Math.PI / 2 + fov / 2,
        );
        ctx.closePath();
        ctx.fill();
        if (pin.kind === 'live') {
          const ph = (ts / 1400) % 1;
          ctx.strokeStyle = col;
          ctx.globalAlpha = 1 - ph;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5 + ph * 14, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          dirty = true;
        }
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (pin.kind === 'post') {
        ctx.fillStyle = 'rgba(10,11,13,0.9)';
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 4, p.y - 6);
        ctx.lineTo(p.x - 9, p.y - 6);
        ctx.arcTo(p.x - 12, p.y - 6, p.x - 12, p.y - 9, 3);
        ctx.lineTo(p.x - 12, p.y - 17);
        ctx.arcTo(p.x - 12, p.y - 20, p.x - 9, p.y - 20, 3);
        ctx.lineTo(p.x + 9, p.y - 20);
        ctx.arcTo(p.x + 12, p.y - 20, p.x + 12, p.y - 17, 3);
        ctx.lineTo(p.x + 12, p.y - 9);
        ctx.arcTo(p.x + 12, p.y - 6, p.x + 9, p.y - 6, 3);
        ctx.lineTo(p.x + 4, p.y - 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = col;
        for (const dx of [-5, 0, 5]) ctx.fillRect(p.x + dx - 1, p.y - 14, 2, 2);
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = col;
        ctx.fillRect(-4.5, -4.5, 9, 9);
        ctx.strokeStyle = 'rgba(5,6,7,0.9)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-4.5, -4.5, 9, 9);
        ctx.restore();
      }
      drawn.push({ pin, x: p.x, y: p.y - (pin.kind === 'post' ? 12 : 0) });
    }
  }

  /* ---------- flights ---------- */
  function stepFlight(ts) {
    const f = flight;
    if (!f.start) f.start = ts;
    const k = Math.min(1, (ts - f.start) / f.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    let dLon = f.to.lon - f.from.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    cam.lon = ((f.from.lon + dLon * e + 540) % 360) - 180;
    cam.lat = f.from.lat + (f.to.lat - f.from.lat) * e;
    const lh0 = Math.log(f.from.height);
    const lh1 = Math.log(f.to.height);
    const hop = Math.log(Math.max(f.from.height, f.to.height, f.peak));
    const lin = lh0 + (lh1 - lh0) * e;
    const arc = Math.sin(Math.PI * e) * Math.max(0, hop - Math.max(lh0, lh1));
    cam.height = Math.exp(lin + arc);
    cam.heading = f.from.heading + (f.to.heading - f.from.heading) * e;
    dirty = true;
    emitCamera();
    if (k >= 1) {
      flight = null;
      updateDetail();
      f.resolve();
    }
  }

  function flyTo({ lon, lat, height, duration } = {}) {
    if (flight) flight.resolve();
    inertia = null;
    const to = {
      lon: lon ?? cam.lon,
      lat: Math.max(-85, Math.min(85, lat ?? cam.lat)),
      height: Math.max(MIN_H, Math.min(MAX_H, height ?? cam.height)),
      // The stub renders top-down; heading is honoured by the real engine.
      heading: 0,
    };
    const dist = haversine(cam.lon, cam.lat, to.lon, to.lat);
    const dur = (duration ?? Math.min(3.2, 1.2 + dist / 6e6)) * 1000;
    return new Promise((resolve) => {
      if (dur <= 16) {
        Object.assign(cam, to);
        dirty = true;
        emitCamera();
        updateDetail();
        kick();
        resolve();
        return;
      }
      flight = {
        from: { ...cam },
        to,
        dur,
        peak: Math.min(MAX_H, dist * 1.4),
        start: 0,
        resolve,
      };
      det.target = cam.height > 3200e3 ? 0 : det.target;
      kick();
    });
  }

  let camTimer = 0;
  function emitCamera() {
    if (camTimer) return;
    camTimer = setTimeout(() => {
      camTimer = 0;
      emit('camera', { lon: cam.lon, lat: cam.lat, height: cam.height });
    }, 80);
  }

  /* ---------- input ---------- */
  const pointers = new Map();
  let inertia = null;
  let lastMove = null;
  let pinch0 = null;
  let downAt = null;
  function onDown(e) {
    root.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    flight = null;
    inertia = null;
    downAt = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), h: cam.height };
    }
    emit('interact', { type: 'start' });
  }
  function onMove(e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (downAt && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 6)
      downAt.moved = true;
    if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.height = Math.max(
        MIN_H,
        Math.min(MAX_H, (pinch0.h * pinch0.d) / Math.max(10, d)),
      );
      dirty = true;
      emitCamera();
      kick();
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    pan(dx, dy);
    const t = performance.now();
    lastMove = { dx, dy, t };
  }
  function pan(dx, dy) {
    const R = radiusPx();
    const clat = Math.max(0.1, Math.cos(cam.lat * D2R));
    cam.lon = ((cam.lon - ((dx / R) * R2D) / clat + 540) % 360) - 180;
    cam.lat = Math.max(-85, Math.min(85, cam.lat + (dy / R) * R2D));
    dirty = true;
    emitCamera();
    kick();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = null;
    if (pointers.size) return;
    if (downAt && !downAt.moved && performance.now() - downAt.t < 400) {
      const rect = root.getBoundingClientRect();
      tapAt(e.clientX - rect.left, e.clientY - rect.top);
    } else if (lastMove && performance.now() - lastMove.t < 60) {
      inertia = { vx: lastMove.dx, vy: lastMove.dy };
      kick();
    }
    updateDetail();
    emit('interact', { type: 'end' });
    downAt = null;
  }
  function stepInertia() {
    inertia.vx *= 0.92;
    inertia.vy *= 0.92;
    pan(inertia.vx, inertia.vy);
    if (Math.hypot(inertia.vx, inertia.vy) < 0.15) {
      inertia = null;
      updateDetail();
    }
  }
  function tapAt(x, y) {
    let best = null;
    let bd = 24;
    for (const d of drawn) {
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (!best) {
      select(null);
      emit('pick', null);
      return;
    }
    if (best.pin) {
      const pn = best.pin;
      emit('pick', {
        kind: 'pin',
        pinKind: pn.kind,
        id: pn.id,
        title: pn.label || pn.kind,
        subtitle: pn.kind,
        lon: pn.lon,
        lat: pn.lat,
        meta: { headingDeg: pn.headingDeg, fovDeg: pn.fovDeg, label: pn.label },
      });
      return;
    }
    if (best.s) {
      const s = best.s;
      emit('pick', {
        kind: 'situation',
        id: s.id,
        title: s.title,
        subtitle: s.place,
        lon: s.lon,
        lat: s.lat,
        meta: { situation: s.id, source: s.source },
      });
      return;
    }
    const c = best.c;
    select(c.id);
    const meta = {};
    if (c.altM)
      meta.altitude =
        c.kind === 'satellite'
          ? `${Math.round(c.altM / 1000)} km`
          : `${Math.round(c.altM * 3.28084).toLocaleString()} ft`;
    if (c.speed)
      meta.speed =
        c.kind === 'ship'
          ? `${(c.speed * 1.944).toFixed(1)} kn`
          : `${Math.round(c.speed * 1.944)} kn`;
    if (c.speed || c.kind === 'satellite')
      meta.heading = `${Math.round(((c.headingDeg % 360) + 360) % 360)}°`;
    meta.source = SIM;
    const sub = {
      aircraft: 'Aircraft',
      helicopter: 'Helicopter',
      ship: 'Vessel',
      satellite: 'Satellite',
      quake: 'Earthquake',
      fire: 'Active fire',
    }[c.kind];
    emit('pick', {
      kind: c.kind,
      id: c.id,
      title: c.title,
      subtitle: `${sub} · simulated`,
      lon: c.lon,
      lat: c.lat,
      meta,
    });
  }
  function onWheel(e) {
    e.preventDefault();
    cam.height = Math.max(
      MIN_H,
      Math.min(MAX_H, cam.height * Math.exp(e.deltaY * 0.0018)),
    );
    dirty = true;
    emitCamera();
    kick();
    clearTimeout(onWheel.t);
    onWheel.t = setTimeout(updateDetail, 200);
  }
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('dblclick', (e) => {
    const rect = root.getBoundingClientRect();
    const g = unproject(e.clientX - rect.left, e.clientY - rect.top);
    if (g) flyTo({ ...g, height: cam.height / 2.5, duration: 0.6 });
  });

  /* ---------- API ---------- */
  function select(id) {
    selected = id;
    kick();
  }
  function setLayer(id, on) {
    const l = layerById.get(id);
    if (!l) return;
    l.on = !!on;
    l.status = on ? 'live' : 'off';
    emit('layers', layers);
    kick();
  }
  const localSeeded = new Set();
  const api = {
    isStub: true,
    flyTo,
    home: () => flyTo({ ...HOME }),
    layers: () => layers.map((l) => ({ ...l })),
    setLayer,
    setFamily(family, on) {
      for (const l of layers)
        if (l.family === family)
          ((l.on = !!on), (l.status = on ? 'live' : 'off'));
      emit('layers', layers);
      kick();
    },
    setTime(date) {
      timeOverride = date ? new Date(date) : null;
      dirty = true;
      kick();
      emit('time', { time: timeOverride });
    },
    timeWindow() {
      const n = Date.now();
      return {
        start: new Date(n - 72 * 3600e3),
        end: new Date(n + 120 * 3600e3),
        now: new Date(n),
      };
    },
    setLens(id) {
      lens = { cinematic: 0, clear: 1, night: 2, thermal: 3, nvg: 4 }[id] ?? 0;
      dirty = true;
      kick();
    },
    async focus(s) {
      if (!s) return;
      for (const id of s.layers || [])
        if (layerById.has(id)) setLayer(id, true);
      if (s.live) api.setTime(null);
      else if (s.time?.end) api.setTime(new Date(s.time.end));
      const c = s.camera || { lon: s.lon, lat: s.lat, height: 400e3 };
      return flyTo({
        lon: c.lon,
        lat: c.lat,
        height: c.height,
        heading: c.heading,
        duration: options.reducedMotion ? 0 : undefined,
      });
    },
    select,
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
    },
    off(ev, fn) {
      listeners.get(ev)?.delete(fn);
    },
    pause() {
      paused = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    resume() {
      paused = false;
      dirty = true;
      kick();
    },
    contactsNear(lon, lat, km) {
      const key = `${lon.toFixed(1)},${lat.toFixed(1)}`;
      if (!localSeeded.has(key)) {
        localSeeded.add(key);
        const rr = rng(Math.floor((lon + 180) * 100 + (lat + 90) * 7));
        for (let i = 0; i < 14; i += 1) {
          const [x, y] = destination(lon, lat, rr() * 360, 4e3 + rr() * 70e3);
          contacts.push({
            kind: 'aircraft',
            layer: 'sky.commercial-flights',
            id: `local-${key}-${i}`,
            title: `${PREFIX[i % PREFIX.length]}${200 + Math.floor(rr() * 7000)}`,
            lon: x,
            lat: y,
            altM: 900 + rr() * 11000,
            headingDeg: rr() * 360,
            speed: 120 + rr() * 120,
          });
        }
        for (let i = 0; i < 3; i += 1) {
          const [x, y] = destination(lon, lat, rr() * 360, 3e3 + rr() * 20e3);
          contacts.push({
            kind: 'ship',
            layer: 'sea.ais-vessels',
            id: `localship-${key}-${i}`,
            title: `${SHIP[i]} ${['Star', 'Bay', 'Trader'][i]}`,
            lon: x,
            lat: y,
            altM: 0,
            headingDeg: rr() * 360,
            speed: 4,
          });
        }
      }
      const t = now();
      const out = [];
      for (const c of contacts) {
        propagate(c, t0, t);
        const d = haversine(lon, lat, c.lon, c.lat);
        const lim =
          c.kind === 'satellite' ? Math.max(km * 1000, 2200e3) : km * 1000;
        if (d <= lim)
          out.push({
            kind: c.kind === 'helicopter' ? 'aircraft' : c.kind,
            id: c.id,
            title: c.title,
            lon: c.lon,
            lat: c.lat,
            altM: c.altM,
            headingDeg: c.headingDeg,
          });
      }
      return out;
    },
    async situations() {
      if (!situations) situations = buildStubSituations(Date.now());
      kick();
      return situations;
    },
    credits() {
      return [
        {
          name: 'Esri World Imagery',
          text: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          url: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9',
        },
        {
          name: 'NASA Black Marble',
          text: 'NASA Earth Observatory / GIBS, VIIRS Black Marble',
          url: 'https://earthdata.nasa.gov/gibs',
        },
        {
          name: 'Simulated contacts',
          text: 'Offline stub engine. Aircraft, ships, satellites and situations here are simulated, not live.',
        },
      ];
    },
    camera: () => ({ ...cam }),
    /* ---- round two (mobile/globe/API.md) ---- */
    setViewer(v) {
      viewer = v && Number.isFinite(v.lat) ? { lon: v.lon, lat: v.lat } : null;
    },
    viewer: () => viewer,
    thumbnail: (s, o) => stubThumbnail(s, o),
    addPin(p) {
      const id = p.id || `pin-${Math.random().toString(36).slice(2, 9)}`;
      pins.set(id, { fovDeg: 60, headingDeg: 0, ...p, id });
      dirty = true;
      kick();
      return id;
    },
    removePin(id) {
      const ok = pins.delete(id);
      dirty = true;
      kick();
      return ok;
    },
    pins: () => [...pins.values()].map((p) => ({ ...p })),
    async nearestEye(lon, lat, km = 50) {
      let best = null;
      for (const c of STUB_CAMS) {
        const d = haversine(lon, lat, c.lon, c.lat) / 1000;
        if (d <= km && (!best || d < best.distanceKm))
          best = { ...c, distanceKm: d, imageUrl: camFrameUrl(c.id) };
      }
      return best;
    },
    eyeFrameUrl: (id) => camFrameUrl(id),
    labels(max = 40) {
      const out = [];
      for (const pin of pins.values()) {
        if (!pin.label) continue;
        const p = project(pin.lon, pin.lat, pin.altM || 0);
        if (!p) continue;
        out.push({
          id: pin.id,
          kind: pin.kind,
          layer: 'pins',
          title: pin.label,
          x: p.x,
          y: p.y,
        });
        if (out.length >= max) break;
      }
      return out;
    },
    /* ---- round three (API.md): native stub pieces; the rest via shim3 ---- */
    _hook(fn) {
      hooks.add(fn);
      kick();
      return () => hooks.delete(fn);
    },
    history() {
      const n = Date.now();
      const pts = contacts.length * 720;
      return {
        start: n - 6 * 3600e3,
        end: n,
        entities: contacts.length,
        points: pts,
      };
    },
    async trackOf(id) {
      const raw = String(id).replace(/^[a-z]+:/, '');
      const c = contacts.find((x) => String(x.id) === raw);
      if (!c) return [];
      const t = Math.max(now(), Date.now());
      const out = [];
      const probe = { ...c, base: c.base, orbit: c.orbit };
      // The simulated recorder: six hours at one point a minute.
      for (let i = 360; i >= 0; i -= 1) {
        const ti = t - i * 60e3;
        propagate(probe, t0, ti);
        out.push({
          t: ti,
          lon: probe.lon,
          lat: probe.lat,
          altM:
            c.kind === 'satellite'
              ? c.altM
              : Math.max(0, (c.altM || 0) + Math.sin(i / 9) * 90),
          headingDeg: probe.headingDeg,
          speed: c.speed,
        });
      }
      propagate(c, t0, t);
      return out;
    },
    /** Next ISS pass over a point: sampled every 30 s for 24 h, el > 10°. */
    _issPass(lon, lat) {
      const iss = contacts.find((c) => c.id === 'iss');
      if (!iss) return null;
      const probe = { ...iss };
      const Re = R_EARTH;
      const elev = (ti) => {
        propagate(probe, t0, ti);
        const d = haversine(lon, lat, probe.lon, probe.lat);
        const th = d / Re;
        return (
          Math.atan2(Math.cos(th) - Re / (Re + iss.altM), Math.sin(th)) * R2D
        );
      };
      const start = Date.now();
      let pass = null;
      for (let ti = start; ti < start + 24 * 3600e3; ti += 30e3) {
        const e = elev(ti);
        if (e > 10 && !pass) pass = { start: ti, max: ti, maxElevationDeg: e };
        else if (pass && e > 10 && e > pass.maxElevationDeg) {
          pass.max = ti;
          pass.maxElevationDeg = e;
        } else if (pass && e <= 10) {
          pass.end = ti;
          break;
        }
      }
      if (pass) pass.maxElevationDeg = Math.round(pass.maxElevationDeg);
      return pass;
    },
    destroy() {
      api.pause();
      ro.disconnect();
      root.remove();
    },
  };
  installRound3(api, { kind: 'stub', historyHours: 6 });
  kick();
  setTimeout(
    () =>
      emit('camera', {
        lon: cam.lon,
        lat: cam.lat,
        height: cam.height,
        heading: 0,
        pitch: -90,
      }),
    0,
  );
  return api;
}
