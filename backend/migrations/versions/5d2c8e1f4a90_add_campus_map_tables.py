"""add campus map tables

Revision ID: 5d2c8e1f4a90
Revises: ebf07ff4bdc4
Create Date: 2026-10-10 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "5d2c8e1f4a90"
down_revision: str | Sequence[str] | None = "ebf07ff4bdc4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLLECTION_CHECK = "collection IN ('libraries', 'tables', 'seats')"


def upgrade() -> None:
    op.create_table(
        "map_documents",
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("name"),
    )
    op.create_table(
        "map_entities",
        sa.Column("collection", sa.Text(), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(COLLECTION_CHECK, name="valid_entity_collection"),
        sa.PrimaryKeyConstraint("collection", "id"),
    )
    op.create_table(
        "map_overrides",
        sa.Column("collection", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.CheckConstraint("(action = 'deleted') = (data IS NULL)", name="data_unless_deleted"),
        sa.CheckConstraint(
            "action IN ('added', 'changed', 'deleted')", name="valid_override_action"
        ),
        sa.CheckConstraint(COLLECTION_CHECK, name="valid_override_collection"),
        sa.PrimaryKeyConstraint("collection", "action", "id"),
    )


def downgrade() -> None:
    op.drop_table("map_overrides")
    op.drop_table("map_entities")
    op.drop_table("map_documents")
