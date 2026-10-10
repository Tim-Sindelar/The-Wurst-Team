# Everyday amenities

Water fountains, toilets, supermarkets, ATMs, pharmacies, post offices, copy shops, microwaves, defibrillators and more around the campuses (OpenStreetMap).

- Locations: `categories.json`
- Refreshed every 1440 min by the map server (off by default).

## Source

```
Everyday amenities around the campuses, scraped from OpenStreetMap.

Source: Overpass API (OpenStreetMap, ODbL):
    POST https://overpass-api.de/api/interpreter  data=<query>
One query covers every category and area; ways are reduced to their center.

    python datasets/amenities/fetch.py [--out file.json]
```

See [../README.md](../README.md) for the document format.
