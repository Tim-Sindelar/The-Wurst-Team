"""Admin contracts; occupant identities and QR tokens never enter public schemas."""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.features.reservations.schemas import (
    OpeningInterval,
    ReservationDetails,
    ReservationStatus,
    SeatAvailability,
    SpaceSummary,
    UTCResponse,
)

NAMED_TIMEZONES = available_timezones() - {"localtime", "posixrules"}

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
SeatLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


def unrestricted_hours() -> list[OpeningInterval]:
    return [OpeningInterval(weekday=day, start_minute=0, end_minute=1440) for day in range(7)]


def validate_hours(hours: list[OpeningInterval]) -> list[OpeningInterval]:
    ordered = sorted(hours, key=lambda h: (h.weekday, h.start_minute))
    for previous, current in zip(ordered, ordered[1:], strict=False):
        if previous.weekday == current.weekday and previous.end_minute > current.start_minute:
            raise ValueError("Opening intervals must not overlap")
    return ordered


class AdminRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SpaceFieldsRequest(AdminRequest):
    @field_validator("timezone", check_fields=False)
    @classmethod
    def valid_timezone(cls, value: str | None) -> str | None:
        if value is not None and value not in NAMED_TIMEZONES:
            raise ValueError("timezone must be a named IANA timezone")
        return value


class CreateSpaceRequest(SpaceFieldsRequest):
    name: Name
    map_room_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    layout: dict[str, Any] = Field(default_factory=dict)
    timezone: str = "Europe/Zurich"
    opening_hours: list[OpeningInterval] = Field(default_factory=unrestricted_hours)

    _valid_hours = field_validator("opening_hours")(validate_hours)


class PatchRequest(AdminRequest):
    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one field must be supplied")
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Patch fields must not be null")
        return self


class UpdateSpaceRequest(SpaceFieldsRequest, PatchRequest):
    name: Name | None = None
    layout: dict[str, Any] | None = None
    timezone: str | None = None


class CreateSeatRequest(AdminRequest):
    label: SeatLabel
    is_active: bool = True


class UpdateSeatRequest(PatchRequest):
    label: SeatLabel | None = None
    is_active: bool | None = None


class ReplaceOpeningHoursRequest(AdminRequest):
    opening_hours: list[OpeningInterval]

    _valid_hours = field_validator("opening_hours")(validate_hours)


class CreateClosureRequest(AdminRequest):
    seat_id: UUID | None = None
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    reason: Reason | None = None

    @field_validator("starts_at", "ends_at")
    @classmethod
    def utc_times(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def validate_times(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class AdminUser(BaseModel):
    id: UUID
    display_name: str


class ClosureDetails(UTCResponse):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    space_id: UUID
    seat_id: UUID | None
    starts_at: datetime
    ends_at: datetime
    reason: str | None


class ReservationImpact(UTCResponse):
    reservation_id: UUID
    seat_id: UUID
    user: AdminUser
    status: ReservationStatus
    action: Literal["cancel", "shorten", "shift"]
    previous_starts_at: datetime
    new_starts_at: datetime
    previous_check_in_deadline: datetime
    new_check_in_deadline: datetime
    previous_ends_at: datetime
    new_ends_at: datetime


class AdminSpaceSummary(SpaceSummary):
    is_archived: bool = False
    map_unit_id: str | None = None
    active_seats: int
    occupied_seats: int
    on_break_seats: int


class AdminSpaceDetails(AdminSpaceSummary):
    layout: dict[str, Any]
    opening_hours: list[OpeningInterval]


class AdminSeatDetails(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    space_id: UUID
    label: str
    is_active: bool
    qr_token: str


class AdminReservationDetails(ReservationDetails):
    user: AdminUser


class AdminSeatOverview(SeatAvailability):
    current_reservation: AdminReservationDetails | None
    upcoming_reservation: AdminReservationDetails | None


class AdminSpaceOverview(AdminSpaceDetails):
    closures: list[ClosureDetails]
    seats: list[AdminSeatOverview]


class AdminSpacesResponse(UTCResponse):
    server_time: datetime
    spaces: list[AdminSpaceSummary]


class AdminSpaceResponse(UTCResponse):
    server_time: datetime
    space: AdminSpaceDetails
    reservation_impacts: list[ReservationImpact]


class AdminSpaceDeletedResponse(UTCResponse):
    server_time: datetime
    deleted_space_id: UUID


class AdminSeatResponse(UTCResponse):
    server_time: datetime
    seat: AdminSeatDetails
    reservation_impacts: list[ReservationImpact]


class AdminSpaceOverviewResponse(UTCResponse):
    server_time: datetime
    space: AdminSpaceOverview


class AdminClosuresResponse(UTCResponse):
    server_time: datetime
    closures: list[ClosureDetails]


class AdminClosureResponse(UTCResponse):
    server_time: datetime
    closure: ClosureDetails
    reservation_impacts: list[ReservationImpact]


class AdminClosureDeletedResponse(UTCResponse):
    server_time: datetime
    deleted_closure_id: UUID
    reservation_impacts: list[ReservationImpact]


class AdminReservationResponse(UTCResponse):
    server_time: datetime
    reservation: AdminReservationDetails


class AdminConflictResponse(BaseModel):
    code: Literal["reservation_conflict"] = "reservation_conflict"
    detail: str
    reservation_impacts: list[ReservationImpact]


class SaveLayoutRequest(AdminRequest):
    layout: dict[str, Any]


class AdminUserSummary(BaseModel):
    id: UUID
    name: str
    reservations: int
    study_seconds: int
    live_reservations: int


class AdminUsersResponse(UTCResponse):
    server_time: datetime
    users: list[AdminUserSummary]


class AdminUserHistoryResponse(UTCResponse):
    server_time: datetime
    user: AdminUserSummary
    reservations: list[AdminReservationDetails]


class UpdateAdminUserRequest(AdminRequest):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
