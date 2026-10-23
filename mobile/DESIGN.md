# God's Eye — Mobile

_The window through which you see the world, and the eye through which the world sees itself._

This folder holds two things:

| Path                                            | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                | Tethered to production?                                                                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`mobile/index.html`](index.html) → `/mobile/`  | **Prototype.** A working phone/foldable app that sets the design language on top of the real engine: CesiumJS, Esri cloudless imagery, NASA Black Marble night lights, Google Photorealistic 3D Tiles (when keyed), and the app's own live `/api` feeds (ADS-B, military, AIS, TLEs, quakes, FIRMS fires, cyclones, launches, CCTV) plus the bundled Bhote Koshi event pack. Capture is real: camera, IMU, GPS and a WebCrypto signature. | Yes. Runs on the existing dev server (`npm run dev`, open `http://localhost:4173/mobile/`).                                                          |
| [`mobile/vision/index.html`](vision/index.html) | **Vision.** A single self-contained file with no server, no keys and no production code. It shows where the product goes: the full feed, 4D reconstructions with collaborative hypotheses, the provenance ledger, holograms left in places, a hand-written WebGL globe with a cinematic post chain.                                                                                                                                       | No. Open the file straight from disk in any browser (the dev server's CSP blocks its inline script). Rebuild it with `node mobile/vision/build.mjs`. |

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

| Tab         | SF-style glyph                          | Job                                                                                                                                                                                                                                                                                                          |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Now**     | `dot.radiowaves`                        | A two-column, RedNote-style masonry feed of live and recent situations. Each card is a living thumbnail: real imagery of the place, live counters, a pulse when it changes. Sections: _Happening now_, _Near you_, _Reconstructions_, _Always on_ (chopper schools, busy airports, ISS, port of Rotterdam…). |
| **Globe**   | `globe.americas`                        | The window. Full-bleed globe, the lens dock, the time ribbon, search. This is the expert surface.                                                                                                                                                                                                            |
| **Capture** | `viewfinder`                            | Two modes on one dial: **Look** (AR — the God's-eye view projected around you: aircraft, satellites, ships, quakes as overlays on the camera, aligned by compass + gyro) and **Witness** (your phone becomes an eye for the God's eye: signed photo/video with IMU, GPS, heading, depth when available).     |
| **Threads** | `point.3.connected.trianglepath.dotted` | Reconstructions people are building together: observations, hypotheses, AI refinements, and the ledger.                                                                                                                                                                                                      |
| **You**     | `person.crop.circle`                    | Your captures and their seals, holograms you left in places, situations you follow, alert radius.                                                                                                                                                                                                            |

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

| Item             | Target                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame            | 60 fps while interacting, 0 fps (request-render mode) at rest                                                                                                                         |
| Resolution scale | `min(devicePixelRatio, 2)`, dropping to 1.5 / 1.25 when frame time > 20 ms for 2 s                                                                                                    |
| Tiles            | `maximumScreenSpaceError` 2 → 4 on compact; tile cache 256 MB → 128 MB                                                                                                                |
| Post chain       | atmosphere + night-lights blend (built into the globe shader) → FXAA → single-pass bloom (half res) → vignette + grade. Bloom and grain switch off under Low Power / thermal pressure |
| Labels           | no Cesium labels; HTML/canvas overlay in screen space, capped at 40 visible                                                                                                           |
| Data             | each layer has an LOD rule (aggregate above 2,000 km altitude, glyphs below) and a visible-count cap                                                                                  |

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

| Family  | Layers                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Sky     | Commercial flights · Military aircraft · Helicopters · Private/GA · Emergency squawks · Drones (Remote ID) · Airport boards · Holding patterns |
| Sea     | AIS vessels · Ports · Tankers/cargo · Fishing effort · Dark vessels (AIS gaps) · Submarine cables                                              |
| Orbit   | Satellites (TLE) · ISS & crewed · Starlink trains · Launches & trajectories · Debris · Ground tracks & passes                                  |
| Hazards | Earthquakes · Active fires (FIRMS) · Fire perimeters · Floods · Tropical cyclones · Volcanoes · Air quality                                    |
| Eyes    | Public CCTV · Signed captures · Street-level imagery · Holograms · Live streams                                                                |
| Ground  | Transit vehicles · Traffic flow · Bike share · Rail · Events & venues · ALPR cameras                                                           |
| Weather | Radar · Clouds · Lightning · Wind · Forecast models                                                                                            |
| Infra   | Datacenters · Dams · Power plants · Military installations · GNSS interference · Recent satellite imagery                                      |

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

---

## 11. Round two: from weather app to God's Eye

Review notes on the first build: the feed showed one kind of picture (open ocean under a cyclone), the app read as a weather app, there was nowhere for people to talk, and capture stopped at a sealed photo. This section is the response. Where it disagrees with §1–§10, it wins.

### 11.1 Identity: space → sky → ground → inside

The app's subject is altitude. Every surface tells you **where the sensor is** and **how high it is**, from orbit down to street level and finally inside: a room, a cockpit, a person's own capture. That is the brand, and it replaces the weather-app palette of blue gradients and big temperature-style numbers.

| Altitude band             | Sensor                                                          | Telemetry burned into the frame               |
| ------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| **Orbit** · 400–36,000 km | satellites, ISS, launches, weather satellite IR                 | `ORBIT · 412 KM · 7.66 KM/S · PASS 21:04`     |
| **Sky** · 0–15 km         | ADS-B aircraft, helicopters, military, radar returns, lightning | `SKY · FL350 · 487 KT · SQ 7700`              |
| **Ground** · 0 m          | CCTV, traffic, transit, fires, quakes, floods                   | `GROUND · CAM 0412 · I-5 S · 14:02:11Z`       |
| **Inside** · you          | signed captures, live broadcasts, holograms, conversations      | `WITNESS · SEALED · ±4 M · 1.2 KM FROM EVENT` |

Visual rules:

- **Sensor framing.** Feed cards and the globe chrome use corner brackets, a hairline reticle, and a monospace telemetry strip burned into the image (coordinates, MGRS, UTC, sensor id, altitude). It is restrained: one strip per card, never a full military HUD.
- **Type.** Display: the system face, tight and heavy. Telemetry: a monospace face (JetBrains Mono, which the desktop app already loads) in small caps with tabular numerals. The monospace face is the voice of the instruments, not of the UI.
- **Color.** Ground stays near-black. Each altitude band has one signal hue: Orbit violet, Sky ice-blue, Ground amber, Inside warm gold for sealed. Hazard red is reserved for things that hurt people. No blue-gradient cards.
- **Imagery is evidence.** Thumbnails are composited from the layers that actually describe the situation (§11.2). A picture of empty ocean is never acceptable.

### 11.2 The feed: compelling, diverse, real

The Now feed is the global equivalent of a neighborhood safety feed: it tells you what is happening, where, how close, and who saw it. Diversity is a requirement. The feed mixes **card archetypes** and **altitude bands**, and never puts two cards of the same archetype or band side by side when it can avoid it.

Card archetypes:

1. **Sensor card**: a composited frame. The base is the Esri image of the place or GIBS satellite IR. On top go the real data layers (radar, lightning strikes, cyclone cone and track, flight trails, quake rings, fire hotspots and smoke direction from wind), with sensor framing and telemetry burned in.
2. **Eye card**: a real frame from the nearest public camera (`/api/cctv`), with a LIVE timestamp, camera id, and direction of view. This is the most Citizen-like card: you see the street.
3. **Track card**: one moving thing, such as an aircraft squawking 7700, a helicopter on its 14th circuit at Fort Novosel, or the ISS crossing your night sky. It shows a trail, a big readout, and a "ride along" call to action.
4. **Number card**: one striking fact with a sparkline. Examples: "4,812 lightning strikes in the last hour over the Gulf", "GNSS jamming over the Baltic, 340 aircraft affected".
5. **Witness card**: a signed capture or a live broadcast from a person. It shows the seal, the distance from the event, and the reply count.
6. **Room card**: a conversation that is heating up. It shows the top claim, its status (_Confirmed by 3 signed captures_ / _Disputed_), and the participants.

Situation genres to source from keyless layers. Each card must say its source:

- Cyclones (NHC cone, track and wind radii, GIBS IR)
- Severe-storm cells (radar plus lightning density)
- Heavy rain over a major city (radar)
- Jet-stream wind anomalies (GFS wind)
- Quakes (USGS, with intensity rings)
- Wildfires (FIRMS or EONET, with smoke direction from wind)
- Emergency squawks (7500, 7600, 7700)
- Military activity
- Helicopter schools
- Launches (pad and trajectory)
- ISS and Starlink passes over the viewer
- GNSS interference (`/api/gnss-integrity`)
- Transit at rush hour (`/api/transit`)
- Busiest airport arrivals
- Live public cameras at famous places (Times Square, Shibuya, Tower Bridge where available, otherwise any busy feed)
- Ship queues at chokepoints
- The Bhote Koshi reconstruction

### 11.3 Discourse: every situation has a room

People will talk about events anyway, on other platforms and without the evidence. The room puts the conversation **on the evidence**: anchored in space and time, and graded by how it was observed.

- **Structured posts.** Each post is one of: **Witness** (I saw or recorded this), **Context** (background, a link, a map), **Question**, **Correction**, or **Prediction**. The kind is chosen in the composer and drawn as an icon. Questions float to the top until answered.
- **Anchored.** A post can pin a place (a dot on the globe) and a time (a pip on the time ribbon). Tapping a post flies the globe there and scrubs the ribbon to that moment. Pinned posts appear in 3D as small speech glyphs at their location.
- **Earned badges, not follower counts.** Badges come from evidence:
  - _Was there_: a signed capture within N km and M minutes of the event.
  - _Sealed_: the post has a sealed attachment.
  - _Local_: the author's home area is set.
  - _Domain_: pilot, mariner, met, first responder, held as a verified credential.

  Posts are ordered by evidence first, then recency, never by follower count.

- **Community notes with bridging.** Any claim can get a note. A note becomes visible only when raters who usually disagree both rate it helpful (bridging-based ranking, as Community Notes does), which resists brigading.
- **AI synthesis, kept honest.** A pinned card at the top of every room is labelled **Known / Disputed / Unknown**. AI writes it from the observations and the posts, and every line cites its sources. It is regenerated as the room changes, with its prompt and inputs recorded in the ledger. It never states anything that has no citation.
- **Live layer.** While you are in a room, presence shows as small avatars, reactions float up the side, and a "N people watching" count appears. Rooms for live situations sit in the feed as Room cards.
- **Reply with evidence.** "Reply" offers **Capture** first and text second. The best answer to "is the bridge still standing?" is a sealed photo from 200 m away.

### 11.4 Capture: contribute a place, an event, or a live stream

Capture is how a person becomes a sensor. Four modes share one dial:

| Mode        | What it makes                                                                                                                                                                                                         | Trust tier                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Look**    | AR overlay of contacts around you. Nothing is recorded unless you tap.                                                                                                                                                | none                                                                                                             |
| **Witness** | A sealed photo or clip with the IMU, GPS and heading trace (§6).                                                                                                                                                      | **Sealed**                                                                                                       |
| **Live**    | A broadcast from your camera. It appears on the globe as an _eye_: a frustum cone at your position and heading, with live telemetry, watchable by the room. Every 10 s the stream is sealed as hash-chained segments. | **Sealed live**                                                                                                  |
| **Upload**  | A photo or video from your library. EXIF is read if present, then you place it on the map and set the time.                                                                                                           | **Unverified**: labelled as such everywhere, and it can never become an observation, only cited by a hypothesis. |

After the shutter comes the **attach sheet**. It suggests the situation you are probably at, from distance and time ("Typhoon Champi · 4.2 km from track", "Times Square camera · 180 m"). It offers "new place" if none fits, a post kind (Witness by default), an optional note, and whether to drop it as a **hologram** that others can find at this spot later. Posting puts the capture in that situation's room, and a Witness card in the feed when it is notable.

Privacy: faces and plates are blurred before upload by on-device detection (a native-build commitment, and a disclosed limitation in the web prototype). Your exact location is shared at the precision you choose (exact, 100 m, 1 km), and the seal still proves the exact value to verifiers without publishing it.

---

## 12. Round three: Gotham for everyone

Founder's brief for this round: take what made Palantir Gotham work, fix what Citizen got wrong, and build the window people open every day and the first app they open when something happens. The time slider does far more. Communication feels like Twitch chat meets an X community meets Reddit. Real data wherever possible, more realistic everywhere else. It is demoed on a Mac in Chrome's device mode, as a phone and as a tablet.

> No longer should the audit trail for physical reality be the dominion of nation states. We have the right to know, with the receipts attached.

### 12.1 What we take from Gotham

Gotham's power is not the map. It is that **everything is an object, every object has a history and links, and every view (map, timeline, graph, dossier) shows the same objects**. Select something anywhere and every view follows. Analysts build an investigation, share it, and every fact keeps its source.

| Gotham idea                          | God's Eye version                                                                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ontology of objects and links        | **Entities**: aircraft, vessels, satellites, cameras, places, events, captures and contributors (pseudonymous). Each has a **dossier**: identity, live state, track history, events, links and receipts. |
| Map + timeline + graph, synchronized | Globe, **time machine** and **link graph** share one selection and one clock.                                                                                                                            |
| Search to dossier                    | Universal search ("N46567", "7700", "Piccadilly", "M5.2", "ISS") opens a dossier, not a list of pins.                                                                                                    |
| Watchlists and alerts                | **Watch**: follow an entity or a place, and write alert rules in plain chips ("any squawk 7700 within 200 km of Home").                                                                                  |
| Investigations with provenance       | **Moments**: shareable 4D reconstructions whose every track, capture and claim carries its source and hash.                                                                                              |
| Audit log                            | The room ledger: every post, note, AI synthesis and vote is hash-chained and exportable.                                                                                                                 |

**The line we don't cross.** Gotham tracks people; we don't. Trackable entities are things that broadcast publicly (transponders, AIS, orbital elements), public infrastructure, and events. Contributors are pseudonymous. There is no face recognition and no person search, and aircraft on owner-privacy lists (LADD/PIA) are never named. This is the product's moral spine and a talking point, not a footnote.

### 12.2 What Citizen got wrong, and our incentives

Citizen grew on fear: an alert stream about crime near you, ranked by alarm, with little verification and a paid "Protect" upsell. Anxiety is the retention loop, rumor travels as fast as truth, and nobody is rewarded for being right.

Ours rewards **being right, early, with receipts**:

- **Signal, not followers.** A contributor's reputation (Signal) rises when their sealed captures are corroborated (cited by others, matched by sensor data such as ADS-B, radar or quakes) and falls when their claims are corrected. Signal weighs their votes and notes. Follower counts are not shown.
- **First eyes.** The first sealed capture of an event gets a permanent byline on the record ("First eyes: @harbor_cam_kid, 14:02:11Z, 180 m"). This is the reason to open the app and capture when something happens.
- **Need eyes.** Any room can request coverage at a place ("Is the 7th St bridge underwater?"). People nearby get one quiet ask; fulfilling it with a sealed capture earns Signal and the byline. This turns curiosity into coverage, which is the incentive structure Citizen never had.
- **Calm by default.** Notifications are severity-gated and local, "Nothing unusual near you" is a valid state, and half the feed is wonder (the ISS overhead, a launch, aurora, a helicopter school) so the daily habit is curiosity, not dread.
- **Ranking by evidence.** Sealed, corroborated, and close beats loud.

### 12.3 The daily loop

- **Today** (first tab) opens with a brief: "Your world · 7:42 AM": since you last looked (the three biggest changes), what's overhead tonight (ISS pass, launch window), your watched places and things, and **Today's Moment**, one 20-second 4D replay a day worth watching (a ritual, like a daily puzzle). Below the brief comes the situation feed (§11.2).
- **Your sky now.** One tap shows what is above you this minute: aircraft, satellites, the ISS. This is the most delightful hook in the app.
- **Watch.** Follow places (home, commute, a family member's city) and things (a tail number, a ship, the ISS). A followed thing's status rides in the tab-bar accessory.

### 12.4 When something happens: Moments

A **Moment** is a 4D reconstruction assembled around an event: tracks, sensor frames, sealed captures with their view cones, the chat, and the record, all on one clock.

- **Detected from real data.** When two or more aircraft circle the same point (news and police helicopters orbiting a scene), the engine raises a situation before any headline: "3 helicopters circling Midtown Manhattan". It also flags an emergency squawk, a cluster of quakes or a sudden lightning cell. These are real detections on live ADS-B and sensor feeds.
- **Replayable.** Open a Moment and the time machine replays it: helicopter tracks with trails, captures popping in at their timestamps with view cones pointing at the subject, chat replaying at its pace, and posts appearing as they were made.
- **Hero demo Moment: "Climbers on the Empire State Building".** An illustrative reconstruction with realistic synthetic tracks: two news helicopters and one police helicopter orbiting at 1,000–1,500 ft and radii of 400–700 m, with realistic speeds and turn rates. Witness captures from 34th St, 5th Ave and an office at 1 Penn are shown with their view cones, along with the chat and the record. It is clearly labelled illustrative. It shows exactly what the product does when this happens for real.

### 12.5 The time machine

The time ribbon becomes a time machine:

- **It remembers.** The app records every live contact's position each poll (a ring buffer persisted in IndexedDB, about 6 h). Scrubbing back shows where everything actually was, with ghost trails. A selected aircraft's full track comes from the server's track routes. The app also ships a **bundled real recording** (`mobile/demo/history/`, a few hours over New York, London and the Gulf of Mexico, captured with `capture-history.mjs`) so a first run already has ghosts to replay; it keeps its true timestamps and the time machine shows it where it happened (`RECORDING · <date>`).
- **Everything moves together.** Contacts, radar and lightning frames, quakes and fires appearing, cyclone positions, the sun, room posts, and captures all follow the clock.
- **Play.** Play/pause and 1×, 10×, 60× and 600× speeds; momentum scrubbing; detents at events; a **NOW** snap.
- **Event pips.** Pips from every layer are colour-coded by altitude band. Tapping one jumps to it.
- **Clip.** Select a range, then "Clip this Moment", which creates a shareable Moment with its receipts.

### 12.6 Talking: Live and Record

Two lanes in every room. This is the delineation that keeps the conversation both fun and true.

|                     | **Live** (Twitch)                                                                                                          | **Record** (Reddit and X)                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pace                | Fast, ephemeral, scrolls away                                                                                              | Considered, persistent, threaded                            |
| Shape               | One-line chat, emotes, @mentions, slow mode, viewer count                                                                  | Posts with kinds (§11.3), replies, quote-posts, attachments |
| Reactions           | Hearts, 🔥, 👀 and 😮 fly up the screen, **and rise from the reactor's location on the globe**: you see the world watching | Corroborate / Dispute votes weighted by Signal              |
| Badges              | Witness glow for people with a sealed capture nearby, plus First eyes                                                      | Was there, Sealed, Local, Domain                            |
| Becomes the record? | Only if it carries evidence or is promoted by corroboration                                                                | Yes, hash-chained in the ledger                             |

- **The clerk.** Every few minutes, AI summarizes the Live lane into "What chat is saying", with citations to messages, and posts it into the Record as a clearly labelled synthesis.
- **Crews.** Crews are persistent groups (X communities): "NYC Scanner Nerds", "Fort Novosel Alumni", "Gulf Storm Chasers". A crew has its own feed, members and rooms, and can co-watch a Moment together.
- **Watch parties.** Opening a live situation drops you into its Live lane, with presence and the heart stream. That is the "hearts flying" feeling, everywhere.

### 12.7 Tabs

**Today · Live · Capture · Rooms · You**

- **Today**: the brief plus the feed.
- **Live**: the globe, time machine and lenses.
- **Capture**: Look · Witness · Live · Upload, plus Need eyes requests near you.
- **Rooms**: live rooms, crews and Moments.
- **You**: Signal, receipts, captures, watchlist and alert rules.

Search (the tab-bar search button) leads to dossiers.

### 12.8 Demo mode

The demo is presented in Chrome's device toolbar on a Mac:

- **Instant first frame.** The last good situations and thumbnails are cached (IndexedDB) and a bundled snapshot of real data ships with the app (`mobile/demo/`, with its capture time shown). The app paints in under a second, then hydrates live.
- **Mouse and touch** work everywhere (drag sheets, scrub, pinch with trackpad).
- **Director.** Press `.` (or triple-tap the logo) to open a presenter menu that jumps to the beats of the story: Today → Your sky now → the Empire State Moment → the Live lane with hearts → Need eyes → Capture → Dossier and link graph → the time machine → tablet layout. Each beat sets up its state so the demo never depends on luck.
- **Honest labels.** Real data shows its source and age. Illustrative content (the hero Moment, simulated chat, example posts and crews) carries a small "Illustrative" or "Simulated" tag. A VC should see that the real parts are real.
