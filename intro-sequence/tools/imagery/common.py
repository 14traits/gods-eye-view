"""Shared helpers: polite cached tile fetching for Esri World Imagery and NASA GIBS."""
import io
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "imagery")

MAX_WORKERS = 8
UA = "gods-eye-view-intro/1.0 (texture prep; contact: project maintainer)"

ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
GIBS4326 = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{time}/{tms}/{z}/{row}/{col}.{ext}"

_local = threading.local()


def _session():
    s = getattr(_local, "s", None)
    if s is None:
        s = requests.Session()
        s.headers["User-Agent"] = UA
        _local.s = s
    return s


def fetch(url, cache_path, retries=6):
    """Return raw bytes for url, caching to cache_path. Retries with backoff."""
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        with open(cache_path, "rb") as f:
            return f.read()
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    last = None
    for attempt in range(retries):
        try:
            r = _session().get(url, timeout=60)
            if r.status_code == 200 and r.content:
                tmp = cache_path + ".part"
                with open(tmp, "wb") as f:
                    f.write(r.content)
                os.replace(tmp, cache_path)
                return r.content
            if r.status_code in (400, 404):
                last = f"HTTP {r.status_code}"
                break
            last = f"HTTP {r.status_code}"
        except Exception as e:  # network hiccup
            last = repr(e)
        time.sleep(min(30, 1.5 * 2 ** attempt))
    raise RuntimeError(f"failed {url}: {last}")


def fetch_many(jobs, desc=""):
    """jobs: list of (key, url, cache_path). Returns {key: bytes or None}."""
    out = {}
    done = 0
    with ThreadPoolExecutor(MAX_WORKERS) as ex:
        futs = {ex.submit(fetch, u, p): k for k, u, p in jobs}
        for f in as_completed(futs):
            k = futs[f]
            try:
                out[k] = f.result()
            except Exception as e:
                print(f"  ! {e}", file=sys.stderr)
                out[k] = None
            done += 1
            if done % 100 == 0 or done == len(jobs):
                print(f"  {desc} {done}/{len(jobs)}", flush=True)
    return out


def esri_tile_path(z, x, y):
    return os.path.join(CACHE, "esri", str(z), str(y), f"{x}.jpg")


def esri_jobs(z, coords):
    return [((x, y), ESRI.format(z=z, x=x, y=y), esri_tile_path(z, x, y)) for x, y in coords]


def gibs_path(layer, time_, tms, z, row, col, ext):
    return os.path.join(CACHE, "gibs", layer, time_ or "default", tms, str(z), str(row), f"{col}.{ext}")


def gibs_jobs(layer, time_, tms, z, rows, cols, ext):
    t = time_ or "default"
    return [((r, c), GIBS4326.format(layer=layer, time=t, tms=tms, z=z, row=r, col=c, ext=ext),
             gibs_path(layer, time_, tms, z, r, c, ext)) for r in range(rows) for c in range(cols)]


def decode(b, mode="RGB"):
    return Image.open(io.BytesIO(b)).convert(mode)


def gibs_mosaic(layer, time_, tms, z, rows, cols, ext, mode="RGB"):
    """Fetch and stitch a full-globe GIBS EPSG:4326 level (512px tiles)."""
    jobs = gibs_jobs(layer, time_, tms, z, rows, cols, ext)
    data = fetch_many(jobs, desc=f"{layer} z{z}")
    W, H = cols * 512, rows * 512
    canvas = Image.new(mode, (W, H))
    missing = 0
    for (r, c), b in data.items():
        if b is None:
            missing += 1
            continue
        canvas.paste(decode(b, mode), (c * 512, r * 512))
    if missing:
        print(f"  {missing} tiles missing for {layer}", file=sys.stderr)
    return canvas
