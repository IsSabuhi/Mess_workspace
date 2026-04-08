from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserSystem(Base):
    """Связь сотрудник ↔ производственные системы (многие ко многим)."""

    __tablename__ = "user_systems"
    __table_args__ = (UniqueConstraint("user_id", "system_id", name="uq_user_system"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    system_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("systems.id", ondelete="CASCADE"), primary_key=True
    )

    user: Mapped["User"] = relationship(back_populates="system_memberships")
    system: Mapped["System"] = relationship(back_populates="user_memberships")
