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
The frontend implements the mock screens from `design/` with mock data only (no API calls yet); Mantine, TanStack Query, and the API client are configured for wiring the backend in.
Vite proxies `/api` requests to the backend on port 8000. Backend source changes reload automatically; migrations run when the backend container starts.

Python and JavaScript dependencies are locked in `backend/uv.lock` and `frontend/package-lock.json`. Rebuild the backend container after changing Python dependencies.

## Environment

Compose supplies the database connection and CORS environment automatically. Its fixed credentials are for local development.
It also loads `backend/.env` when present. Copy `backend/.env.example` there to override reservation rules or dummy identity settings, then run `make backend` to recreate the backend with the new environment.
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

The reservation feature defines study spaces, seats, weekly opening intervals, dated closures, reservations, and breaks. Domain code lives under `backend/app/features/reservations/`, with models, Pydantic schemas, routes, transaction logic, and demo seeding kept together. Shared configuration, database sessions, dummy authentication, and health endpoints remain under `backend/app/`.

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

Authentication is a development stub. Requests use `DUMMY_USER_ID` by default; send an `X-Demo-User-Id` UUID header to test additional users. `DUMMY_AUTH_ALLOW_HEADER=false` disables the override. This stub does not authenticate users and must be replaced before public deployment.

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

## Admin API demo

Admin routes live under `/api/v1/admin`. Send `X-Demo-Admin: true` to use them in the local demo. Without it, requests receive `403`; set `DUMMY_IS_ADMIN=true` to make the configured demo identity an admin by default. `DUMMY_ADMIN_ALLOW_HEADER=false` disables the header override. `X-Demo-Admin` accepts only `true` or `false`. This is a development stub, like the existing user identity middleware, and must be replaced before public deployment.

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
