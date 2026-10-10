from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.features.reservations.admin_schemas import (
    CreateClosureRequest,
    CreateSpaceRequest,
    UpdateSeatRequest,
)
from app.features.reservations.admin_service import AdminReservationService
from app.features.reservations.models import (
    Reservation,
    SpaceClosure,
    SpaceOpeningInterval,
    StudySpace,
)
from app.features.reservations.schemas import ReserveSeatRequest
from app.features.reservations.service import BookingError, ReservationService, reservation_states
from tests.conftest import migrate
from tests.reservations.test_reservations import action, book, identity, walk_up

ADMIN = {"X-Demo-Admin": "true"}


def room_path(seats):
    return f"/api/v1/admin/spaces/{seats[0].space_id}"


def seat_path(seats, index=0):
    return f"{room_path(seats)}/seats/{seats[index].id}"


def hours(client, seats, opening_hours, force=False):
    return client.put(
        f"{room_path(seats)}/opening-hours",
        headers=ADMIN,
        params={"force": force},
        json={"opening_hours": opening_hours},
    )


def closure(client, seats, start, end, seat_id=None, force=False):
    return client.post(
        f"{room_path(seats)}/closures",
        headers=ADMIN,
        params={"force": force},
        json={
            "starts_at": start.isoformat(),
            "ends_at": end.isoformat(),
            "seat_id": str(seat_id) if seat_id else None,
            "reason": "Maintenance",
        },
    )


def test_admin_access_and_configuration(client, seats, monkeypatch, policy):
    assert client.get("/api/v1/admin/spaces").status_code == 403
    assert client.get("/api/v1/admin/spaces", headers=ADMIN).status_code == 200
    assert client.get("/api/v1/admin/spaces", headers={"X-Demo-Admin": "yes"}).status_code == 400
    assert (
        client.get("/api/v1/admin/spaces", headers={**ADMIN, "X-Demo-User-Id": "bad"}).status_code
        == 400
    )
    monkeypatch.setattr("app.auth.get_settings", lambda: policy)
    policy.dummy_admin_allow_header = False
    assert client.get("/api/v1/admin/spaces", headers=ADMIN).status_code == 403
    policy.dummy_is_admin = True
    assert client.get("/api/v1/admin/spaces", headers={"X-Demo-Admin": "false"}).status_code == 200


def test_room_and_seat_management(client, seats):
    created = client.post(
        "/api/v1/admin/spaces",
        headers=ADMIN,
        json={
            "name": " New room ",
            "map_room_id": "ETH.HG.E.E_051",
        },
    )
    assert created.status_code == 201, created.text
    room = created.json()["space"]
    assert room["name"] == "New room"
    assert room["timezone"] == "Europe/Zurich"
    assert len(room["opening_hours"]) == 7
    assert room["is_open"] is True and room["total_seats"] == 0
    path = f"/api/v1/admin/spaces/{room['id']}"
    edited = client.patch(path, headers=ADMIN, json={"layout": {"tables": []}, "name": "Edited"})
    assert edited.status_code == 200
    assert edited.json()["space"]["layout"] == {"tables": []}
    added = client.post(f"{path}/seats", headers=ADMIN, json={"label": " B-1 "})
    assert added.status_code == 201, added.text
    seat = added.json()["seat"]
    assert seat["label"] == "B-1" and seat["is_active"] is True
    assert len(seat["qr_token"]) >= 32
    assert client.get(f"{path}/seats/{seat['id']}", headers=ADMIN).json()["seat"] == seat
    assert client.post(f"{path}/seats", headers=ADMIN, json={"label": "B-1"}).status_code == 409
    assert (
        client.patch(seat_path(seats), headers=ADMIN, json={"label": seats[1].label}).status_code
        == 409
    )
    assert client.get(f"{path}/seats/{seats[0].id}", headers=ADMIN).status_code == 404
    assert (
        client.patch(f"{path}/seats/{seat['id']}", headers=ADMIN, json={"label": "B-2"}).status_code
        == 200
    )
    public = client.get(f"/api/v1/spaces/{room['id']}").json()["space"]
    assert public["timezone"] == "Europe/Zurich"
    assert seat["qr_token"] not in str(public)
    assert "qr_token" not in str(public) and "user" not in str(public)


def test_map_room_link_and_coordinates(client, seats):
    response = client.post(
        "/api/v1/admin/spaces",
        headers=ADMIN,
        json={"name": "New room", "map_room_id": "ETH.HG.E.E_051"},
    )
    assert response.status_code == 201, response.text
    created = response.json()["space"]
    assert created["map_room_id"] == "ETH.HG.E.E_051"
    assert (created["lat"], created["lng"]) == (47.300005, 8.500005)
    assert client.get("/api/v1/spaces", params={"map_room_id": "ETH.HG.E.E_051"}).json()[
        "spaces"
    ] == [
        {
            key: value
            for key, value in created.items()
            if key
            in (
                "id",
                "name",
                "map_room_id",
                "lat",
                "lng",
                "timezone",
                "is_open",
                "total_seats",
                "free_seats",
            )
        }
    ]
    assert (
        client.get("/api/v1/spaces", params={"map_room_id": "ETH.HG.E.E_999"}).json()["spaces"]
        == []
    )
    assert (
        client.get(f"/api/v1/spaces/{created['id']}").json()["space"]["map_room_id"]
        == "ETH.HG.E.E_051"
    )
    assert any(
        room["map_room_id"] == "ETH.HG.E.E_051"
        for room in client.get("/api/v1/admin/spaces", headers=ADMIN).json()["spaces"]
    )
    assert (
        client.get(f"/api/v1/admin/spaces/{created['id']}/overview", headers=ADMIN).json()["space"][
            "map_room_id"
        ]
        == "ETH.HG.E.E_051"
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "Missing"},
        {"name": "Empty", "map_room_id": " "},
        {"name": "Unknown", "map_room_id": "ETH.HG.E.E_999"},
        {"name": "Client coordinate", "map_room_id": "ETH.HG.E.E_051", "lat": 0},
    ],
)
def test_create_requires_existing_map_room(client, payload):
    assert client.post("/api/v1/admin/spaces", headers=ADMIN, json=payload).status_code == 422


def test_map_room_link_is_unique_and_immutable(client, seats):
    duplicate = client.post(
        "/api/v1/admin/spaces",
        headers=ADMIN,
        json={"name": "Duplicate", "map_room_id": "ETH.HG.E.E_007"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "map_room_already_linked"
    for patch in ({"map_room_id": "ETH.HG.E.E_051"}, {"lat": 0}, {"lng": 0}):
        assert client.patch(room_path(seats), headers=ADMIN, json=patch).status_code == 422


def test_unnamed_suffixed_room_is_selectable(client):
    response = client.post(
        "/api/v1/admin/spaces",
        headers=ADMIN,
        json={"name": "HIL", "map_room_id": "ETH.HIL.E.E_002.1"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["space"]["map_room_id"] == "ETH.HIL.E.E_002.1"


def test_create_fails_when_floor_plans_unavailable(client, policy, tmp_path):
    policy.map_floors_dir = tmp_path / "missing"
    response = client.post(
        "/api/v1/admin/spaces",
        headers=ADMIN,
        json={"name": "Unavailable", "map_room_id": "ETH.HG.E.E_051"},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "floor_plans_unavailable"
    assert client.get("/api/v1/spaces").status_code == 200


def test_create_fails_when_a_floor_level_is_unreadable(client, policy):
    (policy.map_floors_dir / "levels" / "ETH.HG.E.json").unlink()
    response = client.post(
        "/api/v1/admin/spaces",
        headers=ADMIN,
        json={"name": "Unavailable", "map_room_id": "ETH.HG.E.E_051"},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "floor_plans_unavailable"


def test_concurrent_creates_cannot_link_same_map_room(db, policy):
    barrier = Barrier(2)

    def create() -> bool:
        with Session(db) as session:
            service = AdminReservationService(session, policy)
            barrier.wait(timeout=10)
            try:
                service.create_space(
                    CreateSpaceRequest(name="Concurrent", map_room_id="ETH.HG.E.E_051")
                )
                session.commit()
                return True
            except IntegrityError:
                session.rollback()
                return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(lambda _: create(), range(2))) == [False, True]
    with Session(db) as session:
        assert session.scalar(select(func.count()).select_from(StudySpace)) == 1


@pytest.mark.parametrize(
    "payload",
    [{}, {"name": None}, {"name": " "}, {"timezone": "bad"}, {"lat": 91}, {"unrecognized": True}],
)
def test_room_patch_validation(client, seats, payload):
    assert client.patch(room_path(seats), headers=ADMIN, json=payload).status_code == 422


@pytest.mark.parametrize("payload", [{}, {"label": None}, {"is_active": None}, {"label": " "}])
def test_seat_patch_validation(client, seats, payload):
    assert client.patch(seat_path(seats), headers=ADMIN, json=payload).status_code == 422


def test_inactive_seats_and_any_assignment(client, seats):
    disabled = client.patch(seat_path(seats), headers=ADMIN, json={"is_active": False})
    assert disabled.status_code == 200
    public = client.get(f"/api/v1/spaces/{seats[0].space_id}").json()["space"]
    assert public["free_seats"] == 2
    assert public["seats"][0]["state"] == "unavailable"
    assert public["seats"][0]["reservable_at"] is None
    assert public["seats"][0]["is_active"] is False
    assert book(client, seats[0]).status_code == 409
    assert walk_up(client, seats[0]).status_code == 409
    any_booking = client.post(
        "/api/v1/reservations", json={"kind": "any", "space_id": str(seats[0].space_id)}
    )
    assert any_booking.json()["reservation"]["seat"]["id"] == str(seats[1].id)
    assert (
        client.patch(seat_path(seats), headers=ADMIN, json={"is_active": True}).status_code == 200
    )
    assert book(client, seats[0], identity()).status_code == 201


def test_short_booking_at_closing_and_deadline(client, seats, clock):
    response = hours(client, seats, [{"weekday": 1, "start_minute": 660, "end_minute": 665}])
    assert response.status_code == 200, response.text
    reserved = book(client, seats[0]).json()["reservation"]
    expected = (clock.value + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    assert reserved["ends_at"] == expected and reserved["check_in_deadline"] == expected
    assert walk_up(client, seats[0]).json()["reservation"]["status"] == "active"
    assert (
        "extend"
        not in client.get("/api/v1/me/reservation").json()["reservation"]["available_actions"]
    )
    assert action(client, reserved["id"], "extend").status_code == 409
    clock.advance(minutes=5)
    assert book(client, seats[1], identity()).status_code == 409
    assert walk_up(client, seats[1], identity()).status_code == 409
    assert client.get(f"/api/v1/spaces/{seats[0].space_id}").json()["space"]["is_open"] is False


def test_extension_clamps_to_closure(client, seats, clock):
    closing = clock.value + timedelta(minutes=135)
    assert closure(client, seats, closing, closing + timedelta(hours=1)).status_code == 201
    reserved = walk_up(client, seats[0]).json()["reservation"]
    clock.advance(minutes=100)
    extended = action(client, reserved["id"], "extend")
    assert extended.status_code == 200
    assert extended.json()["reservation"]["ends_at"] == closing.isoformat().replace("+00:00", "Z")
    assert "extend" not in extended.json()["reservation"]["available_actions"]


def test_hours_validation_and_midnight_continuity(client, seats, clock):
    assert (
        hours(
            client,
            seats,
            [
                {"weekday": 1, "start_minute": 600, "end_minute": 700},
                {"weekday": 1, "start_minute": 650, "end_minute": 800},
            ],
        ).status_code
        == 422
    )
    assert (
        hours(client, seats, [{"weekday": 7, "start_minute": 0, "end_minute": 1440}]).status_code
        == 422
    )
    assert (
        hours(client, seats, [{"weekday": 1, "start_minute": 100, "end_minute": 100}]).status_code
        == 422
    )
    # Tuesday 23:30 local, continuous across midnight with adjacent intervals.
    clock.value = datetime(2030, 1, 1, 22, 30, tzinfo=UTC)
    schedule = [
        {"weekday": 1, "start_minute": 1380, "end_minute": 1440},
        {"weekday": 2, "start_minute": 0, "end_minute": 60},
        {"weekday": 2, "start_minute": 60, "end_minute": 120},
    ]
    assert hours(client, seats, schedule).status_code == 200
    reserved = book(client, seats[0]).json()["reservation"]
    assert reserved["ends_at"] == (clock.value + timedelta(hours=2)).isoformat().replace(
        "+00:00", "Z"
    )


@pytest.mark.parametrize(
    "start,expected",
    [
        (datetime(2030, 3, 31, 0, 30, tzinfo=UTC), datetime(2030, 3, 31, 1, 0, tzinfo=UTC)),
        (datetime(2030, 10, 27, 0, 30, tzinfo=UTC), datetime(2030, 10, 27, 2, 0, tzinfo=UTC)),
    ],
)
def test_zurich_dst_uses_actual_instants(client, seats, clock, start, expected):
    clock.value = start
    # Sunday 01:00 through 03:00; the autumn repeated hour remains open.
    assert (
        hours(client, seats, [{"weekday": 6, "start_minute": 60, "end_minute": 180}]).status_code
        == 200
    )
    reserved = walk_up(client, seats[0]).json()["reservation"]
    assert reserved["ends_at"] == expected.isoformat().replace("+00:00", "Z")


def test_deactivation_preview_rolls_back_and_force_cancels_successor(client, seats, clock):
    owner = identity()
    occupied = walk_up(client, seats[0], owner).json()["reservation"]
    clock.advance(minutes=110)
    upcoming = book(client, seats[0]).json()["reservation"]
    preview = client.patch(seat_path(seats), headers=ADMIN, json={"is_active": False})
    assert preview.status_code == 409
    impacts = preview.json()["reservation_impacts"]
    assert {i["reservation_id"] for i in impacts} == {occupied["id"], upcoming["id"]}
    assert {i["action"] for i in impacts} == {"cancel", "shorten"}
    assert client.get(seat_path(seats), headers=ADMIN).json()["seat"]["is_active"] is True
    assert (
        client.get("/api/v1/me/reservation").json()["reservation"]["ends_at"] == upcoming["ends_at"]
    )
    applied = client.patch(
        seat_path(seats), headers=ADMIN, params={"force": True}, json={"is_active": False}
    )
    assert applied.status_code == 200, applied.text
    assert len(applied.json()["reservation_impacts"]) == 2
    assert client.get("/api/v1/me/reservation", headers=owner).json()["reservation"] is None
    assert client.get("/api/v1/me/reservation").json()["reservation"] is None
    client.patch(seat_path(seats), headers=ADMIN, json={"is_active": True})
    assert client.get("/api/v1/me/reservation").json()["reservation"] is None
    assert book(client, seats[0]).status_code == 201


def test_hours_and_timezone_conflicts(client, seats, clock):
    reserved = walk_up(client, seats[0]).json()["reservation"]
    original = client.get(f"{room_path(seats)}/overview", headers=ADMIN).json()["space"][
        "opening_hours"
    ]
    assert hours(client, seats, []).status_code == 409
    assert (
        client.get(f"{room_path(seats)}/overview", headers=ADMIN).json()["space"]["opening_hours"]
        == original
    )
    # Current local time 11:00; these hours shorten the active booking to 11:30.
    limited = [{"weekday": 1, "start_minute": 660, "end_minute": 690}]
    assert hours(client, seats, limited, force=True).status_code == 200
    preview = client.patch(room_path(seats), headers=ADMIN, json={"timezone": "UTC"})
    assert preview.status_code == 409
    assert (
        client.get(f"{room_path(seats)}/overview", headers=ADMIN).json()["space"]["timezone"]
        == "Europe/Zurich"
    )
    forced = client.patch(
        room_path(seats), headers=ADMIN, params={"force": True}, json={"timezone": "UTC"}
    )
    assert forced.status_code == 200
    assert forced.json()["reservation_impacts"][0]["reservation_id"] == reserved["id"]
    assert client.get("/api/v1/me/reservation").json()["reservation"] is None


def test_closure_preview_filters_and_removal(client, seats, clock):
    reserved = walk_up(client, seats[0]).json()["reservation"]
    start = clock.value + timedelta(minutes=5)
    end = start + timedelta(hours=1)
    preview = closure(client, seats, start, end, seats[0].id)
    assert preview.status_code == 409
    assert client.get(f"{room_path(seats)}/closures", headers=ADMIN).json()["closures"] == []
    created = closure(client, seats, start, end, seats[0].id, force=True)
    assert created.status_code == 201, created.text
    data = created.json()
    assert data["reservation_impacts"][0]["new_ends_at"] == start.isoformat().replace("+00:00", "Z")
    closure_id = data["closure"]["id"]
    assert closure(client, seats, start, end, uuid4()).status_code == 404
    assert closure(client, seats, clock.value - timedelta(hours=2), clock.value).status_code == 400
    filtered = client.get(
        f"{room_path(seats)}/closures", headers=ADMIN, params={"starts_at": end.isoformat()}
    )
    assert filtered.json()["closures"] == []
    assert (
        client.get(
            f"{room_path(seats)}/closures",
            headers=ADMIN,
            params={"starts_at": end.isoformat(), "ends_at": start.isoformat()},
        ).status_code
        == 400
    )
    clock.advance(minutes=5)
    public = client.get(f"/api/v1/spaces/{seats[0].space_id}").json()["space"]
    assert public["is_open"] is True and public["free_seats"] == 2
    assert "Maintenance" not in str(public)
    assert book(client, seats[0]).status_code == 409
    removed = client.delete(f"{room_path(seats)}/closures/{closure_id}", headers=ADMIN)
    assert removed.status_code == 200
    assert client.get("/api/v1/me/reservation").json()["reservation"] is None
    assert action(client, reserved["id"], "end").json()["reservation"]["status"] == "ended"
    assert book(client, seats[0]).status_code == 201


def test_overlapping_closures_and_precise_boundaries(client, seats, clock):
    start = clock.value + timedelta(seconds=90, microseconds=123)
    assert closure(client, seats, start, start + timedelta(minutes=5)).status_code == 201
    assert (
        closure(
            client, seats, start + timedelta(minutes=2), start + timedelta(minutes=10)
        ).status_code
        == 201
    )
    reserved = walk_up(client, seats[0]).json()["reservation"]
    assert reserved["ends_at"] == start.isoformat().replace("+00:00", "Z")
    clock.value = start
    assert book(client, seats[1], identity()).status_code == 409
    clock.value = start + timedelta(minutes=5)
    assert book(client, seats[1], identity()).status_code == 409
    clock.value = start + timedelta(minutes=10)
    assert book(client, seats[1], identity()).status_code == 201


def test_overview_contains_current_pending_and_next_without_qr(client, seats, clock):
    owner = identity()
    current = walk_up(client, seats[0], owner).json()["reservation"]
    clock.advance(minutes=110)
    next_booking = book(client, seats[0]).json()["reservation"]
    pending_user = identity()
    pending = book(client, seats[1], pending_user).json()["reservation"]
    assert action(client, current["id"], "break", owner).status_code == 200
    data = client.get(f"{room_path(seats)}/overview", headers=ADMIN).json()["space"]
    assert data["occupied_seats"] == 0 and data["on_break_seats"] == 1
    assert data["active_seats"] == 3 and data["free_seats"] == 1
    first, second, third = data["seats"]
    assert first["current_reservation"]["status"] == "on_break"
    assert first["upcoming_reservation"]["id"] == next_booking["id"]
    assert first["current_reservation"]["user"] == {
        "id": owner["X-Demo-User-Id"],
        "display_name": f"Demo user {owner['X-Demo-User-Id']}",
    }
    assert second["current_reservation"]["id"] == pending["id"]
    assert third["current_reservation"] is None and third["upcoming_reservation"] is None
    assert "qr_token" not in str(data)


@pytest.mark.parametrize("kind", ["active", "pending", "on_break", "upcoming"])
def test_admin_end_is_idempotent_and_user_can_rebook(client, seats, clock, kind):
    user = identity()
    if kind == "upcoming":
        walk_up(client, seats[0], identity())
        clock.advance(minutes=110)
        reserved = book(client, seats[0], user).json()["reservation"]
    elif kind == "pending":
        reserved = book(client, seats[0], user).json()["reservation"]
    else:
        reserved = walk_up(client, seats[0], user).json()["reservation"]
        if kind == "on_break":
            action(client, reserved["id"], "break", user)
    path = f"/api/v1/admin/reservations/{reserved['id']}/end"
    ended = client.post(path, headers=ADMIN)
    assert ended.status_code == 200, ended.text
    assert ended.json()["reservation"]["status"] == "ended"
    assert client.post(path, headers=ADMIN).json()["reservation"] == ended.json()["reservation"]
    assert book(client, seats[1], user).status_code == 201


def test_handover_does_not_advance_into_blocked_time(client, seats, clock, db):
    owner = identity()
    current = walk_up(client, seats[0], owner).json()["reservation"]
    clock.advance(minutes=110)
    successor = book(client, seats[0]).json()["reservation"]
    # Block the remaining current session, ending exactly at the successor start.
    end = clock.value + timedelta(minutes=10)
    created = closure(client, seats, clock.value, end, force=True)
    assert created.status_code == 201, created.text
    assert client.get("/api/v1/me/reservation", headers=owner).json()["reservation"] is None
    unchanged = client.get("/api/v1/me/reservation").json()["reservation"]
    assert unchanged["id"] == successor["id"] and unchanged["starts_at"] == successor["starts_at"]
    assert unchanged["status"] == "upcoming"
    with Session(db) as session:
        states = {s.id: s for s in reservation_states(session, clock.value)}
        assert states[UUID(current["id"])].status == "ended"
        assert states[UUID(successor["id"])].effective_starts_at == end
    clock.advance(minutes=10)
    assert walk_up(client, seats[0]).json()["reservation"]["id"] == successor["id"]


def test_safe_admin_handover_and_no_show_cleanup(client, seats, clock):
    current = walk_up(client, seats[0], identity()).json()["reservation"]
    clock.advance(minutes=110)
    upcoming = book(client, seats[0]).json()["reservation"]
    ended = client.post(f"/api/v1/admin/reservations/{current['id']}/end", headers=ADMIN)
    assert ended.status_code == 200
    shifted = client.get("/api/v1/me/reservation").json()["reservation"]
    assert shifted["starts_at"] == clock.value.isoformat().replace("+00:00", "Z")
    assert shifted["id"] == upcoming["id"]
    clock.advance(minutes=15)
    # Expired pending reservations do not require force when closing the room.
    assert hours(client, seats, []).status_code == 200


def test_database_closure_ownership_and_opening_constraints(db, seats, clock):
    with Session(db) as session:
        other = StudySpace(name="Other", map_room_id="ETH.HG.E.E_051", lat=0, lng=0)
        session.add(other)
        session.commit()
        other_id = other.id
        session.add(
            SpaceClosure(
                space_id=other_id,
                seat_id=seats[0].id,
                starts_at=clock.value,
                ends_at=clock.value + timedelta(hours=1),
            )
        )
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
        session.add(
            SpaceOpeningInterval(
                space_id=seats[0].space_id, weekday=1, start_minute=600, end_minute=700
            )
        )
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


@pytest.mark.parametrize("change", ["disable", "closure", "hours"])
def test_booking_races_admin_policy(db, seats, clock, policy, change):
    barrier = Barrier(2)

    def booking():
        with Session(db) as session:
            service = ReservationService(session, policy)
            barrier.wait(timeout=10)
            try:
                service.reserve(uuid4(), ReserveSeatRequest(kind="seat", seat_id=seats[0].id))
                session.commit()
            except BookingError:
                session.rollback()

    def management():
        with Session(db) as session:
            service = AdminReservationService(session, policy)
            barrier.wait(timeout=10)
            if change == "disable":
                service.update_seat(
                    seats[0].space_id, seats[0].id, UpdateSeatRequest(is_active=False), True
                )
            elif change == "closure":
                service.create_closure(
                    seats[0].space_id,
                    CreateClosureRequest(
                        starts_at=clock.value, ends_at=clock.value + timedelta(hours=1)
                    ),
                    True,
                )
            else:
                from app.features.reservations.admin_schemas import ReplaceOpeningHoursRequest

                service.replace_hours(
                    seats[0].space_id, ReplaceOpeningHoursRequest(opening_hours=[]), True
                )
            session.commit()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(booking), executor.submit(management)]
        for future in futures:
            future.result(timeout=20)
    with Session(db) as session:
        assert reservation_states(session, clock.value, live_only=True) == []
        assert (
            session.scalar(
                select(
                    func.seat_reservation_end_at(
                        seats[0].id, clock.value, clock.value + timedelta(hours=1)
                    )
                )
            )
            is None
        )


def test_previous_migration_backfills_existing_rooms_without_losing_data(db):
    migrate(db, "c63ce97b97f2", downgrade=True)
    room_id, seat_id = uuid4(), uuid4()
    with db.begin() as connection:
        connection.execute(
            text("INSERT INTO study_spaces (id, name, lat, lng) VALUES (:id, 'Existing', 0, 0)"),
            {"id": room_id},
        )
        connection.execute(
            text(
                "INSERT INTO seats (id, space_id, label, qr_token) "
                "VALUES (:id, :room, 'A', 'existing-qr')"
            ),
            {"id": seat_id, "room": room_id},
        )
    migrate(db, "ebf07ff4bdc4")
    with db.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT timezone FROM study_spaces WHERE id = :id"), {"id": room_id}
            )
            == "Europe/Zurich"
        )
        assert (
            connection.scalar(text("SELECT is_active FROM seats WHERE id = :id"), {"id": seat_id})
            is True
        )
        assert (
            connection.scalar(text("SELECT qr_token FROM seats WHERE id = :id"), {"id": seat_id})
            == "existing-qr"
        )
        assert (
            connection.scalar(
                text("SELECT count(*) FROM space_opening_intervals WHERE space_id = :id"),
                {"id": room_id},
            )
            == 7
        )
    with db.begin() as connection:
        connection.execute(text("DELETE FROM seats WHERE id = :id"), {"id": seat_id})
        connection.execute(
            text("DELETE FROM space_opening_intervals WHERE space_id = :id"), {"id": room_id}
        )
        connection.execute(text("DELETE FROM study_spaces WHERE id = :id"), {"id": room_id})
    migrate(db)


def test_map_room_migration_rejects_existing_spaces(db):
    migrate(db, "a1f3c7d92e54", downgrade=True)
    room_id = uuid4()
    with db.begin() as connection:
        connection.execute(
            text("INSERT INTO study_spaces (id, name, lat, lng) VALUES (:id, 'Existing', 0, 0)"),
            {"id": room_id},
        )
    with pytest.raises(Exception, match="study_spaces must be empty"):
        migrate(db)
    with db.begin() as connection:
        connection.execute(text("DELETE FROM study_spaces WHERE id = :id"), {"id": room_id})
    migrate(db)
    with db.connect() as connection:
        columns = connection.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = 'study_spaces' "
                "AND column_name = 'map_room_id'"
            )
        ).scalar_one()
        assert columns == "NO"
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM pg_constraint "
                    "WHERE conname = 'study_spaces_map_room_id_key' "
                    "AND connamespace = current_schema()::regnamespace"
                )
            )
            == 1
        )


def test_reopening_previews_successor_shift_before_applying(client, seats, clock, db):
    owner = identity()
    walk_up(client, seats[0], owner)
    clock.advance(minutes=110)
    booking = book(client, seats[0]).json()["reservation"]
    # Close until the successor's scheduled start, ending the predecessor now.
    # Then replace hours to reopen the gap without directly shortening a booking.
    schedule = [{"weekday": 1, "start_minute": 780, "end_minute": 1440}]
    assert hours(client, seats, schedule, force=True).status_code == 200
    before = client.get("/api/v1/me/reservation").json()["reservation"]
    assert before == booking
    with Session(db) as session:
        row = session.get(Reservation, UUID(booking["id"]))
        stored_before = (
            row.starts_at,
            row.ends_at,
            row.check_in_deadline,
            row.previous_reservation_id,
        )
    reopened = [{"weekday": day, "start_minute": 0, "end_minute": 1440} for day in range(7)]
    preview = hours(client, seats, reopened)
    assert preview.status_code == 409, preview.text
    impact = preview.json()["reservation_impacts"][0]
    assert impact["reservation_id"] == booking["id"]
    assert impact["action"] == "shift"
    assert impact["previous_starts_at"] == booking["starts_at"]
    assert impact["previous_check_in_deadline"] == booking["check_in_deadline"]
    assert impact["previous_ends_at"] == booking["ends_at"]
    assert impact["new_ends_at"] == (clock.value + timedelta(hours=2)).isoformat().replace(
        "+00:00", "Z"
    )
    assert client.get("/api/v1/me/reservation").json()["reservation"] == before
    with Session(db) as session:
        row = session.get(Reservation, UUID(booking["id"]))
        assert (
            row.starts_at,
            row.ends_at,
            row.check_in_deadline,
            row.previous_reservation_id,
        ) == stored_before
    assert (
        client.get(f"{room_path(seats)}/overview", headers=ADMIN).json()["space"]["opening_hours"]
        == schedule
    )
    applied = hours(client, seats, reopened, force=True)
    assert applied.status_code == 200
    assert applied.json()["reservation_impacts"] == preview.json()["reservation_impacts"]
    shifted = client.get("/api/v1/me/reservation").json()["reservation"]
    assert shifted["starts_at"] == clock.value.isoformat().replace("+00:00", "Z")
    assert shifted["check_in_deadline"] == (
        clock.value + timedelta(minutes=15)
    ).isoformat().replace("+00:00", "Z")


@pytest.mark.parametrize("operation", ["create", "update"])
def test_postgres_rejects_host_local_timezone_as_validation_error(client, seats, db, operation):
    with Session(db) as session:
        assert not session.scalar(
            text("SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = 'localtime')")
        )
    if operation == "create":
        response = client.post(
            "/api/v1/admin/spaces",
            headers=ADMIN,
            json={
                "name": "Unsupported timezone",
                "map_room_id": "ETH.HG.E.E_051",
                "timezone": "localtime",
            },
        )
    else:
        response = client.patch(room_path(seats), headers=ADMIN, json={"timezone": "localtime"})
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["body", "timezone"]
    assert (
        client.get(f"{room_path(seats)}/overview", headers=ADMIN).json()["space"]["timezone"]
        == "Europe/Zurich"
    )


def test_removing_closure_previews_successor_shift(client, seats, clock):
    walk_up(client, seats[0], identity())
    clock.advance(minutes=110)
    booking = book(client, seats[0]).json()["reservation"]
    created = closure(client, seats, clock.value, clock.value + timedelta(minutes=10), force=True)
    assert created.status_code == 201
    closure_id = created.json()["closure"]["id"]
    path = f"{room_path(seats)}/closures/{closure_id}"
    preview = client.delete(path, headers=ADMIN)
    assert preview.status_code == 409, preview.text
    impact = preview.json()["reservation_impacts"][0]
    assert impact["action"] == "shift"
    assert impact["previous_starts_at"] == booking["starts_at"]
    assert impact["previous_check_in_deadline"] == booking["check_in_deadline"]
    assert client.get("/api/v1/me/reservation").json()["reservation"] == booking
    assert (
        client.get(f"{room_path(seats)}/closures", headers=ADMIN).json()["closures"][0]["id"]
        == closure_id
    )
    removed = client.delete(path, headers=ADMIN, params={"force": True})
    assert removed.status_code == 200
    assert removed.json()["reservation_impacts"] == preview.json()["reservation_impacts"]
    assert client.get(f"{room_path(seats)}/closures", headers=ADMIN).json()["closures"] == []


@pytest.mark.parametrize("operation", ["create", "update"])
def test_timezone_validation_checks_database_catalog(client, seats, monkeypatch, operation):
    # A host's catalog can expose extra names. PostgreSQL is the final authority
    # even when the request passes the Python-side named-timezone validator.
    from app.features.reservations import admin_schemas

    monkeypatch.setattr(
        admin_schemas, "NAMED_TIMEZONES", admin_schemas.NAMED_TIMEZONES | {"localtime"}
    )
    if operation == "create":
        response = client.post(
            "/api/v1/admin/spaces",
            headers=ADMIN,
            json={
                "name": "Unsupported timezone",
                "map_room_id": "ETH.HG.E.E_051",
                "timezone": "localtime",
            },
        )
    else:
        response = client.patch(room_path(seats), headers=ADMIN, json={"timezone": "localtime"})
    assert response.status_code == 422, response.text
    assert "PostgreSQL" in response.json()["detail"][0]["msg"]
    assert response.json()["detail"][0]["loc"] == ["body", "timezone"]
