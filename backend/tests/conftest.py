from collections.abc import Iterator
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, delete, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Break,
    FavouriteSpace,
    MapDocument,
    MapEntity,
    MapOverride,
    RecentSpace,
    Reservation,
    Seat,
    SpaceClosure,
    SpaceOpeningInterval,
    StudySpace,
    UserProfile,
)


def migrate(engine: Engine, revision: str = "head", *, downgrade: bool = False) -> None:
    with engine.begin() as connection:
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        config.attributes["version_table_schema"] = connection.scalar(
            text("SELECT current_schema()")
        )
        if downgrade:
            command.downgrade(config, revision)
        else:
            command.upgrade(config, revision)


@pytest.fixture(scope="session")
def test_engine() -> Iterator[Engine]:
    """Use real migrations in a unique schema; never clear the application's tables."""
    schema = "test_study_" + uuid4().hex
    bootstrap = create_engine(get_settings().database_url)
    with bootstrap.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(
        get_settings().database_url,
        connect_args={"options": f"-csearch_path={schema},public"},
    )
    try:
        migrate(engine)
        yield engine
    finally:
        engine.dispose()
        with bootstrap.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        bootstrap.dispose()


@pytest.fixture
def db(test_engine: Engine) -> Iterator[Engine]:
    yield test_engine
    with Session(test_engine) as session:
        for model in (
            FavouriteSpace,
            RecentSpace,
            Break,
            Reservation,
            SpaceClosure,
            SpaceOpeningInterval,
            Seat,
            StudySpace,
            MapEntity,
            MapOverride,
            MapDocument,
            UserProfile,
        ):
            session.execute(delete(model))
        session.commit()
