# RPO replay: Cosmos 2612 → ICEYE-X36 (Sep 30 – Oct 21, 2026)

A 45-second, physics-grounded reconstruction of the Russian military satellite
Cosmos 2612 (NORAD 68762) maneuvering to within a few hundred meters of the
U.S.-registered ICEYE-X36 SAR satellite (NORAD 59103), rendered in CesiumJS
over Esri World Imagery and exported as 16:9 and 9:16 video.

```sh
python3 tools/rpo-replay/model.py          # orbit reconstruction -> data.json
python3 tools/rpo-replay/build_models.py   # procedural GLBs
node tools/rpo-replay/render.mjs --format 16x9 --stills 2,24,32   # spot checks
node tools/rpo-replay/render.mjs --format 16x9                    # all frames (resumable)
node tools/rpo-replay/render.mjs --format 16x9 --encode           # -> MP4
```

Formats: `16x9` (1920×1080), `9x16` (1080×1920), and `preview` / `preview-v`
at half size. Output goes to `output/rpo-replay/<format>/`. Requires
`pip install sgp4 numpy scipy pillow`, Playwright's Chromium (SwiftShader, no
GPU), and ffmpeg.

## What is measured and what is modeled

**ICEYE-X36** is propagated with SGP4 from its public CelesTrak element set
(`tles.txt`). X36 did not maneuver in this window.

**Cosmos 2612** has no public element-set history without an account, so its
path is a relative-orbit reconstruction about X36:

- Quasi-nonsingular relative orbital elements (δa, δλ, δe, δi), advanced
  with Keplerian along-track drift and the differential J2 node drift. The
  47 km "high park" is what swings Cosmos 2612's orbit plane into X36's.
  The model needs a 0.27° initial plane offset; published analysis gives
  ~0.22°.
- Burns are impulses through Gauss's variational equations. SMA changes are
  two half-orbit-apart tangential impulses. Each burn is timed inside the
  element-set window that KeepTrack, LeoLabs, and Marco Langbroek published.
- Solved checkpoints:
  - Oct 12 overhead pass, then 480 km behind.
  - ~400 km on Oct 15.
  - 3 km behind after the Oct 16 braking burn.
  - 2.0 / 0.99 / 0.72 / 0.60 km on Oct 17.
  - 5.1 km behind and 140 m higher at 07:38 Oct 18.
  - 293 km on Oct 19.
  - Matched SMA, 477–479 km behind, from Oct 21. This matches today's Cosmos
    2612 element set.
- The model gives ~60 m/s total Δv (KeepTrack estimates ~67 m/s). The
  closest approach comes out at **~325 m, 01:28 UTC Oct 18**, in Earth's
  shadow. Published estimates range 150–650 m. Langbroek gives ~01:35 UTC.

The 26 m and 25 m figures some outlets quoted come from element sets taken
after the departure burn, and KeepTrack rejects them. This replay does not
use them.

## Rendering conventions

- Camera and Earth ride with X36 on a slower "backdrop" clock during
  time-lapse to avoid strobing. Relative motion runs at the on-screen rate.
  Around closest approach the two clocks are identical, so lighting, shadow,
  and the following orbital sunrise are true to time.
- Up close, the spacecraft are drawn enlarged (the factor is on screen, capped
  at 150×). At closest approach they are at true scale.
- In Earth's shadow the models get a dim blue fill so their shapes stay
  readable.
- ICEYE-X36 is modeled to ICEYE's published Gen-3 dimensions: 3.2 × 0.4 m
  antenna, ~3.25 m span. No public imagery of Cosmos 2612's design exists, so
  its model is illustrative.

## Sources

- CelesTrak GP element sets for 59103 and 68762.
- KeepTrack, "Cosmos 2612 / ICEYE-X36 rendezvous" deep dive: burn windows,
  separations, SMA offsets.
- LeoLabs event report via Via Satellite, Oct 19, 2026.
- Marco Langbroek (SatTrackCam Leiden), quoted by Space.com, Aerospace Global
  News, and TWZ.
- Vantor image of the pair, Oct 17 (~1.02 km), published by Axios Oct 22.
- Imagery: Esri World Imagery; NASA GIBS VIIRS Black Marble (night side).
- Sky: Yale Bright Star Catalogue and ESO/S. Brunier Milky Way (see
  `src/data/local_data/sky/README.md`).
