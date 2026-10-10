"""add favourite spaces

Revision ID: 5d1c7e2a9b34
Revises: a1f3c7d92e54
"""

import sqlalchemy as sa
from alembic import op

revision = "5d1c7e2a9b34"
down_revision = "a1f3c7d92e54"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "favourite_spaces",
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "space_id",
            sa.Uuid(),
            sa.ForeignKey("study_spaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("favourite_spaces")
