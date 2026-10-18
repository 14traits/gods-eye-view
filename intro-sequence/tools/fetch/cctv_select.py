#!/usr/bin/env python3
"""Stage 2: pick a spread of good frames from cctv_fetch.py output, cover-crop to 640x360, write cctv/index.json.
Usage: python3 -I cctv_select.py <work_dir> <out_cctv_dir>
EXCLUDE lists frames rejected on visual review of the contact sheets (placeholders such as
'Temporarily Unavailable', 'Kamera er midlertidig ute av drift', 'NB! ÜHENDUS KAAMERAGA PUUDUB',
'Interrupció temporal de la imatge', and an all-black King County frame)."""
import json, os, sys
from collections import Counter
from PIL import Image
W, OUT = sys.argv[1], sys.argv[2]
ok = json.load(open(f'{W}/ok.json'))
EXCLUDE = {40, 43, 45, 46, 49, 66, 126, 139, 148, 150}
PREFER = {'hongkong': [187, 195, 197, 198, 201, 205, 206, 196, 200, 202]}  # fewest privacy-mask polygons
QUOTA = dict(nsw=12, hongkong=10, singapore=6, nz=12, nyc=9, caltrans=6, wsdot=6, kingco=3, drivebc=6, calgary=4, toronto=6,
             txdot=4, austin=4, tfl=8, fintraffic=4, vegvesen=4, tallinn=3, tarktee=3, lithuania=4, catalonia=3)
hash_count = Counter(x['ahash'] for x in ok)
good = [x for x in ok if x['i'] not in EXCLUDE and hash_count[x['ahash']] == 1 and x['w'] >= 320 and x['mean'] > 25 and x['std'] > 15]
pick = []
for src, q in QUOTA.items():
    pool = [x for x in good if x['src_key'] == src]
    pref = [x for i in PREFER.get(src, []) for x in pool if x['i'] == i]
    rest = sorted([x for x in pool if x not in pref], key=lambda x: -(x['std'] * x['edges']))
    pick += (pref + rest)[:q]
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.startswith('cam_') and f.endswith('.jpg'):
        os.remove(os.path.join(OUT, f))
index = []
for n, x in enumerate(pick, 1):
    im = Image.open(x['file']).convert('RGB')
    w, h = im.size
    s = max(640 / w, 360 / h)
    im = im.resize((max(640, round(w * s)), max(360, round(h * s))), Image.LANCZOS)
    w, h = im.size
    l, t = (w - 640) // 2, (h - 360) // 2
    im = im.crop((l, t, l + 640, t + 360))
    fn = f'cam_{n:03d}.jpg'
    im.save(os.path.join(OUT, fn), quality=88)
    index.append(dict(file=fn, name=x['name'], city=x['city'], country=x['country'], lat=x['lat'], lon=x['lon'], source=x['source'],
                      fetched_utc=x['fetched'], orig_size=[x['w'], x['h']], url=x['url']))
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
print(len(index), Counter(i['country'] for i in index))
