/**
 * "Your sky now" (DESIGN.md §12.3): what is above a person this minute.
 * Aircraft within ~50 km from the live ADS-B feeds (fetching a regional
 * snapshot around the person when the current one does not cover them),
 * satellites above the horizon from CelesTrak elements (SGP4), and the ISS
 * with its next pass.
 */
import { twoline2satrec } from 'satellite.js';
import { findNextIssPass, lookAnglesAt } from '../../src/data/issPass.js';
import { haversineKm, subsolarPoint } from './geo.js';
import { bearingDeg } from './gazetteer.js';

const R = 6_371_000;
const D2R = Math.PI / 180;
const ISS_NORAD = '25544';

function elevationDeg(distM, altM) {
  // Flat-earth elevation corrected for the curvature drop over distM.
  const drop = (distM * distM) / (2 * R);
  return Math.atan2(altM - drop, distM) / D2R;
}

function sunElevation(lat, lon, ms) {
  const s = subsolarPoint(ms);
  const cosZ =
    Math.sin(lat * D2R) * Math.sin(s.lat * D2R) +
    Math.cos(lat * D2R) * Math.cos(s.lat * D2R) * Math.cos((lon - s.lon) * D2R);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / D2R;
}

const satCache = { stamp: '', sats: [] };
function satrecs(feeds) {
  const groups = ['stations', 'visual'];
  const stamp = groups.map((g) => feeds[g].updatedAt).join(':');
  if (stamp === satCache.stamp) return satCache.sats;
  const seen = new Set();
  const sats = [];
  for (const g of groups)
    for (const e of feeds[g].data?.entries || []) {
      const id = e.line1.slice(2, 7).trim();
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        sats.push({
          id,
          name: e.name.trim(),
          satrec: twoline2satrec(e.line1, e.line2),
        });
      } catch {
        /* malformed */
      }
    }
  satCache.stamp = stamp;
  satCache.sats = sats;
  return sats;
}

export async function skyNow(feeds, { lon, lat }, { km = 50 } = {}) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat))
    throw new TypeError('skyNow needs lon and lat');
  const now = Date.now();
  // Aircraft: whatever the feeds hold near the person, plus a regional
  // snapshot around them when nothing current covers the spot.
  const lists = [];
  const flights = feeds.flights.data;
  if (flights?.records) lists.push(flights.records);
  if (feeds.military.data?.records) lists.push(feeds.military.data.records);
  for (const e of feeds.regionalFlights.entries?.() || [])
    if (e.data?.records) lists.push(e.data.records);
  const covered =
    flights &&
    (!flights.regional ||
      (flights.anchor &&
        haversineKm(lat, lon, flights.anchor.lat, flights.anchor.lon) < 300));
  if (!covered) {
    const key = `sky:${lat.toFixed(1)}:${lon.toFixed(1)}`;
    const reg = await Promise.race([
      feeds.regionalFlights.get(key, { lat, lon }).catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 9000)),
    ]);
    if (reg?.records) lists.push(reg.records);
  }
  const seen = new Set();
  const aircraft = [];
  for (const list of lists)
    for (const r of list) {
      if (seen.has(r.id) || r.onGround) continue;
      if (Math.abs(r.lat - lat) > km / 100 + 0.2) continue;
      const d = haversineKm(lat, lon, r.lat, r.lon);
      if (d > km) continue;
      seen.add(r.id);
      aircraft.push({
        id: `${r.military ? 'military' : 'flights'}:${r.id}`,
        title: r.callsign || r.id.toUpperCase(),
        kind: r.military
          ? 'military'
          : r.helicopter
            ? 'helicopter'
            : 'aircraft',
        lon: r.lon,
        lat: r.lat,
        altM: Math.round(r.altM ?? 0),
        distanceKm: Math.round(d * 10) / 10,
        elevationDeg: Math.round(elevationDeg(d * 1000, r.altM ?? 0) * 10) / 10,
        azimuthDeg: Math.round(bearingDeg(lat, lon, r.lat, r.lon)),
        headingDeg: r.heading ?? null,
        speedMps: r.speed ?? null,
        squawk: r.squawk || null,
      });
    }
  aircraft.sort((a, b) => b.elevationDeg - a.elevationDeg);

  // Satellites above the horizon.
  // Cached elements answer at once; a cold catalog gets 4 s.
  await Promise.race([
    Promise.allSettled([feeds.stations.get(), feeds.visual.get()]),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  const satellites = [];
  let iss = null;
  for (const s of satrecs(feeds)) {
    const look = lookAnglesAt(s.satrec, now, lat, lon);
    if (!look) continue;
    if (s.id === ISS_NORAD) iss = { s, look };
    if (look.elevDeg <= 0) continue;
    const p = look.satECI;
    satellites.push({
      id: `satellites:${s.id}`,
      title: s.name,
      norad: s.id,
      altKm: p ? Math.round(Math.hypot(p.x, p.y, p.z) - 6371) : null,
      elevationDeg: Math.round(look.elevDeg * 10) / 10,
      azimuthDeg: Math.round(look.azDeg),
    });
  }
  satellites.sort((a, b) => b.elevationDeg - a.elevationDeg);

  const sunEl = sunElevation(lat, lon, now);
  let issOut = {
    visibleNow: false,
    elevationDeg: null,
    azimuthDeg: null,
    nextPass: null,
  };
  if (iss) {
    const pass = findNextIssPass({
      satrec: iss.s.satrec,
      latDeg: lat,
      lonDeg: lon,
      fromMs: now,
      minElevDeg: 10,
      horizonHours: 36,
    });
    issOut = {
      visibleNow: iss.look.elevDeg > 10 && sunEl < -6,
      aboveHorizon: iss.look.elevDeg > 0,
      elevationDeg: Math.round(iss.look.elevDeg * 10) / 10,
      azimuthDeg: Math.round(iss.look.azDeg),
      nextPass: pass
        ? {
            start: pass.riseMs,
            max: pass.maxElevMs,
            end: pass.setMs,
            maxElevationDeg: Math.round(pass.maxElevDeg),
            riseAzimuthDeg: Math.round(pass.riseAzDeg ?? 0),
            visible: Boolean(pass.visible),
          }
        : null,
    };
  }
  return {
    at: now,
    observer: { lon, lat },
    sunElevationDeg: Math.round(sunEl * 10) / 10,
    aircraft: aircraft.slice(0, 60),
    satellites: satellites.slice(0, 40),
    iss: issOut,
    sources: ['OpenSky Network / adsb.lol (ODbL)', 'CelesTrak GP data, SGP4'],
  };
}
