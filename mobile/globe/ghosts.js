/**
 * History view (DESIGN.md §12.5): when the clock is in the recorded past,
 * every recorded contact is drawn where it actually was, interpolated
 * between polls, with a ghost trail of the four minutes before.
 *
 * One BillboardCollection (glyphs move in place, keyed by entity) and one
 * PolylineCollection for trails, rebuilt at most 4×/s and only for the
 * contacts nearest the view centre.
 */
import * as Cesium from 'cesium';
import { glyph } from './glyphs.js';

const D2R = Math.PI / 180;
const GLYPH_CAP = 900;
const TRAIL_CAP = 160;
const TRAIL_MS = 4 * 60_000;
const NEAR_FAR = new Cesium.NearFarScalar(2e4, 1.2, 3e6, 0.6);

const COLORS = {
  aircraft: Cesium.Color.fromCssColorString('#BFE6FF'),
  helicopter: Cesium.Color.fromCssColorString('#9BE15D'),
  military: Cesium.Color.fromCssColorString('#FFD166'),
  vessel: Cesium.Color.fromCssColorString('#38E1C6'),
  emergency: Cesium.Color.fromCssColorString('#FF3B30'),
};

export function createGhosts({ scene, recorder, requestRender }) {
  const root = scene.primitives.add(new Cesium.PrimitiveCollection());
  root.show = false;
  const glyphs = root.add(new Cesium.BillboardCollection());
  const trails = root.add(new Cesium.PolylineCollection());
  const byKey = new Map(); // key → { bb, state }
  let lastTrails = 0;
  let shown = false;
  let lastMs = 0;

  const colorOf = (meta) =>
    meta?.emergency ? COLORS.emergency : COLORS[meta?.kind] || COLORS.aircraft;

  function hide() {
    if (!shown) return;
    shown = false;
    root.show = false;
    glyphs.removeAll();
    trails.removeAll();
    byKey.clear();
    requestRender();
  }

  function update(ms, view, { force = false } = {}) {
    lastMs = ms;
    const rect = view?.rect
      ? {
          west: view.rect.west - 0.5,
          east: view.rect.east + 0.5,
          south: view.rect.south - 0.5,
          north: view.rect.north + 0.5,
        }
      : null;
    const list = recorder.snapshotAt(ms, { rect });
    const c = view?.center || { lon: 0, lat: 0 };
    const cos = Math.cos(c.lat * D2R);
    for (const s of list)
      s.d = (s.lat - c.lat) ** 2 + ((s.lon - c.lon) * cos) ** 2;
    list.sort((a, b) => a.d - b.d);
    const keep = list.slice(0, GLYPH_CAP);
    const seen = new Set();
    for (const s of keep) {
      seen.add(s.key);
      let e = byKey.get(s.key);
      const pos = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, s.altM || 0);
      if (!e) {
        const g = glyph(
          s.meta?.kind === 'vessel'
            ? 'ship'
            : s.meta?.helicopter
              ? 'heli'
              : 'plane',
        );
        e = {
          bb: glyphs.add({
            position: pos,
            image: g.image,
            imageId: g.imageId,
            color: colorOf(s.meta).withAlpha(0.92),
            scale: s.meta?.helicopter ? 0.55 : 0.46,
            alignedAxis: Cesium.Cartesian3.UNIT_Z,
            scaleByDistance: NEAR_FAR,
            disableDepthTestDistance: 150_000,
            id: { layer: 'history', key: s.key },
          }),
        };
        byKey.set(s.key, e);
      } else e.bb.position = pos;
      e.bb.rotation = -(s.headingDeg || 0) * D2R;
      e.state = s;
    }
    for (const [key, e] of byKey)
      if (!seen.has(key)) {
        glyphs.remove(e.bb);
        byKey.delete(key);
      }
    const now = performance.now();
    if (force || now - lastTrails > 250) {
      lastTrails = now;
      trails.removeAll();
      for (const s of keep.slice(0, TRAIL_CAP)) {
        const pts = recorder.trail(s.key, ms - TRAIL_MS, ms, 60);
        if (pts.length < 2) continue;
        trails.add({
          positions: pts.map(([lo, la, h]) =>
            Cesium.Cartesian3.fromDegrees(lo, la, h || 0),
          ),
          width: 2.5,
          material: Cesium.Material.fromType('PolylineGlow', {
            color: colorOf(s.meta).withAlpha(0.7),
            glowPower: 0.25,
            taperPower: 0.4,
          }),
        });
      }
    }
    shown = true;
    root.show = true;
    requestRender();
    return keep.length;
  }

  return {
    update,
    hide,
    get shown() {
      return shown;
    },
    get glyphs() {
      return glyphs;
    },
    pick(key) {
      const e = byKey.get(key);
      if (!e?.state) return null;
      const s = e.state;
      const m = s.meta || {};
      const layer = m.layer || 'flights';
      return {
        kind: m.kind || 'aircraft',
        id: key,
        entityId: `${layer}:${key}`,
        title: m.callsign || m.title || key.toUpperCase(),
        subtitle: [
          'Recorded',
          new Date(lastMs).toISOString().slice(11, 19) + 'Z',
          `${Math.round((s.altM * 3.28084) / 100) * 100} ft`,
          `${Math.round(s.speed / 0.514444)} kt`,
        ].join(' · '),
        lon: s.lon,
        lat: s.lat,
        meta: {
          layer: 'history',
          entityLayer: layer,
          icao24: key,
          altitudeM: s.altM,
          speedMps: s.speed,
          headingDeg: s.headingDeg,
          recordedAt: lastMs,
        },
      };
    },
    destroy() {
      scene.primitives.remove(root);
    },
  };
}
