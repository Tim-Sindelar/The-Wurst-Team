#!/usr/bin/env python3
"""Next ASVZ lessons per sport center.

Source: the JSON search behind asvz.ch's Sportfahrplan:
    https://asvz.ch/asvz_api/event_search?_format=json&limit=<n>[&f[0]=facility:<id>][&date=YYYY-MM-DD HH:MM]
    `date` (Zurich time) lists the lessons from then on, past days included.
    -> results[] {title, sport_name, facility_name, from_date, to_date, url, ...}
Field names vary a little between ASVZ releases, so the parsing is lenient.

    python datasets/asvz/fetch.py [--out file.json] [--at 2026-10-20T18:00]
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_common"))
import datasetlib as lib  # noqa: E402

API = "https://asvz.ch/asvz_api/event_search"
PER_FACILITY = 40
ALL = 300


def first(value):
    if isinstance(value, list):
        return value[0] if value else None
    return value


def text(value):
    value = first(value)
    if isinstance(value, dict):
        value = value.get("name") or value.get("title") or value.get("value")
    return " ".join(str(value).split()) if value not in (None, "") else None


def lesson(r):
    url = text(r.get("url"))
    if url and url.startswith("/"):
        url = "https://asvz.ch" + url
    free = r.get("places_free", r.get("free_places"))
    total = r.get("places_max", r.get("participants_max"))
    return {
        "title": text(r.get("title")) or text(r.get("sport_name")),
        "sport": text(r.get("sport_name")),
        "from": text(r.get("from_date")),
        "to": text(r.get("to_date")),
        "facility": text(r.get("facility_name")),
        "room": text(r.get("location")) or text(r.get("room_name")),
        "level": text(r.get("niveau_short_name")) or text(r.get("niveau_name")),
        "free": first(free),
        "total": first(total),
        "cancelled": bool(r.get("cancelled")),
        "url": url,
    }


def build(at=None):
    facilities = lib.load_local(__file__, "facilities.json")["facilities"]
    errors = []
    by_facility = {f["id"]: [] for f in facilities}
    params = {"_format": "json", "limit": ALL}
    if at:
        params["date"] = at.strftime("%Y-%m-%d %H:%M")
    try:
        data = lib.http_json(API, params)
        results = data.get("results") if isinstance(data, dict) else data
        for r in results or []:
            l = lesson(r)
            name = (l["facility"] or "").lower()
            for f in facilities:
                if any(m in name for m in f["match"]):
                    by_facility[f["id"]].append(l)
                    break
    except Exception as err:
        errors.append(lib.error_text("ASVZ lessons", err))
        by_facility = None

    items = []
    for f in facilities:
        lessons = None
        if by_facility is not None:
            lessons = sorted(by_facility[f["id"]], key=lambda l: l["from"] or "")[:PER_FACILITY]
        items.append({
            "id": f["id"],
            "name": f["name"],
            "lat": f["lat"],
            "lng": f["lng"],
            "approximate": f.get("approximate", False),
            "category": "sport-center",
            "campus": f.get("campus"),
            "subtitle": "ASVZ",
            "url": "https://asvz.ch/426-sportfahrplan" + (f"?f[0]=facility:{f['facilityId']}" if f.get("facilityId") else ""),
            "details": {"lessons": lessons},
        })
    return items, [API], errors


if __name__ == "__main__":
    lib.main("asvz", build)
