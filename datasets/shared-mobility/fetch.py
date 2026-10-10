#!/usr/bin/env python3
"""Shared bikes, e-bikes and e-scooters near the campuses.

Source: Swiss Federal Office of Energy, sharedmobility.ch (open data, all
providers in one API; see github.com/SFOE/sharedmobility):
    https://api.sharedmobility.ch/v1/sharedmobility/identify?Geometry=<lng>,<lat>&Tolerance=<m>&offset=<n>&geometryFormat=esrijson
    -> results[] {id, geometry {x: lng, y: lat}, attributes {provider_id,
       vehicle_type, pickup_type, station_name, available, ...}}

    python datasets/shared-mobility/fetch.py [--out file.json]
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_common"))
import datasetlib as lib  # noqa: E402

API = "https://api.sharedmobility.ch/v1/sharedmobility/identify"
MAX_PER_AREA = 400


def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def item_of(r, area):
    a = r.get("attributes") or {}
    g = r.get("geometry") or {}
    lng, lat = g.get("x"), g.get("y")
    if lat is None or lng is None:
        return None
    types = [str(t) for t in as_list(a.get("vehicle_type"))]
    station = a.get("station_name") or a.get("name")
    provider = a.get("provider_name") or a.get("provider_id") or "?"
    count = a.get("num_vehicle_available", a.get("num_bikes_available"))
    station_based = (a.get("pickup_type") == "station_based") or bool(station)
    return {
        "id": f"{provider}:{r.get('id') or a.get('id') or f'{lat},{lng}'}",
        "name": station or f"{provider} {', '.join(types) or 'vehicle'}",
        "lat": float(lat),
        "lng": float(lng),
        "approximate": False,
        "category": types[0] if types else "vehicle",
        "campus": area["name"],
        "subtitle": f"{provider}" + (" · station" if station_based else " · free floating"),
        "url": None,
        "details": {
            "provider": provider,
            "vehicleTypes": types,
            "stationBased": station_based,
            "available": a.get("available"),
            "count": count,
            "docksAvailable": a.get("num_docks_available"),
            "range": a.get("current_range_meters"),
            "reserved": a.get("vehicle_status_reserved", a.get("reserved")),
            "disabled": a.get("vehicle_status_disabled", a.get("disabled")),
        },
    }


def build():
    areas = lib.load_local(__file__, "areas.json")["areas"]
    items, errors, seen = [], [], set()
    for area in areas:
        offset = 0
        try:
            while offset < MAX_PER_AREA:
                data = lib.http_json(API, {"Geometry": f"{area['lng']},{area['lat']}", "Tolerance": area["radius"],
                                           "offset": offset, "geometryFormat": "esrijson"})
                results = data.get("results") if isinstance(data, dict) else data
                if not results:
                    break
                for r in results:
                    it = item_of(r, area)
                    if it and it["id"] not in seen and it["details"]["disabled"] is not True:
                        seen.add(it["id"])
                        items.append(it)
                offset += len(results)
                if len(results) < 50:
                    break
        except Exception as err:
            errors.append(lib.error_text(f"sharedmobility.ch ({area['name']})", err))
    return items, [API], errors


if __name__ == "__main__":
    lib.main("shared-mobility", build)
