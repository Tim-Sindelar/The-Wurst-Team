#!/usr/bin/env python3
"""Weather now and for the next hours at the campuses.

Source: Open-Meteo (free, no key):
    https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=..&hourly=..&timezone=Europe/Zurich

    python datasets/weather/fetch.py [--out file.json]
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_common"))
import datasetlib as lib  # noqa: E402

API = "https://api.open-meteo.com/v1/forecast"
CURRENT = "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,is_day"
HOURLY = "temperature_2m,precipitation_probability,precipitation,weather_code"
HOURS = 12

# WMO weather codes -> short text.
WMO = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Light showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail",
}


def build():
    places = lib.load_local(__file__, "places.json")["places"]
    items, errors = [], []
    data = None
    try:
        data = lib.http_json(API, {
            "latitude": ",".join(str(p["lat"]) for p in places),
            "longitude": ",".join(str(p["lng"]) for p in places),
            "current": CURRENT, "hourly": HOURLY, "forecast_hours": HOURS, "timezone": "Europe/Zurich",
        })
        if isinstance(data, dict):
            data = [data]
    except Exception as err:
        errors.append(lib.error_text("Open-Meteo", err))
    for i, p in enumerate(places):
        w = data[i] if data and i < len(data) else None
        details = {"current": None, "hourly": None}
        subtitle = "Weather"
        if w:
            cur = w.get("current") or {}
            details["current"] = {**cur, "text": WMO.get(cur.get("weather_code"), "")}
            h = w.get("hourly") or {}
            details["hourly"] = [
                {"time": t, "temp": h.get("temperature_2m", [None] * HOURS)[j],
                 "precipProb": (h.get("precipitation_probability") or [None] * HOURS)[j],
                 "precip": (h.get("precipitation") or [None] * HOURS)[j],
                 "code": (h.get("weather_code") or [None] * HOURS)[j],
                 "text": WMO.get((h.get("weather_code") or [None] * HOURS)[j], "")}
                for j, t in enumerate(h.get("time") or [])
            ]
            if cur.get("temperature_2m") is not None:
                subtitle = f"{round(cur['temperature_2m'])}° · {details['current']['text']}"
        items.append({"id": p["id"], "name": p["name"], "lat": p["lat"], "lng": p["lng"], "approximate": False,
                      "category": "weather", "campus": p["name"], "subtitle": subtitle,
                      "url": "https://www.meteoswiss.admin.ch/", "details": details})
    return items, [API], errors


if __name__ == "__main__":
    lib.main("weather", build)
