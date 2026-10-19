"""Pick ~170 city centres from data/cities.json with geographic spread.

Writes tools/flurry/city_candidates.json: ordered list of dicts with
rank ("primary"/"backup") and region. Backups replace rejected primaries of the
same region in build.py.
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

AFRICA = {
    "Nigeria", "Egypt", "Congo (Kinshasa)", "South Africa", "Algeria", "Sudan", "Morocco", "Tanzania",
    "Cameroon", "Mozambique", "Libya", "Ethiopia", "Ivory Coast", "Tunisia", "Zambia", "Angola", "Ghana",
    "Uganda", "Kenya", "Guinea", "Madagascar", "Senegal", "Zimbabwe", "Mali", "Somalia", "Chad", "Niger",
    "Benin", "Eritrea", "Somaliland", "South Sudan", "Sierra Leone", "Mauritania", "Malawi", "Togo",
    "Congo (Brazzaville)", "Burkina Faso", "Rwanda", "Mauritius", "Gabon", "Equatorial Guinea", "Liberia",
    "Djibouti", "Central African Republic", "Guinea Bissau", "Lesotho", "Burundi", "Namibia", "Botswana",
    "The Gambia", "Comoros", "Cape Verde", "eSwatini",
}
SOUTH_AMERICA = {"Brazil", "Argentina", "Colombia", "Venezuela", "Peru", "Chile", "Ecuador", "Bolivia",
                 "Paraguay", "Uruguay", "Guyana", "Suriname"}
OCEANIA = {"Australia", "New Zealand", "Papua New Guinea", "Fiji", "French Polynesia", "Guam"}
CENTRAL_ASIA = {"Kazakhstan", "Uzbekistan", "Turkmenistan", "Kyrgyzstan", "Tajikistan", "Afghanistan", "Mongolia"}

# (region, primary quota, backups, per-country cap, min spacing km)
PASSES = [
    ("africa", AFRICA, 31, 16, 3, 300),
    ("south_america", SOUTH_AMERICA, 22, 10, 5, 250),
    ("oceania", OCEANIA, 12, 4, 5, 120),
    ("central_asia", CENTRAL_ASIA, 9, 5, 3, 150),
    ("rest", None, 96, 40, 11, 200),
]
# Picked first (in "rest" unless their country is in a quota region): fill the
# Pacific / high-latitude longitude bands and add visually distinctive cities.
FORCED = [
    "Honolulu", "Anchorage", "Papeete", "Agana", "Petropavlovsk-Kamchatsky", "Vancouver", "San Francisco",
    "Las Vegas", "Seattle", "Phoenix", "Denver", "Calgary", "Guatemala City", "Havana", "Reykjavík",
    "Dubai", "Doha", "Abu Dhabi", "Hong Kong", "Macau", "Venice", "Amsterdam", "København", "Oslo",
    "Stockholm", "Helsinki", "Prague", "Kathmandu", "Colombo", "Vladivostok", "Novosibirsk", "Irkutsk",
    "Yakutsk", "Norilsk", "Murmansk", "Manaus", "Mombasa", "Windhoek", "Nouakchott", "Marrakesh",
    "Samarkand", "Cairns", "Muscat", "Québec",
]
# Natural Earth rows whose point lands in farmland/hills rather than a dense centre.
EXCLUDE = {"Amaravati", "Hechi", "Saidu", "Cranbourne", "Manukau", "Waitakere", "North Shore", "Wahiawa"}
COUNTRY_CAP_TOTAL = 12


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def main():
    rows = json.load(open(os.path.join(ROOT, "data", "cities.json")))["rows"]
    special = AFRICA | SOUTH_AMERICA | OCEANIA | CENTRAL_ASIA
    chosen, out = [], []
    byname = {}
    for r in rows:
        byname.setdefault(r[3], r)  # first = most populous
    per = {}

    def region_of(country):
        for reg, mem, *_ in PASSES:
            if mem and country in mem:
                return reg
        return "rest"

    for nm in FORCED:
        lon, lat, pop, name, country = byname[nm]
        chosen.append((lon, lat))
        per[country] = per.get(country, 0) + 1
        out.append(dict(name=name, country=country, lat=lat, lon=lon, zoom=16, pop=pop,
                        region=region_of(country), rank="primary", forced=True))
    for region, members, quota, nback, cap, spacing in PASSES:
        got = sum(1 for c in out if c["region"] == region)
        for lon, lat, pop, name, country in rows:
            if name in EXCLUDE or name in byname and any(c["name"] == name and c["country"] == country for c in out):
                continue
            inreg = (country in members) if members else (country not in special)
            if not inreg:
                continue
            if per.get(country, 0) >= cap and got < quota or per.get(country, 0) >= COUNTRY_CAP_TOTAL:
                continue
            if any(km((lon, lat), (c[0], c[1])) < spacing for c in chosen):
                continue
            rank = "primary" if got < quota else "backup"
            chosen.append((lon, lat))
            per[country] = per.get(country, 0) + 1
            out.append(dict(name=name, country=country, lat=lat, lon=lon, zoom=16, pop=pop,
                            region=region, rank=rank))
            got += 1
            if got >= quota + nback:
                break
    json.dump(out, open(os.path.join(HERE, "city_candidates.json"), "w"), indent=0, ensure_ascii=False)
    prim = [c for c in out if c["rank"] == "primary"]
    print(len(prim), "primary,", len(out) - len(prim), "backup")
    from collections import Counter
    print(Counter(c["region"] for c in prim))
    print(Counter(c["country"] for c in prim).most_common(12))
    bands = Counter(int((c["lon"] + 180) // 30) for c in prim)
    print("30deg bands:", [bands.get(i, 0) for i in range(12)])


if __name__ == "__main__":
    main()
