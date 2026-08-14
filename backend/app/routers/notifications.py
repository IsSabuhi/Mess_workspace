import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import get_current_user, require_any_permission
from app.models import Notification, User
from app.permissions import ROLES_MANAGE, USERS_MANAGE
from app.schemas.common import Message
from app.schemas.notification import (
    NotificationOut,
    NotificationSettingsOut,
    NotificationSettingsPatch,
    NotificationUnreadCount,
)
from app.services.notifications import (
    cleanup_old_notifications,
    get_notification_retention_settings,
    set_notification_retention_settings,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])
_ADMIN = require_any_permission(USERS_MANAGE, ROLES_MANAGE)


def _notification_to_out(item: Notification) -> NotificationOut:
    board_id = item.task.board_id if item.task is not None else None
    return NotificationOut.model_validate(item).model_copy(
        update={
            "board_id": board_id,
            "personal_note_id": item.personal_note_id,
        }
    )


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    unread_only: bool = False,
    limit: int = 50,
) -> list[NotificationOut]:
    safe_limit = max(1, min(limit, 200))
    stmt = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .options(selectinload(Notification.task))
    )
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(safe_limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [_notification_to_out(n) for n in rows]


@router.get("/settings", response_model=NotificationSettingsOut)
async def get_notification_settings(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_ADMIN)],
) -> NotificationSettingsOut:
    enabled, read_days, unread_days, note_reminder_days = await get_notification_retention_settings(session)
    return NotificationSettingsOut(
        enabled=enabled,
        read_days=read_days,
        unread_days=unread_days,
        note_reminder_days=note_reminder_days,
    )


@router.patch("/settings", response_model=NotificationSettingsOut)
async def patch_notification_settings(
    body: NotificationSettingsPatch,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_ADMIN)],
) -> NotificationSettingsOut:
    enabled, read_days, unread_days, note_reminder_days = await set_notification_retention_settings(
        session,
        enabled=body.enabled,
        read_days=body.read_days,
        unread_days=body.unread_days,
        note_reminder_days=body.note_reminder_days,
    )
    if enabled:
        await cleanup_old_notifications(session, force=True)
    return NotificationSettingsOut(
        enabled=enabled,
        read_days=read_days,
        unread_days=unread_days,
        note_reminder_days=note_reminder_days,
    )


@router.get("/unread-count", response_model=NotificationUnreadCount)
async def unread_count(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> NotificationUnreadCount:
    count_stmt = (
        select(func.count(Notification.id))
        .where(Notification.user_id == user.id)
        .where(Notification.read_at.is_(None))
    )
    unread = int((await session.execute(count_stmt)).scalar_one())
    return NotificationUnreadCount(unread_count=unread)


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> NotificationOut:
    item = await session.scalar(
        select(Notification)
        .where(Notification.id == notification_id)
        .options(selectinload(Notification.task))
    )
    if not item or item.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if item.read_at is None:
        item.read_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(item)
        # re-load task after refresh (relationship may be expired)
        item = await session.scalar(
            select(Notification)
            .where(Notification.id == notification_id)
            .options(selectinload(Notification.task))
        )
        assert item is not None
    return _notification_to_out(item)


@router.post("/read-all", response_model=Message)
async def mark_all_read(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Message:
    stmt = select(Notification).where(Notification.user_id == user.id).where(Notification.read_at.is_(None))
    items = (await session.execute(stmt)).scalars().all()
    if not items:
        return Message(detail="Нет непрочитанных уведомлений")
    now = datetime.now(timezone.utc)
    for item in items:
        item.read_at = now
    await session.commit()
    return Message(detail="Все уведомления отмечены прочитанными")
