#!/usr/bin/env python3
"""Offline tests: every fetcher parses API-shaped answers and survives a network failure.

    python3 datasets/test_fetchers.py
"""

import datetime as dt
import importlib.util
import os
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(f"fetch_{name.replace('-', '_')}", os.path.join(HERE, name, "fetch.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def offline(*_a, **_k):
    raise OSError("offline")


class Fetchers(unittest.TestCase):
    def test_offline_still_lists_locations(self):
        for name in ["mensa", "transport", "asvz", "weather"]:
            mod = load(name)
            with mock.patch.object(mod.lib, "http_json", offline), mock.patch.object(mod.lib, "http_post_form", offline):
                items, _sources, errors = mod.build()
            self.assertTrue(items, name)
            self.assertTrue(errors, name)
            for it in items:
                self.assertTrue({"id", "name", "lat", "lng", "details"} <= it.keys())

    def test_mensa_eth_and_uzh(self):
        mod = load("mensa")
        today = mod.lib.zurich_now().date()
        rota = {"weekly-rota-array": [{
            "facility-id": 9, "valid-from": (today - dt.timedelta(days=3)).isoformat(), "valid-to": (today + dt.timedelta(days=3)).isoformat(),
            "day-of-week-array": [{"day-of-week-code": today.isoweekday(), "opening-hour-array": [{
                "time-from": "11:00", "time-to": "14:00", "meal-time-array": [{
                    "name": "Lunch", "time-from": "11:15", "time-to": "13:30", "line-array": [{
                        "name": "GARDEN", "meal": {"name": "Curry", "description": "Rice\n and  peas",
                                                  "meal-price-array": [{"price": 7.5, "customer-group-desc-short": "Stud.", "customer-group-position": 10}],
                                                  "meal-class-array": [{"desc-short": "vegan"}], "allergen-array": []}}]}]}]}]}]}
        uzh = {"data": {"location": {"kitchens": [{"slug": "untere-mensa", "todayOffer": [{"digitalMenuItems": [
            {"displayName": "Farm", "recipeSelectorConfig": {"name": "mittag"}, "recipe": {"title": {"de": "Rösti", "en": "Rosti"},
             "prices": [{"amount": "8.90", "category": {"title": "Externe"}}, {"amount": "5.40", "category": {"title": "Studierende"}}], "allergensList": ["Milk"]}},
            {"displayName": "Evening", "recipeSelectorConfig": {"name": "abend"}, "recipe": {"title": {"en": "Soup"}, "prices": []}}]}]}]}}}

        def fake(url, params=None, body=None, **_k):
            return rota if "cookpit" in url else uzh

        with mock.patch.object(mod.lib, "http_json", fake):
            items, _s, errors = mod.build()
        self.assertEqual(errors, [])
        poly = next(i for i in items if i["id"] == "eth-polyterrasse")
        meal = poly["details"]["menus"][0]["meals"][0]
        self.assertEqual((meal["name"], meal["description"], meal["prices"][0]["price"], meal["tags"]), ("Curry", "Rice and peas", 7.5, ["vegan"]))
        unten = next(i for i in items if i["id"] == "uzh-untere-mensa")["details"]["menus"]
        self.assertEqual([m["name"] for m in unten[0]["meals"]], ["Rosti"])
        self.assertEqual(unten[0]["meals"][0]["prices"][0]["price"], "5.40")
        self.assertEqual([m["name"] for m in unten[1]["meals"]], ["Soup"])
        clausius = next(i for i in items if i["id"] == "eth-clausiusbar")
        self.assertEqual(clausius["details"]["menus"], [])
        # Rooms from rooms.json: position, room and floor come from there; mensas without an entry keep theirs.
        self.assertEqual(poly["details"]["place"]["rooms"], ["ETH.MM.B.B_079"])
        self.assertEqual((poly["details"]["place"]["floor"], poly["approximate"]), (-2, False))
        self.assertTrue(poly["subtitle"].startswith("MM B 79"))
        self.assertIsNone(next(i for i in items if i["id"] == "uzh-untere-mensa")["details"]["place"])

    def test_mensa_rooms_file(self):
        mod = load("mensa")
        ids = {loc["id"] for loc in mod.lib.load_local(mod.__file__, "locations.json")["locations"]}
        for mid, place in mod.lib.load_local(mod.__file__, "rooms.json")["mensas"].items():
            self.assertIn(mid, ids)
            self.assertTrue(place["rooms"], mid)
            self.assertEqual(place["levelId"], ".".join(place["rooms"][0].split(".")[:3]), mid)
            self.assertTrue(place["levelId"].startswith(place["facilityId"] + "."), mid)
            self.assertEqual(set(place["levels"]), {".".join(r.split(".")[:3]) for r in place["rooms"]}, mid)

    def test_transport(self):
        mod = load("transport")
        board = {"station": {"coordinate": {"type": "WGS84", "x": 47.377, "y": 8.548}},
                 "stationboard": [{"category": "T", "number": "10", "to": "Zürich Flughafen",
                                   "stop": {"departure": "2026-10-10T12:00:00+0200", "delay": 1, "platform": None, "prognosis": {}}}]}
        with mock.patch.object(mod.lib, "http_json", lambda *a, **k: board):
            items, _s, errors = mod.build()
        self.assertEqual(errors, [])
        stop = items[0]
        self.assertEqual((stop["lat"], stop["lng"], stop["approximate"]), (47.377, 8.548, False))
        self.assertEqual(stop["details"]["departures"][0]["line"], "10")
        self.assertIsNone(next(i for i in items if i["category"] == "shuttle")["details"]["departures"])

    def test_asvz(self):
        mod = load("asvz")
        data = {"results": [
            {"title": "Yoga", "sport_name": "Yoga", "facility_name": ["Sport Center Polyterrasse"], "from_date": "2026-10-10T12:00:00+02:00",
             "to_date": "2026-10-10T13:00:00+02:00", "url": "/tn/lessons/1", "places_free": 3},
            {"title": "Run", "facility_name": "Sport Center Hönggerberg", "from_date": "2026-10-10T11:00:00+02:00"}]}
        with mock.patch.object(mod.lib, "http_json", lambda *a, **k: data):
            items, _s, errors = mod.build()
        by = {i["id"]: i["details"]["lessons"] for i in items}
        self.assertEqual(by["polyterrasse"][0]["free"], 3)
        self.assertEqual(by["polyterrasse"][0]["url"], "https://asvz.ch/tn/lessons/1")
        self.assertEqual(by["hoenggerberg"][0]["title"], "Run")
        self.assertEqual(by["irchel"], [])

    def test_shared_mobility(self):
        mod = load("shared-mobility")
        page = {"results": [
            {"id": "a1", "geometry": {"x": 8.548, "y": 47.377}, "attributes": {"provider_id": "voi", "vehicle_type": ["E-Scooter"], "available": True}},
            {"id": "s1", "geometry": {"x": 8.549, "y": 47.378}, "attributes": {"provider_id": "publibike", "vehicle_type": ["E-Bike", "Bike"],
                                                                         "pickup_type": "station_based", "station_name": "ETH", "num_vehicle_available": 4}}]}
        with mock.patch.object(mod.lib, "http_json", lambda *a, **k: page):
            items, _s, errors = mod.build()
        self.assertEqual(errors, [])
        self.assertEqual(len(items), 2)  # same ids in every area are deduplicated
        station = next(i for i in items if i["details"]["stationBased"])
        self.assertEqual((station["name"], station["details"]["count"], station["category"]), ("ETH", 4, "E-Bike"))

    def test_weather(self):
        mod = load("weather")
        one = {"current": {"temperature_2m": 12.4, "weather_code": 3}, "hourly": {"time": ["2026-10-10T12:00"], "temperature_2m": [13],
               "precipitation_probability": [20], "precipitation": [0], "weather_code": [61]}}
        with mock.patch.object(mod.lib, "http_json", lambda *a, **k: [one, one, one]):
            items, _s, errors = mod.build()
        self.assertEqual(items[0]["subtitle"], "12° · Overcast")
        self.assertEqual(items[0]["details"]["hourly"][0]["text"], "Light rain")

    def test_amenities(self):
        mod = load("amenities")
        data = {"elements": [
            {"type": "node", "id": 1, "lat": 47.377, "lon": 8.548, "tags": {"amenity": "drinking_water"}},
            {"type": "way", "id": 2, "center": {"lat": 47.408, "lon": 8.508}, "tags": {"shop": "supermarket", "name": "Coop", "opening_hours": "Mo-Fr 07:00-20:00"}},
            {"type": "node", "id": 3, "lat": 47.377, "lon": 8.548, "tags": {"amenity": "bench"}}]}
        with mock.patch.object(mod.lib, "http_post_form", lambda *a, **k: data):
            items, _s, errors = mod.build()
        self.assertEqual(errors, [])
        self.assertEqual([(i["category"], i["name"], i["campus"]) for i in items],
                         [("supermarket", "Coop", "Hönggerberg"), ("water", "Drinking water", "Zentrum")])


class AtTime(unittest.TestCase):
    """--at: the time is passed on to the sources that support it."""

    def test_zurich_time(self):
        lib = load("weather").lib
        self.assertEqual(lib.zurich_time("2026-10-20T14:00").utcoffset(), dt.timedelta(hours=2))
        self.assertEqual(lib.zurich_time("2026-12-20T14:00").utcoffset(), dt.timedelta(hours=1))

    def test_transport_and_asvz_pass_the_time(self):
        for name, key, answer in [("transport", "datetime", {"stationboard": []}), ("asvz", "date", {"results": []})]:
            mod = load(name)
            seen = []
            with mock.patch.object(mod.lib, "http_json", lambda url, params=None, **k: seen.append(params) or answer):
                mod.build(mod.lib.zurich_time("2026-10-20T14:00"))
            self.assertTrue(seen, name)
            self.assertTrue(all(p[key] == "2026-10-20 14:00" for p in seen), name)

    def test_mensa_other_day(self):
        mod = load("mensa")
        day = mod.lib.zurich_now().date() + dt.timedelta(days=3)
        seen = []
        with mock.patch.object(mod.lib, "http_json", lambda url, params=None, **k: seen.append(url) or {"weekly-rota-array": []}):
            items, _s, errors = mod.build(mod.lib.zurich_time(f"{day.isoformat()}T12:00"))
        self.assertEqual(seen, [mod.ETH_ROTAS])  # UZH only publishes today's menu: not asked
        self.assertEqual(len(errors), 1)
        uzh = next(i for i in items if i["category"] == "uzh")
        self.assertIsNone(uzh["details"]["menus"])
        self.assertEqual(next(i for i in items if i["category"] == "eth")["details"]["date"], day.isoformat())

    def test_weather_sources(self):
        mod = load("weather")
        places = mod.lib.load_local(mod.__file__, "places.json")["places"]
        now = mod.lib.zurich_now()
        at = lambda days: now + dt.timedelta(days=days)  # noqa: E731
        self.assertEqual(mod.query(places, None)[0], mod.API)
        self.assertEqual(mod.query(places, at(-30))[0], mod.API)
        self.assertEqual(mod.query(places, at(10))[0], mod.API)
        self.assertEqual(mod.query(places, at(-200))[0], mod.ARCHIVE)
        with self.assertRaises(ValueError):
            mod.query(places, at(30))
        w = {"hourly": {"time": ["2026-10-20T13:00", "2026-10-20T14:00"], "temperature_2m": [9, 10], "weather_code": [3, 61]}}
        current, hourly = mod.at_hours(w, mod.lib.zurich_time("2026-10-20T14:30"))
        self.assertEqual((current["temperature_2m"], current["time"], hourly["time"]), (10, "2026-10-20T14:00", ["2026-10-20T14:00"]))


if __name__ == "__main__":
    unittest.main()
