from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_session
from app.features.reservations.models import Seat, StudySpace
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
def policy() -> Settings:
    return Settings(_env_file=None)


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
        space = StudySpace(name="Test reading room", lat=47.37, lng=8.54)
        empty = StudySpace(name="Empty test room", lat=47.4, lng=8.5)
        session.add_all([space, empty])
        session.flush()
        seats = [
            Seat(space_id=space.id, label=f"A-{index}", qr_token=uuid4().hex)
            for index in range(1, 4)
        ]
        session.add_all(seats)
        session.commit()
        return seats
