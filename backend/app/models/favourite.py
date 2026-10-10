from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FavouriteSpace(Base):
    __tablename__ = "favourite_spaces"

    user_id: Mapped[UUID] = mapped_column(primary_key=True)
    space_id: Mapped[UUID] = mapped_column(
        ForeignKey("study_spaces.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
