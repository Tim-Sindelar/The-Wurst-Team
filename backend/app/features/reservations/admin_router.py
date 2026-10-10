"""Administrative routes; all identities and booking policy are enforced server-side."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.config import Settings, get_settings
from app.database import get_session
from app.features.reservations.admin_schemas import (
    AdminClosureDeletedResponse,
    AdminClosureResponse,
    AdminClosuresResponse,
    AdminConflictResponse,
    AdminReservationResponse,
    AdminSeatResponse,
    AdminSpaceDeletedResponse,
    AdminSpaceOverviewResponse,
    AdminSpaceResponse,
    AdminSpacesResponse,
    AdminUserHistoryResponse,
    AdminUsersResponse,
    CreateClosureRequest,
    CreateSeatRequest,
    CreateSpaceRequest,
    ReplaceOpeningHoursRequest,
    SaveLayoutRequest,
    UpdateAdminUserRequest,
    UpdateSeatRequest,
    UpdateSpaceRequest,
)
from app.features.reservations.admin_service import AdminReservationService
from app.features.reservations.schemas import BookingErrorResponse, RequestValidationErrorResponse
from app.schemas import ErrorResponse


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(
    prefix="/api/v1/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin), Depends(private_response)],
    responses={
        400: {"model": ErrorResponse | BookingErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": BookingErrorResponse},
        409: {"model": BookingErrorResponse},
        503: {"model": BookingErrorResponse},
        422: {"model": RequestValidationErrorResponse},
    },
)
CONFLICT_RESPONSES = {409: {"model": BookingErrorResponse | AdminConflictResponse}}


def get_admin_service(
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AdminReservationService:
    return AdminReservationService(session, settings)


Service = Annotated[AdminReservationService, Depends(get_admin_service)]


@router.get("/spaces", response_model=AdminSpacesResponse, operation_id="admin_list_spaces")
def list_spaces(service: Service) -> AdminSpacesResponse:
    return service.list_spaces()


@router.post(
    "/spaces",
    response_model=AdminSpaceResponse,
    status_code=201,
    operation_id="admin_create_space",
)
def create_space(request: CreateSpaceRequest, service: Service) -> AdminSpaceResponse:
    response = service.create_space(request)
    service.session.commit()
    return response


@router.patch(
    "/spaces/{space_id}",
    response_model=AdminSpaceResponse,
    operation_id="admin_update_space",
    responses=CONFLICT_RESPONSES,
)
def update_space(
    space_id: UUID,
    request: UpdateSpaceRequest,
    service: Service,
    force: bool = False,
) -> AdminSpaceResponse:
    response = service.update_space(space_id, request, force)
    service.session.commit()
    return response


@router.get(
    "/spaces/{space_id}/overview",
    response_model=AdminSpaceOverviewResponse,
    operation_id="admin_get_space_overview",
)
def get_space_overview(space_id: UUID, service: Service) -> AdminSpaceOverviewResponse:
    return service.overview(space_id)


@router.post(
    "/spaces/{space_id}/seats",
    response_model=AdminSeatResponse,
    status_code=201,
    operation_id="admin_create_seat",
)
def create_seat(
    space_id: UUID,
    request: CreateSeatRequest,
    service: Service,
) -> AdminSeatResponse:
    response = service.create_seat(space_id, request)
    service.session.commit()
    return response


@router.patch(
    "/spaces/{space_id}/seats/{seat_id}",
    response_model=AdminSeatResponse,
    operation_id="admin_update_seat",
    responses=CONFLICT_RESPONSES,
)
def update_seat(
    space_id: UUID,
    seat_id: UUID,
    request: UpdateSeatRequest,
    service: Service,
    force: bool = False,
) -> AdminSeatResponse:
    response = service.update_seat(space_id, seat_id, request, force)
    service.session.commit()
    return response


@router.get(
    "/spaces/{space_id}/seats/{seat_id}",
    response_model=AdminSeatResponse,
    operation_id="admin_get_seat",
)
def get_seat(space_id: UUID, seat_id: UUID, service: Service) -> AdminSeatResponse:
    return service.get_seat(space_id, seat_id)


@router.put(
    "/spaces/{space_id}/opening-hours",
    response_model=AdminSpaceResponse,
    operation_id="admin_replace_opening_hours",
    responses=CONFLICT_RESPONSES,
)
def replace_opening_hours(
    space_id: UUID,
    request: ReplaceOpeningHoursRequest,
    service: Service,
    force: bool = False,
) -> AdminSpaceResponse:
    response = service.replace_hours(space_id, request, force)
    service.session.commit()
    return response


@router.get(
    "/spaces/{space_id}/closures",
    response_model=AdminClosuresResponse,
    operation_id="admin_list_closures",
)
def list_closures(
    space_id: UUID,
    service: Service,
    starts_at: AwareDatetime | None = None,
    ends_at: AwareDatetime | None = None,
) -> AdminClosuresResponse:
    return service.list_closures(space_id, starts_at, ends_at)


@router.post(
    "/spaces/{space_id}/closures",
    response_model=AdminClosureResponse,
    status_code=201,
    operation_id="admin_create_closure",
    responses=CONFLICT_RESPONSES,
)
def create_closure(
    space_id: UUID,
    request: CreateClosureRequest,
    service: Service,
    force: bool = False,
) -> AdminClosureResponse:
    response = service.create_closure(space_id, request, force)
    service.session.commit()
    return response


@router.delete(
    "/spaces/{space_id}/closures/{closure_id}",
    response_model=AdminClosureDeletedResponse,
    operation_id="admin_delete_closure",
    responses=CONFLICT_RESPONSES,
)
def delete_closure(
    space_id: UUID,
    closure_id: UUID,
    service: Service,
    force: bool = False,
) -> AdminClosureDeletedResponse:
    response = service.delete_closure(space_id, closure_id, force)
    service.session.commit()
    return response


@router.post(
    "/reservations/{reservation_id}/end",
    response_model=AdminReservationResponse,
    operation_id="admin_end_reservation",
)
def end_reservation(reservation_id: UUID, service: Service) -> AdminReservationResponse:
    response = service.end_reservation(reservation_id)
    service.session.commit()
    return response


@router.delete(
    "/spaces/{space_id}", response_model=AdminSpaceResponse, operation_id="admin_archive_space"
)
def archive_space(space_id: UUID, service: Service) -> AdminSpaceResponse:
    response = service.archive_space(space_id, True)
    service.session.commit()
    return response


@router.delete(
    "/spaces/{space_id}/permanent",
    response_model=AdminSpaceDeletedResponse,
    operation_id="admin_permanently_delete_space",
)
def permanently_delete_space(space_id: UUID, service: Service) -> AdminSpaceDeletedResponse:
    response = service.permanently_delete_space(space_id)
    service.session.commit()
    return response


@router.post(
    "/spaces/{space_id}/restore",
    response_model=AdminSpaceResponse,
    operation_id="admin_restore_space",
)
def restore_space(space_id: UUID, service: Service) -> AdminSpaceResponse:
    response = service.archive_space(space_id, False)
    service.session.commit()
    return response


@router.put(
    "/spaces/{space_id}/layout",
    response_model=AdminSpaceOverviewResponse,
    operation_id="admin_save_layout",
    responses=CONFLICT_RESPONSES,
)
def save_layout(
    space_id: UUID, request: SaveLayoutRequest, service: Service, force: bool = False
) -> AdminSpaceOverviewResponse:
    response = service.save_layout(space_id, request.layout, force)
    service.session.commit()
    return response


@router.get("/users", response_model=AdminUsersResponse, operation_id="admin_list_users")
def list_users(service: Service) -> AdminUsersResponse:
    return service.users()


@router.get(
    "/users/{user_id}", response_model=AdminUserHistoryResponse, operation_id="admin_get_user"
)
def get_user(user_id: UUID, service: Service) -> AdminUserHistoryResponse:
    return service.user_history(user_id)


@router.patch(
    "/users/{user_id}", response_model=AdminUserHistoryResponse, operation_id="admin_update_user"
)
def update_user(
    user_id: UUID, request: UpdateAdminUserRequest, service: Service
) -> AdminUserHistoryResponse:
    response = service.update_user(user_id, request.name)
    service.session.commit()
    return response
