"""Poll live ADS-B (adsb.lol, fallback adsb.fi) around each scene 3x, 20 s apart.
Writes city/<slug>/air.json with latest sample per aircraft + short track history."""
import json, os, sys, time, requests
sys.path.insert(0, os.path.dirname(__file__))
from common import SCENES, enu
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAD = {'nyc': 25, 'lax': 25, 'bragg': 25, 'boston': 20}
HELI_TYPES = {'EC35','EC30','EC45','EC55','EC20','EC25','EC75','EC13','EC40','AS50','AS55','AS65','AS32','AS3B','H125','H130','H135','H145','H160','H175','B06','B06T','B407','B412','B427','B429','B430','B47G','B505','B212','B222','B230','B105','BK17','R22','R44','R66','S76','S92','S61','S64','S70','H60','UH60','MH60','HH60','H47','CH47','H53','A109','A119','A139','A169','A189','AW09','MI8','MI17','UH1','UH1Y','AH1','AH64','H64','V22','MV22','CABR','G2CA','EN28','EN48','H269','H500','MD52','MD60','NH90','LYNX','PUMA','GAZL','EH10','H1','B505'}
H = {'User-Agent': 'gods-eye-view-intro/1.0 (film research)'}
def fetch(slug):
    lat, lon, _ = SCENES[slug]; nm = RAD[slug]
    for url, key in ((f'https://api.adsb.lol/v2/point/{lat}/{lon}/{nm}', 'ac'),
                     (f'https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}', 'aircraft')):
        try:
            r = requests.get(url, headers=H, timeout=20); r.raise_for_status(); j = r.json()
            ac = j.get('ac') or j.get('aircraft') or []
            now = j.get('now') or time.time() * 1000
            return url, now / 1000 if now > 1e11 else now, ac
        except Exception as e:
            print(slug, 'fail', url, e, file=sys.stderr)
    return None, time.time(), []
def num(v):
    try: return float(v)
    except Exception: return None
def conv(slug, a):
    lat, lon = num(a.get('lat')), num(a.get('lon'))
    if lat is None or lon is None:
        lp = a.get('lastPosition') or {}
        lat, lon = num(lp.get('lat')), num(lp.get('lon'))
    if lat is None: return None
    x, y = enu(slug, lat, lon)
    ab = a.get('alt_baro')
    if ab == 'ground': alt = 0.0
    else:
        v = num(ab)
        if v is None: v = num(a.get('alt_geom'))
        alt = round(v * 0.3048, 1) if v is not None else None
    trk = num(a.get('track')); trk = num(a.get('true_heading')) if trk is None else trk
    gs = num(a.get('gs')); gs = round(gs * 0.514444, 1) if gs is not None else None
    vr = num(a.get('baro_rate')); vr = num(a.get('geom_rate')) if vr is None else vr
    vr = round(vr * 0.00508, 2) if vr is not None else None
    return [x, y, alt, trk, gs, vr, (a.get('flight') or '').strip(), a.get('t') or '', a.get('category') or '']
def main():
    polls = {s: [] for s in SCENES}
    for i in range(3):
        t0 = time.time()
        for s in SCENES:
            url, t, ac = fetch(s); polls[s].append((url, t, ac)); print(i, s, len(ac), url, flush=True)
        if i < 2: time.sleep(max(0, 20 - (time.time() - t0)))
    summary = {}
    for s in SCENES:
        latest, tracks, src = {}, {}, set()
        tlast = 0
        for url, t, ac in polls[s]:
            if url: src.add(url.split('/')[2])
            tlast = max(tlast, t)
            for a in ac:
                hx = a.get('hex'); row = conv(s, a)
                if not hx or row is None: continue
                if (num(a.get('seen_pos')) or 0) > 60: continue
                latest[hx] = row
                tr = tracks.setdefault(hx, [])
                p = [row[0], row[1], row[2]]
                if not tr or tr[-1][:2] != p[:2]: tr.append(p)
        heli = [h for h, r in latest.items() if r[8] == 'A7' or r[7] in HELI_TYPES]
        out = {'t': int(tlast), 'source': sorted(src), 'radius_nm': RAD[s], 'hex': list(latest.keys()),
               'a': list(latest.values()), 'tracks': {h: v for h, v in tracks.items() if len(v) > 1}}
        json.dump(out, open(os.path.join(ROOT, 'city', s, 'air.json'), 'w'), separators=(',', ':'))
        summary[s] = {'aircraft': len(latest), 'with_track': len(out['tracks']), 'heli': len(heli),
                      'heli_list': [[latest[h][6], latest[h][7], latest[h][8], latest[h][2]] for h in heli]}
    print(json.dumps(summary, indent=1))
if __name__ == '__main__': main()
