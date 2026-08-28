"""Жизненный цикл refresh-сессий: выдача, ротация, отзыв.

Refresh-токен действителен только пока в БД есть неотозванная строка с его jti.
Благодаря этому logout, смена пароля и отключение учётки реально прекращают доступ,
а не просто удаляют cookie у клиента.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.refresh_session import REVOKE_ROTATED, RefreshSession
from app.security import create_refresh_token
from app.services.request_client import client_ip

# Несколько вкладок делят одну cookie и могут обменять один и тот же refresh почти
# одновременно: вторая придёт с уже провёрнутым jti. В этом окне такой повтор считается
# гонкой вкладок, а не кражей токена.
ROTATION_GRACE_SECONDS = 30


async def issue_refresh_session(
    session: AsyncSession, user_id: uuid.UUID, request: Request | None = None
) -> str:
    """Создаёт новую сессию и возвращает подписанный refresh-токен для cookie."""
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    row = RefreshSession(
        user_id=user_id,
        expires_at=expires_at,
        ip_address=client_ip(request) if request else None,
        user_agent=request.headers.get("user-agent") if request else None,
    )
    session.add(row)
    await session.flush()
    return create_refresh_token(str(user_id), str(row.id), expires_at)


async def get_refresh_session(session: AsyncSession, jti: uuid.UUID) -> RefreshSession | None:
    return await session.get(RefreshSession, jti)


def is_concurrent_rotation(row: RefreshSession) -> bool:
    """Отозван только что и именно ротацией — значит это параллельный запрос той же сессии."""
    if row.revoked_at is None or row.revoked_reason != REVOKE_ROTATED:
        return False
    age = datetime.now(timezone.utc) - row.revoked_at
    return age.total_seconds() <= ROTATION_GRACE_SECONDS


async def revoke_session(session: AsyncSession, row: RefreshSession, reason: str) -> None:
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        row.revoked_reason = reason[:32]
        await session.flush()


async def revoke_all_user_sessions(session: AsyncSession, user_id: uuid.UUID, reason: str) -> int:
    """Отзывает все живые сессии пользователя. Возвращает число затронутых."""
    result = await session.execute(
        update(RefreshSession)
        .where(RefreshSession.user_id == user_id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc), revoked_reason=reason[:32])
    )
    await session.flush()
    return int(result.rowcount or 0)


async def purge_expired_sessions(session: AsyncSession, *, keep_days: int = 7) -> int:
    """Удаляет строки, истёкшие более keep_days назад (запас нужен для reuse detection)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
    result = await session.execute(delete(RefreshSession).where(RefreshSession.expires_at < cutoff))
    await session.flush()
    return int(result.rowcount or 0)
