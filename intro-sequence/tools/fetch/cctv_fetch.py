#!/usr/bin/env python3
"""Download real current still frames from keyless public traffic-camera feeds.

Stage 1 (this script): build candidate lists from each source's public catalog
(endpoints mirror server/providers/cctv/*), sample a spread of cameras, download
frames, compute quality metrics, write <work>/frames/*.jpg + <work>/candidates.json.
Stage 2 (cctv_select.py) filters, crops to 640x360 and writes cctv/index.json.

Usage: python3 -I cctv_fetch.py <work_dir>
"""
import base64, hashlib, io, json, math, random, re, sys, time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
import requests
from PIL import Image, ImageStat, ImageFilter

WORK = sys.argv[1]
import os
os.makedirs(f'{WORK}/frames', exist_ok=True)
UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
S = requests.Session()
S.headers.update({'User-Agent': UA_BROWSER, 'Digitraffic-User': 'gods-eye-intro'})
rng = random.Random(42)


def get(url, **kw):
    kw.setdefault('timeout', 40)
    r = S.get(url, **kw)
    r.raise_for_status()
    return r


def C(source, name, city, country, lat, lon, url, kind='image'):
    return dict(source=source, name=name.strip(), city=city, country=country, lat=round(float(lat), 5), lon=round(float(lon), 5), url=url, kind=kind)


def nearest(cands, anchors, n):
    """Spread a pick across anchors: round-robin, nearest cameras to each anchor first, randomized a bit."""
    buckets = []
    for (alat, alon, label) in anchors:
        b = sorted(cands, key=lambda c: (c['lat'] - alat) ** 2 + ((c['lon'] - alon) * math.cos(math.radians(alat))) ** 2)[:max(n * 3, 12)]
        rng.shuffle(b)
        for c in b:
            c['city'] = label if c.get('city') in (None, '', '?') else c['city']
        buckets.append(b)
    out, seen = [], set()
    while len(out) < n and any(buckets):
        for b in buckets:
            while b:
                c = b.pop()
                if c['url'] not in seen:
                    seen.add(c['url']); out.append(c); break
    return out[:n]


def sample(cands, n):
    cands = list(cands)
    rng.shuffle(cands)
    return cands[:n]


SOURCES = {}


def source(fn):
    SOURCES[fn.__name__] = fn
    return fn


@source
def tfl(n):
    d = get('https://api.tfl.gov.uk/Place/Type/JamCam').json()
    out = []
    for p in d:
        props = {a['key']: a['value'] for a in p.get('additionalProperties', [])}
        if props.get('available') != 'true' or not props.get('imageUrl'):
            continue
        out.append(C('TfL JamCams', p['commonName'], 'London', 'United Kingdom', p['lat'], p['lon'], props['imageUrl']))
    return nearest(out, [(51.5074, -0.1278, 'London')], n)


@source
def nyc(n):
    d = get('https://webcams.nyctmc.org/api/cameras').json()
    out = [C('NYC DOT', c['name'], f"New York ({c.get('area')})", 'United States', c['latitude'], c['longitude'],
             f"https://webcams.nyctmc.org/api/cameras/{c['id']}/image") for c in d if str(c.get('isOnline')).lower() == 'true']
    return nearest(out, [(40.758, -73.9855, 'New York'), (40.7128, -74.006, 'New York'), (40.6782, -73.9442, 'New York'), (40.7282, -73.7949, 'New York')], n)


@source
def caltrans(n):
    out = []
    for dist, city in [(4, 'San Francisco Bay Area'), (7, 'Los Angeles'), (11, 'San Diego'), (3, 'Sacramento')]:
        try:
            d = get(f'https://cwwp2.dot.ca.gov/data/d{dist}/cctv/cctvStatusD{dist:02d}.json').json()
        except Exception as e:
            print('caltrans', dist, e); continue
        for row in d['data']:
            c = row['cctv']
            url = (c.get('imageData', {}).get('static') or {}).get('currentImageURL')
            if c.get('inService') != 'true' or not url:
                continue
            loc = c['location']
            out.append(C('Caltrans CCTV', loc['locationName'], loc.get('nearbyPlace') or city, 'United States', loc['latitude'], loc['longitude'], url))
    return nearest(out, [(37.7793, -122.4193, 'San Francisco'), (34.0537, -118.2428, 'Los Angeles'), (32.7157, -117.1611, 'San Diego'), (38.5816, -121.4944, 'Sacramento')], n)


@source
def wsdot(n):
    d = json.loads(get('https://data.wsdot.wa.gov/travelcenter/Cameras.json').content.decode('cp1252'))
    out = []
    for f in d['features']:
        a, g = f['attributes'], f['geometry']
        url = a.get('ImageURL') or ''
        if not url.startswith('https://images.wsdot.wa.gov/'):
            continue
        lon = g['x'] / 6378137 * 180 / math.pi
        lat = (2 * math.atan(math.exp(g['y'] / 6378137)) - math.pi / 2) * 180 / math.pi
        out.append(C('WSDOT', a['CameraTitle'], '', 'United States', lat, lon, url))
    return nearest(out, [(47.6062, -122.3321, 'Seattle'), (47.6588, -117.426, 'Spokane')], n)


@source
def kingco(n):
    d = get('https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/TRAFFICCAMERA_POINT_2029/FeatureServer/0/query?where=1%3D1&outFields=AssetID,Location,ImageURL,Live,Model,Manufacturer,Owner,CurrentStatus&f=geojson').json()
    out = []
    for f in d['features']:
        p = f['properties']
        url = (p.get('ImageURL') or '').replace('http://info.kingcounty.gov/', 'https://info.kingcounty.gov/')
        if p.get('CurrentStatus') != 'Active' or not url.startswith('https://info.kingcounty.gov/'):
            continue
        lon, lat = f['geometry']['coordinates'][:2]
        out.append(C('King County DOT', p['Location'], 'King County, WA', 'United States', lat, lon, url))
    return sample(out, n)


@source
def drivebc(n):
    d = get('https://www.drivebc.ca/api/webcams/').json()
    out = []
    for c in d:
        if not c.get('is_on') or c.get('marked_stale') or not c.get('should_appear', True):
            continue
        lon, lat = c['location']['coordinates'][:2]
        out.append(C('DriveBC', c['name'], c.get('region_name') or 'British Columbia', 'Canada', lat, lon, f"https://www.drivebc.ca/images/{c['id']}.jpg"))
    return nearest(out, [(49.2827, -123.1207, 'Vancouver'), (48.4284, -123.3656, 'Victoria'), (50.1163, -122.9574, 'Whistler')], n)


@source
def calgary(n):
    d = get('https://data.calgary.ca/resource/k7p9-kppz.json?$limit=500').json()
    out = []
    for c in d:
        url = (c.get('camera_url') or {}).get('url', '').replace('http://', 'https://')
        if not url.startswith('https://trafficcam.calgary.ca/'):
            continue
        lon, lat = c['point']['coordinates'][:2]
        out.append(C('City of Calgary', c['camera_location'], 'Calgary', 'Canada', lat, lon, url))
    return nearest(out, [(51.0461, -114.0626, 'Calgary')], n)


@source
def toronto(n):
    t = get('https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json').text
    d = json.loads(t[t.index('(') + 1: t.rindex(')')])
    out = [C('City of Toronto RESCU', c['Name'].title(), 'Toronto', 'Canada', c['Latitude'], c['Longitude'],
             f"https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc{c['Number']}.jpg")
           for c in d['Data'] if re.fullmatch(r'\d+', str(c['Number']))]
    return nearest(out, [(43.6532, -79.3832, 'Toronto')], n)


@source
def txdot(n):
    out = []
    for code, city in [('HOU', 'Houston'), ('DAL', 'Dallas'), ('AUS', 'Austin'), ('SAT', 'San Antonio'), ('ELP', 'El Paso')]:
        try:
            d = get(f'https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode={code}').json()
        except Exception as e:
            print('txdot', code, e); continue
        seen = set()
        for rows in d['roadwayCctvStatuses'].values():
            for r in rows:
                if r.get('statusDescription') != 'Device Online' or r.get('hasSnapshot') is False or r['icd_Id'] in seen:
                    continue
                if not isinstance(r.get('latitude'), (int, float)) or not r['latitude']:
                    continue
                seen.add(r['icd_Id'])
                url = 'https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?' + requests.compat.urlencode({'icdId': r['icd_Id'], 'districtCode': code})
                out.append(C('TxDOT ITS', r['name'], city, 'United States', r['latitude'], r['longitude'], url, kind='txdot'))
    return nearest(out, [(29.7604, -95.3698, 'Houston'), (32.7767, -96.797, 'Dallas'), (29.4241, -98.4936, 'San Antonio'), (31.7619, -106.485, 'El Paso')], n)


@source
def austin(n):
    d = get('https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD').json()
    cols = [c['fieldName'] for c in d['meta']['view']['columns']]
    out = []
    for row in d['data']:
        r = dict(zip(cols, row))
        if (r.get('camera_status') or '').strip().upper() != 'TURNED_ON':
            continue
        m = re.match(r'POINT \(([-\d.]+) ([-\d.]+)\)', r.get('location') or '')
        if not m or not r.get('camera_id'):
            continue
        out.append(C('City of Austin', (r.get('location_name') or '').strip(), 'Austin', 'United States', m.group(2), m.group(1),
                     f"https://cctv.austinmobility.io/image/{r['camera_id']}.jpg"))
    return nearest(out, [(30.2672, -97.7431, 'Austin')], n)


@source
def fintraffic(n):
    d = get('https://tie.digitraffic.fi/api/weathercam/v1/stations').json()
    out = []
    for f in d['features']:
        p = f['properties']
        if p.get('collectionStatus') != 'GATHERING':
            continue
        lon, lat = f['geometry']['coordinates'][:2]
        for pr in p.get('presets', []):
            if pr.get('inCollection'):
                out.append(C('Fintraffic Digitraffic', p['name'].replace('_', ' '), '', 'Finland', lat, lon, f"https://weathercam.digitraffic.fi/{pr['id']}.jpg"))
                break
    return nearest(out, [(60.1699, 24.9384, 'Helsinki'), (61.4978, 23.761, 'Tampere'), (65.0121, 25.4651, 'Oulu'), (66.5039, 25.7294, 'Rovaniemi'), (60.4518, 22.2666, 'Turku')], n)


@source
def vegvesen(n):
    d = get('https://ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items?f=application/geo%2Bjson&limit=5000').json()
    out = []
    for f in d['features']:
        p = f['properties']
        url = p.get('stillImageUrl') or ''
        if not url.startswith('https://kamera.atlas.vegvesen.no/api/images/'):
            continue
        lon, lat = f['geometry']['coordinates'][:2]
        name = ' - '.join(x for x in [p.get('description'), p.get('roadNumber')] if x)
        out.append(C('Statens vegvesen', name, '', 'Norway', lat, lon, url))
    return nearest(out, [(59.9139, 10.7522, 'Oslo'), (60.3913, 5.3221, 'Bergen'), (63.4305, 10.3951, 'Trondheim'), (69.6492, 18.9553, 'Tromsø'), (58.97, 5.7331, 'Stavanger')], n)


@source
def tallinn(n):
    d = json.load(open('/home/user/gods-eye-view/config/cctv_sources.tallinn.json'))
    out = [C('City of Tallinn', c['name'], 'Tallinn', 'Estonia', c['lat'], c['lon'], c['snapshotUrl']) for c in d if c.get('snapshotUrl', '').startswith('https://ristmikud.tallinn.ee/')]
    return sample(out, n)


@source
def tarktee(n):
    ns = {'d': 'http://datex2.eu/schema/2/2_0'}
    loc = ET.fromstring(get('https://tarktee.transpordiamet.ee/api/v1/datex/roadCameraLocations').content)
    locs = {}
    for pl in loc.iter('{http://datex2.eu/schema/2/2_0}predefinedLocation'):
        lat = pl.find('.//d:latitude', ns); lon = pl.find('.//d:longitude', ns); nm = pl.find('.//d:value', ns)
        if lat is not None and lon is not None:
            locs[pl.get('id')] = (float(lat.text), float(lon.text), nm.text if nm is not None else '')
    img = ET.fromstring(get('https://tarktee.transpordiamet.ee/api/v1/datex/roadCameraImages').content)
    out = []
    for tv in img.iter('{http://datex2.eu/schema/2/2_0}linearTrafficView'):
        ref = tv.find('d:linearPredefinedLocationReference', ns)
        u = tv.find('.//d:urlLinkAddress', ns)
        if ref is None or u is None or ref.get('id') not in locs:
            continue
        lat, lon, nm = locs[ref.get('id')]
        out.append(C('Transpordiamet Tarktee', nm, '', 'Estonia', lat, lon, u.text))
    return nearest(out, [(59.437, 24.753, 'Tallinn'), (58.378, 26.729, 'Tartu'), (58.3859, 24.4971, 'Pärnu')], n)


@source
def lithuania(n):
    rows = get('https://eismoinfo.lt/eismoinfo-backend/camera-info-table').json()
    layer = get('https://eismoinfo.lt/eismoinfo-backend/layer-static-features/VKR').json()
    feats = {str(f.get('id')): f for L in layer for f in L.get('features', [])}
    out = []
    for r in rows:
        f = feats.get(str(r.get('id')))
        try:
            lat, lon = f['points'][0]['point']
        except Exception:
            continue
        out.append(C('Via Lietuva eismoinfo', r['name'], '', 'Lithuania', lat, lon, f"https://eismoinfo.lt/eismoinfo-backend/image-provider/camera/last?id={r['id']}"))
    return nearest(out, [(54.6872, 25.2797, 'Vilnius'), (54.8985, 23.9036, 'Kaunas'), (55.7033, 21.1443, 'Klaipėda')], n)


@source
def catalonia(n):
    x = get('https://www.gencat.cat/transit/opendata/cameres.xml').text
    out = []
    for m in re.finditer(r'<gml:coordinates[^>]*>([-\d.]+),([-\d.]+)</gml:coordinates>.*?<cite:carretera>(.*?)</cite:carretera>.*?<cite:municipi>(.*?)</cite:municipi>.*?<cite:link>(.*?)</cite:link>.*?<cite:font>(.*?)</cite:font>', x, re.S):
        lon, lat, road, muni, link, font = m.groups()
        link = link.replace('&amp;', '&').replace('http://', 'https://')
        if font not in ('SCT', 'IMI', 'Terrassa'):
            continue
        city = 'Barcelona' if font == 'IMI' else ('Terrassa' if font == 'Terrassa' else muni)
        out.append(C('Servei Català de Trànsit', f'{road} {muni}', city, 'Spain', lat, lon, link))
    return nearest(out, [(41.3874, 2.1686, 'Barcelona'), (41.5636, 2.0111, 'Terrassa'), (41.45, 2.2, 'Barcelona area')], n)


@source
def nsw(n):
    d = get('https://data.livetraffic.com/cameras/traffic-cam.json').json()
    out = []
    for f in d['features']:
        p = f['properties']
        href = (p.get('href') or '').replace('http://', 'https://')
        if not href.startswith('https://webcams.transport.nsw.gov.au/'):
            continue
        lon, lat = f['geometry']['coordinates'][:2]
        out.append(C('Live Traffic NSW', p['title'], '', 'Australia', lat, lon, href))
    return nearest(out, [(-33.8688, 151.2093, 'Sydney'), (-32.9283, 151.7817, 'Newcastle'), (-34.4278, 150.8931, 'Wollongong'), (-33.8, 151.0, 'Western Sydney')], n)


@source
def singapore(n):
    d = get('https://api.data.gov.sg/v1/transport/traffic-images').json()
    out = [C('LTA Singapore (data.gov.sg)', f"Camera {c['camera_id']}", 'Singapore', 'Singapore', c['location']['latitude'], c['location']['longitude'], c['image'])
           for c in d['items'][0]['cameras']]
    return sample(out, n)


@source
def hongkong(n):
    x = ET.fromstring(get('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml').content)
    out = []
    for im in x.iter('image'):
        g = lambda k: (im.findtext(k) or '').strip()
        if not g('url').startswith('https://tdcctv.data.one.gov.hk/'):
            continue
        out.append(C('HK Transport Department', re.sub(r'\s*\[.*?\]$', '', g('description')), f"Hong Kong ({g('district')})", 'Hong Kong', g('latitude'), g('longitude'), g('url')))
    return sample(out, n)


@source
def nz(n):
    d = get('https://trafficnz.info/service/traffic/rest/4/cameras/all', headers={'Accept': 'application/json'}).json()
    out = []
    for c in d['response']['camera']:
        if c.get('offline') or c.get('underMaintenance'):
            continue
        out.append(C('NZTA Waka Kotahi', (c.get('name') or '').strip() + (' - ' + c['description'] if c.get('description') else ''),
                     (c.get('region') or {}).get('name', ''), 'New Zealand', c['latitude'], c['longitude'], 'https://trafficnz.info' + c['imageUrl']))
    return nearest(out, [(-36.8485, 174.7633, 'Auckland'), (-41.2865, 174.7762, 'Wellington'), (-43.5321, 172.6362, 'Christchurch'), (-37.787, 175.279, 'Hamilton'), (-45.0312, 168.6626, 'Queenstown')], n)


TARGETS = dict(nsw=26, hongkong=24, singapore=18, nz=20, nyc=20, caltrans=18, wsdot=12, kingco=6, drivebc=14, calgary=8,
               toronto=10, txdot=10, austin=8, tfl=14, fintraffic=10, vegvesen=10, tallinn=6, tarktee=6, lithuania=8, catalonia=10)


def fetch_frame(c):
    try:
        hdr = {}
        if c['kind'] == 'txdot':
            r = S.get(c['url'], timeout=30, headers={'Accept': 'application/json'})
            r.raise_for_status()
            js = r.json()
            b64 = js.get('snippet') or js.get('Snippet') or ''
            data = base64.b64decode(b64.split(',')[-1])
        else:
            r = S.get(c['url'], timeout=30)
            r.raise_for_status()
            data = r.content
        im = Image.open(io.BytesIO(data))
        im.load()
        im = im.convert('RGB')
        g = im.convert('L')
        st = ImageStat.Stat(g)
        edges = ImageStat.Stat(g.resize((320, 180)).filter(ImageFilter.FIND_EDGES)).mean[0]
        sat = ImageStat.Stat(im.convert('HSV').split()[1]).mean[0]
        small = g.resize((16, 9))
        px = list(small.tobytes())
        ahash = ''.join('1' if p > sum(px) / len(px) else '0' for p in px)
        h = hashlib.md5(c['url'].encode()).hexdigest()[:12]
        path = f'{WORK}/frames/{h}.jpg'
        im.save(path, quality=95)
        c.update(ok=True, file=path, w=im.width, h=im.height, mean=round(st.mean[0], 1), std=round(st.stddev[0], 1),
                 edges=round(edges, 2), sat=round(sat, 1), ahash=ahash, bytes=len(data), fetched=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    except Exception as e:
        c.update(ok=False, err=str(e)[:160])
    return c


if __name__ == '__main__':
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else list(SOURCES)
    cands = []
    for name in only:
        try:
            got = SOURCES[name](TARGETS.get(name, 8))
            print(f'{name}: {len(got)} candidates')
            for g in got:
                g['src_key'] = name
            cands += got
        except Exception as e:
            print(f'{name}: CATALOG FAILED {e}')
    with ThreadPoolExecutor(24) as ex:
        res = list(ex.map(fetch_frame, cands))
    prev = []
    pth = f'{WORK}/candidates.json'
    if os.path.exists(pth):
        prev = [p for p in json.load(open(pth)) if p['src_key'] not in only]
    json.dump(prev + res, open(pth, 'w'), ensure_ascii=False, indent=0)
    from collections import Counter
    print('ok per source', Counter(c['src_key'] for c in res if c['ok']))
    print('fail per source', Counter(c['src_key'] for c in res if not c['ok']))
    for c in res:
        if not c['ok']:
            print('  FAIL', c['src_key'], c['url'][:90], c['err'][:100])
