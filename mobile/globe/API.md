# Globe API: round-two additions

These additions extend DESIGN.md §10 and change no existing signature. Import them from `mobile/globe/index.js`. The doc comment at the top of that file repeats this contract.

## Viewer position

```js
globe.setViewer({ lon, lat } | null)   // where the person is: sets distanceKm and the ISS/Starlink "over you" cards
globe.viewer() → { lon, lat } | null
```

## Situations (extended)

```js
globe.situations({ observer? }) → Promise<Situation[]>
globe.omitted()  → [{ genre, reason }]   // genres the last call left out, and why
globe.timings()  → { [genre]: ms }       // per-genre build time of the last call
```

`Situation` keeps every field from round one (`id, kind, family, section, title, subtitle, place, lon, lat, camera, layers, time?, metrics, thumbnail, live, updatedAt, source, severity`) and adds these:

| Field          | Type                                                                        | Notes                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `band`         | `'orbit' \| 'sky' \| 'ground' \| 'inside'`                                  | The altitude band of the sensor. The engine never emits `inside`, because only the shell's own witness and room cards are inside.                                                                                                |
| `archetype`    | `'sensor' \| 'eye' \| 'track' \| 'number'`                                  | The card layout. The shell adds `witness` and `room` cards itself.                                                                                                                                                               |
| `telemetry`    | `string`                                                                    | A short uppercase strip, for example `SKY · FL206 · 332 KT · SQ 7700 · EZY58XM`, `GROUND · CAM 07450 · PICCADILLY CIRCUS · 02:16:14Z` or `ORBIT · ISS · 433 KM · 7.65 KM/S`. Draw it in HTML in a monospace face.                |
| `media?`       | `{ kind:'image', url, refreshMs, cameraId, headingDeg?, provider?, city? }` | Eye cards only. `url` is a same-origin frame from `/api/cctv/frame/…` that was checked to be a real upstream image, not the proxy's synthetic fallback. For a fresh frame, call `globe.eyeFrameUrl(cameraId)` every `refreshMs`. |
| `series?`      | `[{ t, v }]`                                                                | Real history for number cards, and for some sensor cards. `t` is epoch ms.                                                                                                                                                       |
| `seriesLabel?` | `string`                                                                    | The quantity `v` measures, for example `'lightning-active area (km²) per 15 min'`.                                                                                                                                               |
| `headline?`    | `{ value, unit, label }`                                                    | The one big number on a track or number card.                                                                                                                                                                                    |
| `distanceKm?`  | `number`                                                                    | The great-circle distance from the viewer. It is present only once `setViewer` has been called, or when `observer` is passed.                                                                                                    |

The `thumbnail` field is still a plain Esri still, so older code keeps working. New code calls `globe.thumbnail(situation)` instead.

The engine orders the cards by severity, then interleaves them so neighbouring cards differ in band and archetype where possible.

## Card compositor

```js
globe.thumbnail(situation, { width = 360, height = 480, dpr = 2 } = {}) → Promise<string /* blob: object URL */>
```

The compositor builds each thumbnail as a JPEG in an offscreen 2D canvas, never in the Cesium viewer. It works in three layers:

1. **Base imagery.** Esri World Imagery tiles, which are CORS-clean, or NASA GIBS Black Marble for orbit cards.
2. **Real overlays.** The data that describes the situation. Examples include NOAA IR with a cold-top enhancement, MRMS radar, lightning density dots by age, the NHC cone with the forecast track and 34/50/64-kt wind radii, aircraft with 2-minute velocity leaders, quake rings, fires with a smoke plume along the observed wind, and SGP4 ground tracks.
3. **Grade.** A tint for the altitude band (orbit violet night, sky cool, ground amber) and a vignette.

The compositor draws no text and no brackets.

Eye cards return the camera frame itself, lightly graded. Results are cached in memory and, when the page is a secure context, in the Cache API, keyed by id, size and an update bucket. Eye cards refresh every 30 s; other cards follow `updatedAt` in 5-minute buckets. Tiles are shared across cards, and at most 3 cards render at once.

If an overlay fails, the card still gets its base picture. The promise rejects only when the base imagery or the camera frame fails. In that case, fall back to `situation.thumbnail` or to the shell's own placeholder.

## Pins (discourse and capture)

```js
globe.addPin({ id, lon, lat, kind, headingDeg?, fovDeg = 60, rangeM = 350, color?, label?, altM? }) → id
  // kind: 'post' | 'witness' | 'eye' | 'live' | 'hologram'
  // 'live' and 'eye' pins draw a view-frustum wedge on the ground along headingDeg
globe.removePin(id) → boolean
globe.pins() → [{ id, lon, lat, kind, headingDeg, fovDeg, rangeM, color, label, altM }]
```

- Picking a pin emits `'pick'` with `{ kind: 'pin', pinKind, id, title, subtitle, lon, lat, meta: { layer: 'pins', headingDeg, fovDeg, label } }`.
- Pins appear in `globe.labels()` with `layer: 'pins'` and `pinKind`.
- Live pins breathe at 1 Hz.

## Labels

Each entry from `globe.labels(max)` can now carry an optional `detail`, a short intensity tag:

- Cyclones: `CAT 2 · 85 KT · 974 HPA`
- Emergency squawks: `SQ 7700`
- Air quality: `AQI 152`

## Nearest public camera

```js
globe.nearestEye(lon, lat, km = 50)
  → Promise<{ id, title, lon, lat, distanceKm, headingDeg, fovDeg, imageUrl, city, provider } | null>
globe.eyeFrameUrl(cameraId) → string | null   // a fresh same-origin frame URL
```

`nearestEye` reads the CCTV catalog at `/api/cctv/sources`, which serves about 4,000 cameras across London, Toronto, Sydney, Seattle, the Bay Area, Los Angeles, Helsinki/Finland, Tallinn, Barcelona, Calgary, Norway and other places. It does not check the frame. A camera can still answer with the proxy's synthetic image when its upstream is down.

## Weather and storm layers (now available in `globe.layers()`)

| id            | Family  | Source                                                                                                                                                                                           | Time                                              |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `radar`       | Weather | NOAA MRMS base reflectivity through nowCOAST (`/api/weather`), CONUS                                                                                                                             | Scrubbing replays about 50 min of 4-minute frames |
| `clouds`      | Weather | NOAA global longwave IR mosaic through nowCOAST, drawn as an unlit cloud layer (the alpha-keyed IR)                                                                                              | 6 h of hourly frames                              |
| `lightning`   | Weather | NOAA nowCOAST lightning density, 15 min (Americas and Pacific), with a flickering glow per active 0.5° cell                                                                                      | 3 h of 15-minute frames                           |
| `wind`        | Weather | 10 m wind, drawn with the desktop app's GPU streamline renderer. Uses `/api/wind` GFS when the server can decode GRIB, otherwise a 12° Open-Meteo grid                                           | Live                                              |
| `jet`         | Weather | Jet stream at 250 hPa from Open-Meteo, same renderer                                                                                                                                             | Live                                              |
| `cyclones`    | Hazards | Now also draws the filled NHC cone and 34/50/64-kt wind radii, parsed from the NHC TCM text at api.weather.gov                                                                                   | Forecast scrubbing, as before                     |
| `air-quality` | Hazards | Open-Meteo Air Quality (CAMS model), PM2.5 AQI for 40 major cities                                                                                                                               | Live                                              |
| `gnss`        | Infra   | `/api/gnss-integrity` (adsb.lol NIC/NACp), shown as 0.5° cells in gpsjam.org bands. From orbit it samples the Baltic, Black Sea, Levant, Gulf and Gulf of Finland; close in, it samples the view | Live                                              |
| `transit`     | Ground  | `/api/transit` GTFS-realtime vehicles from the open feed nearest the view                                                                                                                        | Live, 20 s                                        |

Rasters are drawn a few kilometres above the ground and unlit, so storms stay visible on the night side. When an upstream is down, the layer reports `status: 'error'` with a `message`.

When a weather layer is on, `layers()` entries can also carry `frames` (the number of frames available) and a `message` that gives the product title and the frame age.

When NHC has published an advisory but its cone geometry is still pending, the cyclone layer and cards take the forecast positions from the advisory text, so a track is still drawn but there is no cone.

## Dev harnesses

- `mobile/globe/dev.html` shows the globe full-screen and exposes `window.globe`. Its labels show `detail`.
- `mobile/globe/contact.html` is the contact sheet: it calls `situations()`, then `thumbnail()` for every card.
  - `?lat=&lon=` sets the viewer.
  - `?only=cyclone,eye` filters cards by id prefix.
  - `?w=330` sets the card width.

---

# Round three: Gotham for everyone (DESIGN.md §12)

Additive. Nothing above changes. Every call below exists on the object `createGlobe()` resolves to. Times are epoch ms unless a `Date` is shown.

## Instant first frame

```js
globe.situations({ cached: true }) → Promise<Situation[]>
  // resolves at once from the last good IndexedDB snapshot (written by every live
  // situations() call), else the bundled mobile/demo/snapshot.json (real data).
  // Each cached Situation adds: cached: true, cacheOrigin: 'device' | 'bundled',
  // capturedAt (epoch ms), live: false, thumbUrl (bundled /mobile/demo/thumbs/<id>.jpg
  // or a Cache API blob URL) or null.
globe.situations()                → Promise<Situation[]>   // live, as before (also saves the cache)
globe.cachedThumbnail(situation)  → string | null           // sync; thumbUrl for a cached card
globe.thumbnail(cachedSituation)  → resolves to the cached JPEG when the card has no live scene
```

The globe paints its first frame with imagery only. Live layers start right after it, and weather, transit, GNSS, Starlink and satellites start about a second later. Background warm-ups (jet, TCM, AQ, CCTV, rasters) start at 4 s.

## Recorder and time machine

```js
globe.history() → { start, end, entities, points, bytes }   // recorded range; start/end null when empty
globe.setTime(t)   // unchanged. Inside the recorded range, contacts are drawn at their interpolated
                   // recorded positions with 4-minute ghost trails (pickable: 'pick' kind is the
                   // contact's kind, meta.layer 'history', entityId). Beyond the record, dimmed as before.
globe.trackOf(entityId) → Promise<[{ t, lon, lat, altM, headingDeg, speed }]>
                   // recorder samples merged with /api/flights/track (OpenSky) or /api/military/track
                   // (adsb.lol traces); the array has .source

globe.playback.play({ speed = 60, from?, until? } = {}) → state
  // speeds: 1, 10, 30, 60, 600. From live it replays the last 15 min. Reaching "now" goes live;
  // inside a Moment it stops at the Moment's end.
globe.playback.stop() → state
globe.playback.state() → { playing, speed, t, live }
globe.playback.speeds  // [1, 10, 30, 60, 600]
  // event 'playback' → state, on start/stop and every 250 ms while playing.
  // 'time' is also emitted every 250 ms while playing ({ live:false, time, playing:true }).
  // Playing runs the render loop; at rest the globe is request-render again.

globe.timeline({ from, to } = {}) → [{ t, kind, band, title, severity, situationId?, entityId?, momentId?, lon?, lat? }]
  // kind: 'quake' | 'quake-cluster' | 'launch' | 'squawk' | 'cyclone' | 'fire' | 'circling'
  //       | 'lightning' | 'moment' (a Moment beat) | 'capture' | 'post' | 'chat-burst'
  // band: 'orbit' | 'sky' | 'ground' | 'inside'; severity 0..3; sorted by t.
  // Defaults to timeWindow(). Moment items appear for Moments that were loaded and overlap the range.
```

The recorder keeps every poll for low traffic (helicopters, approaches, anything below about 6 km) and one fix every 50 s for cruise traffic. Samples older than 30 min are thinned. The buffer is capped at 1.2 M samples (about 24 MB) and persisted to IndexedDB about once a minute, so a reload keeps up to 6 h. When OpenSky is down, the recorder also polls adsb.lol snapshots around New York, London, Los Angeles and the viewer every 15 s, so the detector has real data.

Entity ids are layer-qualified: `flights:<icao24>`, `military:<hex>`, `satellites:<norad>`, `earthquakes:<id>`, `cctv:<id>`, `vessels:<mmsi>`, `situation:<id>`, `place:<slug>`, `moment:<momentId>`, `moment:<momentId>:<trackId>`, `capture:<momentId>:<captureId>`. Every `'pick'` payload can be passed to `entity()` as is.

## Detection

Detections run on recorder data every poll. They appear only when real data shows them.

- `circling`: two or more aircraft (rotorcraft and low-and-slow preferred, below about 8,000 ft and 155 kt), each turning through at least 360° within about 1.5 km of a common centre in the last 20 min. Card: `{ kind:'circling', band:'sky', archetype:'track', title:'3 helicopters circling Midtown Manhattan', momentId:'live-circling-…', members:[{ key, layer, callsign, helicopter }], entityIds, detected:true }`. Its thumbnail draws the recorded orbit tracks. A single aircraft on its second full orbit is a lesser detection (severity 4.5, `single: true`, for example "Helicopter circling Las Vegas Strip"). `momentOfTheDay()` ignores single orbits.
- `quake-cluster`: three or more M2.5+ earthquakes within 50 km in 24 h. Archetype `number`, with a magnitude series.
- `squawk` cards now carry `momentId: 'live-squawk-<icao24>'`.

```js
globe.detections() → Situation[]    // current detections, sync
// event 'detections' → detector output, when the set of circling detections changes
```

## Moments

```js
globe.moments() → Promise<Moment[]>      // live (circling, squawks) first, then the bundled hero
globe.moment(id) → Promise<Moment|null>  // 'empire-state' | 'live-circling-…' | 'live-squawk-<hex>'
globe.momentOfTheDay() → Promise<Moment> // best live Moment if any, else the hero
globe.playMoment(idOrMoment, { speed, camera = true, autoplay = true, framing = 6 } = {}) → Promise<Moment>
  // speed defaults to moment.recommendedSpeed (hero: 30 → 50 s). camera:false leaves the camera alone.
  // framing: degrees the cinematic camera looks below the subject (puts it in the upper half).
  // Hides every live layer, draws tracks (glyph, 90 s bright trail, faint flown path, drop line),
  // capture view frustums that pop in at their t, the subject building and its beacon, and flies
  // the camera path keyed to the clock. Touching the globe releases the camera.
globe.exitMoment({ restoreCamera = true } = {})   // back to live (or the time before) and the old camera
globe.activeMoment() → { id, title, illustrative, t, start, end, playing, speed, cinematic, moment } | null
globe.seekMoment(t)            // epoch ms, or a 0..1 fraction of the Moment
globe.momentCamera(on = true)  // re-attach (or release) the cinematic camera → boolean
// event 'moment' → { type, item, t, momentId }
//   type: 'start' (item = Moment) | 'capture' | 'chat' | 'post' | 'beat' | 'end' | 'exit'
//         | 'camera' (item = { cinematic:false } when the person takes the camera)
//   Items fire as the clock passes them while playing, and on small seeks. A seek back, or a jump of
//   more than 90 s while paused, repositions silently: render the Live/Record lanes by filtering
//   activeMoment().moment.chat/posts/captures by t <= activeMoment().t.
```

```ts
Moment = {
  id, title, place, lon, lat,
  time: { start, end },                 // epoch ms
  illustrative: boolean,                // true for the bundled hero; false for live detections
  illustrativeNote?: string,
  recommendedSpeed?: number,
  subject?: { lon, lat, altM, label, roofM?, antennaM?, decks? },
  cameraPath: [{ t, lon, lat, height /* m above ground */, heading, pitch }],
  beats?: [{ t, title }],
  tracks:   [{ id, kind /* 'helicopter'|'aircraft' */, label, operator, callsign?, registration?, type?,
               color?, entityId? /* live: 'flights:<hex>' */, points: [{ t, lon, lat, altM /* MSL */ }] }],
  captures: [{ id, t, lon, lat, altM, headingDeg, pitchDeg, fovDeg, rangeM, title, handle, place,
               sealed, firstEyes?, kind /* 'photo'|'clip' */, image? }],
  chat:     [{ t, handle, text, badge? /* 'first-eyes'|'witness'|'local'|'pilot'|'met' */ }],
  posts:    [{ id, t, handle, kind /* 'witness'|'context'|'question'|'correction' */, text, votes, captureId? }],
  sources:  [{ name, detail }],
}
```

`playMoment`, `exitMoment` and `setTime(null)` are safe to call at any time, including mid-playback or while a load is still pending: a later call supersedes an earlier one, and the stage frees its primitives only after the frame in progress.

`labels()` collision-avoids each label as it will be drawn (`title · detail`). When a Moment label collides, it falls back to callsign plus altitude, then to the callsign alone. Such entries carry `abbreviated: true` and the shortened `title` and `detail`.

The hero is `mobile/demo/moments/empire-state.json` (id `empire-state`): "Climbers on the Empire State Building", 25 min, 3 helicopters, 8 captures, 120 chat lines and 12 posts. Regenerate it with `node mobile/demo/build-empire-state.mjs`. Its Midtown massing is real NYC Open Data footprints and roof heights in `mobile/demo/midtown-buildings.json` (`node mobile/demo/build-midtown.mjs`). Its river surfaces are OpenStreetMap water polygons in `mobile/demo/midtown-water.json` (`node mobile/demo/build-midtown-water.mjs`). They are drawn over Esri's mismatched water mosaic across the Hudson.

## Entities and dossiers

```js
globe.entity(ref) → Promise<Dossier>   // ref: entity id string, a 'pick' payload, or { kind, id }
Dossier = {
  id, kind, title, subtitle,
  identity: { icao24?, callsign?, registration?, type?, typeCode?, operator?, route?, country?, squawk?,
              norad?, intlDesignator?, tle?, mmsi?, provider?, magnitude?, illustrative?, ... },
  live: { lon, lat, altM, speed /* m/s */, heading, squawk?, updatedAt, speedKt?, elevationDeg? } | null,
  track: [{ t, lon, lat, altM }],
  events: [{ t, title }],
  links: [{ id, kind, title, relation, distanceKm? }],
  sources: [{ name, fetchedAt, url?, hash /* 'sha256:…' (or 'fnv1a:…' outside secure contexts) */, detail? }],
  privacy?: 'pia' | 'ladd' | 'no-public-identity',  // identity then holds only what the transponder broadcasts
  trackPending?: true,     // the server track was slow; call trackOf(id) later for the full one
  nextPass?: { start, max, end, maxElevationDeg, visible },   // satellites, for the viewer
  illustrative?: true,     // hero Moment tracks and captures
}
globe.search(query) → Promise<[{ id, kind, title, subtitle }]>   // ≤ 30; "N46567", "UAL", "7700",
  // "M5.2", "ISS", "Midtown", "empire"… across live aircraft, the record, satellites, quakes,
  // cameras, situations, places (neighbourhoods, airports, cities) and Moments
globe.graph(ref) → { center, nodes: [{ id, kind, title }], edges: [{ from, to, relation }] }   // ≤ 40 nodes, sync
```

Kinds: `aircraft`, `helicopter`, `military`, `satellite`, `vessel`, `quake`, `camera`, `situation`, `place`, `moment`, `track`, `capture`. There are never person entities. Aircraft dossiers wait at most 2.5 s for the server track (aircraft identity comes from adsbdb, 3.5 s budget).

## Reactions and attention

```js
globe.react({ lon, lat, kind: 'heart'|'fire'|'eyes'|'wow', count = 1, altM = 0 }) → number
globe.attentionHeat(points | null)    // points: [{ lon, lat, weight? }]; soft glow where viewers are
```

Reactions draw on a screen-space canvas that the globe owns (`.gev-reactions`, pointer-events none, above the globe and below your HTML). Each glyph stays anchored to its point as the globe moves. At most 300 are alive at once, and the canvas animates only while some are alive.

## Your sky now

```js
globe.skyNow({ lon, lat } = viewer) → Promise<{
  at, observer, sunElevationDeg,
  aircraft:   [{ id, title, kind, lon, lat, altM, distanceKm, elevationDeg, azimuthDeg, headingDeg, speedMps, squawk }],
  satellites: [{ id, title, norad, altKm, elevationDeg, azimuthDeg }],
  iss: { visibleNow, aboveHorizon, elevationDeg, azimuthDeg,
         nextPass: { start, max, end, maxElevationDeg, riseAzimuthDeg, visible } | null },
  sources: [string],
}>   // aircraft within 50 km, satellites above the horizon; each list sorted by elevation, highest first
```

## Dev harness

`mobile/globe/dev.html?moment=empire-state&speed=30` plays a Moment on load and prints its events in the HUD. `globe.debug` exposes `{ recorder, detector, stage, ghosts }` for tests. It is not part of the contract.

---

# Polish round

Additive. Nothing above changes.

## Bundled recording (the time machine always has ghosts)

`mobile/demo/history/{nyc,london,gulf}.json` hold a real recording of every aircraft over the New York area, London and the North Sea approaches, and the Gulf of Mexico, captured by `node mobile/demo/capture-history.mjs` (adsb.lol point snapshots around each region's anchors, the dev server's `/api/flights` and `/api/military` as fallbacks; one fix per 30 s below 6 km, per 120 s in cruise). Positions are quantised to 1e-4° and 10 m and delta-encoded (`format: 'gev-history/1'`). Timestamps are the true capture times and are **never shifted**: the time machine shows the recording where it happened.

The engine loads it about 5 s after the first frame into a second recorder (no expiry) and reads both through one view: ghosts, `setTime` history mode, `entity()`, `trackOf()` and `search()` see the recording; on a key present in both, the device's own recorder wins.

```js
globe.history().archive → { start, end, regions: [{ id, label, bbox, source, start, end, tracks,
                            busiest: { t, aircraft } }] } | null
globe.loadHistory()     → Promise<history().archive>          // resolves once it is loaded
globe.historyNear(t, lon, lat, km = 100)
  → [{ id /* entity id */, key, kind, title, lon, lat, altM }]  // recorded contacts at t, nearest first
// event 'history' → history(), once the recording is loaded
```

The time ribbon shades the recording in teal (`RECORDING · 23 OCT`) next to the device's own `RECORDED` range, and its readout names the day when the playhead is on another UTC day.

## Camera

```js
globe.flyTo({ lon, lat, height, heading, pitch, eye: true }); // eye: lon/lat/height place the camera itself
```

## Night close-ups

Below ~400 km, where Cesium's lighting is faded out, a night-side view grades the Esri mosaic toward night (darker, desaturated, slightly cooler) with a soft glow of the real Black Marble lights above ~40 km; the strength follows the sun's elevation under the camera at the **scene clock**, so a Moment keeps the lighting of its own time (the hero is daylight). A terrain watchdog falls back to the flat ellipsoid when the keyless terrain host stalls (the globe would otherwise show only the star field).

## Dossiers

`privacy` is set only for real privacy programmes (`'pia'`, `'ladd'` flags). An airframe with no public registry record gets `registryMissing: true` instead, and `identity.operator` falls back to the callsign's ICAO airline prefix (`mobile/globe/airlines.js`, about 150 operators).
