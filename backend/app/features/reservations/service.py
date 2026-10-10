"""Reservation policy and transactions; PostgreSQL owns time-derived reservation state."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import floor
from uuid import UUID

from sqlalchemy import bindparam, delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import Settings
from app.features.reservations.models import (
    Break,
    Reservation,
    Seat,
    SpaceOpeningInterval,
    StudySpace,
)
from app.features.reservations.schemas import (
    CreateReservationRequest,
    CurrentBreak,
    FavouritesResponse,
    MyReservationResponse,
    OpeningInterval,
    ReservationAction,
    ReservationDetails,
    ReservationResponse,
    ReservationSeat,
    ReservationSpace,
    ReservationStatus,
    SeatAvailability,
    SpaceDetail,
    SpaceResponse,
    SpacesResponse,
    SpaceSummary,
)
from app.models.favourite import FavouriteSpace

LIVE_STATUSES = {"upcoming", "pending", "active", "on_break"}


class BookingError(Exception):
    def __init__(self, status_code: int, code: str, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class ReservationState:
    id: UUID
    user_id: UUID
    seat_id: UUID
    previous_reservation_id: UUID | None
    created_at: datetime
    starts_at: datetime
    check_in_deadline: datetime
    checked_in_at: datetime | None
    ends_at: datetime
    break_budget_seconds: int
    effective_starts_at: datetime
    effective_check_in_deadline: datetime
    effective_ends_at: datetime
    status: ReservationStatus


def reservation_states(
    session: Session,
    now: datetime,
    *,
    seat_ids: list[UUID] | None = None,
    user_id: UUID | None = None,
    user_ids: list[UUID] | None = None,
    live_only: bool = False,
) -> list[ReservationState]:
    clauses = []
    parameters: dict = {"at_time": now}
    if seat_ids is not None:
        if not seat_ids:
            return []
        clauses.append("seat_id IN :seat_ids")
        parameters["seat_ids"] = seat_ids
    if user_id is not None:
        clauses.append("user_id = :user_id")
        parameters["user_id"] = user_id
    if user_ids is not None:
        if not user_ids:
            return []
        clauses.append("user_id IN :user_ids")
        parameters["user_ids"] = user_ids
    if live_only:
        clauses.append("status IN ('upcoming', 'pending', 'active', 'on_break')")
    statement = text(
        "SELECT * FROM reservation_states_at(:at_time)"
        + (" WHERE " + " AND ".join(clauses) if clauses else "")
    )
    if seat_ids is not None:
        statement = statement.bindparams(bindparam("seat_ids", expanding=True))
    if user_ids is not None:
        statement = statement.bindparams(bindparam("user_ids", expanding=True))
    return [ReservationState(**row) for row in session.execute(statement, parameters).mappings()]


def layout_with_seats(layout: dict | None, seats: list) -> dict | None:
    """Fill each bound seat object with its seat row's label and activation.

    The seats table owns both; the stored layout keeps only geometry and the
    `backendSeatId` link, so the two cannot drift apart.
    """
    if not layout or not isinstance(layout.get("objects"), list):
        return layout
    by_id = {str(seat.id): seat for seat in seats}
    objects = []
    for item in layout["objects"]:
        seat = by_id.get(item.get("backendSeatId")) if item.get("type") == "seat" else None
        if seat is not None:
            item = {**item, "backendLabel": seat.label, "active": seat.is_active}
        objects.append(item)
    return {**layout, "objects": objects}


class ReservationService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings

    def now(self) -> datetime:
        # Unlike transaction_timestamp(), this advances while waiting for locks.
        return self.session.scalar(select(func.clock_timestamp()))

    def reservable_end(
        self, seat_id: UUID, starts_at: datetime, ends_at: datetime
    ) -> datetime | None:
        seat = self.session.get(Seat, seat_id)
        space = self.session.get(StudySpace, seat.space_id) if seat else None
        if space is None or space.is_archived:
            return None
        return self.session.scalar(
            select(func.seat_reservation_end_at(seat_id, starts_at, ends_at))
        )

    def is_open(self, space_id: UUID, now: datetime) -> bool:
        space = self.session.get(StudySpace, space_id)
        if space is None or space.is_archived:
            return False
        return self.session.scalar(select(func.space_is_open_at(space_id, now)))

    def opening_hours(self, space_id: UUID) -> list[OpeningInterval]:
        rows = self.session.scalars(
            select(SpaceOpeningInterval)
            .where(SpaceOpeningInterval.space_id == space_id)
            .order_by(SpaceOpeningInterval.weekday, SpaceOpeningInterval.start_minute)
        ).all()
        return [OpeningInterval.model_validate(row) for row in rows]

    def _live(self, now: datetime, **filters) -> list[ReservationState]:
        return reservation_states(self.session, now, live_only=True, **filters)

    def _normalize(self, seat_ids: list[UUID], now: datetime) -> None:
        states = reservation_states(self.session, now, seat_ids=seat_ids)
        # A predecessor is always created before its successor. Shrink it first so
        # the successor can move earlier without violating the exclusion constraint.
        for state in sorted(states, key=lambda item: item.created_at):
            clear_predecessor = state.previous_reservation_id is not None and (
                now >= state.effective_starts_at or state.status not in LIVE_STATUSES
            )
            if (
                state.starts_at == state.effective_starts_at
                and state.check_in_deadline == state.effective_check_in_deadline
                and state.ends_at == state.effective_ends_at
                and not clear_predecessor
            ):
                continue
            row = self.session.get(Reservation, state.id, populate_existing=True)
            row.starts_at = state.effective_starts_at
            row.check_in_deadline = state.effective_check_in_deadline
            row.ends_at = state.effective_ends_at
            if clear_predecessor:
                row.previous_reservation_id = None
            self.session.flush()

    def _prepare(self, user_id: UUID, seat_ids: list[UUID]) -> datetime:
        return self._prepare_users([user_id], seat_ids)

    def _prepare_users(self, user_ids: list[UUID], seat_ids: list[UUID]) -> datetime:
        # Hash collisions only serialize otherwise independent users.
        for lock_key in sorted({user_id.int & ((1 << 63) - 1) for user_id in user_ids}):
            self.session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
        before_locks = self.now()
        user_seats = self.session.scalars(
            select(Reservation.seat_id).where(
                Reservation.user_id.in_(user_ids),
                Reservation.ends_at > before_locks,
                Reservation.ends_at > Reservation.starts_at,
            )
        ).all()
        affected_seats = sorted(set(seat_ids) | set(user_seats))
        if affected_seats:
            room_ids = self.session.scalars(
                select(Seat.space_id).where(Seat.id.in_(affected_seats))
            ).all()
            self.session.scalars(
                select(StudySpace)
                .where(StudySpace.id.in_(set(room_ids)))
                .order_by(StudySpace.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()
            self.session.scalars(
                select(Seat)
                .where(Seat.id.in_(affected_seats))
                .order_by(Seat.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()
        now = self.now()
        self._normalize(affected_seats, now)
        return now

    def reserve_party(self, assignments: dict[UUID, UUID]) -> tuple[list[Reservation], datetime]:
        """Reserve free seats for consenting users; the caller commits the entire transaction."""
        if not assignments or len(set(assignments.values())) != len(assignments):
            raise BookingError(409, "invalid_assignments", "Assign one distinct seat per member")
        seats = list(self.session.scalars(select(Seat).where(Seat.id.in_(assignments.values()))))
        if len(seats) != len(assignments):
            raise BookingError(404, "not_found", "Seat not found")
        if len({seat.space_id for seat in seats}) != 1:
            raise BookingError(409, "different_rooms", "All party seats must be in the same room")
        now = self._prepare_users(list(assignments), list(assignments.values()))
        if reservation_states(self.session, now, user_ids=list(assignments), live_only=True):
            raise BookingError(409, "already_reserved", "A party member already has a live booking")
        states = self._live(now, seat_ids=list(assignments.values()))
        for seat in seats:
            availability = self._availability(
                seat, [state for state in states if state.seat_id == seat.id], now
            )
            if availability.state != "free":
                raise BookingError(409, "seat_unavailable", "Every party seat must be free now")
        rows = [self._insert(user_id, seat_id, now) for user_id, seat_id in assignments.items()]
        return rows, now

    def cancel_unchecked(self, reservation_ids: list[UUID]) -> list[UUID]:
        """Cancel only these pending bookings, preserving checked-in sessions and later bookings."""
        rows = list(
            self.session.scalars(select(Reservation).where(Reservation.id.in_(reservation_ids)))
        )
        now = self._prepare_users([row.user_id for row in rows], [row.seat_id for row in rows])
        states = reservation_states(self.session, now, seat_ids=[row.seat_id for row in rows])
        pending = {state.id for state in states if state.status in {"pending", "upcoming"}}
        cancelled = []
        for row in rows:
            self.session.refresh(row)
            if row.id in pending and row.checked_in_at is None:
                row.ends_at = max(now, row.starts_at)
                cancelled.append(row.id)
        self.session.flush()
        self._normalize([row.seat_id for row in rows], now)
        return cancelled

    def _availability(
        self, seat: Seat, states: list[ReservationState], now: datetime
    ) -> SeatAvailability:
        identity = {"id": seat.id, "label": seat.label, "is_active": seat.is_active}
        if self.reservable_end(seat.id, now, now + timedelta(seconds=1)) is None:
            return SeatAvailability(**identity, state="unavailable", reservable_at=None)
        current = next((state for state in states if state.status != "upcoming"), None)
        upcoming = any(state.status == "upcoming" for state in states)
        if current is None:
            return SeatAvailability(
                **identity,
                state="reserved" if upcoming else "free",
                reservable_at=None if upcoming else now,
            )
        if current.status == "pending":
            return SeatAvailability(**identity, state="reserved", reservable_at=None)
        can_reserve = not upcoming and now >= current.effective_ends_at - timedelta(
            minutes=self.settings.public_reservation_window_minutes
        )
        can_reserve = (
            can_reserve
            and self.reservable_end(
                seat.id,
                current.effective_ends_at,
                current.effective_ends_at + timedelta(minutes=self.settings.session_length_minutes),
            )
            is not None
        )
        return SeatAvailability(
            **identity,
            state=(
                "on_break"
                if current.status == "on_break"
                else "claimable"
                if can_reserve
                else "occupied"
            ),
            reservable_at=current.effective_ends_at if can_reserve else None,
        )

    def _can_extend(
        self, state: ReservationState, seat_states: list[ReservationState], now: datetime
    ) -> bool:
        return (
            state.status in {"active", "on_break"}
            and now
            >= state.effective_ends_at
            - timedelta(minutes=self.settings.private_priority_window_minutes)
            and not any(other.status == "upcoming" for other in seat_states)
            and (
                self.reservable_end(
                    state.seat_id,
                    now,
                    state.effective_ends_at
                    + timedelta(minutes=self.settings.session_length_minutes),
                )
                or state.effective_ends_at
            )
            > state.effective_ends_at
        )

    def _break_details(
        self, state: ReservationState, now: datetime
    ) -> tuple[int, CurrentBreak | None]:
        breaks = self.session.scalars(select(Break).where(Break.reservation_id == state.id)).all()
        used = sum(
            max(
                0,
                (
                    min(row.returned_at or now, row.ends_at, state.effective_ends_at, now)
                    - row.started_at
                ).total_seconds(),
            )
            for row in breaks
        )
        current = next(
            (
                row
                for row in breaks
                if row.returned_at is None and row.started_at <= now < row.ends_at
            ),
            None,
        )
        return max(0, floor(state.break_budget_seconds - used)), (
            CurrentBreak(id=current.id, started_at=current.started_at, ends_at=current.ends_at)
            if current is not None and state.status == "on_break"
            else None
        )

    def _details(self, state: ReservationState, now: datetime) -> ReservationDetails:
        seat = self.session.get(Seat, state.seat_id)
        space = self.session.get(StudySpace, seat.space_id)
        remaining, current_break = self._break_details(state, now)
        actions: list[ReservationAction] = []
        if state.status in LIVE_STATUSES:
            if state.status == "pending":
                actions.append("check_in")
            if self._can_extend(state, self._live(now, seat_ids=[seat.id]), now):
                actions.append("extend")
            if state.status == "active" and remaining > 0:
                actions.append("start_break")
            if state.status == "on_break":
                actions.append("return")
            actions.append("end")
        return ReservationDetails(
            id=state.id,
            seat=ReservationSeat(id=seat.id, label=seat.label),
            space=ReservationSpace(id=space.id, name=space.name),
            status=state.status,
            starts_at=state.effective_starts_at,
            check_in_deadline=state.effective_check_in_deadline,
            checked_in_at=state.checked_in_at,
            ends_at=state.effective_ends_at,
            current_break=current_break,
            break_seconds_remaining=remaining,
            available_actions=actions,
        )

    def response(self, reservation_id: UUID, now: datetime) -> ReservationResponse:
        row = self.session.get(Reservation, reservation_id)
        state = next(
            item
            for item in reservation_states(self.session, now, seat_ids=[row.seat_id])
            if item.id == reservation_id
        )
        return ReservationResponse(server_time=now, reservation=self._details(state, now))

    def my_reservation(self, user_id: UUID) -> MyReservationResponse:
        now = self.now()
        states = self._live(now, user_id=user_id)
        return MyReservationResponse(
            server_time=now, reservation=self._details(states[0], now) if states else None
        )

    def spaces(self, map_room_id: str | None = None) -> SpacesResponse:
        now = self.now()
        query = select(StudySpace).where(StudySpace.is_archived.is_(False))
        if map_room_id is not None:
            query = query.where(StudySpace.map_room_id == map_room_id)
        spaces = self.session.scalars(query.order_by(StudySpace.name, StudySpace.id)).all()
        seats = self.session.scalars(select(Seat)).all()
        states_by_seat: dict[UUID, list[ReservationState]] = defaultdict(list)
        for state in self._live(now):
            states_by_seat[state.seat_id].append(state)
        seats_by_space: dict[UUID, list[SeatAvailability]] = defaultdict(list)
        for seat in seats:
            seats_by_space[seat.space_id].append(
                self._availability(seat, states_by_seat[seat.id], now)
            )
        return SpacesResponse(
            server_time=now,
            spaces=[
                SpaceSummary(
                    id=space.id,
                    name=space.name,
                    map_room_id=space.map_room_id,
                    lat=space.lat,
                    lng=space.lng,
                    timezone=space.timezone,
                    is_open=self.is_open(space.id, now),
                    total_seats=len(seats_by_space[space.id]),
                    free_seats=sum(seat.state == "free" for seat in seats_by_space[space.id]),
                )
                for space in spaces
            ],
        )

    def favourites(self, user_id: UUID) -> FavouritesResponse:
        ids = self.session.scalars(
            select(FavouriteSpace.space_id)
            .where(FavouriteSpace.user_id == user_id)
            .order_by(FavouriteSpace.created_at, FavouriteSpace.space_id)
        ).all()
        return FavouritesResponse(space_ids=list(ids))

    def set_favourite(self, user_id: UUID, space_id: UUID, favourite: bool) -> FavouritesResponse:
        if favourite:
            if self.session.get(StudySpace, space_id) is None:
                raise BookingError(404, "not_found", "Study space not found")
            self.session.execute(
                insert(FavouriteSpace)
                .values(user_id=user_id, space_id=space_id)
                .on_conflict_do_nothing()
            )
        else:
            self.session.execute(
                delete(FavouriteSpace).where(
                    FavouriteSpace.user_id == user_id, FavouriteSpace.space_id == space_id
                )
            )
        self.session.flush()
        return self.favourites(user_id)

    def space(self, space_id: UUID) -> SpaceResponse:
        space = self.session.get(StudySpace, space_id)
        if space is None or space.is_archived:
            raise BookingError(404, "not_found", "Study space not found")
        now = self.now()
        seats = self.session.scalars(
            select(Seat).where(Seat.space_id == space_id).order_by(Seat.label, Seat.id)
        ).all()
        states_by_seat: dict[UUID, list[ReservationState]] = defaultdict(list)
        for state in self._live(now, seat_ids=[seat.id for seat in seats]):
            states_by_seat[state.seat_id].append(state)
        availability = [self._availability(seat, states_by_seat[seat.id], now) for seat in seats]
        return SpaceResponse(
            server_time=now,
            space=SpaceDetail(
                id=space.id,
                name=space.name,
                map_room_id=space.map_room_id,
                lat=space.lat,
                lng=space.lng,
                layout=layout_with_seats(space.layout, seats),
                timezone=space.timezone,
                is_open=self.is_open(space.id, now),
                opening_hours=self.opening_hours(space.id),
                total_seats=len(seats),
                free_seats=sum(seat.state == "free" for seat in availability),
                seats=availability,
            ),
        )

    def _insert(
        self,
        user_id: UUID,
        seat_id: UUID,
        now: datetime,
        *,
        starts_at: datetime | None = None,
        predecessor: UUID | None = None,
        checked_in: bool = False,
    ) -> Reservation:
        starts_at = starts_at or now
        ends_at = self.reservable_end(
            seat_id, starts_at, starts_at + timedelta(minutes=self.settings.session_length_minutes)
        )
        if ends_at is None:
            raise BookingError(409, "seat_unavailable", "Seat is inactive, closed, or blocked")
        row = Reservation(
            user_id=user_id,
            seat_id=seat_id,
            previous_reservation_id=predecessor,
            created_at=now,
            starts_at=starts_at,
            check_in_deadline=min(
                ends_at, starts_at + timedelta(minutes=self.settings.check_in_window_minutes)
            ),
            ends_at=ends_at,
            checked_in_at=now if checked_in else None,
            break_budget_seconds=self.settings.break_budget_minutes * 60,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def reserve(self, user_id: UUID, request: CreateReservationRequest) -> tuple[UUID, datetime]:
        if request.kind == "seat":
            seat = self.session.get(Seat, request.seat_id)
            if seat is None:
                raise BookingError(404, "not_found", "Seat not found")
            seats = [seat]
        else:
            if self.session.get(StudySpace, request.space_id) is None:
                raise BookingError(404, "not_found", "Study space not found")
            seats = list(
                self.session.scalars(
                    select(Seat)
                    .where(Seat.space_id == request.space_id)
                    .order_by(Seat.label, Seat.id)
                )
            )
        now = self._prepare(user_id, [seat.id for seat in seats])
        if self._live(now, user_id=user_id):
            raise BookingError(409, "already_reserved", "You already have a live reservation")
        states = self._live(now, seat_ids=[seat.id for seat in seats])
        for seat in seats:
            seat_states = [state for state in states if state.seat_id == seat.id]
            availability = self._availability(seat, seat_states, now)
            if availability.reservable_at is None:
                continue
            if request.kind == "any" and availability.state != "free":
                continue
            current = next((state for state in seat_states if state.status != "upcoming"), None)
            row = self._insert(
                user_id,
                seat.id,
                now,
                starts_at=availability.reservable_at,
                predecessor=current.id if current else None,
            )
            return row.id, now
        raise BookingError(409, "seat_unavailable", "No eligible seat is available")

    def check_in(self, user_id: UUID, qr_token: str) -> tuple[UUID, datetime]:
        seat = self.session.scalar(select(Seat).where(Seat.qr_token == qr_token))
        if seat is None:
            raise BookingError(404, "qr_not_found", "Seat QR token not found")
        now = self._prepare(user_id, [seat.id])
        if self.reservable_end(seat.id, now, now + timedelta(seconds=1)) is None:
            raise BookingError(409, "seat_unavailable", "Seat is inactive, closed, or blocked")
        mine = self._live(now, user_id=user_id)
        if mine:
            state = mine[0]
            if state.seat_id != seat.id:
                raise BookingError(409, "already_reserved", "Your reservation is for another seat")
            if state.status == "upcoming":
                raise BookingError(409, "too_early", "Your reservation has not started")
            if state.status == "pending":
                row = self.session.get(Reservation, state.id, populate_existing=True)
                row.checked_in_at = now
                # The session clock starts at the scan, not at the booking, so the
                # time spent holding the seat is not taken out of the session.
                # A pending booking has no successor, so moving the end is safe.
                row.ends_at = (
                    self.reservable_end(
                        seat.id, now, now + timedelta(minutes=self.settings.session_length_minutes)
                    )
                    or row.ends_at
                )
                self.session.flush()
            return state.id, now
        if self._live(now, seat_ids=[seat.id]):
            raise BookingError(409, "seat_unavailable", "This seat is not free")
        row = self._insert(user_id, seat.id, now, checked_in=True)
        return row.id, now

    def act(self, user_id: UUID, reservation_id: UUID, action: str) -> tuple[UUID, datetime]:
        row = self.session.get(Reservation, reservation_id)
        if row is None or row.user_id != user_id:
            raise BookingError(404, "not_found", "Reservation not found")
        now = self._prepare(user_id, [row.seat_id])
        row = self.session.get(Reservation, reservation_id, populate_existing=True)
        state = next(
            item
            for item in reservation_states(self.session, now, seat_ids=[row.seat_id])
            if item.id == row.id
        )
        if action == "end":
            if state.status in LIVE_STATUSES:
                row.ends_at = max(now, row.starts_at)
                self.session.flush()
                self._normalize([row.seat_id], now)
            return row.id, now
        if action == "extend":
            if not self._can_extend(state, self._live(now, seat_ids=[row.seat_id]), now):
                raise BookingError(409, "extension_unavailable", "This session cannot be extended")
            row.ends_at = self.reservable_end(
                row.seat_id,
                now,
                row.ends_at + timedelta(minutes=self.settings.session_length_minutes),
            )
        elif action == "break":
            if state.status != "active":
                raise BookingError(409, "invalid_state", "A break requires an active session")
            remaining, _ = self._break_details(state, now)
            if remaining <= 0:
                raise BookingError(409, "break_budget_exhausted", "No break allowance remains")
            self.session.add(
                Break(
                    reservation_id=row.id,
                    started_at=now,
                    ends_at=min(row.ends_at, now + timedelta(seconds=remaining)),
                )
            )
        elif action == "return":
            if state.status != "on_break":
                raise BookingError(409, "invalid_state", "There is no current break to return from")
            _, current = self._break_details(state, now)
            self.session.get(Break, current.id).returned_at = now
        else:
            raise ValueError(f"Unknown reservation action: {action}")
        self.session.flush()
        return row.id, now
