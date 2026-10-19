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
