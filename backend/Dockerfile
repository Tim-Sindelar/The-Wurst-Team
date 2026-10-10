FROM ghcr.io/astral-sh/uv:0.11.21@sha256:ff07b86af50d4d9391d9daf4ff89ce427bc544f9aae87057e69a1cc0aa369946 AS uv

# Keep the large raw geometry in a build stage; ship only decoded floor plans.
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS map-floors
WORKDIR /build
COPY scraper/scrape_polymaps.py scraper/
ARG GEODATA_CACHE_WEEK=local
RUN : "$GEODATA_CACHE_WEEK" && python scraper/scrape_polymaps.py scraper/polymaps_data
COPY scraper/extract_floors.py scraper/build_library_outlines.py scraper/
COPY backend/app/features/campus_map/map-data/generated.json occupancy-map-preview/data/generated.json
RUN python scraper/extract_floors.py --floors-only \
    && python scraper/build_library_outlines.py

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH" MAP_FLOORS_DIR=/app/floors
COPY backend/pyproject.toml backend/uv.lock ./
ARG INSTALL_DEV=true
RUN if [ "$INSTALL_DEV" = true ]; then uv sync --locked --no-install-project; else uv sync --locked --no-dev --no-install-project; fi
COPY backend/ .
RUN if [ "$INSTALL_DEV" = true ]; then uv sync --locked; else uv sync --locked --no-dev; fi
COPY --from=map-floors /build/occupancy-map-preview/public/floors /app/floors
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
