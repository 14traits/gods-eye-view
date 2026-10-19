# VCAM: a phone as the virtual camera

VCAM turns a phone on the same network into a handheld camera for the globe,
like Unreal's Live Link VCAM or Blender's VirtuCamera. Walk around the room
holding the phone and the app's camera moves with it. A motion scale decides
how big a step is: 1:1 walks the street, 1:100 is a drone, 1:1000 flies over
the city. The phone shows the app's render as a monitor, and **REC** records the
move as a take: a shot in the selected scene that replays, seeks and retimes
like any other shot.

## Using it

1. Open **SCENES › VCAM**. The card shows a QR code, a six-character code and
   the phone URL (`https://<this computer>:4174/`).
2. Scan the code with the phone's camera app, or open the URL and type the
   code. The phone and the computer must be on the same network.
3. The page warns about the certificate the first time (see [Trust](#trust));
   continue past it, or install the local certificate once.
4. Choose **START AR CAMERA** (6DoF) or **START GYRO CAMERA** (3DoF).
5. Hold the phone like a camera. The rig starts from wherever the globe camera
   is, so nothing jumps.
6. **REC** on the phone or in the card records a take. Takes are added to the
   scene selected in the Scenes panel.

| Control | Phone | Card | What it does |
| --- | --- | --- | --- |
| Motion scale | SCALE drawer | SCALE | World metres per phone metre, 0.01 to 100,000. Presets: 1:1 walk, 1:10 crane, 1:100 drone, 1:1000 flyover, 1:10000 orbit. Changing it never moves the camera. |
| Move stick | left | | Dolly and truck along the camera's heading, at 2.5 m/s × scale. |
| Crane · pan stick | right | | Raise or lower the rig; pan about the camera itself. |
| Hold | HOLD | HOLD / RESUME | Freeze the camera to reposition yourself (a clutch). Release re-anchors where the camera is. |
| Recenter | RECENTER | RECENTER | Keep the camera where it is and point the phone's current heading along it. |
| Smoothing | SCALE drawer | | Damps hand shake (0 raw to 100 heavy). |
| Height lock | SCALE drawer | | Ignore the phone's vertical motion. |
| Horizon lock | SCALE drawer | | Keep the horizon level (no roll). |
| Focal length | LENS drawer | LENS | 35 mm-equivalent, 12 to 400 mm. Recorded per sample. |
| Depth of field | LENS drawer | DEPTH OF FIELD | Thin-lens blur; tap the phone's picture to focus. |
| Aperture | LENS drawer | APERTURE | f/1.2 to f/22. |
| Record | ● | ● REC | Start and stop a take. |

The rig yields the camera whenever something else takes it, as scene playback
does: a search or route, a scene starting, Cockpit, or a mouse press or wheel on
the globe. It then reads **Held**. Tap HOLD on the phone (or RESUME) to continue
from wherever the camera now is. Cockpit refuses the camera, as it does for
scenes.

### Tracking: what each phone gets

| Phone and browser | Mode | Position | Rotation |
| --- | --- | --- | --- |
| Android Chrome with Google Play Services for AR | AR (WebXR `immersive-ar`) | tracked (6DoF) | tracked |
| iPhone Safari | Gyro (DeviceOrientation) | sticks only | tracked (3DoF) |
| Other browsers without WebXR AR | Gyro | sticks only | tracked |

iPhone Safari does not offer WebXR AR, so a web page cannot read ARKit's
position. Gyro mode tracks the phone's rotation and the sticks move it. WebXR
browsers that do offer `immersive-ar` on iOS get the AR mode automatically.

### Depth of field and the miniature look

The blur follows a thin-lens circle of confusion. Distances are divided by the
motion scale first, so the lens treats the world at the rig's size. At 1:1 a
city a kilometre away is effectively sharp, as it is through a real lens. At
1:1000 the same city focuses like a tabletop model and falls off like
tilt-shift miniature photography. Tap the phone's picture to set the focus
distance at that point.

## Takes in the Director

A take is a version-7 scene-document shot with a recorded track
([camera directions](DIRECTOR-CAMERA.md#recorded-tracks)). Each sample stores
time, position, heading, pitch, roll and focal length, about 30 per second. A
take holds at most 10,000 samples (about 5½ minutes); recording stops and
saves at that limit. Editing the shot's `durationSec` retimes the take: a longer
duration plays the same path in slow motion. Depth of field is stored in the
shot's `lens`. Takes export, import and share like any other shot.

Takes live in the browser's scene storage like other shots. A browser that
refuses to save a long take keeps it for the session and shows the usual
storage warning; use EXPORT PRESETS to keep it.

## Trust

Phones expose motion tracking only to secure (HTTPS) pages, so the phone
listener serves HTTPS with a certificate from a local certificate authority it
creates on first use (`.gev-cache/vcam/`, git-ignored, private keys owner-only).
The server certificate names this computer's current LAN addresses and is
reissued when they change; the CA stays the same.

- **Android Chrome:** continue past the warning once. AR and the live
  connection work.
- **iPhone Safari:** the page loads past the warning, but Safari refuses its
  WebSocket, so the phone falls back to HTTPS requests (an amber dot rather
  than green). It works with a little more latency. To trust the computer:
  open **Phone certificate** in the card (or the link on the phone's pairing
  page), allow the profile, install it under **Settings › General › VPN &
  Device Management**, then enable it under **Settings › General › About ›
  Certificate Trust Settings**.

The CA is constrained to sign server certificates only (path length 0). Remove
the profile from the phone, or delete `.gev-cache/vcam/`, to revoke it.

## How it is built

```
phone (HTTPS :4174)                    desktop app (http://localhost:4173)
  server/vcam/phone/*  ── pose JSON ──▶  relay  ──▶  /api/vcam/host (WebSocket)
                       ◀── state ─────          ◀──  src/vcam/controller.js
                       ◀── JPEG pull ──  newest frame only
```

- **`server/vcam/plugin.js`**: on the app's server, loopback-only routes behind
  the `/mcp` gate (`POST`/`DELETE /api/vcam/session`, `/api/vcam/ca.crt`, the
  host WebSocket). It starts a separate HTTPS listener (`VCAM_PORT`, default
  4174, on `VCAM_HOST`, default all interfaces) only when a session is created,
  and stops it two minutes after the last one ends. That listener serves the
  static phone page and the phone side of the relay, never the app or its
  provider proxies.
- **`server/vcam/relay.js`**: pairing and forwarding, independent of transport.
  The phone exchanges the six-character code (31 unambiguous characters, about
  30 bits, case and separators ignored) for its own key; eight wrong codes
  rotate every session's code and the card updates. Messages are JSON objects of
  at most 4 KiB, at most 120 a second with a burst of 240. The host's JPEG
  preview is held as the newest frame only; the phone pulls it, so a slow link
  drops frames instead of queueing them.
- **`server/vcam/tls.js`**: the local CA and server certificate, DER-encoded with
  `node:crypto`; there is no OpenSSL or dependency.
- **`server/vcam/phone/`**: the phone page. It uses a WebSocket when it can,
  otherwise POSTs poses (newest-wins) and listens on server-sent events. Poses
  are a quaternion and position in WebXR's Y-up frame (+x right, +y up, −z
  forward); gyro mode converts DeviceOrientation into the same frame.
- **`src/vcam/rig.js`**: the renderer-independent mapping from phone pose to an
  east-north-up camera offset and basis around a geographic anchor. Recenter,
  scale changes and stick moves shift the anchor rather than the phone's origin,
  so the camera stays continuous.
- **`src/vcam/controller.js`**: session lifecycle, camera ownership, per-frame
  placement (`scene.preUpdate`), recording and preview capture
  (`scene.postRender`, 720 px JPEG at 12 frames a second).
- **`src/scenes/cameraLens.js`**: focal length (frustum field of view) and the
  depth-of-field post-process stage, shared with scene playback.
- **`src/vcam/qr.js`**: a QR encoder (byte mode, level M, versions 1–10).

`node scripts/qa-vcam.mjs` drives all of it end to end against a running dev
server: the real phone page in gyro mode over the HTTPS fallback, a scripted
6DoF phone over a WebSocket, a take recorded and replayed, and camera handoff.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `VCAM_PORT` | `4174` | Phone listener port. |
| `VCAM_HOST` | `0.0.0.0` | Phone listener interface. Set an address to restrict it. |

The Docker image publishes only the app's port on loopback, so VCAM needs the
phone port published as well (see [SECURITY.md](../SECURITY.md)).

## Next

- Preview over WebRTC (`canvas.captureStream`) for lower latency and higher
  resolution, with the JPEG pull kept as the fallback.
- Bookmarks and a take browser in the phone UI; slate and take naming.
- Focus pulls and animated aperture recorded per sample.
- A full-quality offline render of a take (fixed-step, every frame).
- iPhone 6DoF through an ARKit companion (an App Clip or a small native app
  speaking the same relay protocol).
- Phone page translation through the app's catalogs.
