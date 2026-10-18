"""Deliverable 2: earth_night.jpg (8192x4096) + earth_night_4k.jpg (4096x2048).

NASA Black Marble (layer VIIRS_Black_Marble, 2016 annual composite) from GIBS
EPSG:4326 level 4 (20x10 tiles of 512px = 10240x5120), Lanczos-downsampled.
Colour kept as served.
"""
import os
from PIL import Image
from common import OUT, gibs_mosaic

Image.MAX_IMAGE_PIXELS = None
LAYER = os.environ.get("NIGHT_LAYER", "VIIRS_Black_Marble")
TIME = os.environ.get("NIGHT_TIME", "2016-01-01")
EXT = "png" if LAYER == "VIIRS_Black_Marble" else "jpg"

m = gibs_mosaic(LAYER, TIME if LAYER == "VIIRS_Black_Marble" else None, "500m", 4, 10, 20, EXT)
big = m.resize((8192, 4096), Image.LANCZOS)
big.save(os.path.join(OUT, "earth_night.jpg"), quality=92, optimize=True, progressive=True)
big.resize((4096, 2048), Image.LANCZOS).save(os.path.join(OUT, "earth_night_4k.jpg"), quality=92, optimize=True, progressive=True)
print("done", LAYER, TIME)
