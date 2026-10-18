"""Deliverable 3: clouds.jpg (4096x2048) grayscale cloud opacity map for one recent day.

Source: NASA GIBS daily VIIRS Corrected Reflectance True Colour for the same UTC
date from three satellites (NOAA-20, NOAA-21, Suomi NPP), EPSG:4326 level 3
(10x5 tiles of 512px = 5120x2560), downsampled to 4096x2048.

Cloud metric per satellite:
    whiteness = min(R,G,B)            (clouds are bright in every channel)
    greyness  = 1 - saturation        (clouds are colourless)
    c = ramp(whiteness) * smoothstep(greyness)
The same metric computed on the Esri base map (earth_day_4k.jpg) is subtracted
to suppress bright deserts, salt flats, snow and ice that would otherwise read
as cloud. The three per-satellite results are combined with a per-pixel median
(nan-aware), which removes swath-edge haze / glint streaks that only one
satellite shows, and fills swath gaps. Remaining no-data (polar night) -> 0.

Usage: python3 build_clouds.py [YYYY-MM-DD]
"""
import os
import sys
import numpy as np
from PIL import Image
from common import OUT, gibs_mosaic

Image.MAX_IMAGE_PIXELS = None
DATE = sys.argv[1] if len(sys.argv) > 1 else "2026-10-15"
LAYERS = [
    "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
    "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
    "VIIRS_SNPP_CorrectedReflectance_TrueColor",
]
W, H = 4096, 2048


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def metric(rgb):
    rgb = rgb.astype(np.float32) / 255.0
    mn = rgb.min(2)
    mx = rgb.max(2)
    sat = (mx - mn) / (mx + 1e-4)
    white = np.clip((mn - 0.14) / 0.86, 0, 1) ** 1.15  # linear-ish: keeps texture inside thick cloud
    return white * smooth(1.0 - sat, 0.65, 0.95), mx


def main():
    base = np.asarray(Image.open(os.path.join(OUT, "earth_day_4k.jpg")).convert("RGB"))
    base_c, _ = metric(base)
    # dilate the base metric a few px so small Esri/VIIRS coastline misregistration
    # does not leave bright outlines along desert and ice coasts
    from PIL import ImageFilter
    base_c = np.asarray(Image.fromarray((base_c * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
    stack = []
    for L in LAYERS:
        m = gibs_mosaic(L, DATE, "250m", 3, 5, 10, "jpg").resize((W, H), Image.LANCZOS)
        c, mx = metric(np.asarray(m))
        c = np.clip(c - base_c * 1.1, 0, 1)
        c[mx < 0.03] = np.nan  # no-data (black)
        stack.append(c)
    stack = np.stack(stack)
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore")
        cloud = np.nanmedian(stack, axis=0)
    cloud = np.nan_to_num(cloud, nan=0.0)
    cloud = np.clip((cloud - 0.06) / 0.94, 0, 1)  # black point: kill faint surface/haze residue
    img = Image.fromarray(np.clip(cloud * 255 + 0.5, 0, 255).astype(np.uint8), "L")
    img.save(os.path.join(OUT, "clouds.jpg"), quality=92, optimize=True, progressive=True)
    print("done", DATE, "mean opacity %.3f" % cloud.mean())


if __name__ == "__main__":
    main()
