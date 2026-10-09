from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StudySpace(Base):
    __tablename__ = "study_spaces"
    __table_args__ = (
        CheckConstraint("lat BETWEEN -90 AND 90", name="valid_latitude"),
        CheckConstraint("lng BETWEEN -180 AND 180", name="valid_longitude"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(Text)
    lat: Mapped[float]
    lng: Mapped[float]
    layout: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    timezone: Mapped[str] = mapped_column(
        Text, default="Europe/Zurich", server_default="Europe/Zurich"
    )


class Seat(Base):
    __tablename__ = "seats"
    __table_args__ = (
        UniqueConstraint("space_id", "label", name="unique_space_seat_label"),
        UniqueConstraint("id", "space_id", name="unique_seat_space"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    space_id: Mapped[UUID] = mapped_column(ForeignKey("study_spaces.id"), index=True)
    label: Mapped[str] = mapped_column(Text)
    qr_token: Mapped[str] = mapped_column(Text, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


class SpaceOpeningInterval(Base):
    __tablename__ = "space_opening_intervals"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="valid_opening_weekday"),
        CheckConstraint(
            "0 <= start_minute AND start_minute < end_minute AND end_minute <= 1440",
            name="valid_opening_minutes",
        ),
        ExcludeConstraint(
            ("space_id", "="),
            ("weekday", "="),
            (text("int4range(start_minute, end_minute, '[)')"), "&&"),
            name="no_opening_overlap",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    space_id: Mapped[UUID] = mapped_column(ForeignKey("study_spaces.id"), index=True)
    weekday: Mapped[int] = mapped_column(SmallInteger)
    start_minute: Mapped[int] = mapped_column(SmallInteger)
    end_minute: Mapped[int] = mapped_column(SmallInteger)


class SpaceClosure(Base):
    __tablename__ = "space_closures"
    __table_args__ = (
        CheckConstraint("starts_at < ends_at", name="valid_closure_times"),
        ForeignKeyConstraint(
            ["seat_id", "space_id"],
            ["seats.id", "seats.space_id"],
            name="closure_seat_belongs_to_space",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    space_id: Mapped[UUID] = mapped_column(ForeignKey("study_spaces.id"), index=True)
    seat_id: Mapped[UUID | None] = mapped_column(index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(Text)


class Reservation(Base):
    __tablename__ = "reservations"
    __table_args__ = (
        CheckConstraint(
            "created_at <= starts_at AND starts_at <= ends_at "
            "AND check_in_deadline >= starts_at "
            "AND (checked_in_at IS NULL OR checked_in_at BETWEEN starts_at AND ends_at)",
            name="sane_reservation_times",
        ),
        CheckConstraint("break_budget_seconds > 0", name="positive_break_budget"),
        CheckConstraint("previous_reservation_id <> id", name="not_own_predecessor"),
        ExcludeConstraint(
            ("seat_id", "="),
            (text("tstzrange(starts_at, ends_at, '[)')"), "&&"),
            name="no_seat_overlap",
        ),
        ExcludeConstraint(
            ("user_id", "="),
            (
                text(
                    "(CASE WHEN ends_at = starts_at THEN 'empty'::tstzrange "
                    "ELSE tstzrange(created_at, ends_at, '[)') END)"
                ),
                "&&",
            ),
            name="no_user_commitment_overlap",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(index=True)
    seat_id: Mapped[UUID] = mapped_column(ForeignKey("seats.id"), index=True)
    previous_reservation_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("reservations.id"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    check_in_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    break_budget_seconds: Mapped[int]


class Break(Base):
    __tablename__ = "breaks"
    __table_args__ = (
        CheckConstraint(
            "started_at < ends_at AND "
            "(returned_at IS NULL OR (started_at <= returned_at AND returned_at < ends_at))",
            name="sane_break_times",
        ),
        ExcludeConstraint(
            ("reservation_id", "="),
            (text("tstzrange(started_at, COALESCE(returned_at, ends_at), '[)')"), "&&"),
            name="no_break_overlap",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    reservation_id: Mapped[UUID] = mapped_column(ForeignKey("reservations.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
