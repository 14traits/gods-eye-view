"""Fetch OSM buildings / roads / water / extras for the city scenes and write city/<slug>/*.json.

usage: python3 -I tools/city/fetch_osm.py nyc boston
"""
import sys, os, math, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import (CITIES, OUT, Frame, overpass, rdp, rdp_ring, area, centroid, open_ring,
                 assemble_rings, clip_polyline, clip_polygon, flat, r1, write_json, dedupe)

FT = 0.3048


def parse_len(v):
    """Parse an OSM length tag to meters. Returns None if unparseable."""
    if v is None:
        return None
    s = str(v).strip().lower().replace(',', '.')
    s = s.split(';')[0].strip()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*\"?)?$", s)  # 12'6"
    if m:
        return float(m.group(1)) * FT + (float(m.group(2)) * 0.0254 if m.group(2) else 0)
    m = re.match(r'^(-?\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot)?$', s)
    if not m:
        return None
    val = float(m.group(1))
    u = m.group(2) or 'm'
    if u in ('ft', 'feet', 'foot'):
        val *= FT
    return val


def parse_num(v):
    if v is None:
        return None
    m = re.match(r'^\s*(\d+(?:\.\d+)?)', str(v).replace(',', '.'))
    return float(m.group(1)) if m else None


HOUSE = {'house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin', 'shed', 'garage',
         'garages', 'hut', 'carport', 'static_caravan'}


def building_height(t):
    """Returns (height, min_height, source) where source in h/lv/def."""
    h = parse_len(t.get('height'))
    src = 'h'
    if h is None or h <= 0:
        lv = parse_num(t.get('building:levels'))
        if lv is not None and lv > 0:
            h = lv * 3.2 + (parse_num(t.get('roof:levels')) or 0) * 3.2
            src = 'lv'
        else:
            b = t.get('building', 'yes')
            h = 7.0 if b in HOUSE else 12.0
            if b in ('shed', 'garage', 'garages', 'carport', 'hut'):
                h = 3.5
            src = 'def'
    mh = parse_len(t.get('min_height'))
    if mh is None:
        ml = parse_num(t.get('building:min_level'))
        mh = ml * 3.2 if ml else 0.0
    mh = max(0.0, mh)
    if mh >= h:
        mh = 0.0
    return h, mh, src


def ll_list(geom):
    return [(g['lat'], g['lon']) for g in geom if g is not None]


# ------------------------------------------------------------------ buildings

def buildings(slug, F):
    h = F.half
    s, w, n, e = F.bbox(h + 60)
    # tile the bbox to keep each response manageable
    T = 2 if h > 3000 else 1
    elems = {}
    for i in range(T):
        for j in range(T):
            ts = s + (n - s) * i / T
            tn = s + (n - s) * (i + 1) / T
            tw = w + (e - w) * j / T
            te = w + (e - w) * (j + 1) / T
            bb = f'{ts:.6f},{tw:.6f},{tn:.6f},{te:.6f}'
            q = (f'[out:json][timeout:180];(way["building"]({bb});'
                 f'relation["building"]["type"="multipolygon"]({bb}););out geom;')
            print(f' buildings tile {i},{j}')
            d = overpass(q, f'{slug}_bld_{i}{j}')
            for el in d['elements']:
                elems[(el['type'], el['id'])] = el
    print(f'  {len(elems)} building elements')
    out = []
    stats = dict(h=0, lv=0, df=0, dropped_small=0, dropped_out=0, rel_rings=0)
    for (typ, _id), el in elems.items():
        t = el.get('tags', {})
        if t.get('building') in ('no', 'construction_site'):
            continue
        rings = []
        if typ == 'way':
            if 'geometry' not in el:
                continue
            g = ll_list(el['geometry'])
            if len(g) >= 4 and g[0] == g[-1]:
                rings.append(g)
        else:
            outers = [ll_list(m['geometry']) for m in el.get('members', [])
                      if m['type'] == 'way' and m.get('role') == 'outer' and 'geometry' in m]
            rings = assemble_rings(outers)
            stats['rel_rings'] += len(rings)
        hgt, mh, src = building_height(t)
        for g in rings:
            pts = open_ring([F.xy(la, lo) for la, lo in g])
            pts = rdp_ring(pts, 0.5)
            if len(pts) < 3 or abs(area(pts)) < 8:
                stats['dropped_small'] += 1
                continue
            cx, cy = centroid(pts)
            if abs(cx) > h or abs(cy) > h:
                stats['dropped_out'] += 1
                continue
            stats[{'h': 'h', 'lv': 'lv', 'def': 'df'}[src]] += 1
            out.append((cx * cx + cy * cy, [r1(hgt), r1(mh)] + flat(pts)))
    out.sort(key=lambda a: a[0])
    b = [o[1] for o in out]
    write_json(os.path.join(OUT, slug, 'buildings.json'), {'count': len(b), 'b': b})
    hs = sorted(x[0] for x in b)
    print(f'  buildings {len(b)}  height-src tag={stats["h"]} levels={stats["lv"]} default={stats["df"]} '
          f'dropped small={stats["dropped_small"]} outside={stats["dropped_out"]}  tallest={hs[-5:]}')
    return dict(count=len(b), height_from_tag=stats['h'], height_from_levels=stats['lv'],
                height_default=stats['df'], tallest_m=hs[-1] if hs else None)


# ------------------------------------------------------------------ roads

CLS = {'motorway': 0, 'trunk': 0, 'primary': 1, 'secondary': 2, 'tertiary': 3,
       'residential': 4, 'unclassified': 4, 'service': 5}
DEF_LANES = {0: 3, 1: 2, 2: 2, 3: 2, 4: 1, 5: 1}


def plen(pts):
    return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))


def roads(slug, F):
    h = F.half
    s, w, n, e = F.bbox(h + 100)
    bb = f'{s:.6f},{w:.6f},{n:.6f},{e:.6f}'
    q = (f'[out:json][timeout:180];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|'
         f'unclassified|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]({bb});out geom;')
    print(' roads')
    d = overpass(q, f'{slug}_roads')
    out = []
    cnt = [0] * 6
    tunnels = 0
    short_service = 0
    for el in d['elements']:
        t = el.get('tags', {})
        hw = t['highway']
        if t.get('area') == 'yes':
            continue
        if t.get('tunnel') in ('yes', 'covered') or t.get('layer', '0').startswith('-') and t.get('tunnel'):
            tunnels += 1
            continue
        pts = [F.xy(la, lo) for la, lo in ll_list(el.get('geometry', []))]
        pts = dedupe(pts)
        if len(pts) < 2:
            continue
        if hw.endswith('_link'):
            c = 5
        else:
            c = CLS[hw]
        if hw == 'service' and plen(pts) <= 80:
            short_service += 1
            continue
        ow = t.get('oneway', '')
        oneway = 0
        if ow in ('yes', '1', 'true'):
            oneway = 1
        elif ow == '-1':
            oneway = 1
            pts = pts[::-1]
        elif ow == 'no':
            oneway = 0
        elif hw in ('motorway', 'motorway_link') or t.get('junction') in ('roundabout', 'circular'):
            oneway = 1
        ln = parse_num(t.get('lanes'))
        lanes = int(ln) if ln else DEF_LANES[c]
        for piece in clip_polyline(pts, -h, -h, h, h):
            piece = rdp(piece, 1.0)
            if len(piece) < 2 or plen(piece) < 1:
                continue
            out.append([c, oneway, lanes] + flat(piece))
            cnt[c] += 1
    write_json(os.path.join(OUT, slug, 'roads.json'), {'roads': out})
    print(f'  roads {len(out)} by class {cnt}  (dropped tunnels {tunnels}, short service {short_service})')
    return dict(count=len(out), by_class=cnt, dropped_tunnel_ways=tunnels, dropped_short_service=short_service)


# ------------------------------------------------------------------ water

def coast_water(slug, F, h):
    """Build water polygons inside the square from natural=coastline (land left, water right)."""
    s, w, n, e = F.bbox(h * 1.6)
    bb = f'{s:.6f},{w:.6f},{n:.6f},{e:.6f}'
    q = f'[out:json][timeout:180];way["natural"="coastline"]({bb});out geom;'
    print(' coastline')
    d = overpass(q, f'{slug}_coast')
    ways = [[F.xy(la, lo) for la, lo in ll_list(el['geometry'])] for el in d['elements'] if 'geometry' in el]
    # directional merge into chains
    chains = []
    pool = [wy for wy in ways if len(wy) >= 2]
    while pool:
        cur = pool.pop()
        grown = True
        while grown and cur[0] != cur[-1]:
            grown = False
            for i, wy in enumerate(pool):
                if wy[0] == cur[-1]:
                    cur = cur + wy[1:]
                elif wy[-1] == cur[0]:
                    cur = wy + cur[1:]
                else:
                    continue
                pool.pop(i)
                grown = True
                break
        chains.append(cur)
    eps = 1e-6

    def on_edge(p):
        return abs(abs(p[0]) - h) < 1e-3 or abs(abs(p[1]) - h) < 1e-3

    def spos(p):  # clockwise perimeter coordinate from top-left
        x, y = p
        if abs(y - h) < 1e-3:
            return x + h
        if abs(x - h) < 1e-3:
            return 2 * h + (h - y)
        if abs(y + h) < 1e-3:
            return 4 * h + (h - x)
        return 6 * h + (y + h)

    corners = [(0.0, (-h, h)), (2 * h, (h, h)), (4 * h, (h, -h)), (6 * h, (-h, -h))]
    pieces, islands, bad = [], [], 0
    for ch in chains:
        closed = ch[0] == ch[-1]
        inside_all = all(abs(x) <= h and abs(y) <= h for x, y in ch)
        if closed and inside_all:
            islands.append(open_ring(ch))
            continue
        for pc in clip_polyline(ch, -h, -h, h, h):
            if on_edge(pc[0]) and on_edge(pc[-1]):
                pieces.append(pc)
            else:
                bad += 1
    polys = []
    if pieces:
        used = [False] * len(pieces)
        starts = [spos(p[0]) for p in pieces]
        for k in range(len(pieces)):
            if used[k]:
                continue
            ring = []
            cur = k
            guard = 0
            while True:
                used[cur] = True
                ring += pieces[cur]
                se = spos(pieces[cur][-1])
                # next entry clockwise from se
                best, bd = None, None
                for m in range(len(pieces)):
                    dd = (starts[m] - se) % (8 * h)
                    if bd is None or dd < bd:
                        best, bd = m, dd
                # add corners passed between se and se+bd
                for cs, cp in sorted(corners, key=lambda c: (c[0] - se) % (8 * h)):
                    if 0 < (cs - se) % (8 * h) < bd:
                        ring.append(cp)
                cur = best
                guard += 1
                if cur == k or guard > len(pieces) + 2:
                    break
                if used[cur]:
                    break
            polys.append([dedupe(open_ring(ring))])
    # attach islands (land holes) to the containing water polygon
    def pip(pt, ring):
        x, y = pt
        c = False
        for i in range(len(ring)):
            x1, y1 = ring[i]
            x2, y2 = ring[i - 1]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                c = not c
        return c
    for isl in islands:
        if abs(area(isl)) < 50:
            continue
        for p in polys:
            if pip(isl[0], p[0]):
                p.append(isl)
                break
    print(f'  coastline chains {len(chains)} pieces {len(pieces)} islands {len(islands)} '
          f'water polys {len(polys)} (unclosed pieces skipped {bad})')
    return polys, bad


def water(slug, F):
    h = F.half
    s, w, n, e = F.bbox(h + 50)
    bb = f'{s:.6f},{w:.6f},{n:.6f},{e:.6f}'
    q = (f'[out:json][timeout:180];(way["natural"="water"]({bb});relation["natural"="water"]({bb});'
         f'way["waterway"="riverbank"]({bb});relation["waterway"="riverbank"]({bb}););out geom;')
    print(' water areas')
    d = overpass(q, f'{slug}_water')
    polys = []
    for el in d['elements']:
        t = el.get('tags', {})
        if t.get('water') in ('pond', 'reflecting_pool', 'fountain', 'basin', 'reservoir') and el['type'] == 'way':
            pass  # keep small ponds too; they are real water
        if el['type'] == 'way':
            if 'geometry' not in el:
                continue
            g = ll_list(el['geometry'])
            if g[0] != g[-1]:
                continue
            outers, inners = [g], []
        else:
            mem = [m for m in el.get('members', []) if m['type'] == 'way' and 'geometry' in m]
            outers = assemble_rings([ll_list(m['geometry']) for m in mem if m.get('role') == 'outer'])
            inners = assemble_rings([ll_list(m['geometry']) for m in mem if m.get('role') == 'inner'])
        inn_xy = [open_ring([F.xy(*p) for p in r]) for r in inners]
        for o in outers:
            ring = open_ring([F.xy(*p) for p in o])
            ring = clip_polygon(ring, -h, -h, h, h)
            ring = rdp_ring(open_ring(ring), 1.0)
            if len(ring) < 3 or abs(area(ring)) < 20:
                continue
            p = [ring]
            for ir in inn_xy:
                ir2 = rdp_ring(open_ring(clip_polygon(ir, -h, -h, h, h)), 1.0)
                if len(ir2) >= 3 and abs(area(ir2)) >= 20:
                    p.append(ir2)
            polys.append(('water', p))
    n_area = len(polys)
    cpolys, bad = coast_water(slug, F, h)
    for p in cpolys:
        p2 = [rdp_ring(r, 1.0) for r in p]
        p2 = [r for r in p2 if len(r) >= 3]
        if p2:
            polys.append(('coast', p2))
    out = [[flat(r) for r in p] for _, p in polys]
    src = [s_ for s_, _ in polys]
    write_json(os.path.join(OUT, slug, 'water.json'),
               {'count': len(out), 'format': 'polys[i] = [outerRing, holeRing...], rings flat x,y', 'src': src,
                'polys': out})
    print(f'  water polys {len(out)} (osm water areas {n_area}, coastline-derived {len(cpolys)})')
    return dict(count=len(out), water_areas=n_area, coastline_polys=len(cpolys), coastline_unclosed_pieces=bad)


# ------------------------------------------------------------------ extras

KNOWN_HELI = ['Downtown Manhattan Heliport', 'West 30th Street Heliport', 'East 34th Street Heliport']


def nyc_extra(slug, F):
    s, w, n, e = F.bbox(F.half + 2000)
    bb = f'{s:.6f},{w:.6f},{n:.6f},{e:.6f}'
    q = (f'[out:json][timeout:180];(nwr["aeroway"~"^(helipad|heliport)$"]({bb});'
         f'nwr["name"~"heliport|helistop|helipad",i]({bb}););out center tags;')
    print(' helipads')
    d = overpass(q, f'{slug}_heli2')
    pads = []
    for el in d['elements']:
        t = el.get('tags', {})
        if el['type'] == 'node':
            la, lo = el['lat'], el['lon']
        else:
            c = el.get('center')
            if not c:
                continue
            la, lo = c['lat'], c['lon']
        x, y = F.xy(la, lo)
        name = t.get('name') or t.get('operator') or ''
        kind = t.get('aeroway') or ('heliport' if 'heliport' in name.lower() else 'named')
        pads.append(dict(x=r1(x), y=r1(y), name=name, kind=kind, ref=t.get('ref', ''), osm=f"{el['type']}/{el['id']}",
                         tags={k: v for k, v in t.items() if k in ('aeroway', 'faa', 'operator', 'man_made', 'amenity')},
                         inside=abs(x) <= F.half and abs(y) <= F.half))
    pads.sort(key=lambda p: (p['kind'] != 'heliport', p['x'] ** 2 + p['y'] ** 2))
    for p in pads:
        print(f"   {p['kind']:9s} {p['x']:8.1f} {p['y']:8.1f} {'in ' if p['inside'] else 'OUT'} {p['name']}")
    found = {k: [p for p in pads if p['kind'] == 'heliport' and k.split()[0].lower() in p['name'].lower()
                 and 'heliport' in p['name'].lower()] for k in KNOWN_HELI}
    helipads = [[p['x'], p['y'], p['name'] or (f"{p['kind']} {p['ref']}".strip())] for p in pads]
    write_json(os.path.join(OUT, slug, 'extra.json'),
               {'helipads': helipads,
                'detail': pads,
                'note': 'aeroway=helipad|heliport from OSM in a bbox 2 km wider than the scene; '
                        'detail[].inside says whether the point is inside the scene square'})
    return dict(helipad_points=len(pads), named_heliports={k: (v[0]['x'], v[0]['y'], v[0]['inside']) if v else None
                                                           for k, v in found.items()})


def boston_rail(slug, F):
    h = F.half
    s, w, n, e = F.bbox(h + 100)
    bb = f'{s:.6f},{w:.6f},{n:.6f},{e:.6f}'
    q = (f'[out:json][timeout:180];(relation["route"~"^(subway|light_rail|train|tram)$"]({bb});'
         f'way["railway"~"^(subway|light_rail|rail|tram)$"]({bb}););out geom;')
    print(' rail')
    d = overpass(q, f'{slug}_rail')
    ways = {el['id']: el for el in d['elements'] if el['type'] == 'way'}
    rels = [el for el in d['elements'] if el['type'] == 'relation']
    lines, seen = [], set()
    rel_names = []
    for r in rels:
        t = r.get('tags', {})
        col = (t.get('colour') or t.get('color') or '').strip()
        if not re.match(r'^#?[0-9a-fA-F]{6}$', col):
            col = {'subway': '#888888', 'light_rail': '#00843D', 'tram': '#00843D', 'train': '#80276C'}[t['route']]
        if not col.startswith('#'):
            col = '#' + col
        col = col.upper()
        rel_names.append(f"{t.get('route')}:{t.get('name', t.get('ref', ''))}:{col}")
        for m in r.get('members', []):
            if m['type'] != 'way' or 'geometry' not in m or m.get('role') in ('platform', 'stop'):
                continue
            wt = ways.get(m['ref'], {}).get('tags', {})
            if wt.get('public_transport') or wt.get('railway') == 'platform':
                continue
            key = (m['ref'], col)
            if key in seen:
                continue
            seen.add(key)
            pts = [F.xy(la, lo) for la, lo in ll_list(m['geometry'])]
            for pc in clip_polyline(dedupe(pts), -h, -h, h, h):
                pc = rdp(pc, 1.0)
                if len(pc) >= 2:
                    lines.append([col] + flat(pc))
    covered = {k[0] for k in seen}
    extra = 0
    for wid, el in ways.items():
        t = el.get('tags', {})
        if wid in covered or t.get('service') or 'geometry' not in el:
            continue
        pts = [F.xy(la, lo) for la, lo in ll_list(el['geometry'])]
        for pc in clip_polyline(dedupe(pts), -h, -h, h, h):
            pc = rdp(pc, 1.0)
            if len(pc) >= 2:
                lines.append(['#7F7F7F'] + flat(pc))
                extra += 1
    write_json(os.path.join(OUT, slug, 'rail.json'),
               {'lines': lines, 'routes': sorted(set(rel_names)),
                'note': 'OSM route relations (subway/light_rail/train/tram) colour tags; #7F7F7F = railway way not in any route relation'})
    print(f'  rail lines {len(lines)} from {len(rels)} route relations (+{extra} unassigned way pieces)')
    for nm in sorted(set(rel_names)):
        print('   ', nm)
    return dict(polylines=len(lines), route_relations=len(rels), unassigned_pieces=extra)


def main():
    slugs = sys.argv[1:] or list(CITIES)
    report = {}
    for slug in slugs:
        c = CITIES[slug]
        F = Frame(**c)
        print(f'== {slug}')
        write_json(os.path.join(OUT, slug, 'meta.json'),
                   {'slug': slug, 'name': c['name'], 'lat0': c['lat0'], 'lon0': c['lon0'], 'half': c['half'],
                    'frame': 'ENU m',
                    'projection': 'x=(lon-lon0)*cos(lat0)*111320, y=(lat-lat0)*110540',
                    'source': 'OpenStreetMap contributors (ODbL) via Overpass; imagery Esri World Imagery'})
        r = {}
        r['buildings'] = buildings(slug, F)
        r['roads'] = roads(slug, F)
        try:
            r['water'] = water(slug, F)
        except Exception as ex:  # noqa
            print('  WATER FAILED', ex)
            r['water'] = f'failed: {ex}'
        if slug == 'nyc':
            r['extra'] = nyc_extra(slug, F)
        if slug == 'boston':
            r['rail'] = boston_rail(slug, F)
        report[slug] = r
    print(json.dumps(report, indent=1))
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache', 'osm_report.json'), 'w') as f:
        json.dump(report, f, indent=1)


if __name__ == '__main__':
    main()
