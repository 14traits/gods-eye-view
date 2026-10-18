import * as THREE from 'three';
import { llToVec, D2R, EARTH_KM } from './geo.js';
import { mulberry32 } from './timeline.js';

// Point and particle layers for the live feeds. Every layer exposes
// `update(t, ctx)`; reveal timing and motion are pure functions of film time.

const GC = /* glsl */ `
  vec3 llDir(float lon, float lat) {
    float c = cos(lat);
    return vec3(c * cos(lon), sin(lat), -c * sin(lon));
  }
  // great-circle destination: start (lon,lat) rad, bearing rad, distance rad
  vec2 gcDest(vec2 ll, float b, float d) {
    float lat2 = asin(sin(ll.y) * cos(d) + cos(ll.y) * sin(d) * cos(b));
    float lon2 = ll.x + atan(sin(b) * sin(d) * cos(ll.y), cos(d) - sin(ll.y) * sin(lat2));
    return vec2(lon2, lat2);
  }
`;

// Moving contacts (aircraft, vessels): heads as points, trails as segments.
// rows: [lon, lat, alt_m, track_deg, vel_ms]
export function createMovers(rows, { color, trailColor, size = 2.2, altScale = 8, trail = 0.010, revealSpread = 1.4, seed = 1, gain = 1 }) {
  const rnd = mulberry32(seed);
  const n = rows.length;
  const ll = new Float32Array(n * 2);
  const hv = new Float32Array(n * 2);
  const alt = new Float32Array(n);
  const rr = new Float32Array(n);
  rows.forEach((r, i) => {
    ll[i * 2] = r[0] * D2R;
    ll[i * 2 + 1] = r[1] * D2R;
    hv[i * 2] = (r[3] || 0) * D2R;
    hv[i * 2 + 1] = (r[4] || 0) / (EARTH_KM * 1000); // rad per second
    alt[i] = 1 + ((r[2] || 0) / (EARTH_KM * 1000)) * altScale + 0.0015;
    rr[i] = rnd();
  });

  const uniforms = {
    uSim: { value: 0 }, // simulated seconds since the feed went live
    uReveal: { value: 0 }, // 0..1 + spread
    uAlpha: { value: 0 },
    uGain: { value: gain },
    uPx: { value: 1 },
    uSize: { value: size },
    uTrail: { value: trail },
    uColor: { value: new THREE.Color(color) },
    uTrailColor: { value: new THREE.Color(trailColor || color) },
    uSpread: { value: revealSpread },
  };
  const vs = (isTrail) => /* glsl */ `
    ${GC}
    attribute vec2 aLL;
    attribute vec2 aHV;
    attribute float aAlt;
    attribute float aR;
    ${isTrail ? 'attribute float aEnd;' : ''}
    uniform float uSim, uReveal, uPx, uSize, uTrail, uSpread;
    varying float vA;
    varying float vFacing;
    void main() {
      float d = aHV.y * uSim;
      ${isTrail ? 'd -= aEnd * max(uTrail, aHV.y * 40.0);' : ''}
      vec2 p = gcDest(aLL, aHV.x, d);
      vec3 pos = llDir(p.x, p.y) * aAlt;
      vec4 wp = modelMatrix * vec4(pos, 1.0);
      vFacing = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz));
      float rv = clamp((uReveal - aR * uSpread) * 6.0, 0.0, 1.0);
      vA = rv ${isTrail ? '* (1.0 - aEnd)' : ''};
      gl_Position = projectionMatrix * viewMatrix * wp;
      ${isTrail ? '' : 'gl_PointSize = uSize * uPx * (1.0 + 2.5 * exp(-(uReveal - aR * uSpread) * 10.0) * step(0.0, uReveal - aR * uSpread));'}
    }
  `;
  const fs = (isTrail) => /* glsl */ `
    uniform vec3 ${isTrail ? 'uTrailColor' : 'uColor'};
    uniform float uAlpha, uGain;
    varying float vA;
    varying float vFacing;
    void main() {
      float back = smoothstep(-0.02, 0.12, vFacing);
      ${
        isTrail
          ? 'gl_FragColor = vec4(uTrailColor * vA * uAlpha * uGain * back * 0.9, 1.0);'
          : `vec2 c = gl_PointCoord - 0.5;
             float r = length(c);
             float disc = smoothstep(0.5, 0.15, r);
             if (vA * back <= 0.001) discard;
             gl_FragColor = vec4(uColor * disc * vA * uAlpha * uGain * back, 1.0);`
      }
    }
  `;
  const mk = (isTrail) =>
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: vs(isTrail),
      fragmentShader: fs(isTrail),
    });

  const gp = new THREE.BufferGeometry();
  gp.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  gp.setAttribute('aLL', new THREE.BufferAttribute(ll, 2));
  gp.setAttribute('aHV', new THREE.BufferAttribute(hv, 2));
  gp.setAttribute('aAlt', new THREE.BufferAttribute(alt, 1));
  gp.setAttribute('aR', new THREE.BufferAttribute(rr, 1));
  gp.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  const heads = new THREE.Points(gp, mk(false));

  // trails: two vertices per contact, aEnd 0 (head) / 1 (tail)
  const dup = (src, k) => {
    const out = new Float32Array(src.length * 2);
    for (let i = 0; i < src.length / k; i++)
      for (let j = 0; j < k; j++) {
        out[i * 2 * k + j] = src[i * k + j];
        out[i * 2 * k + k + j] = src[i * k + j];
      }
    return out;
  };
  const gt = new THREE.BufferGeometry();
  gt.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  gt.setAttribute('aLL', new THREE.BufferAttribute(dup(ll, 2), 2));
  gt.setAttribute('aHV', new THREE.BufferAttribute(dup(hv, 2), 2));
  gt.setAttribute('aAlt', new THREE.BufferAttribute(dup(alt, 1), 1));
  gt.setAttribute('aR', new THREE.BufferAttribute(dup(rr, 1), 1));
  const ends = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) ends[i * 2 + 1] = 1;
  gt.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  gt.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  const trails = new THREE.LineSegments(gt, mk(true));

  const group = new THREE.Group();
  group.add(trails, heads);
  return { group, uniforms, count: n };
}

// Static or pulsing point events (fires, quakes, cities, cameras).
// rows: [lon, lat, weight]
export function createEvents(rows, { color, size = 3, mode = 'flicker', r = 1.002, spread = 1.2, seed = 3, gain = 1, weightFn = (w) => w }) {
  const rnd = mulberry32(seed);
  const n = rows.length;
  const pos = new Float32Array(n * 3);
  const w = new Float32Array(n);
  const rr = new Float32Array(n);
  const v = [0, 0, 0];
  rows.forEach((row, i) => {
    llToVec(row[0], row[1], r, v);
    pos.set(v, i * 3);
    w[i] = weightFn(row[2] ?? 1);
    rr[i] = rnd();
  });
  const uniforms = {
    uT: { value: 0 },
    uReveal: { value: 0 },
    uAlpha: { value: 0 },
    uGain: { value: gain },
    uPx: { value: 1 },
    uSize: { value: size },
    uColor: { value: new THREE.Color(color) },
    uSpread: { value: spread },
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aW', new THREE.BufferAttribute(w, 1));
  g.setAttribute('aR', new THREE.BufferAttribute(rr, 1));
  const ringMode = mode === 'ring';
  const m = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aW;
      attribute float aR;
      uniform float uT, uReveal, uPx, uSize, uSpread;
      varying float vA;
      varying float vPh;
      varying float vW;
      varying float vFacing;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vFacing = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz));
        float k = uReveal - aR * uSpread;
        vA = clamp(k * 5.0, 0.0, 1.0);
        vPh = k;
        vW = aW;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${
          ringMode
            ? 'gl_PointSize = uSize * uPx * (0.6 + aW) * 9.0;'
            : 'gl_PointSize = uSize * uPx * (0.7 + aW) * (1.0 + 3.0 * exp(-max(k, 0.0) * 8.0) * step(0.0, k));'
        }
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uT, uAlpha, uGain;
      varying float vA;
      varying float vPh;
      varying float vW;
      varying float vFacing;
      void main() {
        float back = smoothstep(-0.02, 0.12, vFacing);
        if (vA * back <= 0.001) discard;
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        ${
          ringMode
            ? `float ph = fract(vPh * 0.55 + vW * 0.37);
               float ringR = ph;
               float ring = exp(-pow((r - ringR) * 14.0, 2.0)) * (1.0 - ph);
               float core = smoothstep(0.16, 0.0, r);
               float first = exp(-max(vPh, 0.0) * 3.0);
               float a = ring * (0.8 + first) + core * 1.4;`
            : `float flick = 0.65 + 0.35 * sin(uT * (9.0 + vW * 7.0) + vW * 91.0);
               float a = smoothstep(1.0, 0.0, r) * smoothstep(1.0, 0.25, r) * 1.5 * flick;`
        }
        gl_FragColor = vec4(uColor * a * vA * uAlpha * uGain * back, 1.0);
      }
    `,
  });
  const pts = new THREE.Points(g, m);
  return { group: pts, uniforms, count: n };
}

// Satellites: positions arrive from satellite.js each frame.
export function createSatellites(count, { color = '#d6d0ff', size = 1.7 } = {}) {
  const pos = new Float32Array(count * 3);
  const rr = new Float32Array(count);
  const kind = new Float32Array(count);
  const rnd = mulberry32(11);
  for (let i = 0; i < count; i++) rr[i] = rnd();
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3);
  pa.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('aR', new THREE.BufferAttribute(rr, 1));
  g.setAttribute('aK', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
  const uniforms = {
    uReveal: { value: 0 },
    uAlpha: { value: 0 },
    uPx: { value: 1 },
    uSize: { value: size },
    uColor: { value: new THREE.Color(color) },
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aR;
      attribute float aK;
      uniform float uReveal, uPx, uSize;
      varying float vA;
      varying float vK;
      void main() {
        float k = uReveal - aR * 1.3;
        vA = clamp(k * 5.0, 0.0, 1.0);
        vK = aK;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float big = aK > 0.5 ? 1.6 : 1.0;
        gl_PointSize = uSize * uPx * big * (1.0 + 3.0 * exp(-max(k, 0.0) * 9.0) * step(0.0, k));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vA;
      varying float vK;
      void main() {
        if (vA <= 0.001) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.1, r);
        vec3 c = mix(uColor * 0.75, vec3(0.75, 1.0, 1.0) * 1.4, step(0.5, vK));
        gl_FragColor = vec4(c * a * vA * uAlpha, 1.0);
      }
    `,
  });
  const pts = new THREE.Points(g, m);
  return { group: pts, uniforms, positions: pos, attr: pa, kind, count };
}

// Orbit rings for a handful of notable objects.
export function createOrbitRings(paths, color = '#bfb6ff') {
  const pos = [];
  const u = [];
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      pos.push(...path[i], ...path[i + 1]);
      u.push(i / (path.length - 1), (i + 1) / (path.length - 1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(u, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uDraw: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      attribute float aU;
      varying float vU;
      varying float vNear;
      void main() {
        vU = aU;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNear = smoothstep(1.2, 4.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDraw, uAlpha;
      uniform vec3 uColor;
      varying float vU;
      varying float vNear;
      void main() {
        float k = uDraw - vU;
        if (k < 0.0) discard;
        float hot = exp(-k * 30.0) * 2.0;
        gl_FragColor = vec4((uColor * 0.4 + vec3(1.0) * hot) * uAlpha * vNear, 1.0);
      }
    `,
  });
  return new THREE.LineSegments(g, m);
}

// Wind: particles advected through a real GFS u/v field, drawn as fading trails.
export function createWind(field, { count = 7000, trailLen = 14, seed = 21 } = {}) {
  const { nx, ny, lo1, la1, dx, dy, u, v } = field;
  const sample = (lon, lat) => {
    let x = (((lon - lo1) % 360) + 360) % 360 / dx;
    let y = (la1 - lat) / dy;
    const x0 = Math.floor(x);
    const y0 = Math.max(0, Math.min(ny - 2, Math.floor(y)));
    const fx = x - x0;
    const fy = Math.max(0, Math.min(1, y - y0));
    const i00 = y0 * nx + (x0 % nx);
    const i10 = y0 * nx + ((x0 + 1) % nx);
    const i01 = (y0 + 1) * nx + (x0 % nx);
    const i11 = (y0 + 1) * nx + ((x0 + 1) % nx);
    const bl = (arr) => (arr[i00] * (1 - fx) + arr[i10] * fx) * (1 - fy) + (arr[i01] * (1 - fx) + arr[i11] * fx) * fy;
    return [bl(u), bl(v)];
  };
  const SEGS = trailLen - 1;
  const pos = new Float32Array(count * SEGS * 2 * 3);
  const alpha = new Float32Array(count * SEGS * 2);
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3);
  pa.setUsage(THREE.DynamicDrawUsage);
  const aa = new THREE.BufferAttribute(alpha, 1);
  aa.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('aA', aa);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  const uniforms = { uAlpha: { value: 0 }, uColor: { value: new THREE.Color('#a6dcff') } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aA;
      varying float vA;
      varying float vFacing;
      void main() {
        vA = aA;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vFacing = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vA;
      varying float vFacing;
      void main() {
        float back = smoothstep(0.0, 0.15, vFacing);
        gl_FragColor = vec4(uColor * vA * uAlpha * back, 1.0);
      }
    `,
  });
  const lines = new THREE.LineSegments(g, m);

  // particle state
  const P = { lon: new Float32Array(count), lat: new Float32Array(count), age: new Float32Array(count), life: new Float32Array(count), spd: new Float32Array(count) };
  const hist = new Float32Array(count * trailLen * 2);
  let rnd;
  let simT = -1;
  const spawn = (i) => {
    const lon = rnd() * 360 - 180;
    const lat = Math.asin(rnd() * 2 - 1) * (180 / Math.PI) * 0.92;
    P.lon[i] = lon;
    P.lat[i] = lat;
    P.age[i] = 0;
    P.life[i] = 1.2 + rnd() * 2.2;
    for (let k = 0; k < trailLen; k++) {
      hist[(i * trailLen + k) * 2] = lon;
      hist[(i * trailLen + k) * 2 + 1] = lat;
    }
  };
  const reset = () => {
    rnd = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      spawn(i);
      P.age[i] = rnd() * P.life[i];
    }
    simT = 0;
  };
  const DT = 1 / 30;
  const K = 0.85; // deg per (m/s) per second of film — visual speed
  const step = () => {
    for (let i = 0; i < count; i++) {
      const [uu, vv] = sample(P.lon[i], P.lat[i]);
      P.spd[i] = Math.hypot(uu, vv);
      const c = Math.max(0.2, Math.cos(P.lat[i] * D2R));
      P.lon[i] += (uu * K * DT) / c;
      P.lat[i] += vv * K * DT;
      if (P.lon[i] > 180) P.lon[i] -= 360;
      if (P.lon[i] < -180) P.lon[i] += 360;
      P.age[i] += DT;
      const base = i * trailLen * 2;
      hist.copyWithin(base + 2, base, base + (trailLen - 1) * 2);
      hist[base] = P.lon[i];
      hist[base + 1] = P.lat[i];
      if (P.age[i] > P.life[i] || Math.abs(P.lat[i]) > 84) spawn(i);
    }
    simT += DT;
  };
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  function update(tSinceStart) {
    if (simT < 0 || tSinceStart < simT - 1e-6) reset();
    while (simT < tSinceStart) step();
    let o = 0;
    let q = 0;
    for (let i = 0; i < count; i++) {
      const base = i * trailLen * 2;
      const life = P.age[i] / P.life[i];
      const fade = Math.min(1, life * 5) * Math.min(1, (1 - life) * 4);
      const sp = Math.min(1, P.spd[i] / 18);
      for (let k = 0; k < SEGS; k++) {
        const lo1 = hist[base + k * 2];
        const la1 = hist[base + k * 2 + 1];
        const lo2 = hist[base + (k + 1) * 2];
        const la2 = hist[base + (k + 1) * 2 + 1];
        const jump = Math.abs(lo2 - lo1) > 90;
        llToVec(lo1, la1, 1.004, a);
        llToVec(jump ? lo1 : lo2, jump ? la1 : la2, 1.004, b);
        pos[o++] = a[0]; pos[o++] = a[1]; pos[o++] = a[2];
        pos[o++] = b[0]; pos[o++] = b[1]; pos[o++] = b[2];
        const f1 = (1 - k / SEGS) * fade * (0.25 + sp);
        const f2 = (1 - (k + 1) / SEGS) * fade * (0.25 + sp);
        alpha[q++] = f1;
        alpha[q++] = f2;
      }
    }
    pa.needsUpdate = true;
    aa.needsUpdate = true;
  }
  return { group: lines, uniforms, update, count };
}

export function createStars(n = 2600, seed = 77) {
  const rnd = mulberry32(seed);
  const pos = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    pos[i * 3] = 400 * s * Math.cos(t);
    pos[i * 3 + 1] = 400 * z;
    pos[i * 3 + 2] = 400 * s * Math.sin(t);
    mag[i] = Math.pow(rnd(), 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aM', new THREE.BufferAttribute(mag, 1));
  const uniforms = { uAlpha: { value: 0 }, uPx: { value: 1 } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aM;
      uniform float uPx;
      varying float vM;
      void main() {
        vM = aM;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (1.0 + aM * 2.2) * uPx;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying float vM;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        gl_FragColor = vec4(vec3(0.8, 0.9, 1.0) * a * (0.12 + vM * 0.9) * uAlpha, 1.0);
      }
    `,
  });
  return { group: new THREE.Points(g, m), uniforms };
}
