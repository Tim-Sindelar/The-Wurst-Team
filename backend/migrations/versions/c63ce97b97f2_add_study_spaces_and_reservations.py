"""add study spaces and reservations

Revision ID: c63ce97b97f2
Revises:
Create Date: 2026-10-09 20:25:21.508363
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c63ce97b97f2"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.create_table(
        "study_spaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("lat", sa.Double(), nullable=False),
        sa.Column("lng", sa.Double(), nullable=False),
        sa.Column(
            "layout",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint("lat BETWEEN -90 AND 90", name="valid_latitude"),
        sa.CheckConstraint("lng BETWEEN -180 AND 180", name="valid_longitude"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "seats",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("qr_token", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["study_spaces.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("qr_token"),
        sa.UniqueConstraint("space_id", "label", name="unique_space_seat_label"),
    )
    op.create_index(op.f("ix_seats_space_id"), "seats", ["space_id"], unique=False)
    op.create_table(
        "reservations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("seat_id", sa.Uuid(), nullable=False),
        sa.Column("previous_reservation_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("check_in_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("break_budget_seconds", sa.Integer(), nullable=False),
        postgresql.ExcludeConstraint(
            (sa.column("seat_id"), "="),
            (sa.text("tstzrange(starts_at, ends_at, '[)')"), "&&"),
            using="gist",
            name="no_seat_overlap",
        ),
        postgresql.ExcludeConstraint(
            (sa.column("user_id"), "="),
            (
                sa.text(
                    "(CASE WHEN ends_at = starts_at THEN 'empty'::tstzrange "
                    "ELSE tstzrange(created_at, ends_at, '[)') END)"
                ),
                "&&",
            ),
            using="gist",
            name="no_user_commitment_overlap",
        ),
        sa.CheckConstraint("break_budget_seconds > 0", name="positive_break_budget"),
        sa.CheckConstraint(
            "created_at <= starts_at AND starts_at <= ends_at "
            "AND check_in_deadline >= starts_at "
            "AND (checked_in_at IS NULL OR checked_in_at BETWEEN starts_at AND ends_at)",
            name="sane_reservation_times",
        ),
        sa.CheckConstraint("previous_reservation_id <> id", name="not_own_predecessor"),
        sa.ForeignKeyConstraint(
            ["previous_reservation_id"],
            ["reservations.id"],
        ),
        sa.ForeignKeyConstraint(
            ["seat_id"],
            ["seats.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_reservations_previous_reservation_id"),
        "reservations",
        ["previous_reservation_id"],
        unique=False,
    )
    op.create_index(op.f("ix_reservations_seat_id"), "reservations", ["seat_id"], unique=False)
    op.create_index(op.f("ix_reservations_user_id"), "reservations", ["user_id"], unique=False)
    op.create_table(
        "breaks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reservation_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        postgresql.ExcludeConstraint(
            (sa.column("reservation_id"), "="),
            (sa.text("tstzrange(started_at, COALESCE(returned_at, ends_at), '[)')"), "&&"),
            using="gist",
            name="no_break_overlap",
        ),
        sa.CheckConstraint(
            "started_at < ends_at AND "
            "(returned_at IS NULL OR (started_at <= returned_at AND returned_at < ends_at))",
            name="sane_break_times",
        ),
        sa.ForeignKeyConstraint(
            ["reservation_id"],
            ["reservations.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_breaks_reservation_id"), "breaks", ["reservation_id"], unique=False)
    # The function and view share one calculation. An explicit clock lets a transaction
    # use one instant after acquiring locks and makes deadline boundaries testable.
    op.execute("""
        CREATE FUNCTION reservation_states_at(at_time timestamptz)
        RETURNS TABLE (
            id uuid, user_id uuid, seat_id uuid, previous_reservation_id uuid,
            created_at timestamptz, starts_at timestamptz, check_in_deadline timestamptz,
            checked_in_at timestamptz, ends_at timestamptz, break_budget_seconds integer,
            effective_starts_at timestamptz, effective_check_in_deadline timestamptz,
            effective_ends_at timestamptz, status text
        ) LANGUAGE sql STABLE AS $$
            WITH released AS (
                SELECT r.*, LEAST(r.ends_at, (
                    SELECT min(b.ends_at) FROM breaks b
                    WHERE b.reservation_id = r.id AND b.returned_at IS NULL
                      AND b.ends_at <= at_time
                )) AS released_at
                FROM reservations r
            ), shifted AS (
                SELECT r.*, CASE
                    WHEN r.ends_at > r.starts_at AND r.previous_reservation_id IS NOT NULL
                    THEN LEAST(r.starts_at, p.released_at) - r.starts_at
                    ELSE interval '0'
                END AS shift
                FROM released r LEFT JOIN released p ON p.id = r.previous_reservation_id
            ), effective AS (
                SELECT s.*, s.starts_at + s.shift AS effective_start,
                    s.check_in_deadline + s.shift AS effective_deadline,
                    s.released_at + s.shift AS effective_end
                FROM shifted s
            )
            SELECT e.id, e.user_id, e.seat_id, e.previous_reservation_id,
                e.created_at, e.starts_at, e.check_in_deadline, e.checked_in_at,
                e.ends_at, e.break_budget_seconds,
                e.effective_start, e.effective_deadline,
                CASE WHEN e.checked_in_at IS NULL AND at_time >= e.effective_deadline
                    THEN LEAST(e.effective_end, e.effective_deadline)
                    ELSE e.effective_end END,
                CASE
                    WHEN e.ends_at = e.starts_at OR at_time >= e.effective_end THEN 'ended'
                    WHEN e.checked_in_at IS NULL AND at_time >= e.effective_deadline
                        THEN 'no_show'
                    WHEN e.checked_in_at IS NULL AND at_time < e.effective_start
                        THEN 'upcoming'
                    WHEN e.checked_in_at IS NULL THEN 'pending'
                    WHEN EXISTS (
                        SELECT 1 FROM breaks b WHERE b.reservation_id = e.id
                          AND b.started_at <= at_time AND at_time < b.ends_at
                          AND (b.returned_at IS NULL OR at_time < b.returned_at)
                    ) THEN 'on_break'
                    ELSE 'active'
                END
            FROM effective e
        $$
    """)
    op.execute("""
        CREATE VIEW reservation_states AS
        SELECT * FROM reservation_states_at(statement_timestamp())
    """)


def downgrade() -> None:
    op.execute("DROP VIEW reservation_states")
    op.execute("DROP FUNCTION reservation_states_at(timestamptz)")
    op.drop_index(op.f("ix_breaks_reservation_id"), table_name="breaks")
    op.drop_table("breaks")
    op.drop_index(op.f("ix_reservations_user_id"), table_name="reservations")
    op.drop_index(op.f("ix_reservations_seat_id"), table_name="reservations")
    op.drop_index(op.f("ix_reservations_previous_reservation_id"), table_name="reservations")
    op.drop_table("reservations")
    op.drop_index(op.f("ix_seats_space_id"), table_name="seats")
    op.drop_table("seats")
    op.drop_table("study_spaces")
    # Leave the shared extension installed: other schemas may also use it.
