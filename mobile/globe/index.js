/**
 * God's Eye mobile globe engine: createGlobe(container, options) → Globe API
 * (mobile/DESIGN.md §10).
 *
 * Cesium tuned for phones: no widgets, request-render mode (0 fps at rest),
 * an adaptive pixel-ratio governor, a single-full-res-pass post chain, and
 * live layers drawn with batched billboards and polylines (never Entities,
 * never Cesium labels).
 *
 * Round-two contract additions (full notes in ./API.md):
 *
 *   globe.setViewer({ lon, lat } | null) / globe.viewer()
 *   globe.situations({ observer? }) → Promise<Situation[]>, each Situation now
 *     also has band: 'orbit'|'sky'|'ground'|'inside',
 *     archetype: 'sensor'|'eye'|'track'|'number', telemetry: string,
 *     media?: { kind:'image', url, refreshMs, cameraId, headingDeg? },
 *     series?: [{ t, v }], seriesLabel?, headline?: { value, unit, label },
 *     distanceKm? (once a viewer is known)
 *   globe.omitted() → [{ genre, reason }]   globe.timings() → { genre: ms }
 *   globe.thumbnail(situation, { width=360, height=480, dpr=2 })
 *     → Promise<string> (blob: URL of a composited JPEG; never the viewer)
 *   globe.addPin({ id, lon, lat, kind:'post'|'witness'|'eye'|'live'|'hologram',
 *     headingDeg?, fovDeg?, rangeM?, color?, label?, altM? }) → id
 *   globe.removePin(id) → boolean      globe.pins() → Pin[]
 *     'pick' → { kind:'pin', pinKind, id, title, subtitle, lon, lat, meta }
 *   globe.nearestEye(lon, lat, km=50)
 *     → Promise<{ id, title, lon, lat, distanceKm, headingDeg, fovDeg,
 *                 imageUrl, city, provider } | null>
 *   globe.eyeFrameUrl(cameraId) → string | null
 *   labels() entries may carry `detail` ('CAT 2 · 85 KT · 974 HPA', 'SQ 7700')
 *   New layers: radar, clouds, lightning, wind, jet, air-quality, gnss,
 *     transit; cyclones gain a filled cone and NHC wind radii.
 */
import * as Cesium from 'cesium';
import { createImagery } from './imagery.js';
import { createPostChain, LENSES } from './post.js';
import { createGovernor } from './quality.js';
import { buildLayers, FAMILIES } from './layers/catalog.js';
import { buildSituations } from './situations.js';
import { createContactIndex } from './contacts.js';
import { glyph } from './glyphs.js';
import { subsolarPoint } from './geo.js';
import { AIRPORTS } from './places.js';
import {
  createCctvFeed,
  createCyclonesFeed,
  createEonetFeed,
  createFiresFeed,
  createFlightsFeed,
  createFloodFeed,
  createLaunchesFeed,
  createMilitaryFeed,
  createQuakesFeed,
  createTleFeed,
  createVesselsFeed,
} from './feeds.js';
import {
  createAirQualityFeed,
  createJetFeed,
  createRegionalFlights,
  createTcmFeed,
  createTransitCatalogFeed,
  createWeatherManifestFeed,
  createWindFeed,
} from './feedsWeather.js';
import { cctvFrameUrl, flightFromState } from './feeds.js';
import { createPins } from './pins.js';
import { createCompositor } from './compositor.js';
import { haversineKm } from './geo.js';
import { applyModelAtmosphereWorkaround } from '../../src/app/atmosphereCompat.js';

export { LENSES, FAMILIES };

export const DEFAULT_LAYERS = Object.freeze([
  'flights',
  'iss',
  'earthquakes',
  'cyclones',
  'fires',
  'floods',
  'launches',
]);

const LABEL_PRIORITY = [
  'squawk',
  'air-quality',
  'iss',
  'cyclones',
  'launches',
  'military',
  'earthquakes',
  'floods',
  'volcanoes',
  'helicopters',
  'flights',
  'ga',
  'vessels',
  'tankers',
  'ports',
  'satellites',
  'fires',
  'cctv',
  'starlink',
];

const PLANETARY_LABELS = new Set([
  'squawk',
  'air-quality',
  'iss',
  'cyclones',
  'launches',
  'earthquakes',
  'floods',
]);

const DATA_CREDITS = {
  flights: 'Flights: OpenSky Network (adsb.lol regional fallback)',
  military: 'Military aircraft: adsb.lol (ODbL)',
  helicopters: 'Aircraft: OpenSky Network, adsb.lol',
  ga: 'Aircraft: OpenSky Network',
  squawk: 'Aircraft: OpenSky Network, adsb.lol',
  vessels: 'AIS: AISStream.io',
  tankers: 'AIS: AISStream.io',
  satellites: 'Orbits: CelesTrak GP data, SGP4 via satellite.js',
  iss: 'Orbits: CelesTrak GP data',
  starlink: 'Orbits: CelesTrak GP data',
  launches: 'Launches: The Space Devs · Launch Library 2',
  earthquakes: 'Earthquakes: U.S. Geological Survey',
  fires: 'Fires: NASA FIRMS / NASA EONET',
  cyclones: 'Cyclones: NOAA NHC / CPHC, NASA EONET',
  volcanoes: 'Volcanoes: NASA EONET',
  floods:
    'Bhote Koshi: GeoPera river centerline (CC BY-NC 4.0), Vantor (Maxar) Open Data',
  cctv: 'Cameras: public agency traffic camera feeds (see per-camera provider)',
  radar: 'Radar: NOAA/NWS MRMS via nowCOAST',
  clouds: 'Satellite IR: NOAA/NESDIS via nowCOAST',
  lightning: 'Lightning: NOAA/NWS nowCOAST (Vaisala NLDN/GLD360)',
  wind: 'Wind: NOAA GFS / Open-Meteo',
  jet: 'Jet stream: Open-Meteo (250 hPa)',
  'air-quality': 'Air quality: Open-Meteo / Copernicus CAMS',
  gnss: 'GNSS integrity: adsb.lol (ODbL), gpsjam.org method',
  transit: 'Transit: agency GTFS-realtime feeds (see per-feed credit)',
};

function viewerOptions(creditContainer, options) {
  return {
    animation: false,
    baseLayer: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    vrButton: false,
    creditContainer,
    scene3DOnly: true,
    requestRenderMode: true,
    maximumRenderTimeChange: 60,
    msaaSamples: 1,
    orderIndependentTranslucency: false,
    shadows: false,
    useBrowserRecommendedResolution: true,
    contextOptions: {
      webgl: {
        alpha: false,
        antialias: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: Boolean(options.preserveDrawingBuffer),
      },
    },
  };
}

function tuneScene(viewer) {
  const scene = viewer.scene;
  applyModelAtmosphereWorkaround(scene);
  scene.backgroundColor = Cesium.Color.fromCssColorString('#05070B');
  scene.highDynamicRange = false;
  scene.fog.enabled = true;
  scene.fog.density = 2.0e-4;
  scene.fog.screenSpaceErrorFactor = 4;
  scene.sun.show = true;
  // Cesium's default sun (intensity 2) clips bright deserts and ice.
  scene.light = new Cesium.SunLight({ intensity: 1.4 });
  scene.moon.show = true;
  scene.skyBox.show = true;
  const sky = scene.skyAtmosphere;
  sky.show = true;
  sky.atmosphereLightIntensity = 22;
  sky.saturationShift = 0.05;
  sky.brightnessShift = -0.02;
  sky.hueShift = -0.01;
  sky.perFragmentAtmosphere = false; // per-vertex is plenty on a phone
  const globe = scene.globe;
  globe.showGroundAtmosphere = true;
  globe.atmosphereLightIntensity = 9;
  globe.atmosphereBrightnessShift = 0.0;
  globe.atmosphereSaturationShift = 0.08;
  globe.showWaterEffect = false;
  globe.depthTestAgainstTerrain = false;
  globe.preloadSiblings = false;
  globe.loadingDescendantLimit = 12;
  globe.tileCacheSize = 120;
  globe.showSkirts = true;

  const ssc = scene.screenSpaceCameraController;
  ssc.inertiaSpin = 0.93;
  ssc.inertiaTranslate = 0.92;
  ssc.inertiaZoom = 0.82;
  ssc.minimumZoomDistance = 120;
  ssc.maximumZoomDistance = 45_000_000;
  ssc.bounceAnimationTime = 2.2;
  ssc.enableCollisionDetection = true;
  ssc.maximumMovementRatio = 0.1;
}

/**
 * @param {HTMLElement} container
 * @param {{quality?:'auto'|'low'|'high', layers?:string[], lens?:string,
 *   terrain?:boolean, observer?:{lat:number,lon:number},
 *   googleApiKey?:string, cesiumToken?:string, preserveDrawingBuffer?:boolean}} [options]
 */
export async function createGlobe(container, options = {}) {
  if (!container) throw new TypeError('createGlobe needs a container element');
  const opts = {
    quality: 'auto',
    lens: 'cinematic',
    terrain: true,
    ...options,
  };

  // ── Host & viewer ────────────────────────────────────────────────
  if (getComputedStyle(container).position === 'static')
    container.style.position = 'relative';
  const host = document.createElement('div');
  host.className = 'gev-globe';
  host.style.cssText =
    'position:absolute;inset:0;overflow:hidden;touch-action:none;background:#05070B;';
  container.appendChild(host);
  const creditContainer = document.createElement('div');
  creditContainer.style.display = 'none';

  const viewer = new Cesium.Viewer(host, viewerOptions(creditContainer, opts));
  const scene = viewer.scene;
  const camera = scene.camera;
  const canvas = viewer.canvas;
  canvas.style.outline = 'none';
  tuneScene(viewer);

  // ── Events ───────────────────────────────────────────────────────
  const listeners = new Map();
  const emit = (event, payload) => {
    for (const fn of listeners.get(event) || []) {
      try {
        fn(payload);
      } catch (error) {
        console.error(`[globe] ${event} listener`, error);
      }
    }
  };
  const requestRender = () => {
    if (!viewer.isDestroyed()) scene.requestRender();
  };

  // ── Clock ────────────────────────────────────────────────────────
  const clock = viewer.clock;
  let live = true;
  clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
  clock.shouldAnimate = true;
  clock.currentTime = Cesium.JulianDate.now();
  const timeMs = () => Cesium.JulianDate.toDate(clock.currentTime).getTime();

  // ── Surface, post, quality ───────────────────────────────────────
  const env = import.meta.env || {};
  const imagery = createImagery(viewer, {
    terrain: opts.terrain,
    google: {
      apiKey: opts.googleApiKey ?? env.GOOGLE_MAPS_API_KEY,
      ionToken: opts.cesiumToken ?? env.CESIUM_ION_TOKEN,
      cacheBytes:
        opts.quality === 'low' ? 128 * 1024 * 1024 : 256 * 1024 * 1024,
    },
  });
  const post = createPostChain(scene);
  const governor = createGovernor(viewer, {
    quality: opts.quality,
    post,
    onChange: (q) => emit('quality', q),
  });

  // ── Feeds & layers ───────────────────────────────────────────────
  let active = true;
  let lastView = null;
  const eonet = createEonetFeed();
  const feeds = {
    flights: createFlightsFeed(() => lastView?.center),
    military: createMilitaryFeed(),
    vessels: createVesselsFeed(),
    visual: createTleFeed('visual'),
    stations: createTleFeed('stations'),
    gps: createTleFeed('gps-ops'),
    starlink: createTleFeed('starlink'),
    launches: createLaunchesFeed(),
    quakes: createQuakesFeed(),
    eonet,
    fires: createFiresFeed(eonet),
    cyclones: createCyclonesFeed(eonet),
    cctv: createCctvFeed(),
    flood: createFloodFeed(),
    radar: createWeatherManifestFeed('radar'),
    clouds: createWeatherManifestFeed('clouds'),
    lightning: createWeatherManifestFeed('lightning'),
    wind: createWindFeed(),
    jet: createJetFeed(),
    tcm: createTcmFeed(),
    airQuality: createAirQualityFeed(),
    transitCatalog: createTransitCatalogFeed(),
    regionalFlights: createRegionalFlights(flightFromState),
  };

  let layersTimer = null;
  const ctx = {
    viewer,
    scene,
    requestRender,
    active: () => active && document.visibilityState !== 'hidden',
    timeMs,
    isLive: () => live,
    layersChanged() {
      if (layersTimer) return;
      layersTimer = setTimeout(() => {
        layersTimer = null;
        emit('layers', api.layers());
      }, 60);
    },
  };
  const layers = buildLayers(ctx, feeds);
  const pins = createPins({ scene, requestRender });
  const compositor = createCompositor({ feeds });
  // Slow keyless sources warm in the background so the first feed has them.
  setTimeout(() => {
    for (const f of [
      feeds.jet,
      feeds.tcm,
      feeds.airQuality,
      feeds.cctv,
      feeds.lightning,
      feeds.radar,
      feeds.clouds,
    ])
      f.get().catch(() => {});
  }, 1500);
  let viewerPos = opts.observer
    ? { lon: opts.observer.lon, lat: opts.observer.lat }
    : null;

  // ── Selection visuals ────────────────────────────────────────────
  const selectionRoot = scene.primitives.add(new Cesium.PrimitiveCollection());
  const ringCollection = selectionRoot.add(new Cesium.BillboardCollection());
  const trailCollection = selectionRoot.add(new Cesium.PolylineCollection());
  const ringGlyph = glyph('ring');
  const ring = ringCollection.add({
    image: ringGlyph.image,
    imageId: ringGlyph.imageId,
    show: false,
    scale: 1,
    color: Cesium.Color.fromCssColorString('#FFD166'),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  let selected = null; // { layer, key, pick }

  function drawSelection() {
    if (!selected) {
      ring.show = false;
      trailCollection.removeAll();
      return;
    }
    const layer = layers.get(selected.layer);
    const where = layer?.locate?.(selected.key);
    if (!where) {
      ring.show = false;
      return;
    }
    ring.position = Cesium.Cartesian3.fromDegrees(
      where[0],
      where[1],
      where[2] || 0,
    );
    ring.show = true;
    trailCollection.removeAll();
    const trail = layer.trail?.(selected.key) || [];
    if (trail.length > 1) {
      trailCollection.add({
        positions: trail.map(([lo, la, h]) =>
          Cesium.Cartesian3.fromDegrees(lo, la, h || 0),
        ),
        width: 4,
        material: Cesium.Material.fromType('PolylineGlow', {
          color: Cesium.Color.fromCssColorString('#FFD166').withAlpha(0.8),
          glowPower: 0.18,
          taperPower: 0.6,
        }),
      });
    }
  }

  function resolveSelectable(id) {
    if (id == null) return null;
    if (typeof id === 'object' && id.layer)
      return { layer: id.layer, key: String(id.id ?? id.key) };
    const s = String(id);
    const colon = s.indexOf(':');
    if (colon > 0 && layers.has(s.slice(0, colon)))
      return { layer: s.slice(0, colon), key: s.slice(colon + 1) };
    for (const layer of layers.values()) {
      if (!layer.on) continue;
      if (layer.pick?.(s)) return { layer: layer.id, key: s };
    }
    return null;
  }

  // ── Camera → LOD, Google 3D, 'camera' events ─────────────────────
  const scratchCarto = new Cesium.Cartographic();
  function computeView() {
    const heightM = camera.positionCartographic.height;
    let center = null;
    const mid = new Cesium.Cartesian2(
      canvas.clientWidth / 2,
      canvas.clientHeight / 2,
    );
    const hit = camera.pickEllipsoid(mid, scene.globe.ellipsoid);
    if (hit) {
      Cesium.Cartographic.fromCartesian(
        hit,
        scene.globe.ellipsoid,
        scratchCarto,
      );
      center = {
        lon: Cesium.Math.toDegrees(scratchCarto.longitude),
        lat: Cesium.Math.toDegrees(scratchCarto.latitude),
      };
    } else {
      const c = camera.positionCartographic;
      center = {
        lon: Cesium.Math.toDegrees(c.longitude),
        lat: Cesium.Math.toDegrees(c.latitude),
      };
    }
    let rect = null;
    if (heightM < 8_000_000) {
      const r = camera.computeViewRectangle(scene.globe.ellipsoid);
      if (r)
        rect = {
          west: Cesium.Math.toDegrees(r.west),
          south: Cesium.Math.toDegrees(r.south),
          east: Cesium.Math.toDegrees(r.east),
          north: Cesium.Math.toDegrees(r.north),
        };
    }
    return { heightM, center, rect };
  }

  let viewTimer = null;
  function updateView() {
    viewTimer = null;
    lastView = computeView();
    imagery.onHeight(lastView.heightM);
    for (const layer of layers.values()) if (layer.on) layer.onView(lastView);
    emit('camera', {
      lon: lastView.center.lon,
      lat: lastView.center.lat,
      height: lastView.heightM,
      heading: Cesium.Math.toDegrees(camera.heading),
      pitch: Cesium.Math.toDegrees(camera.pitch),
    });
    requestRender();
  }
  function scheduleView() {
    if (!viewTimer) viewTimer = setTimeout(updateView, 180);
  }
  camera.percentageChanged = 0.02;
  const removeCameraChanged = camera.changed.addEventListener(scheduleView);
  const removeMoveEnd = camera.moveEnd.addEventListener(() => {
    clearTimeout(viewTimer);
    updateView();
  });

  // Layers re-read the view whenever they redraw.
  const refreshLayerViews = () => {
    if (!lastView) lastView = computeView();
    for (const layer of layers.values()) if (layer.on) layer.onView(lastView);
  };
  for (const layer of layers.values()) {
    if (!layer.available) continue;
    const original = layer.refresh.bind(layer);
    layer.refresh = async () => {
      await original();
      if (lastView) layer.onView(lastView);
      if (selected?.layer === layer.id) drawSelection();
    };
  }

  // ── Picking ──────────────────────────────────────────────────────
  const handler = new Cesium.ScreenSpaceEventHandler(canvas);
  handler.setInputAction((movement) => {
    const picked = scene.pick(movement.position, 30, 30);
    const id = picked?.id;
    if (id && typeof id === 'object' && id.layer === 'pins') {
      if (selected) api.select(null);
      emit('pick', pins.pick(id.key));
    } else if (
      id &&
      typeof id === 'object' &&
      id.layer &&
      layers.has(id.layer)
    ) {
      api.select({ layer: id.layer, id: id.key });
      emit('pick', selected?.pick ?? null);
    } else {
      if (selected) api.select(null);
      emit('pick', null);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ── 1 Hz motion tick (dead reckoning, satellites, selection) ─────
  const tick = setInterval(() => {
    if (!ctx.active()) return;
    const now = Date.now();
    const clockMs = timeMs();
    let moved = false;
    for (const layer of layers.values())
      if (layer.on && layer.onTick(now, live, clockMs)) moved = true;
    if (selected) {
      drawSelection();
      moved = true;
    }
    if (pins.tick()) moved = true;
    if (moved) requestRender();
  }, 1000);

  // ── Resize / visibility ──────────────────────────────────────────
  const resizeObserver = new ResizeObserver(() => {
    viewer.resize();
    scheduleView();
    requestRender();
  });
  resizeObserver.observe(container);
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && active) {
      if (live) clock.currentTime = Cesium.JulianDate.now();
      for (const layer of layers.values()) if (layer.on) layer.kick();
      requestRender();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ── Time ─────────────────────────────────────────────────────────
  let timeTimer = null;
  function applyTime() {
    timeTimer = null;
    const ms = timeMs();
    for (const layer of layers.values()) if (layer.on) layer.onTime(ms, live);
    if (selected) drawSelection();
    requestRender();
  }

  // ── Camera helpers ───────────────────────────────────────────────
  function groundHeight(lon, lat) {
    const h = scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat));
    return Number.isFinite(h) ? Math.max(0, h) : 0;
  }

  function flyTo({
    lon,
    lat,
    height = 2_000_000,
    heading = 0,
    pitch = -90,
    duration,
    targetHeight,
  } = {}) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat))
      return Promise.reject(new TypeError('flyTo needs lon and lat'));
    const reduceMotion = globalThis.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    )?.matches;
    const seconds = reduceMotion ? 0 : (duration ?? undefined);
    const h = Cesium.Math.toRadians(heading);
    const p = Cesium.Math.toRadians(Math.max(-90, Math.min(-5, pitch)));
    return new Promise((resolve) => {
      const done = () => {
        updateView();
        resolve();
      };
      if (pitch <= -89.5) {
        camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
          orientation: { heading: h, pitch: p, roll: 0 },
          duration: seconds,
          complete: done,
          cancel: done,
        });
        return;
      }
      const ground = Number.isFinite(targetHeight)
        ? targetHeight
        : groundHeight(lon, lat);
      const range = height / Math.sin(-p);
      camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(lon, lat, ground),
          0,
        ),
        {
          offset: new Cesium.HeadingPitchRange(h, p, range),
          duration: seconds,
          complete: done,
          cancel: done,
        },
      );
      requestRender();
    });
  }

  function homeView() {
    // Centre just past a terminator so day, dusk and city lights share the
    // first frame: of the two terminators, the one whose night side holds
    // more of the world's busiest airports (a cheap proxy for city lights).
    const sun = subsolarPoint(timeMs());
    const score = (centerLon) => {
      let n = 0;
      for (const ap of AIRPORTS) {
        const fromCenter = Math.abs(((ap.lon - centerLon + 540) % 360) - 180);
        const fromSun = Math.abs(((ap.lon - sun.lon + 540) % 360) - 180);
        if (fromCenter < 70 && fromSun > 95) n++;
      }
      return n;
    };
    const dusk = ((sun.lon + 62 + 540) % 360) - 180;
    const dawn = ((sun.lon - 62 + 540) % 360) - 180;
    const lon = score(dusk) >= score(dawn) ? dusk : dawn;
    // Fit the disc to ~92 % of the narrow screen dimension, read from the
    // live projection (Cesium applies `fov` to the narrower side).
    const pm = camera.frustum.projectionMatrix;
    const tanHalf = Math.min(1 / pm[0], 1 / pm[5]);
    const radius = Math.atan(0.92 * tanHalf);
    const height = 6_371_000 / Math.sin(radius) - 6_371_000;
    return {
      lon,
      lat: Math.max(-20, Math.min(30, sun.lat + 15)),
      height: Math.max(9_000_000, Math.min(30_000_000, height)),
      heading: 0,
      pitch: -90,
    };
  }

  // ── API ──────────────────────────────────────────────────────────
  const contactsNearImpl = createContactIndex(feeds, { active: ctx.active });

  const api = {
    flyTo,

    home({ duration } = {}) {
      return flyTo({ ...homeView(), duration });
    },

    layers() {
      return [...layers.values()].map((layer) => layer.info());
    },

    setLayer(id, on) {
      const layer = layers.get(id);
      if (!layer) throw new RangeError(`Unknown layer: ${id}`);
      if (!layer.available) return false;
      layer.setOn(on);
      if (on) {
        if (lastView) layer.onView(lastView);
        layer.onTime(timeMs(), live);
      } else if (selected?.layer === id) api.select(null);
      return true;
    },

    setFamily(family, on) {
      for (const layer of layers.values())
        if (layer.family === family && layer.available)
          api.setLayer(layer.id, on);
    },

    setTime(date) {
      if (date == null) {
        live = true;
        clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
        clock.shouldAnimate = true;
        clock.currentTime = Cesium.JulianDate.now();
        applyTime();
        emit('time', { live: true, time: new Date() });
        return;
      }
      const ms = date instanceof Date ? date.getTime() : Number(date);
      if (!Number.isFinite(ms))
        throw new TypeError('setTime needs a Date, epoch ms or null');
      live = false;
      clock.shouldAnimate = false;
      clock.clockStep = Cesium.ClockStep.TICK_DEPENDENT;
      clock.currentTime = Cesium.JulianDate.fromDate(new Date(ms));
      // Coalesce a fast scrub into ~20 layer updates a second.
      if (!timeTimer) timeTimer = setTimeout(applyTime, 50);
      requestRender();
      emit('time', { live: false, time: new Date(ms) });
    },

    time() {
      return { live, time: new Date(timeMs()) };
    },

    timeWindow() {
      const now = Date.now();
      return {
        start: new Date(now - 72 * 3600_000),
        end: new Date(now + 120 * 3600_000),
        now: new Date(now),
      };
    },

    setLens(id) {
      post.setLens(id);
      imagery.setNightMode(id === 'night' || id === 'nvg');
      emit('lens', { id });
    },

    lens() {
      return post.lens;
    },

    async focus(situation, { solo = false } = {}) {
      if (!situation) return;
      if (solo)
        for (const layer of layers.values())
          if (layer.on && !situation.layers?.includes(layer.id))
            layer.setOn(false);
      for (const id of situation.layers || [])
        if (layers.has(id)) api.setLayer(id, true);
      if (Number.isFinite(situation.time?.at))
        api.setTime(new Date(situation.time.at));
      else if (!live) api.setTime(null);
      const cam = situation.camera || {};
      await flyTo({
        lon: cam.lon ?? situation.lon,
        lat: cam.lat ?? situation.lat,
        height: cam.height ?? 200_000,
        heading: cam.heading ?? 0,
        pitch: cam.pitch ?? -60,
        duration: cam.duration,
        targetHeight: cam.targetHeight,
      });
    },

    select(id) {
      const target = resolveSelectable(id);
      if (!target) {
        selected = null;
        drawSelection();
        requestRender();
        return null;
      }
      const pick = layers.get(target.layer).pick(target.key);
      if (!pick) {
        selected = null;
        drawSelection();
        return null;
      }
      selected = { ...target, pick };
      drawSelection();
      requestRender();
      return pick;
    },

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => api.off(event, fn);
    },

    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },

    pause() {
      if (!active) return;
      active = false;
      viewer.useDefaultRenderLoop = false;
    },

    resume() {
      if (active) return;
      active = true;
      viewer.useDefaultRenderLoop = true;
      if (live) clock.currentTime = Cesium.JulianDate.now();
      for (const layer of layers.values()) if (layer.on) layer.kick();
      scheduleView();
      requestRender();
    },

    contactsNear(lon, lat, km = 50) {
      return contactsNearImpl(lon, lat, km, { timeMs: timeMs() }).map(
        ({
          kind,
          id,
          title,
          lon: lo,
          lat: la,
          altM,
          headingDeg,
          speedMps,
          distanceKm,
        }) => ({
          kind,
          id,
          title,
          lon: lo,
          lat: la,
          altM,
          headingDeg,
          speedMps,
          distanceKm,
        }),
      );
    },

    situations(extra = {}) {
      const observer = extra.observer ?? viewerPos ?? opts.observer;
      return buildSituations({ feeds, timeMs }, { observer }).then((list) => {
        if (observer && Number.isFinite(observer.lat))
          for (const s of list)
            s.distanceKm = Math.round(
              haversineKm(observer.lat, observer.lon, s.lat, s.lon),
            );
        return list;
      });
    },

    /** Genres the last situations() call left out, and why (for QA/UI). */
    omitted() {
      return buildSituations.lastOmitted || [];
    },

    /** Per-genre build times (ms since the feeds resolved) of the last call. */
    timings() {
      return buildSituations.lastTimings || {};
    },

    /** Where the person is (for distanceKm and "near you"); null clears. */
    setViewer(pos) {
      viewerPos =
        pos && Number.isFinite(pos.lon) && Number.isFinite(pos.lat)
          ? { lon: pos.lon, lat: pos.lat }
          : null;
      emit('viewer', viewerPos);
    },

    viewer() {
      return viewerPos ? { ...viewerPos } : null;
    },

    /** Card compositor: Promise<object URL> (see API.md). */
    thumbnail(situation, options) {
      return compositor.thumbnail(situation, options);
    },

    addPin(pin) {
      return pins.add(pin);
    },

    removePin(id) {
      return pins.remove(id);
    },

    pins() {
      return pins.list();
    },

    /** Nearest public camera within `km`, from the CCTV catalog. */
    async nearestEye(lon, lat, km = 50) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      let data;
      try {
        data = await feeds.cctv.get();
      } catch {
        return null;
      }
      let best = null;
      for (const c of data.records) {
        if (Math.abs(c.lat - lat) > km / 100 + 0.5) continue;
        const d = haversineKm(lat, lon, c.lat, c.lon);
        if (d <= km && (!best || d < best.d)) best = { c, d };
      }
      if (!best) return null;
      const c = best.c;
      return {
        id: c.id,
        title: c.name,
        lon: c.lon,
        lat: c.lat,
        distanceKm: Math.round(best.d * 100) / 100,
        headingDeg: c.heading,
        fovDeg: c.fovDeg,
        imageUrl: cctvFrameUrl(c),
        city: c.city,
        provider: c.provider,
      };
    },

    /** A fresh same-origin frame URL for a catalog camera (or null). */
    eyeFrameUrl(cameraId) {
      const c = feeds.cctv.data?.records.find((r) => r.id === cameraId);
      return c ? cctvFrameUrl(c) : null;
    },

    credits() {
      const list = imagery.credits();
      for (const layer of layers.values())
        if (layer.on && DATA_CREDITS[layer.id])
          list.push({
            id: `data-${layer.id}`,
            text: DATA_CREDITS[layer.id],
            html: DATA_CREDITS[layer.id],
          });
      return list;
    },

    /** Screen position (CSS px) of a point, or null when behind the globe. */
    project(lon, lat, altM = 0) {
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
      const occluder = new Cesium.EllipsoidalOccluder(
        scene.globe.ellipsoid,
        camera.positionWC,
      );
      if (!occluder.isPointVisible(position)) return null;
      const p = scene.cartesianToCanvasCoordinates(position);
      return p ? { x: p.x, y: p.y } : null;
    },

    /**
     * Up to `max` contacts worth an HTML label right now (DESIGN.md §5: no
     * Cesium labels, ≤ 40 visible): on-screen glyphs, selected first, then
     * by layer priority and distance from the screen centre.
     */
    labels(max = 40) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const heightM = camera.positionCartographic.height;
      const planetary = heightM > 3_000_000;
      const occluder = new Cesium.EllipsoidalOccluder(
        scene.globe.ellipsoid,
        camera.positionWC,
      );
      const scratch = new Cesium.Cartesian2();
      const candidates = [];
      for (const layer of layers.values()) {
        const glyphs =
          layer.on && layer.renderer?.glyphMode && layer.renderer.glyphs;
        if (!glyphs) continue;
        // Semantic zoom for words too: from orbit only the headline layers.
        if (planetary && !PLANETARY_LABELS.has(layer.id)) continue;
        if (layer.id === 'lightning') continue; // the glow is the label
        const rank = LABEL_PRIORITY.indexOf(layer.id);
        for (let i = 0; i < glyphs.length; i++) {
          const bb = glyphs.get(i);
          if (!occluder.isPointVisible(bb.position)) continue;
          const p = scene.cartesianToCanvasCoordinates(bb.position, scratch);
          if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
          const isSelected =
            selected?.layer === layer.id && selected?.key === bb.id.key;
          const d = Math.hypot(p.x - w / 2, p.y - h / 2) / Math.max(w, h);
          candidates.push({
            layer,
            key: bb.id.key,
            x: p.x,
            y: p.y,
            score: (isSelected ? -100 : 0) + (rank < 0 ? 20 : rank) + d * 4,
          });
        }
      }
      for (let i = 0; i < pins.billboards.length; i++) {
        const bb = pins.billboards.get(i);
        if (!occluder.isPointVisible(bb.position)) continue;
        const p = scene.cartesianToCanvasCoordinates(bb.position, scratch);
        if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
        candidates.push({
          layer: { id: 'pins', pick: (key) => pins.pick(key) },
          key: bb.id.key,
          x: p.x,
          y: p.y,
          score: -50,
        });
      }
      candidates.sort((a, b) => a.score - b.score);
      // Greedy placement: a label never overlaps one already placed.
      const placed = [];
      const out = [];
      for (const c of candidates) {
        if (out.length >= max) break;
        const pick = c.layer.pick(c.key);
        if (!pick) continue;
        if (
          planetary &&
          pick.kind === 'earthquake' &&
          !(pick.meta?.magnitude >= 5.5)
        )
          continue;
        const box = {
          x0: c.x + 6,
          x1: c.x + 20 + pick.title.length * 6.2,
          y0: c.y - 10,
          y1: c.y + 10,
        };
        if (
          placed.some(
            (b) =>
              box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0,
          )
        )
          continue;
        placed.push(box);
        out.push({
          id: pick.id,
          layer: c.layer.id,
          kind: pick.kind,
          title: pick.title,
          ...(pick.labelDetail ? { detail: pick.labelDetail } : {}),
          ...(pick.pinKind ? { pinKind: pick.pinKind } : {}),
          x: c.x,
          y: c.y,
        });
      }
      return out;
    },

    quality() {
      return governor.state();
    },

    setQuality(q) {
      governor.setQuality(q);
    },

    requestRender,

    get viewer() {
      return viewer;
    },

    destroy() {
      clearInterval(tick);
      clearTimeout(viewTimer);
      clearTimeout(layersTimer);
      clearTimeout(timeTimer);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      removeCameraChanged();
      removeMoveEnd();
      handler.destroy();
      for (const layer of layers.values()) layer.destroy();
      pins.destroy();
      compositor.destroy();
      governor.destroy();
      post.destroy();
      viewer.destroy();
      host.remove();
      listeners.clear();
    },
  };

  // ── Boot ─────────────────────────────────────────────────────────
  const home = homeView();
  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(home.lon, home.lat, home.height),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
  });
  api.setLens(opts.lens);
  lastView = computeView();
  for (const id of opts.layers ?? DEFAULT_LAYERS)
    if (layers.has(id)) api.setLayer(id, true);
  refreshLayerViews();
  requestRender();
  // Listeners attach after this resolves: hand them the starting state.
  setTimeout(() => {
    emit('quality', governor.state());
    emit('layers', api.layers());
  }, 0);
  return api;
}
