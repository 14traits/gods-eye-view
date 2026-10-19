"""Polite cached Esri World Imagery fetch + 512px centred capture + quality metrics."""
import hashlib
import io
import math
import os
import threading
import time

import numpy as np
import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "imagery", "flurry")

ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
UA = "gods-eye-view-intro/1.0 (flurry montage prep)"
MAX_WORKERS = 8
PLACEHOLDER_MD5 = {"f27d9de7f80c13501f470595e327aa6d"}  # "Map data not yet available"

_local = threading.local()


def _session():
    s = getattr(_local, "s", None)
    if s is None:
        s = requests.Session()
        s.headers["User-Agent"] = UA
        _local.s = s
    return s


def fetch_tile(z, x, y, retries=6):
    n = 2 ** z
    x %= n
    path = os.path.join(CACHE, str(z), str(x), f"{y}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, "rb") as f:
            return f.read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = ESRI.format(z=z, x=x, y=y)
    last = None
    for attempt in range(retries):
        try:
            r = _session().get(url, timeout=45)
            if r.status_code == 200 and r.content:
                tmp = path + f".{threading.get_ident()}.part"
                with open(tmp, "wb") as f:
                    f.write(r.content)
                os.replace(tmp, path)
                return r.content
            last = f"HTTP {r.status_code}"
            if r.status_code in (400, 404):
                break
        except Exception as e:
            last = repr(e)
        time.sleep(min(20, 1.0 * 2 ** attempt))
    raise RuntimeError(f"failed {url}: {last}")


def is_placeholder(data):
    if hashlib.md5(data).hexdigest() in PLACEHOLDER_MD5:
        return True
    a = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(np.float32)
    m = a.mean(axis=(0, 1))
    return bool(abs(m - 204.7).max() < 4 and a.std() < 9)


def pixel_xy(lat, lon, z):
    n = 2 ** z * 256
    px = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    py = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return px, py


def capture(lat, lon, z, size=512):
    """Return (image, info). info has placeholder flag and quality metrics."""
    px, py = pixel_xy(lat, lon, z)
    tx, ty = int(px // 256), int(py // 256)
    mosaic = Image.new("RGB", (768, 768))
    ox, oy = (tx - 1) * 256, (ty - 1) * 256
    left, top = int(round(px - ox - size / 2)), int(round(py - oy - size / 2))
    ph = False
    for j in range(3):
        for i in range(3):
            data = fetch_tile(z, tx - 1 + i, ty - 1 + j)
            # does this tile overlap the crop window?
            tl, tt = i * 256, j * 256
            overlaps = tl < left + size and tl + 256 > left and tt < top + size and tt + 256 > top
            if overlaps and is_placeholder(data):
                ph = True
            mosaic.paste(Image.open(io.BytesIO(data)).convert("RGB"), (tl, tt))
    img = mosaic.crop((left, top, left + size, top + size))
    info = metrics(img)
    info["placeholder"] = ph
    return img, info


def metrics(img):
    a = np.asarray(img).astype(np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    small = np.asarray(img.convert("L").resize((128, 128), Image.BILINEAR)).astype(np.float32)
    gx = np.abs(np.diff(lum, axis=1)).mean()
    gy = np.abs(np.diff(lum, axis=0)).mean()
    # coarse-scale structure: std of 32px block means (catches flat ocean/cloud/ice)
    blocks = lum.reshape(16, 32, 16, 32).mean(axis=(1, 3))
    sat = (a.max(axis=2) - a.min(axis=2)).mean()
    return {
        "std": float(lum.std()),
        "grad": float((gx + gy) / 2),
        "block_std": float(blocks.std()),
        "small_std": float(small.std()),
        "sat": float(sat),
        "mean": float(lum.mean()),
    }


def quality_ok(info):
    if info["placeholder"]:
        return False, "placeholder"
    if info["std"] < 12:
        return False, f"low variance (std {info['std']:.1f})"
    if info["grad"] < 1.3:
        return False, f"featureless (grad {info['grad']:.1f})"
    if info["mean"] > 225 and info["std"] < 25:
        return False, "cloud/snow white-out"
    if info["mean"] < 22:
        return False, "too dark"
    return True, ""
