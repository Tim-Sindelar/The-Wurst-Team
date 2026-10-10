# The Wurst Team

Web app starter with separate `frontend/` and `backend/` projects.

- **Frontend:** React, Vite, TypeScript, React Router, TanStack Query, Mantine, Tailwind CSS, ESLint, Prettier.
- **Backend:** Python 3.12, FastAPI, Pydantic, SQLAlchemy, Alembic, Ruff.
- **Local database:** PostgreSQL 17 in Docker Compose.
- **API client:** Hey API generates TypeScript models, fetch functions, and TanStack Query helpers directly from FastAPI's OpenAPI schema.

## Start developing

Install Node.js 22.22+ (or a supported newer LTS), [uv](https://docs.astral.sh/uv/getting-started/installation/), Docker with Compose, and optionally Make.

```sh
make install
make backend
make frontend
```

Without Make, use:

```sh
uv sync --locked --project backend
npm ci --prefix frontend
docker compose up --build -d --wait
npm run dev --prefix frontend
```

Open the app at http://localhost:5173 and API documentation at http://localhost:8000/docs.
The React admin panel at `/admin`, campus map, profile and student booking screens use the backend API. The HTML references remain in `design/admin/`. Profile notification controls remain local UI placeholders.
The campus map (`/map`, linked from the home screen) is the view mode of `occupancy-map-preview/`, made for phones. Its data comes from the backend under `/api/v1/map` (see "Campus map" below), so it needs `make backend` running.
Vite proxies relative `/api` requests to the backend on port 8000. Set `VITE_API_PROXY_TARGET` when running a local backend on another port. Backend source changes reload automatically; migrations run when the backend container starts.

Python and JavaScript dependencies are locked in `backend/uv.lock` and `frontend/package-lock.json`. Rebuild the backend container after changing Python dependencies.

## Environment

Compose supplies the database connection and CORS environment automatically. Its fixed credentials are for local development.
It defaults to demo authentication and loads `backend/.env` when present. Copy `backend/.env.example` there to override reservation rules or dummy identity settings, then run `make backend` to recreate the backend with the new environment.
PostgreSQL data persists in the `postgres_data` volume. Stop the environment with `docker compose down`.

For a backend running outside Docker, copy `backend/.env.example` to `backend/.env`, start the database with `docker compose up -d db`, then run:

```sh
cd backend
uv run --locked alembic upgrade head
uv run --locked uvicorn app.main:app --reload
```

To point the frontend at a separately hosted API, copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_BASE_URL` to its origin. Set backend `CORS_ORIGINS` to a JSON array containing the frontend origin.
Vite environment variables are public and are embedded at build time.

Host ports can be changed with `BACKEND_PORT` and `POSTGRES_PORT` when starting Compose. If you change the backend port, update `frontend/vite.config.ts`'s proxy target too.

## Generate the frontend API client

After changing API routes or Pydantic request/response models:

```sh
make generate
```

Or run `npm run api:generate --prefix frontend`.
This exports `backend/openapi.json` directly from the Python application, then generates `frontend/src/api/generated/`. No running API or database is needed. Python dependencies must be installed, and `uv` must be available.
Commit the schema and generated client alongside API changes; edit the Python source rather than generated files.

Give routes stable, unique `operation_id` values and explicit response models. This produces stable SDK names and useful frontend types.
For example, query the readiness endpoint with `useQuery(getReadinessOptions())`. Generated SDK functions can also be called directly.
Client configuration lives in `frontend/src/api/client.ts`.

## UI conventions

Check Mantine and existing project components before building a custom component. Use Tailwind utilities for custom layout and styling. Tailwind is configured through its Vite plugin in `frontend/vite.config.ts`.
`frontend/src/styles.css` orders Mantine before Tailwind utilities using CSS layers and omits Tailwind Preflight to retain Mantine's base styles.
Repository development rules are in [AGENTS.md](AGENTS.md).

## Database migrations

The reservation feature defines study spaces, seats, weekly opening intervals, dated closures, reservations, and breaks. Domain code lives under `backend/app/features/reservations/`, with models, Pydantic schemas, routes, transaction logic, and demo seeding kept together. Shared configuration, database sessions, authentication, and health endpoints remain under `backend/app/`.

Define feature models inheriting from `app.database.Base` and import them in `backend/app/models/__init__.py` so Alembic discovers them. Create and review a migration:

```sh
docker compose exec backend alembic revision --autogenerate -m "describe your change"
docker compose exec backend alembic upgrade head
```

The migrations directory is mounted into the container, so generated files appear under `backend/migrations/versions/` on the host. Commit them with the model changes.
API routes can inject a SQLAlchemy session with `Depends(get_session)`; sessions close after each request. Commit writes explicitly.

## Reservation demo

Start the backend, then seed two demo rooms with four seats each:

```sh
make backend
make seed
```

The seed command prints seat IDs and QR tokens for testing. Running it again preserves existing tokens, rooms, seats, and reservations. These are demo seats, not actual library inventory. Layouts are currently empty JSON objects.

Use http://localhost:8000/docs to explore the API. `POST /api/v1/reservations` accepts either `{"kind":"seat","seat_id":"…"}` or `{"kind":"any","space_id":"…"}`. A specific seat can be reserved now or for the next session during its public window; reserve-any selects only seats free now. `POST /api/v1/check-ins` accepts `{"qr_token":"…"}` for both pending reservations and walk-ups. A QR scan after a booking has expired can create a new walk-up booking if the seat is still free; it never revives the expired booking.

`GET /api/v1/me/reservation` returns the current or upcoming booking, effective deadlines, remaining break allowance, and available actions. Its `reservation` is null when there is no live booking. Reservation actions are `POST /api/v1/reservations/{id}/extend`, `/break`, `/return`, and `/end`. Space endpoints expose availability without returning user identities or QR tokens.

Authentication defaults to `AUTH_MODE=proxy`: the trusted `X-User-Id` email maps to a stable UUIDv5 using a fixed application namespace. Missing or empty identity returns 401 on user-specific endpoints; demo headers are ignored. Do not change the namespace, as that would change reservation ownership. Login still belongs to the proxy; the optional `user_profiles` table stores only display customizations, not credentials or email addresses.

`GET /api/v1/me` returns `{id, name, email, photo_url}` using that same reservation identity. On first sign-in, it registers a display profile using percent-decoded `X-User-Name`, falling back to `Study Spaces user` if absent; demo mode uses `Demo user`. Existing profile edits are preserved. Demo email is null, shown as `Local demo account`. `photo_url` is a PNG data URL or null. Responses are not HTTP-cacheable. The frontend uses this endpoint in both modes, with loading/error states and a reload action; it never supplies identity headers or stores auth tokens. Logout is not implemented.

On Profile, edit the display name, choose/preview or remove a photo, then press **Save changes**. `PATCH /api/v1/me` accepts multipart form fields: `name` (1–80 characters after trimming, input capped at 80), optional `photo`, and optional `remove_photo=true`. Omit `photo` to keep the current picture. Edits are saved together and can only affect the authenticated user's profile; email, UUID, and reservation ownership never change. Photos must be actual JPEG, PNG, or WebP images, at most 2 MiB and 16 megapixels. The backend corrects orientation, resizes to fit 256×256, and re-encodes to PNG without source metadata. Profile data persists in PostgreSQL; no upload directory or storage service is needed.

To test locally, rebuild with `docker compose up -d --build --wait backend` (installs upload dependencies and applies the migration), open http://localhost:5173/profile, save a name/photo, and refresh. Check the home avatar too. Demo users share `DUMMY_USER_ID` by default; use a different `X-Demo-User-Id` through the API to check profile isolation. In demo mode, an API upload looks like:

```sh
curl -X PATCH http://localhost:8000/api/v1/me \
  -F 'name=My display name' -F 'photo=@/path/to/photo.png'
```

Local Compose and `backend/.env.example` enable `AUTH_MODE=demo`. In this development-only mode, requests use `DUMMY_USER_ID`; send an `X-Demo-User-Id` UUID header to test additional users. `DUMMY_AUTH_ALLOW_HEADER=false` disables the override. To use proxy mode with Compose, run `AUTH_MODE=proxy docker compose up -d` (the service environment takes precedence over `backend/.env`).

Proxy mode is safe only behind the authenticated hackathon managed address: keep access control enabled and direct public app/backend access blocked, otherwise clients can forge the identity header.

Timing rules live in `backend/app/config.py` and can be overridden in `backend/.env`:

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_LENGTH_MINUTES` | 120 | Initial duration and extension amount |
| `CHECK_IN_WINDOW_MINUTES` | 15 | Time to check in after the session starts |
| `PRIVATE_PRIORITY_WINDOW_MINUTES` | 20 | How long before session end the occupant may extend |
| `PUBLIC_RESERVATION_WINDOW_MINUTES` | 10 | How long before session end others may reserve the next session |
| `BREAK_BUDGET_MINUTES` | 30 | Total break allowance per reservation |

`GET /api/v1/rules` returns these values in minutes, and the frontend reads them from there instead of keeping its own copy. All values must be positive; the public window must be shorter than the private window, which must be shorter than the session. The check-in window must also be shorter than the session. Existing deadlines and captured break budgets remain unchanged when settings change. New extensions and eligibility windows use current settings. Breaks share one allowance and do not pause the session or replenish on extension.

The `reservation_states` database view derives availability from the clock, including no-shows and expired breaks. Its underlying `reservation_states_at(timestamp)` function lets each transaction use one instant after acquiring locks and lets tests exercise exact boundaries. Early release advances the next booking when the earlier start is available, even without a background worker. Its session and check-in deadline are capped at closing or the next closure; a blocked earlier start keeps the scheduled start. Notifications are deferred.

## Optional friends and party booking

The social backend supports signed-in user search and direct friend requests, accepted party membership,
manual same-room seat assignments, atomic booking for all accepted members, and optional
friend room sharing. Production and PR deployments enable it (`SOCIAL_ENABLED=true`); standalone
backend settings default to disabled. Enabling it does
not replace the frontend's live individual-booking flow. See [the social backend contract](docs/social-backend.md)
for setup, endpoints, consent rules, and the frontend integration boundary.

A social frontend is at `http://127.0.0.1:5173/social-draft`, in production and in CI-deployed PR previews.
Open it through **Friends** in the Home / Map / Friends / Profile bottom navigation. Profile replaces
the avatar shortcut on Home; Home / Map / Profile remain available when social is disabled. Its hub
shows privacy first, a party entry and one friend list with shared rooms first. Requests have
their own page; Add a friend stays pinned above bottom navigation. People search, friend requests,
friendships and privacy use the real backend when enabled; signing in makes names and avatars
discoverable, with room sharing off by default. PR deployments enable this in their isolated database.
Parties use real invitations, accepted membership, manual room/seat selection and atomic group
booking. Everyone checks in independently through the existing reservation/session screens.
Only one joined active party per person is allowed; invitations can wait until that slot is free.
Saved previews never appear in production. A disabled backend shows an unavailable notice.
See [the walkthrough](design/social-draft.md). `VITE_SOCIAL_ENABLED=false` hides the social feature.
`VITE_SOCIAL_DEMO_ENABLED=true` separately enables the old sample UI; local development defaults to
samples when this flag is omitted. CI disables samples for both PRs and production. Docker accepts
the corresponding `SOCIAL_ENABLED` and `SOCIAL_DEMO_ENABLED` build arguments.

## Admin API demo

Open the React panel at `http://localhost:5173/admin`. Admin routes live under `/api/v1/admin`. In `AUTH_MODE=demo`, send `X-Demo-Admin: true` to use them; the Vite development UI adds this header. Without it, requests receive `403`; set `DUMMY_IS_ADMIN=true` to make the configured demo identity an admin by default. `DUMMY_ADMIN_ALLOW_HEADER=false` disables the header override. `X-Demo-Admin` accepts only `true` or `false`.

For proxy authentication configure `ADMIN_USER_IDS` as a JSON array of administrator UUIDs, returned by `/api/v1/me`. The default is empty. Demo admin headers are ignored in proxy mode. The reverse proxy must provide the trusted identity header; the browser cannot grant itself an admin role.

| Method | Path (under `/api/v1/admin`) | Purpose |
| --- | --- | --- |
| GET | `/spaces` | Rooms with opening status and seat/occupancy counts |
| POST | `/spaces` | Create a study space linked to a canonical map room, with optional layout, timezone and hours |
| PATCH | `/spaces/{space_id}` | Edit room metadata, layout, or timezone |
| DELETE | `/spaces/{space_id}` | Archive a study place and preserve its history |
| POST | `/spaces/{space_id}/restore` | Restore an archived place |
| DELETE | `/spaces/{space_id}/permanent` | Permanently remove an archived place and its owned data |
| PUT | `/spaces/{space_id}/layout` | Atomically save placements and numbered seats, preserving bound IDs and QR tokens |
| GET | `/users` / `/users/{user_id}` | User list, study-time totals and reservation history |
| PATCH | `/users/{user_id}` | Edit the saved display name |
| GET | `/spaces/{space_id}/overview` | All seats with current/pending and upcoming bookings, demo names, and deadlines |
| POST | `/spaces/{space_id}/seats` | Add a seat; generate its QR token |
| GET | `/spaces/{space_id}/seats/{seat_id}` | Seat configuration and QR token |
| PATCH | `/spaces/{space_id}/seats/{seat_id}` | Rename, activate, or deactivate a seat |
| PUT | `/spaces/{space_id}/opening-hours` | Replace the complete weekly schedule |
| GET | `/spaces/{space_id}/closures` | List closures, optionally intersecting `starts_at`/`ends_at` query bounds |
| POST | `/spaces/{space_id}/closures` | Block a room or an individual seat for a dated interval |
| DELETE | `/spaces/{space_id}/closures/{closure_id}` | Remove a closure |
| POST | `/reservations/{reservation_id}/end` | End/cancel a booking immediately; repeat safely |

Create a room with `{"name":"Reading room","map_room_id":"ETH.HG.E.E_007"}`. The room ID must exist in the floor-plan catalog; the backend supplies its coordinates. Rooms default to Swiss time (`Europe/Zurich`) and continuous opening, and seats default to active. Existing rooms and seats receive those defaults through the migration. Room creation does not create seats; add them through the seats endpoint with `{"label":"A-1"}`. Editing a room or seat accepts only supplied fields; empty patches and explicit nulls are rejected. There are no ban or QR-rotation endpoints.

Permanent deletion requires an archived space with no current or upcoming bookings. It atomically removes the space, layout, seats and QR tokens, opening hours, closures, favourites, reservations and their breaks. User profiles, friends, parties, other spaces and the campus map inventory remain; party memberships retain their history with deleted booking references cleared. The canonical room can then be registered as a new study space, with new seat IDs and QR tokens. The deleted space and its history cannot be restored.

Opening hours use room-local time, including Zurich daylight-saving changes. Each interval has `weekday` (Monday `0` through Sunday `6`), `start_minute`, and `end_minute` (minutes since midnight, with `1440` representing the end of the day). For example, `{"opening_hours":[{"weekday":0,"start_minute":480,"end_minute":1200}]}` opens Monday 08:00–20:00 and closes every other day. Multiple intervals are supported; adjacent intervals are continuous and overlaps are rejected. Split overnight hours across adjacent weekdays. An empty list closes the room all week.

Create closures with `{"starts_at":"2030-01-01T12:00:00+01:00","ends_at":"2030-01-01T14:00:00+01:00","reason":"Maintenance"}`. Omit `seat_id` or set it to null to close the entire room; supply a room-owned seat UUID for a seat closure. Timestamp offsets are required, response timestamps use UTC, and intervals include their start and exclude their end. Overlapping closures are supported. A closure must end in the future, but can start in the past to close immediately.

Room/seat PATCH, opening-hours PUT, and closure POST/DELETE accept `?force=false` by default. If a change would affect live bookings, they return `409` with `code: "reservation_conflict"` and `reservation_impacts` describing proposed cancellations, shortened sessions, or successor shifts, including old/new start times, end times, and check-in deadlines. Nothing is saved. Repeat the same request with `?force=true` to recompute and apply changes atomically; the successful response includes the actual impacts. Timezone changes and reopening also evaluate conflicts. Timezones must be named IANA zones supported by PostgreSQL; host-specific names such as `localtime` are rejected with `422`. Reopening does not restore cancelled bookings or lengthen shortened ones.

Bookings, walk-up check-ins, and extensions obey hours, closures, and seat activation. Sessions can be shortened to the next unavailable boundary; check-in deadlines are capped at the shortened end. Public space responses include hours, timezone, opening status, and seat activation, with unavailable seats excluded from `free_seats`. User identities, QR tokens, and closure reasons are exposed only through admin routes.

Overview names come from saved profiles, with `Demo user <UUID>` fallbacks. The current booking includes pending, active, or on-break status; upcoming bookings are separate. `occupied_seats` counts active checked-in users and `on_break_seats` counts breaks. Ending a booking frees its user to reserve again; it does not ban the user. Notifications outside the UI are deferred.

## React admin panel

The HTML mockups stay in `design/admin/`. React feature code lives in `frontend/src/features/admin/` and uses the generated SDK and TanStack Query helpers.

- Spaces: search, create from campus room outlines, settings, archive and restore. Deletion blocks new reservations while preserving seats and history. Under **Show deleted study places**, **Delete permanently** confirms removal of the space and its owned data. End live bookings before deleting a place.
- Room management: seats and current users, multiple weekly opening intervals, dated room/seat closures, and conflict review before affecting bookings.
- Layout: table shapes, snapped resizing, upright labels, clockwise numbering, straight and curved seat rows, windows/doors, table and seat features, undo/redo, shortcuts, wheel zoom and middle-button pan. Saves are atomic. Use **Backend seat** on a placed seat to assign an existing QR label. Unassigned positions receive new IDs and tokens; removed positions deactivate their seats and preserve history.
- Users: search profiles and reservation records, edit display names, review history and study time excluding breaks, and end live bookings. Email, ban and account deletion controls are omitted because the backend does not model them.
- QR codes: select seats, generate 3 × 3 or 4 × 4 cm QR images from backend tokens, export SVGs and print bordered labels. Room submenus stay locked to that room. Use a stable student-app address for real printing. `/check-in?qr_token=…` reads the current reservation; opening the link does not check in. An explicit button submits the authenticated POST.

Apply the migrations before running this version. Main’s map-room migration requires an empty `study_spaces` table; preserve existing data and plan its migration rather than clearing it automatically. From `backend/`, run `uv run --locked alembic upgrade head` if not using Compose. Schema-version-1 layouts retain campus unit/workspace references in `room.mapRef`, geographic coordinates and approximate metre scale. These link the catalogs; the mobile map's generated inventory remains a separate model and is not rewritten by layout saves.

### Room borders

Add space uses the same Leaflet/MapLibre renderer, basemaps and backend map styles as the student campus map. Choose a building and floor, click a room or search its label, then create the space. Selection fetches that room’s exact boundary from the backend and projects it into the layout editor at an approximate metre scale. Exact search matches appear first; typing a new query clears the old selection. Registered rooms cannot be created twice. Deleted rooms link to their management controls; restore them to keep their history, or permanently remove them before creating them again.

Room selection requires generated PolyMaps files, which are intentionally untracked. Build them from the public ETH data once:

```sh
python scraper/scrape_polymaps.py scraper/polymaps_data
python scraper/extract_floors.py --floors-only
python scraper/build_library_outlines.py
```

Or use `make map-floors`. The extractor writes `occupancy-map-preview/public/floors/`; the backend serves it at `/api/v1/map/floors`. Set `MAP_FLOORS_DIR` for another location. This downloads a sizeable campus dataset. Rooms with holes or disconnected outlines are rejected by the editor. Legacy demo rooms can be linked to a border from their Layout tab.

## Campus map

The layers button at the top right of the map opens **Map view**, a slider with three positions and a switch for the 3D floor stack (on by default; its faint visible edges are always drawn):

| Position | Shows |
| --- | --- |
| Study spaces (left) | Only the study spaces that can be booked in the app (the home screen's, from `GET /api/v1/spaces`); only their rooms are highlighted and clickable |
| Workspaces (middle) | Every workspace, and live rooms (lecture rooms colored by today's ETH bookings) |
| Campus (right) | Every workspace, live rooms, ASVZ sport and the mensas |

The map always uses the clean base map. The other map features (other campus datasets such as transport, weather and shared mobility; picking another date and time; detailed floor plans; the streets and satellite base maps; the free rooms and UZH library lists) are always off in the app and have no switch. `occupancy-map-preview/` still has all of them.

The map's backend is the feature `backend/app/features/campus_map/`:

| Route | What |
| --- | --- |
| `GET /api/v1/map/workspaces` | Workspaces (libraries, study areas, ...), their tables and seats: the generated data with the admin edits applied. `PUT` (admin) stores edits as a diff against the generated data |
| `GET /api/v1/map/style`, `/navigation` | Map colours per theme, click-to-zoom areas. `PUT` (admin) replaces them |
| `GET /api/v1/map/datasets[/<id>]` | Campus datasets (mensas, transport, ASVZ, shared mobility, weather, amenities). `?at=YYYY-MM-DDTHH:MM` for another Zurich time, `?refresh=true` to fetch now |
| `GET /api/v1/map/eth/rooms[?date=]` | Every ETH room with the day's bookings and where it is on the floor plans; fetched from ETH in the background, at most hourly |
| `GET /api/v1/map/eth/room?id=`, `/eth/file?id=`, `/eth/uzh` | ETH room sheet, room photos, live UZH library occupancy |
| `/api/v1/map/floors/...` | Floor plans (static files) |

The workspaces, style and navigation are stored in Postgres (`map_entities`, `map_overrides`, `map_documents`). They are edited in `occupancy-map-preview/` (Admin mode and Style panel), which saves JSON files; `make map-sync` copies them to `backend/app/features/campus_map/map-data/` and imports them. A fresh database imports those files when the backend starts. The importer can also write the database back to the files:

```bash
docker compose exec backend python -m app.features.campus_map.importer --export
docker compose exec backend python -m app.features.campus_map.importer --generated-only  # after a scraper re-run, keeps admin edits
```

ETH bookings and dataset results are cached in the `map_cache` volume (`backend/.cache/campus-map` outside Docker). The dataset fetchers live in `backend/app/features/campus_map/datasets/` (see its README). The backend Docker build downloads public ETH PolyMaps geometry and generates floor plans and workspace outlines in a separate build stage. Only the generated files are included in the image, at `/app/floors`; no local floor-plan folder is required. Docker caches the download layer between builds; use `docker compose build --no-cache backend` to refresh the source geometry. `eth_room_dashboard.py` in the repo root is a standalone dashboard over the same ETH code.

For the standalone developer preview or a backend running outside Docker, run `make map-floors` to generate `occupancy-map-preview/public/floors` locally. This preserves workspace data and admin edits. With Python but without Make, run:

```sh
python scraper/scrape_polymaps.py scraper/polymaps_data
python scraper/extract_floors.py --floors-only
python scraper/build_library_outlines.py
```

## Checks

```sh
make lint       # Ruff, ESLint, Prettier, and TypeScript
make format     # Ruff fixes/formatting and Prettier
make build      # TypeScript check and Vite production build
make test       # pytest inside the running backend container
```

`make test` requires `make backend` first. Health tests check readiness and database failure handling. Reservation tests apply Alembic migrations in a unique temporary PostgreSQL schema and cover deadline boundaries, early handover, configuration changes, and concurrent bookings using separate connections. They also downgrade/reapply migrations and remove their schema afterward. Tests do not modify application data.
For local Python test execution, start PostgreSQL and run `uv run --locked pytest` from `backend/`.

The production frontend is written to `frontend/dist/`. A deployment must serve it with an `/api` reverse proxy or set `VITE_API_BASE_URL` before building; the Vite proxy is only used during development.

## Deployment authentication

For GitHub Actions deployment to the organizers' VM using Caddy, see [the deployment guide](docs/deployment.md). It covers SSH secrets, branch CI checks, contributor-only PR previews and URL comments, the first deployment, local verification, persistent storage, and rollback.

`AUTH_MODE` is the only auth switch: `demo` locally, `proxy` on the VM. For Compose, persist `AUTH_MODE=proxy` in the repository-root `.env` (not `backend/.env`, which the Compose service environment overrides), then recreate the backend:

```sh
docker compose up -d --build --wait backend
```

This also installs image-upload dependencies and applies the `user_profiles` migration. Keep the existing PostgreSQL volume (do not use `docker compose down -v`); it holds both reservations and profile photos. Rebuild and publish the frontend with `npm run build --prefix frontend`. Outside Compose, install locked dependencies and run `alembic upgrade head` before restarting the backend. No new auth setting or photo-storage configuration is required.

This switches authentication, not web hosting. Keep the managed address authenticated, forward `/api` on the same origin with `X-User-Id` and `X-User-Name` intact, and block direct public access to the backend/app. No frontend auth setting or identity injection is needed. At the managed URL, verify that Profile shows your actual name/email; use a second account to confirm a different identity. Actual edu-ID login requires the managed proxy; local tests simulate its headers. Admin access remains demo-only.
