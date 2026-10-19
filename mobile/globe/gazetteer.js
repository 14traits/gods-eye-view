/**
 * A small bundled gazetteer for naming where something is ("38 km SW of
 * Miami"). Coordinates are public city centres, rounded.
 */
import { haversineKm } from './geo.js';

/** US metros (radar coverage) — [name, lon, lat]. */
export const US_METROS = Object.freeze([
  ['New York', -74.01, 40.71],
  ['Los Angeles', -118.24, 34.05],
  ['Chicago', -87.63, 41.88],
  ['Houston', -95.37, 29.76],
  ['Phoenix', -112.07, 33.45],
  ['Philadelphia', -75.17, 39.95],
  ['San Antonio', -98.49, 29.42],
  ['San Diego', -117.16, 32.72],
  ['Dallas', -96.8, 32.78],
  ['Austin', -97.74, 30.27],
  ['Jacksonville', -81.66, 30.33],
  ['Columbus', -83.0, 39.96],
  ['Charlotte', -80.84, 35.23],
  ['Indianapolis', -86.16, 39.77],
  ['San Francisco', -122.42, 37.77],
  ['Seattle', -122.33, 47.61],
  ['Denver', -104.99, 39.74],
  ['Washington', -77.04, 38.9],
  ['Nashville', -86.78, 36.16],
  ['Oklahoma City', -97.52, 35.47],
  ['El Paso', -106.49, 31.76],
  ['Boston', -71.06, 42.36],
  ['Portland', -122.68, 45.52],
  ['Las Vegas', -115.14, 36.17],
  ['Detroit', -83.05, 42.33],
  ['Memphis', -90.05, 35.15],
  ['Louisville', -85.76, 38.25],
  ['Baltimore', -76.61, 39.29],
  ['Milwaukee', -87.91, 43.04],
  ['Albuquerque', -106.65, 35.08],
  ['Tucson', -110.97, 32.22],
  ['Atlanta', -84.39, 33.75],
  ['Kansas City', -94.58, 39.1],
  ['Miami', -80.19, 25.76],
  ['Tampa', -82.46, 27.95],
  ['Orlando', -81.38, 28.54],
  ['New Orleans', -90.07, 29.95],
  ['Minneapolis', -93.27, 44.98],
  ['Cleveland', -81.69, 41.5],
  ['St. Louis', -90.2, 38.63],
  ['Pittsburgh', -79.99, 40.44],
  ['Cincinnati', -84.51, 39.1],
  ['Raleigh', -78.64, 35.78],
  ['Salt Lake City', -111.89, 40.76],
  ['Birmingham', -86.8, 33.52],
  ['Omaha', -95.94, 41.26],
  ['Buffalo', -78.88, 42.89],
  ['Richmond', -77.44, 37.54],
  ['Corpus Christi', -97.4, 27.8],
  ['Mobile', -88.04, 30.69],
  ['Little Rock', -92.29, 34.75],
  ['Des Moines', -93.61, 41.59],
  ['Wichita', -97.34, 37.69],
  ['Boise', -116.2, 43.62],
  ['Spokane', -117.43, 47.66],
  ['Billings', -108.5, 45.78],
  ['Fargo', -96.79, 46.88],
  ['Charleston', -79.93, 32.78],
  ['Savannah', -81.1, 32.08],
  ['Tallahassee', -84.28, 30.44],
  ['Shreveport', -93.75, 32.53],
  ['Amarillo', -101.83, 35.22],
  ['Lubbock', -101.86, 33.58],
  ['Brownsville', -97.5, 25.9],
  ['Key West', -81.78, 24.56],
]);

/** World places and seas for "near X" phrasing — [name, lon, lat]. */
export const WORLD_PLACES = Object.freeze([
  ...US_METROS,
  ['Toronto', -79.38, 43.65],
  ['Montréal', -73.57, 45.5],
  ['Vancouver', -123.12, 49.28],
  ['Calgary', -114.07, 51.05],
  ['Mexico City', -99.13, 19.43],
  ['Guadalajara', -103.35, 20.67],
  ['Monterrey', -100.31, 25.69],
  ['Mérida', -89.62, 20.97],
  ['Cancún', -86.85, 21.16],
  ['Puerto Vallarta', -105.23, 20.65],
  ['Mazatlán', -106.41, 23.25],
  ['Cabo San Lucas', -109.92, 22.89],
  ['Acapulco', -99.88, 16.85],
  ['Guatemala City', -90.51, 14.63],
  ['San José', -84.09, 9.93],
  ['Panama City', -79.52, 8.98],
  ['Havana', -82.37, 23.11],
  ['Santo Domingo', -69.93, 18.49],
  ['San Juan', -66.1, 18.47],
  ['Kingston', -76.79, 18.02],
  ['Caracas', -66.9, 10.48],
  ['Bogotá', -74.07, 4.71],
  ['Medellín', -75.56, 6.24],
  ['Quito', -78.47, -0.18],
  ['Lima', -77.04, -12.05],
  ['Manaus', -60.02, -3.12],
  ['Belém', -48.5, -1.46],
  ['Brasília', -47.88, -15.79],
  ['São Paulo', -46.63, -23.55],
  ['Rio de Janeiro', -43.17, -22.91],
  ['Buenos Aires', -58.38, -34.6],
  ['Santiago', -70.67, -33.45],
  ['La Paz', -68.15, -16.5],
  ['Asunción', -57.58, -25.26],
  ['Reykjavík', -21.9, 64.15],
  ['London', -0.13, 51.51],
  ['Paris', 2.35, 48.86],
  ['Madrid', -3.7, 40.42],
  ['Lisbon', -9.14, 38.72],
  ['Rome', 12.5, 41.9],
  ['Berlin', 13.4, 52.52],
  ['Warsaw', 21.01, 52.23],
  ['Stockholm', 18.07, 59.33],
  ['Helsinki', 24.94, 60.17],
  ['Tallinn', 24.75, 59.44],
  ['Riga', 24.11, 56.95],
  ['Vilnius', 25.28, 54.69],
  ['Kaliningrad', 20.51, 54.71],
  ['Gdańsk', 18.65, 54.35],
  ['St Petersburg', 30.32, 59.94],
  ['Moscow', 37.62, 55.76],
  ['Kyiv', 30.52, 50.45],
  ['Odesa', 30.73, 46.48],
  ['Sevastopol', 33.52, 44.62],
  ['Istanbul', 28.98, 41.01],
  ['Athens', 23.73, 37.98],
  ['Nicosia', 33.38, 35.19],
  ['Beirut', 35.5, 33.89],
  ['Tel Aviv', 34.78, 32.09],
  ['Damascus', 36.29, 33.51],
  ['Cairo', 31.24, 30.04],
  ['Baghdad', 44.36, 33.31],
  ['Tehran', 51.39, 35.69],
  ['Kuwait City', 47.98, 29.38],
  ['Riyadh', 46.68, 24.71],
  ['Doha', 51.53, 25.29],
  ['Dubai', 55.27, 25.2],
  ['Muscat', 58.4, 23.59],
  ['Bandar Abbas', 56.27, 27.18],
  ['Karachi', 67.01, 24.86],
  ['Lahore', 74.35, 31.55],
  ['Delhi', 77.21, 28.61],
  ['Mumbai', 72.88, 19.08],
  ['Chennai', 80.27, 13.08],
  ['Kolkata', 88.36, 22.57],
  ['Dhaka', 90.41, 23.81],
  ['Kathmandu', 85.32, 27.72],
  ['Colombo', 79.86, 6.93],
  ['Yangon', 96.2, 16.87],
  ['Bangkok', 100.5, 13.76],
  ['Hanoi', 105.85, 21.03],
  ['Ho Chi Minh City', 106.63, 10.82],
  ['Kuala Lumpur', 101.69, 3.14],
  ['Singapore', 103.82, 1.35],
  ['Jakarta', 106.85, -6.21],
  ['Surabaya', 112.75, -7.25],
  ['Manila', 120.98, 14.6],
  ['Cebu', 123.89, 10.32],
  ['Davao', 125.61, 7.07],
  ['Hong Kong', 114.17, 22.32],
  ['Taipei', 121.56, 25.03],
  ['Guangzhou', 113.26, 23.13],
  ['Shanghai', 121.47, 31.23],
  ['Beijing', 116.4, 39.9],
  ['Seoul', 126.98, 37.57],
  ['Busan', 129.08, 35.18],
  ['Tokyo', 139.69, 35.69],
  ['Osaka', 135.5, 34.69],
  ['Okinawa', 127.68, 26.21],
  ['Sapporo', 141.35, 43.06],
  ['Guam', 144.79, 13.44],
  ['Port Moresby', 147.18, -9.44],
  ['Darwin', 130.84, -12.46],
  ['Cairns', 145.77, -16.92],
  ['Brisbane', 153.03, -27.47],
  ['Sydney', 151.21, -33.87],
  ['Melbourne', 144.96, -37.81],
  ['Perth', 115.86, -31.95],
  ['Auckland', 174.76, -36.85],
  ['Suva', 178.44, -18.14],
  ['Nouméa', 166.46, -22.28],
  ['Honolulu', -157.86, 21.31],
  ['Anchorage', -149.9, 61.22],
  ['Lagos', 3.38, 6.52],
  ['Accra', -0.19, 5.6],
  ['Dakar', -17.47, 14.72],
  ['Kinshasa', 15.27, -4.44],
  ['Nairobi', 36.82, -1.29],
  ['Addis Ababa', 38.75, 9.03],
  ['Khartoum', 32.53, 15.5],
  ['Johannesburg', 28.05, -26.2],
  ['Cape Town', 18.42, -33.92],
  ['Antananarivo', 47.52, -18.88],
  ['Maputo', 32.57, -25.97],
  ['Luanda', 13.23, -8.84],
  ['Ulaanbaatar', 106.92, 47.89],
  ['Almaty', 76.89, 43.24],
  ['Novosibirsk', 82.93, 55.03],
  ['Vladivostok', 131.89, 43.12],
]);

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Compass bearing (deg) from a to b. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x =
    Math.cos(lat1 * r) * Math.sin(lat2 * r) -
    Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (((Math.atan2(y, x) / r) % 360) + 360) % 360;
}

export function compass(deg) {
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Nearest bundled place: { name, km, dir } (dir is from the place). */
export function nearestPlace(lat, lon, list = WORLD_PLACES) {
  let best = null;
  for (const [name, plon, plat] of list) {
    const km = haversineKm(lat, lon, plat, plon);
    if (!best || km < best.km) best = { name, km, plon, plat };
  }
  if (!best) return null;
  return {
    name: best.name,
    km: Math.round(best.km),
    dir: compass(bearingDeg(best.plat, best.plon, lat, lon)),
  };
}

/** "Miami", "38 km SW of Miami" or "640 km E of Manila". */
export function describePlace(lat, lon, list) {
  const p = nearestPlace(lat, lon, list);
  if (!p) return '';
  if (p.km < 15) return p.name;
  return `${p.km.toLocaleString('en-US')} km ${p.dir} of ${p.name}`;
}
