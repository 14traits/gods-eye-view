#!/usr/bin/env python3
"""Reconstruct the Cosmos 2612 / ICEYE-X36 rendezvous (Sep 30 - Oct 22, 2026).

ICEYE-X36 is propagated with SGP4 from its public CelesTrak element set.
Cosmos 2612 is carried as quasi-nonsingular relative orbital elements (ROE)
about X36 and advanced with linearised Keplerian drift plus the differential
J2 node drift. Manoeuvres are tangential / normal impulses applied through
Gauss's variational equations, timed inside the element-set windows that
KeepTrack, LeoLabs and Marco Langbroek published. The final state is pinned
to Cosmos 2612's own current element set (479 km behind, matched SMA).

Output: data.json (60 s samples) consumed by scene.html.
"""

import json
import math
from datetime import datetime, timedelta, timezone

import numpy as np
from scipy.optimize import least_squares
from sgp4.api import Satrec, jday

HERE = __file__.rsplit('/', 1)[0]
MU = 398600.4418
RE = 6378.137
J2 = 1.08262668e-3

lines = open(f'{HERE}/tles.txt').read().split('\n')
cosmos_tle = Satrec.twoline2rv(lines[1], lines[2])
x36 = Satrec.twoline2rv(lines[4], lines[5])

A = (MU / (x36.no_kozai / 60) ** 2) ** (1 / 3)  # km
N_RAD_S = math.sqrt(MU / A ** 3)
N_DAY = N_RAD_S * 86400
INC = x36.inclo
V = N_RAD_S * A * 1000  # m/s orbital speed
# Differential node rate per unit da/a: dOmegadot = -3.5 * Omegadot * da/a
OMEGA_DOT = -1.5 * N_RAD_S * J2 * (RE / A) ** 2 * math.cos(INC)  # rad/s

T0 = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
T1 = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)
DT = 60


def utc(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def secs(d):
    return (d - T0).total_seconds()


def x36_state(t):
    d = T0 + timedelta(seconds=t)
    jd, fr = jday(d.year, d.month, d.day, d.hour, d.minute, d.second + d.microsecond / 1e6)
    e, r, v = x36.sgp4(jd, fr)
    assert e == 0
    return np.array(r), np.array(v)


def frame(r, v):
    R = r / np.linalg.norm(r)
    Nn = np.cross(r, v)
    Nn /= np.linalg.norm(Nn)
    return R, np.cross(Nn, R), Nn


def arg_lat(r, v):
    R, T, Nn = frame(r, v)
    node = np.cross([0, 0, 1], Nn)
    node /= np.linalg.norm(node)
    return math.atan2(np.dot(np.cross(node, R), Nn), np.dot(node, R))


# ---------------------------------------------------------------------------
# ROE dynamics. roe = [da, dl, dex, dey, dix, diy] (dimensionless, / a)
# ---------------------------------------------------------------------------

def drift(roe, dt):
    out = roe.copy()
    out[1] += -1.5 * N_RAD_S * roe[0] * dt
    out[5] += -3.5 * OMEGA_DOT * roe[0] * math.sin(INC) * dt
    return out


def impulse(roe, u, dvr=0.0, dvt=0.0, dvn=0.0):
    k = 1 / (N_RAD_S * A * 1000)
    out = roe.copy()
    out[0] += 2 * k * dvt
    out[1] += -2 * k * dvr
    out[2] += k * (math.sin(u) * dvr + 2 * math.cos(u) * dvt)
    out[3] += k * (-math.cos(u) * dvr + 2 * math.sin(u) * dvt)
    out[4] += k * math.cos(u) * dvn
    out[5] += k * math.sin(u) * dvn
    return out


def rtn(roe, u):
    da, dl, dex, dey, dix, diy = roe
    return A * 1000 * np.array([
        da - dex * math.cos(u) - dey * math.sin(u),
        dl + 2 * dex * math.sin(u) - 2 * dey * math.cos(u),
        dix * math.sin(u) - diy * math.cos(u),
    ])


def dv_for_da(da_km):
    return V * da_km / A / 2  # m/s total, split into two half-orbit impulses


PERIOD = 2 * math.pi / N_RAD_S
U_CACHE = {}


def u_at(t):
    key = round(t)
    if key not in U_CACHE:
        U_CACHE[key] = arg_lat(*x36_state(t))
    return U_CACHE[key]


def build(params):
    """Return (burns, simulate) from a parameter dict."""
    p = params
    burns = []

    def hohmann(t, da_km, label, de_vec=None):
        """Two tangential impulses half an orbit apart -> pure SMA change.

        de_vec optionally re-targets the relative eccentricity vector by
        splitting the impulses unevenly (a small radial-tangential trim)."""
        dv = dv_for_da(da_km)
        burns.append(dict(t=t, dvt=dv / 2, label=label))
        burns.append(dict(t=t + PERIOD / 2, dvt=dv / 2, label=label, second=True, de=de_vec))

    hohmann(p['t_sep30'], p['da_sep30'], 'Phasing raise')
    burns.append(dict(t=p['t_oct7'], dvn=p['dvn_oct7'], label='Plane trim'))
    hohmann(p['t_oct12'], p['da_oct12'], 'Descent to X36 orbit')
    hohmann(p['t_oct15'], p['da_oct15'], 'Closing burn')
    hohmann(p['t_oct16'], p['da_oct16'], 'Braking burn', de_vec=p['de_prox'])
    burns.append(dict(t=p['t_oct18a'], dvt=dv_for_da(p['da_oct18a']), label='Back-off'))
    hohmann(p['t_oct18'], p['da_oct18'], 'Departure burn')
    hohmann(p['t_oct19'], p['da_oct19'], 'Re-match orbit')
    burns.sort(key=lambda b: b['t'])
    return burns


def simulate(params, times):
    burns = build(params)
    roe = np.array(params['roe0'], dtype=float)
    t = 0.0
    bi = 0
    out = []
    roe_out = []
    for tt in times:
        while bi < len(burns) and burns[bi]['t'] <= tt:
            b = burns[bi]
            roe = drift(roe, b['t'] - t)
            t = b['t']
            u = u_at(t)
            roe = impulse(roe, u, dvt=b.get('dvt', 0), dvn=b.get('dvn', 0))
            if b.get('de') is not None:
                roe[2], roe[3] = b['de'][0] / (A * 1000), b['de'][1] / (A * 1000)
            bi += 1
        roe = drift(roe, tt - t)
        t = tt
        out.append(rtn(roe, u_at(tt)))
        roe_out.append(roe.copy())
    return np.array(out), np.array(roe_out), burns


# ---------------------------------------------------------------------------
# Timeline (UTC). Windows are the published element-set gaps.
# ---------------------------------------------------------------------------
OCT12_OVERHEAD = secs(utc('2026-10-12T00:10:00Z'))
LAP_DA = 47.0  # km, KeepTrack: "raised orbit by 47 km in total"
lap_rate = 1.5 * N_RAD_S * LAP_DA / A  # rad/s
t_sep30 = secs(utc('2026-09-30T11:00:00Z'))

params = dict(
    t_sep30=t_sep30, da_sep30=LAP_DA - 1.0,
    t_oct7=secs(utc('2026-10-07T10:30:00Z')), dvn_oct7=4.0,
    t_oct12=secs(utc('2026-10-12T01:30:00Z')), da_oct12=-(LAP_DA + 0.2),
    t_oct15=secs(utc('2026-10-15T03:00:00Z')), da_oct15=-2.3,
    t_oct16=secs(utc('2026-10-16T05:30:00Z')), da_oct16=2.48,
    de_prox=(0.0, 800.0),
    t_oct18a=secs(utc('2026-10-18T02:00:00Z')), da_oct18a=0.13,
    t_oct18=secs(utc('2026-10-18T12:26:00Z')), da_oct18=2.40,
    t_oct19=secs(utc('2026-10-19T20:00:00Z')), da_oct19=-2.45,
    roe0=[1.0 / A, 0.0, 0.0, 0.0, -0.032 * math.pi / 180, 0.0],
)


def sep_at(p, iso_list):
    ts = [secs(utc(s)) for s in iso_list]
    r, roe, _ = simulate(p, ts)
    return np.linalg.norm(r, axis=1) / 1000, r, roe


def dl_at(p, iso):
    _, _, roe = sep_at(p, [iso])
    return roe[0][1]


# 1) Initial along-track phase so the Oct 12 overhead pass (dl = -2 pi) is hit.
def f_phase(x):
    p = dict(params, roe0=[params['roe0'][0], x[0]] + params['roe0'][2:])
    return [dl_at(p, '2026-10-12T00:10:00Z') + 2 * math.pi]


params['roe0'][1] = least_squares(f_phase, [-0.5]).x[0]
# Undo the lap so dl is near zero afterwards (wrap): handled by subtracting 2 pi.
params['roe0'][1] += 2 * math.pi
# Wrap: overhead at Oct 12 is now dl=0.

# 1b) Initial relative inclination vector: the 47 km "high park" lets
#     differential J2 node drift close the plane; the Oct 7 normal burn
#     trims the rest. Fit so the plane angle is ~0.002 deg by Oct 16.
def f_plane(x):
    p = dict(params, roe0=params['roe0'][:4] + [x[0], x[1]])
    _, _, roe = sep_at(p, ['2026-10-16T12:00:00Z'])
    target = 0.002 * math.pi / 180 / math.sqrt(2)
    return [(roe[0][4] - target) * 1e5, (roe[0][5] - target) * 1e5]


params['roe0'][4:6] = list(least_squares(f_plane, [0.0, -0.002]).x)
plane0 = math.degrees(math.hypot(*params['roe0'][4:6]))

# 2) Oct 12 descent timing -> ~480 km behind once the drift stops.
def f_desc(x):
    p = dict(params, t_oct12=x[0])
    return [dl_at(p, '2026-10-12T06:00:00Z') * A + 480.0]


params['t_oct12'] = least_squares(f_desc, [params['t_oct12']]).x[0]

# 3) Oct 15 closing burn timing so drift is arrested ~3 km behind by the Oct 16 braking burn.
def f_close(x):
    p = dict(params, t_oct15=x[0])
    t16 = params['t_oct16'] + PERIOD
    d = (T0 + timedelta(seconds=t16)).isoformat()
    return [dl_at(p, d) * A + 3.0]


params['t_oct15'] = least_squares(f_close, [params['t_oct15']]).x[0]

# 4) Proximity phase: fit the residual SMA offset, relative e / i vectors to
#    published separations (Oct 17) and a sub-km closest approach early Oct 18.
CHECK = [
    ('2026-10-17T07:45:00Z', 2.1),
    ('2026-10-17T17:18:00Z', 0.85),
    ('2026-10-17T20:29:00Z', 0.64),
    ('2026-10-17T23:40:00Z', 0.64),
]


DE_PROX_M = 800.0  # KeepTrack: relative loops ~1.6 km tall after the braking burn


def prox_params(x):
    t16, da16, phi = x
    return dict(params, t_oct16=t16, da_oct16=da16,
                de_prox=(DE_PROX_M * math.cos(phi), DE_PROX_M * math.sin(phi)))


def window(start, end, step_min):
    t, out = utc(start), []
    while t < utc(end):
        out.append(t.isoformat())
        t += timedelta(minutes=step_min)
    return out


ca_window = window('2026-10-17T23:30:00Z', '2026-10-18T02:00:00Z', 1)
pre_window = window('2026-10-16T08:00:00Z', '2026-10-17T23:30:00Z', 4)
T_CA_TARGET = 75  # minutes after 00:00 -> 01:15 UTC (Langbroek ~01:35, KeepTrack ~01:10)


def f_prox(x):
    p = prox_params(x)
    d, _, roe = sep_at(p, [c[0] for c in CHECK] + ['2026-10-16T12:00:00Z'])
    res = [(d[i] - c[1]) / 0.5 for i, c in enumerate(CHECK)]
    res.append((roe[-1][1] * A + 3.0) / 0.3)
    dw, _, _ = sep_at(p, ca_window)
    k = int(np.argmin(dw))
    res.append((dw[k] - 0.20) / 0.02)
    res.append((k - 30 - T_CA_TARGET) / 15)
    dp, _, _ = sep_at(p, pre_window)
    res.append(max(0.0, 0.55 - dp.min()) / 0.02)
    return res


best = None
for phi0 in np.linspace(0, 2 * math.pi, 8, endpoint=False):
    f = least_squares(f_prox, [params['t_oct16'] - 1800, 2.49, phi0], x_scale=[600, 0.01, 0.3],
                      diff_step=[1e-4, 1e-4, 1e-3])
    if best is None or f.cost < best.cost:
        best = f
fit = best
params.update(prox_params(fit.x))
print('prox fit residuals', np.round(fit.fun, 2), 'x', fit.x)

# 5) Post-CA back-off so Oct 18 07:38 is ~5.1 km behind.
def f_back(x):
    p = dict(params, da_oct18a=x[0])
    d, r, _ = sep_at(p, ['2026-10-18T07:38:00Z'])
    return [d[0] - 5.1]


params['da_oct18a'] = least_squares(f_back, [0.13]).x[0]

# 6) Re-match burn so the state lands on the current element sets
#    (Oct 24: 479 km behind, SMA offset +0.017 km).
def pair_phase(iso):
    d = utc(iso)
    jd, fr = jday(d.year, d.month, d.day, d.hour, d.minute, d.second)
    _, rc, _ = cosmos_tle.sgp4(jd, fr)
    r, v = x36_state(secs(d))
    R, T, Nn = frame(r, v)
    return math.atan2(np.dot(np.cross(r, rc), Nn), np.dot(r, rc))


A_COSMOS = (MU / (cosmos_tle.no_kozai / 60) ** 2) ** (1 / 3)
END_DA = A_COSMOS - A
target_dl = pair_phase('2026-10-21T12:00:00Z')


def f_rematch(x):
    p = dict(params, t_oct19=x[0], da_oct19=END_DA - (params['da_oct18a'] + params['da_oct18'] + params['roe0'][0] * 0 + 0))
    return [(dl_at(p, '2026-10-21T12:00:00Z') - target_dl) * A]


# SMA bookkeeping: total offset after Oct 18 burns.
def sma_after(p, iso):
    _, _, roe = sep_at(p, [iso])
    return roe[0][0] * A


da_before_rematch = sma_after(params, '2026-10-19T12:00:00Z')
params['da_oct19'] = END_DA - da_before_rematch
params['t_oct19'] = least_squares(
    lambda x: [(dl_at(dict(params, t_oct19=x[0]), '2026-10-21T12:00:00Z') - target_dl) * A],
    [params['t_oct19']],
).x[0]

# ---------------------------------------------------------------------------
# Sample and export
# ---------------------------------------------------------------------------
times = np.arange(0, secs(T1) + 1, DT)
rel, roe, burns = simulate(params, list(times))
x36_pos = np.array([x36_state(t)[0] for t in times])

dist_km = np.linalg.norm(rel, axis=1) / 1000
# Chord distance for large phases: the ROE map is linear, so use the
# curvilinear placement for the true separation.
def true_sep(i):
    r, v = x36_state(times[i])
    R, T, Nn = frame(r, v)
    th = rel[i][1] / 1000 / np.linalg.norm(r)
    Rp = R * math.cos(th) + T * math.sin(th)
    pc = (np.linalg.norm(r) + rel[i][0] / 1000) * Rp + rel[i][2] / 1000 * Nn
    return np.linalg.norm(pc - r)


sep = np.array([true_sep(i) for i in range(len(times))])
ica = int(np.argmin(np.where(times > secs(utc('2026-10-17T12:00:00Z')), sep, 1e9)))

events = [
    dict(t='2026-09-30T11:00:00Z', key='raise'),
    dict(t='2026-10-12T00:10:00Z', key='overhead'),
]

burn_list = []
for b in burns:
    if b.get('second'):
        continue
    dv = abs(b.get('dvt', 0)) * (1 if b['label'] == 'Back-off' else 2) + abs(b.get('dvn', 0))
    burn_list.append(dict(t=(T0 + timedelta(seconds=b['t'])).isoformat().replace('+00:00', 'Z'),
                          label=b['label'], dv=round(dv, 2)))

total_dv = sum(b['dv'] for b in burn_list)
ca_t = (T0 + timedelta(seconds=float(times[ica]))).isoformat().replace('+00:00', 'Z')
# Refine CA with 2 s sampling
fine = list(np.arange(times[ica] - 120, times[ica] + 120, 2.0))
relf, _, _ = simulate(params, fine)
dfine = np.linalg.norm(relf, axis=1)
j = int(np.argmin(dfine))
ca_t = (T0 + timedelta(seconds=float(fine[j]))).isoformat().replace('+00:00', 'Z')
ca_m = float(dfine[j])
ca_rtn = relf[j].tolist()

# Vantor image: Oct 17, ~1.02 km. Pick the Oct 17 sample nearest 1.02 km in the afternoon.
# Vantor imaged optically, so the pair must be sunlit at capture.
def sun_dir(t):
    n = (T0 + timedelta(seconds=float(t)) - datetime(2000, 1, 1, 12, tzinfo=timezone.utc)).total_seconds() / 86400
    L = math.radians((280.46 + 0.9856474 * n) % 360)
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = L + math.radians(1.915) * math.sin(g) + math.radians(0.02) * math.sin(2 * g)
    eps = math.radians(23.439)
    return np.array([math.cos(lam), math.cos(eps) * math.sin(lam), math.sin(eps) * math.sin(lam)])


def sunlit(t):
    r = x36_state(t)[0]
    s = sun_dir(t)
    p = np.dot(r, s)
    return p > 0 or np.linalg.norm(r - p * s) > RE


lit = np.array([sunlit(t) for t in times])
mask = (times > secs(utc('2026-10-17T06:00:00Z'))) & (times < secs(utc('2026-10-17T23:59:00Z'))) & lit
iv = int(np.argmin(np.where(mask, np.abs(sep - 1.02), 1e9)))

out = dict(
    t0=T0.isoformat().replace('+00:00', 'Z'),
    dt=DT,
    a_km=A,
    x36=np.round(x36_pos, 4).ravel().tolist(),
    rel=np.round(rel, 2).ravel().tolist(),
    sep_km=np.round(sep, 4).tolist(),
    burns=burn_list,
    total_dv=round(total_dv, 1),
    ca=dict(t=ca_t, m=round(ca_m, 1), rtn=[round(v, 1) for v in ca_rtn]),
    vantor=dict(t=(T0 + timedelta(seconds=float(times[iv]))).isoformat().replace('+00:00', 'Z'),
                km=round(float(sep[iv]), 2)),
    lit=''.join('1' if v else '0' for v in lit),
    sma_offset_km=np.round(roe[:, 0] * A, 3).tolist()[::10],
)
json.dump(out, open(f'{HERE}/data.json', 'w'), separators=(',', ':'))

print(f'a = {A:.3f} km, period = {PERIOD/60:.2f} min')
print('burns:')
for b in burn_list:
    print('  ', b)
print('total dv', total_dv)
print('CA', ca_t, f'{ca_m:.0f} m', 'RTN', np.round(ca_rtn, 0))
print('Vantor', out['vantor'])
for iso in ['2026-10-05T12:00:00Z', '2026-10-12T00:10:00Z', '2026-10-12T06:00:00Z', '2026-10-15T00:00:00Z',
            '2026-10-15T12:00:00Z', '2026-10-16T06:00:00Z', '2026-10-16T12:00:00Z', '2026-10-17T07:45:00Z',
            '2026-10-17T17:18:00Z', '2026-10-17T20:29:00Z', '2026-10-17T23:40:00Z', '2026-10-18T07:38:00Z',
            '2026-10-19T07:32:00Z', '2026-10-21T12:00:00Z', '2026-10-22T12:00:00Z']:
    i = int(secs(utc(iso)) // DT)
    print(f'  {iso}  sep {sep[i]:9.2f} km  rtn(km) {np.round(rel[i]/1000, 2)}  dSMA {roe[i][0]*A:7.3f}')
print('plane angle at T0 deg', plane0)
print('target dl (Oct 21 from TLEs) km', target_dl * A, 'END_DA', END_DA)
