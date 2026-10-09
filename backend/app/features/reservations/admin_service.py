"""Admin catalogue writes and availability changes, coordinated with booking locks."""

from datetime import datetime
from secrets import token_urlsafe
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy import delete, select, text

from app.features.reservations.admin_schemas import (
    AdminClosureDeletedResponse,
    AdminClosureResponse,
    AdminClosuresResponse,
    AdminConflictResponse,
    AdminReservationDetails,
    AdminReservationResponse,
    AdminSeatDetails,
    AdminSeatOverview,
    AdminSeatResponse,
    AdminSpaceDetails,
    AdminSpaceOverview,
    AdminSpaceOverviewResponse,
    AdminSpaceResponse,
    AdminSpacesResponse,
    AdminSpaceSummary,
    AdminUser,
    ClosureDetails,
    CreateClosureRequest,
    CreateSeatRequest,
    CreateSpaceRequest,
    ReplaceOpeningHoursRequest,
    ReservationImpact,
    UpdateSeatRequest,
    UpdateSpaceRequest,
)
from app.features.reservations.models import (
    Reservation,
    Seat,
    SpaceClosure,
    SpaceOpeningInterval,
    StudySpace,
)
from app.features.reservations.schemas import OpeningInterval
from app.features.reservations.service import (
    BookingError,
    ReservationService,
    ReservationState,
    reservation_states,
)


class AdminConflict(Exception):
    def __init__(self, impacts: list[ReservationImpact]):
        self.response = AdminConflictResponse(
            detail="Existing bookings would change; repeat with force=true to apply",
            reservation_impacts=impacts,
        )


def demo_user(user_id: UUID) -> AdminUser:
    return AdminUser(id=user_id, display_name=f"Demo user {user_id}")


class AdminReservationService(ReservationService):
    def room(self, space_id: UUID) -> StudySpace:
        room = self.session.get(StudySpace, space_id)
        if room is None:
            raise BookingError(404, "not_found", "Study space not found")
        return room

    def seat(self, space_id: UUID, seat_id: UUID) -> Seat:
        self.room(space_id)
        seat = self.session.get(Seat, seat_id)
        if seat is None or seat.space_id != space_id:
            raise BookingError(404, "not_found", "Seat not found in this study space")
        return seat

    def seats(self, space_id: UUID) -> list[Seat]:
        return list(
            self.session.scalars(
                select(Seat).where(Seat.space_id == space_id).order_by(Seat.label, Seat.id)
            )
        )

    def lock_space(self, space_id: UUID) -> tuple[StudySpace, list[Seat], datetime]:
        room = self.session.scalar(
            select(StudySpace)
            .where(StudySpace.id == space_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if room is None:
            raise BookingError(404, "not_found", "Study space not found")
        seats = list(
            self.session.scalars(
                select(Seat)
                .where(Seat.space_id == space_id)
                .order_by(Seat.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        now = self.now()
        self._normalize([seat.id for seat in seats], now)
        return room, seats, now

    def details(
        self,
        room: StudySpace,
        seats: list[Seat],
        states: list[ReservationState],
        now: datetime,
    ) -> AdminSpaceDetails:
        availability = [
            self._availability(seat, [s for s in states if s.seat_id == seat.id], now)
            for seat in seats
        ]
        return AdminSpaceDetails(
            id=room.id,
            name=room.name,
            lat=room.lat,
            lng=room.lng,
            timezone=room.timezone,
            is_open=self.is_open(room.id, now),
            total_seats=len(seats),
            free_seats=sum(seat.state == "free" for seat in availability),
            active_seats=sum(seat.is_active for seat in seats),
            occupied_seats=sum(s.status == "active" for s in states),
            on_break_seats=sum(s.status == "on_break" for s in states),
            layout=room.layout,
            opening_hours=self.opening_hours(room.id),
        )

    def space_response(
        self,
        room: StudySpace,
        now: datetime,
        impacts: list[ReservationImpact],
    ) -> AdminSpaceResponse:
        seats = self.seats(room.id)
        states = self._live(now, seat_ids=[seat.id for seat in seats])
        return AdminSpaceResponse(
            server_time=now,
            space=self.details(room, seats, states, now),
            reservation_impacts=impacts,
        )

    def list_spaces(self) -> AdminSpacesResponse:
        now = self.now()
        rooms = self.session.scalars(select(StudySpace).order_by(StudySpace.name, StudySpace.id))
        summaries = []
        for room in rooms:
            seats = self.seats(room.id)
            details = self.details(
                room,
                seats,
                self._live(now, seat_ids=[seat.id for seat in seats]),
                now,
            )
            summaries.append(AdminSpaceSummary.model_validate(details.model_dump()))
        return AdminSpacesResponse(server_time=now, spaces=summaries)

    def admin_details(self, state: ReservationState, now: datetime) -> AdminReservationDetails:
        return AdminReservationDetails(
            **self._details(state, now).model_dump(),
            user=demo_user(state.user_id),
        )

    def overview(self, space_id: UUID) -> AdminSpaceOverviewResponse:
        room = self.room(space_id)
        now = self.now()
        seats = self.seats(space_id)
        states = self._live(now, seat_ids=[seat.id for seat in seats])
        seat_overviews = []
        for seat in seats:
            seat_states = [state for state in states if state.seat_id == seat.id]
            current = next((s for s in seat_states if s.status != "upcoming"), None)
            upcoming = next((s for s in seat_states if s.status == "upcoming"), None)
            seat_overviews.append(
                AdminSeatOverview(
                    **self._availability(seat, seat_states, now).model_dump(),
                    current_reservation=self.admin_details(current, now) if current else None,
                    upcoming_reservation=self.admin_details(upcoming, now) if upcoming else None,
                )
            )
        closures = self.session.scalars(
            select(SpaceClosure)
            .where(
                SpaceClosure.space_id == space_id,
                SpaceClosure.ends_at > now,
            )
            .order_by(SpaceClosure.starts_at, SpaceClosure.id)
        )
        return AdminSpaceOverviewResponse(
            server_time=now,
            space=AdminSpaceOverview(
                **self.details(room, seats, states, now).model_dump(),
                closures=[ClosureDetails.model_validate(row) for row in closures],
                seats=seat_overviews,
            ),
        )

    def set_hours(self, space_id: UUID, hours: list[OpeningInterval]) -> None:
        self.session.execute(
            delete(SpaceOpeningInterval).where(
                SpaceOpeningInterval.space_id == space_id,
            )
        )
        self.session.add_all(
            [SpaceOpeningInterval(space_id=space_id, **interval.model_dump()) for interval in hours]
        )

    def apply_policy(
        self,
        states: list[ReservationState],
        now: datetime,
        force: bool,
    ) -> list[ReservationImpact]:
        # Apply the proposal inside the request transaction, then compare the
        # complete resulting state. The request rolls back if force is required.
        # Checking only direct truncations misses shifts enabled by reopening.
        self.session.flush()
        direct_actions = {}
        for state in sorted(states, key=lambda s: (s.created_at, s.id)):
            start = max(now, state.effective_starts_at)
            end = self.reservable_end(state.seat_id, start, state.effective_ends_at)
            end = end if end is not None else start
            if end >= state.effective_ends_at:
                continue
            row = self.session.get(Reservation, state.id)
            row.ends_at = end
            row.check_in_deadline = min(row.check_in_deadline, end)
            direct_actions[state.id] = (
                "cancel" if state.status in {"pending", "upcoming"} and end == start else "shorten"
            )
            self.session.flush()
        seat_ids = sorted({s.seat_id for s in states})
        self._normalize(seat_ids, now)
        final_states = {s.id: s for s in reservation_states(self.session, now, seat_ids=seat_ids)}
        impacts = []
        for state in sorted(states, key=lambda s: (s.created_at, s.id)):
            final = final_states[state.id]
            if (
                state.effective_starts_at == final.effective_starts_at
                and state.effective_ends_at == final.effective_ends_at
                and state.effective_check_in_deadline == final.effective_check_in_deadline
            ):
                continue
            action = direct_actions.get(state.id, "shorten")
            if action != "cancel" and state.effective_starts_at != final.effective_starts_at:
                action = "shift"
            impacts.append(
                ReservationImpact(
                    reservation_id=state.id,
                    seat_id=state.seat_id,
                    user=demo_user(state.user_id),
                    status=state.status,
                    action=action,
                    previous_starts_at=state.effective_starts_at,
                    new_starts_at=final.effective_starts_at,
                    previous_ends_at=state.effective_ends_at,
                    new_ends_at=final.effective_ends_at,
                    previous_check_in_deadline=state.effective_check_in_deadline,
                    new_check_in_deadline=final.effective_check_in_deadline,
                )
            )
        if impacts and not force:
            raise AdminConflict(impacts)
        return impacts

    def validate_timezone(self, timezone: str) -> None:
        supported = self.session.scalar(
            text("SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = :timezone)"),
            {"timezone": timezone},
        )
        if not supported:
            raise RequestValidationError(
                [
                    {
                        "loc": ("body", "timezone"),
                        "type": "value_error",
                        "msg": "timezone must be a named timezone supported by PostgreSQL",
                        "input": timezone,
                    }
                ]
            )

    def create_space(self, request: CreateSpaceRequest) -> AdminSpaceResponse:
        self.validate_timezone(request.timezone)
        room = StudySpace(**request.model_dump(exclude={"opening_hours"}))
        self.session.add(room)
        self.session.flush()
        self.set_hours(room.id, request.opening_hours)
        self.session.flush()
        return self.space_response(room, self.now(), [])

    def update_space(
        self,
        space_id: UUID,
        request: UpdateSpaceRequest,
        force: bool,
    ) -> AdminSpaceResponse:
        if request.timezone is not None:
            self.validate_timezone(request.timezone)
        room, seats, now = self.lock_space(space_id)
        states = self._live(now, seat_ids=[seat.id for seat in seats])
        for name, value in request.model_dump(exclude_unset=True).items():
            setattr(room, name, value)
        impacts = self.apply_policy(states, now, force)
        return self.space_response(room, now, impacts)

    def replace_hours(
        self,
        space_id: UUID,
        request: ReplaceOpeningHoursRequest,
        force: bool,
    ) -> AdminSpaceResponse:
        room, seats, now = self.lock_space(space_id)
        states = self._live(now, seat_ids=[seat.id for seat in seats])
        self.set_hours(space_id, request.opening_hours)
        impacts = self.apply_policy(states, now, force)
        return self.space_response(room, now, impacts)

    def get_seat(self, space_id: UUID, seat_id: UUID) -> AdminSeatResponse:
        return AdminSeatResponse(
            server_time=self.now(),
            seat=AdminSeatDetails.model_validate(self.seat(space_id, seat_id)),
            reservation_impacts=[],
        )

    def create_seat(self, space_id: UUID, request: CreateSeatRequest) -> AdminSeatResponse:
        _, _, now = self.lock_space(space_id)
        seat = Seat(space_id=space_id, qr_token=token_urlsafe(32), **request.model_dump())
        self.session.add(seat)
        self.session.flush()
        return AdminSeatResponse(
            server_time=now,
            seat=AdminSeatDetails.model_validate(seat),
            reservation_impacts=[],
        )

    def update_seat(
        self,
        space_id: UUID,
        seat_id: UUID,
        request: UpdateSeatRequest,
        force: bool,
    ) -> AdminSeatResponse:
        _, _, now = self.lock_space(space_id)
        seat = self.seat(space_id, seat_id)
        states = self._live(now, seat_ids=[seat.id])
        for name, value in request.model_dump(exclude_unset=True).items():
            setattr(seat, name, value)
        impacts = self.apply_policy(states, now, force)
        return AdminSeatResponse(
            server_time=now,
            seat=AdminSeatDetails.model_validate(seat),
            reservation_impacts=impacts,
        )

    def list_closures(
        self,
        space_id: UUID,
        starts_at: datetime | None,
        ends_at: datetime | None,
    ) -> AdminClosuresResponse:
        self.room(space_id)
        if starts_at is not None and ends_at is not None and starts_at >= ends_at:
            raise BookingError(400, "invalid_range", "ends_at must be after starts_at")
        statement = select(SpaceClosure).where(SpaceClosure.space_id == space_id)
        if starts_at is not None:
            statement = statement.where(SpaceClosure.ends_at > starts_at)
        if ends_at is not None:
            statement = statement.where(SpaceClosure.starts_at < ends_at)
        rows = self.session.scalars(statement.order_by(SpaceClosure.starts_at, SpaceClosure.id))
        return AdminClosuresResponse(
            server_time=self.now(),
            closures=[ClosureDetails.model_validate(row) for row in rows],
        )

    def create_closure(
        self,
        space_id: UUID,
        request: CreateClosureRequest,
        force: bool,
    ) -> AdminClosureResponse:
        _, seats, now = self.lock_space(space_id)
        if request.seat_id is not None:
            self.seat(space_id, request.seat_id)
            seats = [seat for seat in seats if seat.id == request.seat_id]
        if request.ends_at <= now:
            raise BookingError(400, "closure_in_past", "Closure must end after the current time")
        states = self._live(now, seat_ids=[seat.id for seat in seats])
        closure = SpaceClosure(space_id=space_id, **request.model_dump())
        self.session.add(closure)
        impacts = self.apply_policy(states, now, force)
        return AdminClosureResponse(
            server_time=now,
            closure=ClosureDetails.model_validate(closure),
            reservation_impacts=impacts,
        )

    def delete_closure(
        self,
        space_id: UUID,
        closure_id: UUID,
        force: bool = False,
    ) -> AdminClosureDeletedResponse:
        _, seats, now = self.lock_space(space_id)
        states = self._live(now, seat_ids=[seat.id for seat in seats])
        closure = self.session.get(SpaceClosure, closure_id)
        if closure is None or closure.space_id != space_id:
            raise BookingError(404, "not_found", "Closure not found in this study space")
        self.session.delete(closure)
        impacts = self.apply_policy(states, now, force)
        return AdminClosureDeletedResponse(
            server_time=now,
            deleted_closure_id=closure_id,
            reservation_impacts=impacts,
        )

    def end_reservation(self, reservation_id: UUID) -> AdminReservationResponse:
        row = self.session.get(Reservation, reservation_id)
        if row is None:
            raise BookingError(404, "not_found", "Reservation not found")
        _, now = self.act(row.user_id, reservation_id, "end")
        state = next(
            s
            for s in reservation_states(self.session, now, seat_ids=[row.seat_id])
            if s.id == reservation_id
        )
        return AdminReservationResponse(
            server_time=now,
            reservation=self.admin_details(state, now),
        )
