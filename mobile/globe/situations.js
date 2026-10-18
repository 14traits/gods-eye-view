/**
 * Situation cards for the Now feed, built from the same live feeds the layers
 * use. Every card carries real imagery of its place (keyless Esri export),
 * a target-centred camera and the layers worth turning on. A feed that fails
 * drops only its own cards: the bundled Bhote Koshi reconstruction and the
 * evergreen places always resolve, so the feed is never empty.
 */
import { twoline2satrec } from 'satellite.js';
import { findNextIssPass } from '../../src/data/issPass.js';
import { satPosition } from './layers/orbit.js';
import { AIRPORTS, EVERGREEN, FORT_NOVOSEL } from './places.js';
import { densestCell, haversineKm, relTime, thumbnailAround } from './geo.js';

const DAY = 86_400_000;
const FEED_BUDGET_MS = 9_000;
// OpenSky's global snapshot routinely takes 10-15 s through the proxy.
const FLIGHTS_BUDGET_MS = 16_000;

const withBudget = (promise, ms = FEED_BUDGET_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('feed budget exceeded')), ms),
    ),
  ]);

function corridorKm(ev) {
  const c = ev?.reconstruction?.corridor;
  if (!c?.length) return 22;
  return Math.round(Math.abs(c.at(-1).chainageM - c[0].chainageM) / 100) / 10;
}

function fmtLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

function card(base) {
  const radiusKm = base.radiusKm ?? 60;
  const camHeight = base.camera?.height ?? radiusKm * 2500;
  return {
    id: base.id,
    kind: base.kind,
    family: base.family,
    section: base.section || 'now',
    title: base.title,
    subtitle: base.subtitle || '',
    place: base.place || fmtLatLon(base.lat, base.lon),
    lon: base.lon,
    lat: base.lat,
    camera: {
      lon: base.lon,
      lat: base.lat,
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
    thumbnail: base.thumbnail || thumbnailAround(base.lon, base.lat, radiusKm),
    live: base.live ?? true,
    updatedAt: base.updatedAt ?? Date.now(),
    source: base.source || '',
    severity: base.severity ?? 0,
  };
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

/** Tropical cyclone basin for a position (for storms without an NHC basin). */
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

export async function buildSituations(engine, { observer } = {}) {
  const { feeds } = engine;
  const now = Date.now();
  const get = (feed, opts, ms) => withBudget(feed.get(opts), ms);
  const [
    quakes,
    cyclones,
    fires,
    military,
    flights,
    stations,
    launches,
    flood,
  ] = await Promise.allSettled([
    get(feeds.quakes),
    get(feeds.cyclones),
    get(feeds.fires),
    get(feeds.military, { maxAgeMs: 60_000 }),
    get(feeds.flights, { maxAgeMs: 60_000 }, FLIGHTS_BUDGET_MS),
    get(feeds.stations),
    get(feeds.launches),
    get(feeds.flood),
  ]);
  const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
  const out = [];
  const tryAdd = (fn) => {
    try {
      const c = fn();
      if (Array.isArray(c)) out.push(...c);
      else if (c) out.push(c);
    } catch (error) {
      console.warn('[globe:situations]', error);
    }
  };

  // Largest quake in the past 24 h.
  tryAdd(() => {
    const d = ok(quakes);
    if (!d) return null;
    const day = d.records.filter((q) => q.time && now - q.time < DAY);
    if (!day.length) return null;
    const q = day.reduce((a, b) => (b.mag > a.mag ? b : a));
    return card({
      id: `quake-${q.stableId}`,
      kind: 'earthquake',
      family: 'Hazards',
      title: `M${q.mag.toFixed(1)} earthquake`,
      subtitle: `Largest in 24 h · ${relTime(q.time, now)}`,
      place: q.place || fmtLatLon(q.lat, q.lon),
      lon: q.lon,
      lat: q.lat,
      radiusKm: 120,
      camera: { height: 450_000, heading: 0, pitch: -65 },
      layers: ['earthquakes'],
      time: { start: q.time, end: now },
      metrics: [
        { label: 'Magnitude', value: Number(q.mag.toFixed(1)), unit: 'M' },
        { label: 'Depth', value: Math.round(q.depthKm ?? 0), unit: 'km' },
        { label: 'M2.5+ in 24 h', value: day.length, unit: '' },
      ],
      updatedAt: feeds.quakes.updatedAt,
      source: 'USGS',
      severity: q.mag,
    });
  });

  // Active tropical cyclones.
  tryAdd(() => {
    const d = ok(cyclones);
    if (!d) return null;
    return d.records.slice(0, 4).map((s) => {
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
      return card({
        id: `cyclone-${s.id}`,
        kind: 'cyclone',
        family: 'Hazards',
        title: `${label} ${s.name}`,
        subtitle: [
          kmh ? `${kmh} km/h` : null,
          s.pressureHpa ? `${s.pressureHpa} hPa` : null,
          s.forecast?.length ? `${lastTau} h forecast track` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        place: `${{ EP: 'Eastern Pacific', AL: 'Atlantic', CP: 'Central Pacific' }[s.basin] || basinOf(s.lat, s.lon)} basin`,
        lon: s.lon,
        lat: s.lat,
        radiusKm: 700,
        camera: { height: 2_600_000, heading: 0, pitch: -75 },
        layers: ['cyclones'],
        time: { start: s.t, end: s.t + lastTau * 3_600_000 },
        metrics: [
          ...(kmh ? [{ label: 'Wind', value: kmh, unit: 'km/h' }] : []),
          ...(s.pressureHpa
            ? [{ label: 'Pressure', value: s.pressureHpa, unit: 'hPa' }]
            : []),
          ...(s.movement?.speedKt
            ? [
                {
                  label: 'Moving',
                  value: Math.round(s.movement.speedKt * 1.852),
                  unit: 'km/h',
                },
              ]
            : []),
        ],
        updatedAt: feeds.cyclones.updatedAt,
        source: s.source,
        severity: 5 + (s.windKt || 0) / 40,
      });
    });
  });

  // Fire cluster: Europe first if it has a real cluster, else the densest.
  tryAdd(() => {
    const d = ok(fires);
    if (!d?.records.length) return null;
    const hotspots = d.mode === 'hotspots';
    const recent = hotspots
      ? d.records.filter((f) => !f.t || now - f.t < DAY)
      : d.records;
    const cell = hotspots ? 1 : 4;
    const europe = densestCell(
      recent.filter((f) => regionOf(f.lat, f.lon) === 'Europe'),
      cell,
    );
    const best =
      europe && europe.count >= (hotspots ? 20 : 2)
        ? europe
        : densestCell(recent, cell);
    if (!best) return null;
    const region = regionOf(best.lat, best.lon);
    const sample = best.items.find(
      (f) => f.title && f.title !== 'Fire hotspot',
    );
    return card({
      id: `fires-${best.lat.toFixed(1)}-${best.lon.toFixed(1)}`,
      kind: 'fires',
      family: 'Hazards',
      title: `Fire cluster · ${region}`,
      subtitle: hotspots
        ? `${best.count} hotspots in 24 h`
        : sample
          ? sample.title
          : `${best.count} active wildfire events`,
      place: sample?.title?.split(',').slice(1).join(',').trim() || region,
      lon: best.lon,
      lat: best.lat,
      radiusKm: hotspots ? 90 : 220,
      camera: { height: hotspots ? 260_000 : 700_000, heading: 0, pitch: -60 },
      layers: ['fires'],
      metrics: [
        {
          label: hotspots ? 'Hotspots' : 'Events',
          value: best.count,
          unit: '',
        },
        { label: 'Worldwide', value: recent.length, unit: '' },
      ],
      updatedAt: feeds.fires.updatedAt,
      source: d.source,
      severity: 3 + Math.min(2, best.count / 50),
    });
  });

  // Military air activity hotspot.
  tryAdd(() => {
    const d = ok(military);
    if (!d?.records.length) return null;
    const airborne = d.records.filter((r) => !r.onGround);
    const best = densestCell(airborne, 6);
    if (!best || best.count < 2) return null;
    const types = [
      ...new Set(best.items.map((r) => r.type).filter(Boolean)),
    ].slice(0, 3);
    return card({
      id: `military-${Math.round(best.lat)}-${Math.round(best.lon)}`,
      kind: 'military',
      family: 'Sky',
      title: `Military air activity · ${regionOf(best.lat, best.lon)}`,
      subtitle: `${best.count} military aircraft${types.length ? ` · ${types.join(', ')}` : ''}`,
      lon: best.lon,
      lat: best.lat,
      radiusKm: 260,
      camera: { height: 900_000, heading: 0, pitch: -70 },
      layers: ['military'],
      metrics: [
        { label: 'In area', value: best.count, unit: '' },
        { label: 'Tracked worldwide', value: airborne.length, unit: '' },
      ],
      updatedAt: feeds.military.updatedAt,
      source: 'adsb.lol',
      severity: 2.5,
    });
  });

  // ISS now (+ next pass when we know where the viewer is).
  tryAdd(() => {
    const d = ok(stations);
    const iss = d?.entries.find((e) => e.line1.slice(2, 7).trim() === '25544');
    if (!iss) return null;
    const satrec = twoline2satrec(iss.line1, iss.line2);
    const p = satPosition(satrec, now);
    if (!p) return null;
    const metrics = [
      { label: 'Altitude', value: Math.round(p.altM / 1000), unit: 'km' },
      {
        label: 'Speed',
        value: Math.round((p.speedMps * 3.6) / 100) * 100,
        unit: 'km/h',
      },
    ];
    let subtitle = `Over ${regionOf(p.lat, p.lon)} · ${fmtLatLon(p.lat, p.lon)}`;
    if (
      observer &&
      Number.isFinite(observer.lat) &&
      Number.isFinite(observer.lon)
    ) {
      const pass = findNextIssPass({
        satrec,
        latDeg: observer.lat,
        lonDeg: observer.lon,
        fromMs: now,
        horizonHours: 24,
      });
      if (pass) {
        subtitle = `Next pass over you ${relTime(pass.riseMs, now)} · max ${Math.round(pass.maxElevDeg)}°`;
        metrics.push({
          label: 'Next pass',
          value: new Date(pass.riseMs).toISOString(),
          unit: 'utc',
        });
      }
    }
    return card({
      id: 'iss-now',
      kind: 'iss',
      family: 'Orbit',
      title: 'ISS now',
      subtitle,
      place: regionOf(p.lat, p.lon),
      lon: p.lon,
      lat: p.lat,
      radiusKm: 900,
      camera: { height: 5_500_000, heading: 0, pitch: -90 },
      layers: ['iss', 'satellites'],
      metrics,
      updatedAt: now,
      source: 'CelesTrak TLE · SGP4',
      severity: 2,
    });
  });

  // Busiest airport airspace now, and the Fort Novosel helicopter school.
  tryAdd(() => {
    const d = ok(flights) || { records: [], source: 'OpenSky Network' };
    const flightsLive = d.records.length > 0;
    const cards = [];
    let best = null;
    for (const ap of AIRPORTS) {
      let n = 0;
      for (const r of d.records) {
        if (Math.abs(r.lat - ap.lat) > 0.6 || Math.abs(r.lon - ap.lon) > 0.9)
          continue;
        if (r.altM > 4000) continue;
        if (haversineKm(ap.lat, ap.lon, r.lat, r.lon) <= 50) n++;
      }
      if (!best || n > best.n) best = { ...ap, n };
    }
    if (flightsLive && best && best.n > 0)
      cards.push(
        card({
          id: `airport-${best.code}`,
          kind: 'airport',
          family: 'Sky',
          title: `Busiest airspace · ${best.code}`,
          subtitle: `${best.n} aircraft below 4 km within 50 km of ${best.name}`,
          place: best.name,
          lon: best.lon,
          lat: best.lat,
          radiusKm: 40,
          camera: { height: 60_000, heading: 20, pitch: -45 },
          layers: ['flights', 'ga', 'helicopters'],
          metrics: [
            { label: 'Low aircraft', value: best.n, unit: '' },
            {
              label: 'Airborne worldwide',
              value: d.records.filter((r) => !r.onGround).length,
              unit: '',
            },
          ],
          updatedAt: feeds.flights.updatedAt,
          source: d.source,
          severity: 1.5,
        }),
      );
    const near = d.records.filter(
      (r) =>
        haversineKm(FORT_NOVOSEL.lat, FORT_NOVOSEL.lon, r.lat, r.lon) <=
        FORT_NOVOSEL.radiusKm,
    );
    const mil = ok(military)?.records || [];
    const helis = [
      ...near.filter((r) => r.helicopter),
      ...mil.filter(
        (r) =>
          r.helicopter &&
          haversineKm(FORT_NOVOSEL.lat, FORT_NOVOSEL.lon, r.lat, r.lon) <=
            FORT_NOVOSEL.radiusKm,
      ),
    ];
    const lowSlow = near.filter(
      (r) =>
        !r.onGround && r.altM < 900 && (r.speed ?? 99) < 60 && !r.helicopter,
    );
    cards.push(
      card({
        id: 'fort-novosel',
        kind: 'helicopters',
        family: 'Sky',
        section: 'always',
        title: 'Helicopter school circuits',
        subtitle: !flightsLive
          ? 'US Army Aviation Center of Excellence · live traffic unavailable'
          : helis.length || lowSlow.length
            ? `${helis.length} rotorcraft · ${lowSlow.length} low & slow contacts over Fort Novosel`
            : 'Quiet right now · US Army Aviation Center of Excellence',
        place: 'Fort Novosel, Alabama',
        lon: FORT_NOVOSEL.lon,
        lat: FORT_NOVOSEL.lat,
        radiusKm: 35,
        camera: { height: 45_000, heading: 340, pitch: -45 },
        layers: ['helicopters', 'military', 'ga'],
        metrics: [
          { label: 'Rotorcraft', value: helis.length, unit: '' },
          { label: 'Low & slow', value: lowSlow.length, unit: '' },
          { label: 'All aircraft', value: near.length, unit: '' },
        ],
        updatedAt: feeds.flights.updatedAt || now,
        source: d.source,
        live: flightsLive,
        severity: helis.length ? 1.2 : 0.2,
      }),
    );
    return cards;
  });

  // Next launch.
  tryAdd(() => {
    const d = ok(launches);
    const next = d?.records.find((r) => r.net > now - 3600_000);
    if (!next) return null;
    return card({
      id: `launch-${next.id}`,
      kind: 'launch',
      family: 'Orbit',
      title: next.name,
      subtitle: `${next.provider || 'Launch'} · T−${relTime(next.net, now).replace('in ', '')}`,
      place: next.location || next.pad,
      lon: next.lon,
      lat: next.lat,
      radiusKm: 25,
      camera: { height: 30_000, heading: 0, pitch: -40 },
      layers: ['launches', 'iss'],
      time: { start: next.net - 3600_000, end: next.net + 3600_000 },
      metrics: [
        { label: 'NET', value: new Date(next.net).toISOString(), unit: 'utc' },
        ...(next.orbit
          ? [{ label: 'Orbit', value: next.orbit, unit: '' }]
          : []),
        ...(next.status
          ? [{ label: 'Status', value: next.status, unit: '' }]
          : []),
      ],
      updatedAt: feeds.launches.updatedAt,
      source: d.source,
      severity: next.net - now < 2 * DAY ? 3 : 1,
      live: d.upcomingOk,
    });
  });

  // Bundled reconstruction: always present.
  tryAdd(() => {
    const ev = ok(flood)?.event;
    const vp = ev?.viewpoints?.corridor;
    const lon = vp?.lon ?? 85.3548;
    const lat = vp?.lat ?? 28.207;
    const observed = ev?.observedDate || '2026-08-26';
    return card({
      id: 'bhote-koshi-2026',
      kind: 'reconstruction',
      family: 'Hazards',
      section: 'reconstruction',
      title: ev?.title || 'Bhote Koshi Outburst Flood',
      subtitle: `Reconstruction · ${ev?.evidenceSpine?.length ?? 0} evidence beats · 2021 vs 2026 imagery`,
      place: 'Rasuwa, Nepal',
      lon,
      lat,
      radiusKm: 9,
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
    });
  });

  // Evergreen places.
  for (const e of EVERGREEN) {
    tryAdd(() =>
      card({
        ...e,
        id: `always-${e.id}`,
        kind: 'place',
        section: 'always',
        live: false,
        updatedAt: now,
        source: 'Bundled place',
        severity: 0,
      }),
    );
  }

  const live = out
    .filter((c) => c.section === 'now')
    .sort((a, b) => b.severity - a.severity);
  const rest = out.filter((c) => c.section !== 'now');
  return [...live, ...rest];
}
