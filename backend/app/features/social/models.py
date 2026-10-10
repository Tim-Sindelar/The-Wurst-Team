from datetime import datetime
from secrets import token_urlsafe
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SocialUser(Base):
    __tablename__ = "social_users"

    user_id: Mapped[UUID] = mapped_column(primary_key=True)
    fallback_name: Mapped[str] = mapped_column(String(80))
    invite_token: Mapped[str] = mapped_column(
        String(64), unique=True, default=lambda: token_urlsafe(24)
    )
    share_room: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class Friendship(Base):
    __tablename__ = "friendships"
    __table_args__ = (
        UniqueConstraint("user_low", "user_high", name="unique_friend_pair"),
        CheckConstraint("user_low < user_high", name="ordered_friend_pair"),
        CheckConstraint("requested_by IN (user_low, user_high)", name="valid_friend_requester"),
        CheckConstraint("status IN ('pending', 'accepted')", name="valid_friend_status"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_low: Mapped[UUID] = mapped_column(ForeignKey("social_users.user_id"), index=True)
    user_high: Mapped[UUID] = mapped_column(ForeignKey("social_users.user_id"), index=True)
    requested_by: Mapped[UUID]
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Party(Base):
    __tablename__ = "parties"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'booked', 'cancelled')", name="valid_party_status"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    organizer_id: Mapped[UUID] = mapped_column(ForeignKey("social_users.user_id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(16), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PartyMember(Base):
    __tablename__ = "party_members"
    __table_args__ = (
        CheckConstraint(
            "status IN ('invited', 'accepted', 'declined', 'left')",
            name="valid_party_member_status",
        ),
    )

    party_id: Mapped[UUID] = mapped_column(ForeignKey("parties.id"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("social_users.user_id"), primary_key=True, index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="invited")
    # A party has one booking round. Ownership remains in the existing reservation table.
    reservation_id: Mapped[UUID | None] = mapped_column(ForeignKey("reservations.id"), unique=True)
