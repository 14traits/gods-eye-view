"""Fetch candidates and render labelled review sheets for visual verification.

usage: python3 review.py landmarks|cities [start] [count]
Writes tools/flurry/review/<kind>_NN.jpg (5x4 grid, 256px cells, labelled).
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiles import HERE, MAX_WORKERS, capture, quality_ok  # noqa: E402

REV = os.path.join(HERE, "review")


def load(kind):
    if kind == "landmarks":
        from landmarks import LANDMARKS
        return [dict(name=n, country=c, lat=la, lon=lo, zoom=z) for n, c, la, lo, z in LANDMARKS]
    return json.load(open(os.path.join(HERE, "city_candidates.json")))


def run(cands, prefix, cell=256, cols=5, rows=4):
    os.makedirs(REV, exist_ok=True)

    def job(c):
        try:
            img, info = capture(c["lat"], c["lon"], c["zoom"])
            return img, info
        except Exception as e:
            return None, {"error": str(e)}

    with ThreadPoolExecutor(MAX_WORKERS) as ex:
        res = list(ex.map(job, cands))
    per = cols * rows
    report = []
    for s in range(0, len(cands), per):
        sheet = Image.new("RGB", (cols * cell, rows * cell), (20, 20, 20))
        d = ImageDraw.Draw(sheet)
        for k, (c, (img, info)) in enumerate(zip(cands[s:s + per], res[s:s + per])):
            x, y = (k % cols) * cell, (k // cols) * cell
            idx = s + k
            if img is not None:
                sheet.paste(img.resize((cell, cell), Image.LANCZOS), (x, y))
                ok, why = quality_ok(info)
                lab2 = f"s{info['std']:.0f} g{info['grad']:.1f}" + ("" if ok else " X " + why[:18])
            else:
                ok, lab2 = False, "ERR"
            d.rectangle((x, y, x + cell, y + 24), fill=(0, 0, 0))
            d.text((x + 3, y + 1), f"{idx} {c['name'][:36]}", fill=(255, 255, 0))
            d.text((x + 3, y + 12), lab2, fill=(255, 120, 120) if not ok else (160, 255, 160))
            report.append((idx, c["name"], ok, lab2))
        out = os.path.join(REV, f"{prefix}_{s // per:02d}.jpg")
        sheet.save(out, quality=85)
        print(out)
    for r in report:
        if not r[2]:
            print("REJECT", r)


if __name__ == "__main__":
    kind = sys.argv[1]
    cands = load(kind)
    st = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    n = int(sys.argv[3]) if len(sys.argv) > 3 else len(cands)
    run(cands[st:st + n], kind[:2] + (f"_{st}" if st else ""))
