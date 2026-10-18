#!/usr/bin/env python3
"""Convert raw fetched feeds (see fetch_basic.sh) into compact intro-sequence JSON.

Usage: python3 -I process_basic.py <raw_dir> <out_data_dir>
All inputs are real downloads; this only filters, reprojects units and rounds.
"""
import csv, json, os, sys, time

RAW, OUT = sys.argv[1], sys.argv[2]
meta = {}


def r(x, n):
    return None if x is None else round(float(x), n)


def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p, 'w') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{name}: {os.path.getsize(p)/1e6:.2f} MB')


def raw(name):
    return os.path.join(RAW, name)


# 1. flights (OpenSky)
o = json.load(open(raw('opensky.json')))
rows = []
for s in o['states']:
    lon, lat, on_ground = s[5], s[6], s[8]
    if lon is None or lat is None or on_ground:
        continue
    alt = s[13] if s[13] is not None else s[7]
    rows.append([r(lon, 4), r(lat, 4), r(alt, 0), r(s[10], 1), r(s[9], 1),
                 (s[1] or '').strip(), s[2]])
dump('flights.json', {'t': o['time'], 'cols': ['lon', 'lat', 'alt_m', 'track_deg', 'vel_ms', 'callsign', 'country'], 'rows': rows})
meta['flights'] = len(rows)

# 2. military (adsb.lol /v2/mil, unioned with adsb.fi /v2/mil, dedup by hex; adsb.lol wins)
FT, KT = 0.3048, 0.514444
seen, rows, tmax = set(), [], 0
for fname in ['mil.json', 'mil_adsbfi.json']:
    if not os.path.exists(raw(fname)):
        continue
    d = json.load(open(raw(fname)))
    tmax = max(tmax, int((d.get('now') or 0) / (1000 if (d.get('now') or 0) > 1e11 else 1)))
    for a in d.get('ac') or d.get('aircraft') or []:
        lat, lon = a.get('lat'), a.get('lon')
        if lat is None or lon is None or a['hex'] in seen:
            continue
        alt = a.get('alt_geom', a.get('alt_baro'))
        if a.get('alt_baro') == 'ground' or alt == 'ground':
            continue  # airborne only
        seen.add(a['hex'])
        track = a.get('track', a.get('true_heading'))
        gs = a.get('gs')
        rows.append([r(lon, 4), r(lat, 4), r(alt * FT, 0) if isinstance(alt, (int, float)) else None,
                     r(track, 1), r(gs * KT, 1) if gs is not None else None,
                     (a.get('flight') or '').strip(), None, a.get('t')])
dump('military.json', {'t': tmax, 'cols': ['lon', 'lat', 'alt_m', 'track_deg', 'vel_ms', 'callsign', 'country', 'type'], 'rows': rows,
                       'note': 'country not provided by adsb.lol/adsb.fi feeds (null)'})
meta['military'] = len(rows)

# 4. quakes
q = json.load(open(raw('quakes.geojson')))
rows = []
for f in q['features']:
    c, p = f['geometry']['coordinates'], f['properties']
    if p.get('mag') is None:
        continue
    rows.append([r(c[0], 3), r(c[1], 3), r(c[2], 1), r(p['mag'], 2), p['time'], p.get('place') or ''])
rows.sort(key=lambda x: x[4])
dump('quakes.json', {'t': q['metadata']['generated'], 'cols': ['lon', 'lat', 'depth_km', 'mag', 'time_ms', 'place'], 'rows': rows})
meta['quakes'] = len(rows)

# 5. fires (FIRMS 24h global: SNPP VIIRS, NOAA-20 VIIRS, MODIS)
rows, per = [], {}
for fname, bcol, tag in [('viirs_snpp.csv', 'bright_ti4', 'VIIRS_SNPP'), ('viirs_n20.csv', 'bright_ti4', 'VIIRS_NOAA20'), ('modis.csv', 'brightness', 'MODIS')]:
    if not os.path.exists(raw(fname)):
        continue
    n = 0
    with open(raw(fname), newline='') as fh:
        for row in csv.DictReader(fh):
            try:
                rows.append([r(row['longitude'], 3), r(row['latitude'], 3), r(row['frp'], 1), r(row[bcol], 1)])
                n += 1
            except (KeyError, ValueError):
                pass
    per[tag] = n
dump('fires.json', {'cols': ['lon', 'lat', 'frp', 'brightness'], 'sources': per, 'rows': rows})
meta['fires'] = len(rows)
meta['fires_per'] = per

# 8. cables
c = json.load(open(raw('cables.json')))
lines = []
for f in c['features']:
    g = f['geometry']
    parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    for part in parts:
        pl = [[r(x, 2), r(y, 2)] for x, y in (pt[:2] for pt in part)]
        if len(pl) >= 2:
            lines.append(pl)
dump('cables.json', {'cables': lines})
meta['cables'] = (len(c['features']), len(lines))


# 9. coastline + borders
def lines_of(geo):
    out = []
    for f in geo['features']:
        g = f['geometry']
        if g is None:
            continue
        t, co = g['type'], g['coordinates']
        if t == 'LineString':
            parts = [co]
        elif t == 'MultiLineString':
            parts = co
        elif t == 'Polygon':
            parts = co
        elif t == 'MultiPolygon':
            parts = [ring for poly in co for ring in poly]
        else:
            parts = []
        for part in parts:
            pl, last = [], None
            for x, y in (pt[:2] for pt in part):
                pt = [r(x, 2), r(y, 2)]
                if pt != last:
                    pl.append(pt)
                last = pt
            if len(pl) >= 2:
                out.append(pl)
    return out


coast = lines_of(json.load(open(raw('coast50.geojson'))))
dump('coastline.json', {'lines': coast})
borders = lines_of(json.load(open(raw('countries110.geojson'))))
dump('borders.json', {'lines': borders})
meta['coast'] = len(coast)
meta['borders'] = len(borders)

# 10. cities
pp = json.load(open(raw('places.geojson')))
rows = []
for f in pp['features']:
    p = f['properties']
    lon, lat = f['geometry']['coordinates'][:2]
    rows.append([r(lon, 3), r(lat, 3), int(p.get('pop_max') or 0), p.get('name') or p.get('nameascii'), p.get('adm0name') or p.get('sov0name')])
rows.sort(key=lambda x: -x[2])
rows = rows[:3000]
dump('cities.json', {'cols': ['lon', 'lat', 'pop_max', 'name', 'country'], 'rows': rows})
meta['cities'] = len(rows)

# 11. airports (OurAirports large + medium)
rows = []
with open(raw('airports.csv'), newline='', encoding='utf-8') as fh:
    for row in csv.DictReader(fh):
        if row['type'] not in ('large_airport', 'medium_airport'):
            continue
        rows.append([r(row['longitude_deg'], 4), r(row['latitude_deg'], 4), row['iata_code'] or row['ident'], row['name'],
                     'L' if row['type'] == 'large_airport' else 'M'])
rows.sort(key=lambda x: x[4])
dump('airports.json', {'cols': ['lon', 'lat', 'iata', 'name', 'size'], 'rows': rows})
meta['airports'] = (len(rows), sum(1 for x in rows if x[4] == 'L'))

json.dump(meta, open(os.path.join(RAW, 'meta_basic.json'), 'w'))
print(meta)
