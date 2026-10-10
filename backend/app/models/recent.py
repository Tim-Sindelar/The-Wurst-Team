from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RecentSpace(Base):
    """A study space the user booked or checked in to. One row per user and space."""

    __tablename__ = "recent_spaces"

    user_id: Mapped[UUID] = mapped_column(primary_key=True)
    space_id: Mapped[UUID] = mapped_column(
        ForeignKey("study_spaces.id", ondelete="CASCADE"), primary_key=True
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
