# God's Eye View — First Light

The intro sequence: God's Eye View coming online for the first time. A seed of
light on Null Island grows into a culture that turns out to be drawing the
planet. It then indexes the surface tile by tile, ingests every public feed,
and outgrows the dish it was grown in.

Every number on screen comes from a real snapshot: 5,550 aircraft from OpenSky,
15,928 satellites from CelesTrak, 246,411 fire detections from FIRMS, 10,120
quakes from USGS, GFS wind, 1,948 subsea cable segments, AIS from Kystverket and
Digitraffic, and 117 real public camera frames. Those cameras come from a
catalog of 16,607 across 18 keyless agencies. The imagery is Esri World Imagery
and NASA GIBS, fetched keyless. The score is synthesised from scratch and
frame-locked to the same clock as the picture.

## Acts

| Time | Act | What happens |
|---|---|---|
| 0–5 s | Void | Boot console types, then implodes into a point |
| 5–16 s | Seed / culture | Heartbeat, petri-dish ring. Mycelium grows out from 0°N 0°E; real night lights and coastlines light up as the front passes; the culture learns city names |
| 16–30 s | Indexing | Quadtree tiles z3→z5 index in with rising resolution; the sun model is applied; 24 synthetic Esri captures ("enhance" z13→z18); full-frame Sobel feature extraction over Midtown |
| 30–52 s | Ingestion | Aircraft, vessels, military, satellites, quakes, fires, wind and cloud, subsea cables, public cameras. Each feed has its own visual and sonic signature. Ends on the camera wall |
| 52–60 s | Saturation | Every layer at once, data arcs, the digital-twin lattice, and the dish ring's return; containment falls, the ring shatters, OMNIPRESENT |
| 61–72 s | Resolve | The planet becomes the iris of the logo. GOD'S EYE VIEW · NO PLACE LEFT BEHIND · ONLINE |

## Rebuild

```sh
npm install                                # three, playwright-core, satellite.js, fonts
python3 -m http.server 8765 --bind 127.0.0.1 &
# data + imagery snapshots (see data/SOURCES.md)
bash tools/fetch/fetch_basic.sh            # plus the other scripts in tools/fetch, tools/imagery
node tools/export-cues.mjs                 # film clock -> audio/cues.json
tools/render-all.sh 1920 1080 16x9         # deterministic frames -> out/video_16x9.mp4
tools/render-all.sh 1080 1920 9x16
tools/finalize.sh                          # score, -14 LUFS, mux -> out/final/
```

Single stills for review:
`node tools/render.mjs --w 1920 --h 1080 --frames 12s,30s,58.4s --out out/stills`

## Real-time / loading screen

`index.html?play` runs the same frames live in a GPU browser, driven by the audio
clock (the first click starts the sound). `?w=1080&h=1920&play` gives the
vertical cut.

## Layout

- `src/timeline.js`: the clock. Every visual and audio event keys off it.
- `src/main.js`: asset loading, camera choreography, per-frame state.
- `src/globe.js`: planet shader (substrate → growth → quadtree indexing → lit Earth), clouds, atmosphere.
- `src/lines.js`: coastline and mycelium growth fronts, cables, arcs, twin lattice.
- `src/layers.js`: aircraft, vessels, satellites, quakes, fires, wind particles, stars.
- `src/hud.js`: all typography and 2D: boot console, dish, captures, feed stack, camera wall, title.
- `src/post.js`: HDR composite, dual-filter bloom, lens, grain, glitch.
- `audio/score.py`: procedural score and sound design.
