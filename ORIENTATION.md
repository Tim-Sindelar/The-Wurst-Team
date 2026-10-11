# Orientation for navigating and serving the repo locally

Description of the codebase and in depth guide on starting it locally from no cache.

## Project structure

```text
.
├── backend/                 FastAPI app, Alembic migrations, pytest suite
├── frontend/                React PWA (student app + /admin panel)
├── scraper/                 Scripts that build floor plans from ETH PolyMaps
├── deploy/                  Production / PR-preview Compose files, Caddy configs, deploy scripts
├── docs/                    Deployment documentation
├── .github/                 CI workflow, SSH deploy action, PR preview comment script
├── compose.yaml             Local stack: PostgreSQL + backend
└── Makefile                 Shortcuts for install, run, lint, test, seed, codegen
```

Request flow in development: browser → Vite dev server (`:5173`) → `/api` proxied → FastAPI (`:8000`) → PostgreSQL (`:5432`).

## Orientation

### `backend/`

| Path | Purpose |
| --- | --- |
| `app/main.py` | FastAPI app; mounts all routers under `/api/v1` |
| `app/config.py` | Settings (env / `backend/.env`): DB URL, CORS, auth mode, reservation timing rules, map paths |
| `app/auth.py` | using trusted `X-User-Id` header from the edu-ID login when not in debug mode |
| `app/database.py` | SQLAlchemy engine |
| `app/models/` | Shared models (profiles, favourites, recents); imports all models for Alembic |
| `app/features/reservations/` | Study spaces, seats, hours, closures, reservations, breaks, admin API, demo `seed.py` |
| `app/features/social/` | Friends, study groups, group booking |
| `app/features/events/` | In-memory SSE hub and `/events` stream |
| `app/features/campus_map/` | `/api/v1/map/*`: workspaces, style, navigation, ETH room bookings, room photos, floor plans |
| `app/features/campus_map/datasets/` | One folder per campus dataset, see below for list |
| `app/features/campus_map/map-data/` | Seed JSON for the map tables, imported into an empty DB on startup |
| `app/export_openapi.py` | Writes `backend/openapi.json` (used by frontend codegen) |
| `migrations/` | Alembic migrations |
| `tests/` | pytest suite, per feature |

### `frontend/`

| Path | Purpose |
| --- | --- |
| `src/screens/` | One file per student screen: Home, SeatMap, Reservation, Scan, Session, Profile, Map |
| `src/features/admin/` | Admin panel (`/admin`): spaces, seats, hours, closures, layout editor, users, QR codes |
| `src/features/social/` | Friends, requests, study groups, group seat booking |
| `src/campus-map/` | Campus map screen (`/map`) |
| `src/components/` | Shared UI building blocks (Screen, DecisionSheet, TimerCard, seat map, …) |
| `src/domain/` | Framework-free domain logic and per-state lookups |
| `src/hooks/` | Data and clock hooks (`useMyReservation`, `useServerEvents`, `useQrScanner`, …) |
| `src/api/generated/` | Generated API client. Do not edit; run `make generate` |
| `src/theme/`, `src/styles.css` | Mantine theme, `ui-*` component classes, design tokens |
| `pwa/`, `public/` | Service worker, manifest, icons |
| `tests/` | Unit tests for pure logic (`npm test`) |

### Other directories

| Path | Purpose |
| --- | --- |
| `scraper/` | `scrape_polymaps.py` downloads the raw ETH PolyMaps layers to `scraper/polymaps_data/`. `extract_floors.py` and `build_library_outlines.py` write floor plans to `scraper/floors/`. Without `--floors-only`, `extract_floors.py` also rewrites `backend/app/features/campus_map/map-data/generated.json`. Both output folders are git-ignored |
| `deploy/` | `compose.yaml` and `Caddyfile` for each environment, plus the shared gateway, `deploy.sh`, `smoke.sh` and preview cleanup |
| `docs/` | `deployment.md`: VM, Caddy gateway, GitHub configuration, PR previews |

### Significant branches

| Branch | Status | Purpose |
| --- | --- | --- |
| `main` | Deployed | Complete app. GitHub Actions deploys it to https://02.hackathon.ethz.ch and gives each PR its own preview under `/pr/<n>/` |
| `ar` | Experimental, no PR | `polymaps-ar/`: AR indoor navigator (web app plus an Android shell). Positions by matching ETH's PolyMaps iBeacons against the PolyMaps IPS radio map. Routes with A* across floors and buildings. Corrects position and heading with two computer-vision pipelines: a VPS that matches on-device SuperPoint features against LaMAR maps of HG E and CAB, and plan matching that compares ARCore depth with the floor plan (local only). |
| `codex/pitch-demo` | Pitch only, no PR | `pitch/`: Three.js animated pitch with an embedded phone that runs the live app (needs the app on `localhost:5173`), plus closing slides. Script in `docs/pitch-*.md` |
| `copilot/market-research-differentiating-factors` | Open PR #10 | Market research document only (`research/`), no code |

## External public APIs

None of these need an API key. Backend calls go out from the server; the browser never calls ETH or UZH directly, because those APIs send no CORS headers.

| API | Called by | Used for |
| --- | --- | --- |
| ETH PolyMaps / ArcGIS Indoors (`arcgis-prd-web.ethz.ch/portal/sharing/rest/content/items`) | `scraper/scrape_polymaps.py` (backend Docker build, `make map-floors`) | Raw building, floor and room geometry used to make the floor plans |
| ETH Room Info API (`ethz.ch/bin/ethz/roominfo?path=…`, undocumented) | `campus_map/eth_rooms.py` | Room list, types, buildings, bookings per room (`/rooms/<id>/allocations`), room details and photos (`/v2/rooms`, `/v2/files`). Live rooms, room sheets and the photos on space cards |
| UZH library occupancy (`www.ub.uzh.ch/en/ub-besuchen/belegung-alle.html`, `hbzwwws04.uzh.ch/occusense/…`) | `campus_map/eth_rooms.py` | Live seat occupancy of nearby UZH libraries (`/api/v1/map/eth/uzh`) |
| ETH Gastro "cookpit" (`idapps.ethz.ch/cookpit-pub-services/v1/weeklyrotas`, `/facilities`) | `datasets/mensa/fetch.py` | ETH mensa menus and opening hours |
| food2050 GraphQL (`app.food2050.ch/api/v2/graphql`) | `datasets/mensa/fetch.py` | UZH mensa menus |
| ASVZ (`asvz.ch/asvz_api/event_search`) | `datasets/asvz/fetch.py` | Sports lessons at the ASVZ facilities |
| transport.opendata.ch (`/v1/stationboard`) | `datasets/transport/fetch.py` | Departures at campus public-transport stops - not used in final demo |
| sharedmobility.ch (`api.sharedmobility.ch/v1/sharedmobility/identify`) | `datasets/shared-mobility/fetch.py` | Nearby shared bikes and scooters - not used in final demo |
| Open-Meteo (`api.open-meteo.com/v1/forecast`, `archive-api.open-meteo.com/v1/archive`) | `datasets/weather/fetch.py` | Weather per campus (forecast and past data) - not used in final demo |
| Overpass / OpenStreetMap (`overpass-api.de/api/interpreter`, fallback `overpass.kumi.systems`) | `datasets/amenities/fetch.py` | Water, toilets, microwaves, ATMs, defibrillators, etc. - not used in final demo |
| OpenFreeMap (`tiles.openfreemap.org/styles/…`) | Browser (`frontend/src/campus-map/map/VectorBasemap.tsx`) | Vector base map tiles |

Backend responses are cached in `MAP_CACHE_DIR`. ETH bookings are refreshed at most hourly; each dataset is refreshed after the `ttlSeconds` set in its `dataset.json`. The student app only requests the `mensa` and `asvz` datasets (in **Campus** map mode). The other datasets can only be reached through `/api/v1/map/datasets/<id>`.

## Running locally from a clean checkout

Use these steps when nothing is cached yet: no Docker images or volumes, no `node_modules`, no `.venv`, no generated floor plans.

### Prerequisites

- Docker with Compose v2
- Node.js ≥ 22.22
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (installs Python 3.12 automatically)
- Make (optional; the equivalent commands are shown below)

### 1. Install dependencies

```sh
uv sync --locked --project backend
npm ci --prefix frontend
```

(`make install`)

### 2. Start PostgreSQL and the backend

```sh
docker compose up --build -d --wait
```

(`make backend`)

On the first run this:

1. Builds the backend image. A separate build stage downloads the ETH PolyMaps geometry (~400 MB, several minutes) and generates floor plans into `/app/floors`. Only the generated files end up in the image.
2. Creates the `postgres_data` and `map_cache` volumes.
3. Runs `alembic upgrade head`, then `python -m app.features.campus_map.importer --if-empty`, which imports `map-data/*.json` into the empty database.
4. Starts uvicorn with `--reload` on `127.0.0.1:8000`. `backend/app` is bind-mounted, so code changes reload automatically.

The `map_cache` volume starts empty. ETH room bookings and campus datasets are fetched on first request, so the first map load can be slow.

### 3. (Optional) Seed demo study spaces

A fresh database has no bookable spaces. To create two demo rooms with four seats each:

```sh
docker compose exec -T backend python -m app.features.reservations.seed
```

(`make seed`). This prints the seat IDs and QR tokens.

### 4. Start the frontend

```sh
npm run dev --prefix frontend
```

(`make frontend`)

- App: http://localhost:5173
- Admin panel: http://localhost:5173/admin (the dev server sends `X-Demo-Admin: true`)
- API docs: http://localhost:8000/docs

The local stack runs with `AUTH_MODE=demo`, so no login is needed. The social backend is off by default (`SOCIAL_ENABLED=false`), so **Friends** shows an error. To enable it, create `backend/.env` with `SOCIAL_ENABLED=true` and run step 2 again.

### Force a fully cold rebuild

```sh
docker compose down -v
docker compose build --no-cache backend
docker compose up -d --wait
```

`down -v` deletes the database and map-cache volumes. `--no-cache` downloads the PolyMaps geometry again.

### Backend without Docker (alternative to step 2)

Outside Docker, the floor plans are not generated for you:

```sh
docker compose up -d db
cp backend/.env.example backend/.env
python scraper/scrape_polymaps.py scraper/polymaps_data
python scraper/extract_floors.py --floors-only
python scraper/build_library_outlines.py
cd backend
uv run --locked alembic upgrade head
uv run --locked python -m app.features.campus_map.importer --if-empty
uv run --locked uvicorn app.main:app --reload
```

The three scraper commands are what `make map-floors` runs. Floor plans are read from `scraper/floors` (override with `MAP_FLOORS_DIR`). The cache is written to `backend/.cache/campus-map` (override with `MAP_CACHE_DIR`).

## Common commands

| Command | Does |
| --- | --- |
| `make generate` | Export `backend/openapi.json` and regenerate `frontend/src/api/generated/` (no running backend needed) |
| `make lint` / `make format` | Ruff, ESLint, Prettier, `tsc` |
| `make test` | pytest inside the running backend container |
| `npm test --prefix frontend` | Frontend unit tests |
| `make build` | Production frontend build to `frontend/dist/` |
| `docker compose down` | Stop the stack (keeps volumes) |
