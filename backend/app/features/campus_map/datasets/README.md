# Campus datasets

Everything a student at ETH needs besides rooms and libraries, one folder per dataset. Each folder has:

- `dataset.json`: title, description, pin glyph and color, how often to refresh (`ttlSeconds`), and whether it is on by default.
- a locations file (`locations.json`, `stops.json`, ...): where things are. Checked in, so the map shows them even when the live source is down.
- `fetch.py`: fetches the live part and prints one JSON document (`--out file` writes it instead). Python 3 stdlib only, shared helpers in `_common/datasetlib.py`.

| Folder | What | Live source | Refresh |
|---|---|---|---|
| `mensa/` | 13 ETH and 12 UZH mensas/cafeterias: today's menu with lines, prices per customer group, vegan/vegetarian tags, allergens; meal times | ETH Gastro API (`idapps.ethz.ch/cookpit-pub-services/v1/weeklyrotas`), ZFV food2050 GraphQL API (`app.food2050.ch/api/v2/graphql`) | 1 h |
| `transport/` | Tram, bus and train stops near Zentrum, Hönggerberg, Irchel and Oerlikon with the next departures and delays; ETH eLink shuttle stops | transport.opendata.ch stationboard | 1 min |
| `asvz/` | ASVZ sport centers (Polyterrasse, Hönggerberg, Fluntern, Irchel) with the next lessons and free places | ASVZ Sportfahrplan JSON (`asvz.ch/asvz_api/event_search`) | 15 min |
| `shared-mobility/` | Shared bikes, e-bikes and e-scooters available near the campuses, all providers | sharedmobility.ch (Swiss Federal Office of Energy) identify API | 2 min |
| `weather/` | Current weather and the next 12 hours per campus | Open-Meteo forecast API | 15 min |
| `amenities/` | Drinking water, toilets, microwaves, supermarkets, cafés, ATMs, pharmacies, post offices, copy shops, bookshops, defibrillators, bike repair stations | OpenStreetMap via the Overpass API (scraped once a day) | 1 day |

Every item has the same shape (`id`, `name`, `lat`, `lng`, `approximate`, `category`, `campus`, `subtitle`, `url`, `details`), so the map can draw any dataset; `details` holds the dataset's own data (menus, departures, lessons, ...). When a live source fails, the items are still there and the failure is listed in `errors`.

```bash
python3 backend/app/features/campus_map/datasets/mensa/fetch.py --out /tmp/mensa.json   # one dataset
cd backend && uv run --locked pytest tests/campus_map/test_fetchers.py                  # offline parser tests
```

The backend runs the fetchers in-process (`../dataset_cache.py`, served as `GET /api/v1/map/datasets/<id>`) and caches the results in `backend/.cache/campus-map/datasets/`. A new dataset only needs a folder with `dataset.json` and `fetch.py`; give it a details view in `frontend/src/campus-map/datasets/DatasetSidebar.tsx` if the generic one isn't enough.

## Other dates and times

`fetch.py --at 2026-10-20T14:00` (Zurich time) fetches the data for that time instead of now; the map asks for it with `GET /api/v1/map/datasets/<id>?at=...` when a time is picked, and the backend caches it in `backend/.cache/campus-map/datasets/at/<id>/`. Each `dataset.json` says under `time` how far its source supports this (`support`: `full`, `partial` or `live`; `resolution`: times that give the same data; `note`: shown on the map). Checked against the live APIs on 2026-10-10:

| Dataset | Other times | What works |
|---|---|---|
| `asvz/` | ✓ any time | `event_search?date=YYYY-MM-DD HH:MM` lists lessons from then on, past and future |
| `mensa/` | ◐ partly | ETH Gastro: past weeks and as far ahead as published (usually next week). **UZH: today only** (food2050 has other days via `calendar.day(date)`, not wired up yet) |
| `transport/` | ◐ partly | `stationboard?datetime=` gives the timetable from about a week back to the end of the timetable year (mid-December); **no delays** except around now |
| `weather/` | ◐ partly | Open-Meteo forecast API (`start_hour`/`end_hour`) from 92 days back to 16 days ahead, the archive API before that; **nothing beyond 16 days ahead** |
| `shared-mobility/` | ✕ now only | sharedmobility.ch has **no history and no forecast**: always shows now |
| `amenities/` | ✕ now only | Today's OpenStreetMap data, **no history** (positions hardly change) |

Outside the map's datasets: ETH room bookings (`../eth_rooms.py`) work for any day in ETH's booking window (about a year back and ahead); the UZH library seat occupancy is **live only**.

## Notes on the data

- **Positions.** The ETH mensas are assigned to their PolyMaps rooms in `mensa/rooms.json` (room as listed by the ETH Gastro facilities API, e.g. Mensa Polyterrasse MM B 79, food market HPR D 70.1). The fetcher takes position, floor and rooms from there, and the map tints those rooms on the floor plan. This is kept apart from the workspaces in `../map-data/overrides.json`. Some mensa rooms are also workspaces (study space outside meal times), and these are drawn as the workspace unless the mensa is selected. Mensas without a room (all UZH ones, and Mendokoro since HPI has no plans) are flagged `approximate` and drawn with a dashed border. Transport stops get their exact coordinates from the live API.
- **IDs.** ETH facility ids come from the open-source ETH/UZH mensa app ([famoser/Mensa](https://github.com/famoser/Mensa)). The ASVZ Polyterrasse/Fluntern facility ids come from [fbuetler/asvz-bot](https://github.com/fbuetler/asvz-bot). The UZH food2050 organisation paths, outlet slugs and menu categories are the ones in app.food2050.ch URLs (`/en/zfv/universitat-zurich`).
- **Not verified against the live APIs yet.** The parsers are written against the documented/observed response shapes and covered by fixture tests, but the cloud environment they were built in could not reach the APIs. Run each `fetch.py` once on a normal connection and check `errors`. The ASVZ field names are the least certain.
- **ASVZ.** Only reads the public schedule. Enrolling stays on schalter.asvz.ch; ASVZ's fair play rules forbid enrollment bots.

## More data worth adding

- **Course catalogue (VVZ)**: lecture times and rooms per course, combined with the room bookings already on the map.
- **ETH Library**: opening hours and the Library's developer portal APIs (needs an API key, [opendata.swiss entry](https://ckan.opendata.swiss/perma/eth_library_RIB@eth-bibliothek)).
- **ETH events / VSETH events**: talks, parties, career fairs.
- **ETH eLink timetable**: departures of the shuttle bus (currently only the stops and a link).
- **Print stations, microwave list, lockers, lost & found, student services desks**: ETH publishes these as web pages only; they would need a scraper.
