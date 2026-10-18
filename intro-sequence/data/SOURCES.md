# Intro-sequence data snapshot: sources

All files are real downloads from public keyless endpoints, fetched on **2026-10-18 between 02:24 and 02:42 UTC**. Nothing here is synthesized. The scripts only filter, convert units and round. Helper scripts are in `../tools/fetch/` (`fetch_basic.sh`, `process_basic.py`, `process_tle.py`, `process_vessels.py`, `fetch_wind.py`, `fetch_bonus.py`, `cctv_fetch.py`, `cctv_select.py`).

JSON files are compact. Tabular layers use `{"cols":[...],"rows":[[...],...]}`, and each file's `cols` lists its columns. Coordinates are `[lon, lat]` in WGS84.

| File | Rows | Source URL(s) | Fetched (UTC) | Notes / licence |
|---|---|---|---|---|
| `flights.json` | 5,550 airborne aircraft | https://opensky-network.org/api/states/all | 02:24:18 (`t`=1792290258) | OpenSky Network state vectors, anonymous tier. Airborne only (`on_ground=false`), non-null positions. `alt_m` is geometric altitude, or barometric when geometric is missing. Licence: OpenSky Network, non-commercial/research terms; credit "The OpenSky Network, https://opensky-network.org". |
| `military.json` | 45 airborne aircraft | https://api.adsb.lol/v2/mil, plus https://opendata.adsb.fi/api/v2/mil (merged and de-duplicated by ICAO hex; adsb.lol wins) | 02:24 | Includes the `type` column (ICAO type code, e.g. C17, K35R). alt ft→m, gs kt→m/s. `country` is null because these feeds do not provide it. The count is low because the snapshot was taken at a quiet hour. A re-poll at 02:42 gave fewer (30 and 31 airborne). adsb.lol data is ODbL 1.0; adsb.fi open data. airplanes.live /v2/mil returned 403 and was not used. |
| `tle.txt` | 15,928 satellites (3-line TLE) | https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=3le | 02:26 | CelesTrak "active" group. The FORMAT=tle request kept failing with connection resets after about 11 s through the proxy, while FORMAT=3le answered in 4 s. Element epochs range from day 264 to 293 of 2026. A descriptive User-Agent is required (as in server/providers/space/celestrak.js). Credit: CelesTrak / Dr T.S. Kelso. Data originates from 18th SDS / space-track.org. |
| `tle_groups.json` | stations 17, starlink 10,651, gps-ops 32, geo 567, weather 72 | `gp.php?GROUP={stations,starlink,gps-ops,geo,weather}&FORMAT=tle` | 02:24–02:27 | `groups_norad`: NORAD ids per group, to join against `tle.txt` (columns 3–7 of line 1). `notable`: name→group for the first entries of each group (ISS (ZARYA), CSS (TIANHE), GOES, NOAA, GPS, …). |
| `quakes.json` | 10,120 events | https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson | 02:24 (`t`=generated ms) | USGS ANSS ComCat. Covers 2026-09-18 02:26 to 2026-10-18 02:20 UTC, max M7.7. Sorted by time. Public domain (USGS). |
| `fires.json` | 246,411 hotspots | https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv (111,551); https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv (118,991); https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv (15,869) | 02:24 | Rows are `[lon, lat, frp_MW, brightness_K]`. Brightness is VIIRS `bright_ti4` or MODIS `brightness`. Despite the "24h" names, the acquisitions run from 2026-10-16 00:11 to 2026-10-17 23:56 UTC. SNPP and NOAA-20 overlap, so the same fires appear twice. NASA FIRMS (LANCE); free use with credit "NASA FIRMS". |
| `vessels.json` | 4,385 vessels | https://kystdatahuset.kystverket.no/ws/api/ais/realtime/geojson (Norway, 3,272 with a position); https://meri.digitraffic.fi/api/ais/v1/locations?from=<now-48h> + https://meri.digitraffic.fi/api/ais/v1/vessels for names (Finland/Baltic, 1,113 after de-duplication against Norway) | 02:28–02:29 | **Not global.** Coverage is the Norwegian coast and EEZ including Svalbard (Kystverket Kystdatahuset open API; NLOD licence) plus Finnish waters and the northern Baltic (Fintraffic Digitraffic; CC BY 4.0). Kystverket returns short trails, and the script uses the last vertex as the current position, checked against COG. `sog_kn`/`cog_deg` are null when AIS sends "not available". No keyless global AIS source was found. AISStream (the repo's source) needs a key, BarentsWatch needs OAuth (401), the Danish DMA host has an expired TLS certificate, and Kystverket's raw TCP NMEA feed cannot pass the HTTPS-only proxy. |
| `wind.json` | 360×181 grid (65,160 cells) | https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261017/18/atmos/gfs.t18z.pgrb2.1p00.f006 (byte ranges from its `.idx`, UGRD/VGRD at "10 m above ground") | 02:34 | NOAA GFS 1.0° run 2026-10-17 18Z, +6 h forecast, valid 2026-10-18 00Z. This is the same AWS Open Data bucket and `.idx` range approach as server/providers/wind/gfs.js, decoded with ecCodes (pip `eccodes`). The grid is re-indexed so `lo1=-180, la1=90, dx=dy=1`, row-major from north to south, m/s. The 00Z run of 10-18 was not yet published. Public domain (NOAA). |
| `cables.json` | 1,948 polylines (732 cables) | https://www.submarinecablemap.com/api/v3/cable/cable-geo.json | 02:24 | Each LineString part is a separate polyline, rounded to 2 decimals. © TeleGeography, Submarine Cable Map (CC BY-SA 4.0); attribute TeleGeography. |
| `coastline.json` | 1,429 lines, 60,392 vertices | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson | 02:24 | Natural Earth 1:50m coastline, rounded to 2 decimals with consecutive duplicate points removed. Public domain. |
| `borders.json` | 288 rings | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson | 02:24 | Natural Earth 1:110m countries, each polygon ring as a line. Public domain. |
| `cities.json` | 3,000 | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson | 02:24 | Top 3,000 by `pop_max`. Natural Earth, public domain. |
| `airports.json` (bonus) | 5,280 (1,176 large, 4,104 medium) | https://davidmegginson.github.io/ourairports-data/airports.csv | 02:24 | OurAirports large and medium airports. `iata` falls back to the ICAO ident when there is no IATA code. `size` is L or M. Public domain. |
| `radio.json` (bonus) | 12,983 stations | https://de1.api.radio-browser.info/json/stations/search?has_geo_info=true&hidebroken=true&limit=100000 | 02:40 | Radio Browser community directory (the repo's radio provider). Stations with geo coordinates only. Public domain / open. |
| `bikes.json` (bonus) | 31,176 docks | 18 GBFS `station_information.json` feeds (Citi Bike, Divvy, Bay Wheels, Capital Bikeshare via gbfs.lyft.com; Bluebikes; Toronto, Barcelona, Madrid, São Paulo, Rio, Santiago, Bogotá via publicbikesystem.net; BIXI; Ecobici; Vélib'; Indego and LA Metro via bcycle; Oslo via urbansharing) + https://api.nextbike.net/maps/nextbike-live.json (all nextbike cities, 16,926 stations) | 02:41 | Per-system counts are in `systems`. Operator open-data terms apply (mostly GBFS open licences). |
| `launch_sites.json` (bonus) | 249 pads | https://ll.thespacedevs.com/2.3.0/pads/?limit=100&mode=list (paged) | 02:42 | Launch Library 2 (The Space Devs), sorted by total launches. Free tier. |
| `power_plants.json` (bonus) | 34,936 plants | https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv | 02:42 | WRI Global Power Plant Database v1.3 (static, 2021). CC BY 4.0. |

Not produced: **military installations**. The repo's provider queries OSM Overpass by viewport only and rejects global requests. A global Overpass pull would be slow and against that design. **Datacenters**: the repo has no keyless source.

## CCTV (`../cctv/`)

`cctv/cam_001.jpg` … `cam_117.jpg`: 117 real frames, each fetched 2026-10-18 02:38:46–02:39:30 UTC and cover-cropped and resized to 640×360 (JPEG q88). `cctv/index.json` gives `file, name, city, country, lat, lon, source`, plus `fetched_utc`, `orig_size` and the frame `url`.

About 235 frames were downloaded from 20 sources, and every one was reviewed on contact sheets. Placeholders were rejected: Caltrans "Temporarily Unavailable", Vegvesen "Kamera er midlertidig ute av drift", Tallinn "NB! ÜHENDUS KAAMERAGA PUUDUB", Barcelona "Interrupció temporal de la imatge", and one all-black King County frame. Frames whose average hash repeats within the set were also dropped as placeholders, as were frames under 320 px wide or with luminance mean ≤25 or std ≤15.

Local time at capture: daylight in Sydney, NZ, Hong Kong and Singapore; evening or night in the Americas; pre-dawn night in Europe. The Hong Kong TD frames carry the department's own privacy-mask polygons.

| Source | Frames | Country | Catalog endpoint (frames from) |
|---|---|---|---|
| Live Traffic NSW | 12 | Australia | https://data.livetraffic.com/cameras/traffic-cam.json (webcams.transport.nsw.gov.au) |
| NZTA Waka Kotahi | 12 | New Zealand | https://trafficnz.info/service/traffic/rest/4/cameras/all (trafficnz.info/camera/*.jpg) |
| HK Transport Department | 10 | Hong Kong | https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml (tdcctv.data.one.gov.hk) |
| LTA Singapore | 6 | Singapore | https://api.data.gov.sg/v1/transport/traffic-images (the feed listed only 8 cameras) |
| NYC DOT | 9 | USA | https://webcams.nyctmc.org/api/cameras (…/{id}/image) |
| Caltrans CCTV | 6 | USA | https://cwwp2.dot.ca.gov/data/d{4,7,11,3}/cctv/cctvStatusD0X.json |
| WSDOT | 6 | USA | https://data.wsdot.wa.gov/travelcenter/Cameras.json (images.wsdot.wa.gov only) |
| King County DOT | 3 | USA | ArcGIS TRAFFICCAMERA_POINT_2029 FeatureServer (info.kingcounty.gov) |
| TxDOT ITS | 4 | USA | https://its.txdot.gov/its/DistrictIts/GetCctvStatusListByDistrict?districtCode=… (base64 JSON snapshot; Dallas and San Antonio worked, Houston and El Paso returned null) |
| City of Austin | 4 | USA | https://data.austintexas.gov/api/views/b4k4-adkb/rows.json (cctv.austinmobility.io) |
| DriveBC | 6 | Canada | https://www.drivebc.ca/api/webcams/ |
| City of Toronto RESCU | 6 | Canada | https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json |
| City of Calgary | 4 | Canada | https://data.calgary.ca/resource/k7p9-kppz.json |
| TfL JamCams | 8 | UK | https://api.tfl.gov.uk/Place/Type/JamCam (jamcams.tfl.gov.uk S3) |
| Fintraffic Digitraffic | 4 | Finland | https://tie.digitraffic.fi/api/weathercam/v1/stations (weathercam.digitraffic.fi) |
| Statens vegvesen | 4 | Norway | ogckart-sn1.atlas.vegvesen.no datex_3_1:CctvSimple (kamera.atlas.vegvesen.no) |
| City of Tallinn | 3 | Estonia | repo config/cctv_sources.tallinn.json (ristmikud.tallinn.ee) |
| Transpordiamet Tarktee | 3 | Estonia | tarktee.transpordiamet.ee DATEX2 roadCameraLocations + roadCameraImages |
| Via Lietuva eismoinfo | 4 | Lithuania | https://eismoinfo.lt/eismoinfo-backend/camera-info-table + layer-static-features/VKR |
| Servei Català de Trànsit catalog | 3 | Spain | https://www.gencat.cat/transit/opendata/cameres.xml (the 3 kept frames are Barcelona IMI cameras on www.bcn.cat; SCT's own mct.gencat.cat host would not answer over HTTPS) |

Skipped: Ontario 511 (now answers "Invalid Key"), DelDOT (video only), Warendorf (http-only host, and the proxy allows HTTPS only).

The frames are public agency imagery, used here under each agency's open-data or terms-of-use conditions. Credit the agency named in `source`. TfL: "Powered by TfL Open Data". NSW: © Transport for NSW. HK: © HKSAR Transport Department (data.gov.hk). Singapore: LTA via data.gov.sg (Singapore Open Data Licence). NZ: © NZ Transport Agency Waka Kotahi (CC BY 4.0).
