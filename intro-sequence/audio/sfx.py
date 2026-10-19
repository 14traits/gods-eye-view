#!/usr/bin/env python3
"""God's Eye View — First Light (v2): sound design, built to sit under a music track.

No melody, no beeps. Sub, air, metal, impacts, swells, data texture — a tech
thriller palette that leaves the mids for the score. Everything is synthesised
and placed against audio/cues.json (exported from src/timeline.js).

    python3 audio/sfx.py   -> audio/sfx.wav (48 kHz, 24-bit stereo)
"""
import json
import os
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, 'cues.json')))
T = C['T']
DUR = C['DURATION']
N = int(SR * DUR)
rng = np.random.default_rng(20261019)

B = {k: np.zeros((2, N)) for k in ('bed', 'hits', 'fx', 'ui', 'verb')}


def place(dst, sig, t, gain=1.0, pan=0.0, verb=0.0):
    if sig.ndim == 1:
        p = (pan + 1) * np.pi / 4
        sig = np.vstack([sig * np.cos(p), sig * np.sin(p)])
    i0 = int(round(t * SR))
    if i0 >= N:
        return
    s0 = max(0, -i0)
    i0 = max(0, i0)
    n = min(sig.shape[1] - s0, N - i0)
    if n <= 0:
        return
    seg = sig[:, s0:s0 + n] * gain
    B[dst][:, i0:i0 + n] += seg
    if verb > 0:
        B['verb'][:, i0:i0 + n] += seg * verb


def tt(d):
    return np.arange(int(d * SR)) / SR


def lp(fc, o=2):
    return signal.butter(o, min(fc, SR * 0.45), 'low', fs=SR, output='sos')


def hp(fc, o=2):
    return signal.butter(o, max(fc, 10), 'high', fs=SR, output='sos')


def bp(lo, hi, o=2):
    lo = max(lo, 10)
    hi = min(max(hi, lo * 1.05), SR * 0.45)
    return signal.butter(o, [lo, hi], 'band', fs=SR, output='sos')


def F(x, sos):
    return signal.sosfilt(sos, x, axis=-1)


def sweep(x, fn, kind='low', block=256):
    y = np.zeros_like(x)
    zi = None
    for b in range(0, len(x), block):
        fc = float(fn(b / SR))
        sos = lp(fc) if kind == 'low' else hp(fc) if kind == 'high' else bp(fc * 0.7, fc * 1.35)
        if zi is None:
            zi = signal.sosfilt_zi(sos) * 0
        y[b:b + block], zi = signal.sosfilt(sos, x[b:b + block], zi=zi)
    return y


def noise(d):
    return rng.standard_normal(int(d * SR))


def env_exp(d, k, a=0.002):
    t = tt(d)
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t * k)


def env_ar(d, a, r, c=2.0):
    t = tt(d)
    return np.minimum(np.clip(t / max(a, 1e-4), 0, 1) ** c, np.clip((d - t) / max(r, 1e-4), 0, 1) ** c)


def sine(f, d, ph=0.0):
    t = tt(d)
    if np.isscalar(f):
        return np.sin(2 * np.pi * f * t + ph)
    return np.sin(2 * np.pi * np.cumsum(f) / SR + ph)


def saw(f, d):
    t = tt(d)
    ph = f * t if np.isscalar(f) else np.cumsum(f) / SR
    return 2 * (ph - np.floor(ph + 0.5))


# ---------------------------------------------------------------- designed sounds
def tick(d=0.006, f=5000, q=0.6):
    """A dry, expensive-sounding UI tick: filtered noise, no pitch."""
    return F(noise(d) * env_exp(d, 1200, 0.0002), bp(f * (1 - q / 2), f * (1 + q)))


def granule(f=6000):
    d = 0.012 + rng.random() * 0.02
    return F(noise(d) * env_ar(d, 0.002, d * 0.8), bp(f * 0.8, f * 1.25))


def sub_boom(d=3.0, f0=55, f1=24, k=1.4):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t * 7)
    return sine(f, d) * env_exp(d, k, 0.003)


def metal(d=3.0, base=180.0, k=1.2):
    """Inharmonic struck-metal resonance — the cinematic 'tail'."""
    t = tt(d)
    out = np.zeros(len(t))
    for r, a in ((1.0, 1.0), (2.76, 0.6), (5.4, 0.45), (8.93, 0.3), (13.3, 0.2), (1.51, 0.5)):
        out += a * np.sin(2 * np.pi * base * r * (1 + 0.002 * rng.standard_normal()) * t + rng.random() * 6) * np.exp(-t * k * (0.6 + r * 0.25))
    return out / 3.0


def crack(d=0.4):
    return F(noise(d) * env_exp(d, 18, 0.0005), bp(400, 7000))


def impact(size=1.0, dark=0.0, tail=3.5, base=150):
    """Trailer hit: sub drop + body thud + noise crack + metallic tail."""
    d = tail + 0.5
    s = sub_boom(d, 62, 22, 1.1) * 1.0
    body = F(noise(0.5) * env_exp(0.5, 9, 0.001), lp(420)) * 0.9
    out = s
    out[: len(body)] += body
    c = crack(0.45) * (0.5 - dark * 0.35)
    out[: len(c)] += c
    m = metal(d, base * (1 - dark * 0.3), 1.0) * 0.28
    out += F(m, lp(4000 - dark * 2500))
    return np.tanh(out * 1.4 * size) * 0.8


def braam(d=4.0, root=36.71, bright=1400, gain=1.0):
    """Low, distorted brass-like swell — filtered and dirty, not synthy."""
    acc = np.zeros(int(d * SR))
    for mult in (1, 1.5, 2, 3):
        for det in (-0.01, 0, 0.012):
            acc += saw(root * mult * (1 + det), d)
    acc /= 10
    y = sweep(acc, lambda tc: 120 + bright * min(1, tc / 0.09) * np.exp(-max(0, tc - 0.09) * 1.3))
    y = np.tanh(y * 3.0) * env_ar(d, 0.015, d * 0.85, 1.2)
    return y * gain


def whoosh(d=1.0, f0=300, f1=4000, peak=0.55, width=0.06):
    x = noise(d)
    y = sweep(x, lambda tc: f0 * (f1 / f0) ** min(1, tc / d), 'band')
    t0 = tt(d)
    return y * np.exp(-((t0 / d - peak) ** 2) / width)


def swell(d=1.5, f0=200, f1=6000):
    """Reverse-swell into a hit."""
    x = noise(d)
    y = sweep(x, lambda tc: f0 * (f1 / f0) ** ((tc / d) ** 1.8), 'band')
    t0 = tt(d)
    m = metal(d, 220, 0.2)[::-1] * 0.25
    return (y + m) * (t0 / d) ** 2.6


def servo(d=0.6, f0=180, f1=420):
    t0 = tt(d)
    f = f0 + (f1 - f0) * np.sin(np.pi * t0 / d / 2)
    x = saw(f, d) + 0.4 * saw(f * 2.01, d)
    return F(x, bp(200, 2200)) * env_ar(d, 0.05, 0.12) * 0.5


def glitch(d=0.25):
    """Digital stutter: gated, bit-crushed noise and a buzzing carrier."""
    x = noise(d)
    gate = (np.sin(2 * np.pi * (35 + rng.random() * 40) * tt(d)) > 0).astype(float)
    crushed = np.round(x * 4) / 4
    buzz = np.sign(np.sin(2 * np.pi * (90 + rng.random() * 80) * tt(d))) * 0.3
    return F((crushed * 0.6 + buzz) * gate, bp(300, 9000)) * env_ar(d, 0.002, 0.03)


def drone_bed(d, notes=(36.71, 55.0, 73.42), lpf=180):
    t0 = tt(d)
    x = sum(np.sin(2 * np.pi * f * (1 + 0.0008 * k) * t0 + k) * (0.6 / (k + 1)) for k, f in enumerate(notes))
    x += F(noise(d), lp(lpf)) * 0.25
    return x


def tension(d, base=55.0):
    """Dissonant cluster, heavily low-passed: dread, not tune."""
    t0 = tt(d)
    x = np.zeros(len(t0))
    for r in (1.0, 1.059, 1.5, 2.12, 2.0):
        x += saw(base * r * (1 + 0.003 * np.sin(2 * np.pi * 0.07 * t0 * r)), d)
    x = F(x / 5, lp(380))
    return x * (0.7 + 0.3 * np.sin(2 * np.pi * 0.11 * t0))


def rotor(d, rate=5.6):
    t0 = tt(d)
    thump = (0.5 + 0.5 * np.sin(2 * np.pi * rate * t0)) ** 6
    x = F(noise(d), lp(220)) * thump * 1.6 + F(noise(d), bp(900, 3000)) * thump * 0.08
    return x


def jet(d):
    t0 = tt(d)
    whine = sine(2400 + 120 * np.sin(2 * np.pi * 0.2 * t0), d) * 0.04 + sine(3600, d) * 0.015
    roar = F(noise(d), bp(120, 900)) * 0.6
    return roar + whine


def wind(d):
    a = sweep(noise(d), lambda tc: 260 + 500 * (0.5 + 0.5 * np.sin(tc * 0.9)), 'band')
    b = sweep(noise(d), lambda tc: 300 + 600 * (0.5 + 0.5 * np.sin(tc * 0.7 + 1.3)), 'band')
    return np.vstack([a, b])


def squelch(d=0.35):
    x = F(noise(d), bp(800, 4500)) * env_ar(d, 0.005, 0.06)
    return x


def heartbeat(t, g=1.0):
    for dt, gg, f0 in ((0.0, 1.0, 64), (0.19, 0.55, 54)):
        d = 0.7
        t0 = tt(d)
        f = 30 + (f0 - 30) * np.exp(-t0 * 28)
        place('hits', sine(f, d) * env_exp(d, 7.5, 0.002), t + dt, g * gg, verb=0.2)


# =================================================================== the film
t_all = tt(DUR)
# bed: sub + air, riding an intensity curve, silent through the cut
inten = np.interp(t_all, [0, 4, 9, 16, 30, 43, 44, 72, 76.6, T['cut'] - 0.01, T['cut'], T['title'], T['title'] + 3, DUR - 2.5, DUR],
                  [0, 0.25, 0.4, 0.55, 0.65, 0.7, 0.55, 0.65, 0.75, 1.0, 0, 0, 0.6, 0.5, 0])
bed = drone_bed(DUR) * inten
B['bed'] += np.vstack([bed, bed]) * 0.32
airbed = np.vstack([F(noise(DUR), bp(2500, 11000)), F(noise(DUR), bp(2500, 11000))]) * 0.012 * inten
B['bed'] += airbed
# tension cluster under the indexing and the cities
tz = tension(DUR) * np.interp(t_all, [16, 20, 30, 31, 43, 44, 70, 76, 84.4, 84.41], [0, 0.5, 0.6, 0.35, 0.45, 0.6, 0.7, 0.8, 1.0, 0], left=0, right=0)
B['bed'] += np.vstack([tz, tz * 0.95]) * 0.22

# ACT 0 — console
hum = (sine(100, DUR) * 0.25 + F(noise(DUR), bp(80, 300)) * 0.05) * np.interp(t_all, [0.4, 1.2, T['collapse'], T['seed']], [0, 1, 1, 0], left=0, right=0)
place('fx', hum, 0, 0.12)
for k in C['boot']:
    if k['ch'] != ' ':
        place('ui', tick(0.006, 4200 + rng.random() * 2500), k['t'], 0.16, pan=(rng.random() - 0.5) * 0.3)
place('fx', swell(T['seed'] - T['collapse'] + 0.05, 300, 9000), T['collapse'], 0.35)
place('fx', glitch(0.18), T['collapse'], 0.25)
place('hits', impact(0.7, dark=0.6, tail=3.0, base=110), T['seed'], 0.8, verb=0.35)
for bt in (T['beat1'], T['beat2']):
    heartbeat(bt, 1.1)
# aperture: servos as the blades retract
place('fx', servo(1.2, 140, 360), T['aperture'], 0.22, -0.3, verb=0.2)
place('fx', servo(1.0, 160, 300), T['aperture'] + 0.25, 0.18, 0.3, verb=0.2)
for i in range(120):
    place('ui', tick(0.004, 7000 if i % 10 else 4200), T['dishDraw'] + (i / 120) * (T['dishDone'] - T['dishDraw']), 0.05 if i % 10 else 0.1, pan=np.sin(i / 120 * 6.28) * 0.8)

# ACT 1 — growth: organic granular crackle densifying
gs, ge = T['growStart'], T['growEnd']
for _ in range(2400):
    x = rng.random() ** 0.45
    tc = gs + x * (ge - gs + 0.3)
    k = (np.exp(3 * (tc - gs) / (ge - gs)) - 1) / (np.exp(3) - 1)
    if rng.random() > 0.15 + 0.85 * k:
        continue
    place('fx', granule(2000 + rng.random() * 7000), tc, 0.05 + 0.08 * rng.random() * (0.4 + k), pan=rng.uniform(-0.9, 0.9))
# radar sweep: a slow low whoosh per revolution
sweep_period = 2 * np.pi / 2.4
for i in range(int((T['substrate'] - gs) / sweep_period) + 1):
    place('fx', whoosh(sweep_period, 120, 900, 0.5, 0.12), gs + i * sweep_period, 0.08, pan=0.0)
place('fx', swell(1.6, 120, 5000), T['substrate'] - 1.6, 0.3)
place('hits', impact(0.9, 0.2, 4.0, 150), T['substrate'], 0.9, verb=0.35)
place('hits', braam(3.5, 36.71, 1100), T['substrate'], 0.35, verb=0.3)

# ACT 2 — indexing: tiles as data grains, captures as shutter clicks
for tl in C['tiles']:
    if not tl['vis'] or tl['t'] > 23.5:
        continue
    if tl['z'] == 5 and rng.random() > 0.3:
        continue
    place('ui', granule(3000 + rng.random() * 5000), tl['t'], {3: 0.07, 4: 0.04, 5: 0.025}[tl['z']], pan=tl['pan'] * 0.8)


def shutter(t, g=1.0, pan=0.0):
    place('fx', tick(0.008, 3800, 0.6), t, 0.45 * g, pan)
    place('fx', tick(0.014, 2100, 0.6), t + 0.045, 0.35 * g, pan)
    place('fx', F(noise(0.05) * env_exp(0.05, 60), lp(500)), t, 0.25 * g, pan)


for cp in C['caps']:
    if cp['slow']:
        shutter(cp['t'], 1.0, -0.3)
        place('fx', servo(0.9, 220, 900), cp['t'] + 0.3, 0.12, -0.3, verb=0.2)
        place('fx', whoosh(0.45, 900, 5000, 0.5), cp['t'] + 1.15, 0.16, 0.4)
    else:
        shutter(cp['t'], 0.5, 0.5)
# the flurry: shutters dissolving into a roar of capture
fl0, fl1 = T['flurry'], T['flurryEnd']
for i in range(420):
    u = rng.random() ** 0.6
    tc = fl0 + u * (fl1 - fl0)
    shutter(tc, 0.18 + 0.25 * u, rng.uniform(-0.9, 0.9))
sw_d = fl1 - fl0
spin = whoosh(sw_d, 150, 3500, 0.62, 0.05)
place('fx', np.vstack([spin, np.roll(spin, 900)]), fl0, 0.35)
place('fx', swell(1.2, 200, 8000), T['indexed'] - 1.2, 0.35)
place('hits', impact(1.1, 0.0, 4.5, 170), T['indexed'], 1.0, verb=0.4)
place('hits', braam(4.0, 36.71, 1800), T['indexed'], 0.4, verb=0.3)

# ACT 3 — feeds: each a designed arrival, not a beep
def feed(key, t):
    place('ui', tick(0.01, 3000), t, 0.25, -0.5)
    place('fx', whoosh(0.5, 2500, 400, 0.3), t - 0.05, 0.12, -0.4)
    if key == 'air':
        for _ in range(380):
            place('ui', tick(0.003, 6000 + rng.random() * 3000), t + rng.random() ** 0.7 * 1.6, 0.04 + rng.random() * 0.04, rng.uniform(-0.9, 0.9))
        place('fx', jet(1.6) * env_ar(1.6, 0.3, 1.0), t, 0.25, 0.3)
    elif key == 'sea':
        p = sine(820 * np.exp(-tt(2.5) * 0.06), 2.5) * env_exp(2.5, 2.0)
        place('fx', F(p, lp(2000)), t + 0.05, 0.12, 0.2, verb=0.9)
        place('fx', F(noise(2.0), lp(300)) * env_ar(2.0, 0.6, 1.2), t, 0.25)
    elif key == 'mil':
        place('fx', squelch(0.3), t + 0.05, 0.25, 0.4)
        place('fx', F(saw(48, 1.2), bp(60, 600)) * env_ar(1.2, 0.1, 0.8), t, 0.18)
    elif key == 'orbit':
        place('fx', whoosh(2.6, 2600, 160, 0.4, 0.1), t + 0.2, 0.3)
        place('hits', sub_boom(2.0, 48, 24, 2.0), t + 0.1, 0.5, verb=0.3)
        for _ in range(40):
            place('ui', granule(7000 + rng.random() * 4000), t + rng.random() * 2.0, 0.03, rng.uniform(-1, 1), verb=0.6)
    elif key == 'quake':
        for j, dt in enumerate((0.05, 0.45, 0.95)):
            place('hits', sub_boom(1.4, 50, 22, 3.0), t + dt, 0.6 - j * 0.12, verb=0.25)
        place('fx', F(noise(2.4), lp(90)) * env_ar(2.4, 0.2, 1.6), t, 1.0)
    elif key == 'fire':
        for _ in range(700):
            x = rng.random() ** 1.3 * 2.0
            place('fx', granule(700 + rng.random() * 4000), t + x, (1 - x / 2) * 0.1 * rng.random(), rng.uniform(-0.8, 0.8))
        place('fx', F(noise(2.0), bp(150, 1200)) * env_ar(2.0, 0.05, 1.5), t, 0.08)
    elif key == 'wind':
        place('fx', wind(2.6) * env_ar(2.6, 0.5, 1.5), t, 0.45)
    elif key == 'cable':
        buzz = F(saw(60, 1.5) + 0.5 * saw(120.4, 1.5), bp(300, 2500)) * env_ar(1.5, 0.02, 0.9)
        place('fx', buzz, t, 0.05, 0.2)
        place('fx', glitch(0.2), t, 0.12, -0.2)


for fd in C['feeds']:
    feed(fd['key'], fd['t'])
for t0, d in ((31.6, 1.8), (33.6, 2.2), (35.0, 2.2)):
    place('fx', whoosh(d, 200, 2400, 0.5), t0, 0.16, rng.uniform(-0.5, 0.5))

# ACT 4 — descent and the cities
place('fx', swell(1.4, 120, 9000), T['terrain'] - 1.4, 0.45)
place('fx', whoosh(1.2, 4000, 120, 0.7, 0.08), T['terrain'] - 1.0, 0.4)
place('hits', impact(1.0, 0.4, 3.5, 120), T['terrain'], 0.85, verb=0.4)
for c in C['cities']:
    t0, t1 = c['t0'], c['t1']
    d = t1 - t0
    if c['slug'] != 'everest':
        place('fx', glitch(0.22), t0 - 0.05, 0.35)
        place('hits', impact(0.6, 0.5, 2.5, 140), t0, 0.5, verb=0.3)
        place('fx', whoosh(0.6, 3000, 300, 0.25), t0 - 0.1, 0.25)
    amb = F(noise(d), bp(60, 400)) * env_ar(d, 0.4, 0.4) * 0.5
    place('fx', np.vstack([amb, np.roll(amb, 2000)]), t0, 0.25)
    if c['slug'] == 'everest':
        place('fx', wind(d) * env_ar(d, 0.6, 0.6), t0, 0.7)
        # LiDAR sweep: a soft rising tone per pass
        for i in range(int(d / (1 / 0.35 * 1.2 / 1.2)) + 1):
            place('fx', F(sine(np.linspace(300, 1200, int(1.2 * SR)), 1.2), bp(200, 1600)) * env_ar(1.2, 0.3, 0.6), t0 + i * 2.86, 0.03, verb=0.4)
    elif c['slug'] == 'nyc':
        traffic = F(noise(d), bp(80, 700)) * env_ar(d, 0.8, 0.5)
        place('fx', np.vstack([traffic, np.roll(traffic, 5000)]), t0, 0.22)
        place('fx', rotor(d) * env_ar(d, 1.0, 1.0), t0 + 0.2, 0.3, 0.4)
        for j in range(8):
            place('fx', tick(0.01, 2400), t0 + 2.2 + j * 0.35, 0.18, 0.7)
            place('fx', F(noise(0.1), bp(1500, 7000)) * env_exp(0.1, 25), t0 + 2.2 + j * 0.35, 0.05, 0.7)
    elif c['slug'] == 'boston':
        for j in range(4):
            place('fx', F(noise(1.4), bp(100, 900)) * env_ar(1.4, 0.4, 0.8) * (1 + 0.3 * np.sin(2 * np.pi * 9 * tt(1.4))), t0 + 0.6 + j * 1.0, 0.1, rng.uniform(-0.7, 0.7))
    elif c['slug'] == 'lax':
        place('fx', jet(d) * env_ar(d, 0.8, 0.8), t0, 0.35, -0.3)
        place('fx', whoosh(2.4, 200, 1400, 0.5, 0.1), t0 + 1.4, 0.3, 0.5)
    elif c['slug'] == 'bragg':
        place('fx', rotor(d, 4.6) * env_ar(d, 0.8, 0.8), t0 + 0.4, 0.25, -0.4)
        for j in range(3):
            place('fx', squelch(0.3), t0 + 0.8 + j * 1.3, 0.16, 0.5)

# the camera wall
wt = T['cctvWall']
place('hits', impact(0.9, 0.3, 3.0, 160), wt, 0.8, verb=0.3)
place('hits', braam(3.0, 36.71, 1400), wt, 0.3, verb=0.3)
for _ in range(100):
    tc = wt + rng.random() ** 0.8 * 0.85 + rng.random() * 0.12
    place('fx', tick(0.012, 2200 + rng.random() * 2000), tc, 0.14, rng.uniform(-0.95, 0.95))
    place('fx', F(noise(0.08), bp(1500, 8000)) * env_exp(0.08, 30), tc, 0.03, rng.uniform(-0.95, 0.95))
wd = T['cctvOut'] - wt + 0.3
place('fx', np.vstack([F(noise(wd), bp(800, 6000)), F(noise(wd), bp(800, 6000))]) * env_ar(wd, 0.4, 0.25), wt, 0.035)
for j in range(int((T['cctvOut'] - wt - 0.8) * 7)):
    place('ui', tick(0.006, 5200), wt + 0.8 + j / 7, 0.06, rng.uniform(-0.8, 0.8))
place('fx', whoosh(0.6, 5000, 150, 0.7), T['cctvOut'] - 0.1, 0.4)
place('hits', impact(0.9, 0.5, 3.0, 120), T['cctvOut'] + 0.4, 0.7, verb=0.35)

# ACT 5 — saturation: rising pressure, the breach, the state
sat0, cut = T['saturate'], T['cut']
sd = cut - sat0
t0s = tt(sd)
pos = 0.45 * t0s + 0.06 * t0s ** 2
sh = np.zeros(len(t0s))
for k in range(9):
    o = (k + pos) % 9
    a = np.exp(-((o - 4.5) ** 2) / (2 * 1.8 ** 2))
    sh += np.sin(2 * np.pi * np.cumsum(30 * 2 ** o) / SR) * a
sh = F(sh / 9 * 2, lp(2200)) * env_ar(sd, 2.0, 0.01, 1.3)
place('fx', sh, sat0, 0.3, verb=0.2)
place('fx', swell(sd, 120, 9000), sat0, 0.3)
# pulse of low hits accelerating toward the breach
tk = sat0 + 0.5
gap = 0.9
while tk < T['dishBreak'] - 0.2:
    place('hits', sub_boom(0.9, 58, 30, 4.0), tk, 0.35 + 0.35 * (tk - sat0) / sd)
    place('fx', F(noise(0.12), bp(500, 4000)) * env_exp(0.12, 30), tk, 0.08)
    tk += gap
    gap = max(0.22, gap * 0.86)
for st in C['status']:
    for j in range(16):
        place('ui', tick(0.005, 4500 + rng.random() * 1500), st + j * 0.026, 0.1, 0.4)
for _ in range(300):
    tc = T['twin'] + rng.random() ** 0.7 * (T['dishBreak'] - T['twin'])
    place('ui', granule(5000 + rng.random() * 5000), tc, 0.025, rng.uniform(-1, 1), verb=0.3)
db = T['dishBreak']
place('hits', impact(1.25, 0.0, 5.0, 190), db, 1.1, verb=0.45)
place('hits', braam(3.0, 36.71, 2600), db, 0.45, verb=0.4)
for _ in range(200):
    tc = db + rng.random() ** 2.2 * 1.1
    f = 2500 + rng.random() * 7000
    g = F(noise(0.25), bp(f * 0.97, f * 1.03)) * env_exp(0.25, 10 + rng.random() * 25)
    place('fx', g, tc, 0.16 * (1 - (tc - db) / 1.2), rng.uniform(-1, 1), verb=0.3)
place('hits', impact(1.0, 0.3, 4.0, 110), T['omni'], 0.8, verb=0.45)

# ACT 6 — title: low bloom, the eye, the word
ti = T['title']
d = DUR - ti
warm = drone_bed(d, (36.71, 55.0, 73.42, 110.0), 140) * np.interp(tt(d), [0, 0.8, 2.0, d - 3.0, d], [0, 0.4, 0.7, 0.6, 0])
place('bed', warm, ti, 0.3)
place('fx', swell(0.9, 400, 7000), T['eyeOpen'] - 0.9, 0.2)
place('hits', impact(0.8, 0.6, 5.0, 90), T['eyeOpen'], 0.6, verb=0.5)
place('fx', metal(6.0, 220, 0.5) * 0.4, T['eyeOpen'], 0.12, verb=0.7)
for j in range(36):
    place('ui', tick(0.006, 3500 + rng.random() * 4000), T['wordmark'] + j * 0.024, 0.07, rng.uniform(-0.4, 0.4))
place('hits', impact(1.0, 0.4, 6.5, 100), T['wordmark'] + 0.85, 0.8, verb=0.55)
place('hits', braam(6.0, 36.71, 900), T['wordmark'] + 0.85, 0.35, verb=0.5)
for j in range(11):
    place('ui', tick(0.008, 4000), T['tagline'] + j * 0.08, 0.1)
place('fx', metal(6.0, 330, 0.45) * 0.35, T['tagline'] + 0.9, 0.1, verb=0.8)

# =================================================================== reverb, mix, master
def ir(rt=3.6, pre=0.03):
    n = int((rt + pre) * SR)
    t0 = np.arange(n) / SR
    out = np.zeros((2, n))
    for c in range(2):
        x = rng.standard_normal(n) * np.exp(-6.9 * t0 / rt)
        l2 = F(x, lp(2200))
        m = np.clip(t0 / 1.2, 0, 1)
        out[c] = x * (1 - m) + l2 * m
        out[c, : int(pre * SR)] = 0
    return out / np.sqrt(np.sum(out ** 2) / 2)


R = ir()
wet = np.vstack([signal.fftconvolve(B['verb'][c], R[c])[:N] for c in range(2)])
dip = np.ones(N)
for ht, depth in ((T['substrate'], 0.3), (T['indexed'], 0.25), (T['terrain'], 0.3), (T['cctvWall'], 0.4), (T['dishBreak'], 0.2), (T['wordmark'] + 0.85, 0.4)):
    a, b, c = int((ht - 0.28) * SR), int((ht - 0.03) * SR), int((ht + 0.5) * SR)
    dip[a:b] = np.minimum(dip[a:b], np.linspace(1, depth, b - a))
    dip[b:c] = np.minimum(dip[b:c], np.linspace(depth, 1, c - b) ** 0.7)
mix = (B['bed'] + B['fx'] * 0.9 + B['ui'] * 0.8) * dip + B['hits'] * 1.2 + wet * 0.3
mix = F(mix, hp(22))


def stutter(x, a, b, sl=0.04):
    ia, ib, s = int(a * SR), int(b * SR), int(sl * SR)
    src = x[:, ia:ia + s].copy()
    for i in range(ia, ib, s):
        n = min(s, ib - i)
        x[:, i:i + n] = src[:, :n] * (0.9 if ((i - ia) // s) % 2 == 0 else 0.55)
    return x


mix = stutter(mix, cut - 0.22, cut)
ic, it = int(cut * SR), int(T['title'] * SR)
f = int(0.004 * SR)
mix[:, ic - f:ic] *= np.linspace(1, 0, f)
mix[:, ic:it] = 0

# gentle glue + ceiling
p = np.sqrt(np.convolve(np.mean(mix ** 2, axis=0), np.ones(4000) / 4000, mode='same') + 1e-12)
thr = 10 ** (-16 / 20)
g = np.where(p > thr, (thr * (p / thr) ** (1 / 1.8)) / p, 1.0)
g = signal.sosfiltfilt(lp(8), g)
mix *= g
mix = np.tanh(mix * 1.5) / 1.5
look = int(0.004 * SR)
pk = np.lib.stride_tricks.sliding_window_view(np.pad(np.max(np.abs(mix), axis=0), (0, look)), look + 1).max(axis=1)[:N]
ceil = 10 ** (-1.2 / 20)
lg = signal.sosfiltfilt(lp(60), np.minimum(1.0, ceil / np.maximum(pk, 1e-9)))
mix *= np.minimum(lg, 1.0)
mix *= ceil / max(1e-9, np.max(np.abs(mix)))
out = os.path.join(HERE, 'sfx.wav')
wavfile.write(out, SR, (mix.T * (2 ** 31 - 1)).astype(np.int32))
print('wrote', out, DUR, 's')
