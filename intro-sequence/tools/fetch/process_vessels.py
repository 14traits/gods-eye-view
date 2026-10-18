#!/usr/bin/env python3
"""vessels.json from keyless AIS: Fintraffic Digitraffic (Finland/Baltic) + Kystverket Kystdatahuset realtime (Norway).
Usage: python3 -I process_vessels.py <raw_dir> <out_dir>"""
import json, os, sys, time
RAW, OUT = sys.argv[1], sys.argv[2]
rows, src = {}, {}
# Norway (Kystverket) - LineString trails, last coordinate = latest position
k = json.load(open(os.path.join(RAW, 'kystverket_ais.json')))
for f in k['features']:
    c, p = f['geometry']['coordinates'], f['properties']
    if not c:
        continue
    lon, lat = c[-1]
    cog = p.get('cog')
    cog = None if cog is None or cog >= 360 else round(cog, 1)
    sog = p.get('speed')
    sog = None if sog is None or sog >= 102.3 else round(sog, 1)
    rows[p['mmsi']] = [round(lon, 4), round(lat, 4), sog, cog, p['mmsi'], (p.get('ship_name') or '').strip() or None]
    src[p['mmsi']] = 'NO'
# Finland / Baltic (Digitraffic)
names = {v['mmsi']: (v.get('name') or '').strip() or None for v in json.load(open(os.path.join(RAW, 'digitraffic_vessels.json')))}
d = json.load(open(os.path.join(RAW, 'dt_ais_from.json')))
for f in d['features']:
    p = f['properties']
    lon, lat = f['geometry']['coordinates'][:2]
    if p['mmsi'] in rows:
        continue
    cog = p.get('cog'); cog = None if cog is None or cog >= 360 else round(cog, 1)
    sog = p.get('sog'); sog = None if sog is None or sog >= 102.3 else round(sog, 1)
    rows[p['mmsi']] = [round(lon, 4), round(lat, 4), sog, cog, p['mmsi'], names.get(p['mmsi'])]
    src[p['mmsi']] = 'FI'
out = list(rows.values())
json.dump({'t': int(time.time()), 'cols': ['lon', 'lat', 'sog_kn', 'cog_deg', 'mmsi', 'name'],
           'coverage': 'Norwegian coast/EEZ (Kystverket) + Finnish waters & Baltic Sea (Fintraffic Digitraffic); not global',
           'counts': {'kystverket_norway': sum(1 for v in src.values() if v == 'NO'), 'digitraffic_finland_baltic': sum(1 for v in src.values() if v == 'FI')},
           'rows': out}, open(os.path.join(OUT, 'vessels.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
lons = [r[0] for r in out]; lats = [r[1] for r in out]
print(len(out), 'bbox', min(lons), max(lons), min(lats), max(lats))
