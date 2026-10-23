/**
 * Shared, cached data feeds. Layers and situations read the same feed objects,
 * so a situation card never triggers a second download of data a visible layer
 * already holds, and a layer that is off costs nothing until something asks.
 *
 * Every feed resolves to `{ data, stale }` from its loader; `get()` returns the
 * cached data when it is younger than `maxAgeMs`, otherwise loads once (single
 * flight) and keeps the last good data when a refresh fails.
 */
import { parseTleText } from '../../src/sources/tle.js';
import { normalizeEarthquakeSnapshot } from '../../src/layers/earthquakes/records.js';
import { adaptFirmsRecords } from '../../src/data/firmsAdapt.js';
import { validateCycloneSnapshot } from '../../src/layers/cyclones/source.js';
import { classifyAircraft } from '../../src/data/aircraftClass.js';
import { BHOTE_KOSHI_FLOOD_PATH } from '../../src/data/bhoteKoshiFloodPath.js';
import { FT_TO_M, KT_TO_MPS, finite } from './geo.js';

const FETCH_TIMEOUT_MS = 25_000;

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class FeedError extends Error {
  constructor(message, { keyRequired = false, status = 0 } = {}) {
    super(message);
    this.keyRequired = keyRequired;
    this.status = status;
  }
}

/** A cached single-flight feed. */
export function createFeed(name, load, { ttlMs = 60_000 } = {}) {
  const listeners = new Set();
  const feed = {
    name,
    data: null,
    stale: false,
    updatedAt: 0,
    error: null,
    async get({ maxAgeMs = ttlMs, args } = {}) {
      if (feed.data && Date.now() - feed.updatedAt < maxAgeMs) return feed.data;
      // A server without the feed's key is not asked again for 10 minutes.
      if (feed.error?.keyRequired && Date.now() < feed._retryAt) {
        if (feed.data) return feed.data;
        throw feed.error;
      }
      if (!feed._inflight) {
        feed._inflight = (async () => {
          try {
            const result = await load(args);
            feed.data = result.data;
            feed.stale = Boolean(result.stale);
            feed.updatedAt = Date.now();
            feed.error = null;
          } catch (error) {
            feed.error = error;
            feed._retryAt = Date.now() + 10 * 60_000;
            if (feed.data) feed.stale = true;
          } finally {
            feed._inflight = null;
            for (const fn of listeners) fn(feed);
          }
        })();
      }
      await feed._inflight;
      if (!feed.data && feed.error) throw feed.error;
      return feed.data;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    _inflight: null,
    _retryAt: 0,
  };
  return feed;
}

/* ───────────────────────── Aircraft ───────────────────────── */

const REGISTRATION_CALLSIGN =
  /^(N\d{1,5}[A-Z]{0,2}|[CDFGI]-?[A-Z]{4}|VH-?[A-Z]{3}|D[A-Z]{4}|ZK-?[A-Z]{3}|JA\d{3,4}[A-Z]?)$/;

/** OpenSky state vector → flight record. */
export function flightFromState(s) {
  const lon = finite(s[5]);
  const lat = finite(s[6]);
  if (lon === null || lat === null) return null;
  const callsign = String(s[1] || '').trim();
  const category = finite(s[17]);
  const cls = classifyAircraft({ category: category ?? undefined });
  const squawk = s[14] ? String(s[14]).trim() : null;
  const altM = finite(s[13]) ?? finite(s[7]);
  const onGround = s[8] === true;
  return {
    id: String(s[0]),
    callsign: callsign || String(s[0]).toUpperCase(),
    country: s[2] || '',
    lon,
    lat,
    altM: onGround ? 0 : (altM ?? 10_000),
    baroAltM: finite(s[7]),
    onGround,
    speed: finite(s[9]),
    heading: finite(s[10]) ?? 0,
    vRate: finite(s[11]),
    squawk,
    category,
    cls,
    ga:
      category === 2 ||
      category === 3 ||
      REGISTRATION_CALLSIGN.test(callsign.replace(/\s+/g, '')),
    helicopter: category === 8 || cls === 'helicopter',
    emergency: squawk === '7500' || squawk === '7600' || squawk === '7700',
    seenAt: (finite(s[4]) ?? Date.now() / 1000) * 1000,
  };
}

export function createFlightsFeed(getAnchor) {
  return createFeed(
    'flights',
    async () => {
      const anchor = getAnchor?.();
      const query = anchor
        ? `?lat=${anchor.lat.toFixed(3)}&lon=${anchor.lon.toFixed(3)}`
        : '';
      const response = await fetchWithTimeout(`/api/flights${query}`, {
        cache: 'no-store',
      });
      if (!response.ok)
        throw new FeedError(`Flights HTTP ${response.status}`, {
          status: response.status,
        });
      const payload = await response.json();
      if (!Array.isArray(payload?.states))
        throw new FeedError('Malformed flight snapshot');
      const records = [];
      for (const s of payload.states) {
        const r = flightFromState(s);
        if (r) records.push(r);
      }
      const cache = response.headers.get('x-opensky-cache') || '';
      // When OpenSky is down the proxy answers with a 250 nm adsb.lol
      // snapshot around the anchor: real, but regional.
      const regional = /adsb\.lol/i.test(
        response.headers.get('x-flight-source') || '',
      );
      const source = regional
        ? 'adsb.lol (regional fallback, 250 nm)'
        : 'OpenSky Network';
      return {
        data: {
          records,
          source,
          regional,
          anchor: anchor || null,
          time: (payload.time || 0) * 1000,
        },
        stale: cache === 'STALE',
      };
    },
    { ttlMs: 12_000 },
  );
}

export function createMilitaryFeed() {
  return createFeed(
    'military',
    async () => {
      const response = await fetchWithTimeout('/api/military', {
        cache: 'no-store',
      });
      if (!response.ok)
        throw new FeedError(`Military HTTP ${response.status}`, {
          status: response.status,
        });
      const payload = await response.json();
      if (!Array.isArray(payload?.ac))
        throw new FeedError('Malformed military snapshot');
      const records = [];
      for (const a of payload.ac) {
        const lon = finite(a.lon);
        const lat = finite(a.lat);
        if (lon === null || lat === null) continue;
        const onGround = a.alt_baro === 'ground';
        const altFt = finite(a.alt_geom) ?? finite(a.alt_baro);
        const cls = classifyAircraft({ typeCode: a.t, category: a.category });
        records.push({
          id: String(a.hex),
          callsign: String(a.flight || a.r || a.hex).trim(),
          registration: a.r || '',
          type: a.t || '',
          lon,
          lat,
          altM: onGround ? 0 : Math.max(0, (altFt ?? 15_000) * FT_TO_M),
          onGround,
          speed: finite(a.gs) !== null ? a.gs * KT_TO_MPS : null,
          heading: finite(a.track) ?? finite(a.true_heading) ?? 0,
          squawk: a.squawk || null,
          cls,
          helicopter: cls === 'helicopter',
          military: true,
          // adsb.lol dbFlags: 4 = PIA, 8 = LADD (owner privacy programmes).
          pia: Boolean(a.dbFlags & 4),
          ladd: Boolean(a.dbFlags & 8),
          seenAt:
            Date.now() - (finite(a.seen_pos) ?? finite(a.seen) ?? 0) * 1000,
        });
      }
      return {
        data: { records, source: 'adsb.lol' },
        stale: response.headers.get('x-feed-cache') === 'STALE',
      };
    },
    { ttlMs: 15_000 },
  );
}

/* ───────────────────────── Sea ───────────────────────── */

export function createVesselsFeed() {
  return createFeed(
    'vessels',
    async () => {
      const response = await fetchWithTimeout('/api/vessels?maxRows=4000', {
        cache: 'no-store',
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        /* status decides */
      }
      if (payload?.status === 'missing-key')
        throw new FeedError('AIS needs AISSTREAM_API_KEY on the server', {
          keyRequired: true,
          status: response.status,
        });
      if (!response.ok || !Array.isArray(payload?.rows))
        throw new FeedError(`Vessels HTTP ${response.status}`, {
          status: response.status,
        });
      const records = [];
      for (const row of payload.rows) {
        const lat = finite(row.lat);
        const lon = finite(row.lon);
        if (lat === null || lon === null) continue;
        records.push({
          id: String(row.mmsi || `${lat},${lon}`),
          name: String(row.name || row.mmsi || 'Vessel'),
          type: String(row.type || ''),
          destination: String(row.destination || ''),
          lon,
          lat,
          speed: finite(row.speed) !== null ? row.speed * KT_TO_MPS : null,
          heading: finite(row.heading) ?? finite(row.course) ?? 0,
        });
      }
      return {
        data: { records, source: payload.source || 'AISStream' },
        stale: payload.status === 'stale',
      };
    },
    { ttlMs: 20_000 },
  );
}

/* ───────────────────────── Orbit ───────────────────────── */

export function createTleFeed(group, ttlMs = 2 * 3600_000) {
  return createFeed(
    `tle:${group}`,
    async () => {
      const response = await fetchWithTimeout(`/api/celestrak/${group}`);
      if (!response.ok)
        throw new FeedError(`CelesTrak HTTP ${response.status}`, {
          status: response.status,
        });
      const entries = parseTleText(await response.text());
      if (!entries.length) throw new FeedError('Empty TLE catalog');
      return {
        data: { entries, source: 'CelesTrak' },
        stale: response.headers.get('x-tle-cache') === 'STALE-ERROR',
      };
    },
    { ttlMs },
  );
}

function launchRecord(r, upcoming) {
  const lat = finite(r?.pad?.latitude);
  const lon = finite(r?.pad?.longitude);
  const net = Date.parse(r?.net);
  if (lat === null || lon === null || !Number.isFinite(net)) return null;
  return {
    id: String(r.id),
    name: String(r.name || 'Launch'),
    net,
    status: r.status?.abbrev || r.status?.name || '',
    provider: r.launch_service_provider?.name || r.lsp_name || '',
    pad: r.pad?.name || '',
    location: r.pad?.location?.name || r.location || '',
    mission: r.mission?.name || '',
    orbit: r.mission?.orbit?.abbrev || '',
    image: r.image?.thumbnail_url || r.image?.image_url || null,
    lon,
    lat,
    upcoming,
  };
}

/**
 * Recent launches from the app's proxy plus upcoming launches straight from
 * Launch Library 2 (keyless, CORS-enabled, rate limited to ~15/h, so the
 * feed TTL is long).
 */
export function createLaunchesFeed() {
  return createFeed(
    'launches',
    async () => {
      const [recent, upcoming] = await Promise.allSettled([
        fetchWithTimeout('/api/launches').then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
        ),
        fetchWithTimeout(
          'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=12&mode=normal',
        ).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
        ),
      ]);
      const records = new Map();
      const add = (list, isUpcoming) => {
        for (const raw of list || []) {
          const rec = launchRecord(raw, isUpcoming);
          if (rec) records.set(rec.id, rec);
        }
      };
      if (recent.status === 'fulfilled')
        add(recent.value?.results ?? recent.value, false);
      if (upcoming.status === 'fulfilled') add(upcoming.value?.results, true);
      if (!records.size) throw new FeedError('Launch feeds unavailable');
      const now = Date.now();
      for (const r of records.values()) r.upcoming = r.net > now - 3600_000;
      return {
        data: {
          records: [...records.values()].sort((a, b) => a.net - b.net),
          source: 'The Space Devs · Launch Library 2',
          upcomingOk: upcoming.status === 'fulfilled',
        },
        stale: upcoming.status !== 'fulfilled',
      };
    },
    { ttlMs: 30 * 60_000 },
  );
}

/* ───────────────────────── Hazards ───────────────────────── */

export function createQuakesFeed() {
  return createFeed(
    'earthquakes',
    async () => {
      const response = await fetchWithTimeout(
        'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
      );
      if (!response.ok)
        throw new FeedError(`USGS HTTP ${response.status}`, {
          status: response.status,
        });
      const rows = normalizeEarthquakeSnapshot(await response.json());
      if (!rows) throw new FeedError('Malformed USGS response');
      return { data: { records: rows, source: 'USGS' } };
    },
    { ttlMs: 5 * 60_000 },
  );
}

/** NASA EONET open events: wildfires, volcanoes and severe storms. */
export function createEonetFeed() {
  return createFeed(
    'eonet',
    async () => {
      // Volcano events are curated slowly (often months old) but stay open,
      // so they are asked for without the 45-day window.
      const base = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open';
      const [recent, volcanoes] = await Promise.all([
        fetchWithTimeout(`${base}&days=45&category=wildfires,severeStorms`),
        fetchWithTimeout(`${base}&category=volcanoes&limit=80`).catch(
          () => null,
        ),
      ]);
      if (!recent.ok)
        throw new FeedError(`EONET HTTP ${recent.status}`, {
          status: recent.status,
        });
      const events = [...((await recent.json())?.events || [])];
      if (volcanoes?.ok)
        events.push(...((await volcanoes.json())?.events || []));
      const out = { wildfires: [], volcanoes: [], severeStorms: [] };
      for (const e of events) {
        const cat = e.categories?.[0]?.id;
        if (!out[cat]) continue;
        const points = (e.geometry || [])
          .filter((g) => g.type === 'Point' && Array.isArray(g.coordinates))
          .map((g) => ({
            lon: g.coordinates[0],
            lat: g.coordinates[1],
            t: Date.parse(g.date),
            magnitude: finite(g.magnitudeValue),
            unit: g.magnitudeUnit || '',
          }))
          .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat))
          .sort((a, b) => a.t - b.t);
        if (!points.length) continue;
        const last = points.at(-1);
        out[cat].push({
          id: e.id,
          title: e.title,
          lon: last.lon,
          lat: last.lat,
          t: last.t,
          firstT: points[0].t,
          magnitude: last.magnitude,
          unit: last.unit,
          track: points,
          link: e.sources?.[0]?.url || e.link,
        });
      }
      return { data: { ...out, source: 'NASA EONET' } };
    },
    { ttlMs: 20 * 60_000 },
  );
}

/**
 * Active fires: NASA FIRMS hotspots through the app's proxy when a MAP_KEY is
 * configured, else NASA EONET wildfire events (keyless) so the layer still
 * says something true.
 */
export function createFiresFeed(eonet) {
  return createFeed(
    'fires',
    async () => {
      let keyRequired = false;
      try {
        // Ask the proxy whether it has a MAP_KEY before asking for fires,
        // so a keyless server costs one quiet 200 instead of a 503.
        const status = await fetchWithTimeout('/api/firms/status', {
          cache: 'no-store',
        }).then((r) => (r.ok ? r.json() : null));
        keyRequired = status?.hasKey === false;
        if (!keyRequired) {
          const response = await fetchWithTimeout('/api/firms', {
            cache: 'no-store',
          });
          const payload = await response.json().catch(() => null);
          if (response.ok && Array.isArray(payload?.fires)) {
            const records = adaptFirmsRecords(payload.fires).map((f) => ({
              id: `firms-${f.index}`,
              lon: f.lon,
              lat: f.lat,
              t: f.acqMs,
              frp: f.frp,
              confidence: f.confidence,
              title: 'Fire hotspot',
            }));
            return {
              data: { records, source: 'NASA FIRMS', mode: 'hotspots' },
              stale: Boolean(payload.stale),
            };
          }
          keyRequired = payload?.error === 'no_key';
        }
      } catch {
        /* fall through to EONET */
      }
      const ev = await eonet.get();
      const records = ev.wildfires.map((f) => ({
        id: f.id,
        lon: f.lon,
        lat: f.lat,
        t: f.t,
        frp: null,
        acres: f.unit === 'acres' ? f.magnitude : null,
        title: f.title,
        link: f.link,
      }));
      return {
        data: {
          records,
          source: 'NASA EONET wildfire events',
          mode: 'events',
          firmsKeyRequired: keyRequired,
        },
      };
    },
    { ttlMs: 10 * 60_000 },
  );
}

export function createCyclonesFeed(eonet) {
  return createFeed(
    'cyclones',
    async () => {
      const storms = [];
      let source = 'NOAA NHC / CPHC';
      let nhcOk = false;
      try {
        const response = await fetchWithTimeout('/api/cyclones');
        if (response.ok) {
          const raw = await response.json();
          let snap;
          try {
            snap = validateCycloneSnapshot(raw);
          } catch {
            snap = raw;
          }
          nhcOk = true;
          for (const s of snap.storms || []) {
            const lon = s.position?.longitude;
            const lat = s.position?.latitude;
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            storms.push({
              id: s.id,
              name: s.name,
              classification: s.classification,
              basin: s.basin,
              lon,
              lat,
              t: Date.parse(s.positionAt) || Date.now(),
              windKt: s.windKt,
              pressureHpa: s.pressureHpa,
              movement: s.movement,
              forecast: (s.forecastPoints || []).map((p) => ({
                lon: p.position.longitude,
                lat: p.position.latitude,
                tauHours: p.tauHours,
                windKt: p.windKt,
              })),
              cone: s.cone,
              track: s.track,
              link: s.advisoryUrl,
              source: 'NOAA NHC',
            });
          }
        }
      } catch {
        /* EONET below */
      }
      // EONET severe storms add the basins NHC does not cover (W. Pacific,
      // Indian Ocean, Southern Hemisphere).
      try {
        const ev = await eonet.get();
        for (const s of ev.severeStorms) {
          if (Date.now() - s.t > 3 * 86_400_000) continue;
          const dup = storms.some(
            (n) => Math.abs(n.lat - s.lat) < 3 && Math.abs(n.lon - s.lon) < 3,
          );
          if (dup) continue;
          const nameMatch =
            /(Super Typhoon|Typhoon|Hurricane|Tropical Cyclone|Cyclone|Tropical Storm|Tropical Depression|Storm|Depression)\s+([\w-]+)/i.exec(
              s.title,
            );
          storms.push({
            id: s.id,
            name: nameMatch ? nameMatch[2] : s.title,
            label: nameMatch
              ? nameMatch[1].replace(/\b\w/g, (c) => c.toUpperCase())
              : null,
            classification: /typhoon/i.test(s.title)
              ? 'TY'
              : /cyclone/i.test(s.title)
                ? 'TC'
                : 'TS',
            basin: '',
            title: s.title,
            lon: s.lon,
            lat: s.lat,
            t: s.t,
            windKt: s.unit === 'kts' ? s.magnitude : null,
            pastTrack: s.track,
            forecast: [],
            link: s.link,
            source: 'NASA EONET',
          });
        }
        if (!nhcOk) source = 'NASA EONET';
        else source = 'NOAA NHC / CPHC + NASA EONET';
      } catch {
        if (!nhcOk) throw new FeedError('Cyclone feeds unavailable');
      }
      return { data: { records: storms, source } };
    },
    { ttlMs: 15 * 60_000 },
  );
}

/* ───────────────────────── Eyes ───────────────────────── */

export function createCctvFeed() {
  return createFeed(
    'cctv',
    async () => {
      const response = await fetchWithTimeout('/api/cctv/sources', {
        cache: 'no-store',
      });
      if (!response.ok)
        throw new FeedError(`CCTV HTTP ${response.status}`, {
          status: response.status,
        });
      const payload = await response.json();
      if (!Array.isArray(payload?.sources))
        throw new FeedError('Malformed camera catalog');
      const records = [];
      for (const c of payload.sources) {
        const lat = finite(c.lat);
        const lon = finite(c.lon);
        if (lat === null || lon === null) continue;
        records.push({
          id: String(c.id),
          name: String(c.name || c.code || 'Camera'),
          city: c.city || '',
          provider: c.provider || '',
          lon,
          lat,
          heading: finite(c.headingDeg) ?? 0,
          fovDeg: finite(c.fovDeg) ?? 50,
          pitchDeg: finite(c.pitchDeg) ?? -10,
          feedType: c.feedType || 'image',
        });
      }
      return { data: { records, source: 'Public traffic cameras' } };
    },
    { ttlMs: 30 * 60_000 },
  );
}

/** Same frame URL family the production CCTV layer uses. */
export function cctvFrameUrl(camera) {
  const params = new URLSearchParams({
    label: camera.name,
    city: camera.city,
    lat: camera.lat.toFixed(6),
    lon: camera.lon.toFixed(6),
    heading: String(Math.round(camera.heading)),
    fov: String(Math.round(camera.fovDeg)),
    pitch: String(Math.round(camera.pitchDeg || -10)),
    ts: String(Math.floor(Date.now() / 10_000)),
  });
  return `/api/cctv/frame/${encodeURIComponent(camera.id)}?${params}`;
}

/* ───────────────────────── Bundled event ───────────────────────── */

export function createFloodFeed() {
  return createFeed(
    'bhote-koshi',
    async () => {
      let event = null;
      try {
        const response = await fetchWithTimeout(
          '/events/bhote-koshi-2026/event.json',
        );
        if (response.ok) event = await response.json();
      } catch {
        /* the bundled centerline below still renders */
      }
      const corridor = event?.reconstruction?.corridor?.map((c) => [
        c.lon,
        c.lat,
        c.elevationM,
      ]);
      return {
        data: {
          event,
          path: BHOTE_KOSHI_FLOOD_PATH.map(([lon, lat]) => [lon, lat]),
          corridor: corridor?.length ? corridor : null,
          source: 'GeoPera river centerline (CC BY-NC 4.0) · Vantor Open Data',
        },
      };
    },
    { ttlMs: Infinity },
  );
}
