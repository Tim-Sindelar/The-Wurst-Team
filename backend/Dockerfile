FROM ghcr.io/astral-sh/uv:0.11.21@sha256:ff07b86af50d4d9391d9daf4ff89ce427bc544f9aae87057e69a1cc0aa369946 AS uv
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
ARG INSTALL_DEV=true
RUN if [ "$INSTALL_DEV" = true ]; then uv sync --locked --no-install-project; else uv sync --locked --no-dev --no-install-project; fi
COPY . .
RUN if [ "$INSTALL_DEV" = true ]; then uv sync --locked; else uv sync --locked --no-dev; fi
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
