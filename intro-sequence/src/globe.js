import * as THREE from 'three';

// The planet: one shader that walks the surface through every state the film
// needs — dark substrate, the growth front lighting up night cities, quadtree
// tiles indexing in with rising resolution, then the lit, living Earth.

const COMMON = /* glsl */ `
  #define PI 3.141592653589793
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  vec3 llDir(float lon, float lat) {
    float c = cos(lat);
    return vec3(c * cos(lon), sin(lat), -c * sin(lon));
  }
  // u wraps 1 -> 0 at the antimeridian; take derivatives from whichever of u or
  // u+0.5 is continuous here so mip selection doesn't spike into a seam line
  void seamGrad(vec2 uv, out vec2 gx, out vec2 gy) {
    vec2 a = uv;
    vec2 b = vec2(fract(uv.x + 0.5), uv.y);
    vec2 ax = dFdx(a), ay = dFdy(a), bx = dFdx(b), by = dFdy(b);
    gx = vec2(abs(ax.x) < abs(bx.x) ? ax.x : bx.x, ax.y);
    gy = vec2(abs(ay.x) < abs(by.x) ? ay.x : by.x, ay.y);
  }
`;

export function createGlobe({ dayTex, nightTex, cloudTex }) {
  const uniforms = {
    uDay: { value: dayTex },
    uNight: { value: nightTex },
    uTime: { value: 0 },
    uSeed: { value: new THREE.Vector3(1, 0, 0) },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uFront: { value: -1 }, // growth front, radians from the seed
    uHolo: { value: 0 }, // substrate grid visibility
    uLights: { value: 0 }, // night-light "neurons" during growth
    uWave: { value: new THREE.Vector3(1e3, 1e3, 1e3) },
    uWaveSpread: { value: 2.6 },
    uImagery: { value: 0 }, // forces imagery fully on (after indexing)
    uLit: { value: 0 }, // 0 = flat imagery, 1 = real sun lighting
    uTexel: { value: new THREE.Vector2(1 / 8192, 1 / 4096) },
    uGridAmt: { value: 1 },
    uTint: { value: 0 }, // cyan analysis tint on the whole surface
    uDim: { value: 1 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vWorldN;
      varying vec3 vView;
      void main() {
        vObj = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldN = normalize(mat3(modelMatrix) * position);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform sampler2D uDay, uNight;
      uniform float uTime, uFront, uHolo, uLights, uWaveSpread, uImagery, uLit, uGridAmt, uTint, uDim;
      uniform vec3 uSeed, uSun, uWave;
      uniform vec2 uTexel;
      varying vec3 vObj;
      varying vec3 vWorldN;
      varying vec3 vView;

      float mercY(float lat) {
        lat = clamp(lat, -1.4844, 1.4844);
        return 0.5 - log(tan(PI * 0.25 + lat * 0.5)) / (2.0 * PI);
      }
      float invMercY(float my) {
        return atan(sinh(PI * (1.0 - 2.0 * my)));
      }

      // Per-level quadtree state at this fragment.
      // returns x = phase since this tile revealed, y = edge line (0..1)
      vec2 tileState(float z, float waveT, vec2 uv, float my, float jitter) {
        float n = exp2(z);
        vec2 tc = vec2(uv.x * n, my * n);
        vec2 ti = floor(tc);
        vec2 f = fract(tc);
        float lonc = ((ti.x + 0.5) / n) * 2.0 * PI - PI;
        float latc = invMercY((ti.y + 0.5) / n);
        float d = acos(clamp(dot(uSeed, llDir(lonc, latc)), -1.0, 1.0));
        float tRev = waveT + d / PI * uWaveSpread + hash3(vec3(ti, z)) * jitter;
        vec2 tcb = vec2(fract(uv.x + 0.5) * n, tc.y);
        vec2 w = vec2(min(fwidth(tc.x), fwidth(tcb.x)), fwidth(tc.y));
        vec2 e = min(f, 1.0 - f) / max(w, vec2(1e-5));
        float line = 1.0 - smoothstep(0.0, 1.25, min(e.x, e.y));
        return vec2(uTime - tRev, line);
      }

      void main() {
        vec3 n = normalize(vObj);
        float lat = asin(clamp(n.y, -1.0, 1.0));
        float lon = atan(-n.z, n.x);
        vec2 uv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
        float my = mercY(lat);
        vec3 N = normalize(vWorldN);
        vec3 V = normalize(vView);
        float dSeed = acos(clamp(dot(n, uSeed), -1.0, 1.0));

        // ---------- substrate (pre-imagery)
        float gLat = abs(fract(lat * 180.0 / PI / 10.0 + 0.5) - 0.5) * 10.0;
        float gLon = abs(fract(lon * 180.0 / PI / 10.0 + 0.5) - 0.5) * 10.0 * cos(lat);
        float gw = fwidth(lat * 180.0 / PI) * 1.2;
        float gwl = min(fwidth(lon), fwidth(mod(lon + 2.0 * PI, 2.0 * PI))) * 180.0 / PI * 1.2 * cos(lat);
        float grid = max(1.0 - smoothstep(0.0, gw, gLat), 1.0 - smoothstep(0.0, max(gwl, 1e-4), gLon));
        float behind = smoothstep(uFront + 0.02, uFront - 0.10, dSeed);
        vec3 base = vec3(0.0018, 0.0035, 0.006) * behind;
        vec3 holo = base + vec3(0.0, 0.35, 0.42) * grid * 0.10 * uHolo * behind;
        // growth front: a thin bright ring with a soft wake
        float ring = exp(-pow((dSeed - uFront) * 55.0, 2.0)) * step(0.0, uFront);
        float wake = exp(-max(uFront - dSeed, 0.0) * 6.0) * behind;
        holo += vec3(0.1, 0.85, 1.0) * (ring * 0.55 + wake * 0.035) * uHolo;

        // real night lights, colonised by the front: the "neurons"
        vec2 gx, gy;
        seamGrad(uv, gx, gy);
        float nl = textureGrad(uNight, uv, gx, gy).r;
        float nlc = pow(max(nl - 0.06, 0.0) * 1.07, 1.7);
        float fresh = exp(-max(uFront - dSeed, 0.0) * 3.0);
        holo += mix(vec3(0.55, 0.95, 1.0), vec3(1.0), fresh) * nlc * (1.2 + fresh * 2.5) * behind * uLights;

        // ---------- quadtree indexing
        vec2 s3 = tileState(3.0, uWave.x, uv, my, 0.35);
        vec2 s4 = tileState(4.0, uWave.y, uv, my, 0.30);
        vec2 s5 = tileState(5.0, uWave.z, uv, my, 0.25);
        float reveal = max(smoothstep(0.05, 0.42, s3.x), uImagery);
        // resolution climbs as each finer wave passes
        float bias = mix(4.5, 0.0, max(smoothstep(0.0, 0.5, s5.x), uImagery));
        bias = min(bias, mix(4.5, 2.2, smoothstep(0.0, 0.5, s4.x)));
        float bs = exp2(bias);
        vec2 bgx = gx * bs, bgy = gy * bs;
        vec3 day = textureGrad(uDay, uv, bgx, bgy).rgb;

        // analysis edges (luminance gradient) — only while a tile is being indexed
        float ph0 = s3.x;
        float edgeAmt0 = step(0.0, ph0) * exp(-max(ph0 - 0.1, 0.0) * 2.2) * (1.0 - uImagery);
        float edge = 0.0;
        if (edgeAmt0 > 0.002) {
          float l0 = dot(textureGrad(uDay, uv + vec2(uTexel.x, 0.0), bgx, bgy).rgb, vec3(0.3, 0.59, 0.11));
          float l1 = dot(textureGrad(uDay, uv - vec2(uTexel.x, 0.0), bgx, bgy).rgb, vec3(0.3, 0.59, 0.11));
          float l2 = dot(textureGrad(uDay, uv + vec2(0.0, uTexel.y), bgx, bgy).rgb, vec3(0.3, 0.59, 0.11));
          float l3 = dot(textureGrad(uDay, uv - vec2(0.0, uTexel.y), bgx, bgy).rgb, vec3(0.3, 0.59, 0.11));
          edge = clamp(length(vec2(l0 - l1, l2 - l3)) * 9.0, 0.0, 1.0);
        }

        // ---------- lighting
        float sd = dot(n, uSun);
        float dayF = smoothstep(-0.10, 0.20, sd);
        vec3 lit = day * (0.035 + 1.25 * pow(max(sd, 0.0), 0.75)) * dayF + day * 0.012;
        float ocean = smoothstep(0.015, 0.06, day.b - day.r) * (1.0 - smoothstep(0.08, 0.25, dot(day, vec3(0.33))));
        vec3 Hh = normalize(normalize(mat3(1.0) * uSun) + V);
        float graze = smoothstep(0.15, 0.5, dot(N, V));
        float spec = (pow(max(dot(N, Hh), 0.0), 240.0) * 0.4 + pow(max(dot(N, Hh), 0.0), 30.0) * 0.03) * ocean * dayF * graze;
        vec3 cityGlow = vec3(1.0, 0.72, 0.42) * pow(nl, 1.9) * 1.6 * (1.0 - dayF);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 haze = vec3(0.25, 0.5, 1.0) * fres * (0.15 + 0.85 * dayF) * 0.7;
        vec3 earthLit = lit + vec3(1.0, 0.92, 0.8) * spec + cityGlow + haze;
        vec3 earthFlat = day * 0.6;
        vec3 earth = mix(earthFlat, earthLit, uLit);

        // reveal treatment: flash, edges, then settle
        float ph = s3.x;
        float flash = step(0.0, ph) * exp(-max(ph, 0.0) * 9.0);
        float edgeAmt = step(0.0, ph) * exp(-max(ph - 0.1, 0.0) * 2.2) * (1.0 - uImagery);
        vec3 surf = mix(holo, earth, reveal);
        surf += vec3(0.0, 0.8, 1.0) * edge * edgeAmt * 0.9;
        surf += vec3(0.6, 0.95, 1.0) * flash * 0.10 * (1.0 - uImagery);
        surf = mix(surf, vec3(dot(surf, vec3(0.3, 0.59, 0.11))) * vec3(0.4, 1.0, 1.15), uTint);

        // tile edges: faint before, bright at their own wave, then gone
        float g3 = s3.y * (step(ph, 0.0) * 0.18 * uHolo * behind + step(0.0, ph) * exp(-max(ph, 0.0) * 1.6) * 1.3);
        float g4 = s4.y * step(0.0, s4.x) * exp(-max(s4.x, 0.0) * 2.0) * 0.9;
        float g5 = s5.y * step(0.0, s5.x) * exp(-max(s5.x, 0.0) * 2.6) * 0.7;
        surf += vec3(0.25, 0.9, 1.0) * max(g3, max(g4, g5)) * uGridAmt;

        gl_FragColor = vec4(surf * uDim, 1.0);
      }
    `,
  });

  const geo = new THREE.SphereGeometry(1, 384, 192);
  const mesh = new THREE.Mesh(geo, mat);

  // Clouds — real GIBS-derived opacity, lit by the same sun.
  const cloudU = {
    uClouds: { value: cloudTex },
    uSun: uniforms.uSun,
    uAmt: { value: 0 },
    uTime: uniforms.uTime,
  };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudU,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vObj = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * position);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      #define PI 3.141592653589793
      uniform sampler2D uClouds;
      uniform vec3 uSun;
      uniform float uAmt, uTime;
      varying vec3 vObj;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec3 n = normalize(vObj);
        float lat = asin(clamp(n.y, -1.0, 1.0));
        float lon = atan(-n.z, n.x) - uTime * 0.0015;
        vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), lat / PI + 0.5);
        vec2 ua = uv, ub = vec2(fract(uv.x + 0.5), uv.y);
        vec2 ax = dFdx(ua), ay = dFdy(ua), bx = dFdx(ub), by = dFdy(ub);
        vec2 gx = vec2(abs(ax.x) < abs(bx.x) ? ax.x : bx.x, ax.y);
        vec2 gy = vec2(abs(ay.x) < abs(by.x) ? ay.x : by.x, ay.y);
        float c = textureGrad(uClouds, uv, gx, gy).r;
        c = smoothstep(0.08, 0.85, c);
        float sd = dot(n, uSun);
        float dayF = smoothstep(-0.12, 0.25, sd);
        vec3 col = vec3(1.0, 0.98, 0.95) * (0.02 + 1.1 * dayF * (0.35 + 0.65 * max(sd, 0.0)));
        float edge = pow(1.0 - max(dot(normalize(vN), normalize(vView)), 0.0), 2.0);
        gl_FragColor = vec4(col, c * uAmt * (0.92 - edge * 0.4));
      }
    `,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.0065, 256, 128), cloudMat);

  // Atmosphere shell — limb glow, warm-to-blue at the terminator.
  const atmoU = { uSun: uniforms.uSun, uAmt: { value: 0 }, uCyan: { value: 0 } };
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: atmoU,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vWP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform float uAmt, uCyan;
      varying vec3 vN;
      varying vec3 vWP;
      void main() {
        vec3 V = normalize(cameraPosition - vWP);
        vec3 N = normalize(vN);
        // distance of this view ray from the planet centre, in radii
        vec3 ro = cameraPosition;
        vec3 rd = -V;
        float b = dot(ro, rd);
        float h = length(ro - b * rd);
        float shell = 1.065;
        float t = clamp((shell - h) / (shell - 1.0), 0.0, 1.0);
        float glow = pow(t, 2.6) * (1.0 - smoothstep(0.985, 1.0, t) * 0.0);
        if (h < 1.0) glow *= 0.0;
        // light side vs dark side of the limb
        vec3 limbP = normalize(ro + rd * b);
        float sd = dot(limbP, uSun);
        float lit = smoothstep(-0.35, 0.4, sd);
        vec3 col = mix(vec3(0.02, 0.08, 0.14), vec3(0.35, 0.62, 1.0), lit);
        col += vec3(1.0, 0.45, 0.2) * exp(-pow(sd * 6.0, 2.0)) * 0.35;
        col = mix(col, vec3(0.1, 0.9, 1.0) * 0.8, uCyan);
        gl_FragColor = vec4(col * glow * uAmt * 1.05, 1.0);
      }
    `,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.065, 128, 64), atmoMat);

  const group = new THREE.Group();
  group.add(mesh, clouds, atmo);
  return { group, mesh, uniforms, cloudU, atmoU };
}
