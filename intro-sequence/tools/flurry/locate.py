"""Locator sheets: a wider mosaic around a guess with a lat/lon grid, to find exact coords.

usage: python3 locate.py out.jpg "name|lat|lon|z|ntiles" ...
Each panel is ntiles x ntiles tiles at zoom z (resized to 640px) with grid
lines every `step` degrees, labelled. Panels are stacked in a 2-column grid.
"""
import io
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiles import fetch_tile, pixel_xy  # noqa: E402

P = 640


def panel(name, lat, lon, z, nt):
    px, py = pixel_xy(lat, lon, z)
    tx, ty = int(px // 256), int(py // 256)
    h = nt // 2
    coords = [(tx - h + i, ty - h + j) for j in range(nt) for i in range(nt)]
    with ThreadPoolExecutor(8) as ex:
        datas = list(ex.map(lambda c: fetch_tile(z, c[0], c[1]), coords))
    m = Image.new("RGB", (nt * 256, nt * 256))
    for (x, y), d in zip(coords, datas):
        m.paste(Image.open(io.BytesIO(d)).convert("RGB"), ((x - tx + h) * 256, (y - ty + h) * 256))
    ox, oy = (tx - h) * 256, (ty - h) * 256
    s = P / (nt * 256)
    m = m.resize((P, P), Image.LANCZOS)
    d = ImageDraw.Draw(m)
    n = 2 ** z * 256

    def lon2x(lo):
        return ((lo + 180) / 360 * n - ox) * s

    def lat2y(la):
        si = math.sin(math.radians(la))
        return ((0.5 - math.log((1 + si) / (1 - si)) / (4 * math.pi)) * n - oy) * s

    span = nt * 256 / n * 360
    step = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5][
        min(range(9), key=lambda k: abs(span / [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5][k] - 6))]
    lo0 = math.floor((lon - span) / step) * step
    for k in range(40):
        lo = lo0 + k * step
        x = lon2x(lo)
        if 0 <= x <= P:
            d.line((x, 0, x, P), fill=(255, 255, 0), width=1)
            d.text((x + 2, P - 12), f"{lo:.3f}", fill=(255, 255, 0))
    la0 = math.floor((lat - span) / step) * step
    for k in range(40):
        la = la0 + k * step
        y = lat2y(la)
        if 0 <= y <= P:
            d.line((0, y, P, y), fill=(0, 255, 255), width=1)
            d.text((2, y + 1), f"{la:.3f}", fill=(0, 255, 255))
    cx, cy = lon2x(lon), lat2y(lat)
    d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), outline=(255, 0, 0), width=2)
    d.rectangle((0, 0, P, 14), fill=(0, 0, 0))
    d.text((3, 1), f"{name} z{z}", fill=(255, 255, 255))
    return m


if __name__ == "__main__":
    out = sys.argv[1]
    specs = [a.split("|") for a in sys.argv[2:]]
    ps = [panel(s[0], float(s[1]), float(s[2]), int(s[3]), int(s[4])) for s in specs]
    cols = 2 if len(ps) > 1 else 1
    rows = (len(ps) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * P, rows * P))
    for i, p in enumerate(ps):
        sheet.paste(p, ((i % cols) * P, (i // cols) * P))
    sheet.save(out, quality=85)
    print(out)
