from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.features.reservations.schemas import ReserveSeatRequest
from app.features.reservations.seed import seed_demo
from app.features.reservations.service import BookingError, ReservationService, reservation_states
from app.models import Break, Reservation, Seat
from tests.conftest import migrate


def identity(user: UUID | None = None) -> dict[str, str]:
    return {"X-Demo-User-Id": str(user or uuid4())}


def book(client: TestClient, seat: Seat, headers: dict | None = None):
    return client.post(
        "/api/v1/reservations",
        json={"kind": "seat", "seat_id": str(seat.id)},
        headers=headers,
    )


def walk_up(client: TestClient, seat: Seat, headers: dict | None = None):
    return client.post("/api/v1/check-ins", json={"qr_token": seat.qr_token}, headers=headers)


def action(client: TestClient, reservation_id: str, name: str, headers: dict | None = None):
    return client.post(f"/api/v1/reservations/{reservation_id}/{name}", headers=headers)


def test_reservation_check_in_privacy_and_end(client, seats, clock):
    assert client.get("/api/v1/me/reservation").json()["reservation"] is None
    response = book(client, seats[0])
    assert response.status_code == 201, response.text
    reservation = response.json()["reservation"]
    assert reservation["status"] == "pending"
    assert reservation["available_actions"] == ["check_in", "end"]
    assert book(client, seats[1]).status_code == 409
    assert walk_up(client, seats[1]).status_code == 409
    assert action(client, reservation["id"], "end", identity()).status_code == 404

    detail = client.get(f"/api/v1/spaces/{seats[0].space_id}").json()["space"]
    assert detail["free_seats"] == 2
    assert detail["layout"] == {}
    assert detail["seats"][0]["state"] == "reserved"
    assert "user_id" not in str(detail) and "qr_token" not in str(detail)
    assert seats[0].qr_token not in str(detail)

    clock.advance(minutes=1)
    checked = walk_up(client, seats[0]).json()["reservation"]
    assert checked["id"] == reservation["id"]
    assert checked["status"] == "active"
    assert walk_up(client, seats[0]).json()["reservation"] == checked
    assert action(client, checked["id"], "extend").status_code == 409
    assert action(client, checked["id"], "end").json()["reservation"]["status"] == "ended"
    assert action(client, checked["id"], "end").status_code == 200
    assert client.get("/api/v1/me/reservation").json()["reservation"] is None


def test_proxy_reservation_ownership(client, seats, policy):
    policy.auth_mode = "proxy"
    owner = {"X-User-Id": "student@ethz.ch"}
    other = {
        "X-User-Id": "other@ethz.ch",
        "X-Demo-User-Id": "42d57044-31ad-52df-a975-b5a625501b3f",
    }
    response = book(client, seats[0], owner)
    assert response.status_code == 201
    reservation_id = response.json()["reservation"]["id"]
    mine = client.get("/api/v1/me/reservation", headers=owner).json()["reservation"]
    assert mine["id"] == reservation_id
    assert client.get("/api/v1/me/reservation", headers=other).json()["reservation"] is None
    assert action(client, reservation_id, "end", other).status_code == 404
    assert action(client, reservation_id, "end", owner).status_code == 200


def test_reserve_any_only_uses_free_seats(client, seats, clock):
    walk_up(client, seats[0], identity())
    walk_up(client, seats[1], identity())
    walk_up(client, seats[2], identity())
    clock.advance(minutes=110)
    response = client.post(
        "/api/v1/reservations", json={"kind": "any", "space_id": str(seats[0].space_id)}
    )
    assert response.status_code == 409
    assert book(client, seats[0]).json()["reservation"]["status"] == "upcoming"


def test_reserve_any_and_empty_space(client, seats):
    response = client.post(
        "/api/v1/reservations", json={"kind": "any", "space_id": str(seats[0].space_id)}
    )
    assert response.status_code == 201
    assert response.json()["reservation"]["seat"]["id"] == str(seats[0].id)
    spaces = client.get("/api/v1/spaces").json()["spaces"]
    empty = next(space for space in spaces if space["total_seats"] == 0)
    assert empty["free_seats"] == 0
    assert client.get(f"/api/v1/spaces/{empty['id']}").json()["space"]["seats"] == []


def test_priority_public_boundary_and_next_reservation(client, seats, clock):
    owner = identity()
    occupant = walk_up(client, seats[0], owner).json()["reservation"]
    clock.advance(minutes=100, seconds=-0.001)
    assert action(client, occupant["id"], "extend", owner).status_code == 409
    clock.advance(seconds=0.001)
    mine = client.get("/api/v1/me/reservation", headers=owner).json()["reservation"]
    assert "extend" in mine["available_actions"]
    assert book(client, seats[0]).status_code == 409
    clock.advance(minutes=10, seconds=-0.001)
    assert book(client, seats[0]).status_code == 409
    clock.advance(seconds=0.001)
    next_booking = book(client, seats[0]).json()["reservation"]
    assert next_booking["status"] == "upcoming"
    assert walk_up(client, seats[0]).status_code == 409
    assert action(client, occupant["id"], "extend", owner).status_code == 409
    assert book(client, seats[1]).status_code == 409
    clock.advance(minutes=10)
    assert client.get("/api/v1/me/reservation", headers=owner).json()["reservation"] is None
    assert walk_up(client, seats[0]).json()["reservation"]["id"] == next_booking["id"]


def test_extension_uses_config_without_replenishing_break_budget(client, seats, clock, policy):
    reservation = walk_up(client, seats[0]).json()["reservation"]
    action(client, reservation["id"], "break")
    clock.advance(minutes=10)
    action(client, reservation["id"], "return")
    policy.break_budget_minutes = 99
    policy.session_length_minutes = 60
    clock.advance(minutes=90)
    extended = action(client, reservation["id"], "extend").json()["reservation"]
    assert extended["ends_at"] == (clock.value + timedelta(minutes=80)).isoformat().replace(
        "+00:00", "Z"
    )
    assert extended["break_seconds_remaining"] == 1200


def test_session_clock_starts_at_the_scan(client, seats, clock):
    booked = book(client, seats[0]).json()["reservation"]
    clock.advance(minutes=7)
    checked = walk_up(client, seats[0]).json()["reservation"]
    assert checked["status"] == "active"
    scan = clock.value
    assert checked["ends_at"] == (scan + timedelta(minutes=120)).isoformat().replace("+00:00", "Z")
    assert checked["starts_at"] == booked["starts_at"]
    # Scanning again changes nothing.
    clock.advance(minutes=1)
    again = walk_up(client, seats[0]).json()["reservation"]
    assert again["ends_at"] == checked["ends_at"]


def test_check_in_deadline_and_stale_user_cleanup(client, seats, clock, db):
    first = book(client, seats[0]).json()["reservation"]
    deadline = clock.value + timedelta(minutes=15)
    with Session(db) as session:
        before = reservation_states(session, deadline - timedelta(microseconds=1))[0]
        exactly = reservation_states(session, deadline)[0]
        assert before.status == "pending"
        assert exactly.status == "no_show"
    clock.advance(minutes=15)
    assert client.get("/api/v1/me/reservation").json()["reservation"] is None
    second = book(client, seats[1])
    assert second.status_code == 201, second.text
    with Session(db) as session:
        assert session.get(Reservation, UUID(first["id"])).ends_at == deadline


def test_reclaim_no_show_on_same_seat(client, seats, clock):
    first = book(client, seats[0], identity()).json()["reservation"]
    clock.advance(minutes=15)
    replacement = walk_up(client, seats[0])
    assert replacement.status_code == 200
    assert replacement.json()["reservation"]["id"] != first["id"]


def test_cumulative_breaks_expiry_and_extension_on_break(client, seats, clock):
    reservation = walk_up(client, seats[0]).json()["reservation"]
    reservation_id = reservation["id"]
    assert action(client, reservation_id, "break").status_code == 200
    assert action(client, reservation_id, "break").status_code == 409
    clock.advance(minutes=10)
    returned = action(client, reservation_id, "return").json()["reservation"]
    assert returned["break_seconds_remaining"] == 1200
    clock.advance(minutes=90)
    on_break = action(client, reservation_id, "break").json()["reservation"]
    assert "extend" in on_break["available_actions"]
    assert action(client, reservation_id, "extend").status_code == 200
    clock.advance(minutes=20)
    assert action(client, reservation_id, "return").status_code == 409
    assert client.get("/api/v1/me/reservation").json()["reservation"] is None
    assert book(client, seats[1]).status_code == 201


def test_break_return_just_before_deadline(client, seats, clock):
    reservation = walk_up(client, seats[0]).json()["reservation"]
    action(client, reservation["id"], "break")
    clock.advance(minutes=30, seconds=-1)
    returned = action(client, reservation["id"], "return")
    assert returned.status_code == 200
    assert returned.json()["reservation"]["break_seconds_remaining"] == 1
    action(client, reservation["id"], "break")
    clock.advance(seconds=1)
    assert action(client, reservation["id"], "return").status_code == 409


def test_early_checkout_shifts_full_next_session_and_future_cancel(client, seats, clock, db):
    owner = identity()
    occupant = walk_up(client, seats[0], owner).json()["reservation"]
    clock.advance(minutes=110)
    next_booking = book(client, seats[0]).json()["reservation"]
    cancelled = action(client, next_booking["id"], "end")
    assert cancelled.status_code == 200
    assert cancelled.json()["reservation"]["status"] == "ended"
    replacement = book(client, seats[0]).json()["reservation"]
    assert replacement["id"] != next_booking["id"]
    clock.advance(minutes=1)
    assert action(client, occupant["id"], "end", owner).status_code == 200
    mine = client.get("/api/v1/me/reservation").json()["reservation"]
    assert mine["status"] == "pending"
    with Session(db) as session:
        row = session.get(Reservation, UUID(mine["id"]))
        assert row.starts_at == clock.value
        assert row.ends_at == clock.value + timedelta(minutes=120)
        assert row.check_in_deadline == clock.value + timedelta(minutes=15)
        assert row.previous_reservation_id is None


@pytest.mark.parametrize("delay", [0, 16, 130])
def test_break_expiry_handover_without_requests(client, seats, clock, db, delay):
    owner = identity()
    occupant = walk_up(client, seats[0], owner).json()["reservation"]
    # Spend 25 minutes, leaving five for a final break during the public window.
    action(client, occupant["id"], "break", owner)
    clock.advance(minutes=25)
    action(client, occupant["id"], "return", owner)
    clock.advance(minutes=85)
    action(client, occupant["id"], "break", owner)
    successor = book(client, seats[0]).json()["reservation"]
    release = clock.value + timedelta(minutes=5)
    clock.advance(minutes=5 + delay)
    with Session(db) as session:
        states = {state.id: state for state in reservation_states(session, clock.value)}
        assert states[UUID(occupant["id"])].status == "ended"
        state = states[UUID(successor["id"])]
        assert state.effective_starts_at == release
        assert state.effective_check_in_deadline == release + timedelta(minutes=15)
        assert state.status == ("pending" if delay == 0 else "no_show" if delay == 16 else "ended")
        # Reads did not persist the early shift.
        assert session.get(Reservation, state.id).starts_at == release + timedelta(minutes=5)
    if delay == 0:
        assert walk_up(client, seats[0]).json()["reservation"]["id"] == successor["id"]
    else:
        assert client.get("/api/v1/me/reservation").json()["reservation"] is None
        assert book(client, seats[0]).status_code == 201


def test_request_validation_and_identity(client, seats):
    assert (
        client.get("/api/v1/me/reservation", headers={"X-Demo-User-Id": "bad"}).status_code == 400
    )
    assert client.post("/api/v1/reservations", json={"kind": "seat"}).status_code == 422
    assert (
        client.post(
            "/api/v1/reservations",
            json={"kind": "seat", "seat_id": str(seats[0].id), "user_id": str(uuid4())},
        ).status_code
        == 422
    )
    assert client.get(f"/api/v1/spaces/{uuid4()}").status_code == 404
    assert client.post("/api/v1/check-ins", json={"qr_token": "unknown"}).status_code == 404


def test_configuration_changes_only_affect_new_deadlines(client, seats, clock, policy, db):
    owner = identity()
    occupant = walk_up(client, seats[0], owner).json()["reservation"]
    clock.advance(minutes=110)
    upcoming = book(client, seats[0]).json()["reservation"]
    policy.session_length_minutes = 60
    policy.check_in_window_minutes = 5
    policy.break_budget_minutes = 12
    unchanged = client.get("/api/v1/me/reservation").json()["reservation"]
    assert unchanged["ends_at"] == upcoming["ends_at"]
    assert unchanged["check_in_deadline"] == upcoming["check_in_deadline"]
    assert unchanged["break_seconds_remaining"] == 1800
    action(client, occupant["id"], "end", owner)
    with Session(db) as session:
        shifted = session.get(Reservation, UUID(upcoming["id"]))
        assert shifted.ends_at == clock.value + timedelta(minutes=120)
        assert shifted.check_in_deadline == clock.value + timedelta(minutes=15)
    fresh = book(client, seats[1], identity()).json()["reservation"]
    assert fresh["break_seconds_remaining"] == 720
    with Session(db) as session:
        row = session.get(Reservation, UUID(fresh["id"]))
        assert row.ends_at == clock.value + timedelta(minutes=60)
        assert row.check_in_deadline == clock.value + timedelta(minutes=5)


def test_seed_is_idempotent_and_preserves_bookings(db, clock, policy):
    with Session(db) as session:
        seeded = seed_demo(session)
        assert len(seeded) == 8
        original_tokens = {seat.id: seat.qr_token for seat in seeded}
        session.commit()
        service = ReservationService(session, policy)
        reservation_id, _ = service.check_in(uuid4(), seeded[0].qr_token)
        session.commit()
        seeded_again = seed_demo(session)
        session.commit()
        assert {seat.id: seat.qr_token for seat in seeded_again} == original_tokens
        assert session.scalar(select(func.count()).select_from(Seat)) == 8
        assert session.get(Reservation, reservation_id).checked_in_at == clock.value


def race(db, policy, calls):
    barrier = Barrier(len(calls))

    def run(call):
        with Session(db) as session:
            service = ReservationService(session, policy)
            barrier.wait(timeout=10)
            try:
                result = call(service)
                session.commit()
                return result
            except (BookingError, IntegrityError):
                session.rollback()
                return None

    with ThreadPoolExecutor(max_workers=len(calls)) as executor:
        return list(executor.map(run, calls))


@pytest.mark.parametrize("same_user", [False, True])
def test_concurrent_booking_has_one_winner(db, seats, clock, policy, same_user):
    user = uuid4()
    other_user = user if same_user else uuid4()
    other_seat = seats[1] if same_user else seats[0]
    results = race(
        db,
        policy,
        [
            lambda service: service.reserve(
                user, ReserveSeatRequest(kind="seat", seat_id=seats[0].id)
            ),
            lambda service: service.reserve(
                other_user, ReserveSeatRequest(kind="seat", seat_id=other_seat.id)
            ),
        ],
    )
    assert sum(result is not None for result in results) == 1
    with Session(db) as session:
        assert session.scalar(select(func.count()).select_from(Reservation)) == 1


def test_extension_races_next_booking(db, client, seats, clock, policy):
    owner = uuid4()
    occupant = walk_up(client, seats[0], identity(owner)).json()["reservation"]
    clock.advance(minutes=110)
    results = race(
        db,
        policy,
        [
            lambda service: service.act(owner, UUID(occupant["id"]), "extend"),
            lambda service: service.reserve(
                uuid4(), ReserveSeatRequest(kind="seat", seat_id=seats[0].id)
            ),
        ],
    )
    assert sum(result is not None for result in results) == 1


def test_database_rejects_overlapping_seats_users_and_breaks(db, seats, clock, policy):
    with Session(db) as session:
        service = ReservationService(session, policy)
        owner = uuid4()
        reservation_id, _ = service.check_in(owner, seats[0].qr_token)
        session.commit()
        for user, seat in [(uuid4(), seats[0]), (owner, seats[1])]:
            with pytest.raises(IntegrityError):
                service._insert(user, seat.id, clock.value)
            session.rollback()
        service.act(owner, reservation_id, "break")
        session.commit()
        with pytest.raises(IntegrityError):
            session.add(
                Break(
                    reservation_id=reservation_id,
                    started_at=clock.value,
                    ends_at=clock.value + timedelta(minutes=1),
                )
            )
            session.flush()
        session.rollback()


def test_one_user_cannot_hold_nonoverlapping_future_sessions(db, seats, clock, policy):
    with Session(db) as session:
        service = ReservationService(session, policy)
        user = uuid4()
        service._insert(user, seats[0].id, clock.value, starts_at=clock.value + timedelta(hours=1))
        session.commit()
        with pytest.raises(IntegrityError):
            service._insert(
                user, seats[1].id, clock.value, starts_at=clock.value + timedelta(hours=4)
            )
        session.rollback()


def test_migration_round_trip(db):
    migrate(db, "base", downgrade=True)
    with db.connect() as connection:
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM pg_tables WHERE schemaname = current_schema() "
                    "AND tablename IN "
                    "('study_spaces', 'seats', 'reservations', 'breaks', 'user_profiles')"
                )
            )
            == 0
        )
    migrate(db)
    with db.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM reservation_states")) == 0
        assert connection.scalar(text("SELECT count(*) FROM user_profiles")) == 0


def test_rules_report_the_configured_timing(client, policy):
    policy.check_in_window_minutes = 5
    response = client.get("/api/v1/rules")
    assert response.status_code == 200
    assert response.json() == {
        "session_length_minutes": 120,
        "check_in_window_minutes": 5,
        "private_priority_window_minutes": 20,
        "public_reservation_window_minutes": 10,
        "break_budget_minutes": 30,
    }


def test_favourites_belong_to_the_user_and_are_idempotent(client, seats):
    space = str(seats[0].space_id)
    other = identity()
    assert client.get("/api/v1/me/favourites").json() == {"space_ids": []}
    for _ in range(2):
        response = client.put(f"/api/v1/me/favourites/{space}")
        assert response.status_code == 200
        assert response.json() == {"space_ids": [space]}
    assert client.get("/api/v1/me/favourites", headers=other).json() == {"space_ids": []}
    missing = client.put(f"/api/v1/me/favourites/{uuid4()}")
    assert missing.status_code == 404 and missing.json()["code"] == "not_found"
    for _ in range(2):
        response = client.delete(f"/api/v1/me/favourites/{space}")
        assert response.status_code == 200
        assert response.json() == {"space_ids": []}
    assert client.delete(f"/api/v1/me/favourites/{uuid4()}").status_code == 200
