from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Причины отзыва (revoked_reason) — короткие коды для журнала и диагностики.
REVOKE_ROTATED = "rotated"
REVOKE_LOGOUT = "logout"
REVOKE_REUSE = "reuse_detected"
REVOKE_PASSWORD_CHANGED = "password_changed"
REVOKE_ACCOUNT_DISABLED = "account_disabled"
REVOKE_EXPIRED = "expired"


class RefreshSession(Base):
    """Одна выданная пара токенов: id совпадает с jti refresh-токена.

    Refresh-токен сам по себе больше не даёт доступа — он действителен, только пока
    существует неотозванная строка. Это и есть механизм logout / отзыва сессии.
    """

    __tablename__ = "refresh_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="refresh_sessions")

    @property
    def is_usable(self) -> bool:
        return self.revoked_at is None and self.expires_at > datetime.now(timezone.utc)
