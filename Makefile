.PHONY: install dev backend frontend generate lint format test build

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

build:
	cd frontend && npm run build
