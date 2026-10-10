# Weather

Current weather and the next hours at each campus (Open-Meteo).

- Locations: `places.json`
- Refreshed every 15 min by the map server (on by default).

## Source

```
Weather now and for the next hours at the campuses.

Source: Open-Meteo (free, no key):
    https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=..&hourly=..&timezone=Europe/Zurich

    python datasets/weather/fetch.py [--out file.json]
```

See [../README.md](../README.md) for the document format.
