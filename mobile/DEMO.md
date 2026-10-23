# Running the mobile demo

## Start

```sh
npm install
npm run dev
```

Open `http://localhost:4173/mobile/` in Chrome. Open DevTools, turn on the device toolbar (Cmd+Shift+M), and pick a phone (iPhone 14 Pro Max is close to the 17 Pro Max at 430×932) or an iPad Pro (1024×1366). The two-pane tablet layout starts at 600 px wide.

No keys are needed. Load the page once before presenting: the first load compiles and caches, and later loads paint Today in under a second from the last good snapshot.

## Presenter keys

Press `.` to open the director. Press a key to jump to a beat. Each beat sets up its own state, so they can be run in any order.

| Key | Beat | What to say |
| --- | --- | --- |
| 1 | Today | The daily brief: since you last looked, today's Moment, your sky, your watch. |
| 2 | Your sky now | Everything above you this minute, from live ADS-B and orbital elements. |
| 3 | The Empire State Moment | A 4D reconstruction: helicopter tracks, sealed captures with view cones, chat and the record on one clock. Illustrative. |
| 4 | The Live lane, with hearts | Twitch-style chat over the city; reactions rise from where people are. Simulated chat. |
| 5 | Need eyes | A room asks for coverage; the first sealed answer earns the byline and Signal. |
| 6 | Capture | Look, Witness, Live and Upload, signed on the device. |
| 7 | Dossier of a live aircraft | Gotham-style: identity, live state, track, links, receipts. Real data. |
| 8 | Link graph | Everything that thing touches, synchronized with the globe. |
| 9 | Time machine at 60× | Replays a real bundled recording of London, NYC and the Gulf. |
| 0 | Clip this Moment | Select a range and clip it into a shareable Moment. |
| - | An alert, calmly | Severity-gated alert rules on live data. |
| = | Search to dossier | Search "7700" (or "ISS" if nothing is squawking) and open the result. |

`Esc` closes the top sheet. The director has a **Reset demo** action.

## What's real

| Real | Illustrative or simulated |
| --- | --- |
| Live aircraft, military, satellites, quakes, cyclones, fires, radar, lightning, wind, air quality, GNSS interference, transit, public cameras | The Empire State Moment (synthetic tracks over real NYC footprints) |
| Detections (circling, squawks, quake clusters) on live data | Chat in the Live lane, example posts, crews, and other contributors |
| The time machine's recording (this session's polling plus a bundled real recording from 23 Oct 2026, 08:25–11:06Z) | Need eyes requests from other people |
| Capture signing, hash chains and verification (WebCrypto on this device) | The room clerk (rules, not a model) |

Every illustrative or simulated surface carries a label in the app.

## Rehearse

Run the beats once on the presenting Mac before the meeting. On first load the keyless terrain host can be slow; if a close-up stays black for more than a few seconds, the engine falls back to flat terrain on its own.

Refresh the bundled data while `npm run dev` is running: `node mobile/demo/capture-snapshot.mjs --base http://localhost:4173` for the snapshot, and `node mobile/demo/capture-history.mjs --base http://localhost:4173 --minutes 150` for the recording (it writes every 5 minutes; behind a proxy, prefix it with `NODE_USE_ENV_PROXY=1`).
