"""Link each study space to one PolyMaps room.

Revision ID: b7a41f2c9d60
Revises: a1f3c7d92e54
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7a41f2c9d60"
down_revision: str | Sequence[str] | None = "a1f3c7d92e54"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM study_spaces) THEN
                RAISE EXCEPTION 'study_spaces must be empty before adding map_room_id';
            END IF;
        END $$;
    """)
    op.add_column("study_spaces", sa.Column("map_room_id", sa.Text(), nullable=False))
    op.create_unique_constraint("study_spaces_map_room_id_key", "study_spaces", ["map_room_id"])


def downgrade() -> None:
    op.drop_constraint("study_spaces_map_room_id_key", "study_spaces", type_="unique")
    op.drop_column("study_spaces", "map_room_id")
