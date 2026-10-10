"""add admin room schedules and seat activation

Revision ID: ebf07ff4bdc4
Revises: c63ce97b97f2
Create Date: 2026-10-09 21:40:05.298161
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ebf07ff4bdc4"
down_revision: str | Sequence[str] | None = "c63ce97b97f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint("unique_seat_space", "seats", ["id", "space_id"])
    op.create_table(
        "space_opening_intervals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("start_minute", sa.SmallInteger(), nullable=False),
        sa.Column("end_minute", sa.SmallInteger(), nullable=False),
        postgresql.ExcludeConstraint(
            (sa.column("space_id"), "="),
            (sa.column("weekday"), "="),
            (sa.text("int4range(start_minute, end_minute, '[)')"), "&&"),
            using="gist",
            name="no_opening_overlap",
        ),
        sa.CheckConstraint(
            "0 <= start_minute AND start_minute < end_minute AND end_minute <= 1440",
            name="valid_opening_minutes",
        ),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="valid_opening_weekday"),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["study_spaces.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_space_opening_intervals_space_id"),
        "space_opening_intervals",
        ["space_id"],
        unique=False,
    )
    op.create_table(
        "space_closures",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("seat_id", sa.Uuid(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.CheckConstraint("starts_at < ends_at", name="valid_closure_times"),
        sa.ForeignKeyConstraint(
            ["seat_id", "space_id"],
            ["seats.id", "seats.space_id"],
            name="closure_seat_belongs_to_space",
        ),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["study_spaces.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_space_closures_seat_id"), "space_closures", ["seat_id"], unique=False)
    op.create_index(
        op.f("ix_space_closures_space_id"), "space_closures", ["space_id"], unique=False
    )
    op.add_column(
        "seats",
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "study_spaces",
        sa.Column("timezone", sa.Text(), server_default="Europe/Zurich", nullable=False),
    )

    op.execute("""
        INSERT INTO space_opening_intervals (id, space_id, weekday, start_minute, end_minute)
        SELECT gen_random_uuid(), s.id, d.weekday, 0, 1440
        FROM study_spaces s CROSS JOIN generate_series(0, 6) AS d(weekday)
    """)
    op.execute(AVAILABILITY_FUNCTIONS)
    op.execute(RESERVATION_STATES)


def downgrade() -> None:
    op.execute(PREVIOUS_RESERVATION_STATES)
    op.execute("DROP FUNCTION seat_reservation_end_at(uuid, timestamptz, timestamptz)")
    op.execute("DROP FUNCTION space_is_open_at(uuid, timestamptz)")
    op.execute("DROP FUNCTION space_weekly_open_at(uuid, timestamptz)")
    op.drop_column("study_spaces", "timezone")
    op.drop_column("seats", "is_active")
    op.drop_index(op.f("ix_space_closures_space_id"), table_name="space_closures")
    op.drop_index(op.f("ix_space_closures_seat_id"), table_name="space_closures")
    op.drop_table("space_closures")
    op.drop_constraint("unique_seat_space", "seats", type_="unique")
    op.drop_index(op.f("ix_space_opening_intervals_space_id"), table_name="space_opening_intervals")
    op.drop_table("space_opening_intervals")


AVAILABILITY_FUNCTIONS = """
CREATE FUNCTION space_weekly_open_at(room_id uuid, at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM study_spaces s JOIN space_opening_intervals h ON h.space_id = s.id
        WHERE s.id = room_id
          AND h.weekday = extract(isodow FROM at_time AT TIME ZONE s.timezone)::int - 1
          AND h.start_minute <= extract(hour FROM at_time AT TIME ZONE s.timezone) * 60
                               + extract(minute FROM at_time AT TIME ZONE s.timezone)
          AND h.end_minute > extract(hour FROM at_time AT TIME ZONE s.timezone) * 60
                            + extract(minute FROM at_time AT TIME ZONE s.timezone)
    )
$$;
CREATE FUNCTION space_is_open_at(room_id uuid, at_time timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT space_weekly_open_at(room_id, at_time) AND NOT EXISTS (
        SELECT 1 FROM space_closures c WHERE c.space_id = room_id AND c.seat_id IS NULL
        AND c.starts_at <= at_time AND at_time < c.ends_at
    )
$$;
CREATE FUNCTION seat_reservation_end_at(
    target_seat uuid, requested_start timestamptz, requested_end timestamptz
) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
    room_id uuid;
    active boolean;
    boundary timestamptz;
    weekly_minutes integer;
BEGIN
    SELECT s.space_id, s.is_active INTO room_id, active FROM seats s WHERE s.id = target_seat;
    IF NOT COALESCE(active, false) OR requested_end <= requested_start
        OR NOT space_weekly_open_at(room_id, requested_start)
        OR EXISTS (SELECT 1 FROM space_closures c WHERE c.space_id = room_id
            AND (c.seat_id IS NULL OR c.seat_id = target_seat)
            AND c.starts_at <= requested_start AND requested_start < c.ends_at)
    THEN RETURN NULL; END IF;
    SELECT LEAST(requested_end, min(c.starts_at)) INTO boundary FROM space_closures c
        WHERE c.space_id = room_id AND (c.seat_id IS NULL OR c.seat_id = target_seat)
          AND c.starts_at > requested_start AND c.starts_at < requested_end;
    SELECT COALESCE(sum(end_minute - start_minute), 0) INTO weekly_minutes
        FROM space_opening_intervals WHERE space_id = room_id;
    -- Opening bounds have minute precision. Walk actual instants, not constructed
    -- local timestamps, to correctly cover both skipped and repeated DST hours.
    -- Continuous schedules bypass the walk; closures retain timestamp precision.
    IF weekly_minutes < 10080 THEN
        SELECT LEAST(boundary, min(t)) INTO boundary
        FROM generate_series(date_trunc('minute', requested_start) + interval '1 minute',
                             boundary, interval '1 minute') t
        WHERE NOT space_weekly_open_at(room_id, t);
    END IF;
    RETURN boundary;
END
$$;
"""

RESERVATION_STATES = """
        CREATE OR REPLACE FUNCTION reservation_states_at(at_time timestamptz)
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
                    AND seat_reservation_end_at(r.seat_id, LEAST(r.starts_at, p.released_at),
                        r.ends_at + (LEAST(r.starts_at, p.released_at) - r.starts_at)) IS NOT NULL
                    THEN LEAST(r.starts_at, p.released_at) - r.starts_at
                    ELSE interval '0'
                END AS shift
                FROM released r LEFT JOIN released p ON p.id = r.previous_reservation_id
            ), effective AS (
                SELECT s.*, s.starts_at + s.shift AS effective_start,
                    LEAST(s.check_in_deadline + s.shift,
                        CASE WHEN s.shift <> interval '0' THEN seat_reservation_end_at(
                            s.seat_id, s.starts_at + s.shift, s.released_at + s.shift)
                        ELSE s.released_at END) AS effective_deadline,
                    CASE WHEN s.shift <> interval '0' THEN seat_reservation_end_at(
                        s.seat_id, s.starts_at + s.shift, s.released_at + s.shift)
                    ELSE s.released_at END AS effective_end
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
    """

PREVIOUS_RESERVATION_STATES = """
        CREATE OR REPLACE FUNCTION reservation_states_at(at_time timestamptz)
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
    """
