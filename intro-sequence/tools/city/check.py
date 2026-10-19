"""Render city/<slug>/check.png: ground imagery (left) and imagery + OSM overlay (right) for alignment QA.

usage: python3 -I tools/city/check.py nyc boston [--crop x y size]
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
from geo import CITIES, OUT, CACHE

ROADC = [(255, 60, 60), (255, 150, 40), (255, 220, 40), (200, 255, 80), (255, 255, 255), (160, 160, 160)]


def render(slug, S=1400, crop=None):
    d = os.path.join(OUT, slug)
    h = CITIES[slug]['half']
    cx, cy, cs = crop if crop else (0, 0, h)  # center and half-size of view in meters
    g = Image.open(os.path.join(d, 'ground.jpg')).convert('RGB')
    G = g.size[0]
    # crop region of ground in pixels
    l = (cx - cs + h) / (2 * h) * G
    t = (h - (cy + cs)) / (2 * h) * G
    r = (cx + cs + h) / (2 * h) * G
    b = (h - (cy - cs)) / (2 * h) * G
    base = g.crop((int(l), int(t), int(r), int(b))).resize((S, S), Image.LANCZOS)

    def P(x, y):
        return ((x - (cx - cs)) / (2 * cs) * S, ((cy + cs) - y) / (2 * cs) * S)

    ov = base.copy()
    dr = ImageDraw.Draw(ov, 'RGBA')
    wp = os.path.join(d, 'water.json')
    if os.path.exists(wp):
        for poly in json.load(open(wp))['polys']:
            for k, ring in enumerate(poly):
                pts = [P(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)]
                if len(pts) >= 3:
                    dr.polygon(pts, outline=(60, 160, 255, 255), fill=(30, 90, 255, 70) if k == 0 else None)
    for bld in json.load(open(os.path.join(d, 'buildings.json')))['b']:
        hgt = bld[0]
        pts = [P(bld[i], bld[i + 1]) for i in range(2, len(bld), 2)]
        a = min(255, 60 + int(hgt))
        col = (0, 255, 200, 255) if hgt >= 100 else (255, 0, 220, 255)
        dr.polygon(pts, outline=col, fill=(col[0], col[1], col[2], 40 if hgt < 100 else 90))
    for rd in json.load(open(os.path.join(d, 'roads.json')))['roads']:
        pts = [P(rd[i], rd[i + 1]) for i in range(3, len(rd), 2)]
        dr.line(pts, fill=ROADC[rd[0]] + (230,), width=2 if rd[0] < 3 else 1)
    rp = os.path.join(d, 'rail.json')
    if os.path.exists(rp):
        for ln in json.load(open(rp))['lines']:
            c = ln[0]
            col = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
            pts = [P(ln[i], ln[i + 1]) for i in range(1, len(ln), 2)]
            dr.line(pts, fill=col, width=3)
    ep = os.path.join(d, 'extra.json')
    if os.path.exists(ep):
        for x, y, nm in json.load(open(ep))['helipads']:
            px, py = P(x, y)
            dr.ellipse((px - 7, py - 7, px + 7, py + 7), outline=(255, 255, 0, 255), width=3)
    out = Image.new('RGB', (S * 2 + 10, S), (0, 0, 0))
    out.paste(base, (0, 0))
    out.paste(ov, (S + 10, 0))
    return out


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    crop = None
    if '--crop' in sys.argv:
        i = sys.argv.index('--crop')
        crop = tuple(float(v) for v in sys.argv[i + 1:i + 4])
        args = [a for a in args if a not in sys.argv[i + 1:i + 4]]
    for slug in args or list(CITIES):
        im = render(slug, crop=crop)
        if crop:
            p = os.path.join(CACHE, f'{slug}_check_crop_{int(crop[0])}_{int(crop[1])}_{int(crop[2])}.png')
        else:
            p = os.path.join(OUT, slug, 'check.png')
        im.save(p, optimize=True)
        print('wrote', p)
