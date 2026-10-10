"""add user profiles

Revision ID: 92a543e210ab
Revises: ebf07ff4bdc4
"""

import sqlalchemy as sa
from alembic import op

revision = "92a543e210ab"
down_revision = "ebf07ff4bdc4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("photo", sa.LargeBinary(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("user_profiles")
