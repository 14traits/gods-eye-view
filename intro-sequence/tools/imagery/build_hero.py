"""Deliverable 4: Esri World Imagery 'synthetic screenshots' of iconic places.

For each location: <slug>_wide.jpg (zoom 13) and <slug>_close.jpg (zoom 18,
falling back to 17/16 when Esri serves "Map data not yet available"
placeholder tiles), both 1536x1024 centred on the point. Writes index.json.

Usage: python3 build_hero.py [--contact DIR]   (contact sheets for visual QA)
       Per-location overrides: CLOSE_ZOOM_OVERRIDES below.
"""
import io
import json
import math
import os
import sys
import numpy as np
from PIL import Image
from common import OUT, esri_jobs, fetch_many

HERO = os.path.join(OUT, "hero")
CW, CH = 1536, 1024
TS = 256

LOCATIONS = [
    ("manhattan", "Midtown Manhattan", 40.7580, -73.9855),
    ("palm_jumeirah", "Palm Jumeirah", 25.1124, 55.1390),
    ("singapore_port", "Port of Singapore (Pasir Panjang Terminal)", 1.2730, 103.7690),  # was 1.2650,103.8180 (Keppel Bay residential, no port),
    ("shibuya", "Shibuya Crossing", 35.6595, 139.7005),
    ("arc_de_triomphe", "Arc de Triomphe", 48.8738, 2.2950),
    ("giza", "Giza Pyramids", 29.9792, 31.1342),
    ("rotterdam_port", "Port of Rotterdam", 51.9500, 4.0500),
    ("lax", "Los Angeles International Airport", 33.9416, -118.4085),
    ("hong_kong", "Victoria Harbour, Hong Kong", 22.2930, 114.1700),
    ("panama_canal", "Panama Canal, Miraflores Locks", 8.9966, -79.5915),  # was 9.0800,-79.6800 (blurry jungle/lake shore),
    ("sydney_opera", "Sydney Opera House", -33.8568, 151.2153),
    ("kennedy_lc39a", "Kennedy Space Center LC-39A", 28.6083, -80.6041),
    ("heathrow", "London Heathrow Airport", 51.4700, -0.4543),
    ("rio_maracana", "Maracana Stadium, Rio de Janeiro", -22.9122, -43.2302),
    ("venice", "Venice", 45.4340, 12.3388),
    ("las_vegas_strip", "Las Vegas Strip", 36.1147, -115.1728),
    ("vatican", "Vatican City", 41.9022, 12.4539),
    ("burj_khalifa", "Burj Khalifa, Dubai", 25.1972, 55.2744),
    ("golden_gate", "Golden Gate Bridge", 37.8199, -122.4783),
    ("kremlin", "Moscow Kremlin", 55.7520, 37.6175),
    ("tiananmen", "Tiananmen Square, Beijing", 39.9037, 116.3917),  # was 39.9055,116.3976 (east of the square),
    ("mumbai_port", "Mumbai Port", 18.9400, 72.8400),
    ("suez_canal", "Suez Canal, Ismailia", 30.6141, 32.3228),  # was 30.5850,32.2650 (Ismailia city blocks, canal off-frame),
    ("pentagon", "The Pentagon", 38.8719, -77.0563),
]

WIDE_ZOOM = 13
CLOSE_ZOOM = 18
CLOSE_ZOOM_OVERRIDES = {}  # slug -> zoom, set after visual QA if needed
DROP = set()               # slugs rejected after visual QA


def world_px(lat, lon, z):
    n = TS * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def is_placeholder(tile):
    a = np.asarray(tile).astype(np.float32)
    m = a.reshape(-1, 3).mean(0)
    return a.std() < 8 and abs(m[0] - m[1]) < 4 and abs(m[1] - m[2]) < 4


def render(lat, lon, z):
    """Return (image, placeholder_fraction)."""
    cx, cy = world_px(lat, lon, z)
    x0, y0 = int(round(cx - CW / 2)), int(round(cy - CH / 2))
    tx0, ty0 = x0 // TS, y0 // TS
    tx1, ty1 = (x0 + CW - 1) // TS, (y0 + CH - 1) // TS
    n = 2 ** z
    coords = [(tx % n, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    data = fetch_many(esri_jobs(z, coords), desc=f"z{z}")
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * TS, (ty1 - ty0 + 1) * TS))
    ph = 0
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            b = data.get((tx % n, ty))
            if b is None:
                ph += 1
                continue
            t = Image.open(io.BytesIO(b)).convert("RGB")
            if is_placeholder(t):
                ph += 1
            canvas.paste(t, ((tx - tx0) * TS, (ty - ty0) * TS))
    crop = canvas.crop((x0 - tx0 * TS, y0 - ty0 * TS, x0 - tx0 * TS + CW, y0 - ty0 * TS + CH))
    return crop, ph / len(coords)


def main():
    os.makedirs(HERO, exist_ok=True)
    contact = None
    if "--contact" in sys.argv:
        contact = sys.argv[sys.argv.index("--contact") + 1]
        os.makedirs(contact, exist_ok=True)
    index = []
    for slug, name, lat, lon in LOCATIONS:
        if slug in DROP:
            for k in ("wide", "close"):
                p = os.path.join(HERO, f"{slug}_{k}.jpg")
                if os.path.exists(p):
                    os.remove(p)
            print(f"{slug}: dropped")
            continue
        wide, _ = render(lat, lon, WIDE_ZOOM)
        z = CLOSE_ZOOM_OVERRIDES.get(slug, CLOSE_ZOOM)
        while True:
            close, ph = render(lat, lon, z)
            if ph == 0 or z <= 16:
                break
            print(f"  {slug}: {ph:.0%} placeholder tiles at z{z}, falling back")
            z -= 1
        wide.save(os.path.join(HERO, f"{slug}_wide.jpg"), quality=92, optimize=True)
        close.save(os.path.join(HERO, f"{slug}_close.jpg"), quality=92, optimize=True)
        index.append({"slug": slug, "name": name, "lat": lat, "lon": lon, "close_zoom": z})
        print(f"{slug}: close z{z}")
        if contact:
            sheet = Image.new("RGB", (1536, 512))
            sheet.paste(wide.resize((768, 512), Image.LANCZOS), (0, 0))
            sheet.paste(close.resize((768, 512), Image.LANCZOS), (768, 0))
            sheet.save(os.path.join(contact, f"{slug}.jpg"), quality=85)
    with open(os.path.join(HERO, "index.json"), "w") as f:
        json.dump(index, f, indent=2)
    print(f"{len(index)} locations written")


if __name__ == "__main__":
    main()
