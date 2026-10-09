# occupancy-map-preview

A React + Leaflet preview of an ETH workspace occupancy map. Workspaces are libraries, study areas, group rooms, computer rooms, lounges or anything else with seats. One map, two modes:

- **View**: workspace pins (colored by free seats, filterable by type), and from zoom 18 on, tables and seats colored free / occupied / unknown.
- **Admin**: register workspaces, tables and seats by clicking on the map, edit their details, and drag any pin to fix its position. Edits save automatically to `data/occupancy.json`.
- **Rooms**: in Admin mode, "Select rooms" lets you click any PolyMaps rooms on the map (across floors), then add them to an existing workspace or create a new one of any type from them. A room belongs to one workspace only, so assigning it moves it out of its old one. Rooms can be removed from a workspace in its details.
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

## Architecture (built for moving into a bigger site)

```
src/domain/      types.ts, validate.ts, operations.ts: framework-free model + pure edit functions
src/data/        repository.ts: OccupancyRepository interface + HttpRepository
src/map/         Leaflet map, marker icons, Geoman-based outline editor, GeoJSON helpers
src/components/  View and Admin side panels
server/          jsonFileApi.ts: Vite middleware standing in for a backend
```

- The UI only reaches storage through `OccupancyRepository`. Today `HttpRepository` calls `GET/PUT /api/occupancy`. The Vite dev and preview servers answer those calls by reading and writing the JSON file, after validating the data with the same `validate.ts` the client uses.
- To use a real backend, implement the same two endpoints, or set `VITE_API_BASE` to point at one. Later you can swap in a finer-grained repository (for example `POST /libraries/:id/tables`, `PATCH /seats/:id` for live status) without touching components.
- The data is normalized: `libraries` (all workspaces; the name is kept for compatibility, `kind` says what each one is), then `tables.libraryId`, then `seats.tableId`. It maps directly onto database tables, and `operations.ts` holds the business rules (cascading deletes, moving a table moves its seats) for reuse server-side.

Not included yet: authentication for admin mode, live sensor or check-in data for seat status, and per-table floors (tables follow their library's floor).
