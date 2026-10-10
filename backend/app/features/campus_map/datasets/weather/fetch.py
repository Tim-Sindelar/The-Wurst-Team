#!/usr/bin/env python3
"""Weather now and for the next hours at the campuses, or (--at) at another time.

Source: Open-Meteo (free, no key):
    https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=..&hourly=..&timezone=Europe/Zurich
For another time, the hours from then on (the first one stands in for "current"):
    forecast API with start_hour/end_hour: 92 days back to 16 days ahead
    https://archive-api.open-meteo.com/v1/archive  older than that
        (ERA5 reanalysis, no precipitation probability)

    python datasets/weather/fetch.py [--out file.json] [--at 2026-10-20T14:00]
"""

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_common"))
import datasetlib as lib  # noqa: E402

API = "https://api.open-meteo.com/v1/forecast"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
PAST_DAYS = 92
FORECAST_DAYS = 16
CURRENT = (
    "temperature_2m,apparent_temperature,precipitation,weather_code,"
    "wind_speed_10m,relative_humidity_2m,is_day"
)
HOURLY = "temperature_2m,precipitation_probability,precipitation,weather_code"
ARCHIVE_HOURLY = "temperature_2m,precipitation,weather_code"
# With --at there is no "current" block; these come from the first hour instead.
AT_EXTRA = "apparent_temperature,wind_speed_10m,relative_humidity_2m,is_day"
HOURS = 12

# WMO weather codes -> short text.
WMO = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light showers",
    81: "Showers",
    82: "Heavy showers",
    85: "Snow showers",
    86: "Snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm, hail",
    99: "Thunderstorm, hail",
}


def query(places, at):
    """(url, params) for now or for the hours from `at` on; raises ValueError beyond the
    forecast."""
    base = {
        "latitude": ",".join(str(p["lat"]) for p in places),
        "longitude": ",".join(str(p["lng"]) for p in places),
        "timezone": "Europe/Zurich",
    }
    if not at:
        return API, {**base, "current": CURRENT, "hourly": HOURLY, "forecast_hours": HOURS}
    first = at.replace(minute=0)
    last = first + dt.timedelta(hours=HOURS - 1)
    now = lib.zurich_now()
    if first > now + dt.timedelta(days=FORECAST_DAYS - 1):
        raise ValueError(f"the forecast reaches only {FORECAST_DAYS} days ahead")
    if first >= now - dt.timedelta(days=PAST_DAYS):
        return API, {
            **base,
            "hourly": f"{HOURLY},{AT_EXTRA}",
            "start_hour": first.strftime("%Y-%m-%dT%H:%M"),
            "end_hour": last.strftime("%Y-%m-%dT%H:%M"),
        }
    return ARCHIVE, {
        **base,
        "hourly": f"{ARCHIVE_HOURLY},{AT_EXTRA}",
        "start_date": first.date().isoformat(),
        "end_date": last.date().isoformat(),
    }


def at_hours(w, at):
    """For --at: the hourly series from `at` on, the first hour also as "current"."""
    h = w.get("hourly") or {}
    times = h.get("time") or []
    key = at.strftime("%Y-%m-%dT%H:00")
    start = next((i for i, t in enumerate(times) if t >= key), len(times))
    hourly = {k: v[start : start + HOURS] for k, v in h.items() if isinstance(v, list)}
    current = {k: v[0] for k, v in hourly.items() if k != "time" and v and v[0] is not None}
    return ({**current, "time": hourly["time"][0]} if current else None), hourly


def cell(hourly, key, j):
    values = hourly.get(key) or []
    return values[j] if j < len(values) else None


def build(at=None):
    places = lib.load_local(__file__, "places.json")["places"]
    items, errors = [], []
    data, url = None, API
    try:
        url, params = query(places, at)
        data = lib.http_json(url, params)
        if isinstance(data, dict):
            data = [data]
    except Exception as err:
        errors.append(lib.error_text("Open-Meteo", err))
    for i, p in enumerate(places):
        w = data[i] if data and i < len(data) else None
        details = {"current": None, "hourly": None}
        subtitle = "Weather"
        if w:
            if at:
                cur, h = at_hours(w, at)
                cur = cur or {}
            else:
                cur, h = w.get("current") or {}, w.get("hourly") or {}
            details["current"] = (
                {**cur, "text": WMO.get(cur.get("weather_code"), "")} if cur else None
            )
            details["hourly"] = [
                {
                    "time": t,
                    "temp": cell(h, "temperature_2m", j),
                    "precipProb": cell(h, "precipitation_probability", j),
                    "precip": cell(h, "precipitation", j),
                    "code": cell(h, "weather_code", j),
                    "text": WMO.get(cell(h, "weather_code", j), ""),
                }
                for j, t in enumerate(h.get("time") or [])
            ]
            if cur.get("temperature_2m") is not None:
                subtitle = f"{round(cur['temperature_2m'])}° · {details['current']['text']}"
        items.append(
            {
                "id": p["id"],
                "name": p["name"],
                "lat": p["lat"],
                "lng": p["lng"],
                "approximate": False,
                "category": "weather",
                "campus": p["name"],
                "subtitle": subtitle,
                "url": "https://www.meteoswiss.admin.ch/",
                "details": details,
            }
        )
    return items, [url], errors


if __name__ == "__main__":
    lib.main("weather", build)
