from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import router as auth_router
from app.config import get_settings
from app.database import engine, get_session
from app.features.campus_map.router import router as campus_map_router
from app.features.campus_map.services import shutdown_services
from app.features.events.router import router as events_router
from app.features.events.schemas import ServerEvent
from app.features.reservations.admin_router import router as admin_router
from app.features.reservations.admin_service import AdminConflict
from app.features.reservations.router import router
from app.features.reservations.schemas import BookingErrorResponse
from app.features.reservations.service import BookingError
from app.features.social.router import router as social_router
from app.schemas import ErrorResponse, HealthResponse, ReadinessResponse


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    shutdown_services()
    engine.dispose()


app = FastAPI(title="The Wurst Team API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(admin_router)
app.include_router(campus_map_router)
# Floor plans of the campus map (index.json, levels/<id>.json), as static files.
app.mount(
    "/api/v1/map/floors",
    StaticFiles(directory=get_settings().map_floors_dir, check_dir=False),
    name="map-floors",
)
app.include_router(auth_router)
app.include_router(social_router)
app.include_router(events_router)


def openapi() -> dict:
    # The events stream isn't in OpenAPI; list its messages so the client gets their types.
    if app.openapi_schema:
        return app.openapi_schema
    schema = FastAPI.openapi(app)
    events = TypeAdapter(ServerEvent).json_schema(ref_template="#/components/schemas/{model}")
    schemas = schema.setdefault("components", {}).setdefault("schemas", {})
    schemas.update(events.pop("$defs", {}))
    schemas["ServerEvent"] = events
    return schema


app.openapi = openapi


@app.exception_handler(AdminConflict)
async def handle_admin_conflict(request: Request, exc: AdminConflict) -> JSONResponse:
    return JSONResponse(status_code=409, content=exc.response.model_dump(mode="json"))


@app.exception_handler(BookingError)
async def handle_booking_error(request: Request, exc: BookingError) -> JSONResponse:
    body = BookingErrorResponse(code=exc.code, detail=exc.detail)
    return JSONResponse(status_code=exc.status_code, content=body.model_dump())


@app.exception_handler(IntegrityError)
async def handle_booking_conflict(request: Request, exc: IntegrityError) -> JSONResponse:
    if (
        getattr(exc.orig, "sqlstate", None) == "23505"
        and getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        == "unique_space_seat_label"
    ):
        return await handle_booking_error(
            request, BookingError(409, "duplicate_seat_label", "Seat label already exists in room")
        )
    if (
        getattr(exc.orig, "sqlstate", None) == "23505"
        and getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        == "study_spaces_map_room_id_key"
    ):
        return await handle_booking_error(
            request,
            BookingError(409, "map_room_already_linked", "Map room already has a study space"),
        )
    if getattr(exc.orig, "sqlstate", None) != "23P01":
        raise exc
    error = BookingError(409, "booking_conflict", "Availability changed; refresh and try again")
    return await handle_booking_error(request, error)


@app.get(
    "/api/v1/health", response_model=HealthResponse, operation_id="get_health", tags=["health"]
)
def get_health() -> HealthResponse:
    return HealthResponse()


@app.get(
    "/api/v1/ready",
    response_model=ReadinessResponse,
    operation_id="get_readiness",
    tags=["health"],
    responses={503: {"model": ErrorResponse}},
)
def get_readiness(session: Annotated[Session, Depends(get_session)]) -> ReadinessResponse:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return ReadinessResponse()
