/**
 * Mobile post chain, budgeted for a phone GPU:
 *
 *   scene (atmosphere + night-lights blend in the globe shader)
 *     → [bloom: bright-pass ½ res → separable blur ¼ res ×2]
 *     → grade (bloom add + lens look + vignette + grain), one full-res pass
 *     → FXAA (Cesium's, always last)
 *
 * Cesium's built-in bloom runs a full-resolution multi-pass blur; this one
 * touches full resolution exactly once. Without bloom (low quality, thermal
 * pressure) the grade runs alone. The 'clear' lens disables both.
 */
import * as Cesium from 'cesium';

export const LENSES = Object.freeze([
  'cinematic',
  'clear',
  'night',
  'thermal',
  'nvg',
]);
const LENS_MODE = { cinematic: 0, clear: 1, night: 2, thermal: 3, nvg: 4 };

const GRADE = /* glsl */ `
uniform sampler2D colorTexture;
#ifdef BLOOM
uniform sampler2D bloomTexture;
uniform float bloomStrength;
#endif
uniform float mode;
uniform float vignette;
uniform float exposure;
uniform float saturation;
uniform float contrast;
uniform float grain;
uniform float seed;
in vec2 v_textureCoordinates;

vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = mix(vec3(0.0, 0.0, 0.04), vec3(0.20, 0.0, 0.42), smoothstep(0.0, 0.22, t));
  a = mix(a, vec3(0.70, 0.0, 0.48), smoothstep(0.18, 0.42, t));
  a = mix(a, vec3(0.95, 0.25, 0.10), smoothstep(0.38, 0.62, t));
  a = mix(a, vec3(1.0, 0.68, 0.0), smoothstep(0.58, 0.80, t));
  return mix(a, vec3(1.0, 1.0, 0.85), smoothstep(0.78, 1.0, t));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 src = texture(colorTexture, uv);
  vec3 c = src.rgb;
#ifdef BLOOM
  vec3 glow = texture(bloomTexture, uv).rgb;
  c += glow * bloomStrength;
#endif
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (mode < 0.5) {
    // Cinematic: gentle exposure lift, cool shadows / warm highlights,
    // a soft shoulder, slightly richer colour.
    c *= exposure;
    vec3 cool = vec3(0.90, 0.99, 1.12);
    vec3 warm = vec3(1.07, 1.0, 0.92);
    c *= mix(cool, warm, smoothstep(0.08, 0.75, l));
    c = c / (1.0 + 0.22 * c) * 1.22;
    float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(g), c, saturation);
    c = (c - 0.45) * contrast + 0.45;
  } else if (mode < 2.5) {
    // Night: deep blue-black ground, sodium-warm lights.
    float g = l;
    vec3 tint = mix(vec3(0.35, 0.50, 0.95), vec3(1.0, 0.82, 0.55), smoothstep(0.15, 0.7, g));
    c = mix(c, g * tint * 1.6, 0.55);
    c = (c - 0.04) * 1.12;
  } else if (mode < 3.5) {
    // Thermal: luminance as temperature through an ironbow ramp.
    float t = pow(clamp(l * 1.15, 0.0, 1.0), 0.85);
    c = ironbow(t);
  } else {
    // NVG: P43 phosphor, intensifier gain and scintillation.
    float n = hash(uv * vec2(1733.0, 977.0) + seed);
    float v = pow(clamp(l * 2.2, 0.0, 1.0), 0.7) + (n - 0.5) * 0.05 * (1.0 - l);
    c = vec3(0.30, 1.0, 0.45) * v + vec3(0.0, 0.035, 0.01);
  }
  vec2 d = (uv - 0.5) * vec2(1.0, 1.1);
  float vig = 1.0 - vignette * smoothstep(0.25, 0.85, length(d));
  if (mode > 3.5) vig *= smoothstep(0.78, 0.62, length(d * vec2(0.9, 0.6)));
  c *= vig;
  c += (hash(uv * 911.0 + seed) - 0.5) * grain;
  out_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`;

const BRIGHT = /* glsl */ `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform float threshold;
in vec2 v_textureCoordinates;
void main() {
  vec2 t = 0.5 / colorTextureDimensions;
  vec3 c = texture(colorTexture, v_textureCoordinates + vec2(-t.x, -t.y)).rgb;
  c += texture(colorTexture, v_textureCoordinates + vec2(t.x, -t.y)).rgb;
  c += texture(colorTexture, v_textureCoordinates + vec2(-t.x, t.y)).rgb;
  c += texture(colorTexture, v_textureCoordinates + vec2(t.x, t.y)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(threshold, threshold + 0.3, l);
  out_FragColor = vec4(c * k, 1.0);
}
`;

const BLUR = /* glsl */ `
uniform sampler2D colorTexture;
uniform vec2 colorTextureDimensions;
uniform vec2 direction;
in vec2 v_textureCoordinates;
void main() {
  vec2 o = direction / colorTextureDimensions;
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb * 0.2270270270;
  c += texture(colorTexture, v_textureCoordinates + o * 1.3846153846).rgb * 0.3162162162;
  c += texture(colorTexture, v_textureCoordinates - o * 1.3846153846).rgb * 0.3162162162;
  c += texture(colorTexture, v_textureCoordinates + o * 3.2307692308).rgb * 0.0702702703;
  c += texture(colorTexture, v_textureCoordinates - o * 3.2307692308).rgb * 0.0702702703;
  out_FragColor = vec4(c, 1.0);
}
`;

const LOOKS = {
  cinematic: {
    exposure: 0.98,
    saturation: 1.12,
    contrast: 1.1,
    vignette: 0.38,
    grain: 0.012,
    bloom: 0.85,
  },
  night: {
    exposure: 1,
    saturation: 1,
    contrast: 1,
    vignette: 0.45,
    grain: 0.015,
    bloom: 1.2,
  },
  thermal: {
    exposure: 1,
    saturation: 1,
    contrast: 1,
    vignette: 0.3,
    grain: 0.006,
    bloom: 0.5,
  },
  nvg: {
    exposure: 1,
    saturation: 1,
    contrast: 1,
    vignette: 0.2,
    grain: 0.012,
    bloom: 0.9,
  },
  clear: {
    exposure: 1,
    saturation: 1,
    contrast: 1,
    vignette: 0,
    grain: 0,
    bloom: 0,
  },
};

export function createPostChain(scene) {
  const params = {
    mode: 0,
    lens: 'cinematic',
    bloomAllowed: true,
    seed: 0,
    ...LOOKS.cinematic,
  };
  const gradeUniforms = {
    mode: () => params.mode,
    vignette: () => params.vignette,
    exposure: () => params.exposure,
    saturation: () => params.saturation,
    contrast: () => params.contrast,
    grain: () => params.grain,
    seed: () => params.seed,
  };

  const stages = scene.postProcessStages;
  stages.fxaa.enabled = true;

  const grade = stages.add(
    new Cesium.PostProcessStage({
      name: 'gev_mobile_grade',
      fragmentShader: GRADE,
      uniforms: gradeUniforms,
    }),
  );

  const generate = new Cesium.PostProcessStageComposite({
    name: 'gev_mobile_bloom_generate',
    stages: [
      new Cesium.PostProcessStage({
        name: 'gev_mobile_bloom_bright',
        fragmentShader: BRIGHT,
        textureScale: 0.5,
        sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
        uniforms: { threshold: () => (params.mode === 2 ? 0.35 : 0.72) },
      }),
      new Cesium.PostProcessStage({
        name: 'gev_mobile_bloom_blur_x',
        fragmentShader: BLUR,
        textureScale: 0.25,
        sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
        uniforms: { direction: new Cesium.Cartesian2(1.6, 0) },
      }),
      new Cesium.PostProcessStage({
        name: 'gev_mobile_bloom_blur_y',
        fragmentShader: BLUR,
        textureScale: 0.25,
        sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
        uniforms: { direction: new Cesium.Cartesian2(0, 1.6) },
      }),
    ],
  });
  const bloom = stages.add(
    new Cesium.PostProcessStageComposite({
      name: 'gev_mobile_bloom',
      inputPreviousStageTexture: false,
      stages: [
        generate,
        new Cesium.PostProcessStage({
          name: 'gev_mobile_grade_bloom',
          fragmentShader: `#define BLOOM\n${GRADE}`,
          uniforms: {
            ...gradeUniforms,
            bloomTexture: generate.name,
            bloomStrength: () => params.bloom,
          },
        }),
      ],
    }),
  );

  function apply() {
    const clear = params.lens === 'clear';
    const useBloom = !clear && params.bloomAllowed && params.bloom > 0;
    grade.enabled = !clear && !useBloom;
    bloom.enabled = useBloom;
    scene.requestRender();
  }

  // Refresh the grain/scintillation seed only on frames that render anyway.
  const removeSeed = scene.preRender.addEventListener(() => {
    params.seed = (params.seed + 0.6180339887) % 1;
  });

  apply();

  return {
    setLens(lens) {
      if (!LENSES.includes(lens)) throw new RangeError(`Unknown lens: ${lens}`);
      params.lens = lens;
      params.mode = LENS_MODE[lens];
      Object.assign(params, LOOKS[lens]);
      apply();
    },
    get lens() {
      return params.lens;
    },
    setBloomAllowed(on) {
      params.bloomAllowed = Boolean(on);
      apply();
    },
    get bloomActive() {
      return bloom.enabled;
    },
    destroy() {
      removeSeed();
      stages.remove(grade);
      stages.remove(bloom);
    },
  };
}
