#!/usr/bin/env python3
"""Everyday amenities around the campuses, scraped from OpenStreetMap.

Source: Overpass API (OpenStreetMap, ODbL):
    POST https://overpass-api.de/api/interpreter  data=<query>
One query covers every category and area; ways are reduced to their center.
Always today's OpenStreetMap data: --at is ignored.

    python datasets/amenities/fetch.py [--out file.json]
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_common"))
import datasetlib as lib  # noqa: E402

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
KEEP_TAGS = [
    "opening_hours",
    "operator",
    "brand",
    "website",
    "phone",
    "wheelchair",
    "indoor",
    "level",
    "fee",
    "description",
    "access",
    "addr:street",
    "addr:housenumber",
    "check_date",
]


def selector(f):
    """'amenity=x' or 'amenity=x][y=z' -> '[amenity=x][y=z]'"""
    parts = f.split("][")
    return "".join(f'["{p.split("=")[0]}"="{p.split("=")[1]}"]' for p in parts)


def query(conf):
    lines = []
    for area in conf["areas"]:
        around = f"(around:{area['radius']},{area['lat']},{area['lng']})"
        for cat in conf["categories"]:
            for f in cat["filters"]:
                lines.append(f"  nwr{selector(f)}{around};")
    return "[out:json][timeout:60];\n(\n" + "\n".join(lines) + "\n);\nout center tags;"


def category_of(tags, conf):
    for cat in conf["categories"]:
        for f in cat["filters"]:
            if all(tags.get(p.split("=")[0]) == p.split("=")[1] for p in f.split("][")):
                return cat
    return None


def nearest_area(lat, lng, areas):
    return min(areas, key=lambda a: (a["lat"] - lat) ** 2 + (a["lng"] - lng) ** 2)["name"]


def build(at=None):
    conf = lib.load_local(__file__, "categories.json")
    q = query(conf)
    data, errors = None, []
    for url in ENDPOINTS:
        try:
            data = lib.http_post_form(url, {"data": q}, timeout=90)
            break
        except Exception as err:
            errors.append(lib.error_text(f"Overpass {url}", err))
    if data is not None:
        errors = []
    items = []
    for el in (data or {}).get("elements", []):
        tags = el.get("tags") or {}
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        cat = category_of(tags, conf)
        if lat is None or lng is None or not cat:
            continue
        name = tags.get("name") or tags.get("brand") or cat["label"]
        items.append(
            {
                "id": f"{el['type']}/{el['id']}",
                "name": name,
                "lat": lat,
                "lng": lng,
                "approximate": False,
                "category": cat["id"],
                "campus": nearest_area(lat, lng, conf["areas"]),
                "subtitle": cat["label"]
                + (f" · {tags['opening_hours']}" if tags.get("opening_hours") else ""),
                "url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
                "details": {
                    "categoryLabel": cat["label"],
                    "tags": {k: tags[k] for k in KEEP_TAGS if k in tags},
                },
            }
        )
    items.sort(key=lambda i: (i["category"], i["name"]))
    return items, ENDPOINTS[:1], errors


if __name__ == "__main__":
    lib.main("amenities", build)
