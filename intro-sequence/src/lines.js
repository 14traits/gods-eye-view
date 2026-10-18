import * as THREE from 'three';
import { llToVec, angDist, destination, bearing, D2R } from './geo.js';
import { mulberry32 } from './timeline.js';

// Line layers that reveal along a scalar "arrival" attribute (radians from the
// seed, or arc length), with a hot tip at the front and a configurable wake.
export function frontLineMaterial({ color, alpha = 1, after = 0.25, tip = 3.0, decay = 4.0, additive = true }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uFront: { value: -1 },
      uAlpha: { value: alpha },
      uAfter: { value: after },
      uTip: { value: tip },
      uDecay: { value: decay },
      uFadeBack: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aDist;
      varying float vDist;
      varying float vFacing;
      void main() {
        vDist = aDist;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(wp.xyz);
        vFacing = dot(n, normalize(cameraPosition - wp.xyz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFront, uAlpha, uAfter, uTip, uDecay, uFadeBack;
      varying float vDist;
      varying float vFacing;
      void main() {
        float behind = uFront - vDist;
        if (behind < 0.0) discard;
        float a = uAfter + (1.0 - uAfter) * exp(-behind * uDecay);
        float hot = exp(-behind * 60.0) * uTip;
        float back = mix(1.0, smoothstep(-0.15, 0.25, vFacing), uFadeBack);
        vec3 c = uColor * (a + hot) + vec3(1.0) * hot * 0.6;
        gl_FragColor = vec4(c * uAlpha * back, 1.0);
      }
    `,
  });
}

function segmentsFromPolylines(lines, r, distFn) {
  const pos = [];
  const dist = [];
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [lo1, la1] = line[i];
      const [lo2, la2] = line[i + 1];
      if (Math.abs(lo2 - lo1) > 180) continue; // antimeridian jump
      llToVec(lo1, la1, r, a);
      llToVec(lo2, la2, r, b);
      pos.push(...a, ...b);
      dist.push(distFn(lo1, la1, i, line), distFn(lo2, la2, i + 1, line));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  return g;
}

export function createCoastline(lines, seedLL, color = '#3ff0ff') {
  const g = segmentsFromPolylines(lines, 1.0008, (lo, la) => angDist(seedLL[0], seedLL[1], lo, la));
  const m = frontLineMaterial({ color, after: 0.32, tip: 5.0, decay: 3.0 });
  return new THREE.LineSegments(g, m);
}

export function createBorders(lines, seedLL, color = '#1aa6c4') {
  const g = segmentsFromPolylines(lines, 1.0006, (lo, la) => angDist(seedLL[0], seedLL[1], lo, la));
  const m = frontLineMaterial({ color, after: 0.18, tip: 1.5, decay: 3.0 });
  return new THREE.LineSegments(g, m);
}

// Mycelium: a branching random walk out from the seed. Each vertex carries its
// path length so the network visibly *grows* rather than appearing.
export function createMycelium(seedLL, { primaries = 22, maxSegs = 60000, seed = 7 } = {}) {
  const rnd = mulberry32(seed);
  const pos = [];
  const dist = [];
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const stack = [];
  for (let i = 0; i < primaries; i++) {
    stack.push({ lon: seedLL[0], lat: seedLL[1], brg: (360 * i) / primaries + rnd() * 12, len: 0, depth: 0, life: 150 + rnd() * 120 });
  }
  let segs = 0;
  while (stack.length && segs < maxSegs) {
    const br = stack.pop();
    let { lon, lat, brg, len } = br;
    const step = (0.5 + rnd() * 0.5) * D2R * (br.depth === 0 ? 1.2 : 0.9);
    for (let s = 0; s < br.life && segs < maxSegs; s++) {
      // outward bias keeps the culture expanding rather than knotting
      const away = (bearing(lon, lat, seedLL[0], seedLL[1]) + 180) % 360;
      let diff = ((away - brg + 540) % 360) - 180;
      brg += diff * 0.04 + (rnd() - 0.5) * 26;
      const [nl, nt] = destination(lon, lat, brg, step);
      if (Math.abs(nl - lon) < 180) {
        llToVec(lon, lat, 1.0012, a);
        llToVec(nl, nt, 1.0012, b);
        pos.push(...a, ...b);
        dist.push(len * 0.82, (len + step) * 0.82);
        segs++;
      }
      lon = nl;
      lat = nt;
      len += step;
      if (len > Math.PI * 1.05) break;
      const pBranch = br.depth < 5 ? 0.07 : 0.02;
      if (rnd() < pBranch) {
        stack.push({ lon, lat, brg: brg + (rnd() < 0.5 ? -1 : 1) * (22 + rnd() * 45), len, depth: br.depth + 1, life: (br.life - s) * (0.35 + rnd() * 0.5) });
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  const m = frontLineMaterial({ color: '#2fe8ff', after: 0.07, tip: 4.0, decay: 2.2 });
  const obj = new THREE.LineSegments(g, m);
  obj.userData.segments = segs;
  return obj;
}

// Subsea cables: drawn on, then light pulses ride them.
export function createCables(cables) {
  const pos = [];
  const arc = [];
  const rnd = [];
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const r = mulberry32(99);
  for (const line of cables) {
    let L = 0;
    const off = r();
    for (let i = 0; i < line.length - 1; i++) {
      const [lo1, la1] = line[i];
      const [lo2, la2] = line[i + 1];
      if (Math.abs(lo2 - lo1) > 180) continue;
      const d = angDist(lo1, la1, lo2, la2);
      llToVec(lo1, la1, 1.0015, a);
      llToVec(lo2, la2, 1.0015, b);
      pos.push(...a, ...b);
      arc.push(L, L + d);
      rnd.push(off, off);
      L += d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aArc', new THREE.Float32BufferAttribute(arc, 1));
  g.setAttribute('aRnd', new THREE.Float32BufferAttribute(rnd, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uDraw: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color('#2bd9ff') } },
    vertexShader: /* glsl */ `
      attribute float aArc;
      attribute float aRnd;
      varying float vArc;
      varying float vRnd;
      varying float vFacing;
      void main() {
        vArc = aArc; vRnd = aRnd;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vFacing = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT, uDraw, uAlpha;
      uniform vec3 uColor;
      varying float vArc;
      varying float vRnd;
      varying float vFacing;
      void main() {
        float drawn = uDraw * 3.2 - vArc - vRnd * 0.4;
        if (drawn < 0.0) discard;
        float tip = exp(-drawn * 30.0) * 3.0;
        float p = fract(vArc * 3.0 - uT * 0.9 + vRnd);
        float pulse = pow(smoothstep(0.85, 1.0, p), 3.0) * 2.5;
        float back = smoothstep(-0.1, 0.25, vFacing);
        vec3 c = uColor * (0.28 + pulse) + vec3(1.0) * (tip + pulse * 0.4);
        gl_FragColor = vec4(c * uAlpha * back, 1.0);
      }
    `,
  });
  return new THREE.LineSegments(g, m);
}

// Great-circle arcs that lift off the surface; a bright head travels along.
export function createArcs(pairs, seed = 5) {
  const rnd = mulberry32(seed);
  const pos = [];
  const u = [];
  const t0 = [];
  const SEG = 48;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (const [p, q] of pairs) {
    const d = angDist(p[0], p[1], q[0], q[1]);
    if (d < 0.05) continue;
    const brg = bearing(p[0], p[1], q[0], q[1]);
    const lift = 0.015 + d * 0.07;
    const start = rnd();
    let prev = null;
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG;
      const [lo, la] = destination(p[0], p[1], brg, d * f);
      const h = 1.002 + Math.sin(Math.PI * f) * lift;
      llToVec(lo, la, h, b);
      if (prev) {
        pos.push(...prev, ...b);
        u.push((i - 1) / SEG, f);
        t0.push(start, start);
      }
      prev = [...b];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(u, 1));
  g.setAttribute('aT0', new THREE.Float32BufferAttribute(t0, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color('#5ff6ff') } },
    vertexShader: /* glsl */ `
      attribute float aU;
      attribute float aT0;
      varying float vU;
      varying float vT0;
      void main() {
        vU = aU; vT0 = aT0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT, uAlpha;
      uniform vec3 uColor;
      varying float vU;
      varying float vT0;
      void main() {
        float head = uT * 0.55 - vT0 * 1.6;   // each arc launches at its own time
        float k = head - vU;
        if (k < 0.0) discard;
        float trail = exp(-k * 3.5);
        float hot = exp(-k * 40.0) * 2.0;
        vec3 c = uColor * (0.15 + trail) + vec3(1.0) * hot;
        gl_FragColor = vec4(c * uAlpha, 1.0);
      }
    `,
  });
  return new THREE.LineSegments(g, m);
}

// The digital twin's lattice: a geodesic shell that grows outward.
export function createLattice() {
  const ico = new THREE.IcosahedronGeometry(1, 4);
  const edges = new THREE.WireframeGeometry(ico);
  const p = edges.getAttribute('position');
  const rnd = [];
  // build order: a sweep out from the seed (+X, Null Island) with a little jitter,
  // so the shell visibly constructs itself the way the culture grew
  for (let i = 0; i < p.count; i += 2) {
    const mx = (p.getX(i) + p.getX(i + 1)) / 2;
    const my = (p.getY(i) + p.getY(i + 1)) / 2;
    const mz = (p.getZ(i) + p.getZ(i + 1)) / 2;
    const ang = Math.acos(Math.max(-1, Math.min(1, mx / Math.hypot(mx, my, mz)))) / Math.PI;
    const h = Math.sin(mx * 91.7 + my * 47.3 + mz * 13.1) * 43758.5;
    const v = Math.min(0.999, ang * 0.9 + (h - Math.floor(h)) * 0.08);
    rnd.push(v, v);
  }
  edges.setAttribute('aRnd', new THREE.Float32BufferAttribute(rnd, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uAlpha: { value: 0 }, uBuild: { value: 0 }, uT: { value: 0 }, uColor: { value: new THREE.Color('#38e8ff') } },
    vertexShader: /* glsl */ `
      attribute float aRnd;
      varying float vRnd;
      varying vec3 vP;
      varying float vFacing;
      void main() {
        vRnd = aRnd; vP = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vFacing = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha, uBuild, uT;
      uniform vec3 uColor;
      varying float vRnd;
      varying vec3 vP;
      varying float vFacing;
      void main() {
        if (vRnd > uBuild) discard;
        float fresh = exp(-(uBuild - vRnd) * 18.0);
        float shimmer = 0.6 + 0.4 * sin(uT * 3.0 + vRnd * 40.0);
        // silhouette-weighted: the shell reads as a sphere, not a net over the planet
        float rim = 1.0 - abs(vFacing);
        float back = mix(0.18, 1.0, pow(rim, 1.5));
        vec3 c = uColor * (0.3 * shimmer + fresh * 1.6) + vec3(1.0) * fresh * 0.7;
        gl_FragColor = vec4(c * uAlpha * back, 1.0);
      }
    `,
  });
  return new THREE.LineSegments(edges, m);
}
