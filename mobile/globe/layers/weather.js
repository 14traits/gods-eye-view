/**
 * Weather family (radar, satellite IR clouds, lightning, surface wind, jet
 * stream) plus the round-two Ground/Infra/Hazards layers that share the same
 * plumbing (transit vehicles, GNSS interference, air quality).
 *
 * Rasters come from NOAA nowCOAST through the app's /api/weather proxy as
 * whole-extent frames and are drawn as one unlit, translucent rectangle each
 * (a few kilometres above the ground, where the weather is), so the night
 * side does not swallow them the way lit imagery layers would. Scrubbing the
 * time ribbon swaps to the frame valid at that time (radar ≈ 50 min of 4-min
 * frames, lightning 3 h of 15-min frames, IR 6 h of hourly frames). Wind uses
 * the desktop app's GPU streamline renderer (src/layers/wind/gpuRendering.js).
 */
import * as Cesium from 'cesium';
import {
  ContactRenderer,
  Layer,
  color,
  FAMILY_COLORS,
  inRect,
} from './base.js';
import { createWindGpuRendering } from '../../../src/layers/wind/gpuRendering.js';
import {
  aqiColor,
  frameAt,
  gnssIntegrity,
  GNSS_ANCHORS,
  transitVehicles,
  weatherImageUrl,
} from '../feedsWeather.js';
import { haversineKm, relTime } from '../geo.js';

const WX = FAMILY_COLORS.Weather;

/* ───────────────────────── Frame decoding (shared) ───────────────────────── */

const frameCache = new Map(); // url → Promise<canvas>
const FRAME_CACHE_MAX = 8;

/** Decode a same-origin weather frame into a canvas (IR gets an alpha key). */
async function decodeFrame(url, product) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather frame HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  if (product === 'clouds' || product === 'clouds-regional') {
    // Key the IR to clouds: warm surfaces clear, cloud tops white with a
    // soft ramp (the repo's cloud key is tuned for a lit globe; this one
    // also has to read on the unlit night side).
    const px = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i];
      const t = Math.max(0, Math.min(1, (l - 95) / 95));
      const a = t * t * (3 - 2 * t);
      d[i + 3] = (d[i + 3] * a * 215) / 255;
      // Unlit clouds must not blow out under bloom: grey-white body,
      // coldest tops leaning icy blue.
      const cold = Math.max(0, (l - 200) / 55);
      d[i] = 168 + 42 * a - 22 * cold;
      d[i + 1] = 176 + 40 * a - 6 * cold;
      d[i + 2] = 192 + 36 * a + 10 * cold;
    }
    g.putImageData(px, 0, 0);
  }
  return canvas;
}

function cached(url, make, keep) {
  let p = frameCache.get(url);
  if (p) {
    frameCache.delete(url);
    frameCache.set(url, p);
    return p;
  }
  p = make();
  p.catch(() => frameCache.delete(url));
  if (!keep) return p;
  frameCache.set(url, p);
  while (frameCache.size > FRAME_CACHE_MAX)
    frameCache.delete(frameCache.keys().next().value);
  return p;
}

/** Decode a same-origin weather frame into a canvas (IR gets a cloud key). */
export function loadWeatherFrame(
  product,
  time,
  width = 2048,
  { keep = true } = {},
) {
  const url = weatherImageUrl(product, time, width);
  return cached(url, () => decodeFrame(url, product), keep);
}

/** A 2:1 detail window (0.25° grid) covering a view rect inside bounds. */
export function detailWindow(rect, bounds) {
  if (!rect || rect.west > rect.east) return null;
  const lonSpan = rect.east - rect.west;
  const latSpan = rect.north - rect.south;
  let width = Math.max(1, lonSpan * 1.1, latSpan * 2.2);
  width = Math.ceil(width / 0.5) * 0.5;
  const height = width / 2;
  if (width >= bounds.east - bounds.west - 0.5) return null;
  if (height >= bounds.north - bounds.south - 0.5) return null;
  const snap = (v) => Math.round(v / 0.25) * 0.25;
  const cLon = (rect.west + rect.east) / 2;
  const cLat = (rect.south + rect.north) / 2;
  const minW = Math.ceil(bounds.west / 0.25) * 0.25;
  const maxW = Math.floor((bounds.east - width) / 0.25) * 0.25;
  const minS = Math.ceil(bounds.south / 0.25) * 0.25;
  const maxS = Math.floor((bounds.north - height) / 0.25) * 0.25;
  const west = Math.max(minW, Math.min(maxW, snap(cLon - width / 2)));
  const south = Math.max(minS, Math.min(maxS, snap(cLat - height / 2)));
  return { west, south, east: west + width, north: south + height };
}

/** Decode a detail window of a frame (2048×1024). */
export function loadWeatherDetail(product, time, box) {
  const url = `/api/weather/image?product=${product}&time=${encodeURIComponent(time)}&bbox=${box.west},${box.south},${box.east},${box.north}&size=2048x1024`;
  return cached(url, () => decodeFrame(url, product), true);
}

/* ───────────────────────── Raster layer ───────────────────────── */

class WeatherRasterLayer extends Layer {
  /**
   * @param {object} ctx
   * @param {object} def
   * @param {{feed:object, product:string, heightM:number, alpha:number,
   *   width?:number}} opts
   */
  constructor(ctx, def, opts) {
    super(ctx, { pollMs: 2 * 60_000, ...def });
    this.feed = opts.feed;
    this.product = opts.product;
    this.heightM = opts.heightM;
    this.alpha = opts.alpha;
    this.width = opts.width ?? 2048;
    this.primitive = null;
    this.material = null;
    this.frame = null;
    this._want = null;
  }

  async refresh() {
    try {
      await this.feed.get();
    } finally {
      this.fromFeed(this.feed);
    }
    await this._apply();
    if (this.frame && this.feed.data)
      this.message = `${this.feed.data.title} · ${relTime(this.frameTime, Date.now())}`;
    else if (this.feed.data?.coverage) this.message ||= this.feed.data.coverage;
  }

  _ensurePrimitive(bounds) {
    if (this.primitive) return;
    this.material = Cesium.Material.fromType('Image', {
      image: Cesium.Material.DefaultImageId,
      color: new Cesium.Color(1, 1, 1, this.alpha),
    });
    const rect = Cesium.Rectangle.fromDegrees(
      bounds.west,
      bounds.south,
      bounds.east,
      bounds.north,
    );
    this.primitive = this.root.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.RectangleGeometry({
            rectangle: rect,
            height: this.heightM,
            granularity: Cesium.Math.toRadians(1),
            vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
          }),
        }),
        appearance: new Cesium.EllipsoidSurfaceAppearance({
          material: this.material,
          flat: true,
          aboveGround: true,
          translucent: true,
          renderState: { depthMask: false },
        }),
        asynchronous: true,
        allowPicking: false,
        show: false,
      }),
    );
  }

  async _apply() {
    const data = this.feed.data;
    if (!data) return;
    const time = frameAt(
      data.times,
      this.ctx.isLive() ? null : this.ctx.timeMs(),
    );
    this._want = time;
    if (!time) {
      if (this.primitive) this.primitive.show = false;
      this.count = 0;
      this.message = 'No observation at this time';
      this.ctx.requestRender();
      return;
    }
    if (time === this.frame) {
      if (this.primitive) this.primitive.show = true;
      return;
    }
    this._ensurePrimitive(data.bounds);
    const canvas = await loadWeatherFrame(this.product, time, this.width);
    if (this._want !== time || !this.on) return;
    this.material.uniforms.image = canvas;
    this.primitive.show = true;
    this.frame = time;
    this.frameCanvas = canvas;
    this.frameTime = Date.parse(time);
    this.message = `${data.title} · ${relTime(this.frameTime, Date.now())}`;
    if (this.afterFrame) this.afterFrame(canvas, data);
    else this.count = 1;
    this._detail().catch(() => {});
    this.ctx.requestRender();
  }

  /** Close in, a sharper window of the same frame is laid over the global one. */
  onView(view) {
    this.lastView = view;
    if (!this.on) return;
    clearTimeout(this._detailTimer);
    this._detailTimer = setTimeout(
      () => this._detail().catch((e) => console.warn(`[globe:${this.id}]`, e)),
      350,
    );
  }

  async _detail() {
    const v = this.lastView;
    const data = this.feed.data;
    const box =
      v && v.heightM < 3_500_000 && this.frame && data
        ? detailWindow(v.rect, data.bounds)
        : null;
    if (!box) {
      if (this.detailPrim) this.detailPrim.show = false;
      this._detailKey = null;
      this.ctx.requestRender();
      return;
    }
    const key = `${this.frame}|${box.west},${box.south},${box.east},${box.north}`;
    if (key === this._detailKey) {
      if (this.detailPrim) this.detailPrim.show = true;
      return;
    }
    this._detailKey = key;
    const canvas = await loadWeatherDetail(this.product, this.frame, box);
    if (this._detailKey !== key || !this.on) return;
    if (this.detailPrim) this.root.remove(this.detailPrim);
    const material = Cesium.Material.fromType('Image', {
      image: canvas,
      color: new Cesium.Color(1, 1, 1, this.alpha),
    });
    this.detailPrim = this.root.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.RectangleGeometry({
            rectangle: Cesium.Rectangle.fromDegrees(
              box.west,
              box.south,
              box.east,
              box.north,
            ),
            height: this.heightM + 60,
            granularity: Cesium.Math.toRadians(0.25),
            vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
          }),
        }),
        appearance: new Cesium.EllipsoidSurfaceAppearance({
          material,
          flat: true,
          aboveGround: true,
          translucent: true,
          renderState: { depthMask: false },
        }),
        asynchronous: true,
        allowPicking: false,
      }),
    );
    // The coarse global frame stays underneath only where the window ends.
    this.ctx.requestRender();
  }

  onTime() {
    if (!this.on) return;
    clearTimeout(this._timeTimer);
    // Frames are whole-extent images: decode at most ~4 per second while
    // the ribbon is being dragged.
    this._timeTimer = setTimeout(
      () => this._apply().catch((e) => console.warn(`[globe:${this.id}]`, e)),
      250,
    );
  }

  onHide() {
    if (this.primitive) this.primitive.show = false;
    if (this.detailPrim) this.detailPrim.show = false;
    this._detailKey = null;
    this.frame = null;
  }

  info() {
    const i = super.info();
    if (this.on && this.feed.data) i.frames = this.feed.data.times.length;
    return i;
  }
}

/* ───────────────────────── Lightning ───────────────────────── */

const STRIKE_BIN_DEG = 0.5;
const STRIKE_CAP = 1500;

/**
 * Strike-density raster plus a glow per active 0.5° cell, so storms read as
 * flickering points of light from orbit. nowCOAST's palette runs yellow →
 * orange → red → magenta with density; the glow grades the same way.
 */
class LightningLayer extends WeatherRasterLayer {
  constructor(ctx, opts) {
    super(
      ctx,
      { id: 'lightning', family: 'Weather', name: 'Lightning' },
      { ...opts, product: 'lightning', heightM: 9000, alpha: 0.95 },
    );
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color('#FFF2A8'),
      glyphName: 'bolt',
      rotate: false,
      lodHeightM: 1_500_000,
      cap: 300,
      dotScale: 0.55,
      glyphScale: 0.42,
      dotAlpha: 1,
    });
    this.cells = new Map();
  }

  onView(view) {
    super.onView(view);
    this.renderer.setView(view);
  }

  afterFrame(canvas, data) {
    const cells = strikeCells(canvas, data.bounds);
    this.cells = new Map(cells.map((c) => [c.key, c]));
    this.count = cells.length;
    this.renderer.setItems(
      cells.map((c) => ({
        key: c.key,
        lon: c.lon,
        lat: c.lat,
        altM: 9500,
        color: color(
          c.level >= 3 ? '#FF8AE6' : c.level === 2 ? '#FFD27A' : '#FFF6C8',
        ),
        dotScale: 0.32 + Math.min(0.55, c.pixels / 12),
        glyphScale: 0.8 + c.level * 0.12,
      })),
    );
  }

  /** 1 Hz flicker: a few cells flare each second (cheap, no render loop). */
  onTick() {
    const n = this.renderer.dots.length;
    if (!n) return false;
    for (let k = 0; k < Math.min(24, n); k++) {
      const i = Math.floor(Math.random() * n);
      const bb = this.renderer.dots.get(i);
      bb.scale = bb._base ??= bb.scale;
      bb.scale = bb._base * (1.4 + Math.random() * 0.9);
      setTimeout(() => {
        if (this.renderer.dots.contains(bb)) bb.scale = bb._base;
      }, 220);
    }
    setTimeout(() => this.ctx.requestRender(), 230);
    return true;
  }

  locate(key) {
    const c = this.cells.get(key);
    return c ? [c.lon, c.lat, 9500] : null;
  }

  pick(key) {
    const c = this.cells.get(key);
    if (!c) return null;
    return {
      kind: 'lightning',
      id: key,
      title: 'Lightning',
      subtitle: `Strike density class ${c.level} · ${relTime(this.frameTime, Date.now())}`,
      lon: c.lon,
      lat: c.lat,
      meta: { layer: this.id, level: c.level, source: this.source },
    };
  }
}

/** Classify a nowCOAST lightning-density pixel 1 (low) .. 4 (extreme). */
export function strikeLevel(r, g, b) {
  if (r > 200 && g > 200 && b < 140) return 1; // yellow
  if (r > 200 && g > 90) return 2; // orange
  if (r > 170 && b > 120) return 4; // magenta / pink
  if (r > 150) return 3; // red
  return 1;
}

/** Bin the lit pixels of a whole-extent lightning frame into 0.5° cells. */
export function strikeCells(canvas, bounds, bbox = null) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const px = g.getImageData(0, 0, width, height).data;
  const dLon = (bounds.east - bounds.west) / width;
  const dLat = (bounds.north - bounds.south) / height;
  const bins = new Map();
  for (let y = 0; y < height; y++) {
    const lat = bounds.north - (y + 0.5) * dLat;
    if (bbox && (lat < bbox.south || lat > bbox.north)) continue;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (px[i + 3] < 40) continue;
      const lon = bounds.west + (x + 0.5) * dLon;
      if (bbox && (lon < bbox.west || lon > bbox.east)) continue;
      const level = strikeLevel(px[i], px[i + 1], px[i + 2]);
      const key = `${Math.floor(lat / STRIKE_BIN_DEG)}:${Math.floor(lon / STRIKE_BIN_DEG)}`;
      let c = bins.get(key);
      if (!c)
        bins.set(
          key,
          (c = { key, lat: 0, lon: 0, pixels: 0, level: 0, weight: 0 }),
        );
      c.lat += lat;
      c.lon += lon;
      c.pixels++;
      c.weight += level;
      c.level = Math.max(c.level, level);
    }
  }
  const out = [];
  for (const c of bins.values()) {
    c.lat /= c.pixels;
    c.lon /= c.pixels;
    out.push(c);
  }
  out.sort((a, b) => b.weight - a.weight);
  return out.slice(0, STRIKE_CAP);
}

/* ───────────────────────── Wind (GPU streamlines) ───────────────────────── */

class WindLayer extends Layer {
  constructor(ctx, def, { feed }) {
    super(ctx, { pollMs: 60 * 60_000, ...def });
    this.feed = feed;
    this.gpu = createWindGpuRendering({
      cesium: Cesium,
      getViewer: () => ctx.viewer,
    });
    this.field = null;
    this.started = performance.now();
    this._raf = 0;
    this._lastFrame = 0;
    const scene = ctx.scene;
    this._pre = scene.preRender.addEventListener(() => {
      if (!this.on || !this.field) return;
      this.gpu.tick((performance.now() - this.started) / 1000);
      this.gpu.updateVisibility(scene.camera);
    });
  }

  async refresh() {
    try {
      await this.feed.get();
    } finally {
      this.fromFeed(this.feed);
    }
    const d = this.feed.data;
    if (!d) return;
    if (d.field !== this.field) {
      this.field = d.field;
      if (this.on) this.gpu.setField(this.field);
    }
    this.count = this.gpu.getParticleCount();
    this.message = `${d.level} · ${d.source}`;
    this._loop();
  }

  setOn(on) {
    super.setOn(on);
    if (on && this.field) {
      this.gpu.setField(this.field);
      this._loop();
    }
  }

  onHide() {
    this.gpu.clear();
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /** Flowing streaks need frames: ~30 fps while on and visible, 0 otherwise. */
  _loop() {
    if (this._raf || !this.on) return;
    const step = (t) => {
      this._raf = 0;
      if (!this.on) return;
      if (this.ctx.active() && t - this._lastFrame > 33) {
        this._lastFrame = t;
        this.ctx.requestRender();
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._pre?.();
    this.gpu.destroy();
    super.destroy();
  }
}

/* ───────────────────────── Air quality ───────────────────────── */

class AirQualityLayer extends Layer {
  constructor(ctx, { feed }) {
    super(ctx, {
      id: 'air-quality',
      family: 'Hazards',
      name: 'Air quality',
      pollMs: 60 * 60_000,
    });
    this.feed = feed;
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color('#F2D33B'),
      glyphName: 'aq',
      rotate: false,
      alwaysGlyph: true,
      dotScale: 0.9,
      glyphScale: 0.5,
    });
    this.records = new Map();
  }
  async refresh() {
    try {
      await this.feed.get();
    } finally {
      this.fromFeed(this.feed);
    }
    const recs = this.feed.data.records;
    this.records = new Map(recs.map((r) => [r.id, r]));
    this.count = recs.length;
    this.renderer.setItems(
      recs.map((r) => ({
        key: r.id,
        lon: r.lon,
        lat: r.lat,
        color: color(aqiColor(r.aqi)),
        dotScale: 0.8 + Math.min(2, r.aqi / 100),
        glyphScale: 0.55 + Math.min(0.6, r.aqi / 300),
      })),
    );
  }
  onView(view) {
    this.renderer.setView(view);
  }
  locate(key) {
    const r = this.records.get(key);
    return r ? [r.lon, r.lat, 0] : null;
  }
  pick(key) {
    const r = this.records.get(key);
    if (!r) return null;
    return {
      kind: 'air-quality',
      id: r.id,
      title: `${r.name} · AQI ${Math.round(r.aqi)}`,
      subtitle: `PM2.5 ${r.pm25?.toFixed(0) ?? '–'} µg/m³ · modelled (CAMS)`,
      lon: r.lon,
      lat: r.lat,
      labelDetail: `AQI ${Math.round(r.aqi)}`,
      meta: { layer: this.id, aqi: r.aqi, pm25: r.pm25, source: this.source },
    };
  }
}

/* ───────────────────────── GNSS interference ───────────────────────── */

const GNSS_COLORS = { high: '#FF3B6B', medium: '#FFB13D', low: '#4ADE80' };

class GnssLayer extends Layer {
  constructor(ctx) {
    super(ctx, {
      id: 'gnss',
      family: 'Infra',
      name: 'GNSS interference',
      pollMs: 2 * 60_000,
    });
    this.source = 'adsb.lol NIC/NACp (gpsjam.org bands)';
    this.cellsPrim = null;
    this.anchor = null;
    this.cells = new Map();
  }

  _anchors() {
    const v = this.lastView;
    if (v && v.heightM < 3_000_000 && v.center)
      return [{ id: 'view', lat: v.center.lat, lon: v.center.lon }];
    return GNSS_ANCHORS;
  }

  async refresh() {
    const anchors = this._anchors();
    const results = await Promise.allSettled(
      anchors.map((a) =>
        gnssIntegrity.get(`${Math.round(a.lat)}:${Math.round(a.lon)}`, a),
      ),
    );
    const ok = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
    if (!ok.length) {
      this.status = 'error';
      this.message =
        results[0]?.reason?.message || 'GNSS integrity source unavailable';
      return;
    }
    this.status = 'live';
    this.message = 'Low NIC/NACp is a proxy for jamming or spoofing, not proof';
    const cells = new Map();
    for (const snap of ok)
      for (const c of snap.cells)
        cells.set(`${c.lat.toFixed(2)}:${c.lon.toFixed(2)}`, c);
    this.cells = cells;
    this._draw();
  }

  _draw() {
    if (this.cellsPrim) this.root.remove(this.cellsPrim);
    this.cellsPrim = null;
    const shown = [...this.cells.entries()].filter(
      ([, c]) => c.level !== 'low' || c.total >= 6,
    );
    this.count = shown.filter(([, c]) => c.level !== 'low').length;
    if (!shown.length) return;
    const instances = shown.map(([key, c]) => {
      const h = 0.25;
      return new Cesium.GeometryInstance({
        id: { layer: this.id, key },
        geometry: new Cesium.RectangleGeometry({
          rectangle: Cesium.Rectangle.fromDegrees(
            c.lon - h,
            c.lat - h,
            c.lon + h,
            c.lat + h,
          ),
          height: 2000,
          vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            color(GNSS_COLORS[c.level], c.level === 'low' ? 0.18 : 0.5),
          ),
        },
      });
    });
    this.cellsPrim = this.root.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
        }),
        asynchronous: true,
      }),
    );
    this.ctx.requestRender();
  }

  onView(view) {
    const prev = this.lastView;
    this.lastView = view;
    const moved =
      !prev ||
      view.heightM < 3_000_000 !== prev.heightM < 3_000_000 ||
      (view.heightM < 3_000_000 &&
        haversineKm(
          view.center.lat,
          view.center.lon,
          prev.center.lat,
          prev.center.lon,
        ) > 150);
    if (moved && this.on) this.kick();
  }

  locate(key) {
    const c = this.cells.get(key);
    return c ? [c.lon, c.lat, 0] : null;
  }

  pick(key) {
    const c = this.cells.get(key);
    if (!c) return null;
    return {
      kind: 'gnss',
      id: key,
      title: `GNSS ${c.level === 'high' ? 'interference likely' : c.level === 'medium' ? 'degraded' : 'nominal'}`,
      subtitle: `${c.bad}/${c.total} aircraft with low NIC/NACp · ${c.percent.toFixed(0)}%`,
      lon: c.lon,
      lat: c.lat,
      meta: { layer: this.id, ...c, source: this.source },
    };
  }
}

/* ───────────────────────── Transit ───────────────────────── */

function routeColor(routeId) {
  let h = 0;
  for (const ch of String(routeId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 85% 62%)`;
}

class TransitLayer extends Layer {
  constructor(ctx, { catalog }) {
    super(ctx, {
      id: 'transit',
      family: 'Ground',
      name: 'Transit vehicles',
      pollMs: 20_000,
    });
    this.catalog = catalog;
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(FAMILY_COLORS.Ground),
      glyphName: 'bus',
      lodHeightM: 400_000,
      cap: 600,
      dotScale: 0.32,
      glyphScale: 0.38,
    });
    this.records = new Map();
    this.feedId = null;
  }

  async refresh() {
    let cat;
    try {
      cat = await this.catalog.get();
    } finally {
      this.fromFeed(this.catalog);
    }
    const c = this.lastView?.center;
    const feeds = cat.feeds;
    let best = null;
    for (const f of feeds) {
      const d = c ? haversineKm(c.lat, c.lon, f.center.lat, f.center.lon) : 0;
      if (!best || d - f.loadRadiusKm < best.d - best.f.loadRadiusKm)
        best = { f, d };
    }
    if (
      !best ||
      (c && best.d > best.f.loadRadiusKm + 400 && this.lastView?.heightM < 3e6)
    ) {
      this.count = 0;
      this.message = 'No open transit feed near this view';
      this.renderer.clear();
      return;
    }
    // From orbit the nearest feed is arbitrary: show Helsinki's (busy, CC BY).
    const feed =
      this.lastView?.heightM >= 3e6
        ? feeds.find((f) => f.id === 'hsl-helsinki') || best.f
        : best.f;
    this.feedId = feed.id;
    const snap = await transitVehicles.get(feed.id);
    this.source = `${feed.name} · ${feed.attribution}`;
    this.message = `${feed.region} · ${snap.vehicles.length} vehicles`;
    this.status = 'live';
    this.records = new Map(snap.vehicles.map((v) => [v.id, v]));
    this.count = snap.vehicles.length;
    this.renderer.setItems(
      snap.vehicles.map((v) => ({
        key: v.id,
        lon: v.lon,
        lat: v.lat,
        heading: v.bearing ?? 0,
        color: color(routeColor(v.routeId)),
      })),
    );
  }

  onView(view) {
    const prev = this.lastView;
    this.lastView = view;
    this.renderer.setView(view);
    if (
      this.on &&
      prev?.center &&
      haversineKm(
        view.center.lat,
        view.center.lon,
        prev.center.lat,
        prev.center.lon,
      ) > 120
    )
      this.kick();
  }

  locate(key) {
    const v = this.records.get(key);
    return v ? [v.lon, v.lat, 0] : null;
  }

  pick(key) {
    const v = this.records.get(key);
    if (!v) return null;
    return {
      kind: 'transit',
      id: v.id,
      title: `Route ${v.routeId || '?'}`,
      subtitle: [
        v.speedMps != null ? `${Math.round(v.speedMps * 3.6)} km/h` : null,
        v.status ? v.status.replace(/_/g, ' ').toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(' · '),
      lon: v.lon,
      lat: v.lat,
      meta: { layer: this.id, feedId: this.feedId, source: this.source },
    };
  }

  contacts() {
    return [...this.records.values()].map((v) => ({
      kind: 'transit',
      id: v.id,
      title: `Route ${v.routeId}`,
      lon: v.lon,
      lat: v.lat,
      altM: 0,
      headingDeg: v.bearing ?? 0,
      speedMps: v.speedMps,
      layer: this.id,
    }));
  }
}

export { inRect };

export function createWeatherLayers(ctx, feeds) {
  return [
    new WeatherRasterLayer(
      ctx,
      { id: 'radar', family: 'Weather', name: 'Radar' },
      { feed: feeds.radar, product: 'radar', heightM: 4000, alpha: 0.9 },
    ),
    new WeatherRasterLayer(
      ctx,
      {
        id: 'clouds',
        family: 'Weather',
        name: 'Clouds (satellite IR)',
        pollMs: 10 * 60_000,
      },
      { feed: feeds.clouds, product: 'clouds', heightM: 7000, alpha: 0.85 },
    ),
    new LightningLayer(ctx, { feed: feeds.lightning, width: 2048 }),
    new WindLayer(
      ctx,
      { id: 'wind', family: 'Weather', name: 'Wind (10 m)' },
      { feed: feeds.wind },
    ),
    new WindLayer(
      ctx,
      { id: 'jet', family: 'Weather', name: 'Jet stream (250 hPa)' },
      { feed: feeds.jet },
    ),
    new AirQualityLayer(ctx, { feed: feeds.airQuality }),
    new GnssLayer(ctx),
    new TransitLayer(ctx, { catalog: feeds.transitCatalog }),
  ];
}

export { WX };
