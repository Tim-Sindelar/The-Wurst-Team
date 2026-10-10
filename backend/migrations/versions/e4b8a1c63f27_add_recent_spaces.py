"""add recent spaces

Revision ID: e4b8a1c63f27
Revises: c8a72d6e1940
"""

import sqlalchemy as sa
from alembic import op

revision = "e4b8a1c63f27"
down_revision = "c8a72d6e1940"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recent_spaces",
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "space_id",
            sa.Uuid(),
            sa.ForeignKey("study_spaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "last_used_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # Start from the bookings people already made.
    op.execute(
        """
        INSERT INTO recent_spaces (user_id, space_id, last_used_at)
        SELECT r.user_id, s.space_id, max(r.created_at)
        FROM reservations r JOIN seats s ON s.id = r.seat_id
        GROUP BY r.user_id, s.space_id
        """
    )


def downgrade() -> None:
    op.drop_table("recent_spaces")
