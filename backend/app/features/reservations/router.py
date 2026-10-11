from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.database import get_session
from app.features.campus_map.room_photos import RoomPhotos
from app.features.campus_map.services import get_room_photos
from app.features.reservations.schemas import (
    BookingErrorResponse,
    CheckInRequest,
    CreateReservationRequest,
    FavouritesResponse,
    MyReservationResponse,
    PopularSpacesResponse,
    RecentsResponse,
    RequestValidationErrorResponse,
    ReservationResponse,
    RulesResponse,
    SeatScanRequest,
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
Photos = Annotated[RoomPhotos, Depends(get_room_photos)]


def commit_response(
    service: ReservationService, result: tuple[UUID, datetime]
) -> ReservationResponse:
    reservation_id, now = result
    response = service.response(reservation_id, now)
    service.session.commit()
    return response


@router.get("/rules", response_model=RulesResponse, operation_id="get_rules")
def get_rules(settings: Annotated[Settings, Depends(get_settings)]) -> RulesResponse:
    return RulesResponse(
        session_length_minutes=settings.session_length_minutes,
        check_in_window_minutes=settings.check_in_window_minutes,
        private_priority_window_minutes=settings.private_priority_window_minutes,
        public_reservation_window_minutes=settings.public_reservation_window_minutes,
        break_budget_minutes=settings.break_budget_minutes,
    )


@router.get("/spaces", response_model=SpacesResponse, operation_id="list_spaces")
def list_spaces(service: Service, photos: Photos, map_room_id: str | None = None) -> SpacesResponse:
    return service.spaces(map_room_id, photos)


@router.get(
    "/spaces/popular", response_model=PopularSpacesResponse, operation_id="list_popular_spaces"
)
def list_popular_spaces(service: Service) -> PopularSpacesResponse:
    return service.popular()


@router.get("/me/favourites", response_model=FavouritesResponse, operation_id="list_favourites")
def list_favourites(service: Service, user_id: CurrentUser) -> FavouritesResponse:
    return service.favourites(user_id)


@router.put(
    "/me/favourites/{space_id}", response_model=FavouritesResponse, operation_id="add_favourite"
)
def add_favourite(space_id: UUID, service: Service, user_id: CurrentUser) -> FavouritesResponse:
    response = service.set_favourite(user_id, space_id, True)
    service.session.commit()
    return response


@router.delete(
    "/me/favourites/{space_id}", response_model=FavouritesResponse, operation_id="remove_favourite"
)
def remove_favourite(space_id: UUID, service: Service, user_id: CurrentUser) -> FavouritesResponse:
    response = service.set_favourite(user_id, space_id, False)
    service.session.commit()
    return response


@router.get("/me/recents", response_model=RecentsResponse, operation_id="list_recents")
def list_recents(service: Service, user_id: CurrentUser) -> RecentsResponse:
    return service.recents(user_id)


@router.get("/spaces/{space_id}", response_model=SpaceResponse, operation_id="get_space")
def get_space(space_id: UUID, service: Service, photos: Photos) -> SpaceResponse:
    return service.space(space_id, photos)


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
    reservation_id: UUID, request: SeatScanRequest, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(
        service, service.act(user_id, reservation_id, "extend", qr_token=request.qr_token)
    )


@router.post(
    "/reservations/{reservation_id}/break",
    response_model=ReservationResponse,
    operation_id="start_break",
)
def start_break(
    reservation_id: UUID, request: SeatScanRequest, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(
        service, service.act(user_id, reservation_id, "break", qr_token=request.qr_token)
    )


@router.post(
    "/reservations/{reservation_id}/return",
    response_model=ReservationResponse,
    operation_id="return_from_break",
)
def return_from_break(
    reservation_id: UUID, request: SeatScanRequest, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(
        service, service.act(user_id, reservation_id, "return", qr_token=request.qr_token)
    )


@router.post(
    "/reservations/{reservation_id}/end",
    response_model=ReservationResponse,
    operation_id="end_reservation",
)
def end_reservation(
    reservation_id: UUID, service: Service, user_id: CurrentUser
) -> ReservationResponse:
    return commit_response(service, service.act(user_id, reservation_id, "end"))
