#!/usr/bin/env python3
"""Bonus layers: radio stations (Radio Browser), GBFS bike stations, launch pads (Launch Library 2),
power plants (WRI Global Power Plant Database).  Usage: python3 -I fetch_bonus.py <out_data_dir> <raw_dir>"""
import csv, io, json, os, sys, time, zipfile
import requests

OUT, RAW = sys.argv[1], sys.argv[2]
only = sys.argv[3].split(',') if len(sys.argv) > 3 else ['radio', 'gbfs', 'pads', 'power']
S = requests.Session()
S.headers['User-Agent'] = 'GodsEyeView/1.0 intro-sequence data snapshot'
log = {}


def dump(name, obj):
    with open(os.path.join(OUT, name), 'w') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)


if 'radio' in only:
    rows, used = [], None
    for host in ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://nl1.api.radio-browser.info']:
        try:
            r = S.get(f'{host}/json/stations/search', params={'has_geo_info': 'true', 'hidebroken': 'true', 'limit': 100000}, timeout=180,
                      headers={'User-Agent': 'GodsEyeView/1.0 (Radio Browser directory client)'})
            r.raise_for_status()
            data = r.json(); used = host
            break
        except Exception as e:
            print('radio', host, e)
    seen = set()
    for s in data:
        lat, lon = s.get('geo_lat'), s.get('geo_long')
        if lat is None or lon is None or (abs(lat) < 0.01 and abs(lon) < 0.01):
            continue
        key = (round(lon, 3), round(lat, 3), s['name'].strip())
        if key in seen:
            continue
        seen.add(key)
        rows.append([round(lon, 4), round(lat, 4), s['name'].strip(), s.get('countrycode') or ''])
    dump('radio.json', {'cols': ['lon', 'lat', 'name', 'cc'], 'rows': rows})
    log['radio'] = dict(url=f'{used}/json/stations/search?has_geo_info=true&hidebroken=true&limit=100000', rows=len(rows))
    print('radio', len(rows))

if 'gbfs' in only:
    SYSTEMS = {
        'Citi Bike (New York)': 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json',
        'Divvy (Chicago)': 'https://gbfs.lyft.com/gbfs/2.3/chi/en/station_information.json',
        'Bay Wheels (SF Bay)': 'https://gbfs.lyft.com/gbfs/2.3/bay/en/station_information.json',
        'Capital Bikeshare (DC)': 'https://gbfs.lyft.com/gbfs/2.3/dca-cabi/en/station_information.json',
        'Bluebikes (Boston)': 'https://gbfs.bluebikes.com/gbfs/en/station_information.json',
        'Bike Share Toronto': 'https://toronto.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
        'BIXI (Montreal)': 'https://gbfs.velobixi.com/gbfs/en/station_information.json',
        'Ecobici (Mexico City)': 'https://gbfs.mex.lyftbikes.com/gbfs/en/station_information.json',
        'Velib Metropole (Paris)': 'https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_information.json',
        'Bicing (Barcelona)': 'https://barcelona.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
        'BiciMAD (Madrid)': 'https://madrid.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
        'Bike Sampa (Sao Paulo)': 'https://saopaulo.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
        'Bike Rio (Rio de Janeiro)': 'https://riodejaneiro.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
        'Bike Santiago': 'https://santiago.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
        'Tembici Bogota': 'https://bogota.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
        'Indego (Philadelphia)': 'https://gbfs.bcycle.com/bcycle_indego/station_information.json',
        'Metro Bike Share (LA)': 'https://gbfs.bcycle.com/bcycle_lametro/station_information.json',
        'Oslo Bysykkel': 'https://gbfs.urbansharing.com/oslobysykkel.no/station_information.json',
    }
    rows, per = [], {}
    for name, url in SYSTEMS.items():
        try:
            d = S.get(url, timeout=60, headers={'Client-Identifier': 'gods-eye-view'}).json()
            st = d['data']['stations']
            for s in st:
                rows.append([round(float(s['lon']), 5), round(float(s['lat']), 5)])
            per[name] = len(st)
        except Exception as e:
            per[name] = f'FAILED {str(e)[:80]}'
    # nextbike: one keyless global live feed covering every nextbike city
    try:
        d = S.get('https://api.nextbike.net/maps/nextbike-live.json', timeout=120).json()
        n = 0
        for c in d['countries']:
            for city in c.get('cities', []):
                for p in city.get('places', []):
                    if p.get('spot'):  # stations only, not free-floating bikes
                        rows.append([round(p['lng'], 5), round(p['lat'], 5)]); n += 1
        per['nextbike (all cities, global)'] = n
    except Exception as e:
        per['nextbike'] = f'FAILED {e}'
    dump('bikes.json', {'cols': ['lon', 'lat'], 'systems': per, 'rows': rows})
    log['gbfs'] = dict(systems=per, urls=list(SYSTEMS.values()) + ['https://api.nextbike.net/maps/nextbike-live.json'], rows=len(rows))
    print('bikes', len(rows), per)

if 'pads' in only:
    url = 'https://ll.thespacedevs.com/2.3.0/pads/?limit=100&mode=list'
    rows = []
    while url:
        r = S.get(url, timeout=60)
        r.raise_for_status()
        d = r.json()
        for p in d['results']:
            try:
                lat, lon = float(p['latitude']), float(p['longitude'])
            except (TypeError, ValueError, KeyError):
                continue
            loc = p.get('location') or {}
            rows.append([round(lon, 4), round(lat, 4), p['name'], loc.get('name') if isinstance(loc, dict) else None,
                         p.get('total_launch_count') or 0, bool(p.get('active'))])
        url = d.get('next')
        time.sleep(1)
    rows.sort(key=lambda x: -x[4])
    dump('launch_sites.json', {'cols': ['lon', 'lat', 'pad', 'location', 'total_launches', 'active'], 'rows': rows})
    log['pads'] = dict(url='https://ll.thespacedevs.com/2.3.0/pads/?limit=100&mode=list (paged)', rows=len(rows))
    print('pads', len(rows))

if 'power' in only:
    url = 'https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv'
    r = S.get(url, timeout=180)
    r.raise_for_status()
    rows = []
    for row in csv.DictReader(io.StringIO(r.content.decode('utf-8'))):
        try:
            rows.append([round(float(row['longitude']), 4), round(float(row['latitude']), 4), round(float(row['capacity_mw']), 1), row['primary_fuel'], row['name'], row['country']])
        except ValueError:
            pass
    rows.sort(key=lambda x: -x[2])
    dump('power_plants.json', {'cols': ['lon', 'lat', 'capacity_mw', 'fuel', 'name', 'iso3'], 'rows': rows})
    log['power'] = dict(url=url, rows=len(rows))
    print('power', len(rows))

prev = {}
p = os.path.join(RAW, 'bonus_log.json')
if os.path.exists(p):
    prev = json.load(open(p))
prev.update(log)
json.dump(prev, open(p, 'w'), indent=1)
