"""Shared helpers for real-geodata scene builds (city2).

Local frame: ENU metres relative to (lat0, lon0):
  x = (lon - lon0) * cos(lat0) * 111320
  y = (lat - lat0) * 110540
"""
import hashlib
import io
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
CITY = os.path.abspath(os.path.join(HERE, "..", "..", "city"))
os.makedirs(CACHE, exist_ok=True)

OVERPASS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
UA = {"User-Agent": "gods-eye-view-intro/1.0 (cinematic geodata build)"}

Image.MAX_IMAGE_PIXELS = None


class Frame:
    def __init__(self, slug, name, lat0, lon0, half):
        self.slug, self.name, self.lat0, self.lon0, self.half = slug, name, lat0, lon0, half
        self.kx = math.cos(math.radians(lat0)) * 111320.0
        self.ky = 110540.0
        self.out = os.path.join(CITY, slug)
        os.makedirs(self.out, exist_ok=True)

    def xy(self, lon, lat):
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def ll(self, x, y):
        return self.lon0 + x / self.kx, self.lat0 + y / self.ky

    def bbox(self, pad=0.0):
        """(south, west, north, east)"""
        h = self.half + pad
        return (self.lat0 - h / self.ky, self.lon0 - h / self.kx,
                self.lat0 + h / self.ky, self.lon0 + h / self.kx)

    def bbox_str(self, pad=0.0):
        s, w, n, e = self.bbox(pad)
        return f"{s:.6f},{w:.6f},{n:.6f},{e:.6f}"

    def write_meta(self):
        meta = {"slug": self.slug, "name": self.name, "lat0": self.lat0, "lon0": self.lon0,
                "half": self.half, "frame": "ENU m"}
        wjson(os.path.join(self.out, "meta.json"), meta)

    def geom_xy(self, geom):
        """list of {lat,lon} -> Nx2 float array in local metres"""
        a = np.array([[g["lon"], g["lat"]] for g in geom if g is not None], dtype=np.float64)
        if len(a) == 0:
            return np.zeros((0, 2))
        return np.stack([(a[:, 0] - self.lon0) * self.kx, (a[:, 1] - self.lat0) * self.ky], 1)


def wjson(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"  wrote {path} ({os.path.getsize(path)/1e6:.2f} MB)")


def r1(v):
    return round(float(v), 1)


def flat(arr):
    return [r1(v) for v in np.asarray(arr).reshape(-1)]


# ---------------------------------------------------------------- Overpass
def overpass(query, tag):
    key = hashlib.sha1(query.encode()).hexdigest()[:12]
    path = os.path.join(CACHE, f"overpass_{tag}_{key}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    last = None
    for attempt in range(10):
        for url in OVERPASS:
            try:
                print(f"  overpass {tag} -> {url}", flush=True)
                t = time.time()
                r = requests.get(url, params={"data": query}, headers=UA, timeout=900)
                if r.status_code != 200:
                    last = f"{url}: HTTP {r.status_code} {r.text[:200]}"
                    print("   ", last)
                    continue
                d = r.json()
                rem = d.get("remark", "")
                if rem and ("runtime error" in rem or "timed out" in rem or "out of memory" in rem):
                    last = f"{url}: remark {rem[:200]}"
                    print("   ", last)
                    continue
                print(f"    {len(d.get('elements', []))} elements in {time.time()-t:.0f}s")
                with open(path, "w") as f:
                    json.dump(d, f)
                return d
            except Exception as e:  # noqa
                last = f"{url}: {e}"
                print("   ", last)
        time.sleep(30)
    raise RuntimeError(f"overpass failed for {tag}: {last}")


def overpass_tiled(frame, qfmt, tag, n):
    """Run a query template ({bb} placeholder) over an n x n split of the frame bbox; dedupe elements."""
    s, w, nn, e = frame.bbox()
    seen, els = set(), []
    for i in range(n):
        for j in range(n):
            bb = (f"{s + (nn - s) * i / n:.6f},{w + (e - w) * j / n:.6f},"
                  f"{s + (nn - s) * (i + 1) / n:.6f},{w + (e - w) * (j + 1) / n:.6f}")
            d = overpass(qfmt.format(bb=bb), f"{tag}_{i}{j}")
            for el in d["elements"]:
                k = (el["type"], el["id"])
                if k not in seen:
                    seen.add(k)
                    els.append(el)
    print(f"  {tag}: {len(els)} unique elements over {n}x{n} tiles")
    return {"elements": els}


# ---------------------------------------------------------------- geometry
def assemble_rings(ways):
    """ways: list of Nx2 arrays (open or closed). Returns list of closed rings."""
    rings = []
    pending = [w for w in ways if len(w) >= 2]
    while pending:
        cur = pending.pop(0)
        changed = True
        while not np.allclose(cur[0], cur[-1], atol=1e-3) and changed:
            changed = False
            for i, w in enumerate(pending):
                if np.allclose(cur[-1], w[0], atol=1e-3):
                    cur = np.vstack([cur, w[1:]])
                elif np.allclose(cur[-1], w[-1], atol=1e-3):
                    cur = np.vstack([cur, w[::-1][1:]])
                elif np.allclose(cur[0], w[-1], atol=1e-3):
                    cur = np.vstack([w, cur[1:]])
                elif np.allclose(cur[0], w[0], atol=1e-3):
                    cur = np.vstack([w[::-1], cur[1:]])
                else:
                    continue
                pending.pop(i)
                changed = True
                break
        if np.allclose(cur[0], cur[-1], atol=1e-3) and len(cur) >= 4:
            rings.append(cur)
    return rings


def outer_rings(el, frame):
    """Outer rings (local metres, closed) for a way or multipolygon relation with out geom."""
    if el["type"] == "way":
        g = el.get("geometry")
        if not g:
            return []
        a = frame.geom_xy(g)
        if len(a) >= 4 and np.allclose(a[0], a[-1], atol=1e-3):
            return [a]
        return []
    if el["type"] == "relation":
        ways = [frame.geom_xy(m["geometry"]) for m in el.get("members", [])
                if m.get("type") == "way" and m.get("role", "outer") in ("outer", "") and m.get("geometry")]
        return assemble_rings(ways)
    return []


def dp(pts, eps):
    """Douglas-Peucker on Nx2 array (iterative)."""
    n = len(pts)
    if n < 3:
        return pts
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        seg = pts[a + 1:b]
        d = q - p
        L = math.hypot(d[0], d[1])
        if L < 1e-9:
            dist = np.hypot(seg[:, 0] - p[0], seg[:, 1] - p[1])
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L
        i = int(np.argmax(dist))
        if dist[i] > eps:
            m = a + 1 + i
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return pts[keep]


def dp_ring(ring, eps):
    """DP for a closed ring: split at the vertex farthest from ring[0]."""
    r = ring[:-1] if np.allclose(ring[0], ring[-1]) else ring
    if len(r) < 4:
        return r
    far = int(np.argmax(np.hypot(*(r - r[0]).T)))
    a = dp(np.vstack([r[:far + 1]]), eps)
    b = dp(np.vstack([r[far:], r[:1]]), eps)
    return np.vstack([a[:-1], b[:-1]])  # open ring (no repeated closing vertex)


def area(ring):
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def poly_len(a):
    return float(np.sum(np.hypot(*np.diff(a, axis=0).T))) if len(a) > 1 else 0.0


def clip_polyline(a, lim):
    """Split a polyline into runs inside the square |x|,|y|<=lim, cutting segments at the edge."""
    out, cur = [], []
    inside = (np.abs(a[:, 0]) <= lim) & (np.abs(a[:, 1]) <= lim)

    def cut(p, q):
        # point on segment p->q at the square boundary (p inside, q outside)
        t = 1.0
        d = q - p
        for k in range(2):
            if d[k] > 0 and q[k] > lim:
                t = min(t, (lim - p[k]) / d[k])
            elif d[k] < 0 and q[k] < -lim:
                t = min(t, (-lim - p[k]) / d[k])
        return p + d * t

    for i in range(len(a)):
        if inside[i]:
            if not cur and i > 0:
                cur.append(cut(a[i], a[i - 1]))
            cur.append(a[i])
        else:
            if cur:
                cur.append(cut(a[i - 1], a[i]))
                out.append(np.array(cur))
                cur = []
    if cur:
        out.append(np.array(cur))
    return [c for c in out if len(c) >= 2]


def tag_height(tags, default=10.0):
    def num(s):
        try:
            s = str(s).strip().lower().replace(",", ".")
            ft = s.endswith("ft") or s.endswith("'")
            s = s.replace("m", "").replace("ft", "").replace("'", "").strip().split(";")[0].split()[0]
            v = float(s)
            return v * 0.3048 if ft else v
        except Exception:
            return None
    h = num(tags["height"]) if "height" in tags else None
    if h is None and "building:levels" in tags:
        lv = num(tags["building:levels"])
        if lv is not None:
            h = lv * 3.2
    if h is None or h <= 0:
        h = default
    mh = num(tags["min_height"]) if "min_height" in tags else None
    if mh is None and "building:min_level" in tags:
        lv = num(tags["building:min_level"])
        mh = lv * 3.2 if lv is not None else None
    mh = mh if (mh is not None and 0 <= mh < h) else 0.0
    return h, mh


# ---------------------------------------------------------------- buildings / roads
def build_buildings(frame, data, min_area=6.0):
    b = []
    dropped = 0
    lim = frame.half
    for el in data["elements"]:
        if el["type"] not in ("way", "relation"):
            continue
        tags = el.get("tags", {})
        if "building" not in tags:
            continue
        h, mh = tag_height(tags)
        for ring in outer_rings(el, frame):
            c = ring[:-1].mean(0)
            if abs(c[0]) > lim or abs(c[1]) > lim:
                continue
            s = dp_ring(ring, 0.5)
            if len(s) < 3 or area(s) < min_area:
                dropped += 1
                continue
            b.append([r1(h), r1(mh)] + flat(s))
    print(f"  buildings: {len(b)} kept, {dropped} tiny dropped")
    return {"count": len(b), "b": b}


ROAD_CLASS = {
    "motorway": 0, "trunk": 0,
    "primary": 1, "secondary": 2, "tertiary": 3,
    "residential": 4, "unclassified": 4, "living_street": 4,
    "motorway_link": 5, "trunk_link": 5, "primary_link": 5, "secondary_link": 5,
    "tertiary_link": 5, "service": 5,
}
DEFAULT_LANES = {0: 3, 1: 2, 2: 2, 3: 2, 4: 1, 5: 1}


def build_roads(frame, data):
    roads = []
    counts = {}
    lim = frame.half + 50
    for el in data["elements"]:
        if el["type"] != "way" or not el.get("geometry"):
            continue
        tags = el.get("tags", {})
        hw = tags.get("highway")
        if hw not in ROAD_CLASS:
            continue
        cls = ROAD_CLASS[hw]
        a = frame.geom_xy(el["geometry"])
        if hw == "service" and poly_len(a) <= 80:
            continue
        ow = tags.get("oneway", "")
        oneway = 0
        if ow in ("yes", "1", "true") or (hw in ("motorway",) and ow != "no") or tags.get("junction") in ("roundabout", "circular"):
            oneway = 1
        elif ow == "-1":
            oneway = 1
            a = a[::-1]
        try:
            lanes = int(str(tags.get("lanes", "")).split(";")[0])
        except ValueError:
            lanes = DEFAULT_LANES[cls] * (1 if oneway else 2) if cls < 4 else (1 if oneway else 2)
        for part in clip_polyline(a, lim):
            if poly_len(part) < 2:
                continue
            roads.append([cls, oneway, lanes] + flat(part))
            counts[cls] = counts.get(cls, 0) + 1
    print(f"  roads: {len(roads)} polylines, by class {dict(sorted(counts.items()))}")
    return {"roads": roads}


# ---------------------------------------------------------------- aeroway
def build_aeroway(frame, data):
    lim = frame.half + 200
    runways, taxiways, aprons, terminals, gates, parking = [], [], [], [], [], []
    apron_names = []
    for el in data["elements"]:
        tags = el.get("tags", {})
        aw = tags.get("aeroway")
        if el["type"] == "node":
            x, y = frame.xy(el["lon"], el["lat"])
            if abs(x) > lim or abs(y) > lim:
                continue
            if aw == "gate":
                gates.append([r1(x), r1(y), tags.get("ref", tags.get("name", ""))])
            elif aw == "parking_position":
                parking.append([r1(x), r1(y), tags.get("ref", tags.get("name", ""))])
            continue
        if aw == "runway" and el["type"] == "way" and el.get("geometry"):
            a = frame.geom_xy(el["geometry"])
            closed = len(a) > 3 and np.allclose(a[0], a[-1], atol=1e-3)
            try:
                w = float(str(tags.get("width", "")).replace("m", "").strip())
            except ValueError:
                w = None
            if closed or tags.get("area") == "yes":
                # area runway: use its long axis (PCA) as centreline, width = short extent
                c = a.mean(0)
                u, s, vt = np.linalg.svd(a - c, full_matrices=False)
                ax = vt[0]
                t = (a - c) @ ax
                n = (a - c) @ vt[1]
                p1, p2 = c + ax * t.min(), c + ax * t.max()
                w = w or float(n.max() - n.min())
            else:
                p1, p2 = a[0], a[-1]
            runways.append([r1(w or 45.0), tags.get("ref", ""), r1(p1[0]), r1(p1[1]), r1(p2[0]), r1(p2[1])])
        elif aw == "taxiway" and el["type"] == "way" and el.get("geometry"):
            a = frame.geom_xy(el["geometry"])
            if tags.get("area") == "yes":
                continue
            for part in clip_polyline(a, lim):
                taxiways.append(flat(part))
        elif aw == "apron":
            for ring in outer_rings(el, frame):
                c = ring.mean(0)
                if abs(c[0]) > lim or abs(c[1]) > lim:
                    continue
                aprons.append(flat(dp_ring(ring, 0.5)))
                apron_names.append(tags.get("name", ""))
        elif aw == "terminal":
            h, _ = tag_height(tags)
            for ring in outer_rings(el, frame):
                c = ring.mean(0)
                if abs(c[0]) > lim or abs(c[1]) > lim:
                    continue
                terminals.append([r1(h)] + flat(dp_ring(ring, 0.5)))
    # OSM often splits one runway into several ways (displaced thresholds, blast pads):
    # merge segments sharing a ref into one centreline spanning their extreme endpoints.
    merged, groups = [], {}
    for rw in runways:
        if rw[1]:
            groups.setdefault(rw[1], []).append(rw)
        else:
            merged.append(rw)
    for ref, segs in groups.items():
        pts = np.array([[s[2], s[3]] for s in segs] + [[s[4], s[5]] for s in segs])
        main = max(segs, key=lambda s: math.hypot(s[4] - s[2], s[5] - s[3]))
        ax = np.array([main[4] - main[2], main[5] - main[3]])
        ax /= np.linalg.norm(ax)
        t = (pts - pts[0]) @ ax
        p1, p2 = pts[int(np.argmin(t))], pts[int(np.argmax(t))]
        merged.append([main[0], ref, r1(p1[0]), r1(p1[1]), r1(p2[0]), r1(p2[1])])
    if len(merged) != len(runways):
        print(f"  runways: merged {len(runways)} OSM segments into {len(merged)}")
    runways = merged
    out = {"runways": runways, "taxiways": taxiways, "aprons": aprons, "apronNames": apron_names,
           "terminals": terminals, "gates": gates, "parking": parking}
    print("  aeroway: " + ", ".join(f"{k}={len(v)}" for k, v in out.items()))
    return out


# ---------------------------------------------------------------- tiles / imagery
def merc_px(lon, lat, z, ts=256):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n * ts
    lat_r = np.radians(lat)
    y = (1.0 - np.log(np.tan(lat_r) + 1.0 / np.cos(lat_r)) / math.pi) / 2.0 * n * ts
    return x, y


def fetch_tiles(url_fmt, tiles, subdir, ext, workers=8):
    d = os.path.join(CACHE, subdir)
    os.makedirs(d, exist_ok=True)
    sess = requests.Session()
    sess.headers.update(UA)
    fails = []

    def get(t):
        z, x, y = t
        p = os.path.join(d, f"{z}_{x}_{y}.{ext}")
        if os.path.exists(p) and os.path.getsize(p) > 0:
            return p
        for i in range(4):
            try:
                r = sess.get(url_fmt.format(z=z, x=x, y=y), timeout=60)
                if r.status_code == 200 and len(r.content) > 100:
                    with open(p + ".tmp", "wb") as f:
                        f.write(r.content)
                    os.replace(p + ".tmp", p)
                    return p
                if r.status_code == 404:
                    break
            except Exception:
                pass
            time.sleep(1.5 * (i + 1))
        fails.append(t)
        return None

    with ThreadPoolExecutor(workers) as ex:
        res = list(ex.map(get, tiles))
    return dict(zip(tiles, res)), fails


def mosaic(frame, z, url_fmt, subdir, ext, mode, pad_m=300.0):
    s, w, n, e = frame.bbox(pad_m)
    x0, y1 = merc_px(w, s, z)
    x1, y0 = merc_px(e, n, z)
    tx0, tx1 = int(x0 // 256), int(x1 // 256)
    ty0, ty1 = int(y0 // 256), int(y1 // 256)
    tiles = [(z, x, y) for y in range(ty0, ty1 + 1) for x in range(tx0, tx1 + 1)]
    print(f"  {subdir} z{z}: {tx1-tx0+1}x{ty1-ty0+1} = {len(tiles)} tiles", flush=True)
    paths, fails = fetch_tiles(url_fmt, tiles, subdir, ext)
    if fails:
        print(f"  WARNING: {len(fails)} tiles failed: {fails[:10]}")
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    nb = 3 if mode == "RGB" else 3
    mos = np.zeros((H, W, nb), np.uint8)
    for (zz, x, y), p in paths.items():
        if p is None:
            continue
        im = Image.open(p).convert("RGB")
        if im.size != (256, 256):
            im = im.resize((256, 256))
        mos[(y - ty0) * 256:(y - ty0 + 1) * 256, (x - tx0) * 256:(x - tx0 + 1) * 256] = np.asarray(im)
    return mos, tx0 * 256, ty0 * 256, len(fails)


def bilinear(img, px, py):
    """img HxWxC (float or uint8), px/py float arrays in pixel coords (pixel centres at i+0.5)."""
    H, W = img.shape[:2]
    fx = np.clip(px - 0.5, 0, W - 1.000001)
    fy = np.clip(py - 0.5, 0, H - 1.000001)
    x0 = np.floor(fx).astype(np.int64)
    y0 = np.floor(fy).astype(np.int64)
    ax = (fx - x0)[..., None]
    ay = (fy - y0)[..., None]
    im = img if img.ndim == 3 else img[..., None]
    a = im[y0, x0].astype(np.float32)
    b = im[y0, x0 + 1].astype(np.float32)
    c = im[y0 + 1, x0].astype(np.float32)
    d = im[y0 + 1, x0 + 1].astype(np.float32)
    out = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay
    return out if img.ndim == 3 else out[..., 0]


def reproject(frame, img, ox, oy, z, N, rows_per=256):
    """Sample a Mercator mosaic (origin global px ox,oy at zoom z) onto the local NxN square."""
    h = frame.half
    out = np.zeros((N, N) + img.shape[2:], np.float32)
    xs = -h + (np.arange(N) + 0.5) * (2 * h / N)
    for r0 in range(0, N, rows_per):
        r = np.arange(r0, min(N, r0 + rows_per))
        ys = h - (r + 0.5) * (2 * h / N)
        X, Y = np.meshgrid(xs, ys)
        lon, lat = frame.ll(X, Y)
        mx, my = merc_px(lon, lat, z)
        out[r0:r0 + len(r)] = bilinear(img, mx - ox, my - oy)
    return out


ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"


EOX_S2 = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"


def build_ground(frame, z, url=ESRI, sub="esri", name="ground"):
    mos, ox, oy, nf = mosaic(frame, z, url, sub, "jpg", "RGB")
    out = reproject(frame, mos, ox, oy, z, 4096)
    im = Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))
    p = os.path.join(frame.out, f"{name}.jpg")
    im.save(p, quality=90, optimize=True)
    print(f"  wrote {p} ({os.path.getsize(p)/1e6:.2f} MB)")
    im2 = im.resize((2048, 2048), Image.LANCZOS)
    p2 = os.path.join(frame.out, f"{name}_2k.jpg")
    im2.save(p2, quality=88, optimize=True)
    print(f"  wrote {p2} ({os.path.getsize(p2)/1e6:.2f} MB)")
    return nf


# ---------------------------------------------------------------- check overlay
def to_px(frame, a, N):
    a = np.asarray(a, dtype=np.float64).reshape(-1, 2)
    return [((x + frame.half) / (2 * frame.half) * N, (frame.half - y) / (2 * frame.half) * N) for x, y in a]


def check_canvas(frame, dark=0.45):
    from PIL import ImageEnhance
    im = Image.open(os.path.join(frame.out, "ground_2k.jpg")).convert("RGB")
    im = ImageEnhance.Brightness(im).enhance(dark)
    return im
