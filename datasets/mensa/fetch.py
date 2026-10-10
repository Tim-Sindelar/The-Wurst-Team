#!/usr/bin/env python3
"""Menus of the ETH and UZH mensas, today's or (--at) another day's.

ETH:  ETH Gastro API (Cookpit), the one ethz.ch's menu pages use:
      https://idapps.ethz.ch/cookpit-pub-services/v1/weeklyrotas?client-id=ethz-wcms&lang=en&rs-first=0&rs-size=50&valid-after=<monday>
      -> weekly-rota-array[] (facility-id, valid-from/-to, day-of-week-array[] ->
         opening-hour-array[] -> meal-time-array[] -> line-array[] -> meal)
UZH:  ZFV food2050 GraphQL API, location(id) -> kitchens[slug] -> todayOffer.
      Today only: other days have no UZH menus.

    python datasets/mensa/fetch.py [--out file.json] [--at 2026-10-20T12:00]
"""

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_common"))
import datasetlib as lib  # noqa: E402

ETH_ROTAS = "https://idapps.ethz.ch/cookpit-pub-services/v1/weeklyrotas"
ETH_FACILITIES = "https://idapps.ethz.ch/cookpit-pub-services/v1/facilities"
UZH_API = "https://api.app.food2050.ch/"
UZH_QUERY = (
    "query ExampleQuery($locationId: String!) { location(id: $locationId) { "
    "kitchens { slug, todayOffer { digitalMenuItems { displayName recipeSelectorConfig recipe { "
    "title(returnAll: true) prices { amount category { title } } allergensList } } } } } }"
)


def eth_meals(rotas, facility_id, today):
    """Meal times with their lines/meals for one facility today."""
    code = today.isoweekday()  # 1 = Monday ... 7 = Sunday
    out = []
    hours = []
    for rota in rotas:
        if rota.get("facility-id") != facility_id:
            continue
        start, end = rota.get("valid-from"), rota.get("valid-to")
        if start and start > today.isoformat():
            continue
        if end and end < today.isoformat():
            continue
        for day in rota.get("day-of-week-array") or []:
            if day.get("day-of-week-code") != code:
                continue
            for oh in day.get("opening-hour-array") or []:
                hours.append({"from": oh.get("time-from"), "to": oh.get("time-to")})
                for mt in oh.get("meal-time-array") or []:
                    meals = []
                    for line in mt.get("line-array") or []:
                        meal = line.get("meal") or {}
                        if not meal:
                            continue
                        meals.append({
                            "line": line.get("name"),
                            "name": (meal.get("name") or "").strip(),
                            "description": " ".join((meal.get("description") or "").split()),
                            "prices": [
                                {"group": p.get("customer-group-desc-short") or p.get("customer-group-desc"), "price": p.get("price")}
                                for p in sorted(meal.get("meal-price-array") or [], key=lambda p: p.get("customer-group-position") or 0)
                            ],
                            "tags": [c.get("desc-short") or c.get("desc") for c in meal.get("meal-class-array") or []],
                            "allergens": [a.get("desc-short") or a.get("desc") for a in meal.get("allergen-array") or []],
                        })
                    out.append({"name": mt.get("name"), "from": mt.get("time-from"), "to": mt.get("time-to"), "meals": meals})
    return out, hours


def uzh_meals(location_data, kitchen, lang="en"):
    loc = (location_data or {}).get("data", {}).get("location") or {}
    k = next((k for k in loc.get("kitchens") or [] if k.get("slug") == kitchen["slug"]), None)
    if not k:
        return None
    meals = []
    offers = k.get("todayOffer") or []
    if isinstance(offers, dict):
        offers = [offers]
    selector = kitchen.get("recipeSelector")
    for offer in offers:
        for item in offer.get("digitalMenuItems") or []:
            cfg = item.get("recipeSelectorConfig") or {}
            cfg_name = cfg.get("name") if isinstance(cfg, dict) else str(cfg)
            if selector and selector not in (cfg_name or ""):
                continue
            recipe = item.get("recipe") or {}
            title = recipe.get("title") or {}
            if isinstance(title, dict):
                title = title.get(lang) or title.get("de") or ""
            meals.append({
                "line": item.get("displayName"),
                "name": " ".join(str(title).split()),
                "description": "",
                "prices": [
                    {"group": ((p.get("category") or {}).get("title")), "price": p.get("amount")}
                    for p in sorted(recipe.get("prices") or [], key=lambda p: float(p.get("amount") or 0))
                ],
                "tags": [],
                "allergens": [a for a in (recipe.get("allergensList") or []) if isinstance(a, str)],
            })
    return meals


def build(at=None):
    conf = lib.load_local(__file__, "locations.json")["locations"]
    rooms = lib.load_local(__file__, "rooms.json")["mensas"]
    real_today = lib.zurich_now().date()
    today = at.date() if at else real_today
    monday = today - dt.timedelta(days=today.weekday())
    errors, sources = [], [ETH_ROTAS, UZH_API]

    rotas = None
    try:
        rotas = lib.http_json(ETH_ROTAS, {"client-id": "ethz-wcms", "lang": "en", "rs-first": 0, "rs-size": 200,
                                         "valid-after": monday.isoformat()}).get("weekly-rota-array") or []
    except Exception as err:
        errors.append(lib.error_text("ETH menus", err))

    uzh_cache = {}
    items = []
    for loc in conf:
        place = rooms.get(loc["id"])
        details = {"provider": loc["provider"], "building": loc.get("building"), "date": today.isoformat(),
                   "mealTimes": loc.get("mealTimes", []), "menus": None, "hours": None, "place": room_place(place)}
        if loc["provider"] == "eth" and rotas is not None:
            menus, hours = [], []
            for fid in loc["facilityIds"]:
                m, h = eth_meals(rotas, fid, today)
                menus += m
                hours += h
            details["menus"] = merge_meal_times(menus)
            details["hours"] = hours
        elif loc["provider"] == "uzh" and today != real_today:
            if "uzh-day" not in uzh_cache:
                uzh_cache["uzh-day"] = None
                errors.append(f"UZH menus: only today's menu is published, not {today.isoformat()}'s")
        elif loc["provider"] == "uzh":
            lid = loc["locationId"]
            if lid not in uzh_cache:
                try:
                    uzh_cache[lid] = lib.http_json(UZH_API, body={"query": UZH_QUERY, "variables": {"locationId": lid},
                                                                  "operationName": "ExampleQuery"})
                except Exception as err:
                    uzh_cache[lid] = None
                    errors.append(lib.error_text(f"UZH menus ({loc['name']})", err))
            if uzh_cache[lid] is not None:
                menus = []
                for kitchen in loc["kitchens"]:
                    meals = uzh_meals(uzh_cache[lid], kitchen)
                    if meals is not None:
                        menus.append({"name": kitchen.get("label"), "from": None, "to": None, "meals": meals})
                details["menus"] = menus
        items.append({
            "id": loc["id"],
            "name": loc["name"],
            "lat": place["position"]["lat"] if place else loc["lat"],
            "lng": place["position"]["lng"] if place else loc["lng"],
            "approximate": False if place else loc.get("approximate", False),
            "category": loc["provider"],
            "campus": loc.get("campus"),
            "subtitle": " · ".join(x for x in [place["room"] if place else loc.get("building"), ", ".join(f"{t['from']}–{t['to']}" for t in loc.get("mealTimes", []))] if x),
            "url": loc.get("url"),
            "details": details,
        })
    return items, sources, errors


def room_place(place):
    """The mensa's rooms from rooms.json (handled apart from the workspaces), or None."""
    if not place:
        return None
    return {k: place[k] for k in ("room", "facilityId", "levelId", "floor", "rooms", "levels")}


def merge_meal_times(menus):
    """food market has three facilities with one lunch each: show them as one lunch."""
    merged = {}
    for m in menus:
        key = (m["name"], m["from"], m["to"])
        if key in merged:
            merged[key]["meals"] += m["meals"]
        else:
            merged[key] = {**m, "meals": list(m["meals"])}
    return list(merged.values())


if __name__ == "__main__":
    lib.main("mensa", build)
