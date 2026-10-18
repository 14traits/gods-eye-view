/**
 * contactsNear(): aircraft, satellites and ships around a point, for the AR
 * Look mode. Reads the shared feeds directly (not layer state), so AR works
 * whether or not those layers are on the globe, and nudges a stale feed to
 * refresh in the background instead of blocking the caller's frame.
 */
import { twoline2satrec } from 'satellite.js';
import { satPosition } from './layers/orbit.js';
import { haversineKm, offsetLonLat } from './geo.js';

const SAT_GROUPS = ['stations', 'visual'];

export function createContactIndex(feeds, { active }) {
  let satCache = { stamp: '', sats: [] };

  function satrecs() {
    const stamp = SAT_GROUPS.map((g) => feeds[g].updatedAt).join(':');
    if (stamp === satCache.stamp) return satCache.sats;
    const seen = new Set();
    const sats = [];
    for (const g of SAT_GROUPS) {
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
          /* skip malformed */
        }
      }
    }
    satCache = { stamp, sats };
    return sats;
  }

  function nudge(feed, maxAgeMs) {
    if (!active()) return;
    if (!feed.data || Date.now() - feed.updatedAt > maxAgeMs)
      feed.get({ maxAgeMs }).catch(() => {});
  }

  return function contactsNear(
    lon,
    lat,
    km = 50,
    { timeMs = Date.now() } = {},
  ) {
    nudge(feeds.flights, 20_000);
    nudge(feeds.military, 30_000);
    nudge(feeds.vessels, 60_000);
    for (const g of SAT_GROUPS) nudge(feeds[g], 6 * 3600_000);

    const out = [];
    const seen = new Set();
    const now = Date.now();
    const addMover = (r, kind, title) => {
      if (seen.has(r.id)) return;
      let [rlon, rlat] = [r.lon, r.lat];
      if (r.speed && !r.onGround && r.seenAt) {
        const dt = Math.min(90, Math.max(0, (now - r.seenAt) / 1000));
        [rlon, rlat] = offsetLonLat(r.lon, r.lat, r.heading || 0, r.speed * dt);
      }
      const d = haversineKm(lat, lon, rlat, rlon);
      if (d > km) return;
      seen.add(r.id);
      out.push({
        kind,
        id: r.id,
        title,
        lon: rlon,
        lat: rlat,
        altM: r.altM ?? 0,
        headingDeg: r.heading ?? null,
        speedMps: r.speed ?? null,
        distanceKm: d,
      });
    };
    for (const r of feeds.military.data?.records || [])
      addMover(r, r.helicopter ? 'helicopter' : 'military', r.callsign);
    for (const r of feeds.flights.data?.records || [])
      addMover(r, r.helicopter ? 'helicopter' : 'aircraft', r.callsign);
    for (const r of feeds.vessels.data?.records || [])
      addMover(
        { ...r, altM: 0, seenAt: feeds.vessels.updatedAt },
        'vessel',
        r.name,
      );

    // Satellites: anything whose sub-point is within km plus the horizon
    // reach of its altitude is potentially overhead.
    for (const s of satrecs()) {
      const p = satPosition(s.satrec, timeMs);
      if (!p) continue;
      const reachKm = km + Math.sqrt(2 * 6371 * (p.altM / 1000));
      const d = haversineKm(lat, lon, p.lat, p.lon);
      if (d > reachKm) continue;
      const q = satPosition(s.satrec, timeMs + 10_000);
      const heading = q
        ? (Math.atan2(
            (q.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180),
            q.lat - p.lat,
          ) *
            180) /
            Math.PI +
          360
        : 0;
      out.push({
        kind: s.id === '25544' ? 'station' : 'satellite',
        id: s.id,
        title: s.name,
        lon: p.lon,
        lat: p.lat,
        altM: p.altM,
        headingDeg: heading % 360,
        speedMps: p.speedMps,
        distanceKm: d,
      });
    }
    return out.sort((a, b) => a.distanceKm - b.distanceKm);
  };
}
