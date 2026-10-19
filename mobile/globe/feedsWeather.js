/**
 * Round-two feeds: weather rasters (NOAA nowCOAST through the app's
 * /api/weather proxy), wind fields (/api/wind GFS, else Open-Meteo), the jet
 * stream (Open-Meteo 250 hPa), NHC wind radii (api.weather.gov TCM text,
 * CORS-enabled), GNSS integrity (/api/gnss-integrity), GTFS-realtime transit
 * (/api/transit), air quality (Open-Meteo) and regional ADS-B scans.
 *
 * Every loader is keyless. Each returns real data or throws; nothing here
 * invents a value when an upstream is down.
 */
import { createFeed, FeedError } from './feeds.js';
import { finite } from './geo.js';

const TIMEOUT_MS = 25_000;

async function getJson(url, { timeoutMs = TIMEOUT_MS, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok)
      throw new FeedError(`HTTP ${response.status} for ${url.split('?')[0]}`, {
        status: response.status,
      });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** A small keyed cache of single-flight loads (per anchor / per feed id). */
export function createKeyedFeed(name, load, { ttlMs = 60_000, max = 32 } = {}) {
  const entries = new Map();
  return {
    name,
    peek(key) {
      return entries.get(key)?.data ?? null;
    },
    entries() {
      return [...entries.values()].filter((e) => e.data);
    },
    async get(key, args, { maxAgeMs = ttlMs } = {}) {
      let e = entries.get(key);
      if (e?.data && Date.now() - e.at < maxAgeMs) return e.data;
      if (e?.error && Date.now() - e.failedAt < 30_000) {
        if (e.data) return e.data;
        throw e.error;
      }
      if (!e) {
        e = { key, data: null, at: 0, inflight: null, error: null };
        entries.set(key, e);
        while (entries.size > max) entries.delete(entries.keys().next().value);
      }
      if (!e.inflight)
        e.inflight = (async () => {
          try {
            e.data = await load(args ?? key);
            e.at = Date.now();
            e.error = null;
          } catch (error) {
            e.error = error;
            e.failedAt = Date.now();
          } finally {
            e.inflight = null;
          }
        })();
      await e.inflight;
      if (!e.data) throw e.error || new FeedError(`${name} unavailable`);
      return e.data;
    },
  };
}

/* ───────────────────────── Weather rasters ───────────────────────── */

export const WEATHER_TILE_LEVEL_MAX = 6;

/** nowCOAST manifest: { product, times[], latest, bounds, title, attribution }. */
export function createWeatherManifestFeed(product) {
  return createFeed(
    `weather:${product}`,
    async () => {
      const m = await getJson(`/api/weather/manifest?product=${product}`, {
        cache: 'no-store',
      });
      if (m?.unavailable || !Array.isArray(m?.times) || !m.times.length)
        throw new FeedError(m?.reason || `${product} imagery unavailable`);
      return {
        data: {
          product,
          times: m.times,
          latest: m.latest,
          bounds: m.bounds,
          title: m.title,
          coverage: m.coverage,
          description: m.description,
          attribution: m.attribution,
          source: `NOAA nowCOAST · ${m.title}`,
        },
        stale: Boolean(m.stale),
      };
    },
    { ttlMs: product === 'clouds' ? 10 * 60_000 : 2 * 60_000 },
  );
}

/** Same-origin whole-extent image URL for a frame (2:1 sizes only). */
export function weatherImageUrl(product, time, width = 2048) {
  const size = width === 4096 ? '' : `&size=${width}x${width / 2}`;
  return `/api/weather/image?product=${product}&time=${encodeURIComponent(time)}${size}`;
}

/** Same-origin geographic tile URL (z ≤ 6; 2×1 tiles at level 0). */
export function weatherTileUrl(product, time, z, x, y) {
  return `/api/weather/tile?product=${product}&time=${encodeURIComponent(time)}&z=${z}&x=${x}&y=${y}`;
}

/** Latest frame at or before `ms` (the latest when ms is null). */
export function frameAt(times, ms) {
  if (!times?.length) return null;
  if (ms == null) return times.at(-1);
  let best = null;
  for (const t of times) if (Date.parse(t) <= ms + 60_000) best = t;
  return best;
}

/* ───────────────────────── Wind ───────────────────────── */

const MS_PER_KMH = 1 / 3.6;

/** u/v (m/s) from a meteorological speed (km/h) and from-direction (deg). */
function uv(speedKmh, dirDeg) {
  const s = speedKmh * MS_PER_KMH;
  const r = (dirDeg * Math.PI) / 180;
  return [-s * Math.sin(r), -s * Math.cos(r)];
}

/** A coarse global grid of Open-Meteo points, north to south, 12° spacing
 * (390 points: one request stays under Open-Meteo's per-minute budget). */
function omGrid(step = 12, north = 72, south = -72) {
  const lats = [];
  const lons = [];
  for (let la = north; la >= south; la -= step)
    for (let lo = -180; lo < 180; lo += step) {
      lats.push(la);
      lons.push(lo);
    }
  return {
    lats,
    lons,
    nx: 360 / step,
    ny: (north - south) / step + 1,
    lo1: -180,
    la1: north,
    dx: step,
    dy: step,
  };
}

const OM_CACHE_MS = 60 * 60_000;

/** Grids persist per browser for an hour: Open-Meteo counts every point. */
function readGridCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (Date.now() - j.at > OM_CACHE_MS) return null;
    const dec = (b64) =>
      new Float32Array(
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer,
      );
    return {
      field: { ...j.grid, u: dec(j.u), v: dec(j.v) },
      speed: dec(j.s),
      time: j.time,
    };
  } catch {
    return null;
  }
}

function writeGridCache(key, value) {
  try {
    const enc = (arr) =>
      btoa(String.fromCharCode(...new Uint8Array(arr.buffer)));
    const { u, v, ...grid } = value.field;
    localStorage.setItem(
      key,
      JSON.stringify({
        at: Date.now(),
        time: value.time,
        grid,
        u: enc(u),
        v: enc(v),
        s: enc(value.speed),
      }),
    );
  } catch {
    /* storage full or blocked */
  }
}

async function openMeteoField(opts = {}) {
  const key = `gev-om-grid:${opts.hourlyLevel || '10m'}:${opts.step || 12}`;
  const cached = readGridCache(key);
  if (cached) return cached;
  const value = await fetchOpenMeteoField(opts);
  writeGridCache(key, value);
  return value;
}

async function fetchOpenMeteoField({ hourlyLevel = null, step = 12 } = {}) {
  const g = omGrid(step);
  const vars = hourlyLevel
    ? `hourly=wind_speed_${hourlyLevel},wind_direction_${hourlyLevel}&forecast_hours=1`
    : 'current=wind_speed_10m,wind_direction_10m';
  // Three parallel chunks: a cold pressure-level request for the whole grid
  // can take Open-Meteo half a minute; thirds come back in seconds.
  const chunk = Math.ceil(g.lats.length / 3);
  const parts = await Promise.all(
    [0, 1, 2].map((k) => {
      const la = g.lats.slice(k * chunk, (k + 1) * chunk);
      const lo = g.lons.slice(k * chunk, (k + 1) * chunk);
      return getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${la.join(',')}&longitude=${lo.join(',')}&${vars}&timezone=GMT`,
        { timeoutMs: 45_000 },
      );
    }),
  );
  const rows = parts.flat();
  if (rows.length !== g.lats.length)
    throw new FeedError('Malformed Open-Meteo wind grid');
  const n = rows.length;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const speed = new Float32Array(n);
  let time = null;
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const s = hourlyLevel
      ? r.hourly?.[`wind_speed_${hourlyLevel}`]?.[0]
      : r.current?.wind_speed_10m;
    const d = hourlyLevel
      ? r.hourly?.[`wind_direction_${hourlyLevel}`]?.[0]
      : r.current?.wind_direction_10m;
    time ??= hourlyLevel ? r.hourly?.time?.[0] : r.current?.time;
    if (!Number.isFinite(s) || !Number.isFinite(d)) continue;
    [u[i], v[i]] = uv(s, d);
    speed[i] = s * MS_PER_KMH;
  }
  return {
    field: {
      u,
      v,
      nx: g.nx,
      ny: g.ny,
      lo1: g.lo1,
      la1: g.la1,
      dx: g.dx,
      dy: g.dy,
    },
    speed,
    time: time ? Date.parse(`${time}Z`) : Date.now(),
  };
}

/**
 * Surface (10 m) wind: the app's GFS grid when the server can decode it,
 * otherwise a 12° Open-Meteo grid (GFS/ICON blend, keyless).
 */
export function createWindFeed() {
  return createFeed(
    'wind',
    async () => {
      try {
        const m = await getJson('/api/wind/manifest?model=gfs', {
          cache: 'no-store',
          timeoutMs: 45_000,
        });
        if (!m?.unavailable && m?.grid && m?.gridUrl) {
          const response = await fetch(m.gridUrl);
          if (response.ok) {
            const count = m.grid.nx * m.grid.ny;
            const values = new Float32Array(await response.arrayBuffer());
            if (values.length >= count * 2) {
              const u = values.slice(0, count);
              const v = values.slice(count, count * 2);
              return {
                data: {
                  field: { ...m.grid, u, v },
                  level: '10 m',
                  time: m.fetchedAt || Date.now(),
                  source: 'NOAA GFS 10 m wind',
                },
              };
            }
          }
        }
      } catch {
        /* fall through to Open-Meteo */
      }
      const om = await openMeteoField();
      return {
        data: {
          ...om,
          level: '10 m',
          source: 'Open-Meteo forecast API (12° grid)',
        },
      };
    },
    { ttlMs: 60 * 60_000 },
  );
}

/** Jet stream: Open-Meteo 250 hPa (≈ FL340) wind on a 12° grid. */
export function createJetFeed() {
  return createFeed(
    'jet',
    async () => {
      const om = await openMeteoField({ hourlyLevel: '250hPa' });
      return {
        data: {
          ...om,
          level: '250 hPa',
          source: 'Open-Meteo forecast API · 250 hPa (12° grid)',
        },
      };
    },
    { ttlMs: 2 * 3600_000 },
  );
}

/** One point's current 10 m wind (for smoke plumes). */
export const pointWind = createKeyedFeed(
  'point-wind',
  async ({ lon, lat }) => {
    // The app's own regional weather route first (server-side, cached).
    try {
      const r = await getJson(
        `/api/weather-effects?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}`,
        { timeoutMs: 15_000 },
      );
      const w = r?.weather;
      if (Number.isFinite(w?.windKph) && Number.isFinite(w?.windDirectionDeg))
        return {
          speedKmh: w.windKph,
          fromDeg: w.windDirectionDeg,
          gustKmh: null,
          time: Date.parse(w.observedAt) || Date.now(),
          source: 'Open-Meteo via /api/weather-effects',
        };
    } catch {
      /* direct below */
    }
    const j = await getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=GMT`,
    );
    const c = j?.current;
    if (!Number.isFinite(c?.wind_speed_10m))
      throw new FeedError('No point wind');
    return {
      speedKmh: c.wind_speed_10m,
      fromDeg: c.wind_direction_10m,
      gustKmh: c.wind_gusts_10m,
      time: Date.parse(`${c.time}Z`),
      source: 'Open-Meteo',
    };
  },
  { ttlMs: 30 * 60_000, max: 64 },
);

/** Bilinear sample of a north-to-south, seam-wrapped field. */
export function sampleField(field, lon, lat) {
  const { u, v, nx, ny, lo1, la1, dx, dy } = field;
  const x = ((((lon - lo1) % 360) + 360) % 360) / dx;
  const y = Math.max(0, Math.min(ny - 1, (la1 - lat) / dy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const x1 = (x0 + 1) % nx;
  const y1 = Math.min(ny - 1, y0 + 1);
  const at = (arr, xi, yi) => arr[yi * nx + (xi % nx)];
  const lerp = (arr) =>
    (at(arr, x0, y0) * (1 - tx) + at(arr, x1, y0) * tx) * (1 - ty) +
    (at(arr, x0, y1) * (1 - tx) + at(arr, x1, y1) * tx) * ty;
  return { u: lerp(u), v: lerp(v) };
}

/* ───────────────────────── NHC wind radii ───────────────────────── */

const NM_KM = 1.852;

/** Parse an NHC TCM (forecast/advisory) for the current position's radii. */
export function parseTcm(text) {
  if (typeof text !== 'string') return null;
  const name =
    /(?:HURRICANE|TROPICAL STORM|TROPICAL DEPRESSION|SUBTROPICAL STORM|POST-TROPICAL CYCLONE|POTENTIAL TROPICAL CYCLONE)\s+([A-Z-]+)/.exec(
      text,
    )?.[1];
  const center =
    /CENTER LOCATED NEAR\s+(\d+\.\d)([NS])\s+(\d+\.\d)([EW])\s+AT\s+(\d\d)\/(\d\d)(\d\d)Z/.exec(
      text,
    );
  if (!center) return null;
  const lat = Number(center[1]) * (center[2] === 'S' ? -1 : 1);
  const lon = Number(center[3]) * (center[4] === 'W' ? -1 : 1);
  // The first radii block after "MAX SUSTAINED WINDS" is the current one.
  const block = text.split(/MAX SUSTAINED WINDS/)[1]?.split(/REPEAT\.\.\./)[0];
  const radii = [];
  for (const m of (block || '').matchAll(
    /(\d\d) KT\.+\s*(\d+)NE\s+(\d+)SE\s+(\d+)SW\s+(\d+)NW/g,
  )) {
    radii.push({
      kt: Number(m[1]),
      // NE, SE, SW, NW in km
      quadrantsKm: [m[2], m[3], m[4], m[5]].map((x) => Number(x) * NM_KM),
    });
  }
  // Forecast and outlook positions (used when the cone geometry is pending).
  const forecast = [];
  for (const m of text.matchAll(
    /(?:FORECAST|OUTLOOK) VALID\s+(\d\d)\/(\d\d)(\d\d)Z\s+(\d+\.\d)([NS])\s+(\d+\.\d)([EW])[\s\S]*?MAX WIND\s+(\d+) KT/g,
  )) {
    forecast.push({
      day: Number(m[1]),
      hourZ: Number(m[2]),
      lat: Number(m[4]) * (m[5] === 'S' ? -1 : 1),
      lon: Number(m[6]) * (m[7] === 'W' ? -1 : 1),
      windKt: Number(m[8]),
    });
  }
  const pressure = /MINIMUM CENTRAL PRESSURE\s+(\d+) MB/.exec(text)?.[1];
  const maxWind = /MAX SUSTAINED WINDS\s+(\d+) KT/.exec(block ? text : '')?.[1];
  return {
    name: name || null,
    lat,
    lon,
    radii,
    forecast,
    pressureHpa: pressure ? Number(pressure) : null,
    windKt: maxWind ? Number(maxWind) : null,
  };
}

/** Latest TCM per active storm from api.weather.gov (CORS-enabled, keyless). */
export function createTcmFeed() {
  return createFeed(
    'nhc-tcm',
    async () => {
      const list = await getJson('https://api.weather.gov/products/types/TCM', {
        headers: { Accept: 'application/ld+json' },
      });
      const graph = list?.['@graph'] || [];
      const now = Date.now();
      const latest = new Map();
      for (const p of graph) {
        const t = Date.parse(p.issuanceTime);
        if (!Number.isFinite(t) || now - t > 18 * 3600_000) continue;
        const key = p.wmoCollectiveId;
        if (!latest.has(key)) latest.set(key, p);
      }
      const storms = [];
      await Promise.all(
        [...latest.values()].slice(0, 8).map(async (p) => {
          try {
            const prod = await getJson(
              `https://api.weather.gov/products/${p.id}`,
              { headers: { Accept: 'application/ld+json' } },
            );
            const parsed = parseTcm(prod?.productText);
            if (parsed)
              storms.push({
                ...parsed,
                issuedAt: Date.parse(p.issuanceTime),
                wmo: p.wmoCollectiveId,
              });
          } catch {
            /* one advisory failing drops only its radii */
          }
        }),
      );
      return {
        data: {
          storms,
          source: 'NOAA NHC forecast/advisory via api.weather.gov',
        },
      };
    },
    { ttlMs: 30 * 60_000 },
  );
}

/* ───────────────────────── GNSS integrity ───────────────────────── */

/** Well-known interference regions worth sampling (anchors, whole degrees). */
export const GNSS_ANCHORS = Object.freeze([
  { id: 'baltic', name: 'Baltic Sea', lat: 56, lon: 21 },
  { id: 'black-sea', name: 'Black Sea', lat: 45, lon: 33 },
  { id: 'levant', name: 'Eastern Mediterranean', lat: 34, lon: 34 },
  { id: 'gulf', name: 'Persian Gulf', lat: 27, lon: 52 },
  { id: 'finland', name: 'Gulf of Finland', lat: 60, lon: 26 },
]);

/** A cell is "anomalous" by the gpsjam band formula on aircraft counts. */
function gnssCells(rows, cellDeg = 0.5) {
  const cells = new Map();
  for (const r of rows) {
    const key = `${Math.floor(r.lat / cellDeg)}:${Math.floor(r.lon / cellDeg)}`;
    let c = cells.get(key);
    if (!c)
      cells.set(
        key,
        (c = {
          lat: (Math.floor(r.lat / cellDeg) + 0.5) * cellDeg,
          lon: (Math.floor(r.lon / cellDeg) + 0.5) * cellDeg,
          total: 0,
          bad: 0,
        }),
      );
    c.total++;
    if (r.degraded || r.gpsLost) c.bad++;
  }
  const out = [];
  for (const c of cells.values()) {
    if (c.total < 3) continue;
    c.percent = (100 * Math.max(0, c.bad - 1)) / c.total;
    c.level = c.percent >= 10 ? 'high' : c.percent >= 2 ? 'medium' : 'low';
    out.push(c);
  }
  return out;
}

export const gnssIntegrity = createKeyedFeed(
  'gnss',
  async ({ lat, lon }) => {
    const j = await getJson(
      `/api/gnss-integrity?lat=${Math.round(lat)}&lon=${Math.round(lon)}`,
      { cache: 'no-store' },
    );
    if (!Array.isArray(j?.rows)) throw new FeedError('Malformed GNSS snapshot');
    const rows = j.rows.filter(
      (r) => Number.isFinite(r.lat) && Number.isFinite(r.lon),
    );
    return {
      anchor: j.anchor,
      rows,
      cells: gnssCells(rows),
      degraded: rows.filter((r) => r.degraded || r.gpsLost).length,
      fetchedAt: j.fetchedAt || Date.now(),
      source: 'adsb.lol NIC/NACp via /api/gnss-integrity',
    };
  },
  { ttlMs: 2 * 60_000, max: 24 },
);

/* ───────────────────────── Transit ───────────────────────── */

export function createTransitCatalogFeed() {
  return createFeed(
    'transit-feeds',
    async () => {
      const j = await getJson('/api/transit/feeds');
      if (!Array.isArray(j?.feeds)) throw new FeedError('No transit catalog');
      return { data: { feeds: j.feeds, source: 'GTFS-realtime agencies' } };
    },
    { ttlMs: 6 * 3600_000 },
  );
}

export const transitVehicles = createKeyedFeed(
  'transit',
  async (feedId) => {
    const j = await getJson(
      `/api/transit/vehicles/${encodeURIComponent(feedId)}`,
      { cache: 'no-store' },
    );
    if (!Array.isArray(j?.vehicles)) throw new FeedError('No vehicles');
    return {
      feedId,
      name: j.name,
      fetchedAt: j.fetchedAt,
      vehicles: j.vehicles
        .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
        .map((v) => ({
          id: String(v.id),
          lat: v.lat,
          lon: v.lon,
          bearing: finite(v.bearing),
          speedMps: finite(v.speedMps),
          routeId: v.routeId || '',
          status: v.status || '',
          t: (v.timestamp || 0) * 1000,
        })),
    };
  },
  { ttlMs: 20_000, max: 8 },
);

/* ───────────────────────── Air quality ───────────────────────── */

export const AQ_CITIES = Object.freeze([
  ['Delhi', 77.21, 28.61],
  ['Lahore', 74.35, 31.55],
  ['Dhaka', 90.41, 23.81],
  ['Kolkata', 88.36, 22.57],
  ['Mumbai', 72.88, 19.08],
  ['Beijing', 116.4, 39.9],
  ['Shanghai', 121.47, 31.23],
  ['Chengdu', 104.07, 30.67],
  ['Seoul', 126.98, 37.57],
  ['Tokyo', 139.69, 35.69],
  ['Bangkok', 100.5, 13.76],
  ['Hanoi', 105.85, 21.03],
  ['Jakarta', 106.85, -6.21],
  ['Manila', 120.98, 14.6],
  ['Karachi', 67.01, 24.86],
  ['Tehran', 51.39, 35.69],
  ['Riyadh', 46.68, 24.71],
  ['Cairo', 31.24, 30.04],
  ['Lagos', 3.38, 6.52],
  ['Kinshasa', 15.27, -4.44],
  ['Johannesburg', 28.05, -26.2],
  ['Istanbul', 28.98, 41.01],
  ['Moscow', 37.62, 55.76],
  ['Warsaw', 21.01, 52.23],
  ['Paris', 2.35, 48.86],
  ['London', -0.13, 51.51],
  ['Madrid', -3.7, 40.42],
  ['Milan', 9.19, 45.46],
  ['New York', -74.01, 40.71],
  ['Los Angeles', -118.24, 34.05],
  ['Mexico City', -99.13, 19.43],
  ['Chicago', -87.63, 41.88],
  ['Houston', -95.37, 29.76],
  ['São Paulo', -46.63, -23.55],
  ['Lima', -77.04, -12.05],
  ['Santiago', -70.67, -33.45],
  ['Bogotá', -74.07, 4.71],
  ['Sydney', 151.21, -33.87],
  ['Ulaanbaatar', 106.92, 47.89],
  ['Kathmandu', 85.32, 27.72],
]);

export function createAirQualityFeed() {
  return createFeed(
    'air-quality',
    async () => {
      const lats = AQ_CITIES.map((c) => c[2]).join(',');
      const lons = AQ_CITIES.map((c) => c[1]).join(',');
      const rows = await getJson(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=us_aqi_pm2_5,pm2_5&hourly=pm2_5&past_days=1&forecast_days=1&timezone=GMT`,
        { timeoutMs: 40_000 },
      );
      const list = Array.isArray(rows) ? rows : [rows];
      if (list.length !== AQ_CITIES.length)
        throw new FeedError('Malformed air-quality response');
      const now = Date.now();
      const records = [];
      list.forEach((r, i) => {
        const aqi = r?.current?.us_aqi_pm2_5;
        if (!Number.isFinite(aqi)) return;
        const times = r.hourly?.time || [];
        const pm = r.hourly?.pm2_5 || [];
        const series = [];
        for (let k = 0; k < times.length; k++) {
          const t = Date.parse(`${times[k]}Z`);
          if (t <= now && now - t <= 26 * 3600_000 && Number.isFinite(pm[k]))
            series.push({ t, v: pm[k] });
        }
        records.push({
          id: `aq-${AQ_CITIES[i][0]}`,
          name: AQ_CITIES[i][0],
          lon: AQ_CITIES[i][1],
          lat: AQ_CITIES[i][2],
          aqi,
          pm25: r.current.pm2_5,
          series,
          t: Date.parse(`${r.current.time}Z`),
        });
      });
      if (!records.length) throw new FeedError('No air-quality values');
      return {
        data: {
          records,
          source: 'Open-Meteo Air Quality API (CAMS forecast model)',
        },
      };
    },
    { ttlMs: 60 * 60_000 },
  );
}

export function aqiColor(aqi) {
  if (aqi <= 50) return '#5BD46B';
  if (aqi <= 100) return '#F2D33B';
  if (aqi <= 150) return '#FF9A3D';
  if (aqi <= 200) return '#FF4D4D';
  if (aqi <= 300) return '#B04DFF';
  return '#8C1A3A';
}

/* ───────────────────────── Regional ADS-B ───────────────────────── */

/**
 * The flights proxy answers with OpenSky's global snapshot, or (when
 * OpenSky is down) a 250 nm adsb.lol snapshot around the anchor. Either way
 * the records near the anchor are real; this cache keeps one per anchor.
 */
export function createRegionalFlights(flightFromState) {
  return createKeyedFeed(
    'regional-flights',
    async ({ lat, lon }) => {
      const j = await getJson(
        `/api/flights?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`,
        { cache: 'no-store', timeoutMs: 30_000 },
      );
      if (!Array.isArray(j?.states))
        throw new FeedError('Malformed flight snapshot');
      const records = [];
      for (const s of j.states) {
        const r = flightFromState(s);
        if (r) records.push(r);
      }
      return { records, time: (j.time || 0) * 1000 };
    },
    { ttlMs: 30_000, max: 12 },
  );
}
