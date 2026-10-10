"""Merge favourite spaces and map room link revisions.

Revision ID: f4c9d812a6e7
Revises: 5d1c7e2a9b34, b7a41f2c9d60
"""

from collections.abc import Sequence

revision: str = "f4c9d812a6e7"
down_revision: str | Sequence[str] | None = ("5d1c7e2a9b34", "b7a41f2c9d60")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
