"""Idempotent demo catalogue: python -m app.features.reservations.seed."""

import json
from datetime import timedelta
from pathlib import Path
from secrets import token_urlsafe
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.features.campus_map.floor_plans import FloorPlans
from app.features.reservations.models import Seat, SpaceOpeningInterval, StudySpace
from app.models.favourite import FavouriteSpace
from app.models.recent import RecentSpace

DemoRoom = tuple[str, str, str]  # key, name, map room id

CORE_ROOMS: tuple[DemoRoom, ...] = (
    ("zentrum", "Demo: HG E 51", "ETH.HG.E.E_051"),
    ("hoenggerberg", "Demo: Baubibliothek HIL E 2.1", "ETH.HIL.E.E_002.1"),
)
# More rooms so Home has something to fill its Favourites and Recent columns with.
EXTRA_ROOMS: tuple[DemoRoom, ...] = (
    ("hg-d-3", "Demo: HG D 3.1", "ETH.HG.D.D_003.1"),
    ("hg-f-5", "Demo: HG F 5", "ETH.HG.F.F_005"),
    ("cab-e-11", "Demo: CAB E 11.1", "ETH.CAB.E.E_011.1"),
    ("cab-f-11", "Demo: CAB F 11", "ETH.CAB.F.F_011"),
    ("hci-g-2", "Demo: HCI G 2", "ETH.HCI.G.G_002"),
    ("lfw-c-1", "Demo: LFW C 1", "ETH.LFW.C.C_001"),
    ("ml-h-11", "Demo: ML H 11", "ETH.ML.H.H_011"),
    ("no-c-5", "Demo: NO C 5", "ETH.NO.C.C_005"),
    ("hph-g-1", "Demo: HPH G 1", "ETH.HPH.G.G_001"),
    ("chn-f-14", "Demo: CHN F 14", "ETH.CHN.F.F_014"),
)


def seed_demo(
    session: Session, floors_dir: Path | None = None, rooms: tuple[DemoRoom, ...] = CORE_ROOMS
) -> list[Seat]:
    plans = FloorPlans(floors_dir or get_settings().map_floors_dir).index()
    if plans is None:
        raise ValueError("Floor plans are unavailable; cannot validate demo map rooms")
    places = {}
    for _, _, map_room_id in rooms:
        place = plans.by_id.get(map_room_id)
        if place is None:
            raise ValueError(f"Demo map room not found: {map_room_id}")
        places[map_room_id] = place
    seat_ids = []
    for key, name, map_room_id in rooms:
        place = places[map_room_id]
        space_id = uuid5(NAMESPACE_URL, f"eth-study-demo/space/{key}")
        existing = session.get(StudySpace, space_id)
        if existing is not None and existing.map_room_id != map_room_id:
            raise ValueError(f"Demo study space {space_id} links a different map room")
        created = session.execute(
            insert(StudySpace)
            .values(
                id=space_id,
                name=name,
                map_room_id=map_room_id,
                lat=place["lat"],
                lng=place["lng"],
                layout={},
            )
            .on_conflict_do_nothing(index_elements=[StudySpace.id])
            .returning(StudySpace.id)
        ).scalar_one_or_none()
        if created is not None:
            session.add_all(
                [
                    SpaceOpeningInterval(
                        space_id=space_id, weekday=day, start_minute=0, end_minute=1440
                    )
                    for day in range(7)
                ]
            )
        for number in range(1, 5):
            seat_id = uuid5(NAMESPACE_URL, f"eth-study-demo/space/{key}/seat/{number}")
            seat_ids.append(seat_id)
            session.execute(
                insert(Seat)
                .values(
                    id=seat_id,
                    space_id=space_id,
                    label=f"A-{number}",
                    qr_token=token_urlsafe(32),
                )
                .on_conflict_do_nothing(index_elements=[Seat.id])
            )
    return list(session.scalars(select(Seat).where(Seat.id.in_(seat_ids)).order_by(Seat.id)))


DEMO_FAVOURITES = ("zentrum", "hg-d-3", "cab-e-11", "hci-g-2", "ml-h-11", "hph-g-1")
DEMO_RECENTS = ("hoenggerberg", "hg-f-5", "cab-f-11", "lfw-c-1", "no-c-5", "chn-f-14")


def seed_demo_shortcuts(session: Session) -> None:
    """Gives the default demo user favourites and recents (different rooms) for Home."""
    user_id = get_settings().dummy_user_id

    def space_id(key: str):
        return uuid5(NAMESPACE_URL, f"eth-study-demo/space/{key}")

    for key in DEMO_FAVOURITES:
        session.execute(
            insert(FavouriteSpace)
            .values(user_id=user_id, space_id=space_id(key))
            .on_conflict_do_nothing()
        )
    for index, key in enumerate(DEMO_RECENTS):
        # Newest first: each one an hour older than the one before.
        session.execute(
            insert(RecentSpace)
            .values(
                user_id=user_id,
                space_id=space_id(key),
                last_used_at=func.now() - timedelta(hours=index),
            )
            .on_conflict_do_nothing()
        )


def main() -> None:
    with SessionLocal() as session:
        seats = seed_demo(session, rooms=CORE_ROOMS + EXTRA_ROOMS)
        seed_demo_shortcuts(session)
        session.commit()
        print(
            json.dumps(
                [
                    {
                        "seat_id": str(seat.id),
                        "space_id": str(seat.space_id),
                        "label": seat.label,
                        "qr_token": seat.qr_token,
                    }
                    for seat in seats
                ],
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
