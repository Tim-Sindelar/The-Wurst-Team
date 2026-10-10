import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_session
from app.features.reservations.models import Seat, SpaceOpeningInterval, StudySpace
from app.features.reservations.service import ReservationService
from app.main import app


@dataclass
class Clock:
    value: datetime

    def advance(self, *, minutes: float = 0, seconds: float = 0) -> None:
        self.value += timedelta(minutes=minutes, seconds=seconds)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock(datetime(2030, 1, 1, 10, tzinfo=UTC))
    monkeypatch.setattr(ReservationService, "now", lambda self: clock.value)
    return clock


@pytest.fixture
def policy(tmp_path: Path) -> Settings:
    floors = tmp_path / "floors"
    (floors / "levels").mkdir(parents=True)
    (floors / "index.json").write_text(
        json.dumps({"levels": [{"id": "ETH.HG.E", "floor": 0}]}), encoding="utf-8"
    )
    (floors / "levels" / "ETH.HG.E.json").write_text(
        json.dumps(
            {
                "origin": [8.5, 47.3],
                "scale": 1e6,
                "rooms": [
                    {"id": room_id, "name": name, "rings": [[[0, 0, 10, 0, 10, 10, 0, 10]]]}
                    for room_id, name in (
                        ("ETH.HG.E.E_007", "HG E 7"),
                        ("ETH.HG.E.E_041.1", None),
                        ("ETH.HG.E.E_051", "HG E 51"),
                        ("ETH.HIL.E.E_002.1", None),
                    )
                ],
            }
        ),
        encoding="utf-8",
    )
    return Settings(_env_file=None, auth_mode="demo", map_floors_dir=floors)


@pytest.fixture
def client(db: Engine, clock: Clock, policy: Settings) -> Iterator[TestClient]:
    def test_session() -> Iterator[Session]:
        with Session(db) as session:
            yield session

    app.dependency_overrides[get_session] = test_session
    app.dependency_overrides[get_settings] = lambda: policy
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def seats(db: Engine) -> list[Seat]:
    with Session(db, expire_on_commit=False) as session:
        space = StudySpace(
            name="Test reading room", map_room_id="ETH.HG.E.E_007", lat=47.37, lng=8.54
        )
        empty = StudySpace(
            name="Empty test room", map_room_id="ETH.HG.E.E_041.1", lat=47.4, lng=8.5
        )
        session.add_all([space, empty])
        session.flush()
        session.add_all(
            [
                SpaceOpeningInterval(space_id=room.id, weekday=day, start_minute=0, end_minute=1440)
                for room in (space, empty)
                for day in range(7)
            ]
        )
        seats = [
            Seat(space_id=space.id, label=f"A-{index}", qr_token=uuid4().hex)
            for index in range(1, 4)
        ]
        session.add_all(seats)
        session.commit()
        return seats
