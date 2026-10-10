# ASVZ sport

ASVZ sport centers with the next lessons (sport, time, free places).

- Locations: `facilities.json`
- Refreshed every 15 min by the map server (off by default).

## Source

```
Next ASVZ lessons per sport center.

Source: the JSON search behind asvz.ch's Sportfahrplan:
    https://asvz.ch/asvz_api/event_search?_format=json&limit=<n>[&f[0]=facility:<id>]
    -> results[] {title, sport_name, facility_name, from_date, to_date, url, ...}
Field names vary a little between ASVZ releases, so the parsing is lenient.

    python datasets/asvz/fetch.py [--out file.json]
```

See [../README.md](../README.md) for the document format.
