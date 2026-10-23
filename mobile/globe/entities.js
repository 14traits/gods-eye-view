/**
 * Entities, dossiers, search and the link graph (DESIGN.md §12.1).
 *
 * Every object is an entity with a layer-qualified id (`flights:a1b2c3`,
 * `satellites:25544`, `earthquakes:us7000abcd`, `cctv:tfl-07450`,
 * `situation:circling-40.75_-73.99`, `moment:empire-state:news-7`,
 * `capture:empire-state:c1`, `place:midtown-manhattan`). A dossier carries
 * identity, live state, track, events, links and receipts (each source with
 * its fetch time and a SHA-256 of what was read).
 *
 * The line we don't cross: there are no person entities. Aircraft whose
 * owners opted out (PIA / LADD) or that have no public registration are not
 * named beyond what their transponder broadcasts.
 */
import { airlineFromCallsign } from './airlines.js';
import { twoline2satrec } from 'satellite.js';
import { findNextIssPass, lookAnglesAt } from '../../src/data/issPass.js';
import { satPosition } from './layers/orbit.js';
import { haversineKm } from './geo.js';
import { NEIGHBORHOODS, WORLD_PLACES, localPlace } from './gazetteer.js';
import { AIRPORTS } from './places.js';

const AIRCRAFT_LAYERS = new Set([
  'flights',
  'military',
  'helicopters',
  'ga',
  'squawk',
  'history',
  'aircraft',
  'helicopter',
  'emergency',
]);
const SAT_GROUPS = ['stations', 'visual', 'gps', 'starlink'];
const M_TO_FT = 3.28084;
const MPS_TO_KT = 1 / 0.514444;

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-');

function fnv(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** SHA-256 hex of a value's JSON (FNV fallback outside secure contexts). */
export async function receiptHash(value) {
  const text = JSON.stringify(value ?? null);
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text),
      );
      return (
        'sha256:' +
        [...new Uint8Array(buf)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      );
    }
  } catch {
    /* fall through */
  }
  return `fnv1a:${fnv(text)}`;
}

async function getJson(url, ms = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, json: await r.json() };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/** Parse an entity reference into { type, layer, key, … }. */
export function parseRef(ref) {
  if (ref == null) return null;
  if (typeof ref === 'object') {
    if (ref.entityId) return parseRef(ref.entityId);
    const layer = ref.meta?.entityLayer || ref.meta?.layer || ref.layer;
    if (ref.kind === 'pin' || layer === 'pins')
      return { type: 'pin', key: String(ref.id) };
    if (layer === 'moment' || ref.kind === 'track' || ref.kind === 'capture')
      return parseRef(String(ref.id));
    if (ref.meta?.norad)
      return { type: 'satellite', key: String(ref.meta.norad) };
    if (layer) return parseRef(`${layer}:${ref.id}`);
    if (ref.kind && ref.id != null) return parseRef(`${ref.kind}:${ref.id}`);
    return null;
  }
  const s = String(ref).trim();
  const i = s.indexOf(':');
  if (i < 0) return { type: 'unknown', key: s };
  const prefix = s.slice(0, i);
  const rest = s.slice(i + 1);
  if (AIRCRAFT_LAYERS.has(prefix))
    return {
      type: 'aircraft',
      layer: prefix === 'military' ? 'military' : 'flights',
      key: rest.toLowerCase(),
    };
  if (['satellites', 'iss', 'starlink', 'satellite', 'sat'].includes(prefix))
    return { type: 'satellite', key: rest.replace(/\D/g, '') || rest };
  if (['earthquakes', 'quake', 'earthquake'].includes(prefix))
    return { type: 'quake', key: rest };
  if (['cctv', 'camera', 'eye'].includes(prefix))
    return { type: 'camera', key: rest };
  if (['vessels', 'vessel', 'tankers'].includes(prefix))
    return { type: 'vessel', key: rest };
  if (prefix === 'situation') return { type: 'situation', key: rest };
  if (prefix === 'place') return { type: 'place', key: rest };
  if (prefix === 'capture') {
    const [mid, cid] = rest.split(':');
    return { type: 'capture', moment: mid, key: cid };
  }
  if (prefix === 'moment') {
    const [mid, tid] = rest.split(':');
    return tid
      ? { type: tid === 'subject' ? 'moment' : 'track', moment: mid, key: tid }
      : { type: 'moment', moment: mid, key: mid };
  }
  return { type: prefix, key: rest };
}

/**
 * @param {{ feeds, recorder, detector, situations: () => Map<string, object>,
 *   moments: { get(id): Promise<object|null>, cached(): object[] },
 *   viewer: () => ({lon,lat}|null), timeMs: () => number,
 *   trackOf: (key, layer) => Promise<object[]> }} env
 */
export function createEntities(env) {
  const { feeds, recorder } = env;
  const identityCache = new Map();
  const dossierCache = new Map();

  function liveAircraft(key) {
    const lists = [
      ['military', feeds.military.data],
      ['flights', feeds.flights.data],
      ...(feeds.regionalFlights.entries?.() || []).map((e) => [
        'flights',
        e.data,
      ]),
    ];
    for (const [layer, data] of lists) {
      const r = data?.records?.find((x) => x.id === key);
      if (r) return { r, layer, source: data.source || layer };
    }
    return null;
  }

  function allAircraft() {
    const byId = new Map();
    for (const e of feeds.regionalFlights.entries?.() || [])
      for (const r of e.data?.records || []) byId.set(r.id, r);
    for (const r of feeds.flights.data?.records || []) byId.set(r.id, r);
    for (const r of feeds.military.data?.records || []) byId.set(r.id, r);
    return [...byId.values()];
  }

  async function aircraftIdentity(key, callsign) {
    let hit = identityCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit;
    const [type, route] = await Promise.all([
      /^[0-9a-f]{6}$/.test(key)
        ? getJson(`/api/adsbdb/type/${key}`)
        : Promise.resolve({ ok: false }),
      callsign && /^[A-Z0-9]{2,8}$/.test(callsign.trim())
        ? getJson(`/api/adsbdb/route/${encodeURIComponent(callsign.trim())}`)
        : Promise.resolve({ ok: false }),
    ]);
    hit = {
      at: Date.now(),
      type: type.ok && type.json?.found ? type.json : null,
      route: route.ok && route.json?.found ? route.json : null,
      typeFetched: type.ok,
    };
    identityCache.set(key, hit);
    return hit;
  }

  function situationsWith(predicate) {
    const out = [];
    for (const s of env.situations().values()) if (predicate(s)) out.push(s);
    return out;
  }

  function aircraftLinks(key, r, here, identity) {
    const links = [];
    if (here) {
      const near = [];
      for (const o of allAircraft()) {
        if (o.id === key || o.onGround) continue;
        if (Math.abs(o.lat - here.lat) > 0.4) continue;
        const d = haversineKm(here.lat, here.lon, o.lat, o.lon);
        if (d <= 25) near.push({ o, d });
      }
      near.sort((a, b) => a.d - b.d);
      for (const { o, d } of near.slice(0, 8))
        links.push({
          id: `${o.military ? 'military' : 'flights'}:${o.id}`,
          kind: o.military
            ? 'military'
            : o.helicopter
              ? 'helicopter'
              : 'aircraft',
          title: o.callsign || o.id.toUpperCase(),
          relation: 'nearby',
          distanceKm: Math.round(d * 10) / 10,
        });
    }
    // Same operator in view: airline ICAO prefix of the callsign.
    const prefix = /^([A-Z]{3})\d/.exec(r?.callsign || '')?.[1];
    if (prefix) {
      const same = allAircraft()
        .filter((o) => o.id !== key && o.callsign?.startsWith(prefix))
        .slice(0, 6);
      for (const o of same)
        links.push({
          id: `flights:${o.id}`,
          kind: 'aircraft',
          title: o.callsign,
          relation: identity?.route?.airline
            ? `same operator (${identity.route.airline})`
            : `same operator (${prefix})`,
          ...(here
            ? {
                distanceKm: Math.round(
                  haversineKm(here.lat, here.lon, o.lat, o.lon),
                ),
              }
            : {}),
        });
    }
    for (const s of situationsWith(
      (s) =>
        s.id === `squawk-${key}` ||
        s.members?.some?.((m) => m.key === key) ||
        s.entityIds?.includes?.(`flights:${key}`),
    ))
      links.push({
        id: `situation:${s.id}`,
        kind: 'situation',
        title: s.title,
        relation: 'part of',
      });
    for (const d of env.detector.current())
      if (d.members.some((m) => m.key === key))
        links.push({
          id: `situation:${d.id}`,
          kind: 'situation',
          title: d.title,
          relation: 'circling with',
        });
    if (identity?.route) {
      for (const [rel, ap] of [
        ['from', identity.route.origin],
        ['to', identity.route.destination],
      ])
        if (ap?.code)
          links.push({
            id: `place:${slug(ap.code)}`,
            kind: 'place',
            title: `${ap.code} · ${ap.name}`,
            relation: rel,
            ...(here && Number.isFinite(ap.lat)
              ? {
                  distanceKm: Math.round(
                    haversineKm(here.lat, here.lon, ap.lat, ap.lon),
                  ),
                }
              : {}),
          });
    }
    // One link per target (the first relation wins).
    const seenIds = new Set();
    links.splice(
      0,
      links.length,
      ...links.filter((l) => !seenIds.has(l.id) && seenIds.add(l.id)),
    );
    if (here)
      links.push({
        id: `place:${slug(localPlace(here.lat, here.lon).name)}`,
        kind: 'place',
        title: localPlace(here.lat, here.lon).name,
        relation: 'over',
      });
    return links;
  }

  async function aircraftDossier(ref) {
    const key = ref.key;
    const live = liveAircraft(key);
    const meta = recorder.meta(key) || {};
    const r = live?.r || null;
    const callsign = (r?.callsign || meta.callsign || '').trim();
    const t = env.timeMs();
    const recState = recorder.stateAt(key, t);
    if (!live && !recorder.has(key)) throw new Error(`Unknown aircraft ${key}`);
    const here = r
      ? { lon: r.lon, lat: r.lat }
      : recState
        ? { lon: recState.lon, lat: recState.lat }
        : null;
    const pia = Boolean(r?.pia || meta.pia);
    const ladd = Boolean(r?.ladd || meta.ladd);
    const identity = pia || ladd ? null : await aircraftIdentity(key, callsign);
    const hasPublic = Boolean(identity?.type?.registration || r?.registration);
    // Only real privacy programmes (PIA / LADD flags) withhold identity. A
    // missing registry record is just that, and is said neutrally.
    const privacy = pia ? 'pia' : ladd ? 'ladd' : null;
    const registryMissing = Boolean(
      !privacy && identity?.typeFetched && !hasPublic,
    );
    const prefixOperator = privacy ? null : airlineFromCallsign(callsign);
    // The server's full track can be slow (or down): the dossier waits at
    // most 2.5 s for it, then uses the recorder's own samples.
    const recorded = recorder.samples(key);
    recorded.source = 'God’s Eye recorder';
    let trackPending = false;
    const track = await Promise.race([
      env.trackOf(key, live?.layer || meta.layer).catch(() => recorded),
      new Promise((r) =>
        setTimeout(() => {
          trackPending = true;
          r(recorded);
        }, 2500),
      ),
    ]);
    const isHeli = Boolean(r?.helicopter || meta.helicopter);
    const isMil = Boolean(r?.military || meta.military);
    const kind = isMil ? 'military' : isHeli ? 'helicopter' : 'aircraft';
    const fetchedAt = live
      ? feeds[live.layer === 'military' ? 'military' : 'flights'].updatedAt ||
        Date.now()
      : Date.now();
    const sources = [];
    if (live)
      sources.push({
        name: live.source,
        fetchedAt,
        url: live.layer === 'military' ? '/api/military' : '/api/flights',
        hash: await receiptHash(r),
      });
    if (track.length)
      sources.push({
        name: track.source || 'God’s Eye recorder',
        fetchedAt: Date.now(),
        hash: await receiptHash(track.map((p) => [p.t, p.lon, p.lat, p.altM])),
      });
    if (identity && (identity.type || identity.route))
      sources.push({
        name: 'adsbdb.com (community aircraft database)',
        fetchedAt: identity.at,
        url: `/api/adsbdb/type/${key}`,
        hash: await receiptHash({ type: identity.type, route: identity.route }),
      });
    const events = [];
    for (const e of recorder.events())
      if (e.key === key) events.push({ t: e.t, title: e.title });
    if (track.length)
      events.push({
        t: track[0].t,
        title: `First position in the record (${new Date(track[0].t).toISOString().slice(11, 16)}Z)`,
      });
    for (const d of env.detector.current())
      if (d.members.some((m) => m.key === key))
        events.push({ t: d.since, title: `Began circling ${d.place}` });
    events.sort((a, b) => a.t - b.t);
    const reg = privacy
      ? null
      : identity?.type?.registration || r?.registration;
    const typeName = identity?.type?.typeName || r?.type || meta.type || null;
    const altM = r?.altM ?? recState?.altM ?? null;
    const speed = r?.speed ?? recState?.speed ?? null;
    return {
      id: `${live?.layer || meta.layer || 'flights'}:${key}`,
      kind,
      title: callsign || key.toUpperCase(),
      subtitle: [
        privacy ? null : identity?.route?.airline || prefixOperator,
        typeName,
        reg,
        altM != null
          ? `${Math.round((Math.max(0, altM) * M_TO_FT) / 100) * 100} ft`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      identity: {
        icao24: key,
        callsign: callsign || null,
        ...(reg ? { registration: reg } : {}),
        ...(typeName && !(privacy === 'pia') ? { type: typeName } : {}),
        ...(identity?.type?.typeCode && !privacy
          ? { typeCode: identity.type.typeCode }
          : {}),
        ...(identity?.route?.airline && !privacy
          ? { operator: identity.route.airline }
          : prefixOperator
            ? { operator: prefixOperator }
            : {}),
        ...(identity?.route && !privacy
          ? {
              route: `${identity.route.origin.code} → ${identity.route.destination.code}`,
            }
          : {}),
        ...(r?.country ? { country: r.country } : {}),
        ...(r?.squawk || meta.squawk
          ? { squawk: r?.squawk || meta.squawk }
          : {}),
        category: isHeli
          ? 'rotorcraft'
          : r?.category != null && r?.cls
            ? r.cls
            : isMil
              ? 'military'
              : null,
        military: isMil,
      },
      live:
        r || recState
          ? {
              lon: here.lon,
              lat: here.lat,
              altM,
              speed,
              heading: r?.heading ?? recState?.headingDeg ?? null,
              ...(r?.squawk ? { squawk: r.squawk } : {}),
              onGround: Boolean(r?.onGround),
              updatedAt: r ? r.seenAt || fetchedAt : recState.t,
              speedKt: speed != null ? Math.round(speed * MPS_TO_KT) : null,
            }
          : null,
      track: track.map(({ t: tt, lon, lat, altM: a }) => ({
        t: tt,
        lon,
        lat,
        altM: a,
      })),
      events,
      links: aircraftLinks(key, r, here, privacy ? null : identity),
      sources,
      ...(trackPending ? { trackPending: true } : {}),
      ...(privacy ? { privacy } : {}),
      ...(registryMissing ? { registryMissing: true } : {}),
    };
  }

  function findSat(norad) {
    for (const g of SAT_GROUPS)
      for (const e of feeds[g]?.data?.entries || [])
        if (e.line1.slice(2, 7).trim() === norad) return e;
    return null;
  }

  async function satelliteDossier(ref) {
    let e = findSat(ref.key);
    if (!e) {
      await Promise.allSettled([feeds.stations.get(), feeds.visual.get()]);
      e = findSat(ref.key);
    }
    if (!e) throw new Error(`No orbital elements for NORAD ${ref.key}`);
    const satrec = twoline2satrec(e.line1, e.line2);
    const t = env.timeMs();
    const p = satPosition(satrec, t);
    const track = [];
    for (let m = -45; m <= 45; m += 3) {
      const q = satPosition(satrec, t + m * 60_000);
      if (q)
        track.push({ t: t + m * 60_000, lon: q.lon, lat: q.lat, altM: q.altM });
    }
    const v = env.viewer();
    let pass = null;
    let look = null;
    if (v) {
      look = lookAnglesAt(satrec, t, v.lat, v.lon);
      pass = findNextIssPass({
        satrec,
        latDeg: v.lat,
        lonDeg: v.lon,
        fromMs: Date.now(),
        minElevDeg: 10,
        horizonHours: 36,
      });
    }
    const intl = e.line1.slice(9, 17).trim();
    const epochYr = Number(e.line1.slice(18, 20));
    const epochDay = Number(e.line1.slice(20, 32));
    const epoch =
      Date.UTC(epochYr < 57 ? 2000 + epochYr : 1900 + epochYr, 0, 1) +
      (epochDay - 1) * 86_400_000;
    const events = [];
    if (pass)
      events.push({
        t: pass.riseMs,
        title: `Next pass over you: max ${Math.round(pass.maxElevDeg)}°${pass.visible ? ', visible' : ''}`,
      });
    events.push({ t: epoch, title: 'Orbital elements epoch' });
    const links = [];
    for (const s of situationsWith(
      (s) => s.kind === 'iss' && ref.key === '25544',
    ))
      links.push({
        id: `situation:${s.id}`,
        kind: 'situation',
        title: s.title,
        relation: 'featured in',
      });
    if (p)
      links.push({
        id: `place:${slug(localPlace(p.lat, p.lon).name)}`,
        kind: 'place',
        title: localPlace(p.lat, p.lon).name,
        relation: 'over',
      });
    return {
      id: `satellites:${ref.key}`,
      kind: 'satellite',
      title: e.name.trim(),
      subtitle: [
        `NORAD ${ref.key}`,
        p ? `${Math.round(p.altM / 1000)} km` : null,
        look ? `${Math.round(look.elevDeg)}° above your horizon` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      identity: {
        norad: ref.key,
        intlDesignator: intl,
        name: e.name.trim(),
        tle: [e.line1, e.line2],
        epoch,
      },
      live: p
        ? {
            lon: p.lon,
            lat: p.lat,
            altM: p.altM,
            speed: p.speedMps,
            heading: null,
            updatedAt: t,
            ...(look
              ? { elevationDeg: look.elevDeg, azimuthDeg: look.azDeg }
              : {}),
          }
        : null,
      track,
      events,
      nextPass: pass
        ? {
            start: pass.riseMs,
            max: pass.maxElevMs,
            end: pass.setMs,
            maxElevationDeg: pass.maxElevDeg,
            visible: Boolean(pass.visible),
          }
        : null,
      links,
      sources: [
        {
          name: 'CelesTrak GP data (SGP4 via satellite.js)',
          fetchedAt: feeds.stations.updatedAt || Date.now(),
          url: '/api/celestrak/stations',
          hash: await receiptHash([e.line1, e.line2]),
        },
      ],
    };
  }

  async function quakeDossier(ref) {
    const data = await feeds.quakes.get().catch(() => feeds.quakes.data);
    const q = data?.records?.find(
      (x) => x.stableId === ref.key || x.usgsId === ref.key,
    );
    if (!q) throw new Error(`Unknown earthquake ${ref.key}`);
    const links = [];
    for (const o of data.records) {
      if (o === q) continue;
      const d = haversineKm(q.lat, q.lon, o.lat, o.lon);
      if (d <= 100 && Math.abs(o.time - q.time) < 7 * 86_400_000)
        links.push({
          id: `earthquakes:${o.stableId}`,
          kind: 'quake',
          title: `M${o.mag.toFixed(1)} ${o.place || ''}`.trim(),
          relation: o.time < q.time ? 'foreshock?' : 'aftershock?',
          distanceKm: Math.round(d),
        });
    }
    links.splice(10);
    for (const s of situationsWith(
      (s) =>
        (s.kind === 'quake' || s.kind === 'quake-cluster') &&
        haversineKm(q.lat, q.lon, s.lat, s.lon) < 60,
    ))
      links.push({
        id: `situation:${s.id}`,
        kind: 'situation',
        title: s.title,
        relation: 'part of',
      });
    return {
      id: `earthquakes:${q.stableId}`,
      kind: 'quake',
      title: `M${q.mag.toFixed(1)} earthquake`,
      subtitle: [
        q.place,
        q.depthKm != null ? `${Math.round(q.depthKm)} km deep` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      identity: { usgsId: q.usgsId, magnitude: q.mag, depthKm: q.depthKm },
      live: {
        lon: q.lon,
        lat: q.lat,
        altM: -(q.depthKm ?? 0) * 1000,
        speed: 0,
        heading: null,
        updatedAt: q.time,
      },
      track: [],
      events: [{ t: q.time, title: `M${q.mag.toFixed(1)} · ${q.place || ''}` }],
      links,
      sources: [
        {
          name: 'U.S. Geological Survey (M2.5+ week feed)',
          fetchedAt: feeds.quakes.updatedAt,
          url: q.usgsId
            ? `https://earthquake.usgs.gov/earthquakes/eventpage/${q.usgsId}`
            : 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
          hash: await receiptHash(q),
        },
      ],
    };
  }

  async function cameraDossier(ref) {
    const data = await feeds.cctv.get().catch(() => feeds.cctv.data);
    const c = data?.records?.find((x) => x.id === ref.key);
    if (!c) throw new Error(`Unknown camera ${ref.key}`);
    const links = [];
    for (const o of data.records) {
      if (o === c || Math.abs(o.lat - c.lat) > 0.02) continue;
      const d = haversineKm(c.lat, c.lon, o.lat, o.lon);
      if (d < 1.5)
        links.push({
          id: `cctv:${o.id}`,
          kind: 'camera',
          title: o.name,
          relation: 'nearby camera',
          distanceKm: Math.round(d * 100) / 100,
        });
    }
    links.sort((a, b) => a.distanceKm - b.distanceKm).splice(8);
    return {
      id: `cctv:${c.id}`,
      kind: 'camera',
      title: c.name,
      subtitle: [c.provider, c.city].filter(Boolean).join(' · '),
      identity: {
        provider: c.provider,
        city: c.city,
        headingDeg: c.heading ?? null,
        fovDeg: c.fovDeg ?? null,
      },
      live: {
        lon: c.lon,
        lat: c.lat,
        altM: 0,
        speed: 0,
        heading: c.heading ?? null,
        updatedAt: Date.now(),
      },
      track: [],
      events: [],
      links,
      sources: [
        {
          name: `Public camera feed · ${c.provider || 'agency'}`,
          fetchedAt: feeds.cctv.updatedAt,
          url: `/api/cctv/frame/${encodeURIComponent(c.id)}`,
          hash: await receiptHash(c),
        },
      ],
    };
  }

  async function vesselDossier(ref) {
    const data = feeds.vessels.data;
    const v = data?.records?.find((x) => x.id === ref.key);
    const rec = recorder.stateAt(`v:${ref.key}`, env.timeMs());
    if (!v && !rec) throw new Error(`Unknown vessel ${ref.key}`);
    const track = recorder.samples(`v:${ref.key}`);
    return {
      id: `vessels:${ref.key}`,
      kind: 'vessel',
      title: v?.name || ref.key,
      subtitle: [v?.type, v?.destination ? `→ ${v.destination}` : null]
        .filter(Boolean)
        .join(' · '),
      identity: { mmsi: ref.key, name: v?.name, type: v?.type },
      live: v
        ? {
            lon: v.lon,
            lat: v.lat,
            altM: 0,
            speed: v.speed,
            heading: v.heading,
            updatedAt: feeds.vessels.updatedAt,
          }
        : null,
      track: track.map(({ t, lon, lat }) => ({ t, lon, lat, altM: 0 })),
      events: [],
      links: [],
      sources: v
        ? [
            {
              name: data.source || 'AISStream',
              fetchedAt: feeds.vessels.updatedAt,
              hash: await receiptHash(v),
            },
          ]
        : [],
    };
  }

  function situationLinks(s) {
    const links = [];
    for (const m of s.members || [])
      links.push({
        id: `${m.layer || 'flights'}:${m.key}`,
        kind: m.helicopter ? 'helicopter' : 'aircraft',
        title: m.callsign || m.key,
        relation: 'circling',
      });
    if (s.kind === 'squawk') {
      const key = s.id.replace(/^squawk-/, '');
      links.push({
        id: `flights:${key}`,
        kind: 'aircraft',
        title: s.title.split(' ')[0],
        relation: 'subject',
      });
    }
    if (s.media?.cameraId)
      links.push({
        id: `cctv:${s.media.cameraId}`,
        kind: 'camera',
        title: s.title,
        relation: 'camera',
      });
    if (s.momentId)
      links.push({
        id: `moment:${s.momentId}`,
        kind: 'moment',
        title: `Replay: ${s.title}`,
        relation: 'moment',
      });
    links.push({
      id: `place:${slug(s.place || localPlace(s.lat, s.lon).name)}`,
      kind: 'place',
      title: s.place || localPlace(s.lat, s.lon).name,
      relation: 'at',
    });
    // Other situations nearby.
    for (const o of env.situations().values()) {
      if (o.id === s.id) continue;
      const d = haversineKm(s.lat, s.lon, o.lat, o.lon);
      if (d < 150)
        links.push({
          id: `situation:${o.id}`,
          kind: 'situation',
          title: o.title,
          relation: 'nearby',
          distanceKm: Math.round(d),
        });
    }
    return links;
  }

  async function situationDossier(ref) {
    const s =
      env.situations().get(ref.key) || env.detector.get(ref.key) || null;
    if (!s) throw new Error(`Unknown situation ${ref.key}`);
    return {
      id: `situation:${s.id}`,
      kind: 'situation',
      title: s.title,
      subtitle: s.subtitle || s.place || '',
      identity: {
        genre: s.kind,
        band: s.band,
        archetype: s.archetype,
        ...(s.momentId ? { momentId: s.momentId } : {}),
      },
      live: {
        lon: s.lon,
        lat: s.lat,
        altM: 0,
        speed: 0,
        heading: null,
        updatedAt: s.updatedAt,
      },
      track: [],
      events: [
        ...(s.time?.start ? [{ t: s.time.start, title: 'Began' }] : []),
        { t: s.updatedAt, title: 'Last update' },
      ],
      links: situationLinks(s),
      sources: [
        {
          name: s.source || 'God’s Eye',
          fetchedAt: s.updatedAt,
          hash: await receiptHash(s.metrics || s),
        },
      ],
    };
  }

  async function momentDossier(ref) {
    const m = await env.moments.get(ref.moment);
    if (!m) throw new Error(`Unknown moment ${ref.moment}`);
    const links = [
      ...m.tracks.map((t) => ({
        id: `moment:${m.id}:${t.id}`,
        kind: 'track',
        title: t.label,
        relation: t.kind === 'helicopter' ? 'helicopter' : 'aircraft',
      })),
      ...m.captures.map((c) => ({
        id: `capture:${m.id}:${c.id}`,
        kind: 'capture',
        title: c.title,
        relation: c.firstEyes ? 'first eyes' : 'witness capture',
      })),
      {
        id: `place:${slug(m.place)}`,
        kind: 'place',
        title: m.place,
        relation: 'at',
      },
    ];
    return {
      id: `moment:${m.id}`,
      kind: 'moment',
      title: m.title,
      subtitle: `${m.place}${m.illustrative ? ' · Illustrative' : ''}`,
      identity: {
        illustrative: Boolean(m.illustrative),
        tracks: m.tracks.length,
        captures: m.captures.length,
      },
      live: {
        lon: m.lon,
        lat: m.lat,
        altM: 0,
        speed: 0,
        heading: null,
        updatedAt: m.time.end,
      },
      track: [],
      events: (m.beats || []).map((b) => ({ t: b.t, title: b.title })),
      links,
      sources: await Promise.all(
        m.sources.map(async (s) => ({
          name: s.name,
          detail: s.detail,
          fetchedAt: m.time.end,
          hash: await receiptHash(s),
        })),
      ),
      ...(m.illustrative ? { illustrative: true } : {}),
    };
  }

  async function trackDossier(ref) {
    const m = await env.moments.get(ref.moment);
    const tr = m?.tracks.find((t) => t.id === ref.key);
    if (!tr) throw new Error(`Unknown track ${ref.key}`);
    const last = tr.points.at(-1);
    const t = env.timeMs();
    const cur =
      tr.points.find(
        (p, i) => p.t <= t && (tr.points[i + 1]?.t ?? Infinity) > t,
      ) || last;
    const others = m.tracks
      .filter((o) => o.id !== tr.id)
      .map((o) => ({
        id: `moment:${m.id}:${o.id}`,
        kind: 'track',
        title: o.label,
        relation: 'orbiting with',
      }));
    // A live Moment track is a real aircraft: hand over to its dossier.
    if (!m.illustrative && tr.entityId) {
      const d = await aircraftDossier(parseRef(tr.entityId)).catch(() => null);
      if (d) {
        d.links.push(
          {
            id: `moment:${m.id}`,
            kind: 'moment',
            title: m.title,
            relation: 'in moment',
          },
          ...others,
        );
        return d;
      }
    }
    return {
      id: `moment:${m.id}:${tr.id}`,
      kind: tr.kind === 'helicopter' ? 'helicopter' : 'aircraft',
      title: tr.label,
      subtitle: [tr.type, tr.operator, m.illustrative ? 'Illustrative' : null]
        .filter(Boolean)
        .join(' · '),
      identity: {
        callsign: tr.callsign || null,
        registration: tr.registration || null,
        type: tr.type || null,
        operator: tr.operator || null,
        illustrative: Boolean(m.illustrative),
      },
      live: {
        lon: cur.lon,
        lat: cur.lat,
        altM: cur.altM,
        speed: null,
        heading: null,
        updatedAt: cur.t,
      },
      track: tr.points,
      events: (m.beats || [])
        .filter((b) => b.title.includes(tr.label.split(' ')[0]))
        .map((b) => ({ t: b.t, title: b.title })),
      links: [
        {
          id: `moment:${m.id}`,
          kind: 'moment',
          title: m.title,
          relation: 'in moment',
        },
        ...others,
        // The sealed captures that caught it, and the place it flew over.
        ...(m.captures || [])
          .filter((c) =>
            new RegExp(
              `${tr.label.split(/[\s(-]/)[0]}|${tr.kind === 'helicopter' ? 'helicopter|helo' : 'aircraft'}`,
              'i',
            ).test(`${c.title} ${c.place || ''}`),
          )
          .slice(0, 3)
          .map((c) => ({
            id: `capture:${m.id}:${c.id}`,
            kind: 'capture',
            title: c.title,
            relation: 'seen in sealed capture',
          })),
        ...(Number.isFinite(cur?.lat)
          ? [
              {
                id: `place:${slug(localPlace(cur.lat, cur.lon).name)}`,
                kind: 'place',
                title: localPlace(cur.lat, cur.lon).name,
                relation: 'over',
              },
            ]
          : []),
      ],
      sources: [
        {
          name: m.illustrative
            ? 'Illustrative reconstruction (synthetic track)'
            : 'God’s Eye recorder',
          fetchedAt: m.time.end,
          hash: await receiptHash(
            tr.points.map((p) => [p.t, p.lon, p.lat, p.altM]),
          ),
        },
      ],
      ...(m.illustrative ? { illustrative: true } : {}),
    };
  }

  async function captureDossier(ref) {
    const m = await env.moments.get(ref.moment);
    const c = m?.captures.find((x) => x.id === ref.key);
    if (!c) throw new Error(`Unknown capture ${ref.key}`);
    return {
      id: `capture:${m.id}:${c.id}`,
      kind: 'capture',
      title: c.title,
      subtitle: `@${c.handle} · ${c.place || ''}${c.sealed ? ' · Sealed' : ''}${m.illustrative ? ' · Illustrative' : ''}`,
      identity: {
        handle: c.handle,
        sealed: Boolean(c.sealed),
        firstEyes: Boolean(c.firstEyes),
        headingDeg: c.headingDeg,
        fovDeg: c.fovDeg,
        captureKind: c.kind || 'photo',
      },
      live: {
        lon: c.lon,
        lat: c.lat,
        altM: c.altM,
        speed: 0,
        heading: c.headingDeg,
        updatedAt: c.t,
      },
      track: [],
      events: [
        {
          t: c.t,
          title: c.firstEyes
            ? 'First eyes: first sealed capture'
            : 'Sealed capture',
        },
      ],
      links: [
        {
          id: `moment:${m.id}`,
          kind: 'moment',
          title: m.title,
          relation: 'witness of',
        },
        ...m.posts
          .filter((p) => p.captureId === c.id)
          .map((p) => ({
            id: `post:${m.id}:${p.id}`,
            kind: 'post',
            title: p.text.slice(0, 60),
            relation: 'posted as',
          })),
      ],
      sources: [
        {
          name: m.illustrative
            ? 'Illustrative capture (simulated)'
            : 'Signed capture',
          fetchedAt: c.t,
          hash: await receiptHash(c),
        },
      ],
      ...(m.illustrative ? { illustrative: true } : {}),
    };
  }

  function allPlaces() {
    const out = [];
    for (const [name, lon, lat, r] of NEIGHBORHOODS)
      out.push({ name, lon, lat, kind: 'neighbourhood', radiusKm: r });
    for (const a of AIRPORTS)
      out.push({
        name: `${a.code} · ${a.name}`,
        code: a.code,
        lon: a.lon,
        lat: a.lat,
        kind: 'airport',
      });
    for (const [name, lon, lat] of WORLD_PLACES)
      out.push({ name, lon, lat, kind: 'city' });
    return out;
  }

  function placeBySlug(s) {
    return allPlaces().find(
      (p) => slug(p.name) === s || (p.code && slug(p.code) === s),
    );
  }

  async function placeDossier(ref) {
    const p = placeBySlug(ref.key);
    if (!p) throw new Error(`Unknown place ${ref.key}`);
    const links = [];
    for (const s of env.situations().values()) {
      const d = haversineKm(p.lat, p.lon, s.lat, s.lon);
      if (d < 120)
        links.push({
          id: `situation:${s.id}`,
          kind: 'situation',
          title: s.title,
          relation: 'happening near',
          distanceKm: Math.round(d),
        });
    }
    const near = allAircraft()
      .map((o) => ({ o, d: haversineKm(p.lat, p.lon, o.lat, o.lon) }))
      .filter((x) => x.d < 30 && !x.o.onGround)
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    for (const { o, d } of near)
      links.push({
        id: `${o.military ? 'military' : 'flights'}:${o.id}`,
        kind: o.helicopter ? 'helicopter' : 'aircraft',
        title: o.callsign || o.id,
        relation: 'overhead',
        distanceKm: Math.round(d * 10) / 10,
      });
    return {
      id: `place:${ref.key}`,
      kind: 'place',
      title: p.name,
      subtitle: p.kind,
      identity: { kind: p.kind, ...(p.code ? { code: p.code } : {}) },
      live: {
        lon: p.lon,
        lat: p.lat,
        altM: 0,
        speed: 0,
        heading: null,
        updatedAt: Date.now(),
      },
      track: [],
      events: [],
      links,
      sources: [
        {
          name: 'Bundled gazetteer (public centroids)',
          fetchedAt: Date.now(),
          hash: await receiptHash(p),
        },
      ],
    };
  }

  async function entity(ref) {
    const r = parseRef(ref);
    if (!r) throw new TypeError('entity() needs an id or a pick');
    const cacheKey = JSON.stringify(r);
    const hit = dossierCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 5000) return hit.d;
    let d;
    switch (r.type) {
      case 'aircraft':
        d = await aircraftDossier(r);
        break;
      case 'satellite':
        d = await satelliteDossier(r);
        break;
      case 'quake':
        d = await quakeDossier(r);
        break;
      case 'camera':
        d = await cameraDossier(r);
        break;
      case 'vessel':
        d = await vesselDossier(r);
        break;
      case 'situation':
        d = await situationDossier(r);
        break;
      case 'moment':
        d = await momentDossier(r);
        break;
      case 'track':
        d = await trackDossier(r);
        break;
      case 'capture':
        d = await captureDossier(r);
        break;
      case 'place':
        d = await placeDossier(r);
        break;
      default: {
        // Bare ids: try a situation, then an aircraft hex.
        if (env.situations().has(r.key) || env.detector.get(r.key))
          d = await situationDossier({ key: r.key });
        else if (/^[0-9a-f]{6}$/i.test(r.key))
          d = await aircraftDossier({ key: r.key.toLowerCase() });
        else throw new Error(`Unknown entity ${String(ref)}`);
      }
    }
    dossierCache.set(cacheKey, { at: Date.now(), d });
    if (dossierCache.size > 80)
      dossierCache.delete(dossierCache.keys().next().value);
    return d;
  }

  /* ── Search ────────────────────────────────────────────────── */

  function score(hay, q) {
    if (!hay) return 0;
    const h = String(hay).toLowerCase();
    if (h === q) return 100;
    if (h.startsWith(q)) return 70;
    if (h.includes(` ${q}`)) return 50;
    if (h.includes(q)) return 30;
    return 0;
  }

  async function search(query) {
    const raw = String(query ?? '').trim();
    const q = raw.toLowerCase();
    if (!q) return [];
    const out = [];
    const push = (s, item) => {
      if (s > 0) out.push({ ...item, _s: s });
    };
    // Squawk codes.
    if (/^7[567]00$/.test(q)) {
      for (const r of allAircraft())
        if (r.squawk === q)
          push(95, {
            id: `flights:${r.id}`,
            kind: 'aircraft',
            title: r.callsign || r.id,
            subtitle: `Squawking ${r.squawk} · ${Math.round((r.altM * M_TO_FT) / 100) * 100} ft`,
          });
    }
    // Magnitude ("M5.2", "m5").
    const mag = /^m\s?(\d(?:\.\d)?)$/.exec(q);
    const quakes = feeds.quakes.data?.records || [];
    if (mag) {
      const m = Number(mag[1]);
      for (const x of quakes)
        if (x.mag >= m && x.mag < m + (mag[1].includes('.') ? 0.1 : 1))
          push(90 + x.mag, {
            id: `earthquakes:${x.stableId}`,
            kind: 'quake',
            title: `M${x.mag.toFixed(1)} earthquake`,
            subtitle: x.place || '',
          });
    }
    for (const x of quakes)
      push(score(x.place, q) * 0.8, {
        id: `earthquakes:${x.stableId}`,
        kind: 'quake',
        title: `M${x.mag.toFixed(1)} earthquake`,
        subtitle: x.place || '',
      });
    // Aircraft: callsign, hex, registration (live + recorder).
    const seen = new Set();
    for (const r of allAircraft()) {
      const s = Math.max(
        score(r.callsign, q),
        score(r.id, q),
        score(r.registration, q),
        score(identityCache.get(r.id)?.type?.registration, q),
      );
      if (!s) continue;
      seen.add(r.id);
      push(s + 5, {
        id: `${r.military ? 'military' : 'flights'}:${r.id}`,
        kind: r.military
          ? 'military'
          : r.helicopter
            ? 'helicopter'
            : 'aircraft',
        title: r.callsign || r.id.toUpperCase(),
        subtitle: [
          r.type || r.country,
          `${Math.round((r.altM * M_TO_FT) / 100) * 100} ft`,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
    if (out.length < 30)
      for (const key of recorder.keys()) {
        if (seen.has(key)) continue;
        const m = recorder.meta(key);
        const s = Math.max(
          score(m?.callsign, q),
          score(key, q),
          score(m?.registration, q),
        );
        if (s)
          push(s - 10, {
            id: `${m?.layer || 'flights'}:${key}`,
            kind: m?.kind || 'aircraft',
            title: m?.callsign || key.toUpperCase(),
            subtitle: 'In the record',
          });
      }
    // Satellites.
    const sats = new Set();
    for (const g of SAT_GROUPS)
      for (const e of feeds[g]?.data?.entries || []) {
        const id = e.line1.slice(2, 7).trim();
        if (sats.has(id)) continue;
        const name = e.name.trim();
        const s = Math.max(
          score(name, q),
          q === 'iss' && id === '25544' ? 100 : 0,
          score(id, q),
        );
        if (!s) continue;
        sats.add(id);
        push(s, {
          id: `satellites:${id}`,
          kind: 'satellite',
          title: name,
          subtitle: `NORAD ${id}`,
        });
      }
    // Cameras.
    for (const c of feeds.cctv.data?.records || []) {
      const s = Math.max(score(c.name, q), score(c.city, q) * 0.5);
      if (s)
        push(s * 0.9, {
          id: `cctv:${c.id}`,
          kind: 'camera',
          title: c.name,
          subtitle: [c.provider, c.city].filter(Boolean).join(' · '),
        });
    }
    // Situations and detections.
    for (const s of env.situations().values()) {
      const sc = Math.max(
        score(s.title, q),
        score(s.place, q) * 0.8,
        score(s.kind, q) * 0.7,
      );
      if (sc)
        push(sc + 8, {
          id: `situation:${s.id}`,
          kind: 'situation',
          title: s.title,
          subtitle: s.place || s.subtitle || '',
        });
    }
    // Places.
    for (const p of allPlaces()) {
      const s = Math.max(score(p.name, q), p.code ? score(p.code, q) : 0);
      if (s)
        push(s * (p.kind === 'neighbourhood' ? 0.95 : 0.85), {
          id: `place:${slug(p.code || p.name)}`,
          kind: 'place',
          title: p.name,
          subtitle: p.kind,
        });
    }
    // Moments.
    for (const m of env.moments.cached()) {
      const s = Math.max(score(m.title, q), score(m.place, q) * 0.8);
      if (s)
        push(s + 10, {
          id: `moment:${m.id}`,
          kind: 'moment',
          title: m.title,
          subtitle: `${m.place}${m.illustrative ? ' · Illustrative' : ''}`,
        });
      for (const tr of m.tracks || []) {
        const st = Math.max(score(tr.label, q), score(tr.callsign, q));
        if (st)
          push(st, {
            id: `moment:${m.id}:${tr.id}`,
            kind: 'track',
            title: tr.label,
            subtitle: m.title,
          });
      }
    }
    const best = new Map();
    for (const o of out)
      if (!best.has(o.id) || best.get(o.id)._s < o._s) best.set(o.id, o);
    return [...best.values()]
      .sort((a, b) => b._s - a._s)
      .slice(0, 30)
      .map(({ _s, ...rest }) => rest);
  }

  /* ── Graph ─────────────────────────────────────────────────── */

  function graph(ref, { max = 40 } = {}) {
    const r = parseRef(ref);
    if (!r) return { nodes: [], edges: [] };
    const nodes = new Map();
    const edges = [];
    const add = (id, kind, title) => {
      if (!nodes.has(id) && nodes.size < max)
        nodes.set(id, { id, kind, title });
      return nodes.has(id);
    };
    const link = (from, l) => {
      if (add(l.id, l.kind, l.title))
        edges.push({ from, to: l.id, relation: l.relation });
    };
    const cached = [...dossierCache.values()].map((x) => x.d);
    const dossierOf = (id) => cached.find((d) => d.id === id);
    let centerId;
    if (r.type === 'situation') {
      const s = env.situations().get(r.key) || env.detector.get(r.key);
      if (!s) return { nodes: [], edges: [] };
      centerId = `situation:${s.id}`;
      add(centerId, 'situation', s.title);
      for (const l of situationLinks(s)) link(centerId, l);
    } else if (r.type === 'aircraft') {
      const live = liveAircraft(r.key);
      const meta = recorder.meta(r.key);
      centerId = `${live?.layer || meta?.layer || 'flights'}:${r.key}`;
      add(
        centerId,
        live?.r?.helicopter ? 'helicopter' : 'aircraft',
        live?.r?.callsign || meta?.callsign || r.key,
      );
      const st = live?.r || recorder.stateAt(r.key, env.timeMs());
      const here = st ? { lon: st.lon, lat: st.lat } : null;
      const d = dossierOf(centerId);
      const links =
        d?.links ||
        aircraftLinks(r.key, live?.r, here, identityCache.get(r.key));
      for (const l of links) link(centerId, l);
    } else {
      const d = cached.find((x) => parseRef(x.id)?.key === r.key);
      if (!d) return { nodes: [], edges: [] };
      centerId = d.id;
      add(centerId, d.kind, d.title);
      for (const l of d.links) link(centerId, l);
    }
    // Second ring: members of linked situations, linked situations of members.
    for (const n of [...nodes.values()]) {
      if (n.id === centerId || nodes.size >= max) continue;
      const pr = parseRef(n.id);
      if (pr?.type === 'situation') {
        const s = env.situations().get(pr.key) || env.detector.get(pr.key);
        for (const m of s?.members || [])
          link(n.id, {
            id: `${m.layer || 'flights'}:${m.key}`,
            kind: m.helicopter ? 'helicopter' : 'aircraft',
            title: m.callsign || m.key,
            relation: 'circling',
          });
      }
    }
    return { center: centerId, nodes: [...nodes.values()], edges };
  }

  return { entity, search, graph, parseRef, identityCache };
}
