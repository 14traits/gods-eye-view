/**
 * Orbit family: satellites (CelesTrak TLE + SGP4), ISS & crewed stations with
 * a live orbit ribbon, Starlink, and launches. Positions follow the scene
 * clock, so scrubbing the time ribbon flies every satellite to that instant.
 */
import * as Cesium from 'cesium';
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';
import { ContactRenderer, Layer, color, FAMILY_COLORS } from './base.js';
import { relTime } from '../geo.js';

const ORBIT = FAMILY_COLORS.Orbit;
const CREWED = new Set([25544, 48274]); // ISS (ZARYA), CSS (TIANHE)

/** Sub-satellite point and height for a satrec at a time, or null. */
export function satPosition(satrec, ms) {
  const date = new Date(ms);
  let pv;
  try {
    pv = propagate(satrec, date);
  } catch {
    return null;
  }
  const p = pv?.position;
  if (!p || typeof p === 'boolean' || !Number.isFinite(p.x)) return null;
  const g = eciToGeodetic(p, gstime(date));
  const v = pv.velocity;
  return {
    lon: degreesLong(g.longitude),
    lat: degreesLat(g.latitude),
    altM: g.height * 1000,
    speedMps: v ? Math.hypot(v.x, v.y, v.z) * 1000 : null,
  };
}

/** Ground-track heading (deg) from two nearby samples. */
function trackHeading(satrec, ms) {
  const a = satPosition(satrec, ms);
  const b = satPosition(satrec, ms + 10_000);
  if (!a || !b) return 0;
  const y =
    Math.sin(((b.lon - a.lon) * Math.PI) / 180) *
    Math.cos((b.lat * Math.PI) / 180);
  const x =
    Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
    Math.sin((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.cos(((b.lon - a.lon) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export class SatelliteLayer extends Layer {
  constructor(ctx, def, opts) {
    super(ctx, { pollMs: 3 * 3600_000, ...def });
    this.feeds = opts.feeds;
    this.filter = opts.filter || (() => true);
    this.kind = opts.kind || 'satellite';
    this.slice = opts.slice ?? Infinity;
    this.orbitRibbon = Boolean(opts.orbitRibbon);
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(opts.tint || ORBIT),
      glyphName: opts.glyph || 'sat',
      lodHeightM: opts.lodHeightM ?? 9_000_000,
      cap: opts.cap ?? 250,
      rotate: false,
      dotScale: opts.dotScale ?? 0.32,
      glyphScale: opts.glyphScale ?? 0.42,
      alwaysGlyph: opts.alwaysGlyph,
    });
    this.sats = []; // { key, name, satrec, norad }
    this.byKey = new Map();
    this._rr = 0;
    this._lastMs = 0;
    if (this.orbitRibbon) {
      this.ribbons = this.root.add(new Cesium.PolylineCollection());
    }
  }

  async refresh() {
    const results = await Promise.allSettled(this.feeds.map((f) => f.get()));
    const seen = new Set();
    const sats = [];
    let ok = false;
    this.feeds.forEach((feed, i) => {
      this.fromFeed(feed);
      if (results[i].status !== 'fulfilled') return;
      ok = true;
      for (const e of results[i].value.entries) {
        const norad = Number(e.line1.slice(2, 7));
        const key = String(e.line1.slice(2, 7).trim());
        if (seen.has(key) || !this.filter(e, norad)) continue;
        seen.add(key);
        let satrec;
        try {
          satrec = twoline2satrec(e.line1, e.line2);
        } catch {
          continue;
        }
        sats.push({
          key,
          name: e.name.replace(/^0 /, '').trim(),
          satrec,
          norad,
        });
      }
    });
    if (!ok) throw results[0].reason;
    this.sats = sats;
    this.byKey = new Map(sats.map((s) => [s.key, s]));
    this._place(this.ctx.timeMs(), true);
  }

  _place(ms, full) {
    const items = [];
    const keep = [];
    for (const s of this.sats) {
      const p = satPosition(s.satrec, ms);
      if (!p) continue;
      s.pos = p;
      keep.push(s);
      const crewed = CREWED.has(s.norad);
      items.push({
        key: s.key,
        lon: p.lon,
        lat: p.lat,
        altM: p.altM,
        glyph: s.norad === 25544 ? 'iss' : undefined,
        glyphScale: s.norad === 25544 ? 1.6 : crewed ? 1.2 : 1,
        dotScale: crewed ? 2.2 : 1,
        color: crewed ? color('#FFFFFF') : undefined,
      });
    }
    this.count = keep.length;
    if (full) this.renderer.setItems(items);
    this._lastMs = ms;
    this._drawRibbons(ms);
  }

  _drawRibbons(ms) {
    if (!this.ribbons) return;
    this.ribbons.removeAll();
    for (const s of this.sats) {
      if (!CREWED.has(s.norad)) continue;
      const positions = [];
      // One orbit ahead, 30 min behind, sampled every 60 s.
      for (let t = -30; t <= 93; t++) {
        const p = satPosition(s.satrec, ms + t * 60_000);
        if (p)
          positions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altM));
      }
      if (positions.length < 2) continue;
      this.ribbons.add({
        positions,
        width: s.norad === 25544 ? 3 : 2,
        material: Cesium.Material.fromType('PolylineGlow', {
          color: color(s.norad === 25544 ? '#E9DDFF' : ORBIT, 0.32),
          glowPower: 0.18,
          taperPower: 1,
        }),
      });
    }
  }

  /** Propagate to `ms`: the glyph-visible satellites plus a round-robin slice. */
  _advance(ms) {
    const items = this.renderer.items;
    if (!items.length) return false;
    const n = items.length;
    const slice = Math.min(n, this.slice);
    const from = this._rr % n;
    const to = Math.min(n, from + slice);
    for (let i = from; i < to; i++) this._updateItem(items[i], ms);
    for (let i = 0; i < this.renderer.glyphs.length; i++) {
      const it = this.renderer.byKey.get(this.renderer.glyphs.get(i).id.key);
      if (it) this._updateItem(it, ms);
    }
    this.renderer.moveItems(from, to);
    this._rr = to >= n ? 0 : to;
    return true;
  }

  _updateItem(it, ms) {
    const s = this.byKey.get(it.key);
    const p = s && satPosition(s.satrec, ms);
    if (!p) return;
    s.pos = p;
    it.lon = p.lon;
    it.lat = p.lat;
    it.altM = p.altM;
  }

  onView(view) {
    this.renderer.setView(view);
  }

  onTime(ms) {
    if (!this.sats.length) return;
    if (this.sats.length <= 3000) {
      for (const it of this.renderer.items) this._updateItem(it, ms);
      this.renderer.moveItems();
    } else this._advance(ms);
    this._lastMs = ms;
    this._drawRibbons(ms);
  }

  onTick(nowMs, live, clockMs) {
    if (!this.sats.length) return false;
    if (Math.abs(clockMs - this._lastMs) < 900) return false;
    this._advance(clockMs);
    if (this.ribbons && Math.abs(clockMs - (this._ribbonMs || 0)) > 60_000) {
      this._ribbonMs = clockMs;
      this._drawRibbons(clockMs);
    }
    this._lastMs = clockMs;
    return true;
  }

  locate(key) {
    const s = this.byKey.get(key);
    const p = s && satPosition(s.satrec, this.ctx.timeMs());
    return p ? [p.lon, p.lat, p.altM] : null;
  }

  trail(key) {
    const s = this.byKey.get(key);
    if (!s) return [];
    const ms = this.ctx.timeMs();
    const out = [];
    for (let t = -45; t <= 45; t += 1) {
      const p = satPosition(s.satrec, ms + t * 60_000);
      if (p) out.push([p.lon, p.lat, p.altM]);
    }
    return out;
  }

  satrecFor(norad) {
    return this.sats.find((s) => s.norad === norad)?.satrec || null;
  }

  pick(key) {
    const s = this.byKey.get(key);
    if (!s) return null;
    const p = satPosition(s.satrec, this.ctx.timeMs());
    if (!p) return null;
    return {
      kind: this.kind,
      id: s.key,
      title: s.name,
      subtitle: `NORAD ${s.norad} · ${Math.round(p.altM / 1000)} km · ${(p.speedMps / 1000).toFixed(1)} km/s`,
      lon: p.lon,
      lat: p.lat,
      meta: {
        layer: this.id,
        norad: s.norad,
        altitudeM: p.altM,
        speedMps: p.speedMps,
        headingDeg: trackHeading(s.satrec, this.ctx.timeMs()),
        source: this.source,
      },
    };
  }

  contacts() {
    const ms = this.ctx.timeMs();
    return this.sats
      .filter((s) => s.pos)
      .map((s) => ({
        kind: this.kind,
        id: s.key,
        title: s.name,
        lon: s.pos.lon,
        lat: s.pos.lat,
        altM: s.pos.altM,
        headingDeg: CREWED.has(s.norad) ? trackHeading(s.satrec, ms) : null,
        layer: this.id,
      }));
  }
}

/** Per pad: the next pending launch beats any past one; else the latest. */
function betterLaunch(a, b, t) {
  const ap = a.net >= t;
  const bp = b.net >= t;
  if (ap !== bp) return ap;
  return ap ? a.net < b.net : a.net > b.net;
}

export class LaunchLayer extends Layer {
  constructor(ctx, def, { feed }) {
    super(ctx, { pollMs: 30 * 60_000, ...def });
    this.feed = feed;
    this.renderer = new ContactRenderer(this.root, {
      layerId: this.id,
      tint: color(ORBIT),
      glyphName: 'rocket',
      rotate: false,
      alwaysGlyph: true,
      glyphScale: 0.62,
      dotScale: 0.8,
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
    // One marker per pad: the next launch from it, or its most recent one.
    const byPad = new Map();
    for (const r of data.records) {
      const key = `${r.lat.toFixed(3)},${r.lon.toFixed(3)}`;
      const cur = byPad.get(key);
      if (!cur || betterLaunch(r, cur, t)) byPad.set(key, r);
    }
    for (const r of byPad.values()) {
      this.records.set(r.id, r);
      const pending = r.net > t;
      const soon = pending && r.net - t < 7 * 86_400_000;
      items.push({
        key: r.id,
        lon: r.lon,
        lat: r.lat,
        altM: 0,
        color: pending
          ? color(soon ? '#FFFFFF' : ORBIT, soon ? 1 : 0.85)
          : color(ORBIT, 0.45),
        glyphScale: soon ? 1.25 : 0.9,
      });
    }
    this.count = data.records.filter((r) => r.net > t).length;
    this.renderer.setItems(items);
  }

  onView(view) {
    this.renderer.setView(view);
  }

  onTime() {
    this._draw();
  }

  locate(key) {
    const r = this.records.get(key);
    return r ? [r.lon, r.lat, 0] : null;
  }

  pick(key) {
    const r = this.records.get(key);
    if (!r) return null;
    const t = this.ctx.timeMs();
    return {
      kind: 'launch',
      id: r.id,
      title: r.name,
      subtitle: `${r.provider || r.pad} · ${r.net > t ? 'T−' : ''}${relTime(r.net, t)}${r.status ? ` · ${r.status}` : ''}`,
      lon: r.lon,
      lat: r.lat,
      meta: {
        layer: this.id,
        net: new Date(r.net).toISOString(),
        pad: r.pad,
        location: r.location,
        mission: r.mission,
        orbit: r.orbit,
        image: r.image,
        status: r.status,
        source: this.source,
      },
    };
  }
}

export function createOrbitLayers(
  ctx,
  { visual, stations, gps, starlink, launches },
) {
  return [
    new SatelliteLayer(
      ctx,
      { id: 'satellites', family: 'Orbit', name: 'Satellites (TLE)' },
      {
        feeds: [visual, gps],
        filter: (e, norad) => !CREWED.has(norad),
        dotScale: 0.34,
      },
    ),
    new SatelliteLayer(
      ctx,
      { id: 'iss', family: 'Orbit', name: 'ISS & crewed' },
      {
        feeds: [stations],
        filter: (e, norad) => CREWED.has(norad),
        kind: 'station',
        alwaysGlyph: true,
        orbitRibbon: true,
        glyph: 'sat',
      },
    ),
    new SatelliteLayer(
      ctx,
      { id: 'starlink', family: 'Orbit', name: 'Starlink trains' },
      {
        feeds: [starlink],
        slice: 1500,
        dotScale: 0.22,
        tint: '#B9A2F0',
        cap: 200,
        lodHeightM: 3_000_000,
      },
    ),
    new LaunchLayer(
      ctx,
      { id: 'launches', family: 'Orbit', name: 'Launches & trajectories' },
      { feed: launches },
    ),
  ];
}
