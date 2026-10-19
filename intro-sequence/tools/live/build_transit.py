"""MBTA static GTFS -> city/boston/transit.json (subway, Mattapan, commuter rail, bus).
usage: python3 build_transit.py <dir with routes.txt shapes.txt trips.txt>"""
import csv, json, math, os, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(__file__))
from common import SCENES, enu
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
G = sys.argv[1]
H = SCENES['boston'][2]; M = H + 1000

def rdp(pts, eps):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L else math.hypot(px - ax, py - ay)
            if d > best: best, bi = d, i
        if best > eps:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

def length(p): return sum(math.hypot(p[i+1][0]-p[i][0], p[i+1][1]-p[i][1]) for i in range(len(p)-1))

routes = {}
for r in csv.DictReader(open(os.path.join(G, 'routes.txt'), encoding='utf-8-sig')):
    t = int(r['route_type'])
    if t not in (0, 1, 2, 3): continue
    if 'Replacement' in r['route_desc'] or r['route_id'].startswith('Shuttle'): continue
    name = r['route_short_name'] or r['route_long_name']
    if t == 3 and r['route_short_name'] and r['route_long_name']:
        name = f"{r['route_short_name']} {r['route_long_name']}"
    routes[r['route_id']] = {'name': name, 'color': '#' + (r['route_color'] or '888888').upper(), 'type': t}

shape_rd = {}
for t in csv.DictReader(open(os.path.join(G, 'trips.txt'), encoding='utf-8-sig')):
    if t['route_id'] in routes and t['shape_id']:
        shape_rd.setdefault(t['shape_id'], (t['route_id'], t['direction_id']))

shapes = defaultdict(list)
for s in csv.DictReader(open(os.path.join(G, 'shapes.txt'), encoding='utf-8-sig')):
    if s['shape_id'] in shape_rd:
        shapes[s['shape_id']].append((int(s['shape_pt_sequence']), float(s['shape_pt_lat']), float(s['shape_pt_lon'])))

best = {}  # (route, dir) -> (len_in_square, segments)
for sid, pts in shapes.items():
    pts.sort()
    xy = [enu('boston', la, lo) for _, la, lo in pts]
    if not any(abs(x) <= H and abs(y) <= H for x, y in xy): continue  # must pass within the square
    segs, cur = [], []
    for i, (x, y) in enumerate(xy):
        if abs(x) <= M and abs(y) <= M:
            if not cur and i > 0: cur.append(xy[i-1])  # carry edge point
            cur.append((x, y))
        elif cur:
            cur.append((x, y)); segs.append(cur); cur = []
    if cur: segs.append(cur)
    segs = [rdp(s, 2.0) for s in segs if len(s) > 1]
    L = sum(length(s) for s in segs)
    key = shape_rd[sid]
    if key not in best or L > best[key][0]: best[key] = (L, segs)

out_shapes, seen = [], set()
for (rid, d), (L, segs) in sorted(best.items()):
    for s in segs:
        flat = tuple(round(v, 1) for p in s for v in p)
        if (rid, flat) in seen: continue
        seen.add((rid, flat))
        out_shapes.append([rid] + list(flat))
used = {s[0] for s in out_shapes}
out = {'routes': {k: v for k, v in routes.items() if k in used}, 'shapes': out_shapes,
       'source': 'MBTA GTFS ' + open(os.path.join(G, 'feed_info.txt')).read().splitlines()[1].split(',"')[1].split('"')[0]}
json.dump(out, open(os.path.join(ROOT, 'city', 'boston', 'transit.json'), 'w'), separators=(',', ':'))
bytype = defaultdict(int)
for k in used: bytype[routes[k]['type']] += 1
print('routes', len(used), dict(bytype), 'shapes', len(out_shapes), 'pts', sum((len(s)-1)//2 for s in out_shapes))
print('rail routes:', sorted(k for k in used if routes[k]['type'] != 3))
print('missing requested:', [k for k in ['Red','Orange','Blue','Green-B','Green-C','Green-D','Green-E','Mattapan'] if k not in used])
