"""Local-only pitch catalogue. Keeps seat IDs/QR tokens and the presenter's bookings."""
import copy
import json
import sys
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.database import SessionLocal
from app.features.reservations.models import Break, Reservation, Seat, StudySpace
from app.features.reservations.seed import CORE_ROOMS, EXTRA_ROOMS, seed_demo, seed_demo_shortcuts

settings = get_settings()
if settings.auth_mode != "demo":
    raise SystemExit("Refusing to seed: this command only runs in local demo auth mode.")
template = json.load(sys.stdin)
now = datetime.now(timezone.utc)
session_length = timedelta(minutes=settings.session_length_minutes)
check_in_window = timedelta(minutes=settings.check_in_window_minutes)
counts = {"rooms": 0, "seats": 0, "occupied": 0, "reserved": 0, "on_break": 0, "claimable": 0}

with SessionLocal() as session:
    seed_demo(session, rooms=CORE_ROOMS + EXTRA_ROOMS)
    session.flush()
    seed_demo_shortcuts(session)
    for key, name, _ in CORE_ROOMS + EXTRA_ROOMS:
        space_id = uuid5(NAMESPACE_URL, f"eth-study-demo/space/{key}")
        space = session.get(StudySpace, space_id)
        layout = copy.deepcopy(template)
        layout["room"]["id"] = space.map_room_id
        layout["room"]["label"] = name.removeprefix("Demo: ")
        space.name = layout["room"]["label"]
        seat_objects = [item for item in layout["objects"] if item["type"] == "seat"]
        for item in seat_objects:
            number = item["number"]
            seat_id = uuid5(NAMESPACE_URL, f"eth-study-demo/space/{key}/seat/{number}")
            session.execute(insert(Seat).values(
                id=seat_id, space_id=space_id, label=f"A-{number}", qr_token=token_urlsafe(32),
            ).on_conflict_do_nothing(index_elements=[Seat.id]))
            item["backendSeatId"] = str(seat_id)
            item["backendLabel"] = f"A-{number}"
            reservation_id = uuid5(NAMESPACE_URL, f"pitch-crowd/{key}/{number}")
            # Keep any live/upcoming booking made through the actual demo app.
            conflict = session.scalar(select(Reservation.id).where(
                Reservation.seat_id == seat_id, Reservation.id != reservation_id,
                Reservation.ends_at > now, Reservation.ends_at > Reservation.starts_at,
            ).limit(1))
            mode = (number + counts["rooms"]) % 8
            if conflict or mode in (0, 4, 5):
                continue
            pending = mode == 2
            claimable = mode == 7
            starts = now if pending else now - session_length / 4
            ends = (now + timedelta(minutes=settings.public_reservation_window_minutes * .8)
                    if claimable else starts + session_length)
            values = dict(
                id=reservation_id, user_id=uuid5(NAMESPACE_URL, f"pitch-person/{key}/{number}"),
                seat_id=seat_id, created_at=starts, starts_at=starts,
                check_in_deadline=starts + check_in_window,
                checked_in_at=None if pending else starts + timedelta(seconds=1),
                ends_at=ends, break_budget_seconds=settings.break_budget_minutes * 60,
            )
            session.execute(insert(Reservation).values(**values).on_conflict_do_update(
                index_elements=[Reservation.id], set_={k:v for k,v in values.items() if k != "id"},
            ))
            state = "reserved" if pending else "claimable" if claimable else "occupied"
            if mode == 6:
                break_id = uuid5(NAMESPACE_URL, f"pitch-break/{key}/{number}")
                break_values = dict(id=break_id, reservation_id=reservation_id,
                    started_at=now - timedelta(seconds=30),
                    ends_at=now + timedelta(minutes=settings.break_budget_minutes / 2),
                    returned_at=None)
                session.execute(insert(Break).values(**break_values).on_conflict_do_update(
                    index_elements=[Break.id], set_={k:v for k,v in break_values.items() if k != "id"},
                ))
                state = "on_break"
            counts[state] += 1
        space.layout = layout
        counts["rooms"] += 1
        counts["seats"] += len(seat_objects)
    session.commit()
print(json.dumps(counts))
