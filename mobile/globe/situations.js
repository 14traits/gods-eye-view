/**
 * Situation cards for the Now feed (DESIGN.md §11.2): space → sky → ground,
 * four archetypes (sensor, eye, track, number), every number from a live
 * keyless feed with its source named. A genre whose feed fails, or that has
 * nothing real to show right now, is omitted, never invented.
 *
 * Each card also registers a compositor scene (SCENES, keyed by card id):
 * the data the thumbnail compositor draws over the imagery. Scenes stay out
 * of the card objects so the shell can clone and serialise cards freely.
 */
import { twoline2satrec } from 'satellite.js';
import { findNextIssPass } from '../../src/data/issPass.js';
import { satPosition } from './layers/orbit.js';
import { radiiFor, stormCategory } from './layers/hazards.js';
import { loadWeatherFrame, strikeCells } from './layers/weather.js';
import { AIRPORTS, FORT_NOVOSEL } from './places.js';
import {
  densestCell,
  haversineKm,
  relTime,
  subsolarPoint,
  thumbnailAround,
} from './geo.js';
import { cctvFrameUrl } from './feeds.js';
import {
  GNSS_ANCHORS,
  gnssIntegrity,
  pointWind,
  transitVehicles,
} from './feedsWeather.js';
import { describePlace, US_METROS, compass } from './gazetteer.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const FEED_BUDGET_MS = 12_000;
const FLIGHTS_BUDGET_MS = 26_000;
const SLOW_BUDGET_MS = 20_000;
/** No genre may hold the feed back longer than this (after its feeds). */
const GENRE_BUDGET_MS = 25_000;

/** Compositor scenes by situation id (see compositor.js). */
export const SCENES = new Map();
/** Verified camera frames fetched while building eye cards: id → {blob, at}. */
export const EYE_FRAMES = new Map();

const withBudget = (promise, ms = FEED_BUDGET_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('feed budget exceeded')), ms),
    ),
  ]);

const M_TO_FT = 3.28084;
const MPS_TO_KT = 1 / 0.514444;
const up = (s) => String(s).toUpperCase();
const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 19) + 'Z';
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16) + 'Z';
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fl = (altM) =>
  `FL${String(Math.round((altM * M_TO_FT) / 100)).padStart(3, '0')}`;

function fmtLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

function corridorKm(ev) {
  const c = ev?.reconstruction?.corridor;
  if (!c?.length) return 22;
  return Math.round(Math.abs(c.at(-1).chainageM - c[0].chainageM) / 100) / 10;
}

function card(base, scene) {
  const radiusKm = base.radiusKm ?? 60;
  const camHeight = base.camera?.height ?? radiusKm * 2500;
  const c = {
    id: base.id,
    kind: base.kind,
    family: base.family,
    section: base.section || 'now',
    band: base.band,
    archetype: base.archetype,
    telemetry: base.telemetry,
    title: base.title,
    subtitle: base.subtitle || '',
    place: base.place || fmtLatLon(base.lat, base.lon),
    lon: base.lon,
    lat: base.lat,
    camera: {
      lon: base.camera?.lon ?? base.lon,
      lat: base.camera?.lat ?? base.lat,
      height: camHeight,
      heading: base.camera?.heading ?? 0,
      pitch: base.camera?.pitch ?? -50,
      ...(Number.isFinite(base.camera?.targetHeight)
        ? { targetHeight: base.camera.targetHeight }
        : {}),
    },
    layers: base.layers || [],
    ...(base.time ? { time: base.time } : {}),
    metrics: base.metrics || [],
    ...(base.headline ? { headline: base.headline } : {}),
    ...(base.media ? { media: base.media } : {}),
    ...(base.series?.length > 1
      ? { series: base.series, seriesLabel: base.seriesLabel || '' }
      : {}),
    thumbnail: base.thumbnail || thumbnailAround(base.lon, base.lat, radiusKm),
    live: base.live ?? true,
    updatedAt: base.updatedAt ?? Date.now(),
    source: base.source || '',
    severity: base.severity ?? 0,
  };
  SCENES.set(c.id, {
    lon: base.lon,
    lat: base.lat,
    spanKm: base.spanKm ?? radiusKm * 2,
    band: base.band,
    ...scene,
  });
  return c;
}

/** Region words for a lat/lon (coarse, for subtitles only). */
function regionOf(lat, lon) {
  if (lat > 35 && lat < 72 && lon > -25 && lon < 45) return 'Europe';
  if (lat > 12 && lat < 42 && lon >= 34 && lon < 63) return 'Middle East';
  if (lat > 15 && lat < 72 && lon > -170 && lon < -50) return 'North America';
  if (lat < 15 && lat > -56 && lon > -90 && lon < -30) return 'South America';
  if (lat > -35 && lat < 37 && lon > -20 && lon < 52) return 'Africa';
  if (lat > -50 && lat < -10 && lon > 110 && lon < 180) return 'Australia';
  if (lat > 5 && lon > 52 && lon < 150) return 'Asia';
  if (lat < 5 && lon > 90 && lon < 150) return 'Maritime Southeast Asia';
  return 'Open ocean';
}

function basinOf(lat, lon) {
  if (lat >= 0) {
    if (lon >= 100 || lon < -180) return 'Western Pacific';
    if (lon >= 40 && lon < 100) return 'North Indian Ocean';
    if (lon >= -140 && lon < -80) return 'Eastern Pacific';
    if (lon < -140) return 'Central Pacific';
    return 'Atlantic';
  }
  if (lon >= 20 && lon < 135) return 'South Indian Ocean';
  if (lon >= 135 || lon < -120) return 'South Pacific';
  return 'South Atlantic';
}

/** Sun elevation (deg) at a place, from the sub-solar point. */
function sunElevation(lat, lon, ms) {
  const s = subsolarPoint(ms);
  const r = Math.PI / 180;
  const cosZ =
    Math.sin(lat * r) * Math.sin(s.lat * r) +
    Math.cos(lat * r) * Math.cos(s.lat * r) * Math.cos((lon - s.lon) * r);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / r;
}

/* ───────────────────────── Raster analysis ───────────────────────── */

/** Approximate dBZ for a pixel of nowCOAST's base-reflectivity palette. */
export function dbzOf(r, g, b, a) {
  if (a < 40) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 40) return null;
  if (min > 225) return 70; // white core
  let h = 0;
  const d = max - min || 1;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 270 && h < 330) return 62; // magenta / purple
  if (h >= 330 || h < 12) return max > 190 ? 52 : 57; // reds
  if (h < 35) return 47; // orange
  if (h < 70) return 41; // yellow
  if (h < 160) return g > 170 ? 27 : 33; // greens (dark = heavier)
  if (h < 200) return 12; // cyan
  return 20; // blue
}

/** Max dBZ and heavy-pixel count near a point in a whole-extent radar frame. */
function radarNear(canvas, bounds, lat, lon, km) {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const dLon = (bounds.east - bounds.west) / width;
  const dLat = (bounds.north - bounds.south) / height;
  const rLat = km / 111.32;
  const rLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const x0 = Math.max(0, Math.floor((lon - rLon - bounds.west) / dLon));
  const x1 = Math.min(width - 1, Math.ceil((lon + rLon - bounds.west) / dLon));
  const y0 = Math.max(0, Math.floor((bounds.north - (lat + rLat)) / dLat));
  const y1 = Math.min(
    height - 1,
    Math.ceil((bounds.north - (lat - rLat)) / dLat),
  );
  if (x1 <= x0 || y1 <= y0) return { max: null, heavy: 0, wet: 0 };
  const px = g.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  const zs = [];
  let heavy = 0;
  for (let i = 0; i < px.length; i += 4) {
    const z = dbzOf(px[i], px[i + 1], px[i + 2], px[i + 3]);
    if (z == null) continue;
    zs.push(z);
    if (z >= 40) heavy++;
  }
  if (!zs.length) return { max: null, heavy: 0, wet: 0 };
  zs.sort((a, b) => a - b);
  // A robust peak: the 98th percentile, so one stray pixel is not "heavy".
  const max = zs[Math.min(zs.length - 1, Math.floor(zs.length * 0.98))];
  return { max, heavy, wet: zs.length };
}

/** Lit-pixel area (km²) of a lightning frame inside a bbox. */
function lightningArea(canvas, bounds, bbox) {
  const cells = strikeCells(canvas, bounds, bbox);
  const pxLon = (bounds.east - bounds.west) / canvas.width;
  const pxLat = (bounds.north - bounds.south) / canvas.height;
  let area = 0;
  for (const c of cells)
    area +=
      c.pixels *
      pxLon *
      111.32 *
      Math.cos((c.lat * Math.PI) / 180) *
      pxLat *
      111.32;
  return area;
}

/** Group 0.5° strike cells into storm clusters (≈ 4° bins). */
function lightningClusters(cells) {
  const bins = new Map();
  for (const c of cells) {
    const key = `${Math.floor(c.lat / 4)}:${Math.floor(c.lon / 4)}`;
    let b = bins.get(key);
    if (!b) bins.set(key, (b = { lat: 0, lon: 0, w: 0, cells: [], level: 0 }));
    b.lat += c.lat * c.weight;
    b.lon += c.lon * c.weight;
    b.w += c.weight;
    b.level = Math.max(b.level, c.level);
    b.cells.push(c);
  }
  return [...bins.values()]
    .map((b) => ({ ...b, lat: b.lat / b.w, lon: b.lon / b.w }))
    .sort((a, b) => b.w - a.w);
}

/* ───────────────────────── Eyes ───────────────────────── */

/** Famous busy places with public cameras in the catalog (matched by name). */
const EYE_WISHLIST = [
  { re: /^Piccadilly Circus$/i, title: 'Piccadilly Circus', place: 'London' },
  { re: /^Trafalgar Square$/i, title: 'Trafalgar Square', place: 'London' },
  { re: /Tower Bridge App/i, title: 'Tower Bridge approach', place: 'London' },
  {
    re: /^YONGE ST & DUNDAS ST$/i,
    title: 'Yonge–Dundas Square',
    place: 'Toronto',
  },
  {
    re: /towards Sydney Harbour Bridge/i,
    title: 'Sydney Harbour Bridge',
    place: 'Sydney',
  },
  {
    re: /Railway Square, George Street/i,
    title: 'George Street, Railway Square',
    place: 'Sydney',
  },
  {
    re: /I-5 at MP 165\.4/i,
    title: 'I-5 through downtown Seattle',
    place: 'Seattle',
  },
  {
    re: /Bay Bridge SAS Tower West/i,
    title: 'Bay Bridge tower',
    place: 'San Francisco',
  },
  {
    re: /Hollywood Blvd/i,
    title: 'US-101 at Hollywood Blvd',
    place: 'Los Angeles',
  },
  {
    re: /Helsinki Ruoholahti/i,
    title: 'Ruoholahti, Helsinki',
    place: 'Helsinki',
  },
  { re: /^Viru väljak \(suund Mere/i, title: 'Viru Square', place: 'Tallinn' },
  {
    re: /Diagonal - Maria Cristina/i,
    title: 'Avinguda Diagonal',
    place: 'Barcelona',
  },
  { re: /^8 Ave & 1 St SE$/i, title: 'Downtown Calgary', place: 'Calgary' },
];

function camCode(id) {
  const m = /(\d{3,6})(?!.*\d)/.exec(String(id));
  return m ? m[1].slice(-5) : String(id).slice(-5).toUpperCase();
}

async function verifyFrame(cam) {
  const url = cctvFrameUrl(cam);
  const response = await fetch(url, { cache: 'no-store' });
  const kind = response.headers.get('x-cctv-source') || '';
  const type = response.headers.get('content-type') || '';
  if (
    !response.ok ||
    kind !== 'upstream-image' ||
    !/^image\/(jpeg|png|gif|webp)/.test(type)
  )
    throw new Error(`no live frame (${kind || response.status})`);
  const blob = await response.blob();
  if (blob.size < 4000) throw new Error('frame too small');
  EYE_FRAMES.set(cam.id, { blob, at: Date.now() });
  return url;
}

/* ───────────────────────── Builder ───────────────────────── */

export async function buildSituations(engine, { observer } = {}) {
  const { feeds } = engine;
  const now = Date.now();
  const get = (feed, opts, ms) => withBudget(feed.get(opts), ms);
  const settled = await Promise.allSettled([
    get(feeds.quakes),
    get(feeds.cyclones),
    get(feeds.fires),
    get(feeds.military, { maxAgeMs: 60_000 }),
    get(feeds.flights, { maxAgeMs: 60_000 }, FLIGHTS_BUDGET_MS),
    get(feeds.stations),
    get(feeds.launches),
    get(feeds.flood),
    get(feeds.radar),
    get(feeds.lightning),
    get(feeds.clouds),
    get(feeds.tcm, undefined, SLOW_BUDGET_MS),
    get(feeds.airQuality, undefined, SLOW_BUDGET_MS),
    get(feeds.cctv, undefined, SLOW_BUDGET_MS),
    get(feeds.transitCatalog),
    get(feeds.starlink, undefined, SLOW_BUDGET_MS),
    get(feeds.eonet),
  ]);
  const [
    quakes,
    cyclones,
    fires,
    military,
    flights,
    stations,
    launches,
    flood,
    radar,
    lightning,
    clouds,
    tcm,
    airQuality,
    cctv,
    transitCatalog,
    starlink,
    eonet,
  ] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
  // The jet stream grid is slow upstream (first load only; it is cached).
  const jet =
    feeds.jet.data ||
    (await withBudget(feeds.jet.get(), 10_000).catch(() => null));

  const t0 = performance.now();
  const out = [];
  const omitted = [];
  const tasks = [];
  const timings = {};
  const add = (name, fn) =>
    tasks.push(
      withBudget(Promise.resolve().then(fn), GENRE_BUDGET_MS)
        .finally(() => {
          timings[name] = Math.round(performance.now() - t0);
        })
        .then(
          (c) => {
            if (Array.isArray(c)) out.push(...c.filter(Boolean));
            else if (c) out.push(c);
            else omitted.push({ genre: name, reason: 'nothing to show now' });
          },
          (error) => {
            omitted.push({
              genre: name,
              reason: error?.message || String(error),
            });
            console.warn(`[globe:situations] ${name}`, error);
          },
        ),
    );

  /* ── Cyclones: GIBS-style IR + NHC cone, track, wind radii ── */
  add('cyclones', () => {
    if (!cyclones) throw new Error('cyclone feeds unavailable');
    return cyclones.records.slice(0, 3).map((s) => {
      const label =
        s.label ||
        {
          HU: 'Hurricane',
          TS: 'Tropical storm',
          TD: 'Tropical depression',
          TY: 'Typhoon',
          TC: 'Cyclone',
        }[s.classification] ||
        'Storm';
      const kmh = s.windKt ? Math.round(s.windKt * 1.852) : null;
      const lastTau = s.forecast?.at(-1)?.tauHours ?? 0;
      const adv = radiiFor(s, tcm);
      const radii = adv?.radii || null;
      // NHC sometimes publishes an advisory before its cone geometry: the
      // TCM text still carries the forecast positions.
      const forecast = s.forecast?.length
        ? s.forecast
        : (adv?.forecast || []).map((p) => ({
            lon: p.lon,
            lat: p.lat,
            windKt: p.windKt,
          }));
      const r34 = radii?.find((r) => r.kt === 34);
      const cat = stormCategory(s.windKt);
      return card(
        {
          id: `cyclone-${s.id}`,
          kind: 'cyclone',
          family: 'Hazards',
          band: 'orbit',
          archetype: 'sensor',
          telemetry: [
            'ORBIT',
            'LW IR',
            up(`${s.classification || ''} ${s.name}`.trim()),
            cat && cat !== 'TS' && cat !== 'TD' ? cat : null,
            s.windKt ? `${s.windKt} KT` : null,
            s.pressureHpa ? `${s.pressureHpa} HPA` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          title: `${label} ${s.name}`,
          subtitle: [
            kmh ? `${kmh} km/h winds` : null,
            s.movement?.directionDegrees != null && s.movement?.speedKt
              ? `moving ${compass(s.movement.directionDegrees)} at ${Math.round(s.movement.speedKt * 1.852)} km/h`
              : null,
            describePlace(s.lat, s.lon),
          ]
            .filter(Boolean)
            .join(' · '),
          place: `${{ EP: 'Eastern Pacific', AL: 'Atlantic', CP: 'Central Pacific' }[s.basin] || basinOf(s.lat, s.lon)}`,
          lon: s.lon,
          lat: s.lat,
          radiusKm: 700,
          spanKm: Math.max(
            1600,
            (r34 ? Math.max(...r34.quadrantsKm) * 4 : 0) + 900,
          ),
          camera: { height: 2_600_000, heading: 0, pitch: -75 },
          layers: ['cyclones', 'clouds', 'lightning', 'wind'],
          time: { start: s.t, end: s.t + lastTau * HOUR },
          metrics: [
            ...(kmh ? [{ label: 'Wind', value: kmh, unit: 'km/h' }] : []),
            ...(s.pressureHpa
              ? [{ label: 'Pressure', value: s.pressureHpa, unit: 'hPa' }]
              : []),
            ...(r34
              ? [
                  {
                    label: 'Gale radius',
                    value: Math.round(Math.max(...r34.quadrantsKm)),
                    unit: 'km',
                  },
                ]
              : []),
            ...(lastTau
              ? [{ label: 'Forecast', value: lastTau, unit: 'h' }]
              : []),
          ],
          headline: kmh
            ? { value: kmh, unit: 'km/h', label: cat || 'wind' }
            : undefined,
          updatedAt: feeds.cyclones.updatedAt,
          source: `${s.source}${radii ? ' · NHC wind radii' : ''} · IR: NOAA nowCOAST`,
          severity: 6 + (s.windKt || 0) / 40,
        },
        {
          type: 'cyclone',
          storm: {
            lon: s.lon,
            lat: s.lat,
            windKt: s.windKt,
            cone: s.cone,
            forecast,
            pastTrack: s.pastTrack || null,
            track: s.track || null,
            radii,
          },
          irTime: clouds?.latest || null,
          irBounds: clouds?.bounds || null,
        },
      );
    });
  });

  /* ── Lightning storm cells (number + sensor) ── */
  add('lightning', async () => {
    if (!lightning) throw new Error('lightning manifest unavailable');
    const canvas = await loadWeatherFrame('lightning', lightning.latest, 1024);
    const cells = strikeCells(canvas, lightning.bounds);
    const clusters = lightningClusters(cells);
    if (!clusters.length) return null;
    const picks = [clusters[0]];
    const second = clusters.find(
      (c) => haversineKm(c.lat, c.lon, clusters[0].lat, clusters[0].lon) > 1500,
    );
    if (second && second.w > clusters[0].w * 0.15) picks.push(second);
    const cards = [];
    for (const [i, c] of picks.entries()) {
      const lats = c.cells.map((x) => x.lat);
      const lons = c.cells.map((x) => x.lon);
      const bbox = {
        west: Math.min(...lons) - 1,
        east: Math.max(...lons) + 1,
        south: Math.min(...lats) - 1,
        north: Math.max(...lats) + 1,
      };
      const series = [];
      if (i === 0) {
        for (const t of lightning.times) {
          try {
            const f = await loadWeatherFrame('lightning', t, 1024, {
              keep: t === lightning.latest,
            });
            series.push({
              t: Date.parse(t),
              v: Math.round(lightningArea(f, lightning.bounds, bbox)),
            });
          } catch {
            /* a missing frame leaves a gap */
          }
        }
      }
      const area = lightningArea(canvas, lightning.bounds, bbox);
      const where = describePlace(c.lat, c.lon);
      const spanKm = Math.min(
        1400,
        Math.max(
          350,
          haversineKm(bbox.south, bbox.west, bbox.north, bbox.east) * 0.75,
        ),
      );
      const inRadar =
        radar &&
        c.lon > radar.bounds.west &&
        c.lon < radar.bounds.east &&
        c.lat > radar.bounds.south &&
        c.lat < radar.bounds.north;
      const peakNote =
        c.level >= 3 ? 'intense' : c.level === 2 ? 'strong' : 'active';
      cards.push(
        card(
          {
            id: `lightning-${Math.round(c.lat)}-${Math.round(c.lon)}`,
            kind: 'lightning',
            family: 'Weather',
            band: 'sky',
            archetype: i === 0 ? 'number' : 'sensor',
            telemetry: `SKY · LIGHTNING · 15 MIN · ${fmtInt(area)} KM² · ${hhmm(Date.parse(lightning.latest))}`,
            title:
              i === 0
                ? `Thunderstorms · ${where}`
                : `Lightning cell · ${where}`,
            subtitle: `${c.cells.length} lightning-active 0.5° cells, ${peakNote} strike density in the last 15 min`,
            place: where,
            lon: c.lon,
            lat: c.lat,
            radiusKm: spanKm / 2,
            spanKm,
            camera: { height: spanKm * 2200, heading: 0, pitch: -70 },
            layers: ['lightning', 'clouds', ...(inRadar ? ['radar'] : [])],
            time: {
              start: Date.parse(lightning.times[0]),
              end: Date.parse(lightning.latest),
            },
            metrics: [
              { label: 'Active area', value: Math.round(area), unit: 'km²' },
              { label: 'Active cells', value: c.cells.length, unit: '' },
            ],
            headline: {
              value: fmtInt(area),
              unit: 'km²',
              label: 'lightning-active area, 15 min',
            },
            series,
            seriesLabel: 'lightning-active area (km²) per 15 min',
            updatedAt: Date.parse(lightning.latest),
            source: 'NOAA nowCOAST lightning density (Vaisala NLDN/GLD360)',
            severity: 4 + Math.min(2, c.w / 200) - i,
          },
          {
            type: 'lightning',
            times: lightning.times,
            bounds: lightning.bounds,
            radar: inRadar
              ? { time: radar.latest, bounds: radar.bounds }
              : null,
            irTime: clouds?.latest || null,
            irBounds: clouds?.bounds || null,
          },
        ),
      );
    }
    return cards;
  });

  /* ── Rain over a US city (radar) ── */
  add('radar', async () => {
    if (!radar) throw new Error('radar manifest unavailable');
    const canvas = await loadWeatherFrame('radar', radar.latest, 2048);
    let best = null;
    for (const [name, lon, lat] of US_METROS) {
      const r = radarNear(canvas, radar.bounds, lat, lon, 45);
      if (r.max == null) continue;
      const score = r.max * 10 + r.heavy * 0.5 + r.wet * 0.02;
      if (!best || score > best.score) best = { name, lon, lat, ...r, score };
    }
    if (!best || best.max < 20) return null;
    const series = [];
    for (const t of radar.times) {
      try {
        const f = await loadWeatherFrame('radar', t, 2048, {
          keep: t === radar.latest,
        });
        const r = radarNear(f, radar.bounds, best.lat, best.lon, 45);
        series.push({ t: Date.parse(t), v: r.max ?? 0 });
      } catch {
        /* gap */
      }
    }
    const heavy = best.max >= 40;
    return card(
      {
        id: `radar-${best.name.replace(/\W+/g, '-').toLowerCase()}`,
        kind: 'radar',
        family: 'Weather',
        band: 'sky',
        archetype: 'sensor',
        telemetry: `SKY · MRMS · ${best.max} DBZ · ${up(best.name)} · ${hhmm(Date.parse(radar.latest))}`,
        title: `${heavy ? 'Heavy rain' : best.max >= 30 ? 'Rain' : 'Showers'} over ${best.name}`,
        subtitle: `Radar returns to ~${best.max} dBZ within 45 km${best.heavy ? ` · ${best.heavy} heavy-echo pixels` : ''}`,
        place: best.name,
        lon: best.lon,
        lat: best.lat,
        radiusKm: 60,
        spanKm: 230,
        camera: { height: 160_000, heading: 0, pitch: -55 },
        layers: ['radar', 'lightning'],
        time: {
          start: Date.parse(radar.times[0]),
          end: Date.parse(radar.latest),
        },
        metrics: [
          { label: 'Peak reflectivity', value: best.max, unit: 'dBZ' },
          { label: 'Frames', value: radar.times.length, unit: '' },
        ],
        headline: { value: best.max, unit: 'dBZ', label: 'peak reflectivity' },
        series,
        seriesLabel: 'peak reflectivity (dBZ) within 45 km',
        updatedAt: Date.parse(radar.latest),
        source:
          'NOAA MRMS base reflectivity via nowCOAST (dBZ read from colour scale)',
        severity: 2 + (best.max - 20) / 10,
      },
      {
        type: 'radar',
        time: radar.latest,
        times: radar.times,
        bounds: radar.bounds,
      },
    );
  });

  /* ── Jet stream core ── */
  add('jet', () => {
    if (!jet?.field) throw new Error('jet-stream grid not loaded yet');
    const { field, speed } = jet;
    let best = null;
    for (let i = 0; i < speed.length; i++) {
      const lat = field.la1 - Math.floor(i / field.nx) * field.dy;
      if (Math.abs(lat) < 20 || Math.abs(lat) > 70) continue;
      if (!best || speed[i] > best.s)
        best = {
          i,
          s: speed[i],
          lat,
          lon: field.lo1 + (i % field.nx) * field.dx,
        };
    }
    if (!best) return null;
    const kt = Math.round(best.s * MPS_TO_KT);
    const kmh = Math.round(best.s * 3.6);
    const where = describePlace(best.lat, best.lon);
    return card(
      {
        id: `jet-${best.lat}-${best.lon}`,
        kind: 'jet',
        family: 'Weather',
        band: 'sky',
        archetype: 'sensor',
        telemetry: `SKY · 250 HPA · FL340 · ${kt} KT · ${fmtLatLon(best.lat, best.lon).replace(/°/g, '')}`,
        title: `Jet stream core · ${kmh} km/h`,
        subtitle: `Fastest 250 hPa wind on a 12° global grid · ${where}`,
        place: where,
        lon: best.lon,
        lat: best.lat,
        radiusKm: 2500,
        spanKm: 7000,
        camera: { height: 7_500_000, heading: 0, pitch: -90 },
        layers: ['jet', 'clouds'],
        metrics: [
          { label: 'Core speed', value: kmh, unit: 'km/h' },
          { label: 'Level', value: 250, unit: 'hPa' },
        ],
        headline: { value: kt, unit: 'kt', label: 'jet core at FL340' },
        updatedAt: jet.time,
        source: jet.source,
        severity: 2 + Math.max(0, kt - 120) / 40,
      },
      { type: 'jet', windLevel: 'jet' },
    );
  });

  /* ── Quakes: largest in 24 h (sensor) + global count (number) ── */
  add('quakes', () => {
    if (!quakes) throw new Error('USGS unavailable');
    const day = quakes.records.filter((q) => q.time && now - q.time < DAY);
    if (!day.length) return null;
    const q = day.reduce((a, b) => (b.mag > a.mag ? b : a));
    const nearby = quakes.records
      .filter((r) => r !== q && haversineKm(q.lat, q.lon, r.lat, r.lon) < 400)
      .map((r) => ({ lon: r.lon, lat: r.lat, mag: r.mag, time: r.time }));
    const series = [];
    for (let h = 23; h >= 0; h--) {
      const t0 = now - (h + 1) * HOUR;
      series.push({
        t: t0 + HOUR,
        v: quakes.records.filter((r) => r.time >= t0 && r.time < t0 + HOUR)
          .length,
      });
    }
    const biggest = card(
      {
        id: `quake-${q.stableId}`,
        kind: 'earthquake',
        family: 'Hazards',
        band: 'ground',
        archetype: 'sensor',
        telemetry: `GROUND · M${q.mag.toFixed(1)} · ${Math.round(q.depthKm ?? 0)} KM DEEP · ${hhmmss(q.time)}`,
        title: `M${q.mag.toFixed(1)} earthquake`,
        subtitle: `Largest in 24 h · ${relTime(q.time, now)} · ${nearby.length} other M2.5+ within 400 km this week`,
        place: q.place || describePlace(q.lat, q.lon),
        lon: q.lon,
        lat: q.lat,
        radiusKm: 120,
        spanKm: 260,
        camera: { height: 450_000, heading: 0, pitch: -65 },
        layers: ['earthquakes'],
        time: { start: q.time, end: now },
        metrics: [
          { label: 'Magnitude', value: Number(q.mag.toFixed(1)), unit: 'M' },
          { label: 'Depth', value: Math.round(q.depthKm ?? 0), unit: 'km' },
          { label: 'M2.5+ in 24 h', value: day.length, unit: '' },
        ],
        headline: { value: q.mag.toFixed(1), unit: 'M', label: 'magnitude' },
        updatedAt: feeds.quakes.updatedAt,
        source: 'USGS',
        severity: q.mag,
      },
      {
        type: 'quake',
        quake: { lon: q.lon, lat: q.lat, mag: q.mag, depthKm: q.depthKm },
        nearby,
      },
    );
    const busiest = densestCell(day, 30) || q;
    const count = card(
      {
        id: 'quakes-24h',
        kind: 'earthquake',
        family: 'Hazards',
        band: 'ground',
        archetype: 'number',
        telemetry: `GROUND · USGS · ${day.length} EVENTS M2.5+ · 24 H`,
        title: `${day.length} earthquakes M2.5+ in 24 h`,
        subtitle: `Worldwide · largest M${q.mag.toFixed(1)} ${q.place ? `· ${q.place}` : ''}`,
        place: 'Worldwide',
        lon: busiest.lon,
        lat: Math.max(-50, Math.min(55, busiest.lat)),
        radiusKm: 4000,
        spanKm: 11000,
        camera: { height: 18_000_000, heading: 0, pitch: -90 },
        layers: ['earthquakes'],
        time: { start: now - DAY, end: now },
        metrics: [{ label: 'M2.5+ in 24 h', value: day.length, unit: '' }],
        headline: { value: day.length, unit: '', label: 'quakes M2.5+ · 24 h' },
        series,
        seriesLabel: 'M2.5+ quakes per hour',
        updatedAt: feeds.quakes.updatedAt,
        source: 'USGS',
        severity: 2,
      },
      {
        type: 'quake-world',
        quakes: quakes.records.slice(0, 900).map((r) => ({
          lon: r.lon,
          lat: r.lat,
          mag: r.mag,
          time: r.time,
        })),
      },
    );
    return [biggest, count];
  });

  /* ── Fires with smoke direction from wind ── */
  add('fires', async () => {
    if (!fires?.records.length) throw new Error('fire feeds unavailable');
    const hotspots = fires.mode === 'hotspots';
    const recent = hotspots
      ? fires.records.filter((f) => !f.t || now - f.t < DAY)
      : fires.records;
    const cell = hotspots ? 1 : 4;
    // Prescribed burns are real but not news: prefer wildfires.
    const wild = recent.filter(
      (f) => !/prescribed|\bRX\b/i.test(f.title || ''),
    );
    const pool = wild.length ? wild : recent;
    const largest = hotspots
      ? null
      : pool.reduce(
          (a, b) => ((b.acres ?? 0) > (a.acres ?? 0) ? b : a),
          pool[0],
        );
    const best =
      largest?.acres > 0
        ? {
            count: pool.filter(
              (f) => haversineKm(f.lat, f.lon, largest.lat, largest.lon) < 300,
            ).length,
            lat: largest.lat,
            lon: largest.lon,
            items: [
              largest,
              ...pool.filter(
                (f) =>
                  f !== largest &&
                  haversineKm(f.lat, f.lon, largest.lat, largest.lon) < 60,
              ),
            ],
          }
        : densestCell(pool, cell);
    if (!best) return null;
    const sample = best.items.find(
      (f) => f.title && f.title !== 'Fire hotspot',
    );
    const focus = sample || best.items[0];
    let w = null;
    try {
      w = await withBudget(
        pointWind.get(`${focus.lat.toFixed(1)}:${focus.lon.toFixed(1)}`, {
          lon: focus.lon,
          lat: focus.lat,
        }),
        8000,
      );
    } catch {
      /* no plume without wind */
    }
    const to = w ? (w.fromDeg + 180) % 360 : null;
    const where = describePlace(focus.lat, focus.lon);
    return card(
      {
        id: `fires-${focus.lat.toFixed(1)}-${focus.lon.toFixed(1)}`,
        kind: 'fires',
        family: 'Hazards',
        band: 'ground',
        archetype: 'sensor',
        telemetry: [
          'GROUND',
          hotspots ? 'VIIRS/MODIS' : 'EONET',
          w ? `WIND ${Math.round(w.speedKmh)} KM/H → ${compass(to)}` : null,
          fmtLatLon(focus.lat, focus.lon).replace(/°/g, ''),
        ]
          .filter(Boolean)
          .join(' · '),
        title: sample
          ? sample.title.split(',')[0]
          : `Fire cluster · ${regionOf(best.lat, best.lon)}`,
        subtitle: [
          hotspots
            ? `${best.count} hotspots in 24 h`
            : `${best.count} open wildfire event${best.count > 1 ? 's' : ''} nearby`,
          w
            ? `smoke drifting ${compass(to)} on ${Math.round(w.speedKmh)} km/h winds`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        place: where,
        lon: focus.lon,
        lat: focus.lat,
        radiusKm: 30,
        spanKm: 70,
        camera: { height: 80_000, heading: to ?? 0, pitch: -45 },
        layers: ['fires', 'wind', 'air-quality'],
        metrics: [
          {
            label: hotspots ? 'Hotspots' : 'Events',
            value: best.count,
            unit: '',
          },
          ...(w
            ? [{ label: 'Wind', value: Math.round(w.speedKmh), unit: 'km/h' }]
            : []),
          { label: 'Worldwide', value: recent.length, unit: '' },
        ],
        updatedAt: feeds.fires.updatedAt,
        source: `${fires.source}${w ? ' · wind: Open-Meteo' : ''}`,
        severity: 3 + Math.min(2, best.count / 50),
      },
      {
        type: 'fire',
        fires: best.items.map((f) => ({
          lon: f.lon,
          lat: f.lat,
          frp: f.frp ?? null,
          acres: f.acres ?? null,
        })),
        wind: w ? { toDeg: to, speedKmh: w.speedKmh } : null,
      },
    );
  });

  /* ── Aircraft: squawks, busiest airport, Fort Novosel, military ── */
  let flightRecords = flights?.records || [];
  // OpenSky down: the proxy answers per anchor (250 nm of adsb.lol), so a
  // few busy regions are sampled to keep squawks and airports meaningful.
  if (!flights || flights.regional) {
    const anchors = [
      [51.47, -0.45],
      [40.64, -73.78],
      [33.64, -84.43],
      [50.04, 8.57],
      [35.55, 139.78],
    ];
    const extra = await Promise.allSettled(
      anchors.map(([lat, lon]) =>
        withBudget(
          feeds.regionalFlights.get(`${lat}:${lon}`, { lat, lon }),
          FLIGHTS_BUDGET_MS,
        ),
      ),
    );
    const byId = new Map(flightRecords.map((r) => [r.id, r]));
    for (const r of extra)
      if (r.status === 'fulfilled')
        for (const f of r.value.records) byId.set(f.id, f);
    flightRecords = [...byId.values()];
  }
  const aircraftScene = (lon, lat, km, list) =>
    list
      .filter((r) => haversineKm(lat, lon, r.lat, r.lon) <= km)
      .slice(0, 400)
      .map((r) => ({
        lon: r.lon,
        lat: r.lat,
        heading: r.heading,
        speed: r.speed,
        altM: r.altM,
        onGround: r.onGround,
        helicopter: r.helicopter,
        emergency: r.emergency,
        military: r.military,
      }));

  add('squawk', () => {
    if (!flightRecords.length) throw new Error('flight feed unavailable');
    const em = flightRecords.filter((r) => r.emergency && !r.onGround);
    if (!em.length) return null;
    return em.slice(0, 2).map((r) => {
      const meaning = {
        7700: 'General emergency',
        7600: 'Radio failure',
        7500: 'Unlawful interference',
      }[r.squawk];
      const kt = Number.isFinite(r.speed)
        ? Math.round(r.speed * MPS_TO_KT)
        : null;
      const where = describePlace(r.lat, r.lon);
      const descending = r.vRate != null && r.vRate < -3;
      return card(
        {
          id: `squawk-${r.id}`,
          kind: 'squawk',
          family: 'Sky',
          band: 'sky',
          archetype: 'track',
          telemetry: [
            'SKY',
            fl(r.altM),
            kt ? `${kt} KT` : null,
            `SQ ${r.squawk}`,
            up(r.callsign),
          ]
            .filter(Boolean)
            .join(' · '),
          title: `${r.callsign} squawking ${r.squawk}`,
          subtitle: [
            meaning,
            `${fmtInt(Math.round((r.altM * M_TO_FT) / 100) * 100)} ft`,
            descending
              ? `descending ${fmtInt(Math.abs(r.vRate) * 196.85)} ft/min`
              : null,
            where,
          ]
            .filter(Boolean)
            .join(' · '),
          place: where,
          lon: r.lon,
          lat: r.lat,
          radiusKm: 60,
          spanKm: 220,
          camera: { height: 120_000, heading: r.heading, pitch: -45 },
          layers: ['squawk', 'flights'],
          metrics: [
            { label: 'Squawk', value: r.squawk, unit: '' },
            {
              label: 'Altitude',
              value: Math.round(r.altM * M_TO_FT),
              unit: 'ft',
            },
            ...(kt ? [{ label: 'Ground speed', value: kt, unit: 'kt' }] : []),
          ],
          headline: { value: r.squawk, unit: '', label: meaning },
          updatedAt: feeds.flights.updatedAt,
          source: flights?.source || 'adsb.lol (regional snapshots)',
          severity: 7,
        },
        {
          type: 'aircraft',
          focus: {
            lon: r.lon,
            lat: r.lat,
            heading: r.heading,
            speed: r.speed,
            altM: r.altM,
            emergency: true,
          },
          aircraft: aircraftScene(r.lon, r.lat, 160, flightRecords),
        },
      );
    });
  });

  add('airport', () => {
    if (!flightRecords.length) throw new Error('flight feed unavailable');
    let best = null;
    for (const ap of AIRPORTS) {
      let n = 0;
      for (const r of flightRecords) {
        if (Math.abs(r.lat - ap.lat) > 0.6 || Math.abs(r.lon - ap.lon) > 0.9)
          continue;
        if (r.altM > 4000) continue;
        if (haversineKm(ap.lat, ap.lon, r.lat, r.lon) <= 50) n++;
      }
      if (!best || n > best.n) best = { ...ap, n };
    }
    if (!best?.n) return null;
    return card(
      {
        id: `airport-${best.code}`,
        kind: 'airport',
        family: 'Sky',
        band: 'sky',
        archetype: 'sensor',
        telemetry: `SKY · ${best.code} · ${best.n} AIRCRAFT < FL130 · 50 KM`,
        title: `Busiest airspace · ${best.code}`,
        subtitle: `${best.n} aircraft below 4 km within 50 km of ${best.name}`,
        place: best.name,
        lon: best.lon,
        lat: best.lat,
        radiusKm: 40,
        spanKm: 110,
        camera: { height: 60_000, heading: 20, pitch: -45 },
        layers: ['flights', 'ga', 'helicopters'],
        metrics: [
          { label: 'Low aircraft', value: best.n, unit: '' },
          {
            label: 'Airborne worldwide',
            value: flightRecords.filter((r) => !r.onGround).length,
            unit: '',
          },
        ],
        headline: { value: best.n, unit: '', label: 'aircraft below FL130' },
        updatedAt: feeds.flights.updatedAt,
        source: flights?.source || 'adsb.lol (regional snapshots)',
        severity: 1.5,
      },
      {
        type: 'aircraft',
        aircraft: aircraftScene(best.lon, best.lat, 90, flightRecords),
        airport: { lon: best.lon, lat: best.lat },
      },
    );
  });

  add('fort-novosel', async () => {
    let records = flightRecords;
    let source = flights?.source || 'OpenSky Network';
    const near = (r) =>
      haversineKm(FORT_NOVOSEL.lat, FORT_NOVOSEL.lon, r.lat, r.lon) <=
      FORT_NOVOSEL.radiusKm;
    if (!records.some(near)) {
      const reg = await withBudget(
        feeds.regionalFlights.get('novosel', {
          lat: FORT_NOVOSEL.lat,
          lon: FORT_NOVOSEL.lon,
        }),
        FLIGHTS_BUDGET_MS,
      ).catch(() => null);
      if (reg) {
        records = reg.records;
        source = 'adsb.lol / OpenSky';
      }
    }
    const local = records.filter(near);
    const mil = (military?.records || []).filter(
      (r) => r.helicopter && near(r),
    );
    const helis = [...local.filter((r) => r.helicopter), ...mil];
    const lowSlow = local.filter(
      (r) =>
        !r.onGround && r.altM < 900 && (r.speed ?? 99) < 60 && !r.helicopter,
    );
    if (!helis.length && !lowSlow.length) return null;
    const lead = helis[0] || lowSlow[0];
    return card(
      {
        id: 'fort-novosel',
        kind: 'helicopters',
        family: 'Sky',
        section: 'always',
        band: 'sky',
        archetype: 'track',
        telemetry:
          `SKY · KOZR · ${helis.length} ROTOR · ${lowSlow.length} LOW+SLOW · ${lead ? fl(lead.altM) : ''}`.replace(
            / · $/,
            '',
          ),
        title: 'Helicopter school circuits',
        subtitle: `${helis.length} rotorcraft · ${lowSlow.length} low & slow contacts over Fort Novosel`,
        place: 'Fort Novosel, Alabama',
        lon: FORT_NOVOSEL.lon,
        lat: FORT_NOVOSEL.lat,
        radiusKm: 35,
        spanKm: 80,
        camera: { height: 45_000, heading: 340, pitch: -45 },
        layers: ['helicopters', 'military', 'ga'],
        metrics: [
          { label: 'Rotorcraft', value: helis.length, unit: '' },
          { label: 'Low & slow', value: lowSlow.length, unit: '' },
          { label: 'All aircraft', value: local.length, unit: '' },
        ],
        headline: {
          value: helis.length + lowSlow.length,
          unit: '',
          label: 'training contacts',
        },
        updatedAt: now,
        source,
        severity: 1.2,
      },
      {
        type: 'aircraft',
        aircraft: aircraftScene(FORT_NOVOSEL.lon, FORT_NOVOSEL.lat, 70, [
          ...local,
          ...mil,
        ]),
      },
    );
  });

  add('military', () => {
    if (!military?.records.length) throw new Error('military feed unavailable');
    const airborne = military.records.filter((r) => !r.onGround);
    const best = densestCell(airborne, 6);
    if (!best || best.count < 2) return null;
    const types = [
      ...new Set(best.items.map((r) => r.type).filter(Boolean)),
    ].slice(0, 3);
    const where = describePlace(best.lat, best.lon);
    return card(
      {
        id: `military-${Math.round(best.lat)}-${Math.round(best.lon)}`,
        kind: 'military',
        family: 'Sky',
        band: 'sky',
        archetype: 'sensor',
        telemetry:
          `SKY · MIL · ${best.count} AIRCRAFT · ${types.join(' ').toUpperCase()}`.trim(),
        title: `Military air activity · ${regionOf(best.lat, best.lon)}`,
        subtitle: `${best.count} military aircraft${types.length ? ` · ${types.join(', ')}` : ''} · ${where}`,
        place: where,
        lon: best.lon,
        lat: best.lat,
        radiusKm: 260,
        spanKm: Math.max(
          160,
          Math.min(
            900,
            2.6 *
              Math.max(
                ...best.items.map((r) =>
                  haversineKm(best.lat, best.lon, r.lat, r.lon),
                ),
              ),
          ),
        ),
        camera: { height: 900_000, heading: 0, pitch: -70 },
        layers: ['military'],
        metrics: [
          { label: 'In area', value: best.count, unit: '' },
          { label: 'Tracked worldwide', value: airborne.length, unit: '' },
        ],
        updatedAt: feeds.military.updatedAt,
        source: 'adsb.lol',
        severity: 2.5,
      },
      {
        type: 'aircraft',
        military: true,
        aircraft: best.items.map((r) => ({
          lon: r.lon,
          lat: r.lat,
          heading: r.heading,
          speed: r.speed,
          altM: r.altM,
          military: true,
          helicopter: r.helicopter,
        })),
      },
    );
  });

  /* ── ISS and the newest Starlink train ── */
  add('iss', () => {
    const iss = stations?.entries.find(
      (e) => e.line1.slice(2, 7).trim() === '25544',
    );
    if (!iss) throw new Error('CelesTrak stations unavailable');
    const satrec = twoline2satrec(iss.line1, iss.line2);
    const p = satPosition(satrec, now);
    if (!p) return null;
    const altKm = Math.round(p.altM / 1000);
    const kms = (p.speedMps / 1000).toFixed(2);
    let subtitle = `Over ${describePlace(p.lat, p.lon)} · ${altKm} km up`;
    let passTag = null;
    const metrics = [
      { label: 'Altitude', value: altKm, unit: 'km' },
      {
        label: 'Speed',
        value: Math.round((p.speedMps * 3.6) / 100) * 100,
        unit: 'km/h',
      },
    ];
    if (observer && Number.isFinite(observer.lat)) {
      const pass = findNextIssPass({
        satrec,
        latDeg: observer.lat,
        lonDeg: observer.lon,
        fromMs: now,
        horizonHours: 24,
      });
      if (pass) {
        subtitle = `Next pass over you ${relTime(pass.riseMs, now)} · max ${Math.round(pass.maxElevDeg)}°`;
        passTag = `PASS ${hhmm(pass.riseMs).replace('Z', '')}`;
        metrics.push({
          label: 'Next pass',
          value: new Date(pass.riseMs).toISOString(),
          unit: 'utc',
        });
      }
    }
    return card(
      {
        id: 'iss-now',
        kind: 'iss',
        family: 'Orbit',
        band: 'orbit',
        archetype: 'track',
        telemetry: ['ORBIT', 'ISS', `${altKm} KM`, `${kms} KM/S`, passTag]
          .filter(Boolean)
          .join(' · '),
        title: 'ISS now',
        subtitle,
        place: regionOf(p.lat, p.lon),
        lon: p.lon,
        lat: p.lat,
        radiusKm: 2500,
        spanKm: 9000,
        camera: { height: 5_500_000, heading: 0, pitch: -90 },
        layers: ['iss', 'satellites'],
        metrics,
        headline: { value: kms, unit: 'km/s', label: `${altKm} km up` },
        updatedAt: now,
        source: 'CelesTrak TLE · SGP4',
        severity: 2,
      },
      {
        type: 'orbit',
        sats: [{ line1: iss.line1, line2: iss.line2, name: 'ISS', main: true }],
        at: now,
        observer: observer || null,
      },
    );
  });

  add('starlink', () => {
    const entries = starlink?.entries;
    if (!entries?.length) throw new Error('Starlink TLEs unavailable');
    // International designator YYNNN: the newest launch still flying in a train.
    const byLaunch = new Map();
    for (const e of entries) {
      const id = e.line1.slice(9, 14).trim();
      if (!/^\d{5}$/.test(id)) continue;
      if (!byLaunch.has(id)) byLaunch.set(id, []);
      byLaunch.get(id).push(e);
    }
    const launchKey = (k) =>
      (Number(k.slice(0, 2)) < 57 ? 2000 : 1900) * 1000 +
      Number(k.slice(0, 2)) * 1000 +
      Number(k.slice(2));
    const launchesSorted = [...byLaunch.keys()].sort(
      (a, b) => launchKey(b) - launchKey(a),
    );
    for (const key of launchesSorted.slice(0, 4)) {
      const group = byLaunch.get(key);
      if (group.length < 8) continue;
      const pts = [];
      for (const e of group) {
        try {
          const p = satPosition(twoline2satrec(e.line1, e.line2), now);
          if (p) pts.push({ ...p, e });
        } catch {
          /* skip */
        }
      }
      if (pts.length < 8) continue;
      // A train: the largest group still within 1,500 km of one satellite.
      let core = [];
      let c = null;
      for (const p of pts) {
        const n = pts.filter(
          (q) => haversineKm(p.lat, p.lon, q.lat, q.lon) < 1500,
        );
        if (n.length > core.length) {
          core = n;
          c = p;
        }
      }
      if (core.length < 8) continue;
      pts.length = 0;
      pts.push(...core);
      const spread = Math.max(
        ...pts.map((p) => haversineKm(c.lat, c.lon, p.lat, p.lon)),
      );
      const year = 2000 + Number(key.slice(0, 2));
      const altKm = Math.round(
        pts.reduce((a, p) => a + p.altM, 0) / pts.length / 1000,
      );
      return card(
        {
          id: `starlink-${key}`,
          kind: 'starlink',
          family: 'Orbit',
          band: 'orbit',
          archetype: 'track',
          telemetry: `ORBIT · STARLINK ${year}-${key.slice(2)} · ${pts.length} SATS · ${altKm} KM`,
          title: `Starlink train · ${pts.length} satellites`,
          subtitle: `Launch ${year}-${key.slice(2)} still flying in formation · over ${describePlace(c.lat, c.lon)}`,
          place: regionOf(c.lat, c.lon),
          lon: c.lon,
          lat: c.lat,
          radiusKm: 2000,
          spanKm: Math.max(5000, spread * 2.6),
          camera: { height: 4_500_000, heading: 0, pitch: -90 },
          layers: ['starlink'],
          metrics: [
            { label: 'Satellites', value: pts.length, unit: '' },
            { label: 'Mean altitude', value: altKm, unit: 'km' },
            {
              label: 'Train length',
              value: Math.round(spread * 2),
              unit: 'km',
            },
          ],
          headline: {
            value: pts.length,
            unit: '',
            label: 'satellites in the train',
          },
          updatedAt: now,
          source: 'CelesTrak TLE · SGP4',
          severity: 1.8,
        },
        {
          type: 'orbit',
          sats: pts.slice(0, 60).map((p, i) => ({
            line1: p.e.line1,
            line2: p.e.line2,
            main: i === Math.floor(pts.length / 2),
          })),
          at: now,
          train: true,
        },
      );
    }
    // No train in formation right now: the constellation over the night side.
    const sun = subsolarPoint(now);
    const center =
      observer && Number.isFinite(observer.lat)
        ? { lat: observer.lat, lon: observer.lon }
        : { lat: 40, lon: ((sun.lon + 180 - 25 + 540) % 360) - 180 };
    const sats = [];
    let overhead = 0;
    for (const e of entries) {
      try {
        const p = satPosition(twoline2satrec(e.line1, e.line2), now);
        if (!p) continue;
        sats.push(e);
        if (haversineKm(center.lat, center.lon, p.lat, p.lon) < 2000)
          overhead++;
      } catch {
        /* skip */
      }
    }
    if (!sats.length) return null;
    const where = observer ? 'you' : describePlace(center.lat, center.lon);
    return card(
      {
        id: 'starlink-shell',
        kind: 'starlink',
        family: 'Orbit',
        band: 'orbit',
        archetype: 'number',
        telemetry: `ORBIT · STARLINK · ${fmtInt(sats.length)} SATS · ${overhead} WITHIN 2,000 KM`,
        title: `${fmtInt(sats.length)} Starlink satellites in orbit`,
        subtitle: `${overhead} within 2,000 km of ${where} right now`,
        place: observer ? 'Over you' : describePlace(center.lat, center.lon),
        lon: center.lon,
        lat: center.lat,
        radiusKm: 3000,
        spanKm: 8000,
        camera: { height: 9_000_000, heading: 0, pitch: -90 },
        layers: ['starlink'],
        metrics: [
          { label: 'In orbit', value: sats.length, unit: '' },
          { label: 'Within 2,000 km', value: overhead, unit: '' },
        ],
        headline: {
          value: fmtInt(sats.length),
          unit: '',
          label: 'Starlink satellites',
        },
        updatedAt: now,
        source: 'CelesTrak TLE · SGP4',
        severity: 1.4,
      },
      {
        type: 'constellation',
        sats: sats.map((e) => ({ line1: e.line1, line2: e.line2 })),
        at: now,
      },
    );
  });

  /* ── Next launch ── */
  add('launch', () => {
    const next = launches?.records.find((r) => r.net > now - HOUR);
    if (!next) throw new Error('launch feeds unavailable');
    const tMinus = next.net - now;
    const hh = Math.floor(Math.abs(tMinus) / HOUR);
    const mm = Math.floor((Math.abs(tMinus) % HOUR) / 60_000);
    const vehicle = next.name.split('|')[0].trim();
    return card(
      {
        id: `launch-${next.id}`,
        kind: 'launch',
        family: 'Orbit',
        band: 'orbit',
        archetype: 'sensor',
        telemetry: [
          'ORBIT',
          `T${tMinus >= 0 ? '−' : '+'}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
          up(vehicle).slice(0, 18),
          next.orbit ? up(next.orbit) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        title: next.name,
        subtitle: `${next.provider || 'Launch'} · ${tMinus >= 0 ? `T−${relTime(next.net, now).replace('in ', '')}` : `launched ${relTime(next.net, now)}`} · ${next.pad}`,
        place: next.location || next.pad,
        lon: next.lon,
        lat: next.lat,
        radiusKm: 120,
        spanKm: 420,
        camera: { height: 30_000, heading: 0, pitch: -40 },
        layers: ['launches', 'iss'],
        time: { start: next.net - HOUR, end: next.net + HOUR },
        metrics: [
          {
            label: 'NET',
            value: new Date(next.net).toISOString(),
            unit: 'utc',
          },
          ...(next.orbit
            ? [{ label: 'Orbit', value: next.orbit, unit: '' }]
            : []),
          ...(next.status
            ? [{ label: 'Status', value: next.status, unit: '' }]
            : []),
        ],
        updatedAt: feeds.launches.updatedAt,
        source: `${launches.source} · ascent azimuth indicative`,
        severity: tMinus < 2 * DAY ? 3 : 1,
        live: launches.upcomingOk,
      },
      {
        type: 'launch',
        pad: { lon: next.lon, lat: next.lat },
        orbit: next.orbit || '',
      },
    );
  });

  /* ── GNSS interference ── */
  add('gnss', async () => {
    const snaps = await Promise.allSettled(
      GNSS_ANCHORS.map((a) =>
        withBudget(gnssIntegrity.get(`${a.lat}:${a.lon}`, a), 12_000).then(
          (s) => ({ a, s }),
        ),
      ),
    );
    const ok = snaps
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
    if (!ok.length)
      throw new Error(
        snaps[0]?.reason?.message || 'GNSS integrity unavailable',
      );
    let best = null;
    for (const { a, s } of ok) {
      if (s.rows.length < 8) continue;
      const frac = s.degraded / s.rows.length;
      const score = s.degraded * frac;
      if (!best || score > best.score) best = { a, s, frac, score };
    }
    if (!best || best.s.degraded < 4 || best.frac < 0.15) return null;
    const pct = Math.round(best.frac * 100);
    const bad = best.s.cells.filter((c) => c.level !== 'low');
    const hot = bad.length
      ? bad.reduce((x, y) => (y.percent > x.percent ? y : x))
      : null;
    const c = hot || best.a;
    return card(
      {
        id: `gnss-${best.a.id}`,
        kind: 'gnss',
        family: 'Infra',
        band: 'sky',
        archetype: 'number',
        telemetry: `SKY · GNSS · ${pct}% DEGRADED · ${best.s.rows.length} AIRCRAFT · 250 NM`,
        title: `GNSS interference · ${best.a.name}`,
        subtitle: `${best.s.degraded} of ${best.s.rows.length} aircraft report degraded GPS integrity (low NIC/NACp)`,
        place: best.a.name,
        lon: c.lon,
        lat: c.lat,
        radiusKm: 350,
        spanKm: 900,
        camera: { height: 1_100_000, heading: 0, pitch: -80 },
        layers: ['gnss', 'flights'],
        metrics: [
          { label: 'Degraded aircraft', value: best.s.degraded, unit: '' },
          { label: 'Sampled aircraft', value: best.s.rows.length, unit: '' },
          { label: 'Anomalous cells', value: bad.length, unit: '' },
        ],
        headline: {
          value: pct,
          unit: '%',
          label: 'aircraft with degraded GNSS',
        },
        updatedAt: best.s.fetchedAt,
        source:
          'adsb.lol NIC/NACp · gpsjam.org bands (a proxy for jamming, not proof)',
        severity: 2 + Math.min(3, pct / 15),
      },
      { type: 'gnss', rows: best.s.rows, cells: best.s.cells, anchor: best.a },
    );
  });

  /* ── Transit at (or nearest to) rush hour ── */
  add('transit', async () => {
    if (!transitCatalog) throw new Error('transit catalog unavailable');
    const TZ = {
      mbta: 'America/New_York',
      'capmetro-austin': 'America/Chicago',
      'metrotransit-msp': 'America/Chicago',
      'hsl-helsinki': 'Europe/Helsinki',
      'ovapi-nl': 'Europe/Amsterdam',
      'entur-norway': 'Europe/Oslo',
      'translink-seq': 'Australia/Brisbane',
      'ttc-toronto': 'America/Toronto',
    };
    const localHour = (tz) => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(new Date(now));
      const h = Number(parts.find((p) => p.type === 'hour')?.value);
      const m = Number(parts.find((p) => p.type === 'minute')?.value);
      return (h % 24) + m / 60;
    };
    const ranked = transitCatalog.feeds
      .filter((f) => TZ[f.id])
      .map((f) => {
        const h = localHour(TZ[f.id]);
        return { f, h, gap: Math.min(Math.abs(h - 8.25), Math.abs(h - 17.5)) };
      })
      .sort((a, b) => a.gap - b.gap);
    for (const { f, h, gap } of ranked.slice(0, 3)) {
      const snap = await withBudget(transitVehicles.get(f.id), 14_000).catch(
        () => null,
      );
      if (!snap || snap.vehicles.length < 10) continue;
      const moving = snap.vehicles.filter((v) => (v.speedMps ?? 0) > 1).length;
      const rush = gap <= 1.25;
      const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
      const city = f.region.split(',')[0];
      const center = densestCell(snap.vehicles, 0.15) || {
        lat: f.center.lat,
        lon: f.center.lon,
      };
      return card(
        {
          id: `transit-${f.id}`,
          kind: 'transit',
          family: 'Ground',
          band: 'ground',
          archetype: 'sensor',
          telemetry: `GROUND · GTFS-RT · ${snap.vehicles.length} VEHICLES · ${clock} LOCAL`,
          title: `${rush ? 'Rush hour' : 'Transit now'} · ${city}`,
          subtitle: `${snap.vehicles.length} ${f.name} vehicles reporting · ${moving} moving · ${clock} local time`,
          place: f.region,
          lon: center.lon,
          lat: center.lat,
          radiusKm: 10,
          spanKm: 24,
          camera: { height: 18_000, heading: 0, pitch: -50 },
          layers: ['transit'],
          metrics: [
            { label: 'Vehicles', value: snap.vehicles.length, unit: '' },
            { label: 'Moving', value: moving, unit: '' },
          ],
          headline: {
            value: snap.vehicles.length,
            unit: '',
            label: 'vehicles live',
          },
          updatedAt: snap.fetchedAt,
          source: `${f.name} GTFS-realtime · ${f.attribution}`,
          severity: rush ? 1.6 : 0.8,
        },
        { type: 'transit', vehicles: snap.vehicles },
      );
    }
    return null;
  });

  /* ── Eyes: live public cameras at famous busy places ── */
  add('eyes', async () => {
    if (!cctv?.records.length) throw new Error('camera catalog unavailable');
    const found = [];
    for (const wish of EYE_WISHLIST) {
      const cam = cctv.records.find((c) => wish.re.test(c.name));
      if (cam) found.push({ wish, cam });
    }
    found.sort(
      (a, b) =>
        (sunElevation(b.cam.lat, b.cam.lon, now) > -6) -
        (sunElevation(a.cam.lat, a.cam.lon, now) > -6),
    );
    const checked = await Promise.allSettled(
      found.slice(0, 11).map(({ wish, cam }) =>
        withBudget(verifyFrame(cam), 12_000).then((url) => ({
          wish,
          cam,
          url,
        })),
      ),
    );
    const live = checked
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value)
      .slice(0, 9);
    return live.map(({ wish, cam, url }, i) => {
      const daylight = sunElevation(cam.lat, cam.lon, now) > -6;
      return card(
        {
          id: `eye-${cam.id}`,
          kind: 'camera',
          family: 'Eyes',
          band: 'ground',
          archetype: 'eye',
          telemetry: `GROUND · CAM ${camCode(cam.id)} · ${up(wish.title).slice(0, 22)} · ${hhmmss(EYE_FRAMES.get(cam.id)?.at || now)}`,
          title: wish.title,
          subtitle: `${wish.place} · ${cam.provider}${daylight ? '' : ' · night'} · looking ${compass(cam.heading)}`,
          place: wish.place,
          lon: cam.lon,
          lat: cam.lat,
          radiusKm: 1,
          spanKm: 1.5,
          camera: { height: 600, heading: cam.heading, pitch: -25 },
          layers: ['cctv'],
          media: {
            kind: 'image',
            url,
            refreshMs: 30_000,
            cameraId: cam.id,
            headingDeg: cam.heading,
            provider: cam.provider,
            city: cam.city,
          },
          metrics: [
            { label: 'Looking', value: compass(cam.heading), unit: '' },
          ],
          updatedAt: EYE_FRAMES.get(cam.id)?.at || now,
          source: `${cam.provider} public camera`,
          severity: 1.4 - i * 0.05 + (daylight ? 0.3 : 0),
        },
        { type: 'eye', cameraId: cam.id },
      );
    });
  });

  /* ── Worst air quality (modelled) ── */
  add('air-quality', () => {
    if (!airQuality?.records.length)
      throw new Error('air-quality feed unavailable');
    const worst = airQuality.records.reduce((a, b) => (b.aqi > a.aqi ? b : a));
    if (worst.aqi < 80) return null;
    const label =
      worst.aqi > 200
        ? 'Very unhealthy air'
        : worst.aqi > 150
          ? 'Unhealthy air'
          : 'Unhealthy air for sensitive groups';
    return card(
      {
        id: `aq-${worst.name.toLowerCase().replace(/\W+/g, '-')}`,
        kind: 'air-quality',
        family: 'Hazards',
        band: 'ground',
        archetype: 'number',
        telemetry: `GROUND · PM2.5 ${Math.round(worst.pm25)} µG/M³ · AQI ${Math.round(worst.aqi)} · CAMS`,
        title: `${label} · ${worst.name}`,
        subtitle: `PM2.5 AQI ${Math.round(worst.aqi)} · worst of ${airQuality.records.length} major cities (model, not a monitor)`,
        place: worst.name,
        lon: worst.lon,
        lat: worst.lat,
        radiusKm: 30,
        spanKm: 700,
        camera: { height: 60_000, heading: 0, pitch: -45 },
        layers: ['air-quality', 'fires', 'wind'],
        metrics: [
          { label: 'PM2.5 AQI', value: Math.round(worst.aqi), unit: '' },
          { label: 'PM2.5', value: Math.round(worst.pm25), unit: 'µg/m³' },
        ],
        headline: {
          value: Math.round(worst.aqi),
          unit: 'AQI',
          label: 'US air quality index',
        },
        series: worst.series,
        seriesLabel: 'PM2.5 (µg/m³), last 24 h',
        updatedAt: worst.t,
        source: airQuality.source,
        severity: 1.5 + (worst.aqi - 100) / 60,
      },
      { type: 'aq', aqi: worst.aqi },
    );
  });

  /* ── Volcano (most recently updated open EONET event) ── */
  add('volcano', () => {
    const v = eonet?.volcanoes?.slice().sort((a, b) => b.t - a.t)[0];
    if (!v) return null;
    return card(
      {
        id: `volcano-${v.id}`,
        kind: 'volcano',
        family: 'Hazards',
        band: 'ground',
        archetype: 'sensor',
        telemetry: `GROUND · VOLCANO · ${fmtLatLon(v.lat, v.lon).replace(/°/g, '')} · EONET`,
        title: v.title.replace(/,.*$/, ''),
        subtitle: `Open eruption event since ${new Date(v.firstT).toISOString().slice(0, 10)} · ${describePlace(v.lat, v.lon)}`,
        place:
          v.title.split(',').slice(1).join(',').trim() ||
          regionOf(v.lat, v.lon),
        lon: v.lon,
        lat: v.lat,
        radiusKm: 12,
        spanKm: 26,
        camera: { height: 25_000, heading: 0, pitch: -40 },
        layers: ['volcanoes'],
        updatedAt: v.t,
        source: 'NASA EONET',
        live: false,
        severity: 1.3,
      },
      { type: 'volcano' },
    );
  });

  /* ── Ships at chokepoints (only when AIS is configured) ── */
  add('chokepoint', async () => {
    let vessels;
    try {
      vessels = await withBudget(feeds.vessels.get(), 6000);
    } catch (error) {
      throw new Error(
        error?.keyRequired
          ? 'AIS not configured on this server (AISSTREAM_API_KEY)'
          : 'AIS unavailable',
      );
    }
    const POINTS = [
      ['Strait of Hormuz', 56.45, 26.55],
      ['Singapore Strait', 103.85, 1.22],
      ['Suez Canal', 32.35, 30.6],
      ['Panama Canal', -79.82, 9.2],
      ['Strait of Gibraltar', -5.6, 35.95],
      ['Bab-el-Mandeb', 43.4, 12.6],
    ];
    let best = null;
    for (const [name, lon, lat] of POINTS) {
      const near = vessels.records.filter(
        (v) => haversineKm(lat, lon, v.lat, v.lon) < 60,
      );
      if (!best || near.length > best.near.length)
        best = { name, lon, lat, near };
    }
    if (!best?.near.length) return null;
    const slow = best.near.filter((v) => (v.speed ?? 0) < 0.5).length;
    return card(
      {
        id: `choke-${best.name.toLowerCase().replace(/\W+/g, '-')}`,
        kind: 'vessels',
        family: 'Sea',
        band: 'ground',
        archetype: 'sensor',
        telemetry: `GROUND · AIS · ${best.near.length} VESSELS · ${slow} AT ANCHOR`,
        title: best.name,
        subtitle: `${best.near.length} vessels within 60 km · ${slow} stopped or at anchor`,
        place: best.name,
        lon: best.lon,
        lat: best.lat,
        radiusKm: 40,
        spanKm: 120,
        camera: { height: 120_000, heading: 0, pitch: -55 },
        layers: ['vessels', 'tankers'],
        metrics: [
          { label: 'Vessels', value: best.near.length, unit: '' },
          { label: 'Stopped', value: slow, unit: '' },
        ],
        updatedAt: feeds.vessels.updatedAt,
        source: vessels.source,
        severity: 1.5,
      },
      {
        type: 'vessels',
        vessels: best.near.map((v) => ({
          lon: v.lon,
          lat: v.lat,
          heading: v.heading,
          speed: v.speed,
        })),
      },
    );
  });

  /* ── Bundled reconstruction: always present ── */
  add('bhote-koshi', () => {
    const ev = flood?.event;
    const vp = ev?.viewpoints?.corridor;
    const lon = vp?.lon ?? 85.3548;
    const lat = vp?.lat ?? 28.207;
    const observed = ev?.observedDate || '2026-08-26';
    return card(
      {
        id: 'bhote-koshi-2026',
        kind: 'reconstruction',
        family: 'Hazards',
        section: 'reconstruction',
        band: 'ground',
        archetype: 'sensor',
        telemetry: `GROUND · RECON · ${corridorKm(ev)} KM CORRIDOR · ${observed.replace(/-/g, '')}`,
        title: ev?.title || 'Bhote Koshi Outburst Flood',
        subtitle: `Reconstruction · ${ev?.evidenceSpine?.length ?? 0} evidence beats · 2021 vs 2026 imagery`,
        place: 'Rasuwa, Nepal',
        lon,
        lat,
        radiusKm: 9,
        spanKm: 16,
        camera: {
          height: vp
            ? Math.round(
                (vp.rangeM || 8600) *
                  Math.sin(Math.abs(vp.pitchDeg || 39) * (Math.PI / 180)),
              )
            : 5400,
          heading: vp?.headingDeg ?? 344,
          pitch: vp?.pitchDeg ?? -39,
          targetHeight: vp?.targetElevationM ?? 1536,
        },
        layers: ['floods'],
        time: {
          start: Date.parse(`${observed}T00:00:00Z`),
          end: Date.parse(`${observed}T12:00:00Z`),
          at: Date.parse(`${observed}T05:30:00Z`),
        },
        metrics: [
          { label: 'Corridor', value: corridorKm(ev), unit: 'km' },
          {
            label: 'Witness anchors',
            value: ev?.witnessAnchors?.length ?? 0,
            unit: '',
          },
          {
            label: 'Field reports',
            value: ev?.fieldReports?.length ?? 0,
            unit: '',
          },
        ],
        updatedAt: Date.parse(observed),
        live: false,
        source: 'GeoPera · Vantor Open Data · bundled event pack',
        severity: 4,
      },
      {
        type: 'flood',
        path: flood?.path || [],
        corridor: flood?.corridor || null,
        anchors: (ev?.witnessAnchors || []).map((a) => ({
          lon: a.lon,
          lat: a.lat,
        })),
      },
    );
  });

  await Promise.allSettled(tasks);
  buildSituations.lastOmitted = omitted;
  buildSituations.lastTimings = timings;
  return interleave(out);
}

/**
 * Severity first, then avoid putting two cards of the same band or archetype
 * side by side when another card is close behind (DESIGN.md §11.2).
 */
function interleave(cards) {
  const rest = cards.slice().sort((a, b) => b.severity - a.severity);
  const out = [];
  while (rest.length) {
    const prev = out.at(-1);
    let k = 0;
    if (prev) {
      const look = Math.min(rest.length, 6);
      const differs = (c) =>
        c.band !== prev.band && c.archetype !== prev.archetype;
      const half = (c) =>
        c.band !== prev.band || c.archetype !== prev.archetype;
      k = rest.slice(0, look).findIndex(differs);
      if (k < 0) k = rest.slice(0, look).findIndex(half);
      if (k < 0) k = 0;
    }
    out.push(rest.splice(k, 1)[0]);
  }
  return out;
}
