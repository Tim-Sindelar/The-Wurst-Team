"""Admin catalogue writes and availability changes, coordinated with booking locks."""

from datetime import datetime
from secrets import token_urlsafe
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy import delete, func, or_, select, text, update

from app.features.campus_map.floor_plans import FloorPlans
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
    AdminSpaceDeletedResponse,
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
    Break,
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
    layout_with_seats,
    reservation_states,
)
from app.models.favourite import FavouriteSpace
from app.models.profile import UserProfile


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
            is_archived=room.is_archived,
            map_unit_id=self.map_unit_id(room.layout or {}),
            map_room_id=room.map_room_id,
            lat=room.lat,
            lng=room.lng,
            timezone=room.timezone,
            is_open=self.is_open(room.id, now),
            total_seats=len(seats),
            free_seats=sum(seat.state == "free" for seat in availability),
            active_seats=sum(seat.is_active for seat in seats),
            occupied_seats=sum(s.status == "active" for s in states),
            on_break_seats=sum(s.status == "on_break" for s in states),
            layout=layout_with_seats(room.layout, seats),
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
            user=AdminUser(
                id=state.user_id,
                display_name=(
                    profile.name
                    if (profile := self.session.get(UserProfile, state.user_id))
                    else demo_user(state.user_id).display_name
                ),
            ),
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
                    user=self.admin_details(state, now).user,
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

    @staticmethod
    def map_unit_id(layout: dict) -> str | None:
        boundary = layout.get("room")
        ref = boundary.get("mapRef") if isinstance(boundary, dict) else None
        unit = ref.get("unitId") if isinstance(ref, dict) else None
        return unit if isinstance(unit, str) and unit else None

    def validate_map_binding(self, layout: dict, space_id: UUID | None = None) -> None:
        unit = self.map_unit_id(layout)
        if not unit:
            return
        self.session.execute(
            select(func.pg_advisory_xact_lock(func.hashtext("study-room:" + unit)))
        )
        if space_id is not None and self.room(space_id).map_room_id != unit:
            raise BookingError(400, "room_mismatch", "Layout must use the linked campus room")
        query = select(StudySpace.id).where(
            or_(
                StudySpace.map_room_id == unit,
                StudySpace.layout["room"]["mapRef"]["unitId"].astext == unit,
            ),
        )
        if space_id is not None:
            query = query.where(StudySpace.id != space_id)
        if self.session.scalar(query) is not None:
            raise BookingError(409, "room_registered", "This campus room is already registered")

    def create_space(self, request: CreateSpaceRequest) -> AdminSpaceResponse:
        self.validate_timezone(request.timezone)
        unit = self.map_unit_id(request.layout)
        if unit and unit != request.map_room_id:
            raise BookingError(400, "room_mismatch", "Layout must use the linked campus room")
        self.validate_map_binding(request.layout)
        plans = FloorPlans(self.settings.map_floors_dir).index()
        if plans is None:
            raise BookingError(503, "floor_plans_unavailable", "Floor plans are unavailable")
        place = plans.by_id.get(request.map_room_id)
        if place is None:
            raise RequestValidationError(
                [
                    {
                        "loc": ("body", "map_room_id"),
                        "type": "value_error",
                        "msg": "Unknown map room ID",
                        "input": request.map_room_id,
                    }
                ]
            )
        room = StudySpace(
            **request.model_dump(exclude={"opening_hours"}),
            lat=place["lat"],
            lng=place["lng"],
        )
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
        if request.layout is not None:
            self.validate_map_binding(request.layout, space_id)
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

    def archive_space(self, space_id: UUID, archived: bool) -> AdminSpaceResponse:
        room, seats, now = self.lock_space(space_id)
        if archived and self._live(now, seat_ids=[s.id for s in seats]):
            raise BookingError(
                409,
                "live_reservations",
                "End current and upcoming reservations before deleting this study place",
            )
        if not archived:
            self.validate_map_binding(room.layout or {}, space_id)
        room.is_archived = archived
        self.session.flush()
        return self.space_response(room, now, [])

    def permanently_delete_space(self, space_id: UUID) -> AdminSpaceDeletedResponse:
        room, seats, now = self.lock_space(space_id)
        if not room.is_archived:
            raise BookingError(
                409, "space_not_archived", "Delete this study place before removing it permanently"
            )
        seat_ids = [seat.id for seat in seats]
        if self._live(now, seat_ids=seat_ids):
            raise BookingError(
                409,
                "live_reservations",
                "End current and upcoming reservations "
                "before permanently deleting this study place",
            )
        reservation_ids = select(Reservation.id).where(Reservation.seat_id.in_(seat_ids))
        self.session.execute(delete(Break).where(Break.reservation_id.in_(reservation_ids)))
        # Remove predecessor references first so history chains do not prevent
        # deletion. Any surviving reservation keeps its own history and identity.
        self.session.execute(
            update(Reservation)
            .where(Reservation.previous_reservation_id.in_(reservation_ids))
            .values(previous_reservation_id=None)
        )
        self.session.execute(delete(Reservation).where(Reservation.seat_id.in_(seat_ids)))
        self.session.execute(delete(SpaceClosure).where(SpaceClosure.space_id == space_id))
        self.session.execute(
            delete(SpaceOpeningInterval).where(SpaceOpeningInterval.space_id == space_id)
        )
        self.session.execute(delete(FavouriteSpace).where(FavouriteSpace.space_id == space_id))
        self.session.execute(delete(Seat).where(Seat.space_id == space_id))
        self.session.delete(room)
        self.session.flush()
        return AdminSpaceDeletedResponse(server_time=now, deleted_space_id=space_id)

    def save_layout(self, space_id: UUID, layout: dict, force: bool) -> AdminSpaceOverviewResponse:
        from math import isfinite

        room, seats, now = self.lock_space(space_id)
        if room.is_archived:
            raise BookingError(
                409, "archived_space", "Restore this study place before editing its layout"
            )
        if layout.get("schemaVersion") != 1 or not isinstance(layout.get("objects"), list):
            raise BookingError(400, "invalid_layout", "Expected layout schemaVersion 1 and objects")
        boundary = layout.get("room", {})
        if (
            not isinstance(boundary, dict)
            or not isinstance(boundary.get("points"), list)
            or len(boundary["points"]) < 3
        ):
            raise BookingError(400, "invalid_layout", "A room outline is required")
        measurements = boundary.get("measurements", {})
        if not isinstance(measurements, dict):
            raise BookingError(400, "invalid_layout", "Check room measurements")
        for key in ("width", "height", "widthMeters", "heightMeters"):
            value = boundary.get(key, measurements.get(key))
            if type(value) not in {int, float} or not isfinite(value) or value <= 0:
                raise BookingError(
                    400, "invalid_layout", "Room dimensions must be finite and positive"
                )
        points = boundary["points"]
        if len(points) > 10000 or any(
            not isinstance(p, list)
            or len(p) != 2
            or any(type(v) not in {int, float} or not isfinite(v) for v in p)
            for p in points
        ):
            raise BookingError(400, "invalid_layout", "Check room outline coordinates")
        if (
            abs(
                sum(
                    a[0] * b[1] - b[0] * a[1]
                    for a, b in zip(points, points[1:] + points[:1], strict=True)
                )
            )
            < 0.001
        ):
            raise BookingError(400, "invalid_layout", "Room outline must enclose an area")
        self.validate_map_binding(layout, space_id)
        objects = [dict(o) for o in layout["objects"] if isinstance(o, dict)]
        if len(objects) != len(layout["objects"]) or len(objects) > 2000:
            raise BookingError(400, "invalid_layout", "Use at most 2000 furniture objects")
        ids = [o.get("id") for o in objects]
        if any(not isinstance(i, str) or not i for i in ids) or len(ids) != len(set(ids)):
            raise BookingError(400, "invalid_layout", "Furniture IDs must be unique")
        for item in objects:
            if item.get("type") not in {"table", "row", "seat", "window", "door"} or any(
                type(item.get(k)) not in {int, float} or not isfinite(item[k])
                for k in ("x", "y", "width", "height", "angle")
            ):
                raise BookingError(
                    400, "invalid_layout", "Check furniture types and finite geometry"
                )
            if item["width"] <= 0 or item["height"] <= 0:
                raise BookingError(400, "invalid_layout", "Furniture dimensions must be positive")
            if "active" in item and type(item["active"]) is not bool:
                raise BookingError(400, "invalid_layout", "Seat activation must be a boolean")
        parent_ids = {o["id"] for o in objects if o["type"] in {"table", "row"}}
        configured = [o for o in objects if o["type"] == "seat"]
        if len(configured) > 1000 or any(
            not isinstance(o.get("tableId"), str) or o.get("tableId") not in parent_ids
            for o in configured
        ):
            raise BookingError(400, "invalid_layout", "Each seat needs a table or seat row")
        numbers = [o.get("number") for o in configured]
        if any(type(n) is not int or n < 1 for n in numbers) or sorted(numbers) != list(
            range(1, len(numbers) + 1)
        ):
            raise BookingError(400, "invalid_layout", "Seat numbers must be consecutive from 1")
        by_id = {str(s.id): s for s in seats}
        bound = [o.get("backendSeatId") for o in configured if o.get("backendSeatId")]
        if (
            any(not isinstance(i, str) for i in bound)
            or len(bound) != len(set(bound))
            or any(i not in by_id for i in bound)
        ):
            raise BookingError(
                400, "invalid_seat_binding", "A seat ID must belong to this space and occur once"
            )
        states = self._live(now, seat_ids=[s.id for s in seats])
        # Lock the whole space and move existing labels temporarily: renumbering is atomic.
        for seat in seats:
            seat.label = "~layout-" + str(seat.id)
        self.session.flush()
        assigned = set()
        for item in configured:
            seat = by_id.get(item.get("backendSeatId"))
            if seat is None:
                seat = Seat(
                    space_id=space_id,
                    label=str(item["number"]).zfill(2),
                    qr_token=token_urlsafe(32),
                )
                self.session.add(seat)
                self.session.flush()
            seat.label = str(item["number"]).zfill(2)
            seat.is_active = item.get("active", True) is not False
            item["backendSeatId"] = str(seat.id)
            assigned.add(str(seat.id))
        for seat in seats:
            if str(seat.id) not in assigned:
                seat.is_active = False
                seat.label = "Removed " + str(seat.id)
        for item in objects:
            for key in (
                "state",
                "active",
                "backendLabel",
                "qr_token",
                "qrToken",
                "currentReservation",
                "upcomingReservation",
            ):
                item.pop(key, None)
        room.layout = {**layout, "objects": objects}
        self.apply_policy(states, now, force)
        return self.overview(space_id)

    def users(self):
        from app.features.reservations.admin_schemas import AdminUsersResponse, AdminUserSummary

        now = self.now()
        states = reservation_states(self.session, now)
        profiles = {p.id: p for p in self.session.scalars(select(UserProfile))}
        ids = set(profiles) | {s.user_id for s in states}
        users = []
        for user_id in ids:
            rows = [s for s in states if s.user_id == user_id]
            seconds = 0
            for row in rows:
                if row.checked_in_at is None:
                    continue
                end = min(now, row.effective_ends_at)
                total = max(0, int((end - row.checked_in_at).total_seconds()))
                from app.features.reservations.models import Break

                for pause in self.session.scalars(
                    select(Break).where(Break.reservation_id == row.id)
                ):
                    pause_end = min(end, pause.returned_at or pause.ends_at)
                    total -= max(
                        0,
                        int((pause_end - max(row.checked_in_at, pause.started_at)).total_seconds()),
                    )
                seconds += max(0, total)
            profile = profiles.get(user_id)
            users.append(
                AdminUserSummary(
                    id=user_id,
                    name=profile.name if profile else demo_user(user_id).display_name,
                    reservations=len(rows),
                    study_seconds=seconds,
                    live_reservations=sum(
                        s.status in {"pending", "upcoming", "active", "on_break"} for s in rows
                    ),
                )
            )
        return AdminUsersResponse(
            server_time=now, users=sorted(users, key=lambda u: (u.name, str(u.id)))
        )

    def user_history(self, user_id: UUID):
        from app.features.reservations.admin_schemas import AdminUserHistoryResponse

        result = self.users()
        user = next((u for u in result.users if u.id == user_id), None)
        if user is None:
            raise BookingError(404, "not_found", "User not found")
        rows = reservation_states(self.session, result.server_time, user_id=user_id)
        return AdminUserHistoryResponse(
            server_time=result.server_time,
            user=user,
            reservations=[
                self.admin_details(s, result.server_time)
                for s in sorted(rows, key=lambda s: s.created_at, reverse=True)
            ],
        )

    def update_user(self, user_id: UUID, name: str):
        self.user_history(user_id)
        profile = self.session.get(UserProfile, user_id)
        if profile is None:
            profile = UserProfile(id=user_id, name=name)
            self.session.add(profile)
        else:
            profile.name = name
        self.session.flush()
        return self.user_history(user_id)
