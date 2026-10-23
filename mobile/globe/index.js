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
 *
 * Round-three additions (DESIGN.md §12, full notes in ./API.md):
 *
 *   globe.situations({ cached: true })   instant first frame (IDB / bundled)
 *   globe.cachedThumbnail(situation)     bundled / cached thumb URL (sync)
 *   globe.history() → { start, end, entities, points }   the recorder
 *   globe.trackOf(entityId) → Promise<[{ t, lon, lat, altM, headingDeg, speed }]>
 *   globe.playback.play({ speed }) / stop() / state()   event 'playback'
 *   globe.timeline({ from, to }) → [{ t, kind, band, title, severity, … }]
 *   globe.detections() → Situation[]     circling, quake clusters
 *   globe.moments() / moment(id) / momentOfTheDay() / playMoment(m, opts)
 *     / exitMoment() / activeMoment() / seekMoment(t) / momentCamera(on)
 *     event 'moment' → { type, item, t, momentId }
 *   globe.entity(ref) → Promise<Dossier>   globe.search(q)   globe.graph(ref)
 *   globe.react({ lon, lat, kind, count })   globe.attentionHeat(points)
 *   globe.skyNow({ lon, lat }) → Promise<{ aircraft, satellites, iss }>
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
import { createRecorder } from './recorder.js';
import { createArchive, historyView } from './archive.js';
import { createDetector } from './detect.js';
import { circlingCard, quakeClusterCard } from './detectCards.js';
import { createGhosts } from './ghosts.js';
import { createStage } from './stage.js';
import {
  loadBuildings,
  loadWater,
  loadHero,
  momentFromAircraft,
  momentFromCircling,
} from './moments.js';
import { createEntities } from './entities.js';
import { createReactions } from './reactions.js';
import { skyNow } from './sky.js';
import {
  cachedThumbnail,
  loadCachedSituations,
  saveSituations,
} from './cache.js';

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

/**
 * Where helicopters gather for news: when OpenSky is unavailable the flights
 * feed is a 250 nm snapshot around the view, so the recorder also polls
 * these anchors (and the viewer) to give the circling detector real data.
 */
const WATCH_ANCHORS = Object.freeze([
  { key: 'watch:nyc', lat: 40.75, lon: -73.98 },
  { key: 'watch:lon', lat: 51.51, lon: -0.12 },
  { key: 'watch:la', lat: 34.05, lon: -118.25 },
]);
const WATCH_POLL_MS = 15_000;
const PLAYBACK_SPEEDS = Object.freeze([1, 10, 30, 60, 600]);

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
  globe.tileCacheSize = 320;
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
    timeMode: (ms, isLive) => timeMode(ms, isLive),
    layersChanged() {
      if (layersTimer) return;
      layersTimer = setTimeout(() => {
        layersTimer = null;
        emit('layers', api.layers());
      }, 60);
    },
  };
  // ── Recorder, detector, history, Moments ─────────────────────────
  const recorder = createRecorder({ persist: opts.record !== false });
  // The bundled real recording, so the time machine always has ghosts.
  const archive = createArchive();
  const history = historyView(recorder, archive);
  const detector = createDetector(recorder);
  let momentState = null; // { moment, idx, prevT, restore }
  let momentToken = 0;
  function timeMode(ms, isLive) {
    if (momentState) return 'moment';
    if (!isLive && history.covers(ms, 90_000)) return 'history';
    return 'none';
  }
  const ingestFeed = (feed, kind) =>
    feed.subscribe((f) => {
      if (f.data?.records && f.error == null)
        recorder.ingest(f.data.records, { kind });
    });
  const unsubs = [
    ingestFeed(feeds.flights, 'aircraft'),
    ingestFeed(feeds.military, 'military'),
    ingestFeed(feeds.vessels, 'vessel'),
  ];
  // Regional snapshots (fallback anchors, situations, sky-now) are recorded too.
  {
    const get = feeds.regionalFlights.get.bind(feeds.regionalFlights);
    const seenData = new WeakSet();
    feeds.regionalFlights.get = async (...args) => {
      const data = await get(...args);
      if (data?.records && !seenData.has(data)) {
        seenData.add(data);
        recorder.ingest(data.records, {
          kind: 'aircraft',
          at: data.time || Date.now(),
        });
      }
      return data;
    };
  }
  recorder.load().catch(() => {});
  let watchTimer = null;
  const watchAnchors = opts.watchAnchors ?? WATCH_ANCHORS;
  async function pollWatch() {
    watchTimer = setTimeout(pollWatch, WATCH_POLL_MS);
    if (!ctx.active() || opts.record === false) return;
    // With global OpenSky coverage the flights feed already records them.
    const f = feeds.flights.data;
    if (f && !f.regional && !feeds.flights.error) {
      if (Date.now() - feeds.flights.updatedAt > 30_000)
        feeds.flights.get({ maxAgeMs: 12_000 }).catch(() => {});
    } else {
      const anchors = [...watchAnchors];
      if (viewerPos)
        anchors.push({
          key: 'watch:viewer',
          lat: viewerPos.lat,
          lon: viewerPos.lon,
        });
      await Promise.allSettled(
        anchors.map((a) =>
          feeds.regionalFlights.get(
            a.key,
            { lat: a.lat, lon: a.lon },
            { maxAgeMs: WATCH_POLL_MS - 1000 },
          ),
        ),
      );
    }
    feeds.military.get({ maxAgeMs: 20_000 }).catch(() => {});
    const before = detector.current().length;
    const now = detector.run();
    if (now.length !== before) emit('detections', now);
  }
  watchTimer = setTimeout(pollWatch, 2500);

  const layers = buildLayers(ctx, feeds);
  const pins = createPins({ scene, requestRender });
  const compositor = createCompositor({ feeds });
  const ghosts = createGhosts({ scene, recorder: history, requestRender });
  const stage = createStage({ scene, requestRender, emit });
  const reactions = createReactions({
    host,
    project: (lon, lat, altM) => api.project(lon, lat, altM),
  });
  const removePostRender = scene.postRender.addEventListener(() =>
    reactions.afterRender(),
  );
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
  }, 4000);
  // The bundled recording loads after the first frame (≈ 3 MB of JSON).
  setTimeout(() => {
    archive
      .load()
      .then(() => emit('history', api.history()))
      .catch(() => {});
  }, 5000);
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
    if (!momentState && !live && timeMode(timeMs(), live) === 'history')
      ghosts.update(timeMs(), lastView, { force: true });
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
    } else if (id && typeof id === 'object' && id.layer === 'history') {
      if (selected) api.select(null);
      emit('pick', ghosts.pick(id.key));
    } else if (id && typeof id === 'object' && id.layer === 'moment') {
      if (selected) api.select(null);
      emit('pick', stage.pick(id.key));
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
    if (timeMode(ms, live) === 'history') ghosts.update(ms, lastView);
    else ghosts.hide();
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
    eye = false,
  } = {}) {
    // eye: lon/lat/height place the camera itself (not the point it looks at).
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
      if (pitch <= -89.5 || eye) {
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

  // ── Clock control (scrub, playback, Moments) ───────────────────
  /** Put the clock at `ms` (the past or a Moment). Cheap enough per frame. */
  function setClock(ms, { fromPlayback = false } = {}) {
    live = false;
    clock.shouldAnimate = false;
    clock.clockStep = Cesium.ClockStep.TICK_DEPENDENT;
    clock.currentTime = Cesium.JulianDate.fromDate(new Date(ms));
    // Coalesce layer updates: ~20/s while scrubbing, ~5/s while playing.
    if (!timeTimer) timeTimer = setTimeout(applyTime, fromPlayback ? 200 : 50);
    if (momentState) {
      stage.update(ms);
      momentTick(ms, { fromPlayback });
    } else if (timeMode(ms, false) === 'history' && fromPlayback)
      ghosts.update(ms, lastView);
    requestRender();
  }

  let playing = false;
  let playSpeed = 60;
  let playRaf = 0;
  let playLast = 0;
  let playEmit = 0;
  let playUntil = null;
  function playbackState() {
    return { playing, speed: playSpeed, t: timeMs(), live };
  }
  function stopPlayback() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(playRaf);
    playRaf = 0;
    applyTime();
    emit('playback', playbackState());
  }
  function playFrame(now) {
    if (!playing) return;
    const dt = Math.min(0.5, Math.max(0, (now - playLast) / 1000));
    playLast = now;
    let t = timeMs() + dt * playSpeed * 1000;
    const end = playUntil ?? Date.now();
    if (t >= end) {
      t = end;
      if (momentState) {
        setClock(t, { fromPlayback: true });
        stopPlayback();
        return;
      }
      stopPlayback();
      api.setTime(null);
      return;
    }
    setClock(t, { fromPlayback: true });
    if (now - playEmit > 250) {
      playEmit = now;
      emit('playback', playbackState());
      emit('time', { live: false, time: new Date(t), playing: true });
    }
    playRaf = requestAnimationFrame(playFrame);
  }
  function startPlayback({ speed, from, until } = {}) {
    if (Number.isFinite(speed) && speed > 0) playSpeed = speed;
    playUntil = Number.isFinite(until)
      ? until
      : momentState
        ? momentState.moment.time.end
        : null;
    let t = Number.isFinite(from) ? from : timeMs();
    if (live && !Number.isFinite(from)) {
      // From now there is nothing to play forward: replay the last 15 min.
      const h = recorder.range();
      t = Math.max(
        h.start ?? Date.now() - 15 * 60_000,
        Date.now() - 15 * 60_000,
      );
    }
    if (momentState && t >= momentState.moment.time.end - 500)
      t = momentState.moment.time.start;
    setClock(t, { fromPlayback: true });
    playing = true;
    playLast = performance.now();
    cancelAnimationFrame(playRaf);
    playRaf = requestAnimationFrame(playFrame);
    emit('playback', playbackState());
  }

  // ── Moments ──────────────────────────────────────────────────────
  const momentCache = new Map(); // id → Moment (bundled and built)
  let heroLoaded = null;
  function hero() {
    if (!heroLoaded)
      heroLoaded = loadHero().then((m) => {
        momentCache.set(m.id, m);
        return m;
      });
    return heroLoaded;
  }
  function liveMoments() {
    const out = [];
    for (const det of detector.current()) {
      const m = momentFromCircling(det, recorder);
      if (m.tracks.length >= 1) {
        momentCache.set(m.id, m);
        out.push(m);
      }
    }
    for (const e of recorder.events()) {
      if (e.kind !== 'squawk' || Date.now() - e.t > 3 * 3600_000) continue;
      const m = squawkMoment(e.key, e.title);
      if (m) out.push(m);
    }
    return out;
  }
  function squawkMoment(key, title) {
    const meta = recorder.meta(key);
    const points = recorder
      .samples(key)
      .map((p) => ({ t: p.t, lon: p.lon, lat: p.lat, altM: p.altM }));
    if (points.length < 4) return null;
    const m = momentFromAircraft({
      id: `live-squawk-${key}`,
      title: title || `${meta?.callsign || key} squawking`,
      key,
      points,
      meta,
    });
    if (m) momentCache.set(m.id, m);
    return m;
  }
  async function resolveMoment(idOrMoment) {
    if (idOrMoment && typeof idOrMoment === 'object') return idOrMoment;
    const id = String(idOrMoment || '');
    if (!id || id === 'empire-state' || id === 'hero') return hero();
    if (id.startsWith('live-circling-')) {
      const det = detector.get(id.slice(5));
      if (det) {
        const m = momentFromCircling(det, recorder);
        momentCache.set(m.id, m);
        return m;
      }
    }
    if (id.startsWith('live-squawk-')) {
      const key = id.slice('live-squawk-'.length);
      const ev = recorder.events().find((e) => e.key === key);
      const m = squawkMoment(key, ev?.title);
      if (m) return m;
    }
    return momentCache.get(id) || null;
  }
  const sortedBy = (list) => (list || []).slice().sort((a, b) => a.t - b.t);
  function indexAfter(list, t) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** Emit 'moment' events for items the clock just passed. */
  function momentTick(t, { fromPlayback = false } = {}) {
    const st = momentState;
    if (!st) return;
    const jump = t - st.prevT;
    const quiet = jump < 0 || (!fromPlayback && jump > 90_000);
    for (const [type, list] of st.lists) {
      const i1 = indexAfter(list, t);
      if (!quiet)
        for (let i = st.idx[type]; i < i1; i++)
          emit('moment', {
            type,
            item: list[i],
            t: list[i].t,
            momentId: st.moment.id,
          });
      st.idx[type] = i1;
    }
    st.prevT = t;
    if (!st.ended && t >= st.moment.time.end - 1) {
      st.ended = true;
      emit('moment', { type: 'end', item: null, t, momentId: st.moment.id });
    } else if (t < st.moment.time.end - 1) st.ended = false;
  }

  // ── Timeline ─────────────────────────────────────────────────────
  let lastSituations = new Map();
  function timelineEvents({ from, to } = {}) {
    const win = api.timeWindow();
    const lo = Number.isFinite(+from) ? +from : win.start.getTime();
    const hi = Number.isFinite(+to) ? +to : win.end.getTime();
    const out = [];
    const add = (e) => {
      if (Number.isFinite(e.t) && e.t >= lo && e.t <= hi) out.push(e);
    };
    for (const q of feeds.quakes.data?.records || [])
      if (q.time && q.mag >= 4)
        add({
          t: q.time,
          kind: 'quake',
          band: 'ground',
          title: `M${q.mag.toFixed(1)} ${q.place || ''}`.trim(),
          severity: q.mag >= 6.5 ? 3 : q.mag >= 5.5 ? 2 : q.mag >= 4.5 ? 1 : 0,
          entityId: `earthquakes:${q.stableId}`,
          lon: q.lon,
          lat: q.lat,
        });
    for (const c of detector.quakeClusters(feeds.quakes.data?.records))
      add({
        t: c.since,
        kind: 'quake-cluster',
        band: 'ground',
        title: c.title,
        severity: 2,
        situationId: c.id,
        lon: c.lon,
        lat: c.lat,
      });
    for (const l of feeds.launches.data?.records || [])
      add({
        t: l.net,
        kind: 'launch',
        band: 'orbit',
        title: l.name,
        severity: 1,
        entityId: `launches:${l.id}`,
        lon: l.lon,
        lat: l.lat,
      });
    for (const e of recorder.events())
      add({
        t: e.t,
        kind: 'squawk',
        band: 'sky',
        title: e.title,
        severity: 3,
        entityId: `flights:${e.key}`,
        momentId: `live-squawk-${e.key}`,
        lon: e.lon,
        lat: e.lat,
      });
    for (const s of feeds.cyclones.data?.records || [])
      add({
        t: s.t,
        kind: 'cyclone',
        band: 'orbit',
        title:
          `${s.label || s.classification || 'Storm'} ${s.name || ''} advisory`.trim(),
        severity: s.windKt >= 96 ? 3 : s.windKt >= 64 ? 2 : 1,
        entityId: `cyclones:${s.id}`,
        lon: s.lon,
        lat: s.lat,
      });
    const fires = (feeds.fires.data?.records || [])
      .filter((f) => Number.isFinite(f.t))
      .sort((a, b) => (b.frp ?? b.acres ?? 0) - (a.frp ?? a.acres ?? 0))
      .slice(0, 30);
    for (const f of fires)
      add({
        t: f.t,
        kind: 'fire',
        band: 'ground',
        title: f.title || 'Fire',
        severity: 1,
        entityId: `fires:${f.id}`,
        lon: f.lon,
        lat: f.lat,
      });
    for (const d of detector.history()) add({ ...d, band: 'sky', severity: 2 });
    // Lightning onset: the first 15-min bin that jumps well above the
    // series' earlier median, from the live lightning card.
    for (const s of lastSituations.values()) {
      if (s.kind !== 'lightning' || !(s.series?.length > 4)) continue;
      const vals = s.series.map((p) => p.v);
      for (let i = 3; i < vals.length; i++) {
        const prior = vals.slice(0, i).sort((a, b) => a - b);
        const med = prior[Math.floor(prior.length / 2)];
        if (vals[i] > Math.max(3 * med, med + 50)) {
          add({
            t: s.series[i].t,
            kind: 'lightning',
            band: 'sky',
            title: `Lightning onset · ${s.place || s.title}`,
            severity: 1,
            situationId: s.id,
            lon: s.lon,
            lat: s.lat,
          });
          break;
        }
      }
    }
    // Moments: the active one's captures, posts, chat bursts and beats.
    const ms = [...momentCache.values()];
    for (const m of ms) {
      if (m.time.end < lo || m.time.start > hi) continue;
      for (const b of m.beats || [])
        add({
          t: b.t,
          kind: 'moment',
          band: 'sky',
          title: b.title,
          severity: 1,
          momentId: m.id,
        });
      for (const c of m.captures || [])
        add({
          t: c.t,
          kind: 'capture',
          band: 'inside',
          title: `${c.firstEyes ? 'First eyes · ' : ''}@${c.handle} · ${c.title}`,
          severity: c.firstEyes ? 2 : 1,
          momentId: m.id,
          entityId: `capture:${m.id}:${c.id}`,
          lon: c.lon,
          lat: c.lat,
        });
      for (const p of m.posts || [])
        add({
          t: p.t,
          kind: 'post',
          band: 'inside',
          title: `${p.kind}: ${p.text.slice(0, 70)}`,
          severity: 0,
          momentId: m.id,
        });
      // Chat bursts: 6+ lines inside 30 s.
      const chat = m.chat || [];
      let lastBurst = -Infinity;
      for (let i = 0; i + 5 < chat.length; i++)
        if (
          chat[i + 5].t - chat[i].t < 30_000 &&
          chat[i].t - lastBurst > 60_000
        ) {
          lastBurst = chat[i].t;
          add({
            t: chat[i].t,
            kind: 'chat-burst',
            band: 'inside',
            title: `Chat burst: “${chat[i + 2].text.slice(0, 40)}”`,
            severity: 0,
            momentId: m.id,
          });
        }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // ── Entities ─────────────────────────────────────────────────────
  const trackCache = new Map();
  async function trackOf(key, layer) {
    key = String(key).toLowerCase();
    // A contact known only from the bundled recording: its recorded track
    // (a server track would describe today's flight, not that one).
    if (!recorder.has(key) && archive.recorder.has(key)) {
      const pts = archive.recorder.samples(key);
      pts.source = 'Bundled recording (real positions, see capture time)';
      return pts;
    }
    const cached = trackCache.get(key);
    // A failed fetch is remembered for 5 min so a dead route costs nothing.
    const ttl = cached?.points?.length ? 60_000 : 5 * 60_000;
    let remote = cached && Date.now() - cached.at < ttl ? cached.points : null;
    let source = cached?.source || null;
    if (!remote && /^[0-9a-f]{6}$/.test(key)) {
      remote = [];
      const tryJson = async (url) => {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
          return r.ok ? await r.json() : null;
        } catch {
          return null;
        }
      };
      // OpenSky first for civil traffic; adsb.lol traces cover everything.
      const sky =
        layer === 'military'
          ? null
          : await tryJson(`/api/flights/track?icao24=${key}`);
      if (Array.isArray(sky?.path)) {
        source = 'OpenSky Network tracks';
        for (const [tSec, lat, lon, baro, trk] of sky.path)
          if (Number.isFinite(lat) && Number.isFinite(lon))
            remote.push({
              t: tSec * 1000,
              lon,
              lat,
              altM: baro ?? 0,
              headingDeg: trk ?? 0,
              speed: 0,
            });
      } else {
        const lol = await tryJson(`/api/military/track?hex=${key}`);
        if (Array.isArray(lol?.trace)) {
          source = 'adsb.lol traces (ODbL)';
          const t0 = (lol.timestamp || 0) * 1000;
          for (const p of lol.trace) {
            const [dt, lat, lon, alt, gs, trk] = p;
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            remote.push({
              t: t0 + dt * 1000,
              lon,
              lat,
              altM: alt === 'ground' ? 0 : (alt ?? 0) * 0.3048,
              headingDeg: trk ?? 0,
              speed: (gs ?? 0) * 0.514444,
            });
          }
        }
      }
      trackCache.set(key, { at: Date.now(), points: remote, source });
      if (remote.length)
        recorder.merge(key, remote, recorder.meta(key) || undefined);
    }
    const pts = recorder.samples(key);
    const out = pts.length ? pts : remote || [];
    out.source = source
      ? `${source} + God’s Eye recorder`
      : 'God’s Eye recorder';
    return out;
  }
  const entities = createEntities({
    feeds,
    recorder: history,
    detector,
    situations: () => {
      const m = new Map(lastSituations);
      for (const d of detector.current()) if (!m.has(d.id)) m.set(d.id, d);
      return m;
    },
    moments: {
      get: (id) => resolveMoment(id),
      cached: () => [...momentCache.values()],
    },
    viewer: () => viewerPos,
    timeMs,
    trackOf,
  });
  hero().catch(() => {});

  // ── API ──────────────────────────────────────────────────────────
  let booting = false;
  const userTouched = new Set();
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
      if (!booting) userTouched.add(id);
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
        // NOW leaves a Moment too (the camera stays where it is).
        if (momentState) {
          api.exitMoment({ restoreCamera: false });
          return;
        }
        if (playing) stopPlayback();
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
      setClock(ms);
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
      const withDistance = (list) => {
        if (observer && Number.isFinite(observer.lat))
          for (const s of list)
            s.distanceKm = Math.round(
              haversineKm(observer.lat, observer.lon, s.lat, s.lon),
            );
        return list;
      };
      if (extra.cached) return loadCachedSituations().then(withDistance);
      return buildSituations({ feeds, timeMs }, { observer }).then((list) => {
        for (const s of list)
          if (s.kind === 'squawk') s.momentId = `live-${s.id}`;
        // Detections on real data join the feed at the top of their band.
        detector.run({ force: true });
        const extraCards = [];
        for (const d of detector.current())
          try {
            extraCards.push(circlingCard(d, recorder));
          } catch (error) {
            console.warn('[globe:circling]', error);
          }
        for (const c of detector.quakeClusters(feeds.quakes.data?.records))
          extraCards.push(quakeClusterCard(c));
        const all = [...extraCards, ...list];
        lastSituations = new Map(all.map((s) => [s.id, s]));
        saveSituations(all);
        return withDistance(all);
      });
    },

    /** Bundled or last-rendered thumbnail URL for a (cached) situation, sync. */
    cachedThumbnail(situation) {
      return cachedThumbnail(situation);
    },

    /** Current detections (circling, quake clusters) as Situations, sync. */
    detections() {
      const out = [];
      for (const d of detector.current()) out.push(circlingCard(d, recorder));
      for (const c of detector.quakeClusters(feeds.quakes.data?.records))
        out.push(quakeClusterCard(c));
      return out;
    },

    /** The recorder's range: { start, end, entities, points } (epoch ms). */
    history() {
      const r = recorder.range();
      return {
        start: r.start,
        end: r.end,
        entities: r.entities,
        points: r.points,
        bytes: r.bytes,
        // The bundled real recording: { start, end, regions: [{ id, label,
        // bbox, start, end, tracks, busiest: { t, aircraft } }] } or null.
        archive: archive.range(),
      };
    },

    /**
     * Recorded contacts near a point at an instant (device recorder and the
     * bundled recording): [{ id, key, kind, title, lon, lat, altM }].
     */
    historyNear(ms, lon, lat, km = 100) {
      const dLat = km / 111;
      const dLon = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      const rect = {
        west: lon - dLon,
        east: lon + dLon,
        south: lat - dLat,
        north: lat + dLat,
      };
      return history
        .snapshotAt(ms, { rect })
        .map((s) => ({
          id: `${s.meta?.layer || 'flights'}:${s.key}`,
          key: s.key,
          kind: s.meta?.kind || 'aircraft',
          title: s.meta?.callsign || s.meta?.title || s.key.toUpperCase(),
          lon: s.lon,
          lat: s.lat,
          altM: s.altM,
          d: Math.hypot(
            s.lat - lat,
            (s.lon - lon) * Math.cos((lat * Math.PI) / 180),
          ),
        }))
        .sort((a, b) => a.d - b.d);
    },

    /** Resolves once the bundled recording is loaded → history().archive. */
    async loadHistory() {
      await archive.load();
      return archive.range();
    },

    trackOf(entityId) {
      const ref = entities.parseRef(entityId);
      return trackOf(ref?.key ?? entityId, ref?.layer);
    },

    playback: {
      speeds: PLAYBACK_SPEEDS,
      play(o = {}) {
        startPlayback(o);
        return playbackState();
      },
      stop() {
        stopPlayback();
        return playbackState();
      },
      state: playbackState,
    },

    timeline(range) {
      return timelineEvents(range);
    },

    async moments() {
      const out = liveMoments();
      try {
        out.push(await hero());
      } catch {
        /* bundled file missing */
      }
      return out;
    },

    moment(id) {
      return resolveMoment(id);
    },

    async momentOfTheDay() {
      // Worth a daily replay: several aircraft circling one place, or an
      // emergency with at least 5 min of track. A lone orbit is not enough.
      const best = liveMoments()
        .filter((m) =>
          m.situationId
            ? m.tracks.length >= 2
            : m.time.end - m.time.start > 5 * 60_000,
        )
        .sort((a, b) => b.tracks.length - a.tracks.length);
      return best[0] || hero();
    },

    async playMoment(
      idOrMoment,
      { speed, camera = true, autoplay = true, framing } = {},
    ) {
      // A later playMoment/exitMoment supersedes this call at every await.
      const token = ++momentToken;
      stopPlayback();
      const m = await resolveMoment(idOrMoment);
      if (!m) throw new Error(`Unknown moment: ${idOrMoment}`);
      if (token !== momentToken) return m;
      const restore = momentState?.restore || {
        destination: camera
          ? Cesium.Cartesian3.clone(scene.camera.positionWC)
          : null,
        heading: scene.camera.heading,
        pitch: scene.camera.pitch,
        wasLive: live,
        time: timeMs(),
      };
      if (selected) api.select(null);
      const [buildings, waterData] = await Promise.all([
        m.stage?.buildings ? loadBuildings(m.stage.buildings) : null,
        m.stage?.water ? loadWater(m.stage.water) : null,
      ]);
      if (token !== momentToken) return m;
      const lists = [
        ['capture', sortedBy(m.captures)],
        ['chat', sortedBy(m.chat)],
        ['post', sortedBy(m.posts)],
        ['beat', sortedBy(m.beats)],
      ];
      momentState = {
        moment: m,
        lists,
        idx: Object.fromEntries(lists.map(([k]) => [k, 0])),
        prevT: m.time.start - 1,
        restore,
        ended: false,
      };
      momentCache.set(m.id, m);
      ghosts.hide();
      // The Moment owns the scene: every live layer steps aside.
      for (const layer of layers.values())
        if (layer.root) layer.root.show = false;
      await stage.load(m, { buildings, waterData });
      if (token !== momentToken || momentState?.moment !== m) return m;
      if (Number.isFinite(framing)) stage.setFraming(framing);
      stage.setCinematic(camera);
      setClock(m.time.start);
      applyTime();
      emit('moment', {
        type: 'start',
        item: m,
        t: m.time.start,
        momentId: m.id,
      });
      if (autoplay)
        startPlayback({
          speed: speed ?? m.recommendedSpeed ?? 1,
          from: m.time.start,
          until: m.time.end,
        });
      return m;
    },

    exitMoment({ restoreCamera = true } = {}) {
      momentToken++;
      if (!momentState) return false;
      const { restore, moment } = momentState;
      stopPlayback();
      momentState = null;
      stage.unload();
      for (const layer of layers.values())
        if (layer.root) layer.root.show = Boolean(layer.on);
      emit('moment', {
        type: 'exit',
        item: null,
        t: timeMs(),
        momentId: moment.id,
      });
      if (restore?.wasLive !== false) api.setTime(null);
      else api.setTime(restore.time);
      if (restoreCamera && restore?.destination)
        scene.camera.flyTo({
          destination: restore.destination,
          orientation: {
            heading: restore.heading,
            pitch: restore.pitch,
            roll: 0,
          },
          duration: 1.4,
        });
      requestRender();
      return true;
    },

    activeMoment() {
      if (!momentState) return null;
      const m = momentState.moment;
      return {
        id: m.id,
        title: m.title,
        illustrative: Boolean(m.illustrative),
        t: timeMs(),
        start: m.time.start,
        end: m.time.end,
        playing,
        speed: playSpeed,
        cinematic: stage.cinematic,
        moment: m,
      };
    },

    seekMoment(t) {
      if (!momentState) return;
      const m = momentState.moment;
      const ms =
        t >= 0 && t <= 1
          ? m.time.start + t * (m.time.end - m.time.start)
          : Number(t);
      setClock(Math.max(m.time.start, Math.min(m.time.end, ms)));
      emit('time', { live: false, time: new Date(timeMs()) });
    },

    momentCamera(on = true) {
      stage.setCinematic(on);
      requestRender();
      return stage.cinematic;
    },

    entity(ref) {
      return entities.entity(ref);
    },

    search(query) {
      return entities.search(query);
    },

    graph(ref) {
      return entities.graph(ref);
    },

    react(r) {
      return reactions.react(r);
    },

    attentionHeat(points) {
      reactions.heat(points);
    },

    skyNow(pos = viewerPos) {
      return skyNow(feeds, pos || {});
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
          layer.on &&
          layer.root?.show !== false &&
          layer.renderer?.glyphMode &&
          layer.renderer.glyphs;
        if (!glyphs) continue;
        // Semantic zoom for words too: from orbit only the headline layers.
        if (planetary && !PLANETARY_LABELS.has(layer.id)) continue;
        if (layer.id === 'lightning') continue; // the glow is the label
        const crowd = layer.id === 'transit'; // hundreds of buses: selected only
        const rank = LABEL_PRIORITY.indexOf(layer.id);
        for (let i = 0; i < glyphs.length; i++) {
          const bb = glyphs.get(i);
          if (!occluder.isPointVisible(bb.position)) continue;
          const p = scene.cartesianToCanvasCoordinates(bb.position, scratch);
          if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
          const isSelected =
            selected?.layer === layer.id && selected?.key === bb.id.key;
          if (crowd && !isSelected) continue;
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
      for (const l of stage.labels()) {
        const pos = Cesium.Cartesian3.fromDegrees(l.lon, l.lat, l.altM || 0);
        if (!occluder.isPointVisible(pos)) continue;
        const p = scene.cartesianToCanvasCoordinates(pos, scratch);
        if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
        const pick = {
          id: l.id,
          kind: l.kind,
          title: l.title,
          ...(l.detail ? { labelDetail: l.detail } : {}),
        };
        candidates.push({
          layer: { id: 'moment', pick: () => pick },
          key: l.id,
          x: p.x,
          y: p.y,
          score: l.score,
          // Shorter forms to try when the full label collides.
          variants: [
            ...(l.short
              ? [{ title: l.short, detail: l.shortDetail || '' }]
              : []),
            ...(l.short ? [{ title: l.short, detail: '' }] : []),
          ],
        });
      }
      if (ghosts.shown)
        for (let i = 0; i < ghosts.glyphs.length && i < 400; i++) {
          const bb = ghosts.glyphs.get(i);
          if (!occluder.isPointVisible(bb.position)) continue;
          const p = scene.cartesianToCanvasCoordinates(bb.position, scratch);
          if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
          const d = Math.hypot(p.x - w / 2, p.y - h / 2) / Math.max(w, h);
          candidates.push({
            layer: { id: 'history', pick: (key) => ghosts.pick(key) },
            key: bb.id.key,
            x: p.x,
            y: p.y,
            score: 10 + d * 4,
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
        // Collision-avoid on the label as drawn (title · detail), trying
        // the shorter forms (callsign + altitude, then callsign) before
        // giving the spot up.
        const forms = [
          { title: pick.title, detail: pick.labelDetail || '' },
          ...(c.variants || []),
        ];
        let chosen = null;
        let box = null;
        for (const f of forms) {
          const chars = f.title.length + (f.detail ? f.detail.length + 3 : 0);
          const b = {
            x0: c.x - 4,
            x1: c.x + 22 + chars * 6.6,
            y0: c.y - 12,
            y1: c.y + 12,
          };
          if (
            !placed.some(
              (o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0,
            )
          ) {
            chosen = f;
            box = b;
            break;
          }
        }
        if (!chosen) continue;
        placed.push(box);
        out.push({
          id: pick.id,
          layer: c.layer.id,
          kind: pick.kind,
          title: chosen.title,
          ...(chosen.detail ? { detail: chosen.detail } : {}),
          ...(chosen.title !== pick.title ? { abbreviated: true } : {}),
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

    /** Internals for dev harnesses and tests (not part of the contract). */
    get debug() {
      return { recorder, archive, detector, stage, ghosts };
    },

    get viewer() {
      return viewer;
    },

    destroy() {
      clearInterval(tick);
      clearTimeout(watchTimer);
      cancelAnimationFrame(playRaf);
      for (const u of unsubs) u();
      removePostRender();
      recorder.destroy();
      ghosts.destroy();
      stage.destroy();
      reactions.destroy();
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
  // First frame first: the globe paints with imagery only, then the live
  // layers start (heavy weather/ground layers a beat later).
  const HEAVY = new Set([
    'radar',
    'clouds',
    'lightning',
    'wind',
    'jet',
    'gnss',
    'transit',
    'starlink',
    'satellites',
  ]);
  const startIds = opts.layers ?? DEFAULT_LAYERS;
  const startLayers = (heavy) => {
    if (viewer.isDestroyed()) return;
    booting = true;
    for (const id of startIds)
      if (
        layers.has(id) &&
        HEAVY.has(id) === heavy &&
        !layers.get(id).on &&
        !userTouched.has(id)
      )
        api.setLayer(id, true);
    booting = false;
    refreshLayerViews();
    requestRender();
  };
  let started = false;
  const removeFirstFrame = scene.postRender.addEventListener(() => {
    if (started) return;
    started = true;
    setTimeout(() => removeFirstFrame(), 0);
    setTimeout(() => startLayers(false), 30);
    setTimeout(() => startLayers(true), 900);
  });
  // A hidden tab never renders: start anyway after a second.
  setTimeout(() => {
    if (!started) {
      started = true;
      removeFirstFrame();
      startLayers(false);
      startLayers(true);
    }
  }, 1200);
  requestRender();
  // Listeners attach after this resolves: hand them the starting state.
  setTimeout(() => {
    emit('quality', governor.state());
    emit('layers', api.layers());
  }, 0);
  return api;
}
