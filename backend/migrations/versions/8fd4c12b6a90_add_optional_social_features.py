"""Add optional friends, privacy settings, and parties.

Revision ID: 8fd4c12b6a90
Revises: 92a543e210ab
"""

import sqlalchemy as sa
from alembic import op

revision = "8fd4c12b6a90"
down_revision = "92a543e210ab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "social_users",
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column("fallback_name", sa.String(80), nullable=False),
        sa.Column("invite_token", sa.String(64), nullable=False, unique=True),
        sa.Column("share_room", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table(
        "friendships",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_low", sa.Uuid(), sa.ForeignKey("social_users.user_id"), nullable=False),
        sa.Column("user_high", sa.Uuid(), sa.ForeignKey("social_users.user_id"), nullable=False),
        sa.Column("requested_by", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("user_low", "user_high", name="unique_friend_pair"),
        sa.CheckConstraint("user_low < user_high", name="ordered_friend_pair"),
        sa.CheckConstraint("requested_by IN (user_low, user_high)", name="valid_friend_requester"),
        sa.CheckConstraint("status IN ('pending', 'accepted')", name="valid_friend_status"),
    )
    op.create_index("ix_friendships_user_low", "friendships", ["user_low"])
    op.create_index("ix_friendships_user_high", "friendships", ["user_high"])
    op.create_table(
        "parties",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organizer_id", sa.Uuid(), sa.ForeignKey("social_users.user_id"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("status IN ('open', 'booked', 'cancelled')", name="valid_party_status"),
    )
    op.create_index("ix_parties_organizer_id", "parties", ["organizer_id"])
    op.create_table(
        "party_members",
        sa.Column("party_id", sa.Uuid(), sa.ForeignKey("parties.id"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("social_users.user_id"), primary_key=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reservation_id", sa.Uuid(), sa.ForeignKey("reservations.id"), unique=True),
        sa.CheckConstraint(
            "status IN ('invited', 'accepted', 'declined', 'left')",
            name="valid_party_member_status",
        ),
    )
    op.create_index("ix_party_members_user_id", "party_members", ["user_id"])


def downgrade() -> None:
    op.drop_table("party_members")
    op.drop_table("parties")
    op.drop_table("friendships")
    op.drop_table("social_users")
