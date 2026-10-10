#!/usr/bin/env python3
"""Live departures at the stops near the campuses, from now or (--at) another time.

Source: transport.opendata.ch (Swiss public transport API, no key):
    https://transport.opendata.ch/v1/stationboard?station=<name>&limit=<n>
        [&datetime=YYYY-MM-DD HH:MM]
    The timetable reaches about a week back and to the end of the current
    timetable year (December); delays only exist around now.
    -> station.coordinate {x: lat, y: lng}, stationboard[] {category, number,
       to, stop {departure, delay, platform, prognosis}}

    python datasets/transport/fetch.py [--out file.json] [--at 2026-10-20T14:00]
"""

import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_common"))
import datasetlib as lib  # noqa: E402

API = "https://transport.opendata.ch/v1/stationboard"
LIMIT = 15


def departures(board):
    out = []
    for dep in board.get("stationboard") or []:
        stop = dep.get("stop") or {}
        prognosis = stop.get("prognosis") or {}
        out.append(
            {
                "time": stop.get("departure"),
                "expected": prognosis.get("departure"),
                "delay": stop.get("delay"),
                "platform": prognosis.get("platform") or stop.get("platform"),
                "category": dep.get("category"),
                "line": dep.get("number") or dep.get("category"),
                "to": dep.get("to"),
            }
        )
    return out


def coordinate(board):
    c = (board.get("station") or {}).get("coordinate") or {}
    x, y = c.get("x"), c.get("y")
    if x is None or y is None:
        return None
    # The API answers x = latitude, y = longitude for WGS84; be lenient about it.
    lat, lng = (x, y) if x > y else (y, x)
    return lat, lng


def build(at=None):
    stops = lib.load_local(__file__, "stops.json")["stops"]
    errors = []
    params = {"limit": LIMIT}
    if at:
        params["datetime"] = at.strftime("%Y-%m-%d %H:%M")

    def one(stop):
        if not stop.get("station"):
            return stop, None, None
        try:
            return stop, lib.http_json(API, {"station": stop["station"], **params}), None
        except Exception as err:
            return stop, None, lib.error_text(stop["name"], err)

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(one, stops))
    if at and not any(board and board.get("stationboard") for _s, board, _e in results):
        errors.append(
            f"Timetable: no departures on {at:%Y-%m-%d} "
            "(it reaches about a week back and to the end of the timetable year)"
        )

    items = []
    for stop, board, err in results:
        if err:
            errors.append(err)
        lat, lng, approx = stop["lat"], stop["lng"], stop.get("approximate", False)
        if board and coordinate(board):
            lat, lng = coordinate(board)
            approx = False
        items.append(
            {
                "id": stop["id"],
                "name": stop["name"],
                "lat": lat,
                "lng": lng,
                "approximate": approx,
                "category": stop["kind"],
                "campus": stop.get("campus"),
                "subtitle": stop.get("station") or "ETH shuttle",
                "url": stop.get("url"),
                "details": {
                    "kind": stop["kind"],
                    "note": stop.get("note"),
                    "departures": departures(board) if board else None,
                },
            }
        )
    return items, [API], errors


if __name__ == "__main__":
    lib.main("transport", build)
