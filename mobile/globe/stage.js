/**
 * The Moment stage (DESIGN.md §12.4): draws one Moment on the globe, keyed to
 * the clock.
 *
 *   tracks    a glyph per aircraft at its interpolated position, a bright
 *             90-second trail, the whole flown path faint behind it, and a
 *             hairline drop line to the ground
 *   captures  a 3D view frustum per witness capture, from the phone to the
 *             subject, appearing (with a flash) when the clock passes it
 *   subject   a highlighted building (real massing when the Moment bundles
 *             it), an antenna beacon, a pulsing ring at the subject height
 *   camera    a cinematic path keyed to time (Catmull-Rom through the keys),
 *             released the moment the person touches the globe
 *
 * Everything is primitives, never Entities. Positions update in place each
 * frame; the long "flown path" polylines rebuild at most 4×/s.
 */
import * as Cesium from 'cesium';
import { glyph } from './glyphs.js';

const D2R = Math.PI / 180;
const TRAIL_MS = 90_000;
const SCRATCH = new Cesium.Cartesian3();

const css = (c, a = 1) => Cesium.Color.fromCssColorString(c).withAlpha(a);

/** Index of the last point with t <= ms (binary search), -1 before the start. */
function indexAt(points, ms) {
  let lo = 0;
  let hi = points.length - 1;
  if (!points.length || ms < points[0].t) return -1;
  if (ms >= points[hi].t) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Interpolated { lon, lat, altM, heading, speed } on a track at ms, or null. */
export function trackStateAt(points, ms, { holdMs = 30_000 } = {}) {
  const i = indexAt(points, ms);
  if (i < 0) return null;
  const a = points[i];
  const b = points[i + 1];
  if (!b) {
    if (ms - a.t > holdMs) return null;
    const p = points[i - 1] || a;
    return { ...a, heading: headingOf(p, a), speed: speedOf(p, a) };
  }
  if (b.t - a.t > 6 * 60_000) return null;
  const f = (ms - a.t) / (b.t - a.t || 1);
  // Heading and speed over a ~6-second baseline smooth out ADS-B jitter
  // (on sparse live data: just the two fixes either side).
  let j = i;
  let k = i + 1;
  while (j > 0 && a.t - points[j - 1].t <= 3000) j--;
  while (k < points.length - 1 && points[k + 1].t - b.t <= 3000) k++;
  return {
    t: ms,
    lon: a.lon + (b.lon - a.lon) * f,
    lat: a.lat + (b.lat - a.lat) * f,
    altM: a.altM + (b.altM - a.altM) * f,
    heading: headingOf(points[j], points[k]),
    speed: speedOf(points[j], points[k]),
  };
}

function headingOf(a, b) {
  const dx = (b.lon - a.lon) * Math.cos(a.lat * D2R);
  const dy = b.lat - a.lat;
  if (!dx && !dy) return 0;
  return (Math.atan2(dx, dy) / D2R + 360) % 360;
}
function speedOf(a, b) {
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return 0;
  const dx = (b.lon - a.lon) * 111_320 * Math.cos(a.lat * D2R);
  const dy = (b.lat - a.lat) * 110_574;
  return Math.hypot(dx, dy) / dt;
}

/* ── Camera path ──────────────────────────────────────────────── */

function catmull(p0, p1, p2, p3, f) {
  const f2 = f * f;
  const f3 = f2 * f;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * f3)
  );
}

/** Camera { lon, lat, height, heading, pitch } on a keyed path at ms. */
export function cameraAt(path, ms) {
  if (!path?.length) return null;
  if (ms <= path[0].t) return { ...path[0] };
  if (ms >= path.at(-1).t) return { ...path.at(-1) };
  let i = 0;
  while (i < path.length - 2 && path[i + 1].t <= ms) i++;
  const k0 = path[Math.max(0, i - 1)];
  const k1 = path[i];
  const k2 = path[i + 1];
  const k3 = path[Math.min(path.length - 1, i + 2)];
  const raw = (ms - k1.t) / (k2.t - k1.t || 1);
  // Unwrap headings around k1 so a 350° → 10° key pans the short way.
  const un = (h) => k1.heading + (((h - k1.heading + 540) % 360) - 180);
  const h0 = un(k0.heading);
  const h2 = un(k2.heading);
  const h3 = h2 + (((k3.heading - k2.heading + 540) % 360) - 180);
  return {
    lon: catmull(k0.lon, k1.lon, k2.lon, k3.lon, raw),
    lat: catmull(k0.lat, k1.lat, k2.lat, k3.lat, raw),
    height: catmull(k0.height, k1.height, k2.height, k3.height, raw),
    heading: (catmull(h0, k1.heading, h2, h3, raw) + 360) % 360,
    pitch: catmull(k0.pitch, k1.pitch, k2.pitch, k3.pitch, raw),
  };
}

/* ── Frustum geometry ─────────────────────────────────────────── */

/** World-space apex and four far corners of a capture's view cone. */
function frustumCorners(c, groundH, lengthM) {
  const origin = Cesium.Cartesian3.fromDegrees(
    c.lon,
    c.lat,
    groundH + (c.altM || 1.5),
  );
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const h = (c.headingDeg || 0) * D2R;
  const p = (c.pitchDeg || 0) * D2R;
  const d = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
  const r = [Math.cos(h), -Math.sin(h), 0];
  const u = [
    r[1] * d[2] - r[2] * d[1],
    r[2] * d[0] - r[0] * d[2],
    r[0] * d[1] - r[1] * d[0],
  ];
  // Portrait phone frame: fovDeg across the short side, 4:3.
  const th = Math.tan(((c.fovDeg || 60) * D2R) / 2);
  const tv = th * (4 / 3);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const local = new Cesium.Cartesian3(
      lengthM * (d[0] + th * sx * r[0] + tv * sy * u[0]),
      lengthM * (d[1] + th * sx * r[1] + tv * sy * u[1]),
      lengthM * (d[2] + th * sx * r[2] + tv * sy * u[2]),
    );
    return Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
  });
  return { origin, corners };
}

function frustumGeometry(origin, corners) {
  const pts = [origin, ...corners];
  const values = new Float64Array(pts.length * 3);
  pts.forEach((q, i) => {
    values[i * 3] = q.x;
    values[i * 3 + 1] = q.y;
    values[i * 3 + 2] = q.z;
  });
  return new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values,
      }),
    },
    // Four sides; the far face is left open so the subject shows through.
    indices: new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromPoints(pts),
  });
}

/* ── The subject building: stepped Art Deco massing ───────────── */

// Tiers as (fraction of the lot's long side, of its short side, from, to)
// in metres above the street, after the Empire State Building's setbacks.
const SUBJECT_TIERS = [
  [1.0, 1.0, 0, 25],
  [0.8, 0.86, 25, 80],
  [0.66, 0.78, 80, 122],
  [0.5, 0.7, 122, 286],
  [0.36, 0.52, 286, 320],
];
const SUBJECT_MAST = [
  [10, 320, 352],
  [7, 352, 373],
  [4.5, 373, 381],
];

function subjectMassing(row, olon, olat, kx, ky, base) {
  const xs = [];
  const ys = [];
  for (let i = 2; i + 1 < row.length; i += 2) {
    xs.push(row[i]);
    ys.push(row[i + 1]);
  }
  const n = xs.length;
  const cx = xs.reduce((a, b) => a + b, 0) / n;
  const cy = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - cx) ** 2;
    syy += (ys[i] - cy) ** 2;
    sxy += (xs[i] - cx) * (ys[i] - cy);
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(th);
  const uy = Math.sin(th);
  let umax = 0;
  let vmax = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx;
    const dy = ys[i] - cy;
    umax = Math.max(umax, Math.abs(dx * ux + dy * uy));
    vmax = Math.max(vmax, Math.abs(-dx * uy + dy * ux));
  }
  const toDeg = (x, y) => [olon + x / kx, olat + y / ky];
  const rect = (fu, fv) => {
    const out = [];
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const u = a * umax * fu;
      const v = b * vmax * fv;
      out.push(...toDeg(cx + u * ux - v * uy, cy + u * uy + v * ux));
    }
    return out;
  };
  const octagon = (r) => {
    const out = [];
    for (let k = 0; k < 8; k++) {
      const a = th + (k * Math.PI) / 4 + Math.PI / 8;
      out.push(...toDeg(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    return out;
  };
  const tiers = [
    ...SUBJECT_TIERS.map(([fu, fv, a, b]) => [rect(fu, fv), a, b]),
    ...SUBJECT_MAST.map(([r, a, b]) => [octagon(r), a, b]),
  ];
  return tiers.map(([ring, from, to], i) => {
    // The podium stays a deep amber; the tower brightens toward the mast.
    const k = i === 0 ? -0.35 : i / (tiers.length - 1);
    return new Cesium.GeometryInstance({
      id: { layer: 'moment', key: 'subject' },
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(ring),
        ),
        height: base + (from ? 3 + from : 0),
        extrudedHeight: base + 3 + to,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          new Cesium.Color(
            0.86 + 0.14 * k,
            0.72 + 0.22 * k,
            0.46 + 0.36 * k,
            1,
          ),
        ),
      },
    });
  });
}

/* ── Stage ────────────────────────────────────────────────────── */

const TRACK_COLORS = ['#5EC8FF', '#FFD166', '#FF9F6B', '#9BE15D', '#C9A7FF'];

export function createStage({ scene, requestRender, emit }) {
  const root = scene.primitives.add(new Cesium.PrimitiveCollection());
  root.show = false;
  let massing = null; // Primitive (buildings)
  let massingKey = '';
  let lines = root.add(new Cesium.PolylineCollection());
  let glyphs = root.add(new Cesium.BillboardCollection());
  let coneRoot = root.add(new Cesium.PrimitiveCollection());
  let water = null; // Primitive (river surfaces)
  let waterKey = '';
  let gen = 0;
  let destroyed = false;

  let moment = null;
  let groundH = 0;
  let altOffset = 0;
  let tracks = [];
  let captures = [];
  let subject = null;
  let lastPathRebuild = 0;
  let cinematic = true;
  let cameraTarget = null;
  let framing = 6;
  let lastT = 0;

  const toCart = (lon, lat, altM, out) =>
    Cesium.Cartesian3.fromDegrees(lon, lat, altM + altOffset, undefined, out);

  /**
   * Destroy primitives only after the frame that may still be drawing them:
   * Cesium iterates collections during render, so removing (or destroying a
   * material) mid-frame can crash sortPolylinesIntoBuckets.
   */
  const graveyard = [];
  let reaper = null;
  function bury(...prims) {
    for (const p of prims) {
      if (!p) continue;
      p.show = false;
      graveyard.push(p);
    }
    if (reaper) return;
    const reap = () => {
      if (reaper?.off) reaper.off();
      clearTimeout(reaper?.timer);
      reaper = null;
      for (const p of graveyard.splice(0))
        if (!destroyed && root.contains(p)) root.remove(p);
    };
    reaper = {
      off: scene.postRender.addEventListener(() => setTimeout(reap, 0)),
      timer: setTimeout(reap, 1000),
    };
    requestRender();
  }

  function clear() {
    // Swap in fresh collections; the old ones are hidden now, freed later.
    bury(lines, glyphs, coneRoot);
    lines = root.add(new Cesium.PolylineCollection());
    glyphs = root.add(new Cesium.BillboardCollection());
    coneRoot = root.add(new Cesium.PrimitiveCollection());
    tracks = [];
    captures = [];
    subject = null;
  }

  /** Real river surfaces ({ origin, polys:[[outer, …holes]] }) over the imagery seam. */
  function buildWater(data) {
    bury(water);
    water = null;
    if (!data?.polys?.length) return;
    const [olon, olat] = data.origin;
    const kx = 111_320 * Math.cos(olat * D2R);
    const ky = 110_574;
    const ring = (flat) => {
      const out = [];
      for (let i = 0; i + 1 < flat.length; i += 2)
        out.push(olon + flat[i] / kx, olat + flat[i + 1] / ky);
      return Cesium.Cartesian3.fromDegreesArray(out);
    };
    const instances = [];
    for (const [outer, ...holes] of data.polys) {
      try {
        instances.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(
                ring(outer),
                holes.map((h) => new Cesium.PolygonHierarchy(ring(h))),
              ),
              // Mean water sits ~15 m below Midtown's streets.
              height: groundH - 14,
              vertexFormat:
                Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                css('#0B1824', 1),
              ),
            },
          }),
        );
      } catch {
        /* degenerate ring */
      }
    }
    water = root.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: false,
        }),
        asynchronous: true,
      }),
    );
  }

  async function sampleGround(lon, lat) {
    try {
      const provider = scene.globe.terrainProvider;
      if (!provider || provider instanceof Cesium.EllipsoidTerrainProvider)
        return 0;
      const [c] = await Promise.race([
        Cesium.sampleTerrainMostDetailed(provider, [
          Cesium.Cartographic.fromDegrees(lon, lat),
        ]),
        new Promise((r) => setTimeout(() => r([null]), 2500)),
      ]);
      return Number.isFinite(c?.height) ? c.height : 0;
    } catch {
      return 0;
    }
  }

  /** Real building massing ({ origin, b:[[roofM, groundM, x0,y0,…]] }). */
  function buildMassing(data, highlightBin) {
    if (massing) {
      bury(massing);
      massing = null;
    }
    if (!data?.b?.length) return;
    const [olon, olat] = data.origin;
    const kx = 111_320 * Math.cos(olat * D2R);
    const ky = 110_574;
    const subjectGround = 15;
    const instances = [];
    const sub = moment?.subject;
    for (const row of data.b) {
      const [roof, gnd] = row;
      const ring = [];
      for (let i = 2; i + 1 < row.length; i += 2)
        ring.push(olon + row[i] / kx, olat + row[i + 1] / ky);
      if (ring.length < 6) continue;
      // Is this the subject building? (closest footprint to the subject)
      const cx = row[2] / kx + olon;
      const cy = row[3] / ky + olat;
      const isSubject =
        sub &&
        roof > 300 &&
        Math.abs(cx - sub.lon) < 0.0012 &&
        Math.abs(cy - sub.lat) < 0.0012;
      const base = groundH + (gnd - subjectGround) - 3;
      if (isSubject) {
        instances.push(...subjectMassing(row, olon, olat, kx, ky, base));
        continue;
      }
      // Height-graded massing: low blocks dark, towers catch the light.
      const k = Math.min(1, roof / 300);
      // A little per-building variation so the massing reads as a city.
      const j =
        ((((row[2] * 73856093) ^ (row[3] * 19349663)) >>> 0) % 1000) / 1000;
      // Focus: the blocks around the subject catch a little more light,
      // the city falls off into the dark with distance.
      const dist = Math.hypot(
        row[2] - (sub ? (sub.lon - olon) * kx : 0),
        row[3] - (sub ? (sub.lat - olat) * ky : 0),
      );
      const v = (0.9 + 0.2 * j) * (1.18 - 0.5 * Math.min(1, dist / 2200));
      const color = isSubject
        ? css('#FFE3A3', 1)
        : new Cesium.Color(
            (0.1 + 0.2 * k) * v,
            (0.13 + 0.24 * k) * v,
            (0.19 + 0.3 * k) * v,
            1,
          );
      try {
        instances.push(
          new Cesium.GeometryInstance({
            id: isSubject ? { layer: 'moment', key: 'subject' } : undefined,
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(
                Cesium.Cartesian3.fromDegreesArray(ring),
              ),
              height: base,
              extrudedHeight: base + 3 + roof,
              vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
            },
          }),
        );
      } catch {
        /* a degenerate footprint */
      }
    }
    void highlightBin;
    massing = root.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: false,
          translucent: false,
          closed: true,
        }),
        asynchronous: true,
        shadows: Cesium.ShadowMode.DISABLED,
      }),
    );
    massing.readyPromise?.then?.(requestRender);
  }

  function addSubject(s) {
    if (!s) return;
    const roof = s.roofM ?? s.altM ?? 0;
    const top = s.antennaM ?? roof;
    const base = toCart(s.lon, s.lat, groundH - altOffset);
    // Antenna / marker mast: a glowing hairline from roof to tip.
    if (top > roof + 5)
      lines.add({
        positions: [
          Cesium.Cartesian3.fromDegrees(s.lon, s.lat, groundH + roof),
          Cesium.Cartesian3.fromDegrees(s.lon, s.lat, groundH + top),
        ],
        width: 3,
        material: Cesium.Material.fromType('Color', {
          color: css('#FFE3A3', 0.95),
        }),
      });
    // A tall light column so the subject reads from 4 km out.
    const column = lines.add({
      positions: [
        Cesium.Cartesian3.fromDegrees(s.lon, s.lat, groundH + top),
        Cesium.Cartesian3.fromDegrees(s.lon, s.lat, groundH + top + 900),
      ],
      width: 8,
      material: Cesium.Material.fromType('PolylineGlow', {
        color: css('#FFD166', 0.5),
        glowPower: 0.12,
        taperPower: 0.25,
      }),
    });
    void base;
    const ring = glyph('ring');
    const halo = glyph('dot');
    const beacon = glyphs.add({
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, groundH + top),
      image: halo.image,
      imageId: halo.imageId,
      color: css('#FF4D4D'),
      scale: 0.9,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    const pulse = glyphs.add({
      position: Cesium.Cartesian3.fromDegrees(
        s.lon,
        s.lat,
        groundH + (s.altM ?? roof),
      ),
      image: ring.image,
      imageId: ring.imageId,
      color: css('#FFD166', 0.9),
      scale: 1.2,
      id: { layer: 'moment', key: 'subject' },
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    subject = { ...s, beacon, pulse, column, base };
  }

  function addTracks(list) {
    list.forEach((tr, i) => {
      if (!tr.points?.length) return;
      const color = tr.color || TRACK_COLORS[i % TRACK_COLORS.length];
      const g = glyph(tr.kind === 'helicopter' ? 'heli' : 'plane');
      const bb = glyphs.add({
        position: Cesium.Cartesian3.ZERO,
        image: g.image,
        imageId: g.imageId,
        color: css(color),
        scale: tr.kind === 'helicopter' ? 0.62 : 0.55,
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        show: false,
        id: { layer: 'moment', key: `track:${tr.id}` },
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      const halo = glyph('dot');
      const glow = glyphs.add({
        position: Cesium.Cartesian3.ZERO,
        image: halo.image,
        imageId: halo.imageId,
        color: css(color, 0.55),
        scale: 1.1,
        show: false,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      const cart = tr.points.map((p) =>
        toCart(p.lon, p.lat, p.altM ?? 0, new Cesium.Cartesian3()),
      );
      const path = lines.add({
        positions: [],
        width: 1.6,
        material: Cesium.Material.fromType('Color', {
          color: css(color, 0.32),
        }),
      });
      const trail = lines.add({
        positions: [],
        width: 5,
        material: Cesium.Material.fromType('PolylineGlow', {
          color: css(color, 0.95),
          glowPower: 0.22,
          taperPower: 0.55,
        }),
      });
      const drop = lines.add({
        positions: [],
        width: 1,
        material: Cesium.Material.fromType('Color', {
          color: css(color, 0.35),
        }),
      });
      tracks.push({
        tr,
        color,
        bb,
        glow,
        cart,
        path,
        trail,
        drop,
        state: null,
      });
    });
  }

  function addCaptures(list) {
    const target = moment?.subject;
    for (const c of list || []) {
      const lengthM = Math.max(
        120,
        (c.rangeM ??
          (target
            ? Cesium.Cartesian3.distance(
                Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
                Cesium.Cartesian3.fromDegrees(target.lon, target.lat),
              )
            : 300)) * 0.9,
      );
      const { origin, corners } = frustumCorners(c, groundH, lengthM);
      const color = c.firstEyes ? '#FFD166' : '#FFC857';
      const fill = coneRoot.add(
        new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({
            id: { layer: 'moment', key: `capture:${c.id}` },
            geometry: frustumGeometry(origin, corners),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                css(color, c.firstEyes ? 0.14 : 0.07),
              ),
            },
          }),
          appearance: new Cesium.PerInstanceColorAppearance({
            flat: true,
            translucent: true,
            closed: false,
            renderState: { cull: { enabled: false } },
          }),
          asynchronous: false,
        }),
      );
      fill.show = false;
      // One material per polyline: a collection destroys each on removal.
      const edgeMat = () =>
        Cesium.Material.fromType('Color', {
          color: css(color, c.firstEyes ? 0.95 : 0.6),
        });
      const edges = [];
      for (let k = 0; k < 4; k++)
        edges.push(
          lines.add({
            positions: [origin, corners[k]],
            width: c.firstEyes ? 1.8 : 1.1,
            material: edgeMat(),
            show: false,
          }),
        );
      edges.push(
        lines.add({
          positions: [...corners, corners[0]],
          width: c.firstEyes ? 2 : 1.2,
          material: edgeMat(),
          show: false,
        }),
      );
      const g = glyph('witness');
      const pin = glyphs.add({
        position: origin,
        image: g.image,
        imageId: g.imageId,
        color: css(color),
        scale: c.firstEyes ? 0.7 : 0.56,
        show: false,
        id: { layer: 'moment', key: `capture:${c.id}` },
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      const fl = glyph('dot');
      const flash = glyphs.add({
        position: origin,
        image: fl.image,
        imageId: fl.imageId,
        color: css('#FFFFFF', 0),
        scale: 0.1,
        show: false,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      captures.push({
        c,
        fill,
        edges,
        pin,
        flash,
        origin,
        shownAt: 0,
      });
    }
  }

  function setCamera(t) {
    if (!cinematic || !moment) return;
    const follow =
      moment.follow && tracks.find((x) => x.tr.id === moment.follow.trackId);
    if (follow?.state) {
      // Chase view: behind and above the aircraft, looking along its track.
      const s = follow.state;
      const range = moment.follow.rangeM ?? 18_000;
      const up = moment.follow.heightM ?? 6_000;
      const back = (s.heading + 180 + (moment.follow.offsetDeg ?? 25)) % 360;
      const kx = 111_320 * Math.cos(s.lat * D2R);
      const lon = s.lon + (Math.sin(back * D2R) * range) / kx;
      const lat = s.lat + (Math.cos(back * D2R) * range) / 110_574;
      scene.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, s.altM + up),
        orientation: {
          heading: ((back + 180) % 360) * D2R,
          pitch: Math.atan2(-up, range),
          roll: 0,
        },
      });
      return;
    }
    if (!moment.cameraPath?.length) return;
    const k = cameraAt(moment.cameraPath, t);
    if (!k) return;
    // Keys are framed for a landscape-ish view; a portrait phone has a
    // narrower horizontal field, so pull back along the line of sight.
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const fit = Math.max(1, Math.min(1.6, 0.75 / Math.max(0.2, aspect)));
    const sub = moment.subject || { lon: moment.lon, lat: moment.lat };
    const kxm = 111_320 * Math.cos(sub.lat * D2R);
    const dx = (k.lon - sub.lon) * kxm;
    const dy = (k.lat - sub.lat) * 110_574;
    const horiz = Math.hypot(dx, dy);
    const lookAlt = k.height + Math.tan(k.pitch * D2R) * horiz;
    const lon = sub.lon + (dx * fit) / kxm;
    const lat = sub.lat + (dy * fit) / 110_574;
    const height = lookAlt + (k.height - lookAlt) * fit;
    if (subject?.column) {
      const far = Math.hypot(horiz * fit, height);
      subject.column.material.uniforms.color.alpha = Math.max(
        0,
        Math.min(0.5, (far - 2500) / 4000),
      );
    }
    scene.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, groundH + height),
      orientation: {
        heading: k.heading * D2R,
        // Look a little below the subject so it sits in the upper half,
        // clear of the shell's bottom sheet.
        pitch: (k.pitch - framing) * D2R,
        roll: 0,
      },
    });
  }

  /** Move everything to time `t` (epoch ms). Returns true when drawn. */
  function update(t, { realNow = performance.now() } = {}) {
    if (!moment || destroyed || lines.isDestroyed?.()) return false;
    const rebuildPath = realNow - lastPathRebuild > 250;
    if (rebuildPath) lastPathRebuild = realNow;
    for (const k of tracks) {
      const s = trackStateAt(k.tr.points, t);
      k.state = s;
      if (!s) {
        k.bb.show = k.glow.show = false;
        k.trail.positions = [];
        k.drop.positions = [];
        if (rebuildPath) {
          const i = indexAt(k.tr.points, t);
          k.path.positions = i > 0 ? k.cart.slice(0, i + 1) : [];
        }
        continue;
      }
      const pos = toCart(s.lon, s.lat, s.altM, new Cesium.Cartesian3());
      k.bb.position = pos;
      k.glow.position = pos;
      k.bb.rotation = -s.heading * D2R;
      k.bb.show = k.glow.show = true;
      const i = indexAt(k.tr.points, t);
      // Bright trail: the last 90 s, ending exactly at the glyph.
      let j = indexAt(k.tr.points, t - TRAIL_MS);
      if (j < 0) j = 0;
      const step = Math.max(1, Math.floor((i - j) / 90));
      const trail = [];
      for (let q = j; q <= i; q += step) trail.push(k.cart[q]);
      trail.push(pos);
      k.trail.positions = trail.length > 1 ? trail : [];
      if (rebuildPath) {
        const stride = Math.max(1, Math.floor(i / 600));
        const path = [];
        for (let q = 0; q <= i; q += stride) path.push(k.cart[q]);
        path.push(pos);
        k.path.positions = path.length > 1 ? path : [];
      }
      k.drop.positions = [
        pos,
        Cesium.Cartesian3.fromDegrees(
          s.lon,
          s.lat,
          groundH,
          undefined,
          SCRATCH,
        ).clone(),
      ];
    }
    for (const k of captures) {
      const on = t >= k.c.t;
      if (on && !k.shownAt) k.shownAt = realNow;
      if (!on) k.shownAt = 0;
      k.fill.show = on;
      for (const e of k.edges) e.show = on;
      k.pin.show = on;
      const age = on ? (realNow - k.shownAt) / 1000 : 9;
      k.flash.show = on && age < 0.9;
      if (k.flash.show) {
        const f = age / 0.9;
        k.flash.scale = 0.4 + 3.2 * f;
        k.flash.color = css('#FFFFFF', 0.9 * (1 - f));
      }
    }
    if (subject) {
      const ph = (realNow / 1000) % 1.6;
      subject.pulse.scale = 1.0 + 0.6 * (ph / 1.6);
      subject.pulse.color = css('#FFD166', 0.95 * (1 - ph / 1.6));
      subject.beacon.color = css(
        '#FF4D4D',
        (realNow / 1000) % 1.2 < 0.25 ? 1 : 0.25,
      );
    }
    setCamera(t);
    lastT = t;
    requestRender();
    return true;
  }

  // The person takes the camera: stop flying the path until asked again.
  const canvas = scene.canvas;
  const release = () => {
    if (!moment || !cinematic) return;
    cinematic = false;
    emit?.('moment', {
      type: 'camera',
      item: { cinematic: false },
      t: lastT,
      momentId: moment.id,
    });
  };
  canvas.addEventListener('pointerdown', release, { passive: true });
  canvas.addEventListener('wheel', release, { passive: true });

  return {
    async load(m, { buildings = null, waterData = null } = {}) {
      const my = ++gen;
      clear();
      moment = m;
      cinematic = true;
      const s = m.subject || { lon: m.lon, lat: m.lat, altM: 0 };
      const ground = await sampleGround(s.lon, s.lat);
      // Unloaded (or another Moment loaded) while we waited: do nothing.
      if (my !== gen || destroyed) return;
      groundH = ground;
      const wkey = m.stage?.water || '';
      if (waterData && wkey !== waterKey) {
        waterKey = wkey;
        buildWater(waterData);
      } else if (!waterData && water) {
        bury(water);
        water = null;
        waterKey = '';
      }
      if (water) water.show = true;
      // Tracks are MSL; draw them relative to the sampled ground.
      altOffset = Number.isFinite(m.groundMslM) ? groundH - m.groundMslM : 0;
      const key = m.stage?.buildings || '';
      if (buildings && key !== massingKey) {
        massingKey = key;
        buildMassing(buildings, m.stage?.highlight);
      } else if (!buildings && massing) {
        bury(massing);
        massing = null;
        massingKey = '';
      }
      if (massing) massing.show = true;
      addSubject(m.subject);
      addTracks(m.tracks || []);
      addCaptures(m.captures || []);
      cameraTarget = s;
      root.show = true;
      update(m.time.start);
    },
    unload() {
      gen++;
      clear();
      moment = null;
      root.show = false;
      if (massing) massing.show = false;
      if (water) water.show = false;
      requestRender();
    },
    update,
    get active() {
      return Boolean(moment);
    },
    get cinematic() {
      return cinematic;
    },
    /** Degrees the cinematic camera looks below its subject (0 = centred). */
    setFraming(deg) {
      if (Number.isFinite(deg)) framing = deg;
      setCamera(lastT);
    },
    setCinematic(on) {
      cinematic = Boolean(on);
      if (cinematic) setCamera(lastT);
    },
    groundHeight: () => groundH,
    target: () => cameraTarget,
    /** Label candidates: [{ id, title, detail?, lon, lat, altM, kind, score }]. */
    labels() {
      if (!moment) return [];
      const out = [];
      for (const k of tracks) {
        if (!k.state) continue;
        out.push({
          id: `moment:${moment.id}:${k.tr.id}`,
          kind: 'track',
          title: k.tr.label,
          detail: `${Math.round((k.state.altM * 3.28084) / 25) * 25} FT · ${Math.round(k.state.speed / 0.514444)} KT`,
          // Crowded fallback: callsign and altitude only.
          short: k.tr.label.replace(/\s*\(illustrative\)\s*/i, ''),
          shortDetail: `${Math.round((k.state.altM * 3.28084) / 50) * 50} FT`,
          lon: k.state.lon,
          lat: k.state.lat,
          altM: k.state.altM + altOffset,
          score: -80,
        });
      }
      for (const k of captures)
        if (lastT >= k.c.t)
          out.push({
            id: `capture:${moment.id}:${k.c.id}`,
            kind: 'capture',
            title: `@${k.c.handle}`,
            detail: k.c.firstEyes ? 'FIRST EYES · SEALED' : 'SEALED',
            short: `@${k.c.handle}`,
            shortDetail: k.c.firstEyes ? 'FIRST EYES' : '',
            lon: k.c.lon,
            lat: k.c.lat,
            altM: groundH + (k.c.altM || 1.5),
            score: k.c.firstEyes ? -70 : -40,
          });
      if (subject)
        out.push({
          id: `moment:${moment.id}:subject`,
          kind: 'subject',
          title: subject.label || moment.place,
          short: (subject.label || moment.place).split(/[ ,]/)[0],
          lon: subject.lon,
          lat: subject.lat,
          altM: groundH + (subject.antennaM ?? subject.altM ?? 0),
          score: -90,
        });
      return out;
    },
    /** Pick payload for a stage id key. */
    pick(key) {
      if (!moment) return null;
      if (key === 'subject')
        return {
          kind: 'subject',
          id: `moment:${moment.id}:subject`,
          title: moment.subject?.label || moment.place,
          subtitle: moment.title,
          lon: moment.subject?.lon ?? moment.lon,
          lat: moment.subject?.lat ?? moment.lat,
          meta: { layer: 'moment', momentId: moment.id },
        };
      const [type, id] = key.split(':');
      if (type === 'track') {
        const k = tracks.find((x) => x.tr.id === id);
        if (!k) return null;
        const s = k.state || k.tr.points.at(-1);
        return {
          kind: 'track',
          id: `moment:${moment.id}:${id}`,
          title: k.tr.label,
          subtitle: [k.tr.type, k.tr.operator].filter(Boolean).join(' · '),
          lon: s.lon,
          lat: s.lat,
          meta: {
            layer: 'moment',
            momentId: moment.id,
            trackId: id,
            illustrative: Boolean(moment.illustrative),
            altitudeM: s.altM,
          },
        };
      }
      if (type === 'capture') {
        const k = captures.find((x) => x.c.id === id);
        if (!k) return null;
        return {
          kind: 'capture',
          id: `capture:${moment.id}:${id}`,
          title: k.c.title,
          subtitle: `@${k.c.handle} · ${k.c.place || ''}${k.c.sealed ? ' · Sealed' : ''}`,
          lon: k.c.lon,
          lat: k.c.lat,
          meta: {
            layer: 'moment',
            momentId: moment.id,
            captureId: id,
            headingDeg: k.c.headingDeg,
            fovDeg: k.c.fovDeg,
            firstEyes: Boolean(k.c.firstEyes),
            illustrative: Boolean(moment.illustrative),
          },
        };
      }
      return null;
    },
    destroy() {
      destroyed = true;
      gen++;
      if (reaper) {
        reaper.off?.();
        clearTimeout(reaper.timer);
        reaper = null;
      }
      canvas.removeEventListener('pointerdown', release);
      canvas.removeEventListener('wheel', release);
      scene.primitives.remove(root);
    },
  };
}
