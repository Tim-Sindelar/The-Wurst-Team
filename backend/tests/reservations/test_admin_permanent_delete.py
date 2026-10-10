from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.dml import Delete

from app.features.campus_map.models import MapEntity
from app.features.reservations.models import (
    Break,
    Reservation,
    Seat,
    SpaceClosure,
    SpaceOpeningInterval,
    StudySpace,
)
from app.features.social.models import Party, PartyMember, SocialUser
from app.models.favourite import FavouriteSpace
from app.models.profile import UserProfile
from tests.reservations.test_admin import ADMIN, room_path
from tests.reservations.test_reservations import book, identity, walk_up


def permanent_path(seats):
    return room_path(seats) + "/permanent"


def test_permanent_delete_requires_admin_and_archived_space(client, seats, db):
    path = permanent_path(seats)
    assert client.delete(path).status_code == 403
    rejected = client.delete(path, headers=ADMIN)
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "space_not_archived"
    with Session(db) as session:
        assert session.get(StudySpace, seats[0].space_id).is_archived is False
        assert session.get(Seat, seats[0].id) is not None
    missing = client.delete(f"/api/v1/admin/spaces/{uuid4()}/permanent", headers=ADMIN)
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"


def test_permanent_delete_removes_owned_data_and_releases_map_room(client, seats, clock, db):
    room_id = seats[0].space_id
    user_id = uuid4()
    with Session(db) as session:
        other_room = session.scalar(select(StudySpace).where(StudySpace.id != room_id))
        other_room_id = other_room.id
        other_seat = Seat(space_id=other_room_id, label="Other", qr_token=uuid4().hex)
        session.add(other_seat)
        session.flush()
        histories = []
        for seat, age in ((seats[0], 5), (seats[1], 4), (other_seat, 3)):
            start = clock.value - timedelta(hours=age)
            reservation = Reservation(
                user_id=user_id,
                seat_id=seat.id,
                created_at=start,
                starts_at=start,
                check_in_deadline=start + timedelta(minutes=10),
                checked_in_at=start,
                ends_at=start + timedelta(hours=1),
                break_budget_seconds=1800,
                previous_reservation_id=histories[-1].id if histories else None,
            )
            session.add(reservation)
            session.flush()
            histories.append(reservation)
        session.add_all(
            [
                Break(
                    reservation_id=row.id,
                    started_at=row.starts_at + timedelta(minutes=10),
                    ends_at=row.starts_at + timedelta(minutes=20),
                    returned_at=row.starts_at + timedelta(minutes=15),
                )
                for row in histories
            ]
        )
        session.add_all(
            [
                SpaceClosure(
                    space_id=room_id,
                    seat_id=seat_id,
                    starts_at=clock.value + timedelta(hours=1),
                    ends_at=clock.value + timedelta(hours=2),
                )
                for seat_id in (None, seats[0].id)
            ]
        )
        session.add_all(
            [
                UserProfile(id=user_id, name="Preserved student"),
                FavouriteSpace(user_id=user_id, space_id=room_id),
                FavouriteSpace(user_id=user_id, space_id=other_room_id),
                MapEntity(
                    collection="libraries", id="ETH.HG.E.E_007", position=0, data={"name": "HG E 7"}
                ),
            ]
        )
        session.add(SocialUser(user_id=user_id, fallback_name="Preserved student"))
        session.flush()
        archived_party = Party(organizer_id=user_id, name="Archived room party", status="booked")
        other_party = Party(organizer_id=user_id, name="Other room party", status="booked")
        session.add_all([archived_party, other_party])
        session.flush()
        session.add_all(
            [
                PartyMember(
                    party_id=party.id,
                    user_id=user_id,
                    status="accepted",
                    reservation_id=reservation.id,
                )
                for party, reservation in (
                    (archived_party, histories[0]),
                    (other_party, histories[-1]),
                )
            ]
        )
        archived_party_id, other_party_id = archived_party.id, other_party.id
        survivor_id = histories[-1].id
        other_seat_id = other_seat.id
        session.commit()

    assert client.delete(room_path(seats), headers=ADMIN).status_code == 200
    removed = client.delete(permanent_path(seats), headers=ADMIN)
    assert removed.status_code == 200, removed.text
    assert removed.json() == {
        "server_time": clock.value.isoformat().replace("+00:00", "Z"),
        "deleted_space_id": str(room_id),
    }
    assert removed.headers["Cache-Control"] == "no-store"
    assert client.get(room_path(seats) + "/overview", headers=ADMIN).status_code == 404
    assert client.post(room_path(seats) + "/restore", headers=ADMIN).status_code == 404
    assert client.delete(permanent_path(seats), headers=ADMIN).status_code == 404
    assert book(client, seats[0]).status_code == 404

    with Session(db) as session:
        assert session.get(StudySpace, room_id) is None
        assert session.get(StudySpace, other_room_id) is not None
        assert session.scalar(select(func.count()).select_from(Seat)) == 1
        assert session.get(Seat, other_seat_id) is not None
        assert session.scalar(select(func.count()).select_from(Reservation)) == 1
        assert session.get(Reservation, survivor_id).previous_reservation_id is None
        assert session.scalar(select(func.count()).select_from(Break)) == 1
        assert session.scalar(select(func.count()).select_from(SpaceClosure)) == 0
        assert session.scalar(select(func.count()).select_from(SpaceOpeningInterval)) == 7
        assert session.scalar(select(func.count()).select_from(FavouriteSpace)) == 1
        assert session.get(FavouriteSpace, (user_id, other_room_id)) is not None
        assert session.get(UserProfile, user_id).name == "Preserved student"
        assert session.get(SocialUser, user_id) is not None
        assert session.get(Party, archived_party_id).status == "booked"
        assert session.get(PartyMember, (archived_party_id, user_id)).reservation_id is None
        assert session.get(PartyMember, (other_party_id, user_id)).reservation_id == survivor_id
        assert session.get(MapEntity, ("libraries", "ETH.HG.E.E_007")).data == {"name": "HG E 7"}

    recreated = client.post(
        "/api/v1/admin/spaces",
        headers=ADMIN,
        json={"name": "HG E 7 again", "map_room_id": "ETH.HG.E.E_007"},
    )
    assert recreated.status_code == 201, recreated.text
    assert recreated.json()["space"]["id"] != str(room_id)
    assert recreated.json()["space"]["map_room_id"] == "ETH.HG.E.E_007"


@pytest.mark.parametrize("status", ["pending", "active", "upcoming"])
def test_permanent_delete_rejects_live_bookings_without_changes(client, seats, clock, db, status):
    if status == "pending":
        reservation = book(client, seats[0], identity()).json()["reservation"]
    elif status == "active":
        reservation = walk_up(client, seats[0], identity()).json()["reservation"]
    else:
        walk_up(client, seats[0], identity())
        clock.advance(minutes=110)
        reservation = book(client, seats[0], identity()).json()["reservation"]
    with Session(db) as session:
        # Defend against an archived record left with a live booking by an import.
        session.get(StudySpace, seats[0].space_id).is_archived = True
        session.commit()
    before = client.get(room_path(seats) + "/overview", headers=ADMIN).json()
    rejected = client.delete(permanent_path(seats), headers=ADMIN)
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["code"] == "live_reservations"
    assert client.get(room_path(seats) + "/overview", headers=ADMIN).json() == before
    with Session(db) as session:
        assert session.get(StudySpace, seats[0].space_id).is_archived is True
        assert session.scalar(select(func.count()).select_from(Seat)) == 3
        assert (
            session.scalar(select(Reservation).where(Reservation.id == reservation["id"]))
            is not None
        )


def test_permanent_delete_failure_rolls_back_all_cleanup(client, seats, db, monkeypatch):
    assert client.delete(room_path(seats), headers=ADMIN).status_code == 200
    with Session(db) as session:
        favourite = FavouriteSpace(user_id=uuid4(), space_id=seats[0].space_id)
        session.add(favourite)
        session.commit()
    original_execute = Session.execute

    def fail_before_seat_delete(self, statement, *args, **kwargs):
        if isinstance(statement, Delete) and statement.table.name == "seats":
            raise RuntimeError("Simulated cleanup failure")
        return original_execute(self, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "execute", fail_before_seat_delete)
    with pytest.raises(RuntimeError, match="Simulated cleanup failure"):
        client.delete(permanent_path(seats), headers=ADMIN)
    with Session(db) as session:
        assert session.get(StudySpace, seats[0].space_id).is_archived is True
        assert session.scalar(select(func.count()).select_from(Seat)) == 3
        assert session.scalar(select(func.count()).select_from(FavouriteSpace)) == 1
        assert session.scalar(select(func.count()).select_from(SpaceOpeningInterval)) == 14
