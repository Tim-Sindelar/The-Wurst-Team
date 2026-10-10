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


def seed_demo(session: Session, floors_dir: Path | None = None) -> list[Seat]:
    rooms = (
        ("zentrum", "Demo: HG E 51", "ETH.HG.E.E_051"),
        ("hoenggerberg", "Demo: Baubibliothek HIL E 2.1", "ETH.HIL.E.E_002.1"),
    )
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


def seed_demo_shortcuts(session: Session, seats: list[Seat]) -> None:
    """Gives the default demo user favourites and recents so Home has rows to show."""
    user_id = get_settings().dummy_user_id
    space_ids = list(dict.fromkeys(seat.space_id for seat in seats))
    for index, space_id in enumerate(space_ids):
        session.execute(
            insert(FavouriteSpace)
            .values(user_id=user_id, space_id=space_id)
            .on_conflict_do_nothing()
        )
        # Recents run in the opposite order, so the two rows differ.
        session.execute(
            insert(RecentSpace)
            .values(
                user_id=user_id,
                space_id=space_ids[-1 - index],
                last_used_at=func.now() - timedelta(hours=index),
            )
            .on_conflict_do_nothing()
        )


def main() -> None:
    with SessionLocal() as session:
        seats = seed_demo(session)
        seed_demo_shortcuts(session, seats)
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
