from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

COLLECTION_CHECK = "collection IN ('libraries', 'tables', 'seats')"


class MapEntity(Base):
    """Generated layer: workspaces, tables and seats as the scraper pipeline wrote them
    (map-data/generated.json). Replaced as a whole by the importer."""

    __tablename__ = "map_entities"
    __table_args__ = (CheckConstraint(COLLECTION_CHECK, name="valid_entity_collection"),)

    collection: Mapped[str] = mapped_column(Text, primary_key=True)
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSONB)


class MapOverride(Base):
    """Admin layer: one row per added entity, changed entity (a field patch) or
    deleted entity id, as a diff against the generated layer."""

    __tablename__ = "map_overrides"
    __table_args__ = (
        CheckConstraint(COLLECTION_CHECK, name="valid_override_collection"),
        CheckConstraint("action IN ('added', 'changed', 'deleted')", name="valid_override_action"),
        CheckConstraint("(action = 'deleted') = (data IS NULL)", name="data_unless_deleted"),
    )

    collection: Mapped[str] = mapped_column(Text, primary_key=True)
    action: Mapped[str] = mapped_column(Text, primary_key=True)
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    # SQL NULL for deleted ids, not JSON null.
    data: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))


class MapDocument(Base):
    """Whole documents: the map style, the navigation zones and the headers
    ({schemaVersion, updatedAt}) of the two workspace layers."""

    __tablename__ = "map_documents"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
