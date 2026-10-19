/**
 * Pins for discourse and capture (DESIGN.md §11.3–11.4): posts, sealed
 * witness captures, public camera eyes, live broadcasts and holograms. Eyes
 * and live pins draw their view frustum as a translucent wedge on the ground
 * along the camera heading. Pins are few (tens), so the wedge primitive is
 * simply rebuilt on change.
 */
import * as Cesium from 'cesium';
import { glyph } from './glyphs.js';
import { offsetLonLat } from './geo.js';

export const PIN_KINDS = Object.freeze([
  'post',
  'witness',
  'eye',
  'live',
  'hologram',
]);

const PIN_COLORS = Object.freeze({
  post: '#E8EEF7',
  witness: '#FFC857',
  eye: '#FFD166',
  live: '#FF4D6D',
  hologram: '#C9A7FF',
});

const PIN_TITLES = Object.freeze({
  post: 'Post',
  witness: 'Sealed witness capture',
  eye: 'Public camera',
  live: 'Live broadcast',
  hologram: 'Hologram',
});

export function createPins({ scene, requestRender }) {
  const root = scene.primitives.add(new Cesium.PrimitiveCollection());
  const billboards = root.add(new Cesium.BillboardCollection());
  const edges = root.add(new Cesium.PolylineCollection());
  let wedges = null;
  const pins = new Map();
  let pulse = 0;

  function rebuildWedges() {
    if (wedges) root.remove(wedges);
    wedges = null;
    edges.removeAll();
    const instances = [];
    for (const p of pins.values()) {
      if (p.kind !== 'eye' && p.kind !== 'live') continue;
      if (!Number.isFinite(p.headingDeg)) continue;
      const half = (p.fovDeg ?? 60) / 2;
      const ring = [[p.lon, p.lat]];
      for (let a = -half; a <= half + 0.01; a += Math.max(2, half / 6))
        ring.push(offsetLonLat(p.lon, p.lat, p.headingDeg + a, p.rangeM));
      const css = p.color || PIN_COLORS[p.kind];
      instances.push(
        new Cesium.GeometryInstance({
          id: { layer: 'pins', key: p.id },
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArray(ring.flat()),
            ),
            height: (p.altM || 0) + 3,
            vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(css).withAlpha(0.28),
            ),
          },
        }),
      );
      edges.add({
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(
          [...ring, ring[0]].flatMap(([lo, la]) => [lo, la, (p.altM || 0) + 4]),
        ),
        width: 1.5,
        material: Cesium.Material.fromType('Color', {
          color: Cesium.Color.fromCssColorString(css).withAlpha(0.85),
        }),
      });
    }
    if (instances.length)
      wedges = root.add(
        new Cesium.Primitive({
          geometryInstances: instances,
          appearance: new Cesium.PerInstanceColorAppearance({
            flat: true,
            translucent: true,
          }),
          asynchronous: true,
        }),
      );
  }

  function rebuildBillboards() {
    billboards.removeAll();
    for (const p of pins.values()) {
      const g = glyph(p.kind);
      p._bb = billboards.add({
        position: Cesium.Cartesian3.fromDegrees(
          p.lon,
          p.lat,
          (p.altM || 0) + 8,
        ),
        image: g.image,
        imageId: g.imageId,
        color: Cesium.Color.fromCssColorString(p.color || PIN_COLORS[p.kind]),
        scale: 0.62,
        scaleByDistance: new Cesium.NearFarScalar(2e3, 1.15, 8e6, 0.55),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: 2e5,
        id: { layer: 'pins', key: p.id },
      });
    }
  }

  function changed() {
    rebuildBillboards();
    rebuildWedges();
    requestRender();
  }

  return {
    add(pin) {
      if (!pin || pin.id == null) throw new TypeError('addPin needs an id');
      if (!Number.isFinite(pin.lon) || !Number.isFinite(pin.lat))
        throw new TypeError('addPin needs lon and lat');
      const kind = PIN_KINDS.includes(pin.kind) ? pin.kind : 'post';
      const p = {
        id: String(pin.id),
        lon: pin.lon,
        lat: pin.lat,
        kind,
        headingDeg: Number.isFinite(pin.headingDeg) ? pin.headingDeg : null,
        fovDeg: Number.isFinite(pin.fovDeg) ? pin.fovDeg : 60,
        rangeM: Number.isFinite(pin.rangeM) ? pin.rangeM : 350,
        color: pin.color || null,
        label: pin.label || '',
        altM: Number.isFinite(pin.altM) ? pin.altM : 0,
      };
      pins.set(p.id, p);
      changed();
      return p.id;
    },
    remove(id) {
      const ok = pins.delete(String(id));
      if (ok) changed();
      return ok;
    },
    list() {
      return [...pins.values()].map(({ _bb, ...p }) => ({ ...p }));
    },
    locate(id) {
      const p = pins.get(String(id));
      return p ? [p.lon, p.lat, p.altM || 0] : null;
    },
    pick(id) {
      const p = pins.get(String(id));
      if (!p) return null;
      return {
        kind: 'pin',
        pinKind: p.kind,
        id: p.id,
        title: p.label || PIN_TITLES[p.kind],
        subtitle: PIN_TITLES[p.kind],
        lon: p.lon,
        lat: p.lat,
        meta: {
          layer: 'pins',
          headingDeg: p.headingDeg,
          fovDeg: p.fovDeg,
          label: p.label,
        },
      };
    },
    /** Live pins breathe once a second; returns true when anything changed. */
    tick() {
      let any = false;
      pulse = (pulse + 1) % 2;
      for (const p of pins.values())
        if (p.kind === 'live' && p._bb) {
          p._bb.scale = pulse ? 0.74 : 0.6;
          any = true;
        }
      return any;
    },
    get billboards() {
      return billboards;
    },
    destroy() {
      scene.primitives.remove(root);
    },
  };
}
