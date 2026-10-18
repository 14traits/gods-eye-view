# God's Eye — Mobile

_The window through which you see the world, and the eye through which the world sees itself._

This folder holds two things:

| Path | What it is | Tethered to production? |
| --- | --- | --- |
| [`mobile/index.html`](index.html) → `/mobile/` | **Prototype.** A working phone/foldable app that sets the design language on top of the real engine: CesiumJS, Esri cloudless imagery, NASA Black Marble night lights, Google Photorealistic 3D Tiles (when keyed), and the app's own live `/api` feeds (ADS-B, military, AIS, TLEs, quakes, FIRMS fires, cyclones, launches, CCTV) plus the bundled Bhote Koshi event pack. Capture is real: camera, IMU, GPS and a WebCrypto signature. | Yes. Runs on the existing dev server (`npm run dev`, open `http://localhost:4173/mobile/`). |
| [`mobile/vision/index.html`](vision/index.html) | **Vision.** A single self-contained file with no server, no keys and no production code. It shows where the product goes: the full feed, 4D reconstructions with collaborative hypotheses, the provenance ledger, holograms left in places, a hand-written WebGL globe with a cinematic post chain. | No. Open the file in any browser. |

---

## 1. The goal, rewritten

> Build the app people open **the moment something happens in the real world**, and the app they open **when nothing is happening** just to look.
>
> It must make 40+ live layers feel like one calm surface on a 6.9" phone, unfold into a two-pane instrument on a foldable, scrub the planet through time like a video, and let anyone with a phone add **signed, sensor-rich observations** that make reconstructions of real events harder to fake.

Five commitments fall out of that sentence:

1. **Situations, not layers.** The public does not think in feeds. They think in _things worth watching_: a cyclone, a launch, a flood, a chopper school, a stadium, an airport at rush hour. The home screen is a feed of situations. Layers are the ingredients a situation turns on for you.
2. **Click _into_ the world, not to the next card.** Opening a card is a spatial transition: the card's thumbnail is the globe, and it expands into the live globe at that place, at that time, with that situation's lenses on. Closing it folds the world back into the card. No page loads, no white flashes.
3. **Time is a first-class axis.** Every view has a scrubbable timeline (past ← now → forecast). Situations carry their own time window. Reconstructions are 4D: space × time × evidence.
4. **Truth needs walls.** Captures from this app are cryptographically signed at the moment of capture and carry the full session: IMU trace, GPS, heading, timestamps, device and sensor metadata, a hash chain. Foundation **observations** are kept separate from the **hypotheses** people (and AI) layer on top, and every change is in an inspectable audit trail.
5. **Cinematic by default, performant always.** Day and night blend across the terminator. High orbit gets the planetary treatment (cloudless day mosaic + night lights + atmosphere + bloom); close in, it becomes photorealistic 3D. The post chain is budgeted for a phone GPU, adapts to thermal state and battery, and drops to a still frame when nothing moves.

## 2. Information architecture

Five tabs. Capture is a tab, not a floating action, because it is a _mode_ with its own full-screen surface (HIG: tab bars navigate between peer areas; capture is a peer area here, as it is in Camera-first apps).

| Tab | SF-style glyph | Job |
| --- | --- | --- |
| **Now** | `dot.radiowaves` | A two-column, RedNote-style masonry feed of live and recent situations. Each card is a living thumbnail: real imagery of the place, live counters, a pulse when it changes. Sections: _Happening now_, _Near you_, _Reconstructions_, _Always on_ (chopper schools, busy airports, ISS, port of Rotterdam…). |
| **Globe** | `globe.americas` | The window. Full-bleed globe, the lens dock, the time ribbon, search. This is the expert surface. |
| **Capture** | `viewfinder` | Two modes on one dial: **Look** (AR — the God's-eye view projected around you: aircraft, satellites, ships, quakes as overlays on the camera, aligned by compass + gyro) and **Witness** (your phone becomes an eye for the God's eye: signed photo/video with IMU, GPS, heading, depth when available). |
| **Threads** | `point.3.connected.trianglepath.dotted` | Reconstructions people are building together: observations, hypotheses, AI refinements, and the ledger. |
| **You** | `person.crop.circle` | Your captures and their seals, holograms you left in places, situations you follow, alert radius. |

The iOS 26-era shell: a floating glass tab bar that shrinks to a pill while you scroll the feed and expands when you stop; a **tab-bar accessory** shows the one situation you are following live ("Typhoon · 185 km/h · 2 min ago"), like a now-playing bar for the planet.

## 3. Interaction model

- **Card → world (hero transition).** The tapped card's frame animates to full-screen while its static thumbnail cross-fades into the live globe already flying to the situation camera. The sheet rises to the medium detent with the situation brief. Swipe the sheet down or tap the back chevron to fold back to the card. Reduced Motion: cross-fade only.
- **Sheets with detents** (peek ≈ 96 pt / medium ≈ 45% / large ≈ 92%). Peek shows the headline numbers; medium shows the brief and the evidence strip; large shows the full thread. Dragging the globe while the sheet is at medium collapses it to peek, so the world always wins.
- **Lens dock.** 40+ layers live in eight families. The dock shows _family_ chips (Sky, Sea, Orbit, Hazards, Eyes, Ground, Weather, Infra); tapping a family opens a Control-Center-style grid of its layers with live counts. Long-press a family to solo it. The globe also curates by **semantic zoom**: at planetary altitude only aggregates render (density glows, cyclone cones, fire clusters); individual glyphs appear as you descend.
- **Time ribbon.** A thin, haptic-detented scrubber above the tab bar: −72 h ← NOW → +120 h (forecast). Event pips sit on the ribbon (the quake, the launch, the flood crest). Dragging fast moves in hours; slow, in minutes. Tapping NOW snaps back to live with a single tick haptic. In Live the ribbon breathes.
- **Pick anything.** Tap a contact on the globe: it's highlighted, a trail draws, and a compact card offers **Follow**, **Ride** (cockpit/bridge camera), **Nearest eye** (closest live camera), **Thread** (start or join a reconstruction).
- **Foldables & large screens.** Width ≥ 600 pt switches to a two-pane layout: feed/thread list on the leading pane, globe on the trailing pane; selection in one drives the other. With a vertical hinge (`horizontal-viewport-segments: 2`) the panes split exactly at `env(viewport-segment-right 0 0)` so nothing renders under the fold. Half-folded (tabletop, `vertical-viewport-segments: 2`): globe on top, controls and timeline on the bottom half, like a laptop.
- **One-handed reach.** All primary controls sit in the bottom 40% of the screen. Search lives in the tab bar row (iOS 26 pattern), not at the top.
- **Haptics & sound.** `navigator.vibrate` where available for ribbon detents and capture seal; never decorative.

## 4. Visual language

- **Ground:** near-black with a blue bias (`#05070B`), never pure grey. The globe is the only light source; UI is glass over it.
- **Glass:** `backdrop-filter: blur(24px) saturate(1.6)` panels with a 0.5 px inner highlight, 22–28 pt continuous corners, no drop shadows on glass.
- **Signal colors** carry meaning and are reserved: Sky `#7CC4FF`, Sea `#38E1C6`, Orbit `#C9A7FF`, Hazards `#FF6A3D`, Eyes `#FFD166`, Ground `#9BE15D`, Weather `#8AB4F8`, Infra `#B8C0CC`. Live = a soft pulse; Stale = desaturated with a dotted outline; Signed = a seal glyph in warm gold.
- **Type:** the system UI face (SF Pro / Roboto Flex via `system-ui`) for UI; tabular numerals for every live readout; a monospace for coordinates and hashes only. Large titles (34 pt) on Now and Threads, collapsing on scroll.
- **Tufte rule for reconstructions:** maximize data-ink. Small multiples for before/after, sparklines in-line with text, direct labels instead of legends, uncertainty drawn (cones, bands, dotted where inferred), and every number carries its source and age.

## 5. Rendering budget (phone)

| Item | Target |
| --- | --- |
| Frame | 60 fps while interacting, 0 fps (request-render mode) at rest |
| Resolution scale | `min(devicePixelRatio, 2)`, dropping to 1.5 / 1.25 when frame time > 20 ms for 2 s |
| Tiles | `maximumScreenSpaceError` 2 → 4 on compact; tile cache 256 MB → 128 MB |
| Post chain | atmosphere + night-lights blend (built into the globe shader) → FXAA → single-pass bloom (half res) → vignette + grade. Bloom and grain switch off under Low Power / thermal pressure |
| Labels | no Cesium labels; HTML/canvas overlay in screen space, capped at 40 visible |
| Data | each layer has an LOD rule (aggregate above 2,000 km altitude, glyphs below) and a visible-count cap |

## 6. Capture and provenance

A Witness capture produces a **sealed bundle**:

```
bundle = {
  media:     JPEG/WebM bytes                                   → sha256
  session:   { start, end, imu: [{t, α, β, γ, ax, ay, az}], gps: [{t, lat, lon, acc, alt}], heading }
  context:   { device, ua, screen, timezone, network-time-offset }
  prev:      sha256 of this device's previous bundle            (hash chain)
  hash:      sha256(canonical(media hash + session + context + prev))
  signature: ECDSA P-256 over hash, key generated on device, non-extractable, stored in IndexedDB
}
```

In a native build the key lives in the Secure Enclave / StrongBox and is bound to App Attest / Play Integrity, and the bundle is written as a C2PA manifest. The prototype does the browser-equivalent with WebCrypto so the flow, the data and the verification UI are real. Verification recomputes the hash, checks the signature against the device public key, and checks IMU/GPS plausibility (the motion trace must agree with the image's horizon and the compass heading; the GPS track must agree with the time). None of this proves truth. It raises the cost of lying.

## 7. Reconstructions (Threads)

A reconstruction is a document with three strata, always drawn in this order:

1. **Observations** — machine-sourced or signed: ADS-B/AIS tracks, satellite imagery, seismograph readings, signed captures. Immutable; each has source, time, hash.
2. **Hypotheses** — claims that connect observations ("this clip was filmed from the north bank at 14:02", "the aircraft entered a hold at 2,100 ft"). Each has an author (person or AI), confidence, the observations it cites, and agreement/disagreement counts.
3. **Narrative** — the story view: a camera path through space and time that cites hypotheses.

Collaborative AI prompting happens on stratum 2: a participant asks the model to refine ("align the witness clip to the corridor using the bridge as a landmark"). The model's output is a _proposed hypothesis_ with its prompt, model, inputs and diff recorded in the ledger. Nobody edits an observation; you can only cite, dispute, or supersede a hypothesis. The ledger is a hash chain anyone can export and verify.

## 8. Layer catalog (44)

| Family | Layers |
| --- | --- |
| Sky | Commercial flights · Military aircraft · Helicopters · Private/GA · Emergency squawks · Drones (Remote ID) · Airport boards · Holding patterns |
| Sea | AIS vessels · Ports · Tankers/cargo · Fishing effort · Dark vessels (AIS gaps) · Submarine cables |
| Orbit | Satellites (TLE) · ISS & crewed · Starlink trains · Launches & trajectories · Debris · Ground tracks & passes |
| Hazards | Earthquakes · Active fires (FIRMS) · Fire perimeters · Floods · Tropical cyclones · Volcanoes · Air quality |
| Eyes | Public CCTV · Signed captures · Street-level imagery · Holograms · Live streams |
| Ground | Transit vehicles · Traffic flow · Bike share · Rail · Events & venues · ALPR cameras |
| Weather | Radar · Clouds · Lightning · Wind · Forecast models |
| Infra | Datacenters · Dams · Power plants · Military installations · GNSS interference · Recent satellite imagery |

## 9. Situations worth monitoring (the feed's genres)

Live today with the repo's feeds: tropical cyclone tracks · largest quake in 24 h · fire clusters in Europe/California · military air activity over a region · ISS pass over you · busiest airport now · helicopter school circuits (Fort Novosel) · launch countdowns with trajectory · Bhote Koshi flood reconstruction · ships queuing at Suez/Panama/Singapore · GNSS jamming hot spots · transit at rush hour.

Ten more to build: stadium/concert 4D reconstructions from crowd captures · storm chasers with signed dashcams · emergency squawk 7700 replays · air-show displays · marathon/route races with runner trackers · eclipse path watch parties · aurora nowcasts with sky captures · ferry crossings and harbour pilots · wildfire smoke vs. air quality vs. hospital load · building-climb or rooftop incidents reconstructed from ADS-B news helicopters + witness video · protest/march route documentation with signed captures · volcano webcams vs. ash advisories · delivery-drone corridors (Prime Air style corridor replays).

## 10. Prototype architecture

```
mobile/
  index.html            entry served at /mobile/ (CSP: no inline script)
  main.js               boots the shell, lazy-loads the globe
  styles/               tokens.css, shell.css, feed.css, globe-ui.css, capture.css, threads.css
  globe/                Cesium engine for phones (owned by the globe agent)
    index.js            createGlobe(container, options) → Globe API (below)
    imagery.js          Esri day + Black Marble night blend, Google 3D tiles toggle
    post.js             mobile post chain + adaptive quality governor
    layers/*.js         live layers on top of the repo's /api routes
    situations.js       builds situation cards from live feeds (+ bundled Nepal)
  ui/                   shell, feed, sheet, lens dock, time ribbon, capture, threads, you
  capture/              camera, IMU, GPS, provenance (WebCrypto signing + verify)
```

### Globe API contract

```js
const globe = await createGlobe(containerEl, { quality: 'auto' });
globe.flyTo({ lon, lat, height, heading?, pitch?, duration? }) → Promise
globe.home()                              // planetary view
globe.layers()      → [{ id, family, name, on, count, status: 'live'|'stale'|'off'|'error' }]
globe.setLayer(id, on)
globe.setFamily(family, on)
globe.setTime(date | null)               // null = live
globe.timeWindow()  → { start, end, now }
globe.setLens(id)                         // 'cinematic' | 'clear' | 'night' | 'thermal' | 'nvg'
globe.focus(situation)                    // flies + applies situation.layers + time
globe.select(id | null)
globe.on(event, fn) / off                 // 'pick' {kind,id,title,subtitle,lon,lat,meta}
                                          // 'layers' (counts changed), 'camera' {lon,lat,height}
                                          // 'quality' {scale,fps}
globe.pause() / resume()                  // tab hidden / capture open
globe.contactsNear(lon, lat, km) → [{ kind, id, title, lon, lat, altM, headingDeg }]   // for AR
globe.situations()  → Promise<Situation[]>  // live feed cards
```

`Situation = { id, kind, family, title, subtitle, place, lon, lat, camera:{lon,lat,height,heading,pitch}, layers:[ids], time?:{start,end}, metrics:[{label,value,unit}], thumbnail: url, live:boolean, updatedAt, source }`.

Thumbnails use the keyless Esri World Imagery `export` endpoint for the situation's bounding box, so every card shows the real place.
