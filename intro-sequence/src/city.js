import * as THREE from 'three';
import { mulberry32, clamp } from './timeline.js';

// City scenes in a local ENU frame (data in metres, scene units in km;
// three.js x = east, y = up, z = -north). One engine renders every location:
// Esri ground, OSM buildings that rise as the scan passes, road ribbons that
// carry modelled traffic coloured by congestion, cameras, aircraft, transit,
// airports, restricted areas and terrain.

const KM = 0.001;

async function getJSON(p) {
  try {
    const r = await fetch(p);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
async function getBin(p) {
  try {
    const r = await fetch(p);
    return r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}
function loadTex(p) {
  return new Promise((res) =>
    new THREE.TextureLoader().load(
      p,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        res(t);
      },
      undefined,
      () => res(null),
    ),
  );
}

export async function loadCity(slug) {
  const base = `city/${slug}/`;
  const [meta, buildings, roads, extra, cameras, air, transit, vehicles, aeroway, military, peaks, elevMeta, elev, ground] = await Promise.all([
    getJSON(base + 'meta.json'),
    getJSON(base + 'buildings.json'),
    getJSON(base + 'roads.json'),
    getJSON(base + 'extra.json'),
    getJSON(base + 'cameras.json'),
    getJSON(base + 'air.json'),
    getJSON(base + 'transit.json'),
    getJSON(base + 'vehicles.json'),
    getJSON(base + 'aeroway.json'),
    getJSON(base + 'military.json'),
    getJSON(base + 'peaks.json'),
    getJSON(base + 'elev_meta.json'),
    getBin(base + 'elev.f32'),
    loadTex(base + 'ground.jpg'),
  ]);
  return { slug, meta, buildings, roads, extra, cameras, air, transit, vehicles, aeroway, military, peaks, elevMeta, elev: elev ? new Float32Array(elev) : null, ground };
}

// ---------------------------------------------------------------- shared shader bits
const HASH = /* glsl */ `
  float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

function congestionColor() {
  return /* glsl */ `
    vec3 congCol(float c) {
      vec3 g = vec3(0.10, 1.00, 0.45);
      vec3 y = vec3(1.00, 0.80, 0.10);
      vec3 r = vec3(1.00, 0.16, 0.12);
      return c < 0.5 ? mix(g, y, c * 2.0) : mix(y, r, (c - 0.5) * 2.0);
    }
  `;
}

// ---------------------------------------------------------------- ground
function makeGround(d, half, elevGeo) {
  const size = 2 * half * KM;
  const geo = elevGeo || new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: d.ground },
      uReveal: { value: 0 },
      uT: { value: 0 },
      uHalf: { value: half * KM },
      uNight: { value: 0.55 },
      uTerrain: { value: elevGeo ? 1 : 0 },
      uScan: { value: -10 },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aElev;
      varying vec2 vUv;
      varying vec3 vP;
      varying float vElev;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vP = position;
        vElev = aElev;
        vN = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uReveal, uT, uHalf, uNight, uTerrain, uScan, uFade;
      varying vec2 vUv;
      varying vec3 vP;
      varying float vElev;
      varying vec3 vN;
      void main() {
        vec3 img = texture2D(uTex, vUv).rgb;
        float l = dot(img, vec3(0.3, 0.59, 0.11));
        // night grade: cool, dim, contrasty — real pixels, but the city's lights do the talking
        vec3 night = pow(mix(vec3(l), img, 0.35), vec3(1.7)) * vec3(0.5, 0.7, 0.95) * 0.56;
        float r = length(vP.xz) / uHalf;
        float rev = smoothstep(uReveal, uReveal - 0.08, r);
        // tactical grid: 100 m, brighter every km
        vec2 g = vP.xz * 1000.0;
        vec2 fw = fwidth(g);
        vec2 gl = abs(fract(g / 100.0 - 0.5) - 0.5) * 100.0 / fw;
        float grid = 1.0 - smoothstep(0.0, 1.0, min(gl.x, gl.y));
        vec2 gk = abs(fract(g / 1000.0 - 0.5) - 0.5) * 1000.0 / fw;
        float gridK = 1.0 - smoothstep(0.0, 1.3, min(gk.x, gk.y));
        vec3 col = night * rev;
        col += vec3(0.0, 0.55, 0.7) * (grid * 0.05 + gridK * 0.14) * (0.4 + 0.6 * rev);
        // the scan front
        float ring = exp(-pow((r - uReveal) * 60.0, 2.0));
        col += vec3(0.2, 0.9, 1.0) * ring * 0.6;
        if (uTerrain > 0.5) {
          // terrain: sunlit relief, 100 m contours, a LiDAR line sweeping across
          vec3 L = normalize(vec3(-0.5, 0.7, 0.4));
          float sh = clamp(dot(normalize(vN), L), 0.0, 1.0);
          vec3 tg = pow(mix(vec3(l), img, 0.5), vec3(1.35));
          col = tg * (0.08 + 0.62 * sh) * vec3(0.62, 0.78, 1.0) * rev;
          float ce = vElev / 100.0;
          float cw = fwidth(ce);
          float cont = 1.0 - smoothstep(0.0, 1.2 * cw, abs(fract(ce - 0.5) - 0.5));
          float major = 1.0 - smoothstep(0.0, 1.2 * fwidth(vElev / 500.0), abs(fract(vElev / 500.0 - 0.5) - 0.5));
          col += vec3(0.1, 0.8, 1.0) * (cont * 0.16 + major * 0.5) * rev;
          float sweep = exp(-pow((vP.x - uScan) * 18.0, 2.0));
          col += vec3(0.4, 1.0, 1.0) * sweep * 0.9;
          col += vec3(0.0, 0.6, 0.8) * smoothstep(uScan, uScan - 3.0, vP.x) * 0.03 * step(vP.x, uScan);
        }
        float edge = smoothstep(1.0, 0.82, max(abs(vP.x), abs(vP.z)) / uHalf);
        gl_FragColor = vec4(col * edge * uFade, 1.0);
      }
    `,
  });
  // the ground never writes depth: it is the base layer, and road ribbons a
  // metre above it would otherwise lose the depth test at city distances
  if (!elevGeo) mat.depthWrite = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

function makeTerrainGeo(d, half) {
  const n = d.elevMeta?.size || 1024;
  const seg = 384;
  const size = 2 * half * KM;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const el = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const px = Math.min(n - 1, Math.max(0, Math.round(u * (n - 1))));
    const py = Math.min(n - 1, Math.max(0, Math.round((1 - v) * (n - 1))));
    const h = d.elev[py * n + px];
    el[i] = h;
    pos.setY(i, h * KM);
  }
  geo.setAttribute('aElev', new THREE.BufferAttribute(el, 1));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- buildings
function makeBuildings(list) {
  const P = [];
  const UV = [];
  const A = []; // height m, edge length m, dist km, rand
  const idx = [];
  let vi = 0;
  const rnd = mulberry32(5);
  const rings = [];
  for (const b of list) {
    const h = Math.max(4, Math.min(560, b[0] || 10));
    const pts = [];
    for (let i = 2; i < b.length - 1; i += 2) pts.push([b[i], b[i + 1]]);
    if (pts.length < 3) continue;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;
    const dist = Math.hypot(cx, cy) * KM;
    const r = rnd();
    // walls
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (L < 0.3) continue;
      P.push(x1 * KM, 0, -y1 * KM, x2 * KM, 0, -y2 * KM, x2 * KM, h * KM, -y2 * KM, x1 * KM, h * KM, -y1 * KM);
      UV.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let k = 0; k < 4; k++) A.push(h, L, dist, r);
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
    // roof
    const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    let tris = [];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      tris = [];
    }
    const base = vi;
    for (const p of pts) {
      P.push(p[0] * KM, h * KM, -p[1] * KM);
      UV.push(-1, 1); // u < 0 marks roof
      A.push(h, 0, dist, r);
      vi++;
    }
    for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
    rings.push({ pts, h, dist });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setAttribute('aB', new THREE.Float32BufferAttribute(A, 4));
  geo.setIndex(vi > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uReveal: { value: 0 }, uT: { value: 0 }, uAlpha: { value: 1 }, uTint: { value: new THREE.Color('#38e8ff') } },
    vertexShader: /* glsl */ `
      attribute vec4 aB;
      uniform float uReveal;
      varying vec2 vUv;
      varying vec4 vB;
      varying vec3 vW;
      varying float vRise;
      void main() {
        vUv = uv;
        vB = aB;
        float k = clamp((uReveal - aB.z) / 0.35, 0.0, 1.0);
        float rise = 1.0 - pow(1.0 - k, 3.0);
        vRise = k;
        vec3 p = position;
        p.y *= rise;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${HASH}
      uniform float uReveal, uT, uAlpha;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying vec4 vB;
      varying vec3 vW;
      varying float vRise;
      void main() {
        if (vRise <= 0.0) discard;
        float h = vB.x;
        float L = vB.y;
        bool roof = vUv.x < -0.5;
        vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
        float lit = 0.35 + 0.65 * abs(dot(N, normalize(vec3(0.4, 0.8, 0.3))));
        float tall = smoothstep(30.0, 250.0, h);
        vec3 base = mix(vec3(0.010, 0.016, 0.026), vec3(0.016, 0.032, 0.05), tall) * lit;
        vec3 col = base;
        float fresh = exp(-max(uReveal - vB.z, 0.0) * 5.0);
        if (roof) {
          col = base * 1.3 + uTint * 0.02;
        } else {
          // floors and windows
          float fy = vUv.y * h / 3.4;
          float fx = vUv.x * L / 3.2;
          vec2 cell = floor(vec2(fx, fy));
          vec2 f = fract(vec2(fx, fy));
          float win = step(0.25, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.75);
          float on = step(0.9, h21(cell + vB.w * 91.0));
          float warm = h21(cell * 1.7 + 3.0);
          vec3 wc = mix(vec3(1.0, 0.75, 0.45), vec3(0.6, 0.9, 1.0), step(0.7, warm));
          float flick = 0.85 + 0.15 * sin(uT * 2.0 + h21(cell) * 40.0);
          col += wc * win * on * 0.32 * flick * smoothstep(0.0, 0.1, vRise);
          // edges: crown line, vertical corners, base
          float wy = fwidth(vUv.y);
          float wx = fwidth(vUv.x);
          float crown = 1.0 - smoothstep(0.0, wy * 1.5, 1.0 - vUv.y);
          float corner = 1.0 - smoothstep(0.0, wx * 1.5, min(vUv.x, 1.0 - vUv.x));
          col += uTint * (crown * (0.08 + tall * 0.9) + corner * (0.03 + tall * 0.12)) * (0.6 + fresh * 2.5);
          // the scan passing up the facade as it rises
          col += uTint * fresh * 0.25 * smoothstep(0.2, 1.0, vUv.y);
        }
        gl_FragColor = vec4(col * uAlpha, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, count: rings.length, rings };
}

// ---------------------------------------------------------------- roads + traffic
// Congestion is modelled, not measured: road class, distance to the core, and
// a slow per-road noise. Labelled MODELED in the HUD.
function makeRoads(list, half, { tint = null, inside = null, scale = 1 } = {}) {
  const W = [34, 24, 20, 16, 11, 7];
  const P = [];
  const A = []; // arc m, side, cong, oneway
  const B = []; // class, rnd, width
  const idx = [];
  let vi = 0;
  const rnd = mulberry32(17);
  let segs = 0;
  for (const r of list) {
    const cls = r[0];
    const one = r[1] ? 1 : 0;
    const pts = [];
    for (let i = 3; i < r.length - 1; i += 2) pts.push([r[i], r[i + 1]]);
    if (pts.length < 2) continue;
    if (inside && !inside(pts[0][0], pts[0][1])) continue;
    const w = W[cls] ?? 6;
    const cx = pts[Math.floor(pts.length / 2)];
    const core = Math.exp(-Math.hypot(cx[0], cx[1]) / (half * 0.55));
    const base = [0.55, 0.5, 0.42, 0.35, 0.22, 0.3][cls] ?? 0.3;
    const rr = rnd();
    const cong = clamp(base * 0.55 + core * 0.55 + (rr - 0.5) * 0.95, 0, 1);
    let arc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (L < 0.5) continue;
      const nx = -(y2 - y1) / L;
      const ny = (x2 - x1) / L;
      const hw = w / 2;
      const y = 0.6 + cls * 0.02;
      const v = [
        [x1 - nx * hw, y1 - ny * hw, -1, arc],
        [x1 + nx * hw, y1 + ny * hw, 1, arc],
        [x2 + nx * hw, y2 + ny * hw, 1, arc + L],
        [x2 - nx * hw, y2 - ny * hw, -1, arc + L],
      ];
      for (const [x, yy, s, a] of v) {
        P.push(x * KM, y * KM, -yy * KM);
        A.push(a, s, cong, one);
        B.push(cls, rr, w);
      }
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
      arc += L;
      segs++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('aA', new THREE.Float32BufferAttribute(A, 4));
  geo.setAttribute('aC', new THREE.Float32BufferAttribute(B, 3));
  geo.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uT: { value: 0 },
      uReveal: { value: 0 },
      uHalf: { value: half * KM },
      uAlpha: { value: 1 },
      uTint: { value: tint ? new THREE.Color(tint) : new THREE.Color(0, 0, 0) },
      uUseTint: { value: tint ? 1 : 0 },
      uScale: { value: scale },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aA;
      attribute vec3 aC;
      varying vec4 vA;
      varying vec3 vC;
      varying float vR;
      void main() {
        vA = aA;
        vC = aC;
        vR = length(position.xz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${HASH}
      ${congestionColor()}
      uniform float uT, uReveal, uHalf, uAlpha, uUseTint, uScale;
      uniform vec3 uTint;
      varying vec4 vA;
      varying vec3 vC;
      varying float vR;
      void main() {
        float r = vR / uHalf;
        float k = uReveal - r;
        if (k < 0.0) discard;
        float cong = vA.z;
        float side = vA.y;
        float dir = vA.w > 0.5 ? 1.0 : (side > 0.0 ? 1.0 : -1.0);
        vec3 cc = mix(congCol(cong), uTint, uUseTint);
        // ribbon cross-profile: soft edges, dark median
        float a = abs(side);
        float body = smoothstep(1.0, 0.7, a);
        // cars: dashes flowing along each lane, slower and denser when jammed
        float speed = mix(16.0, 2.5, cong) * 7.0 * uScale;
        float spacing = mix(70.0, 14.0, cong);
        float lane = vA.w > 0.5 ? 1.0 : smoothstep(0.05, 0.3, a) * smoothstep(0.98, 0.7, a);
        float ph = (vA.x - dir * uT * speed) / spacing + vC.y * 13.0 + (side > 0.0 ? 0.37 : 0.0);
        float fp = fract(ph);
        float car = smoothstep(0.0, 0.04, fp) * (1.0 - smoothstep(0.08, 0.22, fp));
        float present = step(0.25 + 0.5 * (1.0 - cong), h11(floor(ph) + vC.y * 77.0));
        float head = car * present * lane;
        vec3 carCol = dir > 0.0 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.25, 0.2);
        vec3 col = cc * body * (0.2 + 0.12 * cong) + mix(cc, carCol, 0.22) * head * 1.25;
        float fresh = exp(-k * 25.0);
        col += cc * fresh * 0.8 * body;
        gl_FragColor = vec4(col * uAlpha, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, segs };
}

// ---------------------------------------------------------------- lines (generic, glowing)
function makePolylines(lines, { color = '#38e8ff', y = 1, width = 0, alpha = 1, colors = null } = {}) {
  const P = [];
  const C = [];
  const A = [];
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    const col = new THREE.Color(colors ? colors[li] : color);
    let arc = 0;
    for (let i = 0; i < l.length - 1; i++) {
      const [x1, y1, z1 = y] = l[i];
      const [x2, y2, z2 = y] = l[i + 1];
      const L = Math.hypot(x2 - x1, y2 - y1);
      P.push(x1 * KM, z1 * KM, -y1 * KM, x2 * KM, z2 * KM, -y2 * KM);
      C.push(col.r, col.g, col.b, col.r, col.g, col.b);
      A.push(arc, arc + L);
      arc += L;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setAttribute('aArc', new THREE.Float32BufferAttribute(A, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uT: { value: 0 }, uAlpha: { value: alpha }, uDraw: { value: 1e9 }, uPulse: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aArc;
      varying float vArc;
      varying vec3 vCol;
      void main() { vArc = aArc; vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT, uAlpha, uDraw, uPulse;
      varying float vArc;
      varying vec3 vCol;
      void main() {
        if (vArc > uDraw) discard;
        float p = uPulse > 0.0 ? pow(fract(vArc / 900.0 - uT * 0.8), 8.0) * 2.0 : 0.0;
        gl_FragColor = vec4(vCol * (0.7 + p) * uAlpha, 1.0);
      }
    `,
  });
  return new THREE.LineSegments(geo, mat);
}

// glowing point sprites updated from the CPU
function makePoints(n, { size = 6, color = '#ffffff' } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const sz = new Float32Array(n).fill(1);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aS', new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uSize: { value: size }, uAlpha: { value: 1 }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aS;
      uniform float uSize, uPx;
      varying vec3 vCol;
      void main() { vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize * aS * uPx; }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying vec3 vCol;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        float core = smoothstep(0.35, 0.0, r);
        gl_FragColor = vec4((vCol * a * 0.8 + vec3(1.0) * core) * uAlpha, 1.0);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, pos, col, sz, geo };
}

// ---------------------------------------------------------------- the engine
export function buildCity(d, opts = {}) {
  const half = d.meta?.half || 3500;
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const out = { scene, d, half, labels: [], stats: {} };

  const terrainGeo = d.elev ? makeTerrainGeo(d, half) : null;
  const ground = makeGround(d, half, terrainGeo);
  group.add(ground);
  out.ground = ground;
  if (d.elev) {
    out.elevAt = (x, y) => {
      const n = d.elevMeta?.size || 1024;
      const px = Math.round(((x + half) / (2 * half)) * (n - 1));
      const py = Math.round(((half - y) / (2 * half)) * (n - 1));
      return d.elev[clamp(py, 0, n - 1) * n + clamp(px, 0, n - 1)] || 0;
    };
  }

  if (d.buildings?.b?.length) {
    const bl = makeBuildings(d.buildings.b);
    group.add(bl.mesh);
    out.buildings = bl;
    out.stats.buildings = bl.count;
  }

  // military polygons: roads inside get the amber treatment
  let insideMil = null;
  if (d.military?.military?.length) {
    const polys = d.military.military.map((m) => {
      const pts = [];
      for (let i = 1; i < m.length - 1; i += 2) pts.push([m[i], m[i + 1]]);
      return { name: m[0], pts };
    }).filter((p) => p.pts.length > 2 && p.pts.every(([x, y]) => Math.abs(x) < half * 1.35 && Math.abs(y) < half * 1.35));
    // the reservation itself is bigger than the scene: keep what fits
    out.milPolys = polys;
    insideMil = (x, y) => polys.some((p) => pip(x, y, p.pts));
  }

  if (d.roads?.roads?.length) {
    const rd = makeRoads(d.roads.roads, half);
    group.add(rd.mesh);
    out.roads = rd;
    out.stats.roads = rd.segs;
    if (insideMil) {
      const conv = makeRoads(d.roads.roads, half, { tint: '#ffb547', inside: insideMil, scale: 0.6 });
      conv.mesh.material.uniforms.uAlpha.value = 0.9;
      group.add(conv.mesh);
      out.convoy = conv;
    }
  }

  // restricted areas: translucent curtains with scanning bands
  if (out.milPolys) {
    const P = [];
    const U = [];
    for (const p of out.milPolys) {
      let arc = 0;
      for (let i = 0; i < p.pts.length; i++) {
        const [x1, y1] = p.pts[i];
        const [x2, y2] = p.pts[(i + 1) % p.pts.length];
        const L = Math.hypot(x2 - x1, y2 - y1);
        const H = 0.35;
        P.push(x1 * KM, 0, -y1 * KM, x2 * KM, 0, -y2 * KM, x2 * KM, H, -y2 * KM, x1 * KM, 0, -y1 * KM, x2 * KM, H, -y2 * KM, x1 * KM, H, -y1 * KM);
        U.push(arc, 0, arc + L, 0, arc + L, 1, arc, 0, arc + L, 1, arc, 1);
        arc += L;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uAlpha;
        varying vec2 vUv;
        void main() {
          float band = pow(fract(vUv.y * 6.0 - uT * 0.6), 6.0);
          float top = 1.0 - smoothstep(0.0, 0.04, 1.0 - vUv.y);
          float fade = 1.0 - vUv.y;
          float hatch = step(0.5, fract((vUv.x / 60.0 + vUv.y * 4.0)));
          vec3 c = vec3(1.0, 0.62, 0.18) * (fade * 0.10 + band * 0.25 + top * 0.8 + hatch * fade * 0.03);
          gl_FragColor = vec4(c * uAlpha, 1.0);
        }
      `,
    });
    out.curtain = new THREE.Mesh(g, m);
    out.curtain.frustumCulled = false;
    group.add(out.curtain);
  }

  // airport: runways, approach strobes, taxiways
  const aw = d.aeroway || d.military;
  if (aw?.runways?.length) {
    const P = [];
    const U = [];
    const strobes = [];
    for (const rw of aw.runways) {
      const w = Math.max(30, rw[0] || 45);
      const pts = [];
      for (let i = 2; i < rw.length - 1; i += 2) pts.push([rw[i], rw[i + 1]]);
      if (pts.length < 2) continue;
      const [x1, y1] = pts[0];
      const [x2, y2] = pts[pts.length - 1];
      const L = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / L;
      const uy = (y2 - y1) / L;
      const nx = -uy * w / 2;
      const ny = ux * w / 2;
      const q = [[x1 - nx, y1 - ny, 0, 0], [x1 + nx, y1 + ny, 1, 0], [x2 + nx, y2 + ny, 1, L], [x1 - nx, y1 - ny, 0, 0], [x2 + nx, y2 + ny, 1, L], [x2 - nx, y2 - ny, 0, L]];
      for (const [x, y, s, a] of q) {
        P.push(x * KM, 0.0012, -y * KM);
        U.push(s, a);
      }
      // approach lighting: 900 m of strobes off each threshold
      for (const [sx, sy, dx, dy] of [[x1, y1, -ux, -uy], [x2, y2, ux, uy]]) {
        for (let k = 1; k <= 30; k++) strobes.push([sx + dx * k * 30, sy + dy * k * 30, k]);
      }
      out.labels.push({ kind: 'runway', x: (x1 + x2) / 2, y: (y1 + y2) / 2, text: `RWY ${rw[1] || ''}`.trim() });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uAlpha: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uAlpha;
        varying vec2 vUv;
        void main() {
          float edge = 1.0 - smoothstep(0.0, 0.06, min(vUv.x, 1.0 - vUv.x));
          float cl = (1.0 - smoothstep(0.0, 0.03, abs(vUv.x - 0.5))) * step(0.5, fract(vUv.y / 60.0));
          vec3 c = vec3(0.9, 0.95, 1.0) * (edge * 0.9 + cl * 0.7) + vec3(0.05, 0.08, 0.1);
          gl_FragColor = vec4(c * uAlpha, 1.0);
        }
      `,
    });
    out.runways = new THREE.Mesh(g, m);
    out.runways.frustumCulled = false;
    group.add(out.runways);
    out.strobes = makePoints(strobes.length, { size: 5, color: '#ffffff' });
    strobes.forEach((s, i) => out.strobes.pos.set([s[0] * KM, 0.004, -s[1] * KM], i * 3));
    out.strobeK = strobes.map((s) => s[2]);
    out.strobes.geo.getAttribute('position').needsUpdate = true;
    group.add(out.strobes.pts);
  }
  if (aw?.taxiways?.length) {
    const lines = aw.taxiways.map((t) => {
      const pts = [];
      for (let i = 0; i < t.length - 1; i += 2) pts.push([t[i], t[i + 1], 1.2]);
      return pts;
    });
    out.taxi = makePolylines(lines, { color: '#ffc04a', alpha: 0.75 });
    group.add(out.taxi);
  }
  if (aw?.aprons?.length) {
    const lines = aw.aprons.map((t) => {
      const pts = [];
      for (let i = 0; i < t.length - 1; i += 2) pts.push([t[i], t[i + 1], 1]);
      if (pts.length) pts.push(pts[0]);
      return pts;
    });
    out.aprons = makePolylines(lines, { color: '#2fd0ff', alpha: 0.4 });
    group.add(out.aprons);
  }

  // transit: route-coloured lines with pulses, vehicles riding them
  if (d.transit?.shapes?.length) {
    const lines = [];
    const colors = [];
    out.shapes = [];
    for (const s of d.transit.shapes) {
      const rid = s[0];
      const route = d.transit.routes[rid] || {};
      const pts = [];
      for (let i = 1; i < s.length - 1; i += 2) pts.push([s[i], s[i + 1], route.type === 3 ? 2 : 6]);
      const col = route.color ? (route.color.startsWith('#') ? route.color : '#' + route.color) : '#38e8ff';
      // subway and rail glow brighter than buses
      lines.push(pts);
      colors.push(route.type === 3 ? new THREE.Color(col).multiplyScalar(0.45).getStyle() : col);
      out.shapes.push({ rid, pts, type: route.type });
    }
    out.transitLines = makePolylines(lines, { colors });
    out.transitLines.material.uniforms.uPulse.value = 1;
    group.add(out.transitLines);
    out.stats.routes = Object.keys(d.transit.routes).length;
  }
  if (d.vehicles?.v?.length) {
    const vs = d.vehicles.v;
    out.veh = makePoints(vs.length, { size: 9 });
    vs.forEach((v, i) => {
      const r = d.transit?.routes?.[v[4]];
      const c = new THREE.Color(r?.color ? (r.color.startsWith('#') ? r.color : '#' + r.color) : '#ffffff');
      out.veh.col.set([c.r, c.g, c.b], i * 3);
      out.veh.sz[i] = r?.type === 3 ? 0.65 : 1.2;
    });
    out.veh.geo.getAttribute('color').needsUpdate = true;
    out.veh.geo.getAttribute('aS').needsUpdate = true;
    group.add(out.veh.pts);
    out.stats.vehicles = vs.length;
  }

  // street cameras: beams + base rings
  if (d.cameras?.length) {
    const lines = d.cameras.map((c) => [[c[0], c[1], 0], [c[0], c[1], 90]]);
    out.camBeams = makePolylines(lines, { color: '#eafcff', alpha: 0.5 });
    group.add(out.camBeams);
    out.camPts = makePoints(d.cameras.length, { size: 7, color: '#bff6ff' });
    d.cameras.forEach((c, i) => out.camPts.pos.set([c[0] * KM, 0.09, -c[1] * KM], i * 3));
    out.camPts.geo.getAttribute('position').needsUpdate = true;
    group.add(out.camPts.pts);
    out.stats.cameras = d.cameras.length;
  }

  // aircraft (real ADS-B): glyphs + real track history
  if (d.air?.a?.length) {
    const a = d.air.a;
    out.airPts = makePoints(a.length + 8, { size: 8, color: '#ffffff' });
    a.forEach((p, i) => {
      const heli = p[8] === 'A7' || /^(H|EC|AS|S7|S9|B06|B407|B429|A109|A119|A139|R44|R66|EC|H1|H6)/.test(p[7] || '');
      const mil = /^(RCH|CNV|PAT|EVAC|TOPCT|HKY|SPAR|SAM)/.test(p[6] || '');
      const c = new THREE.Color(heli ? '#7dffd6' : mil ? '#ffb547' : '#ffffff');
      out.airPts.col.set([c.r, c.g, c.b], i * 3);
      p.heli = heli;
    });
    out.airPts.geo.getAttribute('color').needsUpdate = true;
    group.add(out.airPts.pts);
    const tr = d.air.tracks || {};
    const tl = Object.values(tr).filter((t) => t.length > 1).map((t) => t.map((q) => [q[0], q[1], q[2] * 1.5]));
    if (tl.length) {
      out.airTracks = makePolylines(tl.map((t) => t.filter((q) => Math.abs(q[0]) < half * 1.2 && Math.abs(q[1]) < half * 1.2)).filter((t) => t.length > 1), { color: '#9fe8ff', alpha: 0.3 });
      group.add(out.airTracks);
    }
    out.stats.aircraft = a.length;
    out.stats.helis = a.filter((p) => p.heli).length;
  }

  // modelled extras (labelled MODELED): helicopter tours, circuits
  out.modeled = [];
  if (opts.modeled) for (const m of opts.modeled) out.modeled.push(m);
  if (out.modeled.length) {
    out.modPts = makePoints(out.modeled.length, { size: 9, color: '#7dffd6' });
    out.modeled.forEach((m, i) => {
      const c = new THREE.Color(m.color || '#7dffd6');
      out.modPts.col.set([c.r, c.g, c.b], i * 3);
    });
    out.modPts.geo.getAttribute('color').needsUpdate = true;
    group.add(out.modPts.pts);
    out.modTrails = makePolylines(out.modeled.map((m) => m.path.concat([m.path[0]])), { color: '#7dffd6', alpha: 0.25 });
    out.modTrails.material.vertexColors = true;
    group.add(out.modTrails);
  }

  // ---------------------------------------------------------------- per-frame
  out.update = (lt, k, pxScale = 1) => {
    // lt: seconds into this scene; k: 0..1 progress
    const reveal = Math.min(1.6, 0.22 + lt * 1.05);
    ground.material.uniforms.uReveal.value = reveal * 1.3;
    ground.material.uniforms.uT.value = lt;
    if (d.elev) ground.material.uniforms.uScan.value = -half * KM + ((lt * 0.35) % 1.2) * 2.4 * half * KM;
    if (out.buildings) {
      out.buildings.mesh.material.uniforms.uReveal.value = reveal * half * KM * 0.9;
      out.buildings.mesh.material.uniforms.uT.value = lt;
    }
    if (out.roads) {
      out.roads.mesh.material.uniforms.uReveal.value = reveal * 1.1;
      out.roads.mesh.material.uniforms.uT.value = lt;
    }
    if (out.convoy) {
      out.convoy.mesh.material.uniforms.uReveal.value = reveal * 1.1;
      out.convoy.mesh.material.uniforms.uT.value = lt;
    }
    if (out.curtain) {
      out.curtain.material.uniforms.uT.value = lt;
      out.curtain.material.uniforms.uAlpha.value = clamp((lt - 0.6) * 1.5);
    }
    if (out.runways) out.runways.material.uniforms.uAlpha.value = clamp(lt * 1.2);
    if (out.strobes) {
      // the "rabbit": a pulse running in toward each threshold, twice a second
      const ph = (lt * 2) % 1;
      out.strobeK.forEach((kk, i) => (out.strobes.sz[i] = Math.abs((1 - kk / 30) - ph) < 0.05 ? 2.2 : 0.35));
      out.strobes.geo.getAttribute('aS').needsUpdate = true;
      out.strobes.pts.material.uniforms.uPx.value = pxScale;
    }
    if (out.transitLines) {
      out.transitLines.material.uniforms.uT.value = lt;
      out.transitLines.material.uniforms.uDraw.value = lt * 9000;
    }
    if (out.veh) {
      const vs = d.vehicles.v;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        // dead-reckon along the reported bearing at the reported speed, sped up
        const sp = Math.max(4, v[3] || 8) * 6;
        const b = ((v[2] || 0) * Math.PI) / 180;
        const x = v[0] + Math.sin(b) * sp * lt;
        const y = v[1] + Math.cos(b) * sp * lt;
        out.veh.pos.set([x * KM, 0.012, -y * KM], i * 3);
      }
      out.veh.geo.getAttribute('position').needsUpdate = true;
      out.veh.pts.material.uniforms.uAlpha.value = clamp((lt - 0.8) * 2);
      out.veh.pts.material.uniforms.uPx.value = pxScale;
    }
    if (out.camPts) {
      out.camPts.pts.material.uniforms.uAlpha.value = clamp((lt - 0.9) * 2);
      out.camBeams.material.uniforms.uAlpha.value = clamp((lt - 0.9) * 2) * 0.45;
      out.camPts.pts.material.uniforms.uPx.value = pxScale;
    }
    if (out.airPts) {
      const a = d.air.a;
      for (let i = 0; i < a.length; i++) {
        const p = a[i];
        const b = ((p[3] || 0) * Math.PI) / 180;
        const sp = (p[4] || 0) * 3;
        const x = p[0] + Math.sin(b) * sp * lt;
        const y = p[1] + Math.cos(b) * sp * lt;
        const z = Math.max(0, (p[2] || 0) + (p[5] || 0) * 3 * lt) * 1.5;
        out.airPts.pos.set([x * KM, z * KM + 0.004, -y * KM], i * 3);
        p.now = [x, y, z];
      }
      out.airPts.geo.getAttribute('position').needsUpdate = true;
      out.airPts.pts.material.uniforms.uAlpha.value = clamp((lt - 0.5) * 2);
      out.airPts.pts.material.uniforms.uPx.value = pxScale;
      if (out.airTracks) out.airTracks.material.uniforms.uAlpha.value = clamp((lt - 0.5) * 2) * 0.4;
    }
    if (out.modPts) {
      out.modeled.forEach((m, i) => {
        const p = pathAt(m.path, (lt * m.speed + m.phase) % 1);
        out.modPts.pos.set([p[0] * KM, p[2] * KM, -p[1] * KM], i * 3);
        m.now = p;
      });
      out.modPts.geo.getAttribute('position').needsUpdate = true;
      out.modPts.pts.material.uniforms.uAlpha.value = clamp((lt - 0.7) * 2);
      out.modPts.pts.material.uniforms.uPx.value = pxScale;
      out.modTrails.material.uniforms.uAlpha.value = clamp((lt - 0.7) * 2) * 0.22;
    }
    if (out.taxi) out.taxi.material.uniforms.uAlpha.value = clamp((lt - 0.4) * 2) * 0.7;
    if (out.aprons) out.aprons.material.uniforms.uAlpha.value = clamp((lt - 0.4) * 2) * 0.35;
  };
  return out;
}

function pathAt(path, f) {
  const n = path.length;
  const x = f * n;
  const i = Math.floor(x) % n;
  const j = (i + 1) % n;
  const u = x - Math.floor(x);
  const a = path[i];
  const b = path[j];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * u];
}

function pip(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// An ellipse/loop path in metres, for modelled helicopter tours and circuits.
export function loopPath(cx, cy, rx, ry, alt, rot = 0, n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot), alt]);
  }
  return out;
}
