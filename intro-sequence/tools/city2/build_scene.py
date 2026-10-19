"""Build real-geodata scene packs.  usage: python3 build_scene.py lax|bragg|everest [steps...]
steps: osm ground elev check (default all)"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa

SCENES = {
    "lax": dict(name="Los Angeles International Airport", lat0=33.9425, lon0=-118.4081, half=3500, z=17),
    "bragg": dict(name="Fort Bragg, North Carolina", lat0=35.1580, lon0=-79.0090, half=6000, z=16),
    "everest": dict(name="Mount Everest / Khumbu", lat0=27.9881, lon0=86.9250, half=15000, z=15),
}

NT = {"lax": 4, "bragg": 6}
AERO_Q = '[out:json][timeout:600];nwr["aeroway"~"^(runway|taxiway|apron|terminal|gate|parking_position)$"]({bb});out geom;'
BLDG_Q = '[out:json][timeout:300];(way["building"]({bb});relation["building"]({bb}););out geom;'
ROAD_Q = ('[out:json][timeout:300];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|'
          'residential|unclassified|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service)$"]({bb});out geom;')
MIL_Q = '[out:json][timeout:600];(way["landuse"="military"]({bb});relation["landuse"="military"]({bb});way["military"]({bb});relation["military"]({bb}););out geom;'
PEAK_Q = '[out:json][timeout:300];node["natural"="peak"]({bb});out;'


def step_osm(f, slug):
    bb = f.bbox_str()
    if slug in ("lax", "bragg"):
        aero = C.build_aeroway(f, C.overpass(AERO_Q.format(bb=bb), f"{slug}_aero"))
        if slug == "lax":
            C.wjson(os.path.join(f.out, "aeroway.json"), aero)
        else:
            mil = C.overpass(MIL_Q.format(bb=bb), f"{slug}_mil")
            polys = []
            for el in mil["elements"]:
                tags = el.get("tags", {})
                for ring in C.outer_rings(el, f):
                    name = tags.get("name") or (f"[{tags['military']}]" if "military" in tags else "")
                    polys.append([name] + C.flat(C.dp_ring(ring, 2.0)))
            names = sorted({p[0] for p in polys if p[0]})
            print(f"  military polygons: {len(polys)}; names: {names[:40]}")
            out = {"military": polys, "runways": aero["runways"], "taxiways": aero["taxiways"],
                   "aprons": aero["aprons"], "apronNames": aero["apronNames"], "terminals": aero["terminals"],
                   "gates": aero["gates"], "parking": aero["parking"]}
            C.wjson(os.path.join(f.out, "military.json"), out)
        C.wjson(os.path.join(f.out, "buildings.json"), C.build_buildings(f, C.overpass_tiled(f, BLDG_Q, f"{slug}_bldg", NT[slug])))
        C.wjson(os.path.join(f.out, "roads.json"), C.build_roads(f, C.overpass_tiled(f, ROAD_Q, f"{slug}_roads", NT[slug] // 2)))
    else:
        d = C.overpass(PEAK_Q.format(bb=bb), f"{slug}_peaks")
        peaks = []
        skipped = 0
        for el in d["elements"]:
            t = el.get("tags", {})
            name = t.get("name:en") or t.get("name")
            ele = t.get("ele")
            if not name or not ele:
                skipped += 1
                continue
            try:
                s = ele.lower().replace(",", ".").strip()
                v = float(s.replace("ft", "").replace("m", "").strip().split()[0].split(";")[0])
                if "ft" in s:
                    v *= 0.3048
            except ValueError:
                skipped += 1
                continue
            x, y = f.xy(el["lon"], el["lat"])
            peaks.append([C.r1(x), C.r1(y), C.r1(v), name])
        peaks.sort(key=lambda p: -p[2])
        print(f"  peaks with name+ele: {len(peaks)} (skipped {skipped} lacking name/ele); top: {peaks[:6]}")
        C.wjson(os.path.join(f.out, "peaks.json"), peaks)


def step_elev(f):
    z = 12
    url = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
    mos, ox, oy, nf = C.mosaic(f, z, url, "terrarium", "png", "RGB", pad_m=1500)
    if nf:
        print(f"  WARNING: {nf} terrarium tiles missing")
    m = mos.astype(np.float32)
    h = m[..., 0] * 256 + m[..., 1] + m[..., 2] / 256 - 32768
    N = 1024
    e = C.reproject(f, h[..., None], ox, oy, z, N)[..., 0].astype("<f4")
    e.tofile(os.path.join(f.out, "elev.f32"))
    meta = {"size": N, "min": C.r1(e.min()), "max": C.r1(e.max()), "half": f.half,
            "source": "AWS Terrain Tiles terrarium z12", "rowOrder": "row0=north", "dtype": "float32le"}
    C.wjson(os.path.join(f.out, "elev_meta.json"), meta)
    print(f"  elev min {e.min():.1f} max {e.max():.1f}")
    # hillshade
    cell = 2 * f.half / N
    gy, gx = np.gradient(e.astype(np.float64), cell)  # gy: d/drow (southward)
    dzdx, dzdy = gx, -gy
    az, alt = np.radians(315), np.radians(45)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdx, -dzdy)  # direction of steepest descent... simple form
    lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
    nx, ny, nz = -dzdx, -dzdy, np.ones_like(dzdx)
    nn = np.sqrt(nx * nx + ny * ny + 1)
    shade = np.clip((nx * lx + ny * ly + nz * lz) / nn, 0, 1)
    t = (e - e.min()) / max(1, e.max() - e.min())
    rgb = np.stack([0.35 + 0.65 * t, 0.45 + 0.55 * t, 0.55 + 0.45 * t], -1) * shade[..., None]
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(os.path.join(f.out, "elev_preview.png"))
    print("  wrote elev_preview.png")


def step_check(f, slug):
    N = 2048
    im = C.check_canvas(f)
    dr = ImageDraw.Draw(im, "RGBA")
    P = lambda a: C.to_px(f, a, N)  # noqa
    if slug in ("lax", "bragg"):
        roads = json.load(open(os.path.join(f.out, "roads.json")))["roads"]
        col = {0: (255, 60, 60, 230), 1: (255, 160, 40, 220), 2: (255, 230, 60, 200), 3: (200, 255, 120, 180),
               4: (160, 200, 255, 150), 5: (180, 180, 180, 120)}
        for r in roads:
            dr.line(P(r[3:]), fill=col[r[0]], width=2 if r[0] < 3 else 1)
        bl = json.load(open(os.path.join(f.out, "buildings.json")))["b"]
        for b in bl:
            pts = P(b[2:])
            if len(pts) >= 3:
                dr.polygon(pts, outline=(0, 255, 255, 200))
        aero = json.load(open(os.path.join(f.out, "aeroway.json" if slug == "lax" else "military.json")))
        if slug == "bragg":
            for m in aero["military"]:
                dr.polygon(P(m[1:]), outline=(255, 0, 255, 255))
        for a in aero["aprons"]:
            dr.polygon(P(a), outline=(255, 255, 255, 200))
        for t in aero["taxiways"]:
            dr.line(P(t), fill=(255, 255, 0, 230), width=1)
        for rw in aero["runways"]:
            w = max(2, int(rw[0] / (2 * f.half) * N))
            dr.line(P(rw[2:6]), fill=(255, 40, 40, 110), width=w)
            dr.line(P(rw[2:6]), fill=(255, 255, 255, 255), width=1)
        for t in aero["terminals"]:
            dr.polygon(P(t[1:]), outline=(255, 120, 0, 255))
        for g in aero["gates"]:
            (x, y), = P(g[:2])
            dr.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(0, 255, 0, 255))
    else:
        peaks = json.load(open(os.path.join(f.out, "peaks.json")))
        for x0, y0, ele, name in peaks:
            (x, y), = P([x0, y0])
            dr.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 60, 60, 255), width=2)
            if ele > 6000:
                dr.text((x + 6, y - 6), f"{name} {ele:.0f}", fill=(255, 255, 255, 255))
        # contour-ish overlay from DEM to check imagery/DEM alignment
        e = np.fromfile(os.path.join(f.out, "elev.f32"), "<f4").reshape(1024, 1024)
        e2 = np.asarray(Image.fromarray(e).resize((N, N), Image.BILINEAR))
        band = (np.floor(e2 / 500) % 2).astype(np.int8)
        edge = (np.abs(np.diff(band, axis=0, prepend=band[:1])) + np.abs(np.diff(band, axis=1, prepend=band[:, :1]))) > 0
        arr = np.asarray(im).copy()
        arr[edge] = (0.4 * arr[edge] + 0.6 * np.array([0, 255, 255])).astype(np.uint8)
        im = Image.fromarray(arr)
        dr = ImageDraw.Draw(im, "RGBA")
        for x0, y0, ele, name in peaks:
            (x, y), = P([x0, y0])
            dr.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 60, 60, 255), width=2)
            if ele > 6500:
                dr.text((x + 6, y - 6), f"{name} {ele:.0f}", fill=(255, 255, 255, 255))
    p = os.path.join(f.out, "check.png")
    im.save(p)
    print(f"  wrote {p}")


def main():
    slug = sys.argv[1]
    steps = sys.argv[2:] or ["osm", "ground", "elev", "check"]
    s = SCENES[slug]
    f = C.Frame(slug, s["name"], s["lat0"], s["lon0"], s["half"])
    f.write_meta()
    print(f"== {slug} bbox {f.bbox_str()}")
    if "osm" in steps:
        step_osm(f, slug)
    if "ground" in steps:
        C.build_ground(f, s["z"])
    if "ground_s2" in steps:
        # alternative uniform real imagery (EOX Sentinel-2 cloudless 2020) — Esri is a patchwork here
        C.build_ground(f, 14, C.EOX_S2, "eox_s2", "ground_s2")
    if "elev" in steps and slug == "everest":
        step_elev(f)
    if "check" in steps:
        step_check(f, slug)


if __name__ == "__main__":
    main()
