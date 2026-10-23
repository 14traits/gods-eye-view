/**
 * Planet surface for the mobile globe: Esri World Imagery by day, NASA Black
 * Marble city lights by night (blended across the terminator by Cesium's
 * per-layer dayAlpha/nightAlpha with the sun from the scene clock), keyless
 * Re:Earth terrain, and Google Photorealistic 3D Tiles below ~25 km when the
 * build carries a Google key or Cesium ion token.
 */
import * as Cesium from 'cesium';
import { createEsriImagery } from '../../src/maps/imagery.js';
import { createKeylessTerrain } from '../../src/maps/terrain.js';
import { loadPhotorealisticTileset } from '../../src/maps/google3d.js';
import { subsolarPoint } from './geo.js';

/** NASA GIBS VIIRS Black Marble (2016), Web Mercator, keyless, CORS-enabled. */
export const BLACK_MARBLE_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';

export const GOOGLE_3D_MAX_HEIGHT_M = 25_000;
const LIGHT_FULL_BELOW_M = 400_000;
const LIGHT_FULL_ABOVE_M = 2_500_000;
/** Cesium's night side keeps 0.3 of the lit colour (GlobeFS diffuse floor). */
const NIGHT_DIFFUSE_FLOOR = 0.3;
const NIGHT_LIGHTS_GAIN = 1.3;
/**
 * Close-in night grade. Below ~400 km Cesium's lighting is faded out and the
 * 500 m Black Marble mosaic is only a blur, so a night-side close-up shows the
 * Esri day mosaic graded toward night (darker, desaturated, cooler) with a
 * soft glow of the real city lights over it: the city stays readable at any
 * hour. The sun is taken from the scene clock, so a Moment keeps the lighting
 * of its own time.
 */
const GRADE = Object.freeze({
  brightness: 0.5,
  contrast: 1.18,
  saturation: 0.38,
  gamma: 0.9,
  hue: 0.04,
  glow: 0.3,
});
/**
 * Terrain watchdog: when the globe has had nothing to draw for this long
 * while it is on screen (the keyless terrain host throttles under load, and
 * Cesium then shows only the star field), fall back to the flat ellipsoid.
 */
const TERRAIN_STALL_MS = 3000;

export const BASE_CREDITS = Object.freeze([
  {
    id: 'esri',
    text: 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    html: '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  {
    id: 'black-marble',
    text: 'Night lights: NASA Earth Observatory / GIBS, VIIRS Black Marble',
    html: 'Night lights: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a> VIIRS Black Marble',
  },
]);

const TERRAIN_CREDIT = {
  id: 'terrain',
  text: 'Terrain: Re:Earth / Mapterhorn (CC BY 4.0)',
  html: 'Terrain: <a href="https://reearth.io" target="_blank" rel="noopener">Re:Earth</a> / Mapterhorn, CC BY 4.0',
};

export function createImagery(viewer, { terrain = true, google = {} } = {}) {
  const scene = viewer.scene;
  const globe = scene.globe;
  const layers = viewer.imageryLayers;

  const day = Cesium.ImageryLayer.fromProviderAsync(createEsriImagery(), {
    dayAlpha: 1,
    nightAlpha: 1,
  });
  layers.add(day);

  const night = new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: BLACK_MARBLE_URL,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      maximumLevel: 8,
      credit: 'NASA GIBS · VIIRS Black Marble',
    }),
    {
      dayAlpha: 0,
      nightAlpha: 1,
      brightness: NIGHT_LIGHTS_GAIN / NIGHT_DIFFUSE_FLOOR,
      contrast: 1.2,
      gamma: 0.85,
      saturation: 1.15,
    },
  );
  layers.add(night);

  globe.enableLighting = true;
  globe.dynamicAtmosphereLighting = true;
  globe.dynamicAtmosphereLightingFromSun = true;
  // Cesium measures these from the Earth's centre. Lighting (and so the
  // terminator) is full above ~2,500 km and fades to fully lit below
  // ~400 km, where the 500 m night mosaic would only be a blur.
  const R = 6_371_000;
  globe.lightingFadeOutDistance = R + LIGHT_FULL_BELOW_M;
  globe.lightingFadeInDistance = R + LIGHT_FULL_ABOVE_M;
  // GlobeFS mixes the surface toward bare ground atmosphere, weighted by
  // the sun angle, by k = clamp((dist - nightFadeIn) / (nightFadeOut -
  // nightFadeIn), 0.05, 1). Cesium's defaults drive k to 0.05 from orbit,
  // which blacks out the night hemisphere and its city lights. Here k is
  // ~0.6 from orbit (a soft sun-angle falloff on the day side, lights kept
  // on the night side) and 1 below ~3,600 km. nightFadeOut also selects
  // per-fragment ground atmosphere above it, so it keeps the default π/2·R.
  globe.nightFadeOutDistance = (Math.PI / 2) * R;
  globe.nightFadeInDistance = 5.0e7;
  globe.baseColor = Cesium.Color.fromCssColorString('#03060b');

  const state = {
    day,
    night,
    terrainCredit: false,
    google: null,
    googleRoute: null,
    googleLoading: null,
    nightMode: false,
    heightM: 2e7,
    googleWanted: Boolean(
      String(google.apiKey || '').trim() ||
      String(google.ionToken || '').trim(),
    ),
  };

  let stallTimer = 0;
  if (terrain) {
    createKeylessTerrain().then(({ provider, fallback }) => {
      if (viewer.isDestroyed()) return;
      viewer.terrainProvider = provider;
      state.terrainCredit = !fallback;
      scene.requestRender();
      if (!fallback) watchTerrain(provider);
    });
  }

  function watchTerrain(provider) {
    let emptySince = 0;
    stallTimer = setInterval(() => {
      if (viewer.isDestroyed() || viewer.terrainProvider !== provider)
        return clearInterval(stallTimer);
      // Only while the globe is on screen (a paused globe proves nothing).
      if (document.hidden || !globe.show || !viewer.useDefaultRenderLoop) {
        emptySince = 0;
        return;
      }
      // Private, read defensively: how many tiles the globe could draw.
      const n = globe._surface?._tilesToRender?.length;
      if (n == null || n > 0) {
        emptySince = 0;
        return;
      }
      scene.requestRender();
      if (!emptySince) emptySince = performance.now();
      else if (performance.now() - emptySince > TERRAIN_STALL_MS) {
        clearInterval(stallTimer);
        console.warn('[globe] terrain stalled; using the flat ellipsoid');
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
        state.terrainCredit = false;
        scene.requestRender();
      }
    }, 1500);
  }

  async function ensureGoogle() {
    if (!state.googleWanted || state.google || state.googleLoading) return;
    state.googleLoading = loadPhotorealisticTileset(Cesium, {
      googleApiKey: google.apiKey,
      cesiumToken: google.ionToken,
    })
      .then(({ tileset, route, errors }) => {
        if (!tileset) {
          state.googleWanted = false;
          console.warn('[globe] Google 3D unavailable', errors);
          return;
        }
        tileset.maximumScreenSpaceError = 16;
        tileset.cacheBytes = google.cacheBytes ?? 256 * 1024 * 1024;
        tileset.show = false;
        scene.primitives.add(tileset);
        state.google = tileset;
        state.googleRoute = route;
        tileset.tileLoad.addEventListener(() => scene.requestRender());
      })
      .catch((error) => {
        state.googleWanted = false;
        console.warn('[globe] Google 3D failed', error);
      })
      .finally(() => {
        state.googleLoading = null;
      });
  }

  /**
   * Keep city lights at a constant apparent brightness while Cesium fades
   * lighting out with altitude, and hand the night side back to day imagery
   * close in.
   */
  function tuneNight() {
    if (state.nightMode) return;
    const h = state.heightM;
    const fade = Math.min(
      1,
      Math.max(
        0,
        (h - LIGHT_FULL_BELOW_M) / (LIGHT_FULL_ABOVE_M - LIGHT_FULL_BELOW_M),
      ),
    );
    const diffuse = 1 + (NIGHT_DIFFUSE_FLOOR - 1) * fade;
    night.brightness = NIGHT_LIGHTS_GAIN / diffuse;
    night.nightAlpha = Math.min(1, Math.max(0, (h - 300_000) / 700_000));
  }

  /**
   * Night grade for close-in views (see GRADE): strength follows the sun's
   * elevation under the camera and fades out as Cesium's own lighting fades
   * in with altitude.
   */
  let gradeK = -1;
  let gradeStrength = 0;
  function grade() {
    if (state.nightMode) return;
    // The camera's own height, every frame (the view handler is throttled).
    const h = scene.camera.positionCartographic.height;
    const close =
      1 -
      Math.min(
        1,
        Math.max(
          0,
          (h - LIGHT_FULL_BELOW_M) / (LIGHT_FULL_ABOVE_M - LIGHT_FULL_BELOW_M),
        ),
      );
    let k = 0;
    if (close > 0) {
      const c = scene.camera.positionCartographic;
      const ms = Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();
      const sun = subsolarPoint(ms);
      const D = Math.PI / 180;
      const lat = c.latitude;
      const dLon = c.longitude - sun.lon * D;
      const sinEl =
        Math.sin(lat) * Math.sin(sun.lat * D) +
        Math.cos(lat) * Math.cos(sun.lat * D) * Math.cos(dLon);
      const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / D;
      // Civil twilight: full grade once the sun is 8° down, none at +4°.
      const night = Math.min(1, Math.max(0, (4 - el) / 12));
      k = Math.round(night * close * 50) / 50;
    }
    const glow = GRADE.glow * k * Math.min(1, Math.max(0, (h - 40e3) / 160e3));
    const key = k * 1000 + Math.round(glow * 50);
    if (key === gradeK) return;
    gradeK = key;
    gradeStrength = k;
    const mix = (a, b) => a + (b - a) * k;
    day.brightness = mix(1, GRADE.brightness);
    day.contrast = mix(1, GRADE.contrast);
    day.saturation = mix(1, GRADE.saturation);
    day.gamma = mix(1, GRADE.gamma);
    day.hue = mix(0, GRADE.hue);
    if (k > 0) {
      // Lighting is faded out this close: one glow alpha for both sides.
      // Below ~150 km a whole lit city is one 500 m blur, so the glow fades
      // out and the graded day mosaic carries the night alone.
      night.dayAlpha = glow;
      night.nightAlpha = glow;
      night.brightness = 1.6;
    } else {
      night.dayAlpha = 0;
      tuneNight();
    }
    scene.requestRender();
  }
  const removeGradeListener = scene.preRender.addEventListener(grade);

  /** Swap globe ↔ photorealistic tiles by camera height. */
  function onHeight(heightM) {
    state.heightM = heightM;
    gradeK = -1;
    tuneNight();
    grade();
    if (!state.googleWanted) return;
    const close = heightM < GOOGLE_3D_MAX_HEIGHT_M;
    if (close) ensureGoogle();
    if (!state.google) return;
    if (state.google.show !== close) {
      state.google.show = close;
      globe.show = !close;
      scene.requestRender();
    }
  }

  /** Night mode: Black Marble everywhere, unshaded (lighting off). */
  function setNightMode(on) {
    state.nightMode = Boolean(on);
    if (on) {
      day.brightness = 1;
      day.contrast = 1;
      day.saturation = 1;
      day.gamma = 1;
      day.hue = 0;
    }
    gradeK = -1;
    globe.enableLighting = !on;
    night.dayAlpha = on ? 1 : 0;
    night.nightAlpha = 1;
    night.brightness = on ? 1.25 : night.brightness;
    if (!on) {
      tuneNight();
      grade();
    }
    scene.requestRender();
  }

  function credits() {
    const list = [...BASE_CREDITS];
    if (state.terrainCredit) list.push(TERRAIN_CREDIT);
    if (state.google?.show) {
      list.push({
        id: 'google',
        text: 'Google Photorealistic 3D Tiles',
        html: 'Google — 3D Tiles © Google',
        onScreen: true,
        logo: true,
      });
    }
    return list;
  }

  return {
    state,
    onHeight,
    setNightMode,
    credits,
    /** Night-grade strength 0..1 (0 by day or from orbit). */
    get nightGrade() {
      return gradeStrength;
    },
    destroy() {
      removeGradeListener();
      clearInterval(stallTimer);
    },
    get googleActive() {
      return Boolean(state.google?.show);
    },
  };
}
