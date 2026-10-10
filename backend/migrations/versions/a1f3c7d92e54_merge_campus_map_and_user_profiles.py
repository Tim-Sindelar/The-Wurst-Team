"""merge campus map and user profiles heads

Revision ID: a1f3c7d92e54
Revises: 5d2c8e1f4a90, 92a543e210ab
"""

from collections.abc import Sequence

revision: str = "a1f3c7d92e54"
down_revision: str | Sequence[str] | None = ("5d2c8e1f4a90", "92a543e210ab")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
