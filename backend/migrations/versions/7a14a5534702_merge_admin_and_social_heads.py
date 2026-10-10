"""merge admin and social heads

Revision ID: 7a14a5534702
Revises: c3a8d6f20b91, c8a72d6e1940
Create Date: 2026-10-10 20:24:28.397299
"""

from collections.abc import Sequence

revision: str = "7a14a5534702"
down_revision: str | Sequence[str] | None = ("c3a8d6f20b91", "c8a72d6e1940")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
