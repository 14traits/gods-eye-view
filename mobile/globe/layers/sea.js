/**
 * Sea family (AIS vessels, tankers/cargo, ports) and Eyes family (public
 * CCTV). AIS needs the server's AISSTREAM_API_KEY; without it the layers say
 * so instead of pretending the ocean is empty.
 */
import { ContactRenderer, Layer, color, FAMILY_COLORS } from './base.js';
import { PORTS } from '../places.js';
import { cctvFrameUrl } from '../feeds.js';

const SEA = FAMILY_COLORS.Sea;
const EYES = FAMILY_COLORS.Eyes;
const MPS_TO_KT = 1 / 0.514444;

class VesselLayer extends Layer {
  constructor(ctx, def, { feed, filter, tint }) {
    super(ctx, { pollMs: 20_000, ...def });
    this.feed = feed;
    this.filter = filter;
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(tint),
      glyphName: 'ship',
      lodHeightM: 1_200_000,
      cap: 800,
      deadReckon: true,
      dotScale: 0.34,
      glyphScale: 0.42,
    });
    this.records = new Map();
  }

  async refresh() {
    try {
      await this.feed.get({ maxAgeMs: 15_000 });
    } catch (error) {
      this.fromFeed(this.feed);
      if (error.keyRequired) {
        this.status = 'error';
        this.message = error.message;
        this.count = 0;
        return;
      }
      throw error;
    }
    this.fromFeed(this.feed);
    const records = this.feed.data.records.filter(this.filter);
    this.records = new Map(records.map((r) => [r.id, r]));
    this.count = records.length;
    const now = Date.now();
    this.renderer.setItems(
      records.map((r) => ({
        key: r.id,
        lon: r.lon,
        lat: r.lat,
        heading: r.heading,
        speed: r.speed,
        seenAt: now,
      })),
    );
  }

  onView(view) {
    this.renderer.setView(view);
  }
  onTime(ms, live) {
    this.renderer.setAlpha(live ? 1 : 0.3);
  }
  onTick(nowMs, live) {
    return live && this.renderer.tick(nowMs);
  }
  locate(key) {
    const it = this.renderer.byKey.get(key);
    if (!it) return null;
    const [lon, lat] = this.renderer.where(it);
    return [lon, lat, 0];
  }
  pick(key) {
    const r = this.records.get(key);
    if (!r) return null;
    const [lon, lat] = this.locate(key);
    return {
      kind: 'vessel',
      id: r.id,
      title: r.name,
      subtitle: [
        r.type || 'Vessel',
        Number.isFinite(r.speed)
          ? `${(r.speed * MPS_TO_KT).toFixed(1)} kn`
          : null,
        r.destination ? `→ ${r.destination}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      lon,
      lat,
      meta: {
        layer: this.id,
        mmsi: r.id,
        type: r.type,
        speedMps: r.speed,
        headingDeg: r.heading,
        destination: r.destination,
        source: this.source,
      },
    };
  }
  contacts() {
    return [...this.records.values()].map((r) => {
      const [lon, lat] = this.locate(r.id) || [r.lon, r.lat];
      return {
        kind: 'vessel',
        id: r.id,
        title: r.name,
        lon,
        lat,
        altM: 0,
        headingDeg: r.heading,
        speedMps: r.speed,
        layer: this.id,
      };
    });
  }
}

class PortsLayer extends Layer {
  constructor(ctx) {
    super(ctx, { id: 'ports', family: 'Sea', name: 'Ports' });
    this.source = 'Bundled reference (2024 throughput, M TEU)';
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(SEA),
      glyphName: 'port',
      rotate: false,
      alwaysGlyph: true,
      glyphScale: 0.5,
    });
    this.records = new Map(PORTS.map((p) => [p.id, p]));
  }
  async refresh() {
    this.status = 'live';
    this.count = PORTS.length;
    this.renderer.setItems(
      PORTS.map((p) => ({
        key: p.id,
        lon: p.lon,
        lat: p.lat,
        glyphScale: 0.7 + Math.min(1, p.teu / 40) * 0.6,
      })),
    );
  }
  onView(view) {
    this.renderer.setView(view);
  }
  locate(key) {
    const p = this.records.get(key);
    return p ? [p.lon, p.lat, 0] : null;
  }
  pick(key) {
    const p = this.records.get(key);
    if (!p) return null;
    return {
      kind: 'port',
      id: p.id,
      title: p.name,
      subtitle: `${p.teu.toFixed(1)} M TEU / year`,
      lon: p.lon,
      lat: p.lat,
      meta: { layer: this.id, teu: p.teu, source: this.source },
    };
  }
}

class CctvLayer extends Layer {
  constructor(ctx, { feed }) {
    super(ctx, {
      id: 'cctv',
      family: 'Eyes',
      name: 'Public CCTV',
      pollMs: 30 * 60_000,
    });
    this.feed = feed;
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(EYES),
      glyphName: 'camera',
      lodHeightM: 250_000,
      cap: 250,
      dotScale: 0.3,
      glyphScale: 0.45,
    });
    this.records = new Map();
  }
  async refresh() {
    try {
      await this.feed.get();
    } finally {
      this.fromFeed(this.feed);
    }
    const records = this.feed.data.records;
    this.records = new Map(records.map((r) => [r.id, r]));
    this.count = records.length;
    this.renderer.setItems(
      records.map((r) => ({
        key: r.id,
        lon: r.lon,
        lat: r.lat,
        altM: 0,
        heading: r.heading,
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
      kind: 'camera',
      id: r.id,
      title: r.name,
      subtitle: [r.city, r.provider].filter(Boolean).join(' · '),
      lon: r.lon,
      lat: r.lat,
      meta: {
        layer: this.id,
        frameUrl: cctvFrameUrl(r),
        headingDeg: r.heading,
        fovDeg: r.fovDeg,
        feedType: r.feedType,
        provider: r.provider,
        source: this.source,
      },
    };
  }
}

const TANKER = /tanker|cargo|container|bulk/i;

export function createSeaLayers(ctx, { vessels }) {
  return [
    new VesselLayer(
      ctx,
      { id: 'vessels', family: 'Sea', name: 'AIS vessels' },
      { feed: vessels, filter: () => true, tint: SEA },
    ),
    new PortsLayer(ctx),
    new VesselLayer(
      ctx,
      { id: 'tankers', family: 'Sea', name: 'Tankers / cargo' },
      { feed: vessels, filter: (r) => TANKER.test(r.type), tint: '#7FF0DC' },
    ),
  ];
}

export function createEyesLayers(ctx, { cctv }) {
  return [new CctvLayer(ctx, { feed: cctv })];
}
