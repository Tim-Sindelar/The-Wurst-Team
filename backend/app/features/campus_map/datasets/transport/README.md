# Public transport

Stops near the campuses with live departures (tram, bus, train) and the ETH eLink shuttle.

- Locations: `stops.json`
- Refreshed every 1 min by the map server (on by default).

## Source

```
Live departures at the stops near the campuses.

Source: transport.opendata.ch (Swiss public transport API, no key):
    https://transport.opendata.ch/v1/stationboard?station=<name>&limit=<n>
    -> station.coordinate {x: lat, y: lng}, stationboard[] {category, number,
       to, stop {departure, delay, platform, prognosis}}

    python datasets/transport/fetch.py [--out file.json]
```

See [../README.md](../README.md) for the document format.
