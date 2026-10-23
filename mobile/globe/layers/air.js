/**
 * Sky family: commercial flights, military aircraft, helicopters, private/GA
 * and emergency squawks. Every layer reads the shared flight and military
 * feeds; derived layers (helicopters, GA, squawks) are filters, never extra
 * downloads.
 */
import { ContactRenderer, Layer, color, FAMILY_COLORS } from './base.js';
import { haversineKm } from '../geo.js';

const SKY = FAMILY_COLORS.Sky;
const M_TO_FT = 3.28084;
const MPS_TO_KT = 1 / 0.514444;
const HISTORY = 24;

export class AircraftLayer extends Layer {
  /**
   * @param {object} ctx
   * @param {object} def layer definition
   * @param {{sources:{feed:object, filter:(r:object)=>boolean}[], tint:string,
   *   lodHeightM?:number, cap?:number, alwaysGlyph?:boolean, kind?:string}} opts
   */
  constructor(ctx, def, opts) {
    super(ctx, { pollMs: 12_000, ...def });
    this.sources = opts.sources;
    this.kind = opts.kind || 'aircraft';
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(opts.tint || SKY),
      glyphName: 'plane',
      lodHeightM: opts.lodHeightM ?? 1_800_000,
      cap: opts.cap ?? 700,
      deadReckon: true,
      dotScale: opts.dotScale ?? 0.36,
      alwaysGlyph: opts.alwaysGlyph,
      glyphScale: opts.glyphScale ?? 0.5,
    });
    this.records = new Map();
    this.history = new Map();
    this.groundTint = color(opts.tint || SKY).withAlpha(0.55);
  }

  async refresh() {
    const results = await Promise.allSettled(
      this.sources.map((s) => s.feed.get({ maxAgeMs: 9_000 })),
    );
    const flightData = this.sources[0].feed.data;
    this._regionalNote = flightData?.regional
      ? 'OpenSky unavailable — adsb.lol snapshot within 250 nm of the view'
      : '';
    const records = [];
    let anyOk = false;
    this.sources.forEach((s, i) => {
      this.fromFeed(s.feed);
      if (results[i].status !== 'fulfilled') return;
      anyOk = true;
      for (const r of results[i].value.records)
        if (s.filter(r)) records.push(r);
    });
    if (!anyOk) throw results[0].reason;
    if (this._regionalNote && !this.message) this.message = this._regionalNote;
    this.ingest(records);
  }

  ingest(records) {
    const next = new Map();
    for (const r of records) {
      next.set(r.id, r);
      let h = this.history.get(r.id);
      if (!h) this.history.set(r.id, (h = []));
      const last = h.at(-1);
      if (!last || last[0] !== r.lon || last[1] !== r.lat) {
        h.push([r.lon, r.lat, r.altM]);
        if (h.length > HISTORY) h.shift();
      }
    }
    for (const id of this.history.keys())
      if (!next.has(id)) this.history.delete(id);
    this.records = next;
    this.count = next.size;
    this.renderer.setItems(
      records.map((r) => ({
        key: r.id,
        lon: r.lon,
        lat: r.lat,
        altM: r.altM,
        heading: r.heading,
        speed: r.speed,
        onGround: r.onGround,
        seenAt: r.seenAt || Date.now(),
        glyph: r.helicopter ? 'heli' : 'plane',
        // Parked traffic recedes so the apron does not bloom into a blob.
        color: r.emergency
          ? color('#FF3B30')
          : r.onGround
            ? this.groundTint
            : undefined,
        glyphScale: r.onGround
          ? 0.6
          : r.helicopter
            ? 0.95
            : r.cls === 'widebody'
              ? 1.15
              : 1,
      })),
    );
  }

  onView(view) {
    this.renderer.setView(view);
    // A regional fallback snapshot follows the camera: refetch once the
    // view has moved well away from the snapshot's anchor.
    const data = this.sources[0].feed.data;
    if (
      this.on &&
      data?.regional &&
      data.anchor &&
      view.center &&
      haversineKm(
        data.anchor.lat,
        data.anchor.lon,
        view.center.lat,
        view.center.lon,
      ) > 300 &&
      Date.now() - (this._regionalKick || 0) > 8_000
    ) {
      this._regionalKick = Date.now();
      this.kick();
    }
  }

  onTime(ms, live) {
    // Inside the recorded past the history layer draws where everything
    // actually was, and inside a Moment its stage owns the sky: the live
    // snapshot hides. Beyond the record, aircraft dim to show they are not
    // a reconstruction of that moment.
    const mode = this.ctx.timeMode?.(ms, live) || 'none';
    this.root.show = this.on && mode === 'none';
    this.renderer.setAlpha(live ? 1 : 0.3);
  }

  onTick(nowMs, live) {
    return live && this.renderer.tick(nowMs);
  }

  locate(key) {
    const r = this.records.get(key);
    if (!r) return null;
    const it = this.renderer.byKey.get(key);
    const [lon, lat] = it ? this.renderer.where(it) : [r.lon, r.lat];
    return [lon, lat, r.altM];
  }

  trail(key) {
    const h = this.history.get(key) || [];
    const now = this.locate(key);
    return now ? [...h, now] : h;
  }

  pick(key) {
    const r = this.records.get(key);
    if (!r) return null;
    const [lon, lat, altM] = this.locate(key);
    const alt = r.onGround
      ? 'On ground'
      : `${Math.round((r.altM * M_TO_FT) / 100) * 100} ft`;
    const spd = Number.isFinite(r.speed)
      ? `${Math.round(r.speed * MPS_TO_KT)} kt`
      : null;
    return {
      kind: this.kind,
      id: r.id,
      title: r.callsign,
      subtitle: [
        r.military ? r.type || 'Military' : r.country,
        alt,
        spd,
        r.emergency ? `SQUAWK ${r.squawk}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      lon,
      lat,
      ...(r.emergency ? { labelDetail: `SQ ${r.squawk}` } : {}),
      meta: {
        layer: this.id,
        icao24: r.id,
        altitudeM: r.altM,
        speedMps: r.speed,
        headingDeg: r.heading,
        verticalRateMps: r.vRate ?? null,
        squawk: r.squawk,
        type: r.type || null,
        class: r.cls,
        country: r.country || null,
        onGround: r.onGround,
        source: this.source,
      },
    };
  }

  contacts() {
    const out = [];
    for (const r of this.records.values()) {
      const it = this.renderer.byKey.get(r.id);
      const [lon, lat] = it ? this.renderer.where(it) : [r.lon, r.lat];
      out.push({
        kind: this.kind,
        id: r.id,
        title: r.callsign,
        lon,
        lat,
        altM: r.altM,
        headingDeg: r.heading,
        speedMps: r.speed,
        layer: this.id,
      });
    }
    return out;
  }

  onHide() {}
}

/** Build the Sky family. */
export function createSkyLayers(ctx, { flights, military }) {
  const all = () => true;
  return [
    new AircraftLayer(
      ctx,
      { id: 'flights', family: 'Sky', name: 'Commercial flights' },
      {
        sources: [{ feed: flights, filter: (r) => !r.ga && !r.helicopter }],
        tint: SKY,
      },
    ),
    new AircraftLayer(
      ctx,
      { id: 'military', family: 'Sky', name: 'Military aircraft' },
      {
        sources: [{ feed: military, filter: all }],
        tint: '#E3F1FF',
        kind: 'military',
        lodHeightM: 6_000_000,
        alwaysGlyph: true,
        glyphScale: 0.62,
        dotScale: 0.6,
      },
    ),
    new AircraftLayer(
      ctx,
      { id: 'helicopters', family: 'Sky', name: 'Helicopters' },
      {
        sources: [
          { feed: flights, filter: (r) => r.helicopter },
          { feed: military, filter: (r) => r.helicopter },
        ],
        tint: '#A8E0FF',
        kind: 'helicopter',
        alwaysGlyph: true,
        glyphScale: 0.6,
      },
    ),
    new AircraftLayer(
      ctx,
      { id: 'ga', family: 'Sky', name: 'Private / GA' },
      {
        sources: [{ feed: flights, filter: (r) => r.ga && !r.helicopter }],
        tint: '#B9D9F5',
        dotScale: 0.3,
        glyphScale: 0.42,
      },
    ),
    new AircraftLayer(
      ctx,
      { id: 'squawk', family: 'Sky', name: 'Emergency squawks' },
      {
        sources: [
          { feed: flights, filter: (r) => r.emergency },
          {
            feed: military,
            filter: (r) => ['7500', '7600', '7700'].includes(r.squawk),
          },
        ],
        tint: '#FF3B30',
        kind: 'emergency',
        alwaysGlyph: true,
        glyphScale: 0.8,
        dotScale: 0.9,
      },
    ),
  ];
}
