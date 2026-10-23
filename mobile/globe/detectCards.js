/**
 * Situation cards for detections (circling, quake clusters). Same shape as
 * situations.js cards, each with a compositor scene of its real data.
 */
import { SCENES } from './situations.js';
import { thumbnailAround } from './geo.js';

const M_TO_FT = 3.28084;
const MPS_TO_KT = 1 / 0.514444;
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16) + 'Z';
const fmtLL = (lat, lon) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

export function circlingCard(det, recorder) {
  const helis = det.members.filter((m) => m.helicopter).length;
  const alts = det.members.map((m) => m.altM).sort((a, b) => a - b);
  const radii = det.members.map((m) => m.radiusM).sort((a, b) => a - b);
  const turns = det.members.reduce((n, m) => n + m.turns, 0);
  const lead = det.members[0];
  const ft = (m) => Math.round((m * M_TO_FT) / 50) * 50;
  const id = det.id;
  const card = {
    id,
    kind: 'circling',
    family: 'Sky',
    section: 'now',
    band: 'sky',
    archetype: 'track',
    telemetry: [
      'SKY',
      `${det.members.length} ${helis === det.members.length ? 'ROTOR' : 'AIRCRAFT'} ORBITING`,
      `R ${radii[0]}–${radii.at(-1)} M`,
      `${ft(alts[0]).toLocaleString('en-US')}–${ft(alts.at(-1)).toLocaleString('en-US')} FT`,
      lead?.callsign ? String(lead.callsign).toUpperCase() : null,
    ]
      .filter(Boolean)
      .join(' · '),
    title: det.title,
    subtitle: `${det.members.map((m) => m.callsign).join(', ')} · ${turns} orbits since ${hhmm(det.since)} · detected from ADS-B`,
    place: det.place,
    lon: det.lon,
    lat: det.lat,
    camera: {
      lon: det.lon,
      lat: det.lat,
      height: 2600,
      heading: 25,
      pitch: -32,
    },
    layers: ['helicopters', 'flights', 'ga', 'military'],
    time: { start: det.since, end: det.updatedAt },
    metrics: [
      { label: 'Aircraft', value: det.members.length, unit: '' },
      { label: 'Orbits', value: turns, unit: '' },
      {
        label: 'Radius',
        value: radii[Math.floor(radii.length / 2)],
        unit: 'm',
      },
      ...(lead?.speed
        ? [
            {
              label: 'Speed',
              value: Math.round(lead.speed * MPS_TO_KT),
              unit: 'kt',
            },
          ]
        : []),
    ],
    headline: det.single
      ? { value: turns, unit: '', label: 'orbits' }
      : {
          value: det.members.length,
          unit: '',
          label:
            helis === det.members.length
              ? 'helicopters circling'
              : 'aircraft circling',
        },
    thumbnail: thumbnailAround(det.lon, det.lat, 2),
    live: true,
    updatedAt: det.updatedAt,
    source:
      'Detected by God’s Eye from live ADS-B (OpenSky Network / adsb.lol, ODbL)',
    severity: det.single ? 4.5 : 6.5,
    momentId: `live-${det.id}`,
    members: det.members.map(({ key, layer, callsign, helicopter }) => ({
      key,
      layer,
      callsign,
      helicopter,
    })),
    entityIds: det.members.map((m) => `${m.layer || 'flights'}:${m.key}`),
    detected: true,
  };
  SCENES.set(id, {
    type: 'circling',
    lon: det.lon,
    lat: det.lat,
    spanKm: 3.2,
    band: 'sky',
    tracks: det.members.map((m) => {
      const pts = recorder
        .samples(m.key, det.updatedAt - 20 * 60_000, det.updatedAt)
        .map((p) => [p.lon, p.lat]);
      return { points: pts, helicopter: m.helicopter, heading: 0 };
    }),
  });
  void fmtLL;
  return card;
}

export function quakeClusterCard(c) {
  const id = c.id;
  const card = {
    id,
    kind: 'quake-cluster',
    family: 'Hazards',
    section: 'now',
    band: 'ground',
    archetype: 'number',
    telemetry: `GROUND · ${c.count} EVENTS · 24 H · MAX M${c.maxMag.toFixed(1)} · 50 KM`,
    title: c.title,
    subtitle: `Largest M${c.maxMag.toFixed(1)} · first ${hhmm(c.since)} · USGS`,
    place: c.members[0]?.place || fmtLL(c.lat, c.lon),
    lon: c.lon,
    lat: c.lat,
    camera: { lon: c.lon, lat: c.lat, height: 260_000, heading: 0, pitch: -55 },
    layers: ['earthquakes'],
    time: { start: c.since, end: c.updatedAt },
    metrics: [
      { label: 'Quakes', value: c.count, unit: '' },
      { label: 'Largest', value: c.maxMag.toFixed(1), unit: 'M' },
    ],
    headline: { value: c.count, unit: '', label: 'quakes in 24 h' },
    series: c.members
      .slice()
      .sort((a, b) => a.time - b.time)
      .map((m) => ({ t: m.time, v: m.mag })),
    seriesLabel: 'magnitude per event',
    thumbnail: thumbnailAround(c.lon, c.lat, 60),
    live: true,
    updatedAt: c.updatedAt,
    source: 'U.S. Geological Survey · cluster detected by God’s Eye',
    severity: 3 + Math.max(0, c.maxMag - 4),
    detected: true,
  };
  SCENES.set(id, {
    type: 'quake',
    lon: c.lon,
    lat: c.lat,
    spanKm: 160,
    band: 'ground',
    quake: { lon: c.lon, lat: c.lat, mag: c.maxMag },
    nearby: c.members.map((m) => ({ lon: m.lon, lat: m.lat, mag: m.mag })),
  });
  return card;
}
