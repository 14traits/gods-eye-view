import * as THREE from 'three';

// HDR scene -> HUD composited in -> dual-filter bloom -> lens + film finish.
const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function createPost(renderer, W, H, hudCanvas) {
  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false };
  const scene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const merged = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const levels = [];
  let w = W;
  let h = H;
  for (let i = 0; i < 6; i++) {
    w = Math.max(2, Math.floor(w / 2));
    h = Math.max(2, Math.floor(h / 2));
    levels.push({ down: new THREE.WebGLRenderTarget(w, h, rtOpts), up: new THREE.WebGLRenderTarget(w, h, rtOpts) });
  }

  const hudTex = new THREE.CanvasTexture(hudCanvas);
  hudTex.colorSpace = THREE.SRGBColorSpace;
  hudTex.minFilter = THREE.LinearFilter;
  hudTex.generateMipmaps = false;

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const qScene = new THREE.Scene();
  qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const mergeMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, tHud: { value: hudTex }, uHudGain: { value: 1.25 } },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene, tHud;
      uniform float uHudGain;
      varying vec2 vUv;
      void main() {
        vec3 s = texture2D(tScene, vUv).rgb;
        vec4 hud = texture2D(tHud, vUv);
        // canvas uploads un-premultiplied: straight-alpha over-composite
        vec3 c = s * (1.0 - hud.a) + hud.rgb * hud.a * uHudGain;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthTest: false,
  });

  const downMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: 0 }, uFirst: { value: 0 } },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uTexel;
      uniform float uThresh, uFirst;
      varying vec2 vUv;
      vec3 pre(vec3 c) {
        if (uFirst < 0.5) return c;
        float l = max(c.r, max(c.g, c.b));
        float k = max(l - uThresh, 0.0) / max(l, 1e-4);
        return min(c * k, vec3(40.0));
      }
      void main() {
        vec2 o = uTexel;
        vec3 c = pre(texture2D(tSrc, vUv).rgb) * 4.0;
        c += pre(texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb);
        c += pre(texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb);
        c += pre(texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb);
        c += pre(texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb);
        gl_FragColor = vec4(c / 8.0, 1.0);
      }
    `,
    depthTest: false,
  });

  const upMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc, tBase;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec2 o = uTexel;
        vec3 c = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb;
        c += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb * 2.0;
        c += texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb;
        c += texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb * 2.0;
        c += texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb;
        c += texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb * 2.0;
        c += texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb;
        c += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
        gl_FragColor = vec4(c / 12.0 + texture2D(tBase, vUv).rgb, 1.0);
      }
    `,
    depthTest: false,
  });

  const finalMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.9 },
      uExposure: { value: 1 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uAberr: { value: 0.0015 },
      uGrain: { value: 0.045 },
      uVignette: { value: 0.55 },
      uGlitch: { value: 0 },
      uScan: { value: 0 },
      uFlash: { value: 0 },
      uFade: { value: 1 },
      uRes: { value: new THREE.Vector2(W, H) },
    },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc, tBloom;
      uniform float uBloom, uExposure, uTime, uFrame, uAberr, uGrain, uVignette, uGlitch, uScan, uFlash, uFade;
      uniform vec2 uRes;
      varying vec2 vUv;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      vec3 aces(vec3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }
      void main() {
        vec2 uv = vUv;
        // block glitch: horizontal slices displaced on transitions
        if (uGlitch > 0.0) {
          float row = floor(uv.y * 48.0);
          float blk = floor(uv.x * 6.0);
          float r = h21(vec2(row, floor(uFrame * 0.5)));
          float r2 = h21(vec2(blk, row + floor(uFrame)));
          if (r < uGlitch * 0.55) uv.x += (r2 - 0.5) * 0.08 * uGlitch;
          if (r2 < uGlitch * 0.12) uv.y += (r - 0.5) * 0.02;
        }
        vec2 d = uv - 0.5;
        float rr = dot(d, d);
        vec2 ab = d * rr * uAberr * 7.0 + vec2(uGlitch * 0.006, 0.0);
        vec3 col;
        col.r = texture2D(tSrc, uv + ab).r;
        col.g = texture2D(tSrc, uv).g;
        col.b = texture2D(tSrc, uv - ab).b;
        vec3 bl;
        bl.r = texture2D(tBloom, uv + ab * 1.5).r;
        bl.g = texture2D(tBloom, uv).g;
        bl.b = texture2D(tBloom, uv - ab * 1.5).b;
        col += bl * uBloom;
        // flashes punch exposure instead of adding a veil, so blacks stay black
        col *= uExposure * (1.0 + uFlash * 6.0);
        col = aces(col);
        // vignette
        float vig = smoothstep(0.95, 0.18, length(d * vec2(uRes.x / uRes.y, 1.0) * 0.82));
        col *= mix(1.0, vig, uVignette);
        // scanlines (boot / CRT moments)
        col *= 1.0 - uScan * 0.22 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 * 0.5));
        col = pow(col, vec3(1.0 / 2.2));
        // grain after encoding so it lives in the shadows too
        float g = h21(gl_FragCoord.xy + fract(uFrame * 0.6180339) * 913.0) - 0.5;
        col += g * uGrain * (1.0 - 0.6 * dot(col, vec3(0.33)));
        col *= uFade;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
  });

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(qScene, qCam);
  }

  function render(sceneObj, camera, params) {
    renderer.setRenderTarget(scene);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(sceneObj, camera);

    hudTex.needsUpdate = true;
    mergeMat.uniforms.tScene.value = scene.texture;
    mergeMat.uniforms.uHudGain.value = params.hudGain ?? 1.2;
    pass(mergeMat, merged);

    let src = merged;
    for (let i = 0; i < levels.length; i++) {
      downMat.uniforms.tSrc.value = src.texture;
      downMat.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
      downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
      downMat.uniforms.uThresh.value = params.bloomThresh ?? 0.55;
      pass(downMat, levels[i].down);
      src = levels[i].down;
    }
    let up = levels[levels.length - 1].down;
    for (let i = levels.length - 2; i >= 0; i--) {
      upMat.uniforms.tSrc.value = up.texture;
      upMat.uniforms.tBase.value = levels[i].down.texture;
      upMat.uniforms.uTexel.value.set(0.5 / up.width, 0.5 / up.height);
      pass(upMat, levels[i].up);
      up = levels[i].up;
    }

    const u = finalMat.uniforms;
    u.tSrc.value = merged.texture;
    u.tBloom.value = up.texture;
    for (const k of ['bloom', 'exposure', 'aberr', 'grain', 'vignette', 'glitch', 'scan', 'flash', 'fade']) {
      const key = 'u' + k[0].toUpperCase() + k.slice(1);
      if (params[k] !== undefined) u[key].value = params[k];
    }
    u.uTime.value = params.time;
    u.uFrame.value = params.frame;
    pass(finalMat, null);
  }

  return { render };
}
