.PHONY: install dev backend frontend generate lint format test build seed map-sync map-floors

install:
	cd backend && uv sync --locked
	cd frontend && npm ci

dev: backend

backend:
	docker compose up --build -d --wait

frontend:
	cd frontend && npm run dev

generate:
	cd frontend && npm run api:generate

lint:
	cd backend && uv run --locked ruff check .
	cd backend && uv run --locked ruff format --check .
	cd frontend && npm run lint
	cd frontend && npm run typecheck

format:
	cd backend && uv run --locked ruff check --fix .
	cd backend && uv run --locked ruff format .
	cd frontend && npm run format

test:
	docker compose exec -T backend pytest

seed:
	docker compose exec -T backend python -m app.features.reservations.seed

# Generate the untracked floor plans and outlines without replacing workspace data.
map-floors:
	python scraper/scrape_polymaps.py scraper/polymaps_data
	python scraper/extract_floors.py --floors-only
	python scraper/build_library_outlines.py

# Copy the campus map files saved by occupancy-map-preview and import them into the database.
map-sync:
	cp occupancy-map-preview/data/generated.json occupancy-map-preview/data/overrides.json 		occupancy-map-preview/data/map-style.json occupancy-map-preview/data/navigation.json 		backend/app/features/campus_map/map-data/
	docker compose exec -T backend python -m app.features.campus_map.importer

build:
	cd frontend && npm run build
