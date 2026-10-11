"""Import a room catalogue into an empty local demo database, with synthetic occupants."""
import json
import sys
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Float, Integer, select
from sqlalchemy.dialects.postgresql import JSONB

from app.config import get_settings
from app.database import SessionLocal
from app.features.campus_map.models import MapDocument, MapEntity, MapOverride
from app.features.reservations.models import Seat, SpaceClosure, SpaceOpeningInterval, StudySpace

settings = get_settings()
if settings.auth_mode != "demo" or not settings.database_url.rsplit("/", 1)[-1].startswith("pitch_"):
    raise SystemExit("Import requires an isolated pitch_ database and demo authentication.")
models = [MapDocument, MapEntity, MapOverride, StudySpace, Seat, SpaceOpeningInterval, SpaceClosure]
data = json.load(sys.stdin)


def convert(column, value):
    if value is None:
        return None
    if isinstance(column.type, JSONB):
        return json.loads(value)
    if isinstance(column.type, Boolean):
        if value not in ("t", "f"):
            raise ValueError("Invalid boolean")
        return value == "t"
    if isinstance(column.type, DateTime):
        return datetime.fromisoformat(value)
    if isinstance(column.type, Integer):
        return int(value)
    if isinstance(column.type, Float):
        return float(value)
    if column.type.python_type is UUID:
        return UUID(value)
    return value


now = datetime.now(timezone.utc)
counts = {}
with SessionLocal() as session:
    if session.scalar(select(StudySpace.id).limit(1)):
        raise SystemExit("Refusing to overwrite an existing catalogue.")
    for model in models:
        rows = data.get(model.__tablename__, [])
        for row in rows:
            unknown = set(row) - set(model.__table__.columns.keys())
            if unknown:
                raise ValueError(f"Unsupported columns in {model.__tablename__}: {unknown}")
            session.add(model(**{key: convert(model.__table__.columns[key], value)
                                 for key, value in row.items()}))
        session.flush()
        counts[model.__tablename__] = len(rows)
    spaces = session.scalars(select(StudySpace).where(~StudySpace.is_archived).order_by(StudySpace.name)).all()
    counts["synthetic_occupants"] = seed_crowd(session, spaces, settings, now)
    session.commit()
print(json.dumps(counts))
