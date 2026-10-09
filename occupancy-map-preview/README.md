# occupancy-map-preview

A React + Leaflet preview of an ETH library occupancy map. One map, two modes:

- **View**: library pins (colored by free seats), and from zoom 18 on, tables and seats colored free / occupied / unknown.
- **Admin**: register libraries, tables and seats by clicking on the map, edit their details, and drag any pin to fix its position. Edits save automatically to `data/occupancy.json`.
- **Library outlines**: in Admin mode, draw and edit each library's floor outline directly on the map (polygons, rectangles, holes, several wings). It's stored as a GeoJSON MultiPolygon in `outline`, so it stays aligned with the map and the tables/seats at every zoom level and can go straight into a spatial database (e.g. PostGIS) later.

```bash
npm install
npm run dev
```

## Data

`data/occupancy.json` holds everything. It starts with the 13 publicly listed ETH library locations and no tables or seats. Addresses were geocoded with the swisstopo search API.
Pins flagged `positionApproximate` are best guesses, for one of two reasons:
- The library is a room inside the main building (HG), so the pin can't be placed exactly.
- The source publishes no address (Selbstlernzentrum, gta Bibliothek).

Admin mode shows these pins with a dashed border. Drag a pin to the right spot, then untick the flag.

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
- The data is normalized: `libraries`, then `tables.libraryId`, then `seats.tableId`. It maps directly onto database tables, and `operations.ts` holds the business rules (cascading deletes, moving a table moves its seats) for reuse server-side.

Not included yet: authentication for admin mode, live sensor or check-in data for seat status, and floor levels.
