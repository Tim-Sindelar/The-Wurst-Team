"""Preserve study-place history when admins remove a place."""

import sqlalchemy as sa
from alembic import op

revision = "b6e5a120d941"
down_revision = "a1f3c7d92e54"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "study_spaces",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("study_spaces", "is_archived")
