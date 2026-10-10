"""merge the admin branch with recent spaces

Revision ID: a9d3e5f71b20
Revises: f4b81c2d9e57, e4b8a1c63f27
Create Date: 2026-10-10 23:00:00.000000
"""

from collections.abc import Sequence

revision: str = "a9d3e5f71b20"
down_revision: str | Sequence[str] | None = ("f4b81c2d9e57", "e4b8a1c63f27")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
