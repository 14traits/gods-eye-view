"""Shared helpers for the city scene geodata fetchers (ENU frame, Overpass, geometry)."""
import json, math, os, time, hashlib
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'city')
CACHE = os.path.join(HERE, 'cache')
os.makedirs(CACHE, exist_ok=True)

CITIES = {
    'nyc': dict(name='New York — Midtown / Chelsea / Lower Manhattan', lat0=40.7400, lon0=-73.9900, half=3500),
    'boston': dict(name='Boston — Downtown / Back Bay / Cambridge / Seaport', lat0=42.3555, lon0=-71.0605, half=3200),
}

OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]


class Frame:
    def __init__(self, lat0, lon0, half, **_):
        self.lat0, self.lon0, self.half = lat0, lon0, half
        self.kx = math.cos(math.radians(lat0)) * 111320.0
        self.ky = 110540.0

    def xy(self, lat, lon):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def ll(self, x, y):
        return (self.lat0 + y / self.ky, self.lon0 + x / self.kx)

    def bbox(self, half=None):
        h = self.half if half is None else half
        s, w = self.ll(-h, -h)
        n, e = self.ll(h, h)
        return s, w, n, e


def overpass(query, tag):
    """Run an Overpass query, caching the raw JSON response under cache/osm_<tag>.json."""
    path = os.path.join(CACHE, f'osm_{tag}.json')
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    last = None
    for attempt in range(8):
        for url in OVERPASS:
            try:
                t = time.time()
                r = requests.post(url, data={'data': query}, timeout=400)
                if r.status_code != 200:
                    last = f'{url} HTTP {r.status_code}'
                    print('  overpass fail', last)
                    continue
                d = r.json()
                if 'remark' in d and 'error' in d.get('remark', '').lower():
                    last = f'{url} remark {d["remark"][:200]}'
                    print('  overpass remark', last)
                    continue
                print(f'  overpass ok {url} {len(r.content)/1e6:.1f}MB {time.time()-t:.0f}s {len(d["elements"])} el')
                with open(path, 'w') as f:
                    json.dump(d, f)
                return d
            except Exception as e:  # noqa
                last = f'{url} {type(e).__name__}: {str(e)[:200]}'
                print('  overpass fail', last)
        time.sleep(15 + 15 * attempt)
    raise RuntimeError('all overpass endpoints failed: ' + str(last))


# ---------------- geometry ----------------

def rdp(pts, eps):
    """Douglas-Peucker on an open polyline (list of (x,y))."""
    n = len(pts)
    if n < 3:
        return list(pts)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        dmax, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L < 1e-9:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dx * (ay - py) - dy * (ax - px)) / L
            if d > dmax:
                dmax, idx = d, i
        if dmax > eps and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(pts, keep) if k]


def rdp_ring(ring, eps):
    """Douglas-Peucker for a closed ring given without the repeated closing vertex."""
    n = len(ring)
    if n < 4:
        return list(ring)
    # split at vertex 0 and the vertex farthest from it
    x0, y0 = ring[0]
    far = max(range(n), key=lambda i: (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2)
    a = rdp(ring[0:far + 1], eps)
    b = rdp(ring[far:] + [ring[0]], eps)
    return a[:-1] + b[:-1]


def area(ring):
    s = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def centroid(ring):
    a = area(ring)
    if abs(a) < 1e-9:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    cx = cy = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        c = x1 * y2 - x2 * y1
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    return cx / (6 * a), cy / (6 * a)


def dedupe(pts):
    out = []
    for p in pts:
        if not out or p != out[-1]:
            out.append(p)
    return out


def open_ring(pts):
    pts = dedupe(pts)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def assemble_rings(ways):
    """Join way coordinate lists (lists of (lat,lon) tuples) into closed rings by matching endpoints."""
    rings = []
    pool = [list(w) for w in ways if len(w) >= 2]
    while pool:
        cur = pool.pop()
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, w in enumerate(pool):
                if w[0] == cur[-1]:
                    cur = cur + w[1:]
                elif w[-1] == cur[-1]:
                    cur = cur + w[::-1][1:]
                elif w[-1] == cur[0]:
                    cur = w + cur[1:]
                elif w[0] == cur[0]:
                    cur = w[::-1] + cur[1:]
                else:
                    continue
                pool.pop(i)
                changed = True
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


def clip_polyline(pts, xmin, ymin, xmax, ymax):
    """Clip a polyline to a rectangle (Liang-Barsky per segment); returns list of pieces."""
    pieces, cur = [], []

    def inside(p):
        return xmin <= p[0] <= xmax and ymin <= p[1] <= ymax

    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        dx, dy = x2 - x1, y2 - y1
        t0, t1 = 0.0, 1.0
        ok = True
        for p, q in ((-dx, x1 - xmin), (dx, xmax - x1), (-dy, y1 - ymin), (dy, ymax - y1)):
            if p == 0:
                if q < 0:
                    ok = False
                    break
            else:
                t = q / p
                if p < 0:
                    if t > t1:
                        ok = False
                        break
                    t0 = max(t0, t)
                else:
                    if t < t0:
                        ok = False
                        break
                    t1 = min(t1, t)
        if not ok:
            if cur:
                pieces.append(cur)
                cur = []
            continue
        a = (x1, y1) if t0 == 0.0 else (x1 + t0 * dx, y1 + t0 * dy)
        b = (x2, y2) if t1 == 1.0 else (x1 + t1 * dx, y1 + t1 * dy)
        if not cur:
            cur = [a, b]
        else:
            if cur[-1] != a:
                pieces.append(cur)
                cur = [a, b]
            else:
                cur.append(b)
        if t1 < 1.0:
            pieces.append(cur)
            cur = []
    if cur:
        pieces.append(cur)
    return [dedupe(p) for p in pieces if len(dedupe(p)) >= 2]


def clip_polygon(ring, xmin, ymin, xmax, ymax):
    """Sutherland-Hodgman clip of a ring to a rectangle."""
    def clip(poly, inside, inter):
        out = []
        n = len(poly)
        for i in range(n):
            cur, prev = poly[i], poly[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
        return out

    def ix(xc):
        return lambda p, q: (xc, p[1] + (q[1] - p[1]) * (xc - p[0]) / (q[0] - p[0]))

    def iy(yc):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (yc - p[1]) / (q[1] - p[1]), yc)

    poly = list(ring)
    for ins, inter in ((lambda p: p[0] >= xmin, ix(xmin)), (lambda p: p[0] <= xmax, ix(xmax)),
                       (lambda p: p[1] >= ymin, iy(ymin)), (lambda p: p[1] <= ymax, iy(ymax))):
        if not poly:
            break
        poly = clip(poly, ins, inter)
    return dedupe(poly)


def r1(v):
    return round(v, 1)


def flat(pts):
    out = []
    for x, y in pts:
        out.append(r1(x))
        out.append(r1(y))
    return out


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    print(f'  wrote {os.path.relpath(path, ROOT)} {os.path.getsize(path)/1e6:.2f}MB')
