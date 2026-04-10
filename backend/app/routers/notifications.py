import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import Notification, User
from app.schemas.common import Message
from app.schemas.notification import NotificationOut, NotificationUnreadCount
from app.services.notifications import sync_task_deadline_notifications

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    unread_only: bool = False,
    limit: int = 50,
) -> list[NotificationOut]:
    await sync_task_deadline_notifications(session, user)
    safe_limit = max(1, min(limit, 200))
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(safe_limit)
    rows = (await session.execute(stmt)).scalars().all()
    return [NotificationOut.model_validate(n) for n in rows]


@router.get("/unread-count", response_model=NotificationUnreadCount)
async def unread_count(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> NotificationUnreadCount:
    await sync_task_deadline_notifications(session, user)
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
    item = await session.get(Notification, notification_id)
    if not item or item.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if item.read_at is None:
        item.read_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(item)
    return NotificationOut.model_validate(item)


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
