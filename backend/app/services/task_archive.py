from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KanbanColumn, Task
from app.models.system_setting import SystemSetting

TASK_AUTO_ARCHIVE_DAYS_KEY = "task_auto_archive_done_days"
TASK_AUTO_ARCHIVE_DAYS_DEFAULT = 60


async def get_task_auto_archive_days(session: AsyncSession) -> int:
    row = await session.get(SystemSetting, TASK_AUTO_ARCHIVE_DAYS_KEY)
    if not row:
        return TASK_AUTO_ARCHIVE_DAYS_DEFAULT
    try:
        days = int(row.value)
    except (TypeError, ValueError):
        return TASK_AUTO_ARCHIVE_DAYS_DEFAULT
    if days < 1:
        return TASK_AUTO_ARCHIVE_DAYS_DEFAULT
    return min(days, 3650)


async def set_task_auto_archive_days(session: AsyncSession, days: int) -> int:
    normalized = max(1, min(int(days), 3650))
    row = await session.get(SystemSetting, TASK_AUTO_ARCHIVE_DAYS_KEY)
    if row:
        row.value = str(normalized)
    else:
        session.add(SystemSetting(key=TASK_AUTO_ARCHIVE_DAYS_KEY, value=str(normalized)))
    await session.flush()
    return normalized


async def auto_archive_done_tasks(session: AsyncSession) -> int:
    days = await get_task_auto_archive_days(session)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    stmt = (
        select(Task)
        .join(KanbanColumn, KanbanColumn.id == Task.column_id)
        .where(Task.archived_at.is_(None))
        .where(KanbanColumn.is_done_column.is_(True))
        .where(Task.updated_at <= cutoff)
    )
    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return 0
    now = datetime.now(timezone.utc)
    for task in rows:
        task.archived_at = now
    await session.flush()
    return len(rows)
