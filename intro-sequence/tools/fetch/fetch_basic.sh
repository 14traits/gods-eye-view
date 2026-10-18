#!/usr/bin/env bash
# Re-fetch the raw keyless feeds used by process_basic.py / process_tle.py / process_vessels.py.
# Usage: fetch_basic.sh <raw_dir>   then:
#   python3 -I process_basic.py <raw_dir> ../../data
#   python3 -I process_tle.py <raw_dir> ../../data
#   python3 -I process_vessels.py <raw_dir> ../../data
#   <venv with eccodes,numpy,requests>/python -I fetch_wind.py https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.YYYYMMDD/HH/atmos/gfs.tHHz.pgrb2.1p00.f006 ../../data/wind.json
#   python -I fetch_bonus.py ../../data <raw_dir>
#   python -I cctv_fetch.py <work_dir> && python -I cctv_select.py <work_dir> ../../cctv   (after rebuilding ok.json/contact sheets and re-reviewing EXCLUDE)
set -u
R="$1"; mkdir -p "$R"; cd "$R"
date -u +%Y-%m-%dT%H:%M:%SZ > fetch_start.txt
CT='gods-eye-view-celestrak-proxy/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)'  # CelesTrak 403s bulk groups without a descriptive UA
f() { curl -sS -m 300 --compressed "${@:3}" -o "$1" -w "$1 %{http_code} %{size_download}\n" "$2"; }
f opensky.json https://opensky-network.org/api/states/all &
f mil.json https://api.adsb.lol/v2/mil &
f mil_adsbfi.json https://opendata.adsb.fi/api/v2/mil &
f quakes.geojson https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson &
f viirs_snpp.csv https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv &
f viirs_n20.csv https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv &
f modis.csv https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv &
f cables.json https://www.submarinecablemap.com/api/v3/cable/cable-geo.json &
f coast50.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson &
f countries110.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson &
f places.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson &
f airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv &
f kystverket_ais.json https://kystdatahuset.kystverket.no/ws/api/ais/realtime/geojson &
f dt_ais_from.json "https://meri.digitraffic.fi/api/ais/v1/locations?from=$(( ($(date +%s)-172800)*1000 ))" -H "Digitraffic-User: gods-eye-intro" &
f digitraffic_vessels.json https://meri.digitraffic.fi/api/ais/v1/vessels -H "Digitraffic-User: gods-eye-intro" &
wait
# CelesTrak: sequential (parallel requests get connection resets); FORMAT=3le endpoint answered when FORMAT=tle timed out
f tle_active3.txt "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=3le" -A "$CT"
for g in stations starlink gps-ops geo weather; do sleep 3; f tle_$g.txt "https://celestrak.org/NORAD/elements/gp.php?GROUP=$g&FORMAT=tle" -A "$CT"; done
