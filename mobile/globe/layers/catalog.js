/**
 * The full layer catalog (DESIGN.md §8) in display order. Entries the
 * prototype renders are built by the family factories; the rest are listed
 * honestly as unavailable so the lens dock can show the whole catalog.
 */
import { UnavailableLayer } from './base.js';
import { createSkyLayers } from './air.js';
import { createOrbitLayers } from './orbit.js';
import { createHazardLayers } from './hazards.js';
import { createSeaLayers, createEyesLayers } from './sea.js';
import { createWeatherLayers } from './weather.js';

export const FAMILIES = Object.freeze([
  'Sky',
  'Sea',
  'Orbit',
  'Hazards',
  'Eyes',
  'Ground',
  'Weather',
  'Infra',
]);

export const CATALOG = Object.freeze([
  ['Sky', 'flights', 'Commercial flights'],
  ['Sky', 'military', 'Military aircraft'],
  ['Sky', 'helicopters', 'Helicopters'],
  ['Sky', 'ga', 'Private / GA'],
  ['Sky', 'squawk', 'Emergency squawks'],
  ['Sky', 'drones', 'Drones (Remote ID)'],
  ['Sky', 'airport-boards', 'Airport boards'],
  ['Sky', 'holding', 'Holding patterns'],
  ['Sea', 'vessels', 'AIS vessels'],
  ['Sea', 'ports', 'Ports'],
  ['Sea', 'tankers', 'Tankers / cargo'],
  ['Sea', 'fishing', 'Fishing effort'],
  ['Sea', 'dark-vessels', 'Dark vessels (AIS gaps)'],
  ['Sea', 'cables', 'Submarine cables'],
  ['Orbit', 'satellites', 'Satellites (TLE)'],
  ['Orbit', 'iss', 'ISS & crewed'],
  ['Orbit', 'starlink', 'Starlink trains'],
  ['Orbit', 'launches', 'Launches & trajectories'],
  ['Orbit', 'debris', 'Debris'],
  ['Orbit', 'passes', 'Ground tracks & passes'],
  ['Hazards', 'earthquakes', 'Earthquakes'],
  ['Hazards', 'fires', 'Active fires (FIRMS)'],
  ['Hazards', 'fire-perimeters', 'Fire perimeters'],
  ['Hazards', 'floods', 'Floods'],
  ['Hazards', 'cyclones', 'Tropical cyclones'],
  ['Hazards', 'volcanoes', 'Volcanoes'],
  ['Hazards', 'air-quality', 'Air quality'],
  ['Eyes', 'cctv', 'Public CCTV'],
  ['Eyes', 'captures', 'Signed captures'],
  ['Eyes', 'street-level', 'Street-level imagery'],
  ['Eyes', 'holograms', 'Holograms'],
  ['Eyes', 'streams', 'Live streams'],
  ['Ground', 'transit', 'Transit vehicles'],
  ['Ground', 'traffic', 'Traffic flow'],
  ['Ground', 'bikeshare', 'Bike share'],
  ['Ground', 'rail', 'Rail'],
  ['Ground', 'venues', 'Events & venues'],
  ['Ground', 'alpr', 'ALPR cameras'],
  ['Weather', 'radar', 'Radar'],
  ['Weather', 'clouds', 'Clouds'],
  ['Weather', 'lightning', 'Lightning'],
  ['Weather', 'wind', 'Wind (10 m)'],
  ['Weather', 'jet', 'Jet stream (250 hPa)'],
  ['Weather', 'forecast', 'Forecast models'],
  ['Infra', 'datacenters', 'Datacenters'],
  ['Infra', 'dams', 'Dams'],
  ['Infra', 'power', 'Power plants'],
  ['Infra', 'installations', 'Military installations'],
  ['Infra', 'gnss', 'GNSS interference'],
  ['Infra', 'recent-imagery', 'Recent satellite imagery'],
]);

/** Build every catalog layer; returns a Map id → layer in catalog order. */
export function buildLayers(ctx, feeds) {
  const live = new Map();
  for (const layer of [
    ...createSkyLayers(ctx, feeds),
    ...createSeaLayers(ctx, feeds),
    ...createOrbitLayers(ctx, feeds),
    ...createHazardLayers(ctx, feeds),
    ...createEyesLayers(ctx, feeds),
    ...createWeatherLayers(ctx, feeds),
  ])
    live.set(layer.id, layer);
  const out = new Map();
  for (const [family, id, name] of CATALOG) {
    const layer = live.get(id);
    if (layer) {
      layer.family = family;
      out.set(id, layer);
    } else out.set(id, new UnavailableLayer({ id, family, name }));
  }
  return out;
}
