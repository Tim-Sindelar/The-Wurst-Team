from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.database import get_session
from app.features.reservations.schemas import (
    BookingErrorResponse,
    CheckInRequest,
    CreateReservationRequest,
    MyReservationResponse,
    RequestValidationErrorResponse,
    ReservationResponse,
    SpaceResponse,
    SpacesResponse,
)
from app.features.reservations.service import ReservationService
from app.schemas import ErrorResponse

router = APIRouter(
    prefix="/api/v1",
    tags=["reservations"],
    responses={
        400: {"model": ErrorResponse},
        404: {"model": BookingErrorResponse},
        409: {"model": BookingErrorResponse},
        422: {"model": RequestValidationErrorResponse},
    },
)


def get_service(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReservationService:
    return ReservationService(session, settings)


Service = Annotated[ReservationService, Depends(get_service)]
CurrentUser = Annotated[UUID, Depends(get_current_user)]


def commit_response(
    service: ReservationService, result: tuple[UUID, datetime]
) -> ReservationResponse:
    reservation_id, now = result
    response = service.response(reservation_id, now)
    service.session.commit()
    return response


@router.get("/spaces", response_model=SpacesResponse, operation_id="list_spaces")
def list_spaces(service: Service) -> SpacesResponse:
    return service.spaces()


@router.get("/spaces/{space_id}", response_model=SpaceResponse, operation_id="get_space")
def get_space(space_id: UUID, service: Service) -> SpaceResponse:
    return service.space(space_id)


@router.get(
    "/me/reservation", response_model=MyReservationResponse, operation_id="get_my_reservation"
)
def get_my_reservation(service: Service, user_id: CurrentUser) -> MyReservationResponse:
    return service.my_reservation(user_id)


@router.post(
    "/reservations",
    response_model=ReservationResponse,
    status_code=201,
    operation_id="create_reservation",
)
def create_reservation(
    request: CreateReservationRequest, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(service, service.reserve(user_id, request))


@router.post("/check-ins", response_model=ReservationResponse, operation_id="check_in")
def check_in(
    request: CheckInRequest, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(service, service.check_in(user_id, request.qr_token))


@router.post(
    "/reservations/{reservation_id}/extend",
    response_model=ReservationResponse,
    operation_id="extend_reservation",
)
def extend_reservation(
    reservation_id: UUID, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(service, service.act(user_id, reservation_id, "extend"))


@router.post(
    "/reservations/{reservation_id}/break",
    response_model=ReservationResponse,
    operation_id="start_break",
)
def start_break(
    reservation_id: UUID, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(service, service.act(user_id, reservation_id, "break"))


@router.post(
    "/reservations/{reservation_id}/return",
    response_model=ReservationResponse,
    operation_id="return_from_break",
)
def return_from_break(
    reservation_id: UUID, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(service, service.act(user_id, reservation_id, "return"))


@router.post(
    "/reservations/{reservation_id}/end",
    response_model=ReservationResponse,
    operation_id="end_reservation",
)
def end_reservation(
    reservation_id: UUID, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(service, service.act(user_id, reservation_id, "end"))
