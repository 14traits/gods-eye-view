#!/usr/bin/env python3
"""GFS 1.0 deg 10 m wind U/V from NOAA's AWS Open Data bucket (noaa-gfs-bdp-pds) via .idx byte
ranges, same approach as server/providers/wind/gfs.js; decoded with python `eccodes` (pip).
Usage: python fetch_wind.py <gfs file base url (no .idx)> <out wind.json>"""
import json, sys, requests, numpy as np, eccodes
base, out = sys.argv[1], sys.argv[2]
lines = [l.split(':') for l in requests.get(base + '.idx', timeout=60).text.strip().split('\n')]
def field(var):
    i = next(k for k, p in enumerate(lines) if p[3] == var and p[4] == '10 m above ground')
    s, e = int(lines[i][1]), int(lines[i + 1][1]) - 1
    b = requests.get(base, headers={'Range': f'bytes={s}-{e}'}, timeout=120).content
    h = eccodes.codes_new_from_message(b)
    g = {k: eccodes.codes_get(h, k) for k in ['Ni', 'Nj', 'dataDate', 'dataTime', 'step']}
    g.update({k: eccodes.codes_get_double(h, k) for k in ['longitudeOfFirstGridPointInDegrees', 'latitudeOfFirstGridPointInDegrees', 'iDirectionIncrementInDegrees', 'jDirectionIncrementInDegrees']})
    g['values'] = eccodes.codes_get_values(h).reshape(g['Nj'], g['Ni'])
    eccodes.codes_release(h)
    return g
U, V = field('UGRD'), field('VGRD')
assert U['longitudeOfFirstGridPointInDegrees'] == 0 and U['latitudeOfFirstGridPointInDegrees'] == 90
dx = U['iDirectionIncrementInDegrees']; shift = int(round(180 / dx))
u = np.roll(U['values'], -shift, axis=1); v = np.roll(V['values'], -shift, axis=1)  # lon 0..359 -> -180..179
ny, nx = u.shape
json.dump({'source': 'NOAA GFS 1.0deg ' + base.split('/')[-1], 'refTime': f"{U['dataDate']} {U['dataTime']:04d}Z", 'forecastHour': U['step'],
           'level': '10 m above ground', 'units': 'm/s', 'nx': nx, 'ny': ny, 'lo1': -180, 'la1': 90, 'dx': dx, 'dy': U['jDirectionIncrementInDegrees'],
           'u': [round(float(x), 2) for x in u.ravel()], 'v': [round(float(x), 2) for x in v.ravel()]},
          open(out, 'w'), separators=(',', ':'))
sp = np.hypot(u, v)
print(nx, ny, 'max', sp.max().round(1), 'mean', sp.mean().round(2), U['dataDate'], U['dataTime'], 'f', U['step'])
