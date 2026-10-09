from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
SeatStatus = Literal["free", "reserved", "occupied", "on_break", "claimable"]
ReservationAction = Literal["check_in", "extend", "start_break", "return", "end"]


class SpaceSummary(BaseModel):
    id: UUID
    name: str
    lat: float
    lng: float
    total_seats: int
    free_seats: int


class SeatAvailability(BaseModel):
    id: UUID
    label: str
    state: SeatStatus
    reservable_at: datetime | None


class SpaceDetail(SpaceSummary):
    layout: dict[str, Any]
    seats: list[SeatAvailability]


class SpacesResponse(BaseModel):
    server_time: datetime
    spaces: list[SpaceSummary]


class SpaceResponse(BaseModel):
    server_time: datetime
    space: SpaceDetail


class ReservationSeat(BaseModel):
    id: UUID
    label: str


class ReservationSpace(BaseModel):
    id: UUID
    name: str


class CurrentBreak(BaseModel):
    id: UUID
    started_at: datetime
    ends_at: datetime


class ReservationDetails(BaseModel):
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


class ReservationResponse(BaseModel):
    server_time: datetime
    reservation: ReservationDetails


class MyReservationResponse(BaseModel):
    server_time: datetime
    reservation: ReservationDetails | None
