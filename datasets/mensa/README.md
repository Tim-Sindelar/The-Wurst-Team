# Mensas & cafeterias

ETH and UZH mensas with today's menus, prices and opening hours.

- Locations: `locations.json`
- Rooms of the ETH mensas (PolyMaps unit ids, floor, position): `rooms.json`
- Refreshed every 60 min by the map server (on by default).

## Source

```
Today's menus of the ETH and UZH mensas.

ETH:  ETH Gastro API (Cookpit), the one ethz.ch's menu pages use:
      https://idapps.ethz.ch/cookpit-pub-services/v1/weeklyrotas?client-id=ethz-wcms&lang=en&rs-first=0&rs-size=50&valid-after=<monday>
      -> weekly-rota-array[] (facility-id, valid-from/-to, day-of-week-array[] ->
         opening-hour-array[] -> meal-time-array[] -> line-array[] -> meal)
UZH:  ZFV food2050 GraphQL API (https://app.food2050.ch/api/v2/graphql), tenant "zfv":
      organisation(path) -> outlet(slug) -> menuCategory(path) -> calendar.day(date)
      -> menuItems[] (category, prices[] -> priceCategory, dish).

    python datasets/mensa/fetch.py [--out file.json]
```

See [../README.md](../README.md) for the document format.
