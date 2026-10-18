/**
 * Hazards family: earthquakes (USGS), active fires (NASA FIRMS, or NASA EONET
 * events when no FIRMS key), tropical cyclones (NOAA NHC + EONET) with
 * forecast tracks the time ribbon can scrub into, volcanoes (EONET) and the
 * bundled Bhote Koshi flood corridor.
 */
import * as Cesium from 'cesium';
import { ContactRenderer, Layer, color, FAMILY_COLORS } from './base.js';
import { relTime } from '../geo.js';

const HAZ = FAMILY_COLORS.Hazards;
const WEEK = 7 * 86_400_000;

/** A point-event layer filtered to what had happened by the clock time. */
class EventLayer extends Layer {
  constructor(ctx, def, opts) {
    super(ctx, def);
    this.feed = opts.feed;
    this.select = opts.select; // data → records [{id, lon, lat, t, ...}]
    this.style = opts.style; // (record, ageMs) → item fields
    this.describe = opts.describe; // (record, clockMs) → {title, subtitle, meta}
    this.windowMs = opts.windowMs ?? WEEK;
    this.kind = opts.kind;
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(opts.tint || HAZ),
      glyphName: opts.glyph,
      rotate: false,
      alwaysGlyph: opts.alwaysGlyph,
      lodHeightM: opts.lodHeightM ?? 3_000_000,
      cap: opts.cap ?? 400,
      dotScale: opts.dotScale ?? 0.5,
      glyphScale: opts.glyphScale ?? 0.5,
    });
    this.records = new Map();
  }

  async refresh() {
    try {
      await this.feed.get();
    } finally {
      this.fromFeed(this.feed);
    }
    this._draw();
  }

  _draw() {
    const data = this.feed.data;
    if (!data) return;
    const t = this.ctx.timeMs();
    const items = [];
    this.records = new Map();
    for (const r of this.select(data)) {
      const age = Number.isFinite(r.t) ? t - r.t : 0;
      if (age < 0 || age > this.windowMs) continue;
      this.records.set(r.id, r);
      items.push({
        key: r.id,
        lon: r.lon,
        lat: r.lat,
        altM: 0,
        ...this.style(r, age),
      });
    }
    this.count = items.length;
    this.renderer.setItems(items);
  }

  onView(view) {
    this.renderer.setView(view);
  }
  onTime() {
    if (this.on) this._draw();
  }
  locate(key) {
    const r = this.records.get(key);
    return r ? [r.lon, r.lat, 0] : null;
  }
  pick(key) {
    const r = this.records.get(key);
    if (!r) return null;
    const d = this.describe(r, this.ctx.timeMs());
    return {
      kind: this.kind,
      id: r.id,
      lon: r.lon,
      lat: r.lat,
      ...d,
      meta: { layer: this.id, source: this.source, ...d.meta },
    };
  }
}

function quakeColor(mag) {
  if (mag >= 6) return '#FF3B30';
  if (mag >= 5) return '#FF6A3D';
  if (mag >= 4) return '#FFA23D';
  return '#FFD08A';
}

export function createHazardLayers(ctx, feeds) {
  const quakes = new EventLayer(
    ctx,
    {
      id: 'earthquakes',
      family: 'Hazards',
      name: 'Earthquakes',
      pollMs: 5 * 60_000,
    },
    {
      feed: feeds.quakes,
      kind: 'earthquake',
      glyph: 'quake',
      alwaysGlyph: true,
      cap: 600,
      select: (d) =>
        d.records.map((q) => ({ ...q, id: q.stableId, t: q.time })),
      style: (q, age) => {
        const fresh = age < 86_400_000;
        return {
          color: color(quakeColor(q.mag), fresh ? 1 : 0.55),
          glyphScale: 0.32 + Math.max(0, q.mag - 2.5) * 0.24,
          dotScale: 0.6 + Math.max(0, q.mag - 2.5) * 0.4,
        };
      },
      describe: (q, t) => ({
        title: `M${q.mag.toFixed(1)} earthquake`,
        subtitle: `${q.place || 'Unknown location'} · ${relTime(q.time, t)}`,
        meta: {
          magnitude: q.mag,
          depthKm: q.depthKm,
          time: q.time ? new Date(q.time).toISOString() : null,
          usgsId: q.usgsId,
          url: q.usgsId
            ? `https://earthquake.usgs.gov/earthquakes/eventpage/${q.usgsId}`
            : null,
        },
      }),
    },
  );

  const fires = new EventLayer(
    ctx,
    {
      id: 'fires',
      family: 'Hazards',
      name: 'Active fires (FIRMS)',
      pollMs: 10 * 60_000,
    },
    {
      feed: feeds.fires,
      kind: 'fire',
      glyph: 'fire',
      windowMs: 3 * 86_400_000,
      lodHeightM: 1_500_000,
      cap: 500,
      select: (d) => {
        // EONET events keep their last report date; a 3-day window would
        // hide long-running fires, so events show while open.
        if (d.mode === 'events')
          return d.records.map((r) => ({ ...r, t: null }));
        return d.records;
      },
      style: (f) => {
        const big = (f.frp ?? 0) > 50 || (f.acres ?? 0) > 5000;
        return {
          color: color(big ? '#FF5A1F' : '#FF9A3D', 0.95),
          glyphScale: big ? 0.75 : 0.55,
          dotScale: big ? 0.8 : 0.5,
        };
      },
      describe: (f, t) => ({
        title: f.title || 'Fire hotspot',
        subtitle: [
          f.acres ? `${Math.round(f.acres).toLocaleString()} acres` : null,
          f.frp ? `${f.frp.toFixed(0)} MW FRP` : null,
          Number.isFinite(f.t) ? relTime(f.t, t) : 'open event',
        ]
          .filter(Boolean)
          .join(' · '),
        meta: {
          frpMw: f.frp ?? null,
          acres: f.acres ?? null,
          url: f.link || null,
        },
      }),
    },
  );
  fires.refresh = async function () {
    await EventLayer.prototype.refresh.call(this);
    const d = this.feed.data;
    this.name = 'Active fires (FIRMS)';
    if (d?.mode === 'events') {
      this.message = d.firmsKeyRequired
        ? 'FIRMS key not set on server — showing NASA EONET wildfire events'
        : 'FIRMS unavailable — showing NASA EONET wildfire events';
    }
  };

  const volcanoes = new EventLayer(
    ctx,
    {
      id: 'volcanoes',
      family: 'Hazards',
      name: 'Volcanoes',
      pollMs: 30 * 60_000,
    },
    {
      feed: feeds.eonet,
      kind: 'volcano',
      glyph: 'volcano',
      alwaysGlyph: true,
      windowMs: Infinity,
      select: (d) => d.volcanoes.map((v) => ({ ...v, t: null })),
      style: () => ({ color: color('#FF7A45'), glyphScale: 0.6 }),
      describe: (v) => ({
        title: v.title,
        subtitle: `Active · since ${new Date(v.firstT).toISOString().slice(0, 10)}`,
        meta: { url: v.link },
      }),
    },
  );

  return [
    quakes,
    fires,
    new CycloneLayer(ctx, { feed: feeds.cyclones }),
    new FloodLayer(ctx, { feed: feeds.flood }),
    volcanoes,
  ];
}

/* ───────────────────────── Cyclones ───────────────────────── */

/** Position of a storm at a clock time: interpolated along the forecast. */
export function stormPositionAt(storm, ms) {
  const f = storm.forecast;
  if (!f?.length)
    return { lon: storm.lon, lat: storm.lat, windKt: storm.windKt };
  const tau = (ms - storm.t) / 3_600_000;
  if (tau <= 0) return { lon: storm.lon, lat: storm.lat, windKt: storm.windKt };
  for (let i = 1; i < f.length; i++) {
    if (tau <= f[i].tauHours) {
      const a = f[i - 1];
      const b = f[i];
      const k = (tau - a.tauHours) / Math.max(1e-6, b.tauHours - a.tauHours);
      return {
        lon: a.lon + (b.lon - a.lon) * k,
        lat: a.lat + (b.lat - a.lat) * k,
        windKt: a.windKt + (b.windKt - a.windKt) * k,
        forecast: true,
      };
    }
  }
  return null; // beyond the forecast
}

class CycloneLayer extends Layer {
  constructor(ctx, { feed }) {
    super(ctx, {
      id: 'cyclones',
      family: 'Hazards',
      name: 'Tropical cyclones',
      pollMs: 15 * 60_000,
    });
    this.feed = feed;
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color('#FFFFFF'),
      glyphName: 'cyclone',
      rotate: false,
      alwaysGlyph: true,
      glyphScale: 1.1,
      dotScale: 1.3,
    });
    this.lines = this.root.add(new Cesium.PolylineCollection());
    this.records = new Map();
  }

  async refresh() {
    try {
      await this.feed.get();
    } finally {
      this.fromFeed(this.feed);
    }
    this._draw(true);
  }

  _draw(full) {
    const data = this.feed.data;
    if (!data) return;
    const t = this.ctx.timeMs();
    const items = [];
    this.records = new Map();
    for (const s of data.records) {
      if (t < s.t - 6 * 86_400_000) continue;
      const p = stormPositionAt(s, t);
      if (!p) continue;
      this.records.set(s.id, { ...s, now: p });
      items.push({
        key: s.id,
        lon: p.lon,
        lat: p.lat,
        altM: 0,
        color: color(p.forecast ? '#FFD2C2' : '#FFFFFF', p.forecast ? 0.8 : 1),
        glyphScale: 0.8 + Math.min(1, (p.windKt || 40) / 140) * 0.7,
      });
    }
    this.count = items.length;
    this.renderer.setItems(items);
    if (full) this._lines(data.records);
  }

  _lines(storms) {
    this.lines.removeAll();
    const dash = (css, a) =>
      Cesium.Material.fromType('PolylineDash', {
        color: color(css, a),
        dashLength: 14,
      });
    for (const s of storms) {
      if (s.forecast?.length > 1) {
        this.lines.add({
          positions: Cesium.Cartesian3.fromDegreesArray(
            [{ lon: s.lon, lat: s.lat }, ...s.forecast].flatMap((p) => [
              p.lon,
              p.lat,
            ]),
          ),
          width: 2.5,
          material: dash('#FFFFFF', 0.85),
        });
      }
      const cone = outerRing(s.cone);
      if (cone) {
        this.lines.add({
          positions: Cesium.Cartesian3.fromDegreesArray(cone.flat()),
          width: 1.5,
          material: Cesium.Material.fromType('Color', {
            color: color(HAZ, 0.7),
          }),
        });
      }
      if (s.pastTrack?.length > 1) {
        this.lines.add({
          positions: Cesium.Cartesian3.fromDegreesArray(
            s.pastTrack.flatMap((p) => [p.lon, p.lat]),
          ),
          width: 2,
          material: Cesium.Material.fromType('Color', {
            color: color('#FFFFFF', 0.6),
          }),
        });
      }
    }
  }

  onView(view) {
    this.renderer.setView(view);
  }
  onTime() {
    if (this.on) this._draw(false);
  }
  locate(key) {
    const s = this.records.get(key);
    return s ? [s.now.lon, s.now.lat, 0] : null;
  }
  trail(key) {
    const s = this.records.get(key);
    if (!s) return [];
    return (
      s.pastTrack || [{ lon: s.lon, lat: s.lat }, ...(s.forecast || [])]
    ).map((p) => [p.lon, p.lat, 0]);
  }
  pick(key) {
    const s = this.records.get(key);
    if (!s) return null;
    const label =
      s.label ||
      {
        HU: 'Hurricane',
        TS: 'Tropical storm',
        TD: 'Tropical depression',
        TY: 'Typhoon',
        TC: 'Cyclone',
        STS: 'Subtropical storm',
      }[s.classification] ||
      'Cyclone';
    const wind = s.now.windKt
      ? `${Math.round(s.now.windKt * 1.852)} km/h`
      : null;
    return {
      kind: 'cyclone',
      id: s.id,
      title: `${label} ${s.name}`,
      subtitle: [
        wind,
        s.pressureHpa ? `${s.pressureHpa} hPa` : null,
        s.now.forecast ? 'forecast' : 'observed',
      ]
        .filter(Boolean)
        .join(' · '),
      lon: s.now.lon,
      lat: s.now.lat,
      meta: {
        layer: this.id,
        windKt: s.now.windKt ?? null,
        pressureHpa: s.pressureHpa ?? null,
        movement: s.movement ?? null,
        basin: s.basin,
        url: s.link,
        source: s.source,
      },
    };
  }
}

/** Elevation of the corridor vertex nearest a point (0 without a corridor). */
function nearestElevation(corridor, lon, lat) {
  if (!corridor?.length) return 0;
  let best = corridor[0];
  let bestD = Infinity;
  for (const c of corridor) {
    const d = (c[0] - lon) ** 2 + (c[1] - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best[2] || 0;
}

function outerRing(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') return geom.coordinates[0];
  if (geom.type === 'MultiPolygon') {
    let best = null;
    for (const poly of geom.coordinates)
      if (!best || poly[0].length > best.length) best = poly[0];
    return best;
  }
  return null;
}

/* ───────────────────────── Bhote Koshi flood ───────────────────────── */

class FloodLayer extends Layer {
  constructor(ctx, { feed }) {
    super(ctx, { id: 'floods', family: 'Hazards', name: 'Floods' });
    this.feed = feed;
    this.lines = this.root.add(new Cesium.PolylineCollection());
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(HAZ),
      glyphName: 'pin',
      rotate: false,
      alwaysGlyph: true,
      glyphScale: 0.62,
    });
    this.anchors = new Map();
    this.overlay = null;
  }

  async refresh() {
    const data = await this.feed.get();
    this.status = 'live';
    this.source = data.source;
    const corridor = data.corridor || data.path;
    this._drawLines(data, null);
    this._sampleTerrain(data);
    const ev = data.event;
    const items = [];
    this.anchors = new Map();
    const head = corridor[0];
    this.anchors.set('bhote-koshi', {
      id: 'bhote-koshi',
      title: ev?.title || 'Bhote Koshi outburst flood',
      subtitle: `Observed ${ev?.observedDate || '2026-08-26'} · reconstruction`,
      lon: head[0],
      lat: head[1],
      meta: { caveat: ev?.reconstruction?.caveat || null },
    });
    for (const a of ev?.witnessAnchors || []) {
      this.anchors.set(a.id, {
        id: a.id,
        title: a.title,
        subtitle: (a.details || []).join(' · '),
        lon: a.lon,
        lat: a.lat,
        meta: { url: a.sourceUrl || null },
      });
    }
    for (const a of this.anchors.values())
      items.push({
        key: a.id,
        lon: a.lon,
        lat: a.lat,
        altM: nearestElevation(data.corridor, a.lon, a.lat) + 30,
        glyphScale: a.id === 'bhote-koshi' ? 1.2 : 0.8,
      });
    this.renderer.setItems(items);
    this.count = 1;
  }

  /**
   * The corridor carries surveyed elevations; the longer GeoPera centreline
   * has none, so it takes terrain heights once terrain is available (until
   * then, the nearest corridor elevation). Lines sit 20 m above ground so
   * they neither sink into terrain nor float in parallax.
   */
  _drawLines(data, pathHeights) {
    this.lines.removeAll();
    const glow = (css, power, alpha) =>
      Cesium.Material.fromType('PolylineGlow', {
        color: color(css, alpha),
        glowPower: power,
        taperPower: 1,
      });
    const pathPositions = data.path.flatMap(([lon, lat], i) => [
      lon,
      lat,
      (pathHeights?.[i] ?? nearestElevation(data.corridor, lon, lat)) + 20,
    ]);
    this.lines.add({
      positions: Cesium.Cartesian3.fromDegreesArrayHeights(pathPositions),
      width: 5,
      material: glow('#5EC8FF', 0.16, 0.85),
    });
    if (data.corridor)
      this.lines.add({
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(
          data.corridor.flatMap(([lon, lat, h]) => [lon, lat, (h || 0) + 20]),
        ),
        width: 7,
        material: glow('#A6ECFF', 0.14, 0.9),
      });
    this.ctx.requestRender();
  }

  async _sampleTerrain(data) {
    if (this._sampled) return;
    this._sampled = true;
    const viewer = this.ctx.viewer;
    // Terrain arrives asynchronously after boot.
    for (
      let i = 0;
      i < 20 &&
      !(viewer.terrainProvider instanceof Cesium.CesiumTerrainProvider);
      i++
    )
      await new Promise((r) => setTimeout(r, 1000));
    if (!(viewer.terrainProvider instanceof Cesium.CesiumTerrainProvider))
      return;
    try {
      const cartos = data.path.map(([lon, lat]) =>
        Cesium.Cartographic.fromDegrees(lon, lat),
      );
      const sampled = await Cesium.sampleTerrainMostDetailed(
        viewer.terrainProvider,
        cartos,
      );
      if (viewer.isDestroyed()) return;
      this._drawLines(
        data,
        sampled.map((c) => (Number.isFinite(c.height) ? c.height : null)),
      );
    } catch (error) {
      console.warn('[globe:floods] terrain sample', error);
    }
  }

  /** The 1 MB post-event image loads only once the camera is close. */
  _overlay() {
    const ev = this.feed.data?.event;
    const rect = ev?.imagery?.rectangle;
    const path = ev?.imagery?.after?.path;
    if (!rect || !path || this.overlay) return;
    const provider = Cesium.SingleTileImageryProvider.fromUrl(
      `/events/bhote-koshi-2026/${path}`,
      {
        rectangle: Cesium.Rectangle.fromDegrees(
          rect.west,
          rect.south,
          rect.east,
          rect.north,
        ),
        credit: ev.imagery.after.source,
      },
    );
    this.overlay = Cesium.ImageryLayer.fromProviderAsync(provider, {
      alpha: 0.95,
    });
    this.overlay.show = this.on;
    this.ctx.viewer.imageryLayers.add(this.overlay);
  }

  setOn(on) {
    super.setOn(on);
    if (this.overlay) this.overlay.show = Boolean(on);
  }

  onView(view) {
    this.renderer.setView(view);
    if (this.on && view.heightM < 400_000) this._overlay();
  }
  locate(key) {
    const a = this.anchors.get(key);
    return a ? [a.lon, a.lat, 0] : null;
  }
  trail() {
    return this.feed.data?.path?.map(([lon, lat]) => [lon, lat, 0]) || [];
  }
  pick(key) {
    const a = this.anchors.get(key);
    if (!a) return null;
    return {
      kind: 'flood',
      ...a,
      meta: { layer: this.id, source: this.source, ...a.meta },
    };
  }
}
