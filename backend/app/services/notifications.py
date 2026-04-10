from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import KanbanColumn, Notification, NotificationType, Task, User

_DUE_SOON_WINDOW = timedelta(days=3)
_TASK_TYPES = {NotificationType.task_due_3_days, NotificationType.task_overdue}


async def sync_task_deadline_notifications(session: AsyncSession, user: User) -> None:
    """Создает уведомления по дедлайнам задач один раз на тип/задачу."""
    now = datetime.now(timezone.utc)
    due_soon_until = now + _DUE_SOON_WINDOW

    stmt = (
        select(Task)
        .join(KanbanColumn, KanbanColumn.id == Task.column_id)
        .where(Task.assignee_id == user.id)
        .where(Task.archived_at.is_(None))
        .where(Task.due_at.is_not(None))
        .where(KanbanColumn.is_done_column.is_(False))
        .options(selectinload(Task.system))
    )
    tasks = (await session.execute(stmt)).scalars().all()
    if not tasks:
        return

    task_ids = [task.id for task in tasks]
    existing_rows = await session.execute(
        select(Notification.task_id, Notification.type)
        .where(Notification.user_id == user.id)
        .where(Notification.task_id.in_(task_ids))
        .where(Notification.type.in_(_TASK_TYPES))
    )
    existing = {(task_id, n_type) for task_id, n_type in existing_rows.all() if task_id is not None}

    created_any = False
    for task in tasks:
        if task.due_at is None:
            continue
        if task.due_at < now:
            n_type = NotificationType.task_overdue
            title = f"Задача просрочена: {task.title}"
            body = "Срок задачи истек. Откройте задачу и обновите дедлайн или статус."
        elif task.due_at <= due_soon_until:
            n_type = NotificationType.task_due_3_days
            title = f"Срок задачи до 3 дней: {task.title}"
            body = "Приближается дедлайн задачи. Проверьте прогресс и план закрытия."
        else:
            continue

        key = (task.id, n_type)
        if key in existing:
            continue
        session.add(
            Notification(
                user_id=user.id,
                type=n_type,
                title=title,
                body=body,
                task_id=task.id,
            )
        )
        created_any = True

    if created_any:
        await session.commit()
