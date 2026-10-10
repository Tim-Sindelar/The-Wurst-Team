# Campus datasets

Everything a student at ETH needs besides rooms and libraries, one folder per dataset. Each folder has:

- `dataset.json`: title, description, pin glyph and color, how often to refresh (`ttlSeconds`), and whether it is on by default.
- a locations file (`locations.json`, `stops.json`, ...): where things are. Checked in, so the map shows them even when the live source is down.
- `fetch.py`: fetches the live part and prints one JSON document (`--out file` writes it instead). Python 3 stdlib only, shared helpers in `_common/datasetlib.py`.

| Folder | What | Live source | Refresh |
|---|---|---|---|
| `mensa/` | 13 ETH and 12 UZH mensas/cafeterias: today's menu with lines, prices per customer group, vegan/vegetarian tags, allergens; meal times | ETH Gastro API (`idapps.ethz.ch/cookpit-pub-services/v1/weeklyrotas`), ZFV food2050 GraphQL API (`api.app.food2050.ch`) | 1 h |
| `transport/` | Tram, bus and train stops near Zentrum, Hönggerberg, Irchel and Oerlikon with the next departures and delays; ETH eLink shuttle stops | transport.opendata.ch stationboard | 1 min |
| `asvz/` | ASVZ sport centers (Polyterrasse, Hönggerberg, Fluntern, Irchel) with the next lessons and free places | ASVZ Sportfahrplan JSON (`asvz.ch/asvz_api/event_search`) | 15 min |
| `shared-mobility/` | Shared bikes, e-bikes and e-scooters available near the campuses, all providers | sharedmobility.ch (Swiss Federal Office of Energy) identify API | 2 min |
| `weather/` | Current weather and the next 12 hours per campus | Open-Meteo forecast API | 15 min |
| `amenities/` | Drinking water, toilets, microwaves, supermarkets, cafés, ATMs, pharmacies, post offices, copy shops, bookshops, defibrillators, bike repair stations | OpenStreetMap via the Overpass API (scraped once a day) | 1 day |

Every item has the same shape (`id`, `name`, `lat`, `lng`, `approximate`, `category`, `campus`, `subtitle`, `url`, `details`), so the map can draw any dataset; `details` holds the dataset's own data (menus, departures, lessons, ...). When a live source fails, the items are still there and the failure is listed in `errors`.

```bash
python3 datasets/mensa/fetch.py --out /tmp/mensa.json   # one dataset
python3 datasets/test_fetchers.py                       # offline parser tests
```

The map (`occupancy-map-preview`) runs the fetchers on demand through `server/datasetsApi.ts` and caches the results in `occupancy-map-preview/data/cache/datasets/`. A new dataset only needs a folder with `dataset.json` and `fetch.py`; give it a details view in `src/datasets/DatasetSidebar.tsx` if the generic one isn't enough.

## Notes on the data

- **Positions.** Mensa positions are building-level, taken from the PolyMaps building positions in `occupancy-map-preview/data/generated.json` where the building is known (e.g. Clausiusbar CLA D 5, Archimedes GLC E 16, Alumni quattro Lounge HIL D 57.2, food market HPH). Where the building is unconfirmed (UZH locations, Rice Up!, Tannenbar, ...), the item is flagged `approximate` and drawn with a dashed border. Transport stops get their exact coordinates from the live API.
- **IDs.** ETH facility ids and UZH food2050 location ids/kitchen slugs come from the open-source ETH/UZH mensa app ([famoser/Mensa](https://github.com/famoser/Mensa)). The ASVZ Polyterrasse/Fluntern facility ids come from [fbuetler/asvz-bot](https://github.com/fbuetler/asvz-bot).
- **Not verified against the live APIs yet.** The parsers are written against the documented/observed response shapes and covered by fixture tests, but the cloud environment they were built in could not reach the APIs. Run each `fetch.py` once on a normal connection and check `errors`. The ASVZ field names are the least certain.
- **ASVZ.** Only reads the public schedule. Enrolling stays on schalter.asvz.ch; ASVZ's fair play rules forbid enrollment bots.

## More data worth adding

- **Course catalogue (VVZ)**: lecture times and rooms per course, combined with the room bookings already on the map.
- **ETH Library**: opening hours and the Library's developer portal APIs (needs an API key, [opendata.swiss entry](https://ckan.opendata.swiss/perma/eth_library_RIB@eth-bibliothek)).
- **ETH events / VSETH events**: talks, parties, career fairs.
- **ETH eLink timetable**: departures of the shuttle bus (currently only the stops and a link).
- **Print stations, microwave list, lockers, lost & found, student services desks**: ETH publishes these as web pages only; they would need a scraper.
