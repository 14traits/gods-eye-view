"""Deliverable 1: earth_day.jpg (8192x4096) + earth_day_4k.jpg (4096x2048).

Esri World Imagery z5 (32x32 tiles, 8192x8192 Web Mercator) reprojected to
equirectangular with bilinear sampling. Because both grids are 8192 px wide and
linear in longitude, the horizontal axis maps 1:1 and only latitude needs
resampling (linear interpolation between Mercator rows = bilinear).

Polar caps beyond the Mercator limit (+-85.0511 deg) come from NASA GIBS
BlueMarble_ShadedRelief_Bathymetry (EPSG:4326, level 4 = 10240x5120; its shaded
bathymetry matches Esri's small-scale ocean rendering), colour-matched to Esri
with a least-squares affine colour transform fitted on co-registered overlap pixels and cross-faded between 80 and 84.5 deg.
"""
import os
import numpy as np
from PIL import Image
from common import OUT, esri_jobs, fetch_many, decode, gibs_mosaic

Image.MAX_IMAGE_PIXELS = None
W, H = 8192, 4096
Z = 5
N = 2 ** Z
TS = 256
MERC = N * TS  # 8192
MERC_LIMIT = np.degrees(np.arctan(np.sinh(np.pi)))  # 85.0511
FADE_A, FADE_B = 80.0, 84.5  # pure Esri below A, pure Blue Marble above B
CAP_LAYER = os.environ.get("CAP_LAYER", "BlueMarble_ShadedRelief_Bathymetry")


def esri_mercator():
    coords = [(x, y) for y in range(N) for x in range(N)]
    res = fetch_many(esri_jobs(Z, coords), desc="esri z5")
    merc = np.zeros((MERC, MERC, 3), np.uint8)
    for (x, y), b in res.items():
        if b is None:
            raise SystemExit(f"missing esri tile {x},{y}")
        merc[y * TS:(y + 1) * TS, x * TS:(x + 1) * TS] = np.asarray(decode(b))
    return merc


def main():
    merc = esri_mercator()
    print("reprojecting")
    lat = 90.0 - (np.arange(H) + 0.5) * 180.0 / H
    latc = np.clip(lat, -MERC_LIMIT + 1e-6, MERC_LIMIT - 1e-6)
    yn = (1.0 - np.log(np.tan(np.pi / 4 + np.radians(latc) / 2)) / np.pi) / 2.0
    v = yn * MERC - 0.5
    v0 = np.clip(np.floor(v).astype(int), 0, MERC - 1)
    v1 = np.clip(v0 + 1, 0, MERC - 1)
    f = np.clip(v - np.floor(v), 0, 1).astype(np.float32)[:, None, None]
    eq = np.empty((H, W, 3), np.float32)
    for s in range(0, H, 256):
        e = s + 256
        eq[s:e] = merc[v0[s:e]].astype(np.float32) * (1 - f[s:e]) + merc[v1[s:e]].astype(np.float32) * f[s:e]
    del merc

    print("fetching polar caps:", CAP_LAYER)
    bm = gibs_mosaic(CAP_LAYER, None, "500m", 4, 10, 20, "jpg")
    bm = np.asarray(bm.resize((W, H), Image.LANCZOS)).astype(np.float32)

    # colour-match Blue Marble to Esri per hemisphere: fit an affine 3x3+offset colour
    # transform (least squares) on co-registered pixels in the 76-84.5 deg overlap band
    alat = np.abs(lat)
    band = (alat > 76) & (alat < 84.5)
    t = np.clip((alat - FADE_A) / (FADE_B - FADE_A), 0, 1)
    t = (t * t * (3 - 2 * t)).astype(np.float32)[:, None, None]  # smoothstep
    out = eq.copy()
    for hemi in (lat > 0, lat < 0):
        rows = band & hemi
        a = eq[rows][:, ::4].reshape(-1, 3)
        b = bm[rows][:, ::4].reshape(-1, 3)
        X = np.hstack([b, np.ones((len(b), 1), np.float32)])
        # ridge-regularised toward identity: near-grey ice makes the plain fit ill-conditioned
        lam = len(b) * 50.0
        D = np.diag([1.0, 1.0, 1.0, 0.0])
        I0 = np.vstack([np.eye(3), np.zeros((1, 3))])
        X64, a64 = X.astype(np.float64), a.astype(np.float64)
        M = np.linalg.solve(X64.T @ X64 + lam * D, X64.T @ a64 + lam * D @ I0)
        print("  colour transform\n", M.round(3))
        h = bm[hemi]
        bm[hemi] = (h.reshape(-1, 3) @ M[:3] + M[3]).reshape(h.shape)
        out[hemi] = eq[hemi] * (1 - t[hemi]) + bm[hemi] * t[hemi]

    img = Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, "earth_day.jpg"), quality=92, optimize=True, progressive=True)
    img.resize((4096, 2048), Image.LANCZOS).save(os.path.join(OUT, "earth_day_4k.jpg"), quality=92, optimize=True, progressive=True)
    print("done")


if __name__ == "__main__":
    main()
