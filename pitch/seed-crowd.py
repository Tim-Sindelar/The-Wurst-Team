"""Refresh only synthetic occupants; keep imported layouts and real demo bookings."""
from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.features.reservations.models import Break, Reservation, Seat
from app.models.favourite import FavouriteSpace
from app.models.recent import RecentSpace


def seed_crowd(session, spaces, settings, now):
    count = 0
    for index, space in enumerate(spaces):
        session.execute(insert(FavouriteSpace).values(user_id=settings.dummy_user_id, space_id=space.id)
                        .on_conflict_do_nothing())
        session.execute(insert(RecentSpace).values(user_id=settings.dummy_user_id, space_id=space.id,
                        last_used_at=now - timedelta(hours=index)).on_conflict_do_nothing())
        seats = session.scalars(select(Seat).where(Seat.space_id == space.id, Seat.is_active).order_by(Seat.label)).all()
        for number, seat in enumerate(seats):
            mode = number % 8
            # Spread demo states across Audimax's curved rows; seat 01 stays free.
            if space.name == "HG F 30":
                mode = (int(seat.label) - 1) % 8
            if mode in (0, 4, 5):
                continue
            reservation_id = uuid5(NAMESPACE_URL, f"pitch-catalogue-reservation/{seat.id}")
            conflict = session.scalar(select(Reservation.id).where(
                Reservation.seat_id == seat.id, Reservation.id != reservation_id,
                Reservation.ends_at > now, Reservation.ends_at > Reservation.starts_at,
            ).limit(1))
            if conflict:
                continue
            pending = mode == 2
            start = now if pending else now - timedelta(minutes=settings.session_length_minutes / 4)
            end = (now + timedelta(minutes=settings.public_reservation_window_minutes * .8)
                   if mode == 7 else start + timedelta(minutes=settings.session_length_minutes))
            values = dict(
                id=reservation_id, user_id=uuid5(NAMESPACE_URL, f"pitch-catalogue-person/{seat.id}"),
                seat_id=seat.id, created_at=start, starts_at=start,
                check_in_deadline=start + timedelta(minutes=settings.check_in_window_minutes),
                checked_in_at=None if pending else start + timedelta(seconds=1), ends_at=end,
                break_budget_seconds=settings.break_budget_minutes * 60,
            )
            session.execute(insert(Reservation).values(**values).on_conflict_do_update(
                index_elements=[Reservation.id], set_={key:value for key,value in values.items() if key != "id"},
            ))
            if mode == 6:
                values = dict(id=uuid5(NAMESPACE_URL, f"pitch-catalogue-break/{seat.id}"),
                    reservation_id=reservation_id, started_at=now - timedelta(seconds=30),
                    ends_at=now + timedelta(minutes=settings.break_budget_minutes / 2), returned_at=None)
                session.execute(insert(Break).values(**values).on_conflict_do_update(
                    index_elements=[Break.id], set_={key:value for key,value in values.items() if key != "id"},
                ))
            count += 1
    return count
