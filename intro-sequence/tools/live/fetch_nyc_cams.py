"""NYC DOT TMC cameras -> city/nyc/cameras.json + current stills for ~24 nearest cams."""
import hashlib, io, json, os, sys, time, requests
import numpy as np
from PIL import Image, ImageOps
from collections import Counter
sys.path.insert(0, os.path.dirname(__file__))
from common import enu, inside
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'cctv', 'nyc'); DBG = os.path.join(os.path.dirname(__file__), 'nyc_rejects')
os.makedirs(OUT, exist_ok=True); os.makedirs(DBG, exist_ok=True)
H = {'User-Agent': 'gods-eye-view-intro/1.0'}
cat = requests.get('https://webcams.nyctmc.org/api/cameras', headers=H, timeout=30).json()
cams = []
for c in cat:
    if str(c.get('isOnline')).lower() != 'true': continue
    try: lat, lon = float(c['latitude']), float(c['longitude'])
    except Exception: continue
    x, y = enu('nyc', lat, lon)
    if inside('nyc', x, y): cams.append((x, y, c['id'], c['name'].strip(), lat, lon))
json.dump([[x, y, i, n] for x, y, i, n, _, _ in cams], open(os.path.join(ROOT, 'city', 'nyc', 'cameras.json'), 'w'), separators=(',', ':'))
print('catalog', len(cat), 'online in square', len(cams))
cams.sort(key=lambda c: c[0]**2 + c[1]**2)
for f in os.listdir(OUT):
    if f.startswith('cam_') and f.endswith('.jpg'): os.remove(os.path.join(OUT, f))
idx, rejects, hashes, raw_imgs = [], Counter(), Counter(), []
fetched_utc = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
for x, y, cid, name, lat, lon in cams[:80]:
    if len(raw_imgs) >= 40: break
    try:
        r = requests.get(f'https://webcams.nyctmc.org/api/cameras/{cid}/image', headers=H, timeout=20)
        r.raise_for_status(); im = Image.open(io.BytesIO(r.content)).convert('RGB')
    except Exception as e:
        rejects['error'] += 1; continue
    h = hashlib.md5(r.content).hexdigest(); hashes[h] += 1
    g = np.asarray(im.convert('L'), dtype=np.float32)
    raw_imgs.append(dict(x=x, y=y, id=cid, name=name, lat=lat, lon=lon, im=im, h=h, mean=float(g.mean()), std=float(g.std()), size=im.size, n=len(r.content)))
n = 0
for d in raw_imgs:
    reason = None
    if hashes[d['h']] > 1: reason = 'duplicate/placeholder'
    elif d['mean'] < 14: reason = 'black'
    elif d['std'] < 10: reason = 'flat'
    elif d['size'][0] < 200: reason = 'tiny'
    if reason:
        rejects[reason] += 1; d['im'].save(os.path.join(DBG, f"{reason.split('/')[0]}_{d['id'][:8]}.jpg")); continue
    if n >= 24: break
    n += 1; fn = f'cam_{n:03d}.jpg'
    ImageOps.fit(d['im'], (640, 360), Image.LANCZOS).save(os.path.join(OUT, fn), quality=88)
    idx.append({'file': fn, 'id': d['id'], 'name': d['name'], 'x': d['x'], 'y': d['y'], 'lat': d['lat'], 'lon': d['lon'],
                'orig_size': list(d['size']), 'fetched_utc': fetched_utc, 'source': 'NYC DOT TMC webcams.nyctmc.org'})
    print(fn, d['name'], d['size'], round(d['mean']), round(d['std']), round((d['x']**2+d['y']**2)**.5))
json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
print('saved', n, 'rejects', dict(rejects), 'tried', len(raw_imgs))
