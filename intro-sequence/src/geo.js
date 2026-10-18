// Geodesy for the film. Convention (matches the globe shader):
//   x = cos(lat) cos(lon), y = sin(lat), z = -cos(lat) sin(lon)   (Y up, radius 1)
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const EARTH_KM = 6371;

export function llToVec(lon, lat, r = 1, out = [0, 0, 0]) {
  const la = lat * D2R;
  const lo = lon * D2R;
  const c = Math.cos(la);
  out[0] = r * c * Math.cos(lo);
  out[1] = r * Math.sin(la);
  out[2] = -r * c * Math.sin(lo);
  return out;
}

export function vecToLL(x, y, z) {
  const r = Math.hypot(x, y, z);
  return [Math.atan2(-z, x) * R2D, Math.asin(y / r) * R2D];
}

// Central angle in radians between two lon/lat points.
export function angDist(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Destination point given start, bearing (deg) and central angle (rad).
export function destination(lon, lat, bearingDeg, ang) {
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const b = bearingDeg * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(ang) + Math.cos(p1) * Math.sin(ang) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(ang) * Math.cos(p1), Math.cos(ang) - Math.sin(p1) * Math.sin(p2));
  return [((l2 * R2D + 540) % 360) - 180, p2 * R2D];
}

export function bearing(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

// Subsolar point (lon, lat) for a JS Date — NOAA low-precision solar position.
export function subsolar(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  let lon = ra * R2D - gmst;
  lon = ((lon + 540) % 360) - 180;
  return [lon, decl * R2D];
}

export function fmtLat(lat, dp = 4) {
  return `${Math.abs(lat).toFixed(dp)}°${lat >= 0 ? 'N' : 'S'}`;
}
export function fmtLon(lon, dp = 4) {
  return `${Math.abs(lon).toFixed(dp)}°${lon >= 0 ? 'E' : 'W'}`;
}
