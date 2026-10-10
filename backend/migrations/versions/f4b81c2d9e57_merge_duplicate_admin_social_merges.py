"""merge the two admin and social merge revisions

Both branches merged the same heads separately (7a14a5534702 and
e2c91a0d7f63). Either may already be applied, so join them instead of
dropping one.

Revision ID: f4b81c2d9e57
Revises: 7a14a5534702, e2c91a0d7f63
Create Date: 2026-10-10 21:30:00.000000
"""

from collections.abc import Sequence

revision: str = "f4b81c2d9e57"
down_revision: str | Sequence[str] | None = ("7a14a5534702", "e2c91a0d7f63")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
