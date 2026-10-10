# Bikes & scooters

Shared bikes, e-bikes and e-scooters available near the campuses right now (sharedmobility.ch).

- Locations: `areas.json`
- Refreshed every 2 min by the map server (off by default).

## Source

```
Shared bikes, e-bikes and e-scooters near the campuses.

Source: Swiss Federal Office of Energy, sharedmobility.ch (open data, all
providers in one API; see github.com/SFOE/sharedmobility):
    https://api.sharedmobility.ch/v1/sharedmobility/identify?Geometry=<lng>,<lat>&Tolerance=<m>&offset=<n>&geometryFormat=esrijson
    -> results[] {id, geometry {x: lng, y: lat}, attributes {provider_id,
       vehicle_type, pickup_type, station_name, available, ...}}

    python datasets/shared-mobility/fetch.py [--out file.json]
```

See [../README.md](../README.md) for the document format.
