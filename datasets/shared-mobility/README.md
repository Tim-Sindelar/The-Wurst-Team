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
        &filters=ch.bfe.sharedmobility.vehicle_type=<type>
    -> results[] {id, geometry {x: lng, y: lat}, attributes {provider_id,
       vehicle_type, pickup_type, station_name, available, ...}}
One query per vehicle type: as of 2026-10 the API answers 500 to any query that
matches a vehicle of type "Other" (so also to unfiltered ones), and the filter
takes a single value only.

    python datasets/shared-mobility/fetch.py [--out file.json]
```

See [../README.md](../README.md) for the document format.
