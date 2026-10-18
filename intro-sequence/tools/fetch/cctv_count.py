#!/usr/bin/env python3
"""Count distinct cameras in every keyless CCTV catalog the app supports.

Fetches each source's FULL public catalog (no anchor selection, no
DEFAULT_*_MAX_SOURCES caps) and counts distinct cameras two ways:
  raw   - distinct camera ids listed in the catalog at all
  valid - distinct ids passing the app's own validity filters (in service /
          online / official still or stream URL / plausible coordinates),
          i.e. what server/providers/cctv/* would accept before capping.
The headline number written to data/extra_counts.json is the conservative
`valid` count. Sources that fail are skipped, never estimated.

Usage: python3 -I cctv_count.py <out_json> [<detail_json>]
"""
import json, math, re, sys, time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, parse_qs
import requests

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
REPO = '/home/user/gods-eye-view'


def sess():
    s = requests.Session()
    s.headers.update({'User-Agent': UA, 'Digitraffic-User': 'gods-eye-view'})
    return s


def get(url, timeout=60, **kw):
    r = sess().get(url, timeout=timeout, **kw)
    r.raise_for_status()
    return r


def fnum(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def inbox(lat, lon, la0, la1, lo0, lo1):
    return lat is not None and lon is not None and la0 <= lat <= la1 and lo0 <= lon <= lo1


SRC = {}


def source(label, country):
    def deco(fn):
        SRC[label] = (fn, country)
        return fn
    return deco


@source('TfL JamCams', 'United Kingdom')
def tfl():
    d = get('https://api.tfl.gov.uk/Place/Type/JamCam').json()
    raw, ok = set(), set()
    for p in d:
        raw.add(p['id'])
        props = {a['key']: a['value'] for a in p.get('additionalProperties', [])}
        if str(props.get('available')).lower() != 'true':
            continue
        if not (props.get('imageUrl') or '').startswith('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/'):
            continue
        if fnum(p.get('lat')) is None or fnum(p.get('lon')) is None:
            continue
        ok.add(p['id'])
    return raw, ok, 'one Place per camera; available=true + official S3 still'


@source('NYC DOT', 'United States')
def nyc():
    d = get('https://webcams.nyctmc.org/api/cameras').json()
    raw = {c['id'] for c in d}
    ok = {c['id'] for c in d if str(c.get('isOnline')).strip().lower() == 'true'
          and inbox(fnum(c.get('latitude')), fnum(c.get('longitude')), 40.4, 41.0, -74.3, -73.6)}
    return raw, ok, 'one row per camera; isOnline=true'


@source('Caltrans', 'United States')
def caltrans():
    raw, ok = set(), set()
    notes = []

    def one(dist):
        err = None
        for attempt in range(5):  # cwwp2 resets connections under parallel load
            try:
                return dist, get(f'https://cwwp2.dot.ca.gov/data/d{dist}/cctv/cctvStatusD{dist:02d}.json').json()
            except Exception as e:
                err = e
                time.sleep(1 + attempt)
        return dist, err
    with ThreadPoolExecutor(3) as ex:
        res = list(ex.map(one, range(1, 13)))
    for dist, d in res:
        if isinstance(d, Exception):
            notes.append(f'D{dist} failed: {str(d)[:60]}')
            continue
        for i, row in enumerate(d.get('data', [])):
            c = row.get('cctv') or {}
            loc = c.get('location') or {}
            name = (loc.get('locationName') or '').strip()
            m = re.match(r'^([A-Za-z0-9_-]+)\s*--', name)
            key = f"d{dist}-{(m.group(1) if m else c.get('index') or name or i)}".lower()
            raw.add(key)
            if str(c.get('inService')).lower() != 'true':
                continue
            if fnum(loc.get('latitude')) is None or fnum(loc.get('longitude')) is None:
                continue
            url = ((c.get('imageData') or {}).get('static') or {}).get('currentImageURL') or ''
            if not url.startswith('https://cwwp2.dot.ca.gov/'):
                continue
            ok.add(key)
    return raw, ok, 'all 12 districts; inService=true + cwwp2 still. ' + '; '.join(notes)


@source('WSDOT', 'United States')
def wsdot():
    d = json.loads(get('https://data.wsdot.wa.gov/travelcenter/Cameras.json').content.decode('cp1252'))
    raw, ok = set(), set()
    for f in d['features']:
        a = f.get('attributes') or {}
        cid = a.get('CameraID')
        if not isinstance(cid, int) or cid <= 0:
            continue
        raw.add(cid)
        if (a.get('ImageURL') or '').strip().startswith('https://images.wsdot.wa.gov/') and fnum((f.get('geometry') or {}).get('x')) is not None:
            ok.add(cid)
    return raw, ok, 'one feature per CameraID; official images.wsdot.wa.gov still'


@source('King County DOT', 'United States')
def kingco():
    d = get('https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/TRAFFICCAMERA_POINT_2029/FeatureServer/0/query?where=1%3D1&outFields=AssetID,Location,ImageURL,Live,Model,Manufacturer,Owner,CurrentStatus&f=geojson').json()
    raw, ok = set(), set()
    for f in d['features']:
        p = f.get('properties') or {}
        aid = p.get('AssetID')
        if not isinstance(aid, int) or aid <= 0:
            continue
        raw.add(aid)
        if p.get('Live') != 1 or str(p.get('CurrentStatus') or '').strip() != 'Active':
            continue
        if str(p.get('Owner') or '').strip() == 'WSDOT':
            continue  # WSDOT-owned rows are WSDOT cameras (counted under WSDOT)
        url = (p.get('ImageURL') or '').strip().replace('http://info.kingcounty.gov/', 'https://info.kingcounty.gov/')
        if not url.startswith('https://info.kingcounty.gov/'):
            continue
        ok.add(aid)
    note = 'Live=1 + Active, WSDOT-owned rows excluded (avoid double count)'
    if d.get('exceededTransferLimit') or (d.get('properties') or {}).get('exceededTransferLimit'):
        note += ' WARNING: transfer limit exceeded'
    return raw, ok, note


@source('DriveBC', 'Canada')
def drivebc():
    d = get('https://www.drivebc.ca/api/webcams/').json()
    raw, ok = set(), set()
    for c in d:
        cid = c.get('id')
        if not isinstance(cid, int) or cid <= 0:
            continue
        raw.add(cid)
        if c.get('is_on') is not True or c.get('should_appear') is not True:
            continue
        coords = (c.get('location') or {}).get('coordinates') or [None, None]
        if not inbox(fnum(coords[1]), fnum(coords[0]), 48.0, 60.5, -139.5, -113.5):
            continue
        ok.add(cid)
    return raw, ok, 'one webcam per id; is_on + should_appear'


@source('Fintraffic Digitraffic', 'Finland')
def fintraffic():
    d = get('https://tie.digitraffic.fi/api/weathercam/v1/stations', headers={'Accept-Encoding': 'gzip'}).json()
    raw, ok, presets = set(), set(), 0
    for f in d['features']:
        p = f.get('properties') or {}
        sid = str(p.get('id') or '')
        if not sid:
            continue
        raw.add(sid)
        if str(p.get('collectionStatus') or '').upper() != 'GATHERING':
            continue
        live = [pr for pr in p.get('presets') or [] if pr.get('inCollection') is True and re.fullmatch(r'C\d{7}', str(pr.get('id'))) and str(pr['id']).startswith(sid)]
        if live:
            ok.add(sid)
            presets += len(live)
    return raw, ok, f'counted per STATION (camera site), not per preset view; {presets} live presets (the app treats each preset as a camera)'


@source('Statens vegvesen', 'Norway')
def vegvesen():
    d = get('https://ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items?f=application/geo%2Bjson&limit=5000',
            headers={'Accept': 'application/geo+json,application/json'}).json()
    raw, ok = set(), set()
    for f in d['features']:
        p = f.get('properties') or {}
        rid = str(p.get('cameraId') or '').strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', rid):
            continue
        raw.add(rid)
        av = str(p.get('status.stillImageAvailability') or '').strip()
        if av and av != 'videoOrImagesAvailable':
            continue
        if (p.get('stillImageUrl') or '') != f'https://kamera.atlas.vegvesen.no/api/images/{rid}':
            continue
        c = (f.get('geometry') or {}).get('coordinates') or [None, None]
        if not inbox(fnum(c[1]), fnum(c[0]), 57.5, 71.5, 4.0, 31.5):
            continue
        ok.add(rid)
    note = f"numberMatched={d.get('numberMatched')} numberReturned={d.get('numberReturned')}"
    return raw, ok, 'stillImageAvailability ok + official still; ' + note


@source('City of Tallinn', 'Estonia')
def tallinn():
    d = json.load(open(f'{REPO}/config/cctv_sources.tallinn.json'))
    raw, ok = set(), set()
    for c in d:
        cid = str(c.get('id') or '').strip()
        if not cid:
            continue
        raw.add(cid)
        url = c.get('snapshotUrl') or c.get('url') or ''
        if inbox(fnum(c.get('lat')), fnum(c.get('lon')), 59.2, 59.7, 24.3, 25.4) and url.startswith('https://ristmikud.tallinn.ee/'):
            ok.add(url)
    return raw, ok, 'curated repo catalog (config/cctv_sources.tallinn.json) of ristmikud.tallinn.ee stills; distinct frame URLs'


@source('Transpordiamet Tarktee', 'Estonia')
def tarktee():
    lx = get('https://tarktee.transpordiamet.ee/api/v1/datex/roadCameraLocations', headers={'Accept': 'application/xml'}).text
    ix = get('https://tarktee.transpordiamet.ee/api/v1/datex/roadCameraImages', headers={'Accept': 'application/xml'}).text
    locs = {}
    for m in re.finditer(r'<predefinedLocation\s+id="([^"]+)"[^>]*>([\s\S]*?)</predefinedLocation>', lx):
        la = re.search(r'<latitude>\s*(-?\d+(?:\.\d+)?)\s*</latitude>', m.group(2), re.I)
        lo = re.search(r'<longitude>\s*(-?\d+(?:\.\d+)?)\s*</longitude>', m.group(2), re.I)
        if la and lo:
            locs[m.group(1)] = (float(la.group(1)), float(lo.group(1)))
    imgs = {}
    for m in re.finditer(r'<trafficView\b[^>]*>([\s\S]*?)</trafficView>', ix):
        r = re.search(r'<linearPredefinedLocationReference\b[^>]*\bid="([^"]+)"', m.group(1), re.I)
        u = re.search(r'<urlLinkAddress>\s*([^<\s]+)\s*</urlLinkAddress>', m.group(1), re.I)
        if r and u:
            imgs[r.group(1)] = u.group(1)
    raw = set(locs) | set(imgs)
    ok = set()
    for lid, (lat, lon) in locs.items():
        u = imgs.get(lid, '')
        if not u.startswith('https://tarktee.transpordiamet.ee/images/'):
            continue
        if not inbox(lat, lon, 57.4, 59.9, 21.5, 28.4):
            continue
        n = re.search(r'/images/(\d+)/', u)
        ok.add(n.group(1) if n else lid)
    return raw, ok, 'DATEX location joined to image; distinct camera numbers'


@source('Via Lietuva eismoinfo', 'Lithuania')
def lithuania():
    rows = get('https://eismoinfo.lt/eismoinfo-backend/camera-info-table', headers={'Accept': 'application/json'}).json()
    layers = get('https://eismoinfo.lt/eismoinfo-backend/layer-static-features/VKR', headers={'Accept': 'application/json'}).json()
    feats = {}
    for L in layers:
        if L.get('layer') == 'VKR':
            feats = {str(f.get('id')): f for f in L.get('features') or [] if f}
    raw, ok = set(), set()
    for r in rows:
        rid = str(r.get('id') or '')
        if not re.fullmatch(r'[1-9]\d{0,8}', rid):
            continue
        raw.add(rid)
        f = feats.get(rid)
        try:
            lat, lon = f['points'][0]['point']
        except Exception:
            continue
        if not inbox(fnum(lat), fnum(lon), 53.8, 56.5, 20.8, 26.9):
            continue
        u = urlparse(str(r.get('image') or ''))
        if f'{u.scheme}://{u.netloc}' != 'https://eismoinfo.lt' or u.path != '/eismoinfo-backend/image-provider/camera/last' or parse_qs(u.query).get('id', [''])[0] != rid:
            continue
        ok.add(rid)
    return raw, ok, 'camera table joined to VKR layer; official still endpoint'


@source('Live Traffic NSW', 'Australia')
def nsw():
    d = get('https://data.livetraffic.com/cameras/traffic-cam.json').json()
    raw, ok = set(), set()
    for f in d['features']:
        p = f.get('properties') or {}
        fid = str(f.get('id') or p.get('id') or p.get('title') or '').strip()
        if not fid:
            continue
        raw.add(fid)
        href = (p.get('href') or '').replace('http://', 'https://')
        c = (f.get('geometry') or {}).get('coordinates') or [None, None]
        if href.startswith('https://webcams.transport.nsw.gov.au/') and inbox(fnum(c[1]), fnum(c[0]), -38.0, -28.0, 140.0, 154.5):
            ok.add(fid)
    return raw, ok, 'one feature per camera; official webcams.transport.nsw.gov.au still'


@source('City of Calgary', 'Canada')
def calgary():
    d = get('https://data.calgary.ca/resource/k7p9-kppz.json?$limit=5000').json()
    raw, ok = set(), set()
    for c in d:
        url = ((c.get('camera_url') or {}).get('url') or '').strip()
        if not url:
            continue
        u = re.sub(r'^http://', 'https://', url)
        m = re.search(r'loc(\d+)\.jpg$', urlparse(u).path, re.I)
        key = m.group(1) if m else urlparse(u).path
        raw.add(key)
        coords = (c.get('point') or {}).get('coordinates') or [None, None]
        if u.startswith('https://trafficcam.calgary.ca/') and inbox(fnum(coords[1]), fnum(coords[0]), 50.7, 51.4, -114.5, -113.7):
            ok.add(key)
    return raw, ok, f'{len(d)} rows ($limit=5000); distinct trafficcam.calgary.ca image ids'


@source('City of Toronto RESCU', 'Canada')
def toronto():
    t = get('https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json').text
    d = json.loads(t[t.index('(') + 1: t.rindex(')')])
    raw, ok = set(), set()
    for c in d['Data']:
        n = str(c.get('Number') or '').strip()
        if not n:
            continue
        raw.add(n)
        if re.fullmatch(r'\d{1,6}', n) and inbox(fnum(c.get('Latitude')), fnum(c.get('Longitude')), 43.4, 44.0, -79.8, -79.0):
            ok.add(n)
    return raw, ok, 'one row per numbered RESCU camera'


@source('Servei Català de Trànsit', 'Spain')
def catalonia():
    x = get('https://www.gencat.cat/transit/opendata/cameres.xml').text
    hosts = {'mct.gencat.cat': '/mct2bo/', 'www.bcn.cat': '/transit/imatges/', 'emap.terrassa.cat': '/it_terrassa/'}
    raw, ok = set(), set()
    for m in re.finditer(r'<gml:featureMember>([\s\S]*?)</gml:featureMember>', x):
        b = m.group(1)
        co = re.search(r'<gml:coordinates[^>]*>([^<]+)</gml:coordinates>', b)
        lk = re.search(r'<cite:link>([^<]*)</cite:link>', b)
        if not co or not lk:
            continue
        link = lk.group(1).replace('&amp;', '&').strip()
        u = urlparse(link)
        cam = parse_qs(u.query).get('sctidcam', [''])[0]
        key = f'sct:{cam}' if u.hostname == 'mct.gencat.cat' and cam else f'{u.hostname}{u.path}'
        raw.add(key)
        lon, lat = (fnum(v) for v in co.group(1).split(',')[:2])
        if not inbox(lat, lon, 40.4, 42.95, 0.1, 3.4):
            continue
        d = hosts.get(u.hostname or '')
        if not d or not u.path.startswith(d) or u.username or u.password or u.port:
            continue
        f = u.path[len(d):]
        if not f or '/' in f:
            continue
        if u.hostname == 'mct.gencat.cat' and (f != 'RenderService' or not re.fullmatch(r'[a-z0-9]+\.(gif|jpe?g)', cam, re.I)):
            continue
        ok.add(key)
    return raw, ok, 'SCT + Barcelona IMI + Terrassa; keyed by frame file (feed fid is unstable)'


@source('City of Austin', 'United States')
def austin():
    d = get('https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD').json()
    cols = [c['fieldName'] for c in d['meta']['view']['columns']]
    raw, ok = set(), set()
    for row in d['data']:
        r = dict(zip(cols, row))
        cid = str(r.get('camera_id') or '').strip()
        if not cid:
            continue
        raw.add(cid)
        st = (r.get('camera_status') or '').strip().upper()
        if st and st != 'TURNED_ON':
            continue
        m = re.match(r'POINT \(([-\d.]+) ([-\d.]+)\)', r.get('location') or '')
        if not m or not inbox(fnum(m.group(2)), fnum(m.group(1)), 29.9, 30.8, -98.2, -97.3):
            continue
        ok.add(cid)
    return raw, ok, 'camera_status TURNED_ON'


TXDOT = 'ABL AMA ATL AUS BMT BWD BRY CHS CRP DAL ELP FTW HOU LRD LBB LFK ODA PAR PHR SJT SAT TYL WAC WFS YKM'.split()


@source('TxDOT ITS', 'United States')
def txdot():
    def one(code):
        for attempt in range(2):
            try:
                return code, get(f'https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode={code}',
                                 headers={'Accept': 'application/json'}, timeout=60).json()
            except Exception as e:
                err = e
        return code, err
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(one, TXDOT))
    raw, ok, notes, per = set(), set(), [], {}
    for code, d in res:
        if isinstance(d, Exception):
            notes.append(f'{code} failed: {str(d)[:50]}')
            continue
        n = 0
        for rows in (d.get('roadwayCctvStatuses') or {}).values():
            for r in rows or []:
                icd = str(r.get('icd_Id') or '').strip()
                if not icd:
                    continue
                raw.add(icd)
                if r.get('statusDescription') != 'Device Online' or r.get('hasSnapshot') is False:
                    continue
                lat, lon = r.get('latitude'), r.get('longitude')
                if not (isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and inbox(lat, lon, 25.5, 36.7, -106.8, -93.3)):
                    continue
                if icd not in ok:
                    n += 1
                ok.add(icd)
        per[code] = n
    return raw, ok, f'all 25 districts; Device Online + snapshot; per-district {per}. ' + '; '.join(notes)


@source('Ontario 511', 'Canada')
def ontario():
    d = get('https://511on.ca/api/v2/get/cameras?format=json&lang=en', headers={'Accept': 'application/json'}).json()
    raw, ok, views = set(), set(), 0
    for r in d:
        rid = str(r.get('Id') or r.get('id') or '').strip()
        if not rid:
            continue
        raw.add(rid)
        if not inbox(fnum(r.get('Latitude')), fnum(r.get('Longitude')), 41.0, 57.5, -95.6, -74.0):
            continue
        good = []
        for v in r.get('Views') or r.get('views') or []:
            if str(v.get('Status') or '').strip().lower() != 'enabled':
                continue
            u = urlparse(str(v.get('Url') or '').strip())
            if u.scheme == 'https' and (u.hostname == '511on.ca' or (u.hostname or '').endswith('.traveliq.co')) and re.fullmatch(r'/map/Cctv/[A-Za-z0-9_.-]+', u.path):
                good.append(v)
        if good:
            ok.add(rid)
            views += len(good)
    return raw, ok, f'counted per camera row, not per view; {views} enabled views'


@source('DelDOT', 'United States')
def deldot():
    d = get('https://tmc.deldot.gov/json/videocamera.json', headers={'Accept': 'application/json'}).json()
    raw, ok = set(), set()
    for r in d.get('videoCameras') or []:
        cid = str(r.get('id') or '').strip()
        if not cid:
            continue
        raw.add(cid)
        if str(r.get('status')).lower() != 'active':
            continue
        if not inbox(fnum(r.get('lat')), fnum(r.get('lon')), 38.4, 39.9, -75.85, -75.0):
            continue
        u = urlparse(str((r.get('urls') or {}).get('m3u8s') or ''))
        if u.scheme != 'https' or u.hostname != 'video.deldot.gov' or u.port not in (None, 443) or u.username or not re.fullmatch(r'/live/[A-Za-z0-9_.-]+/playlist\.m3u8', u.path):
            continue
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', cid):
            continue
        ok.add(cid)
    return raw, ok, 'status active + official HLS stream'


def run(label):
    fn, country = SRC[label]
    t0 = time.time()
    try:
        raw, ok, note = fn()
        if not ok:
            raise RuntimeError('catalog parsed to zero cameras')
        return label, dict(country=country, raw=len(raw), valid=len(ok), note=note, secs=round(time.time() - t0, 1))
    except Exception as e:
        return label, dict(country=country, error=f'{type(e).__name__}: {str(e)[:200]}', secs=round(time.time() - t0, 1))


if __name__ == '__main__':
    out = sys.argv[1]
    detail = sys.argv[2] if len(sys.argv) > 2 else None
    with ThreadPoolExecutor(8) as ex:
        results = dict(ex.map(run, list(SRC)))
    counted = {k: v for k, v in results.items() if 'valid' in v}
    for k, v in results.items():
        print(f"{k:28s} {v.get('country', ''):15s} raw={v.get('raw', '-'):>6} valid={v.get('valid', '-'):>6}  {v.get('error') or v.get('note')}")
    total = sum(v['valid'] for v in counted.values())
    res = {
        'cctv_catalog': total,
        'cctv_sources': {k: v['valid'] for k, v in counted.items()},
        'cctv_countries': len({v['country'] for v in counted.values()}),
        'fetched_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    print('TOTAL valid', total, 'raw', sum(v['raw'] for v in counted.values()), 'countries', res['cctv_countries'])
    json.dump(res, open(out, 'w'), ensure_ascii=False, indent=2)
    if detail:
        json.dump(results, open(detail, 'w'), ensure_ascii=False, indent=2)
