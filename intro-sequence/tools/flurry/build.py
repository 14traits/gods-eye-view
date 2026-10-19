"""Build the flurry montage captures.

  python3 select_cities.py   # -> city_candidates.json (primary + backup per region)
  python3 build.py           # -> imagery/flurry/fx_###.jpg, index.json, tools/flurry/sheet.jpg

Each capture: Esri World Imagery, 3x3 tiles around the point, centred 512x512
crop, JPEG q86. Placeholder / low-variance captures are rejected automatically
(tiles.quality_ok); captures that passed the metrics but looked wrong on the
review sheets (forest, farmland, haze) are listed in VISUAL_REJECT. Rejected
items are replaced by the next backup of the same region (cities) or by the
next backup landmark.
"""
import glob
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from landmarks import LANDMARKS  # noqa: E402
from tiles import HERE, MAX_WORKERS, OUT, capture, quality_ok  # noqa: E402

N_CITIES = 170
N_LANDMARKS = 90

# Natural Earth points that landed on a park/water/cemetery: moved to the dense centre.
CITY_OVERRIDES = {
    "Lagos": (6.4541, 3.3947),          # Lagos Island (was open lagoon)
    "Cairns": (-16.9230, 145.7740),     # CBD (was mangrove mudflat)
    "Calgary": (51.0460, -114.0650),    # downtown (was cemetery)
    "Dubai": (25.0805, 55.1403),        # Dubai Marina (was construction lot)
    "Perth": (-31.9530, 115.8575),      # CBD (was Kings Park bush)
    "Dhaka": (23.7330, 90.4172),        # Motijheel (was hazy open ground)
    "Delhi": (28.6315, 77.2167),        # Connaught Place
    "Montréal": (45.5017, -73.5673),    # downtown (was Mount Royal park)
    "Busan": (35.1000, 129.0350),       # Nampo / harbour (was forested hill)
    "Jeddah": (21.4858, 39.1925),       # Al-Balad old town (was empty lot)
    "Tokyo": (35.6717, 139.7650),       # Ginza (was Imperial Palace woods)
}
VISUAL_REJECT = {
    "Venice": "blurry low-res imagery",
    "Conakry": "heavy haze",
    "Maracaibo": "farmland / scrub",
    "Barquisimeto": "dry riverbed, no city",
    "Natal": "solid forest canopy",
    "João Pessoa": "forest canopy",
    "Mbuji-Mayi": "forest/scrub",
    "Huambo": "scrub, sparse",
    "Port Harcourt": "haze",
    "Qaraghandy": "dark featureless rail yard",
    "Herat": "low-res blur",
    "Chengdu": "smog haze",
    "Xian": "washed-out industrial lot",
    "Kaohsiung": "forested hill",
    "Sapporo": "university farm fields",
    "Isfahan": "low contrast blur",
    "Stuttgart": "hazy woodland",
    "Townsville": "airport apron, not city",
}
LANDMARK_BACKUPS = [
    "Glen Canyon Dam", "Grand Coulee Dam", "Mount St. Helens", "Groom Lake", "Diavik Diamond Mine",
    "Syncrude Mildred Lake oil sands", "Centre-pivot fields, Kansas", "Indianapolis Motor Speedway",
    "Brooklyn Bridge", "Panama Canal, Miraflores Locks", "Escondida Mine", "ALMA Observatory",
    "Meeting of the Waters, Manaus", "Brasilia, National Congress", "PS10 / PS20 Solar Towers", "Tower Bridge",
    "Port of Tema", "Akosombo Dam", "Okavango Delta", "FNB Stadium, Soweto", "East Oweinat pivots",
    "Kilimanjaro, Kibo crater", "Ras Laffan Industrial City", "Dubai International Airport", "Bagan temples",
    "Jiuquan Launch Centre", "Mount Bromo", "Vostochny Cosmodrome", "Pine Gap", "Tanegashima Space Center",
    "Teide", "Faa'a International Airport", "Hartsfield-Jackson Atlanta Airport", "Niagara Horseshoe Falls",
    "Iguazu Falls, Devil's Throat", "Vandenberg SLC-4E", "Paranal Observatory", "Cerro Dominador Solar",
    "Gibraltar Airport runway", "Erg Chebbi dunes", "Millau Viaduct", "Garzweiler Lignite Mine", "Inga Dams",
    "Grand Ethiopian Renaissance Dam", "Ras Tanura refinery", "Udachnaya Pipe", "Busan New Port",
    "Mount Taranaki", "Beijing National Stadium", "Port of Hamburg, Burchardkai", "Port of Santos",
    "Jebel Ali Port", "Mont-Saint-Michel", "Angkor Wat", "Mount Vesuvius", "Horseshoe Bend",
    "Benban Solar Park", "Borobudur", "Bhadla Solar Park", "Kariba Dam", "Wake Island Airfield",
    "Diamond Head", "Port Hedland salt ponds",
]


def evaluate(cands):
    def job(c):
        try:
            img, info = capture(c["lat"], c["lon"], c["zoom"])
            ok, why = quality_ok(info)
        except Exception as e:  # network failure counts as a reject
            img, info, ok, why = None, {}, False, f"fetch error: {e}"
        if ok and c["name"] in VISUAL_REJECT and c.get("kind") == "city":
            ok, why = False, "visual: " + VISUAL_REJECT[c["name"]]
        return img, ok, why

    with ThreadPoolExecutor(MAX_WORKERS) as ex:
        return list(ex.map(job, cands))


def pick(cands, results, quota_by_group):
    """Primaries first in order; failures replaced by the group's backups in order."""
    chosen, rejects = [], []
    for g, quota in quota_by_group.items():
        items = [(c, r) for c, r in zip(cands, results) if c["group"] == g]
        prim = [x for x in items if x[0]["rank"] == "primary"]
        back = [x for x in items if x[0]["rank"] == "backup"]
        got = []
        for c, r in prim + back:
            if len(got) >= quota:
                break
            if r[1]:
                got.append((c, r[0]))
            elif c["rank"] == "primary":
                rejects.append((c, r[2]))
        if len(got) < quota:
            print(f"!! group {g}: only {len(got)}/{quota}")
        chosen += got
    return chosen, rejects


def main():
    cities = json.load(open(os.path.join(HERE, "city_candidates.json")))
    for c in cities:
        c["kind"], c["group"] = "city", "c:" + c["region"]
        if c["name"] in CITY_OVERRIDES:
            c["lat"], c["lon"] = CITY_OVERRIDES[c["name"]]
    cquota = {}
    for c in cities:
        if c["rank"] == "primary":
            cquota[c["group"]] = cquota.get(c["group"], 0) + 1
    assert sum(cquota.values()) == N_CITIES, cquota

    lms = [dict(name=n, country=co, lat=la, lon=lo, zoom=z, kind="landmark", group="landmark",
                rank="backup" if n in LANDMARK_BACKUPS else "primary") for n, co, la, lo, z in LANDMARKS]
    lms.sort(key=lambda c: c["rank"] != "primary")  # stable: primaries first
    nprim = sum(c["rank"] == "primary" for c in lms)
    assert nprim == N_LANDMARKS, nprim

    allc = cities + lms
    print(f"evaluating {len(allc)} candidates ...", flush=True)
    res = evaluate(allc)
    quotas = dict(cquota)
    quotas["landmark"] = N_LANDMARKS
    chosen, rejects = pick(allc, res, quotas)

    chosen.sort(key=lambda x: x[0]["lon"])
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "fx_*.jpg")):
        os.remove(f)
    index = []
    for i, (c, img) in enumerate(chosen):
        fn = f"fx_{i:03d}.jpg"
        img.save(os.path.join(OUT, fn), quality=86, optimize=True)
        index.append({"file": fn, "name": c["name"], "country": c["country"], "lat": round(c["lat"], 5),
                      "lon": round(c["lon"], 5), "zoom": c["zoom"], "kind": c["kind"]})
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f, indent=1, ensure_ascii=False)

    # contact sheet: 16 x 17 grid of 96px thumbs, west->east reading order
    cols, cell = 16, 96
    rows = (len(chosen) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (10, 10, 10))
    for i, (c, img) in enumerate(chosen):
        sheet.paste(img.resize((cell, cell), Image.LANCZOS), ((i % cols) * cell, (i // cols) * cell))
    sheet.save(os.path.join(HERE, "sheet.jpg"), quality=88)

    from collections import Counter
    print(f"wrote {len(index)} captures: {Counter(x['kind'] for x in index)}")
    print("rejected primaries (replaced by backups):")
    for c, why in rejects:
        print(f"  - {c['name']} ({c['country']}): {why}")
    bands = Counter(int((x["lon"] + 180) // 30) for x in index)
    print("30-degree longitude bands W->E:", [bands.get(i, 0) for i in range(12)])
    json.dump([{"name": c["name"], "country": c["country"], "reason": why} for c, why in rejects],
              open(os.path.join(HERE, "rejects.json"), "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
