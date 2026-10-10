FROM ghcr.io/astral-sh/uv:0.11.21 AS uv

# Keep the large raw geometry in a build stage; ship only decoded floor plans.
FROM python:3.12-slim AS map-floors
WORKDIR /build
COPY scraper/scrape_polymaps.py scraper/
RUN python scraper/scrape_polymaps.py scraper/polymaps_data
COPY scraper/extract_floors.py scraper/build_library_outlines.py scraper/
COPY backend/app/features/campus_map/map-data/generated.json occupancy-map-preview/data/generated.json
RUN python scraper/extract_floors.py --floors-only \
    && python scraper/build_library_outlines.py

FROM python:3.12-slim

COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH" MAP_FLOORS_DIR=/app/floors
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-install-project
COPY backend/ .
RUN uv sync --locked
COPY --from=map-floors /build/occupancy-map-preview/public/floors /app/floors
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
