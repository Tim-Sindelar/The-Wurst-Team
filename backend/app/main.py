from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import DummyAuthMiddleware
from app.config import get_settings
from app.database import engine, get_session
from app.features.reservations.router import router
from app.features.reservations.schemas import BookingErrorResponse
from app.features.reservations.service import BookingError
from app.schemas import ErrorResponse, HealthResponse, ReadinessResponse


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    engine.dispose()


app = FastAPI(title="The Wurst Team API", version="0.1.0", lifespan=lifespan)
app.add_middleware(DummyAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.exception_handler(BookingError)
async def handle_booking_error(request: Request, exc: BookingError) -> JSONResponse:
    body = BookingErrorResponse(code=exc.code, detail=exc.detail)
    return JSONResponse(status_code=exc.status_code, content=body.model_dump())


@app.exception_handler(IntegrityError)
async def handle_booking_conflict(request: Request, exc: IntegrityError) -> JSONResponse:
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
