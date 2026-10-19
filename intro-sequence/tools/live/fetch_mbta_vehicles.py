"""Live MBTA vehicle positions -> city/boston/vehicles.json (square + 1 km)."""
import json, os, sys, requests
from collections import Counter
sys.path.insert(0, os.path.dirname(__file__))
from common import enu, inside
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
j = requests.get('https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json', timeout=30).json()
rows, total = [], 0
for e in j['entity']:
    v = e.get('vehicle') or {}; p = v.get('position') or {}
    if 'latitude' not in p: continue
    total += 1
    x, y = enu('boston', p['latitude'], p['longitude'])
    if not inside('boston', x, y, 1000): continue
    rid = (v.get('trip') or {}).get('route_id', '')
    lab = (v.get('vehicle') or {}).get('label') or (v.get('vehicle') or {}).get('id', '')
    sp = p.get('speed'); rows.append([x, y, p.get('bearing'), round(sp, 2) if sp is not None else None, rid, lab])
out = {'t': int(j['header']['timestamp']), 'source': 'cdn.mbta.com VehiclePositions_enhanced.json', 'v': rows}
json.dump(out, open(os.path.join(ROOT, 'city', 'boston', 'vehicles.json'), 'w'), separators=(',', ':'))
c = Counter(r[4].split('-')[0] if r[4].startswith(('Green', 'CR')) else ('bus' if r[4][:1].isdigit() or r[4][:2] in ('SL','CT') else r[4]) for r in rows)
print('t', out['t'], 'feed total', total, 'in square+1km', len(rows), dict(c))
