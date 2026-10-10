from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.features.campus_map.models import MapDocument
from app.features.reservations.models import Reservation
from app.features.reservations.service import BookingError, ReservationService
from app.features.social.models import Friendship, Party, PartyMember, SocialUser
from app.models.profile import UserProfile
from tests.conftest import migrate

A, B, C, D = [UUID(int=index) for index in range(1, 5)]
BASE = "/api/v1/social"


def call(client, method, path, user=A, body=None):
    return client.request(method, path, headers={"X-Demo-User-Id": str(user)}, json=body)


def login(client, user=A):
    response = call(client, "GET", "/api/v1/me", user)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def friendship(client, organizer=A, friend=B):
    target_id = login(client, organizer)
    response = call(client, "POST", BASE + "/friend-requests", friend, {"user_id": target_id})
    assert response.status_code == 200, response.text
    relation = response.json()["id"]
    accepted = call(client, "POST", BASE + f"/friend-requests/{relation}/accept", organizer)
    assert accepted.status_code == 200, accepted.text
    return relation


def party(client, organizer=A, member=B, *, accept=True):
    friendship(client, organizer, member)
    created = call(client, "POST", BASE + "/parties", organizer, {"name": "Study together"})
    assert created.status_code == 201, created.text
    party_id = created.json()["id"]
    response = call(
        client,
        "POST",
        BASE + f"/parties/{party_id}/invitations",
        organizer,
        {"user_id": str(member)},
    )
    assert response.status_code == 200, response.text
    if accept:
        response = call(
            client, "POST", BASE + f"/parties/{party_id}/reply", member, {"accept": True}
        )
        assert response.status_code == 200, response.text
    return party_id


def assignments(seats, users=(A, B)):
    return {
        "assignments": [
            {"user_id": str(user), "seat_id": str(seat.id)}
            for user, seat in zip(users, seats, strict=False)
        ]
    }


def current(client, user):
    response = call(client, "GET", "/api/v1/me/reservation", user)
    assert response.status_code == 200
    return response.json()["reservation"]


def test_directory_requests_and_privacy_defaults(social_client):
    client = social_client
    me = call(client, "GET", BASE + "/me").json()
    assert me["share_room"] is False
    target_id = login(client)
    assert target_id == login(client)
    response = call(client, "POST", BASE + "/friend-requests", B, {"user_id": target_id})
    relation = response.json()["id"]
    assert response.json()["direction"] == "outgoing"
    duplicate = call(client, "POST", BASE + "/friend-requests", B, {"user_id": target_id})
    assert duplicate.json()["id"] == relation
    incoming = call(client, "GET", BASE + "/friend-requests").json()["requests"]
    assert incoming[0]["direction"] == "incoming"
    reverse = call(client, "POST", BASE + "/friend-requests", A, {"user_id": login(client, B)})
    assert reverse.json()["id"] == relation
    assert call(client, "GET", BASE + "/friends").json()["friends"] == []
    assert call(client, "POST", BASE + f"/friend-requests/{relation}/accept", B).status_code == 403
    assert call(client, "POST", BASE + f"/friend-requests/{relation}/accept", C).status_code == 404
    accepted = call(client, "POST", BASE + f"/friend-requests/{relation}/accept")
    assert accepted.status_code == 200
    assert accepted.headers["Cache-Control"] == "no-store"
    assert call(client, "POST", BASE + f"/friend-requests/{relation}/accept").status_code == 200
    assert len(call(client, "GET", BASE + "/friends").json()["friends"]) == 1
    assert (
        call(client, "POST", BASE + "/friend-requests", B, {"user_id": target_id}).status_code
        == 409
    )
    assert call(client, "DELETE", BASE + f"/friendships/{relation}", C).status_code == 404
    assert call(client, "DELETE", BASE + f"/friendships/{relation}", B).status_code == 204
    assert call(client, "GET", BASE + "/friends").json()["friends"] == []


@pytest.mark.parametrize("recipient", [A, B])
def test_decline_or_cancel_pending_request(social_client, recipient):
    target_id = login(social_client)
    response = call(social_client, "POST", BASE + "/friend-requests", B, {"user_id": target_id})
    relation = response.json()["id"]
    assert (
        call(social_client, "DELETE", BASE + f"/friendships/{relation}", recipient).status_code
        == 204
    )
    assert call(social_client, "GET", BASE + "/friend-requests").json()["requests"] == []


def test_invalid_and_self_request(social_client):
    target_id = login(social_client)
    assert (
        call(
            social_client, "POST", BASE + "/friend-requests", A, {"user_id": target_id}
        ).status_code
        == 409
    )
    assert (
        call(
            social_client, "POST", BASE + "/friend-requests", B, {"user_id": str(UUID(int=999))}
        ).status_code
        == 404
    )


def test_names_follow_profiles_without_exposing_email(social_client, policy):
    policy.auth_mode = "proxy"
    alice = {"X-User-Id": "a@ethz.ch", "X-User-Name": "Zo%C3%AB"}
    bob = {"X-User-Id": "b@ethz.ch", "X-User-Name": "Bob"}
    target_id = social_client.get("/api/v1/me", headers=alice).json()["id"]
    response = social_client.post(
        BASE + "/friend-requests", headers=bob, json={"user_id": target_id}
    )
    relation = response.json()["id"]
    assert response.json()["person"]["name"] == "Zoë"
    social_client.post(BASE + f"/friend-requests/{relation}/accept", headers=alice)
    social_client.patch("/api/v1/me", headers=alice, data={"name": "New name"})
    friends = social_client.get(BASE + "/friends", headers=bob)
    assert friends.json()["friends"][0]["person"]["name"] == "New name"
    assert "@ethz.ch" not in friends.text


def test_room_sharing_requires_friendship_opt_in_and_check_in(social_client, seats, clock):
    client = social_client
    relation = friendship(client)
    call(client, "POST", "/api/v1/reservations", B, {"kind": "seat", "seat_id": str(seats[0].id)})

    def room():
        response = call(client, "GET", BASE + "/friends")
        assert response.headers["Cache-Control"] == "no-store"
        return response.json()["friends"][0]["room"]

    assert room() is None
    call(client, "PATCH", BASE + "/me/privacy", B, {"share_room": True})
    assert room() is None  # A held seat is not a current location.
    call(client, "POST", "/api/v1/check-ins", B, {"qr_token": seats[0].qr_token})
    assert room()["id"] == str(seats[0].space_id)
    assert call(client, "GET", BASE + "/friends", C).json()["friends"] == []
    reservation = current(client, B)
    call(client, "POST", f"/api/v1/reservations/{reservation['id']}/break", B)
    assert room() is not None
    clock.advance(minutes=30)
    assert room() is None  # Derived expiry, without any worker or write.
    call(client, "POST", "/api/v1/check-ins", B, {"qr_token": seats[0].qr_token})
    assert room() is not None
    call(client, "PATCH", BASE + "/me/privacy", B, {"share_room": False})
    assert room() is None
    call(client, "PATCH", BASE + "/me/privacy", B, {"share_room": True})
    call(client, "DELETE", BASE + f"/friendships/{relation}")
    assert call(client, "GET", BASE + "/friends").json()["friends"] == []


def test_party_consent_and_permissions(social_client, seats):
    client = social_client
    party_id = party(client, accept=False)
    path = BASE + f"/parties/{party_id}"
    assert call(client, "GET", path, C).status_code == 404
    assert call(client, "POST", path + "/invitations", B, {"user_id": str(C)}).status_code == 403
    assert call(client, "POST", path + "/invitations", A, {"user_id": str(C)}).status_code == 409
    assert call(client, "POST", path + "/book", A, assignments(seats)).status_code == 409
    assert current(client, A) is None
    assert call(client, "POST", path + "/reply", B, {"accept": True}).status_code == 200
    assert call(client, "POST", path + "/book", B, assignments(seats)).status_code == 403
    assert call(client, "POST", path + "/cancel", B).status_code == 403
    assert call(client, "POST", path + "/leave", A).status_code == 409
    assert call(client, "POST", path + "/leave", B).status_code == 204
    assert call(client, "GET", path, B).status_code == 404
    assert call(client, "POST", path + "/book", A, assignments(seats)).status_code == 409


def test_declined_invitation_can_be_reinvited(social_client):
    party_id = party(social_client, accept=False)
    path = BASE + f"/parties/{party_id}"
    assert call(social_client, "POST", path + "/reply", B, {"accept": False}).status_code == 200
    assert call(social_client, "GET", BASE + "/parties", B).json()["parties"] == []
    assert (
        call(social_client, "POST", path + "/invitations", A, {"user_id": str(B)}).status_code
        == 200
    )
    assert call(social_client, "POST", path + "/reply", B, {"accept": True}).status_code == 200


def test_party_booking_individual_ownership_check_in_and_no_show(social_client, seats, clock):
    client = social_client
    party_id = party(client)
    path = BASE + f"/parties/{party_id}"
    booked = call(client, "POST", path + "/book", A, assignments(seats))
    assert booked.status_code == 200, booked.text
    assert booked.json()["status"] == "booked"
    assert current(client, A)["seat"]["id"] == str(seats[0].id)
    assert current(client, B)["seat"]["id"] == str(seats[1].id)
    assert (
        call(client, "POST", "/api/v1/check-ins", B, {"qr_token": seats[0].qr_token}).status_code
        == 409
    )
    assert (
        call(client, "POST", "/api/v1/check-ins", A, {"qr_token": seats[0].qr_token}).status_code
        == 200
    )
    assert call(client, "POST", path + "/book", A, assignments(seats)).json() == booked.json()
    assert call(client, "POST", path + "/book", A, assignments(seats[1:])).status_code == 409
    assert call(client, "POST", path + "/leave", B).status_code == 409
    clock.advance(minutes=15)
    assert current(client, B) is None
    assert current(client, A)["status"] == "active"
    retry = call(client, "POST", path + "/book", A, assignments(seats))
    assert retry.status_code == 200
    assert current(client, B) is None  # Retry does not revive the no-show.


def test_four_person_party(social_client, seats, db):
    client = social_client
    party_id = party(client)
    path = BASE + f"/parties/{party_id}"
    for user in (C, D):
        friendship(client, A, user)
        assert (
            call(client, "POST", path + "/invitations", A, {"user_id": str(user)}).status_code
            == 200
        )
        assert call(client, "POST", path + "/reply", user, {"accept": True}).status_code == 200
    with Session(db) as session:
        from app.features.reservations.models import Seat

        extra = Seat(space_id=seats[0].space_id, label="A-4", qr_token="fourth-seat-token")
        session.add(extra)
        session.commit()
        extra_id = extra.id
    body = assignments(seats, (A, B, C))
    body["assignments"].append({"user_id": str(D), "seat_id": str(extra_id)})
    assert call(client, "POST", path + "/book", A, body).status_code == 200
    assert all(current(client, user) for user in (A, B, C, D))


@pytest.mark.parametrize("conflict", ["seat", "member", "room", "missing"])
def test_party_booking_failure_rolls_back_all_members(social_client, seats, db, conflict):
    client = social_client
    party_id = party(client)
    body = assignments(seats)
    if conflict == "seat":
        call(
            client, "POST", "/api/v1/reservations", C, {"kind": "seat", "seat_id": str(seats[1].id)}
        )
    elif conflict == "member":
        call(
            client, "POST", "/api/v1/reservations", B, {"kind": "seat", "seat_id": str(seats[2].id)}
        )
    elif conflict == "missing":
        body["assignments"][1]["seat_id"] = str(UUID(int=999))
    else:
        from app.features.reservations.models import Seat, StudySpace

        with Session(db) as session:
            room = StudySpace(name="Other room", map_room_id="test-other-room", lat=47, lng=8)
            session.add(room)
            session.flush()
            seat = Seat(space_id=room.id, label="Other", qr_token="other-room-token")
            session.add(seat)
            session.commit()
            body["assignments"][1]["seat_id"] = str(seat.id)
    response = call(client, "POST", BASE + f"/parties/{party_id}/book", A, body)
    assert response.status_code in {404, 409}
    assert current(client, A) is None
    assert (current(client, B) is not None) == (conflict == "member")
    assert call(client, "GET", BASE + f"/parties/{party_id}").json()["status"] == "open"
    with Session(db) as session:
        assert all(m.reservation_id is None for m in session.scalars(select(PartyMember)))


def test_claimable_seat_is_not_free_for_party(social_client, seats, clock):
    client = social_client
    party_id = party(client)
    call(client, "POST", "/api/v1/check-ins", C, {"qr_token": seats[1].qr_token})
    clock.advance(minutes=110)
    response = call(client, "POST", BASE + f"/parties/{party_id}/book", A, assignments(seats))
    assert response.status_code == 409
    assert current(client, A) is None and current(client, B) is None


def test_partial_insert_failure_rolls_back_the_transaction(social_client, seats, monkeypatch, db):
    client = social_client
    party_id = party(client)
    original = ReservationService._insert
    inserted = 0

    def fail_second(service, *args, **kwargs):
        nonlocal inserted
        inserted += 1
        if inserted == 2:
            raise BookingError(409, "booking_conflict", "Simulated mid-transaction failure")
        return original(service, *args, **kwargs)

    monkeypatch.setattr(ReservationService, "_insert", fail_second)
    response = call(client, "POST", BASE + f"/parties/{party_id}/book", A, assignments(seats))
    assert response.status_code == 409
    assert inserted == 2
    assert current(client, A) is None and current(client, B) is None
    with Session(db) as session:
        assert session.scalar(select(func.count()).select_from(Reservation)) == 0
        assert session.get(Party, UUID(party_id)).status == "open"


@pytest.mark.parametrize("checked_in", [False, True])
def test_organizer_cancellation_preserves_checked_in_members(social_client, seats, checked_in):
    client = social_client
    party_id = party(client)
    path = BASE + f"/parties/{party_id}"
    assert call(client, "POST", path + "/book", A, assignments(seats)).status_code == 200
    if checked_in:
        call(client, "POST", "/api/v1/check-ins", B, {"qr_token": seats[1].qr_token})
    cancelled = call(client, "POST", path + "/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert len(cancelled.json()["cancelled_reservation_ids"]) == (1 if checked_in else 2)
    assert current(client, A) is None
    assert (current(client, B) is not None) == checked_in
    assert call(client, "POST", path + "/cancel").json()["cancelled_reservation_ids"] == []
    assert call(client, "POST", path + "/book", A, assignments(seats)).status_code == 409


def test_cancel_does_not_touch_members_later_booking(social_client, seats):
    client = social_client
    party_id = party(client)
    call(client, "POST", BASE + f"/parties/{party_id}/book", A, assignments(seats))
    old = current(client, B)
    call(client, "POST", f"/api/v1/reservations/{old['id']}/end", B)
    call(client, "POST", "/api/v1/reservations", B, {"kind": "seat", "seat_id": str(seats[2].id)})
    new = current(client, B)
    call(client, "POST", BASE + f"/parties/{party_id}/cancel")
    assert current(client, B)["id"] == new["id"]


def test_disabled_social_preserves_ordinary_reservations(social_client, seats, policy):
    client = social_client
    party_id = party(client)
    call(client, "POST", BASE + f"/parties/{party_id}/book", A, assignments(seats))
    policy.social_enabled = False
    assert client.get(BASE + "/capabilities").json() == {"enabled": False}
    for method, path, body in [
        ("GET", "/me", None),
        ("GET", "/friends", None),
        ("GET", "/parties", None),
        ("GET", "/people?q=de", None),
        ("POST", f"/parties/{party_id}/cancel", None),
        ("PATCH", "/me/privacy", {"share_room": True}),
    ]:
        response = call(client, method, BASE + path, A, body)
        assert response.status_code == 404 and response.json()["code"] == "social_disabled"
    assert current(client, B) is not None
    assert (
        call(client, "POST", "/api/v1/check-ins", B, {"qr_token": seats[1].qr_token}).status_code
        == 200
    )
    own = current(client, A)
    assert call(client, "POST", f"/api/v1/reservations/{own['id']}/end").status_code == 200


@pytest.mark.parametrize(
    "path", ["/me", "/friends", "/parties", "/friend-requests", "/people?q=de"]
)
def test_social_requires_proxy_auth(social_client, policy, path):
    policy.auth_mode = "proxy"
    assert social_client.get(BASE + path).status_code == 401


def test_duplicate_assignments_rejected(social_client, seats):
    party_id = party(social_client)
    body = assignments(seats)
    body["assignments"][1]["seat_id"] = body["assignments"][0]["seat_id"]
    assert (
        call(social_client, "POST", BASE + f"/parties/{party_id}/book", A, body).status_code == 422
    )


def test_competing_parties_with_same_users_cannot_double_book(social_client, seats, db):
    client = social_client
    first = party(client)
    # Same accepted friendship, with the opposite organizer and assignment order.
    second = call(client, "POST", BASE + "/parties", B, {"name": "Other party"}).json()["id"]
    call(client, "POST", BASE + f"/parties/{second}/invitations", B, {"user_id": str(A)})
    call(client, "POST", BASE + f"/parties/{second}/reply", A, {"accept": True})
    barrier = Barrier(2)

    def attempt(party_id, organizer, users):
        barrier.wait(timeout=5)
        return call(
            client, "POST", BASE + f"/parties/{party_id}/book", organizer, assignments(seats, users)
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        left = pool.submit(attempt, first, A, (A, B))
        right = pool.submit(attempt, second, B, (B, A))
        assert sorted([left.result(timeout=10), right.result(timeout=10)]) == [200, 409]
    with Session(db) as session:
        assert session.scalar(select(func.count()).select_from(Reservation)) == 2


@pytest.mark.parametrize("conflict", ["seat", "member"])
def test_party_competes_safely_with_individual_booking(social_client, seats, db, conflict):
    client = social_client
    party_id = party(client)
    barrier = Barrier(2)

    def group():
        barrier.wait(timeout=5)
        return call(
            client, "POST", BASE + f"/parties/{party_id}/book", A, assignments(seats)
        ).status_code

    def individual():
        barrier.wait(timeout=5)
        user, seat = (C, seats[1]) if conflict == "seat" else (B, seats[2])
        return call(
            client,
            "POST",
            "/api/v1/reservations",
            user,
            {"kind": "seat", "seat_id": str(seat.id)},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        group_result = pool.submit(group)
        individual_result = pool.submit(individual)
        results = (group_result.result(timeout=10), individual_result.result(timeout=10))
        assert results in {(200, 409), (409, 201)}
    with Session(db) as session:
        count = session.scalar(select(func.count()).select_from(Reservation))
        assert count == (2 if results[0] == 200 else 1)


def test_check_in_and_organizer_cancellation_are_serialized(social_client, seats):
    client = social_client
    party_id = party(client)
    path = BASE + f"/parties/{party_id}"
    call(client, "POST", path + "/book", A, assignments(seats))
    original = current(client, B)["id"]
    barrier = Barrier(2)

    def cancel():
        barrier.wait(timeout=5)
        return call(client, "POST", path + "/cancel")

    def check_in():
        barrier.wait(timeout=5)
        return call(client, "POST", "/api/v1/check-ins", B, {"qr_token": seats[1].qr_token})

    with ThreadPoolExecutor(max_workers=2) as pool:
        cancel_result = pool.submit(cancel)
        check_in_result = pool.submit(check_in)
        cancelled = cancel_result.result(timeout=10)
        checked_in = check_in_result.result(timeout=10)
    assert cancelled.status_code == checked_in.status_code == 200
    booking = current(client, B)
    assert booking["status"] == "active"
    if original in cancelled.json()["cancelled_reservation_ids"]:
        # Cancellation won. The subsequent scan is an ordinary walk-up, not revival.
        assert booking["id"] != original
    else:
        assert booking["id"] == original


def test_withdrawal_and_booking_cannot_use_stale_consent(social_client, seats):
    client = social_client
    party_id = party(client)
    path = BASE + f"/parties/{party_id}"
    barrier = Barrier(2)

    def leave():
        barrier.wait(timeout=5)
        return call(client, "POST", path + "/leave", B).status_code

    def book():
        barrier.wait(timeout=5)
        return call(client, "POST", path + "/book", A, assignments(seats)).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        leave_result = pool.submit(leave)
        book_result = pool.submit(book)
        results = (leave_result.result(timeout=10), book_result.result(timeout=10))
        assert results in {(204, 409), (409, 200)}
    assert (current(client, B) is not None) == (results[1] == 200)


def test_social_migration_roundtrip(db, social_client, seats):
    call(
        social_client,
        "POST",
        "/api/v1/reservations",
        A,
        {"kind": "seat", "seat_id": str(seats[0].id)},
    )
    booking = current(social_client, A)
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from alembic.script import ScriptDirectory

    # Roundtrip this feature's DDL without undoing main's required room links.
    revision = ScriptDirectory.from_config(Config("alembic.ini")).get_revision("8fd4c12b6a90")
    with db.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            revision.module.downgrade()
            revision.module.upgrade()
    assert current(social_client, A) == booking
    with Session(db) as session:
        for model in (SocialUser, Friendship, Party, PartyMember):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_social_defaults_off_and_can_be_enabled_by_environment(monkeypatch):
    from app.config import Settings

    monkeypatch.delenv("SOCIAL_ENABLED", raising=False)
    assert Settings(_env_file=None).social_enabled is False
    monkeypatch.setenv("SOCIAL_ENABLED", "true")
    assert Settings(_env_file=None).social_enabled is True


@pytest.mark.parametrize(
    "revision", ["8fd4c12b6a90", "a1f3c7d92e54", "b7e2f91a4c60", "5d1c7e2a9b34", "b7a41f2c9d60"]
)
def test_merge_migration_upgrades_either_feature_branch_without_losing_data(db, revision):
    migrate(db, "92a543e210ab", downgrade=True)
    migrate(db, revision)
    user_id = UUID(int=100)
    with Session(db) as session:
        session.add(UserProfile(id=user_id, name="Existing profile"))
        if revision in {"8fd4c12b6a90", "b7e2f91a4c60"}:
            session.add(SocialUser(user_id=user_id, fallback_name="Existing friend"))
        else:
            session.add(MapDocument(name="existing-map", data={"keep": True}))
        session.commit()
    migrate(db)
    with Session(db) as session:
        assert session.get(UserProfile, user_id).name == "Existing profile"
        assert session.scalar(select(func.count()).select_from(SocialUser)) == (
            1 if revision in {"8fd4c12b6a90", "b7e2f91a4c60"} else 0
        )
        assert session.scalar(select(func.count()).select_from(MapDocument)) == (
            0 if revision in {"8fd4c12b6a90", "b7e2f91a4c60"} else 1
        )
        if revision in {"8fd4c12b6a90", "b7e2f91a4c60"}:
            assert session.get(SocialUser, user_id).fallback_name == "Existing friend"
        else:
            assert session.get(MapDocument, "existing-map").data == {"keep": True}


def test_directory_registers_signed_in_users_preserves_edits_and_hides_private_data(
    social_client, policy
):
    policy.auth_mode = "proxy"
    alice = {"X-User-Id": "alice@ethz.ch", "X-User-Name": "Alice"}
    bob = {"X-User-Id": "bob@ethz.ch", "X-User-Name": "Bob Smith"}
    bob_id = social_client.get("/api/v1/me", headers=bob).json()["id"]
    social_client.get("/api/v1/me", headers=alice)
    response = social_client.get(BASE + "/people?q=BOB", headers=alice)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["people"] == [
        {
            "id": bob_id,
            "name": "Bob Smith",
            "photo_url": None,
            "relationship": "none",
            "friendship_id": None,
        }
    ]
    assert "@ethz.ch" not in response.text and "room" not in response.text
    assert social_client.get(BASE + "/people?q=alice", headers=alice).json()["people"] == []
    request = social_client.post(BASE + "/friend-requests", headers=alice, json={"user_id": bob_id})
    relation = request.json()["id"]
    assert (
        social_client.get(BASE + "/people?q=bob", headers=alice).json()["people"][0]["relationship"]
        == "outgoing"
    )
    incoming = social_client.get(BASE + "/people?q=alice", headers=bob).json()["people"][0]
    assert incoming["relationship"] == "incoming" and incoming["friendship_id"] == relation
    social_client.post(BASE + f"/friend-requests/{relation}/accept", headers=bob)
    assert (
        social_client.get(BASE + "/people?q=bob", headers=alice).json()["people"][0]["relationship"]
        == "friends"
    )
    social_client.patch("/api/v1/me", headers=bob, data={"name": "Robert"})
    social_client.get("/api/v1/me", headers=bob)  # Login must not overwrite edited names.
    assert social_client.get(BASE + "/people?q=bob", headers=alice).json()["people"] == []
    assert (
        social_client.get(BASE + "/people?q=robert", headers=alice).json()["people"][0]["name"]
        == "Robert"
    )


def test_directory_limits_results_and_treats_wildcards_literally(social_client, db):
    login(social_client)
    with Session(db) as session:
        session.add_all(
            [UserProfile(id=UUID(int=100 + n), name=f"Student {n:02}") for n in range(25)]
        )
        session.add(UserProfile(id=UUID(int=200), name="A_%name"))
        session.commit()
    assert len(call(social_client, "GET", BASE + "/people?q=student").json()["people"]) == 20
    matches = call(social_client, "GET", BASE + "/people?q=_%").json()["people"]
    assert [p["name"] for p in matches] == ["A_%name"]
    for query in ("a", "  ", "a" * 81):
        assert call(social_client, "GET", BASE + "/people?q=" + query).status_code == 422
    assert (
        call(
            social_client, "POST", BASE + "/friend-requests", body={"invite_token": "x" * 32}
        ).status_code
        == 422
    )
    assert call(social_client, "POST", BASE + "/me/invite-link").status_code == 404
