import math
SCENES = {
    'nyc': (40.7400, -73.9900, 3500),
    'boston': (42.3555, -71.0605, 3200),
    'lax': (33.9425, -118.4081, 3500),
    'bragg': (35.1580, -79.0090, 6000),
}
def enu(slug, lat, lon):
    lat0, lon0, _ = SCENES[slug]
    x = (lon - lon0) * math.cos(math.radians(lat0)) * 111320
    y = (lat - lat0) * 110540
    return round(x, 1), round(y, 1)
def inside(slug, x, y, margin=0.0):
    h = SCENES[slug][2] + margin
    return abs(x) <= h and abs(y) <= h
