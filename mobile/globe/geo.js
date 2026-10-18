/**
 * Small, dependency-free geo helpers shared by the mobile globe modules.
 */

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const EARTH_RADIUS_KM = 6371.0088;
export const KT_TO_MPS = 1852 / 3600;
export const FT_TO_M = 0.3048;

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Move a point `distM` metres along `headingDeg` (flat-earth, fine for < 50 km). */
export function offsetLonLat(lon, lat, headingDeg, distM) {
  const h = headingDeg * D2R;
  const dLat = (distM * Math.cos(h)) / 111_320;
  const dLon =
    (distM * Math.sin(h)) / (111_320 * Math.max(0.05, Math.cos(lat * D2R)));
  return [wrapLon(lon + dLon), Math.max(-89.9, Math.min(89.9, lat + dLat))];
}

export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export const finite = (value) =>
  value !== null && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : null;

/** A bounding box of `radiusKm` around a point, as [west, south, east, north]. */
export function bboxAround(lon, lat, radiusKm, aspect = 0.75) {
  const dLat = radiusKm / 111.32;
  const dLon =
    (radiusKm * aspect) / (111.32 * Math.max(0.05, Math.cos(lat * D2R)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/**
 * Keyless Esri World Imagery still for a bbox (portrait 600x800 by default).
 * The export endpoint widens the bbox to the image aspect in Web Mercator, so
 * callers pass a roughly matching bbox to keep the subject centred.
 */
export function esriThumbnail(
  [west, south, east, north],
  { width = 600, height = 800 } = {},
) {
  const bbox = [west, south, east, north].map((v) => v.toFixed(5)).join(',');
  return (
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
    `?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${width},${height}&format=jpg&f=image`
  );
}

/** Thumbnail framing a radius around a point. */
export function thumbnailAround(lon, lat, radiusKm) {
  return esriThumbnail(bboxAround(lon, lat, radiusKm));
}

/** Sub-solar point for a UTC instant (low-precision, ~0.1 deg). */
export function subsolarPoint(ms) {
  const d = (ms - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const e = (23.439 - 0.00000036 * d) * D2R;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) * R2D;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * R2D;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const lon = wrapLon(ra - gmst * 15);
  return { lon, lat: dec };
}

/** Compact relative time, e.g. "3 h ago" / "in 2 d". */
export function relTime(ms, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const unit =
    abs < 3_600_000
      ? [Math.max(1, Math.round(abs / 60_000)), 'min']
      : abs < 172_800_000
        ? [Math.round(abs / 3_600_000), 'h']
        : [Math.round(abs / 86_400_000), 'd'];
  return diff < 0 ? `${unit[0]} ${unit[1]} ago` : `in ${unit[0]} ${unit[1]}`;
}

/** Bin points to a grid of `cellDeg` and return the densest cell. */
export function densestCell(points, cellDeg = 2) {
  const bins = new Map();
  for (const p of points) {
    const key = `${Math.floor(p.lat / cellDeg)}:${Math.floor(p.lon / cellDeg)}`;
    let bin = bins.get(key);
    if (!bin) bins.set(key, (bin = { n: 0, lat: 0, lon: 0, items: [] }));
    bin.n++;
    bin.lat += p.lat;
    bin.lon += p.lon;
    bin.items.push(p);
  }
  let best = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  if (!best) return null;
  return {
    count: best.n,
    lat: best.lat / best.n,
    lon: best.lon / best.n,
    items: best.items,
  };
}
