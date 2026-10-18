#!/usr/bin/env python3
"""God's Eye View — First Light: procedural score and sound design.

Everything here is synthesised from scratch (no samples) and placed against
audio/cues.json, which tools/export-cues.mjs exports from src/timeline.js, so
every hit lands on its frame.

    python3 audio/score.py            -> audio/score.wav (48 kHz, 24-bit stereo)
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
rng = np.random.default_rng(20261018)

# ---------------------------------------------------------------- buses
def bus():
    return np.zeros((2, N), dtype=np.float64)

B = {k: bus() for k in ('drone', 'music', 'perc', 'hits', 'sfx', 'ui', 'verb')}


def place(dst, sig, t, gain=1.0, pan=0.0, verb=0.0):
    """Mix mono/stereo `sig` into bus `dst` at time t (s), equal-power pan."""
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


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def note(name):
    names = {'C': -9, 'C#': -8, 'Db': -8, 'D': -7, 'D#': -6, 'Eb': -6, 'E': -5, 'F': -4, 'F#': -3, 'Gb': -3, 'G': -2, 'G#': -1, 'Ab': -1, 'A': 0, 'A#': 1, 'Bb': 1, 'B': 2}
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[n] + (o - 4) * 12) / 12)


def sos_lp(fc, order=2):
    return signal.butter(order, min(fc, SR * 0.45), 'low', fs=SR, output='sos')


def sos_hp(fc, order=2):
    return signal.butter(order, max(fc, 10), 'high', fs=SR, output='sos')


def sos_bp(lo, hi, order=2):
    return signal.butter(order, [max(lo, 10), min(hi, SR * 0.45)], 'band', fs=SR, output='sos')


def filt(x, sos):
    return signal.sosfilt(sos, x, axis=-1)


def sweep_filter(x, cut_fn, kind='low', block=256, order=2):
    """Time-varying Butterworth: coefficients per block, state carried across."""
    y = np.zeros_like(x)
    zi = None
    for b in range(0, len(x), block):
        tc = b / SR
        fc = float(cut_fn(tc))
        if kind == 'low':
            sos = sos_lp(fc, order)
        elif kind == 'high':
            sos = sos_hp(fc, order)
        else:
            bw = fc * 0.35
            sos = sos_bp(fc - bw, fc + bw, order)
        if zi is None:
            zi = signal.sosfilt_zi(sos) * 0
        y[b:b + block], zi = signal.sosfilt(sos, x[b:b + block], zi=zi)
    return y


def saw(f, dur, phase=0.0):
    t = tt(dur)
    if np.isscalar(f):
        ph = f * t + phase
    else:
        ph = np.cumsum(f) / SR + phase
    return 2 * (ph - np.floor(ph + 0.5))


def sine(f, dur, phase=0.0):
    t = tt(dur)
    if np.isscalar(f):
        return np.sin(2 * np.pi * f * t + phase)
    return np.sin(2 * np.pi * np.cumsum(f) / SR + phase)


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def env_exp(dur, decay, attack=0.002):
    t = tt(dur)
    a = np.minimum(1, t / max(attack, 1e-4))
    return a * np.exp(-t * decay)


def env_ar(dur, attack, release, curve=2.0):
    t = tt(dur)
    up = np.clip(t / max(attack, 1e-4), 0, 1) ** curve
    down = np.clip((dur - t) / max(release, 1e-4), 0, 1) ** curve
    return np.minimum(up, down)


# ---------------------------------------------------------------- instruments
def click(freq=4000, dur=0.012, q=0.5):
    x = noise(dur) * env_exp(dur, 900, 0.0003)
    return filt(x, sos_bp(freq * (1 - q * 0.5), freq * (1 + q)))


def blip(f, dur=0.05, harm=0.25, decay=60):
    t = tt(dur)
    e = env_exp(dur, decay, 0.001)
    return (np.sin(2 * np.pi * f * t) + harm * np.sin(4 * np.pi * f * t)) * e


def thump(f0=70, f1=34, dur=0.9, decay=5.0, punch=24):
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t * punch)
    body = sine(f, dur) * env_exp(dur, decay, 0.001)
    tr = filt(noise(0.02), sos_lp(2500)) * env_exp(0.02, 200)
    out = body
    out[: len(tr)] += tr * 0.4
    return out


def braam(dur=4.0, notes=('D1', 'A1', 'D2', 'A2'), bright=2600, gain=1.0, decay=1.6):
    """Detuned saw stack through a fast-opening, slow-closing lowpass + drive."""
    n = int(dur * SR)
    acc = np.zeros(n)
    for nm in notes:
        f = note(nm)
        for d in (-0.012, -0.005, 0.0, 0.006, 0.013):
            acc += saw(f * (1 + d), dur, rng.random())
    acc /= len(notes) * 3.0
    cut = lambda tc: 160 + (bright - 160) * min(1.0, tc / 0.07) * np.exp(-max(0.0, tc - 0.07) * decay)
    y = sweep_filter(acc, cut, 'low', order=2)
    y = np.tanh(y * 2.2) * env_ar(dur, 0.012, dur * 0.85, 1.2)
    sub = sine(note(notes[0]) * np.ones(n) * (1 + 0.5 * np.exp(-tt(dur) * 18)), dur) * env_exp(dur, 1.3, 0.004)
    imp = filt(noise(0.6), sos_lp(900)) * env_exp(0.6, 9)
    out = y * 0.85 + sub * 0.9
    out[: len(imp)] += imp * 0.5
    return out * gain


def whoosh(dur=1.2, f0=400, f1=4000, peak=0.5):
    x = noise(dur)
    t0 = tt(dur)
    cut = lambda tc: f0 * (f1 / f0) ** min(1.0, tc / dur)
    y = sweep_filter(x, cut, 'band', order=2)
    shape = np.exp(-((t0 / dur - peak) ** 2) / 0.05)
    return y * shape


def riser(dur=3.0, f0=200, f1=6000):
    x = noise(dur)
    cut = lambda tc: f0 * (f1 / f0) ** ((tc / dur) ** 1.6)
    y = sweep_filter(x, cut, 'band', order=2)
    t0 = tt(dur)
    tone = sine(f0 * (f1 / f0 / 8) ** ((t0 / dur) ** 1.6) * np.ones_like(t0), dur) * 0.2
    return (y + tone) * (t0 / dur) ** 2.2


def shepard(dur, rate_oct_per_s, base=40.0, layers=9, accel=0.0):
    t0 = tt(dur)
    pos = rate_oct_per_s * t0 + 0.5 * accel * t0 ** 2
    out = np.zeros_like(t0)
    for k in range(layers):
        o = (k + pos) % layers
        f = base * 2 ** o
        a = np.exp(-((o - layers / 2) ** 2) / (2 * (layers / 5) ** 2))
        ph = np.cumsum(f) / SR
        out += np.sin(2 * np.pi * ph) * a
    return out / layers * 2


def fm_bell(f, dur=2.0, ratio=3.5, index=4.0, decay=2.5):
    t = tt(dur)
    e = env_exp(dur, decay, 0.002)
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t * 3)
    return np.sin(2 * np.pi * f * t + mod) * e


def pluck(f, dur=0.22, cutoff=1800, decay=14):
    x = saw(f, dur, rng.random()) + 0.5 * saw(f * 1.005, dur, rng.random())
    e = env_exp(dur, decay, 0.002)
    cut = lambda tc: 120 + cutoff * np.exp(-tc * 22)
    return sweep_filter(x * e, cut, 'low', block=128, order=2) * 0.7


def pad(freqs, dur, cutoff=900, attack=1.2, release=1.5):
    n = int(dur * SR)
    acc = np.zeros(n)
    for f in freqs:
        for d in (-0.004, 0.0, 0.0045):
            acc += saw(f * (1 + d), dur, rng.random())
    acc /= len(freqs) * 3
    y = filt(acc, sos_lp(cutoff, 2))
    return y * env_ar(dur, attack, release, 1.5)


def static(dur, lo=1500, hi=9000):
    return filt(noise(dur), sos_bp(lo, hi))


def stereo_noise_bed(dur, lo, hi):
    return np.vstack([filt(noise(dur), sos_bp(lo, hi)), filt(noise(dur), sos_bp(lo, hi))])


# =================================================================== ACT 0
# room tone that the whole film sits on
bed = stereo_noise_bed(DUR, 30, 140) * 0.05
ramp_bed = np.clip(tt(DUR) / 3.0, 0, 1)
B['drone'] += bed * ramp_bed

# sub drone: D1 + A1, breathing; intensity rises with the film, dies at the cut
t_all = tt(DUR)
intensity = np.interp(t_all, [0, 5, 9, 16, 30, 52, 60.4, 60.5, 61.2, 66, 72], [0.0, 0.25, 0.45, 0.6, 0.7, 0.85, 1.0, 0.0, 0.0, 0.7, 0.0])
dr = (np.sin(2 * np.pi * note('D1') * t_all) * 0.6 + np.sin(2 * np.pi * note('A1') * 1.001 * t_all) * 0.25 + np.sin(2 * np.pi * note('D2') * 0.999 * t_all) * 0.18)
dr *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.11 * t_all)
B['drone'] += np.vstack([dr, dr]) * intensity * 0.35

# electrical hum under the boot console
hum_e = np.interp(t_all, [0.4, 1.2, T['collapse'], T['seed']], [0, 1, 1, 0], left=0, right=0)
hum = (sine(100, DUR) * 0.3 + sine(150, DUR) * 0.12 + filt(noise(DUR), sos_bp(90, 400)) * 0.05) * hum_e
place('sfx', hum, 0, 0.18)

# keystrokes
for k in C['boot']:
    if k['ch'] == ' ':
        continue
    f = 3500 + rng.random() * 2500
    place('ui', click(f, 0.01), k['t'], 0.22 + rng.random() * 0.08, pan=(rng.random() - 0.5) * 0.3)
# "OK" confirmation
place('ui', blip(1760, 0.09) * 0.6 + blip(2640, 0.09) * 0.3, T['boot'] + 0.75 + 41 / 55, 0.25, verb=0.2)
# cursor appears
place('ui', blip(1200, 0.03), T['cursor'], 0.12)

# collapse: suck-in riser then silence, then the seed ignites
place('sfx', riser(T['seed'] - T['collapse'] + 0.05, 300, 9000)[::-1][::-1] * 1.0, T['collapse'], 0.35)
rev = whoosh(0.6, 6000, 300, 0.85)
place('sfx', rev, T['collapse'] - 0.15, 0.4)
place('hits', thump(90, 32, 1.4, 3.5), T['seed'], 0.85, verb=0.3)
place('ui', fm_bell(note('D6'), 2.5, 2.0, 1.5, 1.6), T['seed'], 0.16, verb=0.6)

# heartbeat
for bt, g in ((T['beat1'], 0.9), (T['beat2'], 1.0)):
    place('hits', thump(62, 30, 0.7, 7.5, 30), bt, g * 1.4, verb=0.25)
    place('hits', thump(52, 28, 0.6, 9, 30), bt + 0.19, g * 0.55, verb=0.2)

# dish ticks: 120 ticks swept around the ring, panned with the sweep
for i in range(120):
    k = i / 120
    # easeInOut timing of the sweep
    u = np.interp(k, np.linspace(0, 1, 400), [((4 * x ** 3) if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2) for x in np.linspace(0, 1, 400)])
    tk = T['dishDraw'] + u * (T['dishDone'] - T['dishDraw'])
    loud = 0.12 if i % 10 == 0 else 0.05
    place('ui', click(6500 if i % 10 else 3800, 0.008), tk, loud, pan=np.sin(k * 2 * np.pi) * 0.8)

# =================================================================== ACT 1 growth
gs, ge = T['growStart'], T['growEnd']
# granular crackle, density following exponential growth
for _ in range(2600):
    x = rng.random() ** 0.45  # skewed late
    tc = gs + x * (ge - gs + 0.3)
    k = (np.exp(3 * (tc - gs) / (ge - gs)) - 1) / (np.exp(3) - 1)
    if rng.random() > 0.15 + 0.85 * k:
        continue
    f = 1800 + rng.random() * 7000
    place('sfx', click(f, 0.006 + rng.random() * 0.01, 0.8), tc, 0.05 + 0.1 * rng.random() * (0.4 + k), pan=rng.uniform(-0.9, 0.9))
# organic tone: saw cluster gliding up an octave, filter opening
dur = ge - gs + 0.6
tg = tt(dur)
glide = note('D2') * 2 ** (((tg / dur) ** 1.8))
cl = (saw(glide, dur) + saw(glide * 1.007, dur) + saw(glide * 1.5, dur) * 0.4)
cl = sweep_filter(cl, lambda tc: 150 + 2200 * (tc / dur) ** 2, 'low', order=2)
cl *= env_ar(dur, 2.5, 0.35, 1.4) * 0.18
place('music', cl, gs, 1.0, verb=0.25)
# city pings as the culture learns names
for i in range(30):
    tc = 10.2 + (i / 30) ** 0.8 * 5.2 + rng.random() * 0.1
    place('ui', blip(2000 + rng.choice([0, 300, 500, 700, 1000]), 0.06, 0.2, 45), tc, 0.08, pan=rng.uniform(-0.8, 0.8), verb=0.25)
# reverse swell into the substrate hit
place('sfx', riser(1.6, 120, 5000), T['substrate'] - 1.6, 0.3)

# =================================================================== hits
place('hits', braam(4.5, ('D1', 'A1', 'D2'), 1800, 1.0, 1.4), T['substrate'], 0.75, verb=0.35)

# =================================================================== ACT 2 indexing
BPM = 120.0
beat = 60 / BPM
s16 = beat / 4
grid0 = 17.0

pattern = ['D3', 'D3', 'F3', 'D3', 'A3', 'D3', 'C4', 'D3', 'D3', 'D3', 'F3', 'D3', 'G3', 'D3', 'A3', 'F3']
prog = [('D', ['D3', 'F3', 'A3']), ('Bb', ['Bb2', 'D3', 'F3']), ('G', ['G2', 'Bb2', 'D3']), ('A', ['A2', 'C#3', 'E3'])]


def ostinato(t0, t1, cutoff_fn, gain_fn, transpose=0, every=1):
    i = 0
    t = t0
    while t < t1 - 1e-6:
        if i % every == 0:
            nm = pattern[i % 16]
            bar = int((t - grid0) / (beat * 8)) % 4
            f = note(nm) * 2 ** (transpose / 12)
            # follow the chord root on bar changes
            if prog[bar][0] == 'Bb' and nm == 'A3':
                f = note('Bb3')
            if prog[bar][0] == 'A' and nm == 'C4':
                f = note('C#4')
            acc = 1.0 if i % 4 == 0 else 0.7
            place('music', pluck(f, 0.25, cutoff_fn(t)), t, gain_fn(t) * acc, pan=0.25 if i % 2 else -0.25, verb=0.12)
        i += 1
        t += s16


ostinato(17.0, 29.9, lambda t: 500 + 2200 * ((t - 17) / 13) ** 1.5, lambda t: 0.06 + 0.1 * (t - 17) / 13)

# pads under indexing
for k, t0 in enumerate(np.arange(17.0, 30.0, 4.0)):
    nm, ch = prog[k % 4]
    place('music', pad([note(x) for x in ch], 4.3, 700 + k * 120, 1.0, 1.2), t0, 0.12, verb=0.3)

# tile flips: a spray of pitched blips, hemisphere in view only
scale = [note(x) for x in ('D6', 'F6', 'G6', 'A6', 'C7', 'D7')]
for tl in C['tiles']:
    if not tl['vis'] or tl['t'] > 26.5:
        continue
    z = tl['z']
    if z == 5 and rng.random() > 0.35:
        continue
    f = scale[rng.integers(0, len(scale))] / (2 if z == 3 else 1) * (1 if z < 5 else 1.5)
    g = {3: 0.07, 4: 0.04, 5: 0.025}[z]
    place('ui', blip(f, 0.05, 0.1, 70), tl['t'], g, pan=tl['pan'] * 0.8, verb=0.1)
    if z == 3:
        place('ui', click(3000, 0.012), tl['t'], 0.06, pan=tl['pan'] * 0.8)


def shutter(t, g=1.0, pan=0.3):
    place('sfx', click(3800, 0.008, 0.6), t, 0.5 * g, pan)
    place('sfx', click(2200, 0.014, 0.6), t + 0.045, 0.4 * g, pan)
    place('sfx', thump(160, 90, 0.05, 60, 80), t, 0.15 * g, pan)
    place('ui', blip(2637, 0.05, 0.1, 60), t + 0.07, 0.12 * g, pan)


for cp in C['caps']:
    if cp['slow']:
        t0 = cp['t']
        shutter(t0, 1.0, -0.35)
        # the enhance: rising sweep with data chatter
        d = 1.05
        tz = tt(d)
        f = 300 * (8 ** ((tz / d) ** 1.5))
        sw = sine(f, d) * 0.5 + sine(f * 1.5, d) * 0.15
        sw *= env_ar(d, 0.1, 0.15) * (0.7 + 0.3 * np.sin(2 * np.pi * 18 * tz))
        place('sfx', sw, t0 + 0.28, 0.06, -0.3, verb=0.2)
        for j in range(16):
            place('ui', blip(1500 + rng.random() * 3000, 0.02, 0, 120), t0 + 0.3 + j * 0.06, 0.05, rng.uniform(-0.6, 0.2))
        place('sfx', whoosh(0.5, 800, 5000, 0.5), t0 + 1.35, 0.18, 0.4)
        place('ui', click(5000, 0.01), t0 + 1.75, 0.2, 0.6)
    else:
        shutter(cp['t'], 0.55, 0.6)

# full-frame feature extraction
cf = T['capFull']
place('sfx', whoosh(0.7, 300, 3000, 0.4), cf, 0.3)
place('hits', thump(80, 40, 0.8, 6), cf + 0.5, 0.35, verb=0.3)
scan_d = 1.6
ts = tt(scan_d)
scan = (sine(220, scan_d) + 0.5 * sine(440 * (1 + 0.002 * np.sin(2 * np.pi * 6 * ts)), scan_d) + 0.3 * sine(1320, scan_d)) * env_ar(scan_d, 0.08, 0.2)
scan *= 0.6 + 0.4 * np.sin(2 * np.pi * 12 * ts)
place('sfx', scan, cf + 0.75, 0.07, 0, verb=0.2)
for j in range(70):
    place('ui', click(5000 + rng.random() * 3000, 0.006), cf + 0.75 + j * (1.6 / 70), 0.06, rng.uniform(-0.5, 0.5))
# collapse into the planet
place('sfx', riser(0.9, 300, 8000), T['indexed'] - 0.9, 0.4)
place('sfx', whoosh(0.5, 6000, 200, 0.8), T['indexed'] - 0.45, 0.35)

# SURFACE INDEXED
place('hits', braam(5.0, ('D1', 'A1', 'D2', 'F2'), 2600, 1.0, 1.1), T['indexed'], 0.95, verb=0.4)

# =================================================================== ACT 3 ingestion
ostinato(30.5, 52.4, lambda t: 900 + 2600 * min(1, (t - 30.5) / 18), lambda t: 0.09 + 0.06 * (t - 30.5) / 22)
# bass
for k, t0 in enumerate(np.arange(30.5, 52.4, beat * 2)):
    bar = int((t0 - grid0) / (beat * 8)) % 4
    root = {'D': 'D1', 'Bb': 'Bb0', 'G': 'G1', 'A': 'A1'}[prog[bar][0]]
    b = saw(note(root), 0.9) + saw(note(root) * 1.004, 0.9)
    b = filt(b, sos_lp(260)) * env_exp(0.9, 3.5, 0.005)
    place('music', b, t0, 0.22)
for k, t0 in enumerate(np.arange(30.5, 52.4, 4.0)):
    nm, ch = prog[k % 4]
    place('music', pad([note(x) for x in ch] + [note(ch[0][:-1] + str(int(ch[0][-1]) + 1))], 4.3, 1100, 0.8, 1.2), t0, 0.12, verb=0.3)
# percussion: low taiko-ish hits + ticks
for i, t0 in enumerate(np.arange(30.5, 52.4, beat)):
    if i % 4 in (0, 2) or (i % 8 == 7):
        place('perc', thump(95, 45, 0.5, 9, 40), t0, 0.45 if i % 4 == 0 else 0.3, verb=0.12)
    place('perc', click(9000, 0.02, 0.4), t0 + beat / 2, 0.06)
    if i % 4 == 2:
        sn = filt(noise(0.2), sos_bp(900, 4000)) * env_exp(0.2, 22) + sine(190, 0.2) * env_exp(0.2, 30) * 0.5
        place('perc', sn, t0, 0.13, verb=0.25)


def feed_sig(key, t):
    """Each feed gets its own sonic signature as it comes online."""
    place('ui', blip(1760, 0.06, 0.2, 40) + blip(2349, 0.06, 0.1, 40) * 0.6, t, 0.15, -0.5, verb=0.15)
    place('ui', click(4500, 0.01), t, 0.25, -0.5)
    if key == 'air':
        for j in range(500):
            x = rng.random() ** 0.7 * 1.9
            place('ui', click(5000 + rng.random() * 4000, 0.004), t + x, 0.05 + rng.random() * 0.05, rng.uniform(-0.9, 0.9))
        place('sfx', whoosh(1.4, 500, 7000, 0.35), t, 0.18, 0.3)
    elif key == 'sea':
        ping = sine(1150 * np.exp(-tt(2.2) * 0.05), 2.2) * env_exp(2.2, 2.2, 0.003)
        place('sfx', ping, t + 0.05, 0.22, 0.2, verb=0.8)
        place('sfx', ping, t + 1.05, 0.1, -0.3, verb=0.8)
        place('sfx', filt(noise(2.0), sos_lp(400)) * env_ar(2.0, 0.5, 1.2), t, 0.2)
    elif key == 'mil':
        for j in range(3):
            tone = (np.sign(np.sin(2 * np.pi * 740 * tt(0.12))) * 0.3 + sine(740, 0.12)) * env_ar(0.12, 0.005, 0.03)
            place('ui', filt(tone, sos_lp(3000)), t + 0.1 + j * 0.22, 0.12, 0.3)
            tone2 = (np.sign(np.sin(2 * np.pi * 554 * tt(0.12))) * 0.3 + sine(554, 0.12)) * env_ar(0.12, 0.005, 0.03)
            place('ui', filt(tone2, sos_lp(3000)), t + 0.21 + j * 0.22, 0.1, 0.3)
    elif key == 'orbit':
        for j in range(26):
            f = scale[rng.integers(0, len(scale))] * rng.choice([0.5, 1, 1])
            place('music', fm_bell(f, 2.5, 3.5, 2.5, 2.2), t + rng.random() * 2.2, 0.035, rng.uniform(-0.9, 0.9), verb=0.6)
        place('sfx', whoosh(2.8, 2500, 200, 0.4), t + 0.2, 0.3, 0)
        place('hits', thump(60, 30, 1.6, 2.5), t + 0.1, 0.4, verb=0.3)
    elif key == 'quake':
        for j, dt in enumerate((0.05, 0.42, 0.95)):
            place('hits', thump(55, 26, 1.4, 3.2, 18), t + dt, 0.6 - j * 0.12, rng.uniform(-0.5, 0.5), verb=0.25)
        place('sfx', filt(noise(2.5), sos_lp(90)) * env_ar(2.5, 0.2, 1.8), t, 0.9)
    elif key == 'fire':
        d = 2.2
        for j in range(900):
            x = rng.random() ** 1.3 * d
            g = (1 - x / d) * 0.12
            place('sfx', click(800 + rng.random() * 5000, 0.004 + rng.random() * 0.01, 0.9), t + x, g * rng.random(), rng.uniform(-0.8, 0.8))
        place('sfx', filt(noise(d), sos_bp(200, 1500)) * env_ar(d, 0.05, 1.6), t, 0.08)
    elif key == 'wind':
        d = 3.0
        w = sweep_filter(noise(d), lambda tc: 250 + 900 * np.sin(np.pi * tc / d), 'band', order=2)
        w2 = sweep_filter(noise(d), lambda tc: max(180, 300 + 700 * np.sin(np.pi * tc / d + 0.6)), 'band', order=2)
        place('sfx', np.vstack([w, w2]) * env_ar(d, 0.6, 1.6), t, 0.4)
    elif key == 'cable':
        d = 1.8
        buzz = filt(saw(60, d) + 0.5 * saw(120.5, d), sos_bp(300, 2500)) * env_ar(d, 0.02, 1.0)
        gate = (np.sin(2 * np.pi * 7 * tt(d)) > 0.2).astype(float)
        place('sfx', buzz * (0.4 + 0.6 * gate), t, 0.08, 0.2)
        place('sfx', sine(3000 * np.exp(-tt(0.25) * 12) + 150, 0.25) * env_exp(0.25, 12), t, 0.1, -0.2)
    elif key == 'cctv':
        for j in range(9):
            tc = t + 0.25 + j * 0.12
            place('sfx', click(2500, 0.01), tc, 0.3, rng.uniform(-0.7, 0.7))
            place('sfx', static(0.12) * env_exp(0.12, 25), tc, 0.05, rng.uniform(-0.7, 0.7))


for fd in C['feeds']:
    feed_sig(fd['key'], fd['t'])

# camera moves
place('sfx', whoosh(2.3, 200, 2500, 0.5), 33.6, 0.22, -0.4)
place('sfx', whoosh(2.8, 2200, 180, 0.5), 37.2, 0.22, 0.4)
place('sfx', whoosh(2.0, 300, 3000, 0.5), 40.4, 0.15, -0.2)

# THE WALL
wall_t = T['cctvWall']
place('hits', braam(3.5, ('D1', 'A1', 'D2'), 1900, 0.9, 1.6), wall_t, 0.85, verb=0.3)
for j in range(100):
    tc = wall_t + (rng.random() ** 0.8) * 0.85 + rng.random() * 0.12
    place('sfx', click(2000 + rng.random() * 2500, 0.012), tc, 0.18, rng.uniform(-0.95, 0.95))
    place('sfx', static(0.08) * env_exp(0.08, 30), tc, 0.04, rng.uniform(-0.95, 0.95))
wd = T['cctvOut'] - wall_t + 0.3
wbed = stereo_noise_bed(wd, 800, 7000) * env_ar(wd, 0.4, 0.25)
place('sfx', wbed, wall_t, 0.05)
murmur = (sine(15625 / 2, wd) * 0.02 + filt(noise(wd), sos_bp(100, 300)) * 0.4) * env_ar(wd, 0.3, 0.2)
place('sfx', murmur, wall_t, 0.12)
# the watcher hopping cell to cell (7 Hz)
for j in range(int((T['cctvOut'] - wall_t - 0.8) * 7)):
    tc = wall_t + 0.8 + j / 7
    place('ui', blip(3136, 0.025, 0.0, 90), tc, 0.06, rng.uniform(-0.8, 0.8))
# rapid list
for j, tc in enumerate(C['rapid']):
    place('ui', blip(note('D6') * 2 ** (j / 12 * 2), 0.06, 0.2, 45), tc, 0.12, -0.5, verb=0.15)
# collapse
place('sfx', whoosh(0.6, 5000, 150, 0.7), T['cctvOut'] - 0.1, 0.4)
place('hits', thump(80, 30, 1.6, 2.8), T['cctvOut'] + 0.4, 0.7, verb=0.35)

# =================================================================== ACT 4 saturation
sat0, cut = T['saturate'], T['cut']
# pulse intensifies: 16ths, then doubled at the octave
ostinato(52.5, cut, lambda t: 2400 + 3000 * (t - 52.5) / 8, lambda t: 0.12 + 0.06 * (t - 52.5) / 8)
ostinato(55.5, cut, lambda t: 3000, lambda t: 0.05 + 0.06 * (t - 55.5) / 5, transpose=12)
for i, t0 in enumerate(np.arange(52.5, cut, beat)):
    k = (t0 - 52.5) / 8
    place('perc', thump(100, 42, 0.55, 8, 40), t0, 0.5 + 0.25 * k, verb=0.15)
    if t0 > 55.0:
        place('perc', thump(100, 42, 0.4, 10, 40), t0 + beat / 2, 0.3 + 0.2 * k)
    if i % 2 == 1:
        sn = filt(noise(0.25), sos_bp(900, 5000)) * env_exp(0.25, 16) + sine(190, 0.25) * env_exp(0.25, 26) * 0.5
        place('perc', sn, t0, 0.18 + 0.12 * k, verb=0.3)
    # 32nd-note snare roll in the last bar
    if t0 > 58.4:
        for q in range(4):
            sn = filt(noise(0.08), sos_bp(1200, 6000)) * env_exp(0.08, 40)
            place('perc', sn, t0 + q * beat / 4, 0.1 + 0.05 * q)
for k, t0 in enumerate(np.arange(52.5, cut, 2.0)):
    nm, ch = prog[k % 4]
    place('music', pad([note(x) for x in ch] + [note(x[:-1] + str(int(x[-1]) + 1)) for x in ch], 2.2, 1600 + k * 300, 0.3, 0.6), t0, 0.14, verb=0.3)
# Shepard riser across the whole act
sd = cut - sat0
place('music', shepard(sd, 0.45, 40, 9, 0.12) * env_ar(sd, 2.5, 0.01, 1.3), sat0, 0.22, verb=0.2)
place('sfx', riser(sd, 150, 9000), sat0, 0.25)
# status lines type in
for st in C['status']:
    for j in range(14):
        place('ui', click(4000 + rng.random() * 2000, 0.008), st + j * 0.028, 0.12, 0.4)
    place('ui', blip(2093, 0.05, 0.2, 50), st + 0.42, 0.1, 0.4)
# lattice building shimmer
for j in range(400):
    tc = T['twin'] + rng.random() ** 0.7 * (T['dishBreak'] - T['twin'])
    place('ui', blip(4000 + rng.random() * 5000, 0.015, 0, 150), tc, 0.025, rng.uniform(-1, 1), verb=0.3)
# containment alarm
for j, tc in enumerate(np.arange(56.6, T['dishBreak'], 0.36)):
    k = (tc - 56.6) / (T['dishBreak'] - 56.6)
    tone = filt((np.sign(np.sin(2 * np.pi * 880 * tt(0.16))) * 0.4 + sine(880, 0.16)), sos_lp(2500)) * env_ar(0.16, 0.01, 0.05)
    place('ui', tone, tc, 0.04 + 0.08 * k, 0.0, verb=0.2)
    place('ui', filt((np.sign(np.sin(2 * np.pi * 660 * tt(0.16))) * 0.4 + sine(660, 0.16)), sos_lp(2500)) * env_ar(0.16, 0.01, 0.05), tc + 0.18, 0.04 + 0.08 * k, verb=0.2)
# the breach: impact + shattering ring
db = T['dishBreak']
place('hits', braam(3.0, ('D1', 'A1', 'D2', 'A2'), 3200, 1.0, 1.2), db, 1.0, verb=0.4)
place('hits', thump(120, 28, 2.5, 1.8, 14), db, 0.9)
for j in range(220):
    tc = db + (rng.random() ** 2.2) * 1.1
    f = 2500 + rng.random() * 7000
    gr = filt(noise(0.25), sos_bp(f * 0.97, f * 1.03)) * env_exp(0.25, 10 + rng.random() * 25)
    place('sfx', gr, tc, 0.18 * (1 - (tc - db) / 1.2), rng.uniform(-1, 1), verb=0.3)
# OMNIPRESENT
om = T['omni']
place('hits', braam(2.5, ('D1', 'D2', 'A2', 'D3'), 3800, 1.0, 0.8), om, 0.9, verb=0.45)
place('ui', fm_bell(note('A6'), 1.5, 2.0, 1.2, 2.0), om, 0.08, verb=0.5)

# =================================================================== ACT 5 title
ti = T['title']
# the hush after the cut, then a warm low bloom
d = DUR - ti
warm = (sine(note('D1'), d) * 0.6 + sine(note('A1') * 1.002, d) * 0.3 + sine(note('D2') * 0.998, d) * 0.2)
warm *= np.interp(tt(d), [0, 0.8, 2.0, d - 3.5, d], [0, 0.4, 0.7, 0.6, 0])
place('drone', warm, ti, 0.35)
air = stereo_noise_bed(d, 2000, 12000) * np.interp(tt(d), [0, 1.5, d - 3, d], [0, 1, 1, 0])
place('drone', air, ti, 0.012)
# eye opens
eo = T['eyeOpen']
place('sfx', riser(0.9, 400, 7000), eo - 0.9, 0.18)
place('hits', thump(70, 34, 2.5, 2.2), eo, 0.55, verb=0.4)
for f, g in ((note('D6'), 0.06), (note('A6'), 0.05), (note('E7'), 0.035), (note('D5'), 0.05)):
    place('music', fm_bell(f, 4.5, 2.0, 0.8, 0.8), eo, g, rng.uniform(-0.5, 0.5), verb=0.8)
# wordmark: decode chatter then the warm hit
wm = T['wordmark']
for j in range(40):
    place('ui', click(3000 + rng.random() * 4000, 0.007), wm + j * 0.022, 0.08, rng.uniform(-0.4, 0.4))
place('hits', braam(6.0, ('D1', 'A1', 'D2', 'E2'), 1400, 1.0, 0.5), wm + 0.85, 0.7, verb=0.5)
place('music', pad([note(x) for x in ('D3', 'A3', 'E4', 'F#4', 'A4')], 7.5, 1400, 1.5, 3.5), wm + 0.85, 0.16, verb=0.5)
# tagline keystrokes
tg_t = T['tagline']
for j, ch in enumerate('NO PLACE LEFT BEHIND.'):
    if ch != ' ':
        place('ui', click(3800 + rng.random() * 1500, 0.009), tg_t + j / 22, 0.14)
# ONLINE
on = T['online']
place('ui', blip(note('A5'), 0.12, 0.3, 18), on, 0.16, verb=0.5)
place('ui', blip(note('D6'), 0.35, 0.3, 8), on + 0.12, 0.16, verb=0.6)
place('hits', thump(60, 30, 3.5, 1.4, 10), on, 0.6, verb=0.5)
place('music', pad([note(x) for x in ('D2', 'A2', 'D3', 'E3', 'A3')], DUR - on, 900, 0.8, 3.5), on, 0.12, verb=0.4)

# =================================================================== reverb
def make_ir(rt60=3.4, pre=0.025):
    n = int((rt60 + pre) * SR)
    t0 = np.arange(n) / SR
    ir = np.zeros((2, n))
    for c in range(2):
        x = rng.standard_normal(n) * np.exp(-6.9 * t0 / rt60)
        # darker tail: blend toward a lowpassed copy over time
        lp = filt(x, sos_lp(2500))
        mix = np.clip(t0 / 1.5, 0, 1)
        ir[c] = x * (1 - mix) + lp * mix
        ir[c, : int(pre * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


ir = make_ir()
wet = np.vstack([signal.fftconvolve(B['verb'][c], ir[c])[:N] for c in range(2)])

# =================================================================== mix + master
# pre-hit dips: the bed drops out for a beat so each impact lands in a hole
dip = np.ones(N)
for ht, depth in ((T['substrate'], 0.3), (T['indexed'], 0.25), (T['cctvWall'], 0.4), (T['cctvOut'] + 0.4, 0.4), (T['dishBreak'], 0.2), (T['omni'], 0.45), (T['wordmark'] + 0.85, 0.4)):
    a, b, c = int((ht - 0.28) * SR), int((ht - 0.03) * SR), int((ht + 0.5) * SR)
    dip[a:b] = np.minimum(dip[a:b], np.linspace(1, depth, b - a))
    dip[b:c] = np.minimum(dip[b:c], np.linspace(depth, 1, c - b) ** 0.7)
bed_mix = (B['drone'] * 1.0 + B['music'] * 0.9 + B['perc'] * 0.8 + B['sfx'] * 0.9 + B['ui'] * 0.85) * dip
mix = bed_mix + B['hits'] * 1.25 + wet * 0.32
mix = filt(mix, sos_hp(24, 2))

# glitch stutter into the cut, then hard silence until the title
def stutter(x, a, b, slice_s=0.045):
    ia, ib = int(a * SR), int(b * SR)
    sl = int(slice_s * SR)
    src = x[:, ia:ia + sl].copy()
    for i in range(ia, ib, sl):
        n = min(sl, ib - i)
        x[:, i:i + n] = src[:, :n] * (0.9 if ((i - ia) // sl) % 2 == 0 else 0.6)
    return x


mix = stutter(mix, cut - 0.22, cut, 0.04)
ic = int(cut * SR)
it = int(T['title'] * SR)
fade = int(0.004 * SR)
mix[:, ic - fade:ic] *= np.linspace(1, 0, fade)
mix[:, ic:it] = 0
# collapse glitch: tiny stutter as the console implodes
mix = stutter(mix, T['collapse'] + 0.02, T['collapse'] + 0.14, 0.03)

# glue: slow RMS compressor, then soft clip and a lookahead peak limiter
def rms_env(x, win_s=0.05):
    w = int(win_s * SR)
    p = np.mean(x ** 2, axis=0)
    k = np.ones(w) / w
    return np.sqrt(np.convolve(p, k, mode='same') + 1e-12)


env = rms_env(mix, 0.08)
thr = 10 ** (-15 / 20)
ratio = 1.8
gain = np.where(env > thr, (thr * (env / thr) ** (1 / ratio)) / env, 1.0)
gain = signal.sosfiltfilt(sos_lp(8), gain)
mix *= gain
mix = np.tanh(mix * 1.6) / 1.6

look = int(0.004 * SR)
peak = np.max(np.abs(mix), axis=0)
peak = np.lib.stride_tricks.sliding_window_view(np.pad(peak, (0, look)), look + 1).max(axis=1)[:N]
ceiling = 10 ** (-1.2 / 20)
lg = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
lg = np.minimum.reduce([lg, np.roll(lg, 1), np.roll(lg, -1)])
lg = signal.sosfiltfilt(sos_lp(60), lg)
mix *= np.minimum(lg, 1.0)
mix *= ceiling / max(1e-9, np.max(np.abs(mix)))

out = os.path.join(HERE, 'score.wav')
wavfile.write(out, SR, (mix.T * (2 ** 31 - 1)).astype(np.int32))
print('wrote', out, f'{DUR}s', 'peak', np.max(np.abs(mix)))
