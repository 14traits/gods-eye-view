"""Deliverable 5: Esri World Imagery z3 (8x8) and z4 (16x16) tiles for the quadtree indexing effect."""
import os, shutil
from common import OUT, esri_jobs, fetch_many, esri_tile_path

for z in (3, 4):
    n = 2 ** z
    d = os.path.join(OUT, f"tiles_z{z}")
    os.makedirs(d, exist_ok=True)
    coords = [(x, y) for y in range(n) for x in range(n)]
    res = fetch_many(esri_jobs(z, coords), desc=f"esri z{z}")
    bad = [k for k, v in res.items() if v is None]
    for x, y in coords:
        if res[(x, y)] is not None:
            shutil.copyfile(esri_tile_path(z, x, y), os.path.join(d, f"z{z}_{x}_{y}.jpg"))
    print(f"z{z}: {len(coords)-len(bad)} tiles written, {len(bad)} failed")
