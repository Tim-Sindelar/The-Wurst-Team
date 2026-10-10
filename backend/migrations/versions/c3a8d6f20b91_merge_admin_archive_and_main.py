"""Merge admin archiving with favourites and map room links.

Revision ID: c3a8d6f20b91
Revises: b6e5a120d941, f4c9d812a6e7
"""

from collections.abc import Sequence

revision: str = "c3a8d6f20b91"
down_revision: str | Sequence[str] | None = ("b6e5a120d941", "f4c9d812a6e7")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
