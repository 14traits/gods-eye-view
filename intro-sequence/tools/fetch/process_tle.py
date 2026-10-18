#!/usr/bin/env python3
"""tle.txt (3-line TLEs, CelesTrak GROUP=active) + tle_groups.json (NORAD ids per group).
Usage: python3 -I process_tle.py <raw_dir> <out_dir>"""
import json, os, sys
RAW, OUT = sys.argv[1], sys.argv[2]
def parse(path):
    L = [l.rstrip() for l in open(path) if l.strip()]
    out = []
    i = 0
    while i + 2 < len(L) + 0 and i + 2 <= len(L) - 1:
        if L[i+1].startswith('1 ') and L[i+2].startswith('2 '):
            name = L[i][2:] if L[i].startswith('0 ') else L[i]
            out.append((name.strip(), L[i+1], L[i+2])); i += 3
        else:
            i += 1
    return out
act = parse(os.path.join(RAW, 'tle_active3.txt'))
with open(os.path.join(OUT, 'tle.txt'), 'w') as f:
    for n, a, b in act:
        f.write(f'{n}\n{a}\n{b}\n')
groups, notable = {}, {}
for g in ['stations', 'starlink', 'gps-ops', 'geo', 'weather']:
    p = os.path.join(RAW, f'tle_{g}.txt')
    if os.path.exists(p) and os.path.getsize(p) > 0:
        sats = parse(p)
        groups[g] = sorted(int(a[2:7]) for _, a, _ in sats)
        for n, _, _ in sats[: (40 if g != 'starlink' else 3)]:
            notable[n] = g
epochs = sorted(a[18:32] for _, a, _ in act)
json.dump({'groups_norad': groups, 'notable': notable}, open(os.path.join(OUT, 'tle_groups.json'), 'w'), separators=(',', ':'))
print(len(act), {k: len(v) for k, v in groups.items()}, 'epoch range', epochs[0], epochs[-1])
