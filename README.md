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
The frontend implements the screens from `design/`. Its profile and home avatar use the real `/api/v1/me` endpoint; study spaces, reservations, and notification controls still use mock data/local state and do not write to the database.
The campus map (`/map`, linked from the home screen) is the view mode of `occupancy-map-preview/`, made for phones. Its data comes from the backend under `/api/v1/map` (see "Campus map" below), so it needs `make backend` running.
Vite proxies `/api` requests to the backend on port 8000. Backend source changes reload automatically; migrations run when the backend container starts.

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
friend room sharing. It defaults to disabled (`SOCIAL_ENABLED=false`); enabling it does
not replace the frontend's live individual-booking flow. See [the social backend contract](docs/social-backend.md)
for setup, endpoints, consent rules, and the frontend integration boundary.

A separate frontend draft is at `http://127.0.0.1:5173/social-draft` and in CI-deployed PR previews.
Open it through **Friends** in the Home / Map / Friends bottom navigation. Its hub
separates parties, shared friend rooms and friend management. People search, friend requests,
friendships and privacy use the real backend when enabled; signing in makes names and avatars
discoverable, with room sharing off by default. PR deployments enable this in their isolated database.
Party screens still use sample data saved locally and support switching perspectives. A disabled
backend shows a labelled friendship preview. Ordinary bookings are unchanged.
See [the draft walkthrough](design/social-draft.md). `VITE_SOCIAL_DEMO_ENABLED=true` includes the draft
in a build; CI enables it for PRs and disables it for regular production. Docker accepts the build
argument `SOCIAL_DEMO_ENABLED=true`. Local development defaults on when the flag is omitted.

## Admin API demo

Admin routes live under `/api/v1/admin`. In `AUTH_MODE=demo`, send `X-Demo-Admin: true` to use them. Without it, requests receive `403`; set `DUMMY_IS_ADMIN=true` to make demo users admins by default. `DUMMY_ADMIN_ALLOW_HEADER=false` disables the header override. `X-Demo-Admin` accepts only `true` or `false`. Proxy mode ignores these demo privileges and denies admin access; production admin roles are outside the current auth scope.

| Method | Path (under `/api/v1/admin`) | Purpose |
| --- | --- | --- |
| GET | `/spaces` | Rooms with opening status and seat/occupancy counts |
| POST | `/spaces` | Create a room with name, coordinates, optional layout, timezone, and hours |
| PATCH | `/spaces/{space_id}` | Edit room metadata, layout, or timezone |
| GET | `/spaces/{space_id}/overview` | All seats with current/pending and upcoming bookings, demo names, and deadlines |
| POST | `/spaces/{space_id}/seats` | Add a seat; generate its QR token |
| GET | `/spaces/{space_id}/seats/{seat_id}` | Seat configuration and QR token |
| PATCH | `/spaces/{space_id}/seats/{seat_id}` | Rename, activate, or deactivate a seat |
| PUT | `/spaces/{space_id}/opening-hours` | Replace the complete weekly schedule |
| GET | `/spaces/{space_id}/closures` | List closures, optionally intersecting `starts_at`/`ends_at` query bounds |
| POST | `/spaces/{space_id}/closures` | Block a room or an individual seat for a dated interval |
| DELETE | `/spaces/{space_id}/closures/{closure_id}` | Remove a closure |
| POST | `/reservations/{reservation_id}/end` | End/cancel a booking immediately; repeat safely |

Create a room with `{"name":"Reading room","lat":47.37,"lng":8.54}`. Rooms default to Swiss time (`Europe/Zurich`) and continuous opening, and seats default to active. Existing rooms and seats receive those defaults through the migration. Room creation does not create seats; add them through the seats endpoint with `{"label":"A-1"}`. Editing a room or seat accepts only supplied fields; empty patches and explicit nulls are rejected. There are no hard-delete, ban, or QR-rotation endpoints.

Opening hours use room-local time, including Zurich daylight-saving changes. Each interval has `weekday` (Monday `0` through Sunday `6`), `start_minute`, and `end_minute` (minutes since midnight, with `1440` representing the end of the day). For example, `{"opening_hours":[{"weekday":0,"start_minute":480,"end_minute":1200}]}` opens Monday 08:00–20:00 and closes every other day. Multiple intervals are supported; adjacent intervals are continuous and overlaps are rejected. Split overnight hours across adjacent weekdays. An empty list closes the room all week.

Create closures with `{"starts_at":"2030-01-01T12:00:00+01:00","ends_at":"2030-01-01T14:00:00+01:00","reason":"Maintenance"}`. Omit `seat_id` or set it to null to close the entire room; supply a room-owned seat UUID for a seat closure. Timestamp offsets are required, response timestamps use UTC, and intervals include their start and exclude their end. Overlapping closures are supported. A closure must end in the future, but can start in the past to close immediately.

Room/seat PATCH, opening-hours PUT, and closure POST/DELETE accept `?force=false` by default. If a change would affect live bookings, they return `409` with `code: "reservation_conflict"` and `reservation_impacts` describing proposed cancellations, shortened sessions, or successor shifts, including old/new start times, end times, and check-in deadlines. Nothing is saved. Repeat the same request with `?force=true` to recompute and apply changes atomically; the successful response includes the actual impacts. Timezone changes and reopening also evaluate conflicts. Timezones must be named IANA zones supported by PostgreSQL; host-specific names such as `localtime` are rejected with `422`. Reopening does not restore cancelled bookings or lengthen shortened ones.

Bookings, walk-up check-ins, and extensions obey hours, closures, and seat activation. Sessions can be shortened to the next unavailable boundary; check-in deadlines are capped at the shortened end. Public space responses include hours, timezone, opening status, and seat activation, with unavailable seats excluded from `free_seats`. User identities, QR tokens, and closure reasons are exposed only through admin routes.

Overview names are deterministic placeholders (`Demo user <full UUID>`). The current booking includes pending, active, or on-break status; upcoming bookings are separate. `occupied_seats` counts active checked-in users and `on_break_seats` counts breaks. Ending a booking frees its user to reserve again; it does not ban the user. No admin UI or notifications are included.

## Campus map

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
