from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class UTCResponse(BaseModel):
    """Serialize API instants consistently regardless of database session timezone."""

    @field_validator("*")
    @classmethod
    def utc_instants(cls, value):
        return value.astimezone(UTC) if isinstance(value, datetime) else value


class OpeningInterval(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    weekday: int = Field(ge=0, le=6)
    start_minute: int = Field(ge=0, le=1439)
    end_minute: int = Field(ge=1, le=1440)

    @model_validator(mode="after")
    def validate_minutes(self) -> "OpeningInterval":
        if self.end_minute <= self.start_minute:
            raise ValueError("end_minute must be after start_minute")
        return self


class BookingErrorResponse(BaseModel):
    code: str
    detail: str


class RequestValidationIssue(BaseModel):
    loc: list[str | int]
    msg: str
    type: str


class RequestValidationErrorResponse(BaseModel):
    detail: list[RequestValidationIssue]


class ReserveSeatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["seat"]
    seat_id: UUID


class ReserveAnyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["any"]
    space_id: UUID


CreateReservationRequest = Annotated[
    ReserveSeatRequest | ReserveAnyRequest, Field(discriminator="kind")
]


class CheckInRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    qr_token: str = Field(min_length=1, max_length=256)


ReservationStatus = Literal["upcoming", "pending", "active", "on_break", "no_show", "ended"]
SeatStatus = Literal["free", "reserved", "occupied", "on_break", "claimable", "unavailable"]
ReservationAction = Literal["check_in", "extend", "start_break", "return", "end"]


class SpaceSummary(BaseModel):
    id: UUID
    name: str
    lat: float
    lng: float
    total_seats: int
    free_seats: int
    timezone: str
    is_open: bool


class SeatAvailability(UTCResponse):
    id: UUID
    label: str
    state: SeatStatus
    reservable_at: datetime | None
    is_active: bool


class SpaceDetail(SpaceSummary):
    layout: dict[str, Any]
    seats: list[SeatAvailability]
    opening_hours: list[OpeningInterval]


class SpacesResponse(UTCResponse):
    server_time: datetime
    spaces: list[SpaceSummary]


class SpaceResponse(UTCResponse):
    server_time: datetime
    space: SpaceDetail


class ReservationSeat(BaseModel):
    id: UUID
    label: str


class ReservationSpace(BaseModel):
    id: UUID
    name: str


class CurrentBreak(UTCResponse):
    id: UUID
    started_at: datetime
    ends_at: datetime


class ReservationDetails(UTCResponse):
    id: UUID
    seat: ReservationSeat
    space: ReservationSpace
    status: ReservationStatus
    starts_at: datetime
    check_in_deadline: datetime
    checked_in_at: datetime | None
    ends_at: datetime
    current_break: CurrentBreak | None
    break_seconds_remaining: int
    available_actions: list[ReservationAction]


class ReservationResponse(UTCResponse):
    server_time: datetime
    reservation: ReservationDetails


class MyReservationResponse(UTCResponse):
    server_time: datetime
    reservation: ReservationDetails | None
