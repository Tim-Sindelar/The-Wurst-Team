# The Wurst Team

Web app starter with separate `frontend/` and `backend/` projects.

- **Frontend:** React, Vite, TypeScript, TanStack Query, Mantine, Tailwind CSS, ESLint, Prettier.
- **Backend:** Python 3.12, FastAPI, Pydantic, SQLAlchemy, Alembic, Ruff.
- **Local database:** PostgreSQL 17 in Docker Compose.
- **API client:** Hey API generates TypeScript models, fetch functions, and TanStack Query helpers directly from FastAPI's OpenAPI schema.

## Start developing

Install Node.js 22.18+ (or a supported newer LTS), [uv](https://docs.astral.sh/uv/getting-started/installation/), Docker with Compose, and optionally Make.

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
The frontend is an empty app shell with Mantine, TanStack Query, and the API client configured.
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

The reservation feature defines study spaces, seats, reservations, and breaks. Domain code lives under `backend/app/features/reservations/`, with models, Pydantic schemas, routes, transaction logic, and demo seeding kept together. Shared configuration, database sessions, dummy authentication, and health endpoints remain under `backend/app/`.

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

All values must be positive; the public window must be shorter than the private window, which must be shorter than the session. The check-in window must also be shorter than the session. Existing deadlines and captured break budgets remain unchanged when settings change. New extensions and eligibility windows use current settings. Breaks share one allowance and do not pause the session or replenish on extension.

The `reservation_states` database view derives availability from the clock, including no-shows and expired breaks. Its underlying `reservation_states_at(timestamp)` function lets each transaction use one instant after acquiring locks and lets tests exercise exact boundaries. Early release gives the next booking its originally assigned full session and check-in allowance starting at the release time, even without a background worker. Notifications are deferred.

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
