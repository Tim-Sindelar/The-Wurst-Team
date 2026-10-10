# occupancy-map-preview

> The main app shows this map at `/map` in `frontend/` (view mode only, made for phones). This preview stays the developer tool for it: edit workspaces and navigation in Admin mode and the look in the Style panel ("Save as standard"), then copy the result over with `npm run map:sync --prefix frontend`.

A React + Leaflet preview of an ETH workspace occupancy map. Workspaces are libraries, study areas, group rooms, computer rooms, lounges or anything else with seats. One map, two modes:

- **View**: workspace pins (colored by free seats, filterable by type), and from zoom 18 on, tables and seats colored free / occupied / unknown.
- **Admin**: register workspaces, tables and seats by clicking on the map, edit their details, and drag any pin to fix its position. Edits save automatically to `data/occupancy.json`.
- **Rooms**: in Admin mode, "Select rooms" lets you click any PolyMaps rooms on the map (across floors), then add them to an existing workspace or create a new one of any type from them. A room belongs to one workspace only, so assigning it moves it out of its old one. Rooms can be removed from a workspace in its details.
- **Quick navigation**: the map starts framing both campuses (all workspaces, enabled or not, near Zentrum and Hönggerberg). Clicking inside an area (e.g. a campus) or a building zooms there, but only while the map's zoom is in that zone's range: areas while zoomed out further than a set level, buildings between two levels. Buildings win over areas, and the ⌂ button flies back to the start view. In Admin mode, "Quick navigation" edits the zones: click polygon (drawn on the map, or copied from a building footprint), target zoom and active zoom range. Stored in `data/navigation.json`; until that exists, one area per campus is derived from the workspaces. Normal panning and zooming are unaffected.
- **Live rooms**: the "Live rooms" switch on the map colors the ETH lecture and seminar rooms by today's bookings (free, booked soon, in use, building closed, no data). Under "Rooms ▾" each part can be switched on or off: occupancy colors, room labels (number and seats, from zoom 19), room details on click (photos, today's schedule, equipment, the full ETH room sheet and attachments), a list of free rooms (longest free first, click to fly there), a time slider through the day shown, and the live seat occupancy of the nearby UZH libraries. The status colors, fill and outline are set in the Style panel like the other map colors (per theme, savable as the standard). See "Live room data" below.
- **Campus data**: "Campus data ▾" on the map switches on the datasets in `../datasets`: mensas with today's menus, public transport stops with live departures and the eLink shuttle, ASVZ lessons, shared bikes and scooters, weather per campus, and everyday amenities from OpenStreetMap (water, toilets, microwaves, supermarkets, ATMs, defibrillators, ...). Each shows as its own pins; clicking a pin or a list entry in the side panel shows its details. The dev server runs `datasets/<name>/fetch.py` (`$PYTHON`, default `python3`) when the cached result in `data/cache/datasets/` is older than the dataset's refresh interval. See `../datasets/README.md`.
- **Any date and time**: "🕒 Now ▾" on the map picks a date and time (Zurich) for the live rooms and the campus data; "Now" goes back to following the clock. Its panel lists every source with how far it supports that (✓ any time, ◐ partly, ✕ now only, from `time` in each `dataset.json`). Sources that can only show now (UZH library seats, shared bikes and scooters, amenities) keep showing now and are flagged "now only" in the side panel, the pin tooltips and the Campus data panel; partial ones are flagged "partly" with what is missing.
- **Library outlines**: in Admin mode, draw and edit each library's floor outline directly on the map (polygons, rectangles, holes, several wings). It's stored as a GeoJSON MultiPolygon in `outline`, so it stays aligned with the map and the tables/seats at every zoom level and can go straight into a spatial database (e.g. PostGIS) later.

```bash
npm install
npm run dev
```

## Data

Floor plans and library locations come from ETH PolyMaps (ArcGIS Indoors):

```bash
python scraper/scrape_polymaps.py scraper/polymaps_data   # ~400 MB of raw layers
python scraper/extract_floors.py                          # builds the files below
```

- `public/floors/index.json`: building footprints, the outline of every level, and the list of floors (PolyMaps vertical order, 0 = ground floor).
- `public/floors/levels/<LEVEL_ID>.json`: rooms (colored by use) plus wall, door and stair lines for one level. The map loads these on demand for the levels in view from zoom 18 on (walls from 19).
- `data/occupancy.json`: workspaces keep the rooms already stored in the file (whatever their type, so assignments made in admin mode survive). `Bibliothek` rooms that no workspace has yet go to the curated libraries through `LIBRARY_ROOMS` in the script, or are grouped by building and adjacency into extra libraries. Each library stores `floor`, `levelId` and `rooms`. Pins sit on the PolyMaps label point, or on the main room. Re-running the script keeps edits made in admin mode, and tables and seats. Note that a `Bibliothek` room removed from every workspace is grouped into a new library again on the next run. Libraries PolyMaps doesn't cover (AfZ, HDB, Selbstlernzentrum, gta) are kept unchanged, with `floor: null`, and show on every floor.

The floor picker on the right switches floors. Library pins on other floors are dimmed and show their floor. Clicking a highlighted library room selects that library.

Base layers: OpenStreetMap, swisstopo map, and swisstopo aerial imagery (up to zoom 20). The map zooms to 22 for placing seats.

## Live room data

Bookings come from the ETH Room Info API through `eth_room_dashboard.py` (it has no CORS headers, so the browser can't call it directly):

- The dev server forwards `/api/eth/*` to the script (`ETH_ROOMS_URL`, default `http://127.0.0.1:8765`) and starts it with `python3` (`python` on Windows, or `$PYTHON`) on the first request if it isn't running. Set `ETH_ROOMS_AUTOSTART=0` to run it yourself (`python eth_room_dashboard.py --no-browser`).
- The script keeps all rooms with today's bookings in `data/cache/eth-rooms.json` with the time they were fetched (`fetchedAt`), and asks ETH again only when that is an hour old or from another day; a failed fetch is retried after 5 minutes, and the last good data is kept meanwhile. Every fetch is logged with its timestamp to `data/cache/eth-rooms.log`. `python eth_room_dashboard.py --snapshot` refreshes the file the same way and exits (e.g. for cron).
- Another day (`/api/eth/rooms?date=YYYY-MM-DD`, picked with 🕒) is fetched the same way into `data/cache/eth-rooms-days/<date>.json`: past days once, today and later days hourly. ETH has bookings for about a year back and ahead (`/min-max-allocation-date`); other dates answer with an error naming that window.
- ETH rooms are put on the floor plans by their room number: the dev server looks up each ETH id (`HG E 7`) among the PolyMaps room names, then the names derived from the unit ids (`ETH.HG.E.E_007`), then the display labels, ignoring case, spacing and zero padding. "Rooms ▾" shows how many were found and lists the rest.
- Statuses are computed in the browser from the bookings, in Zurich time, so they stay current between fetches. They are bookings, not sensors: a free room may still be in use.

## Architecture (built for moving into a bigger site)

```
src/domain/      types.ts, validate.ts, operations.ts: framework-free model + pure edit functions
src/data/        repository.ts: OccupancyRepository interface + HttpRepository
src/map/         Leaflet map, marker icons, Geoman-based outline editor, GeoJSON helpers
src/components/  View and Admin side panels
src/datasets/    campus datasets: types, polling hook, map pins, side panel details, layer switches
server/          jsonFileApi.ts: Vite middleware standing in for a backend; ethRoomsApi.ts: live room data proxy + matching; datasetsApi.ts: runs and caches the dataset fetchers
```

- The UI only reaches storage through `OccupancyRepository`. Today `HttpRepository` calls `GET/PUT /api/occupancy`. The Vite dev and preview servers answer those calls by reading and writing the JSON file, after validating the data with the same `validate.ts` the client uses.
- To use a real backend, implement the same two endpoints, or set `VITE_API_BASE` to point at one. Later you can swap in a finer-grained repository (for example `POST /libraries/:id/tables`, `PATCH /seats/:id` for live status) without touching components.
- The data is normalized: `libraries` (all workspaces; the name is kept for compatibility, `kind` says what each one is), then `tables.libraryId`, then `seats.tableId`. It maps directly onto database tables, and `operations.ts` holds the business rules (cascading deletes, moving a table moves its seats) for reuse server-side.

Not included yet: authentication for admin mode, live sensor or check-in data for seat status, and per-table floors (tables follow their library's floor).
