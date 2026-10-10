"""Idempotent demo catalogue: python -m app.features.reservations.seed."""

import json
from secrets import token_urlsafe
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.features.reservations.models import Seat, SpaceOpeningInterval, StudySpace


def seed_demo(session: Session) -> list[Seat]:
    rooms = (
        ("zentrum", "Demo: Hauptbibliothek / Lesesaal", 47.37648, 8.548268),
        ("hoenggerberg", "Demo: Baubibliothek", 47.408253, 8.506728),
    )
    seat_ids = []
    for key, name, lat, lng in rooms:
        space_id = uuid5(NAMESPACE_URL, f"eth-study-demo/space/{key}")
        created = session.execute(
            insert(StudySpace)
            .values(id=space_id, name=name, lat=lat, lng=lng, layout={})
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


def main() -> None:
    with SessionLocal() as session:
        seats = seed_demo(session)
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
