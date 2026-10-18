/**
 * Layer plumbing: lifecycle/polling/status for every live layer, and the
 * ContactRenderer that draws point contacts with semantic zoom.
 *
 * Semantic zoom: every contact is a soft glow dot (one BillboardCollection,
 * one draw call) so the planet reads as density at orbital altitude. Below the
 * layer's LOD height, the contacts nearest the view centre (capped) also get a
 * heading-aligned glyph that dead-reckons between polls.
 */
import * as Cesium from 'cesium';
import { glyph } from '../glyphs.js';
import { offsetLonLat } from '../geo.js';

export const FAMILY_COLORS = Object.freeze({
  Sky: '#7CC4FF',
  Sea: '#38E1C6',
  Orbit: '#C9A7FF',
  Hazards: '#FF6A3D',
  Eyes: '#FFD166',
  Ground: '#9BE15D',
  Weather: '#8AB4F8',
  Infra: '#B8C0CC',
});

export const color = (css, alpha = 1) =>
  Cesium.Color.fromCssColorString(css).withAlpha(alpha);

export class Layer {
  /**
   * @param {object} ctx engine context from index.js
   * @param {{id:string,family:string,name:string,pollMs?:number}} def
   */
  constructor(ctx, def) {
    this.ctx = ctx;
    this.id = def.id;
    this.family = def.family;
    this.name = def.name;
    this.pollMs = def.pollMs ?? 0;
    this.available = true;
    this.on = false;
    this.count = 0;
    this.status = 'off';
    this.message = '';
    this.source = def.source || '';
    this.updatedAt = null;
    this.loading = false;
    this.root = ctx.scene.primitives.add(new Cesium.PrimitiveCollection());
    this.root.show = false;
    this._timer = null;
    this._gen = 0;
  }

  info() {
    return {
      id: this.id,
      family: this.family,
      name: this.name,
      on: this.on,
      count: this.on ? this.count : 0,
      status: this.on ? this.status : 'off',
      available: this.available,
      loading: this.on && this.loading,
      message: this.message,
      source: this.source,
      updatedAt: this.updatedAt,
    };
  }

  setOn(on) {
    on = Boolean(on);
    if (on === this.on) return;
    this.on = on;
    this.root.show = on;
    this._gen++;
    clearTimeout(this._timer);
    this._timer = null;
    if (on) {
      this.status = this.updatedAt ? this.status : 'stale';
      this.kick();
    } else {
      this.onHide?.();
    }
    this.ctx.layersChanged();
    this.ctx.requestRender();
  }

  /** Refresh now (if on and active) and keep polling. */
  kick() {
    if (!this.on) return;
    clearTimeout(this._timer);
    this._timer = null;
    const gen = this._gen;
    if (!this.ctx.active()) return; // resume() kicks again
    this.loading = true;
    Promise.resolve()
      .then(() => this.refresh())
      .then(
        () => {
          if (gen !== this._gen) return;
          this.updatedAt = Date.now();
        },
        (error) => {
          if (gen !== this._gen) return;
          this.status = 'error';
          this.message = error?.message || String(error);
          console.warn(`[globe:${this.id}]`, this.message);
        },
      )
      .finally(() => {
        if (gen !== this._gen) return;
        this.loading = false;
        this.ctx.layersChanged();
        this.ctx.requestRender();
        if (this.pollMs && this.on)
          this._timer = setTimeout(() => this.kick(), this.pollMs);
      });
  }

  /** Mark status from a feed after a refresh. */
  fromFeed(feed) {
    if (feed.error && !feed.data) {
      this.status = 'error';
      this.message = feed.error.message;
    } else {
      this.status = feed.stale ? 'stale' : 'live';
      this.message = feed.error ? `Refresh failed: ${feed.error.message}` : '';
    }
    if (feed.data?.source) this.source = feed.data.source;
  }

  // Overridables
  async refresh() {}
  onView() {}
  onTime() {}
  onTick() {}
  pick() {
    return null;
  }
  contacts() {
    return [];
  }
  destroy() {
    clearTimeout(this._timer);
    this.ctx.scene.primitives.remove(this.root);
  }
}

/** A catalog entry the prototype does not render yet. */
export class UnavailableLayer {
  constructor(def) {
    Object.assign(this, def);
    this.on = false;
    this.available = false;
  }
  info() {
    return {
      id: this.id,
      family: this.family,
      name: this.name,
      on: false,
      count: 0,
      status: 'off',
      available: false,
      loading: false,
      message: this.message || 'Not in the prototype yet',
      source: '',
      updatedAt: null,
    };
  }
  setOn() {}
  kick() {}
  onView() {}
  onTime() {}
  onTick() {}
  pick() {
    return null;
  }
  contacts() {
    return [];
  }
  destroy() {}
}

const DOT = () => glyph('dot');
const GLYPH_NEAR_FAR = new Cesium.NearFarScalar(2e4, 1.25, 3e6, 0.7);
const GLYPH_NO_DEPTH_WITHIN_M = 150_000;

/**
 * Point contacts with semantic zoom.
 * items: [{ key, lon, lat, altM?, heading?, speed?, seenAt?, color?, glyph?,
 *           dotScale?, glyphScale? }]
 */
export class ContactRenderer {
  constructor(
    root,
    {
      tint,
      glyphName = 'dot',
      lodHeightM = 2_500_000,
      cap = 900,
      rotate = true,
      dotScale = 0.42,
      glyphScale = 0.5,
      layerId,
      deadReckon = false,
      dotAlpha = 0.85,
      alwaysGlyph = false,
    },
  ) {
    this.layerId = layerId;
    this.tint = tint;
    this.glyphName = glyphName;
    this.lodHeightM = lodHeightM;
    this.cap = cap;
    this.rotate = rotate;
    this.dotScale = dotScale;
    this.glyphScale = glyphScale;
    this.deadReckon = deadReckon;
    this.dotAlpha = dotAlpha;
    this.alwaysGlyph = alwaysGlyph;
    this.dots = root.add(
      new Cesium.BillboardCollection({
        blendOption: Cesium.BlendOption.TRANSLUCENT,
      }),
    );
    this.glyphs = root.add(new Cesium.BillboardCollection());
    this.items = [];
    this.byKey = new Map();
    this.view = null;
    this.glyphMode = false;
    this.alpha = 1;
    this._scratch = new Cesium.Cartesian3();
  }

  setItems(items) {
    this.items = items;
    this.byKey = new Map(items.map((it) => [it.key, it]));
    const dot = DOT();
    this.dots.removeAll();
    const near = new Cesium.NearFarScalar(4e5, 1.0, 2.2e7, 0.45);
    for (const it of items) {
      const c = it.color || this.tint;
      this.dots.add({
        position: Cesium.Cartesian3.fromDegrees(it.lon, it.lat, it.altM || 0),
        image: dot.image,
        imageId: dot.imageId,
        color: c.withAlpha(c.alpha * this.dotAlpha * this.alpha),
        scale: (it.dotScale ?? 1) * this.dotScale,
        scaleByDistance: near,
        id: { layer: this.layerId, key: it.key },
      });
    }
    this._rebuildGlyphs();
  }

  setAlpha(alpha) {
    if (alpha === this.alpha) return;
    this.alpha = alpha;
    this.setItems(this.items);
  }

  setView(view) {
    this.view = view;
    this._rebuildGlyphs();
  }

  _rebuildGlyphs() {
    const view = this.view;
    this.glyphs.removeAll();
    this.glyphMode =
      this.alwaysGlyph || Boolean(view && view.heightM < this.lodHeightM);
    if (!this.glyphMode || !view) return;
    const { rect } = view;
    const cLat = view.center?.lat ?? 0;
    const cLon = view.center?.lon ?? 0;
    const inView = [];
    for (const it of this.items) {
      if (rect && !inRect(rect, it.lon, it.lat)) continue;
      const dLat = it.lat - cLat;
      const dLon = (it.lon - cLon) * Math.cos((cLat * Math.PI) / 180);
      inView.push([dLat * dLat + dLon * dLon, it]);
    }
    inView.sort((a, b) => a[0] - b[0]);
    const n = Math.min(this.cap, inView.length);
    for (let i = 0; i < n; i++) {
      const it = inView[i][1];
      const g = glyph(it.glyph || this.glyphName);
      it._bb = this.glyphs.add({
        position: Cesium.Cartesian3.fromDegrees(it.lon, it.lat, it.altM || 0),
        image: g.image,
        imageId: g.imageId,
        color: (it.color || this.tint).withAlpha(
          (it.color || this.tint).alpha * this.alpha,
        ),
        scale: (it.glyphScale ?? 1) * this.glyphScale,
        rotation: this.rotate ? -Cesium.Math.toRadians(it.heading || 0) : 0,
        alignedAxis: this.rotate
          ? Cesium.Cartesian3.UNIT_Z
          : Cesium.Cartesian3.ZERO,
        id: { layer: this.layerId, key: it.key },
        scaleByDistance: GLYPH_NEAR_FAR,
        // Contacts report ellipsoid/MSL heights; over terrain a grounded or
        // low contact would sink below the surface. Close in, glyphs ignore
        // depth (a God's-eye HUD), far out the globe still occludes them.
        disableDepthTestDistance: GLYPH_NO_DEPTH_WITHIN_M,
      });
    }
  }

  /**
   * Move items in place (same keys, same order as the last setItems): no
   * billboard churn. `from`/`to` bound a round-robin slice of the dots;
   * glyph billboards always move.
   */
  moveItems(from = 0, to = this.items.length) {
    const n = Math.min(to, this.items.length, this.dots.length);
    for (let i = from; i < n; i++) {
      const it = this.items[i];
      this.dots.get(i).position = Cesium.Cartesian3.fromDegrees(
        it.lon,
        it.lat,
        it.altM || 0,
      );
    }
    for (let i = 0; i < this.glyphs.length; i++) {
      const bb = this.glyphs.get(i);
      const it = this.byKey.get(bb.id.key);
      if (it)
        bb.position = Cesium.Cartesian3.fromDegrees(
          it.lon,
          it.lat,
          it.altM || 0,
        );
    }
  }

  /** Dead-reckon glyphs from their last fix. Returns true when anything moved. */
  tick(nowMs) {
    if (!this.deadReckon || !this.glyphMode) return false;
    let moved = false;
    for (let i = 0; i < this.glyphs.length; i++) {
      const bb = this.glyphs.get(i);
      const it = this.byKey.get(bb.id.key);
      if (!it || !it.speed || it.onGround || !it.seenAt) continue;
      const dt = Math.min(90, Math.max(0, (nowMs - it.seenAt) / 1000));
      const [lon, lat] = offsetLonLat(
        it.lon,
        it.lat,
        it.heading,
        it.speed * dt,
      );
      bb.position = Cesium.Cartesian3.fromDegrees(
        lon,
        lat,
        it.altM || 0,
        undefined,
        this._scratch,
      );
      moved = true;
    }
    return moved;
  }

  /** Current (dead-reckoned) lon/lat of an item. */
  where(it, nowMs = Date.now()) {
    if (!this.deadReckon || !it.speed || it.onGround || !it.seenAt)
      return [it.lon, it.lat];
    const dt = Math.min(90, Math.max(0, (nowMs - it.seenAt) / 1000));
    return offsetLonLat(it.lon, it.lat, it.heading, it.speed * dt);
  }

  clear() {
    this.items = [];
    this.byKey.clear();
    this.dots.removeAll();
    this.glyphs.removeAll();
  }
}

export function inRect(rect, lon, lat) {
  if (lat < rect.south || lat > rect.north) return false;
  if (rect.west <= rect.east) return lon >= rect.west && lon <= rect.east;
  return lon >= rect.west || lon <= rect.east; // crosses the antimeridian
}
