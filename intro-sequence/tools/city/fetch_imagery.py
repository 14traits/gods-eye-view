"""Esri World Imagery mosaic -> local ENU square, 4096^2 + 2048^2 JPEG.

usage: python3 -I tools/city/fetch_imagery.py nyc boston [--zoom 17]
"""
import sys, os, math, io, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import requests
from PIL import Image
from scipy.ndimage import map_coordinates
from geo import CITIES, OUT, CACHE, Frame

URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
TS = 256
N = 4096
SS = 2  # supersample factor before Lanczos downsample


def merc_px(lat, lon, z):
    s = TS * 2 ** z
    x = (lon + 180.0) / 360.0 * s
    lr = np.radians(lat)
    y = (1.0 - np.log(np.tan(lr) + 1.0 / np.cos(lr)) / math.pi) / 2.0 * s
    return x, y


sess = requests.Session()
sess.headers['User-Agent'] = 'gods-eye-view-intro/1.0 (film asset build)'


def get_tile(z, x, y):
    d = os.path.join(CACHE, 'tiles', str(z), str(x))
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, f'{y}.jpg')
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return p, 'cache'
    last = None
    for attempt in range(5):
        try:
            r = sess.get(URL.format(z=z, x=x, y=y), timeout=60)
            if r.status_code == 200 and r.content[:2] in (b'\xff\xd8', b'\x89P'):
                with open(p, 'wb') as f:
                    f.write(r.content)
                return p, 'net'
            last = f'HTTP {r.status_code} {r.headers.get("content-type")}'
        except Exception as e:  # noqa
            last = str(e)[:120]
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f'tile {z}/{x}/{y} failed: {last}')


def build(slug, z):
    c = CITIES[slug]
    F = Frame(**c)
    h = F.half
    s, w, n, e = F.bbox(h * 1.02)
    x0, y0 = merc_px(n, w, z)
    x1, y1 = merc_px(s, e, z)
    tx0, ty0 = int(x0 // TS), int(y0 // TS)
    tx1, ty1 = int(x1 // TS), int(y1 // TS)
    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    print(f'== {slug} z{z}: {tx1-tx0+1}x{ty1-ty0+1} = {len(tiles)} tiles')
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda t: get_tile(z, t[0], t[1]), tiles))
    print(f'  net {sum(1 for r in res if r[1]=="net")} cache {sum(1 for r in res if r[1]=="cache")}')
    W, H = (tx1 - tx0 + 1) * TS, (ty1 - ty0 + 1) * TS
    mos = np.zeros((H, W, 3), np.uint8)
    for (tx, ty), (p, _) in zip(tiles, res):
        im = np.asarray(Image.open(p).convert('RGB'))
        mos[(ty - ty0) * TS:(ty - ty0 + 1) * TS, (tx - tx0) * TS:(tx - tx0 + 1) * TS] = im
    M = N * SS
    t = (np.arange(M) + 0.5) / M
    xs = -h + 2 * h * t           # east
    ys = h - 2 * h * t            # north, row 0 at top
    lon = F.lon0 + xs / F.kx
    lat = F.lat0 + ys / F.ky
    px, _ = merc_px(np.full_like(lon, F.lat0), lon, z)
    _, py = merc_px(lat, np.full_like(lat, F.lon0), z)
    px = px - tx0 * TS - 0.5      # pixel centers
    py = py - ty0 * TS - 0.5
    PX, PY = np.meshgrid(px, py)
    out = np.empty((M, M, 3), np.uint8)
    for ch in range(3):
        out[..., ch] = np.clip(map_coordinates(mos[..., ch].astype(np.float32), [PY, PX], order=1,
                                               mode='nearest'), 0, 255).astype(np.uint8)
    del PX, PY
    img = Image.fromarray(out)
    if SS != 1:
        img = img.resize((N, N), Image.LANCZOS)
    d = os.path.join(OUT, slug)
    os.makedirs(d, exist_ok=True)
    img.save(os.path.join(d, 'ground.jpg'), quality=90, optimize=True)
    img.resize((2048, 2048), Image.LANCZOS).save(os.path.join(d, 'ground_2k.jpg'), quality=90, optimize=True)
    img.resize((768, 768), Image.LANCZOS).save(os.path.join(CACHE, f'{slug}_ground_preview.jpg'), quality=85)
    mpp_src = 156543.03392 * math.cos(math.radians(F.lat0)) / 2 ** z
    print(f'  wrote ground.jpg {os.path.getsize(os.path.join(d, "ground.jpg"))/1e6:.1f}MB; '
          f'source {mpp_src:.2f} m/px, output {2*h/N:.2f} m/px')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    z = 17
    if '--zoom' in sys.argv:
        z = int(sys.argv[sys.argv.index('--zoom') + 1])
    for slug in args or list(CITIES):
        build(slug, z)
