from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from arq.connections import RedisSettings
from arq.cron import cron
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import async_session_maker
from app.services.notifications import (
    cleanup_old_notifications,
    sync_employee_compliance_notifications,
    sync_note_reminder_notifications,
    sync_task_deadline_notifications_all,
)

logger = logging.getLogger(__name__)
settings = get_settings()

NotificationCheck = Callable[[AsyncSession], Awaitable[int]]


async def _sync_task_deadlines(session: AsyncSession) -> int:
    return await sync_task_deadline_notifications_all(session)


async def _sync_employee_compliance(session: AsyncSession) -> int:
    return await sync_employee_compliance_notifications(session)


async def _sync_note_reminders(session: AsyncSession) -> int:
    return await sync_note_reminder_notifications(session)


NOTIFICATION_CHECKS: dict[str, NotificationCheck] = {
    "task_deadlines": _sync_task_deadlines,
    "employee_compliance": _sync_employee_compliance,
    "note_reminders": _sync_note_reminders,
}


async def sync_notifications_job(_: dict[str, Any]) -> dict[str, int]:
    """Выполняет все проверки уведомлений в отдельном worker-процессе."""
    results: dict[str, int] = {}
    async with async_session_maker() as session:
        for name, check in NOTIFICATION_CHECKS.items():
            results[name] = await check(session)
        results["cleanup"] = await cleanup_old_notifications(session)
    logger.info("Notification checks completed: %s", results)
    return results


async def worker_startup(_: dict[str, Any]) -> None:
    logger.info(
        "Notification worker started; interval=%s min, max_jobs=%s",
        settings.notification_sync_minutes,
        settings.worker_max_jobs,
    )


class WorkerSettings:
    functions = [sync_notifications_job]
    cron_jobs = [
        cron(
            sync_notifications_job,
            minute=set(range(0, 60, settings.notification_sync_minutes)),
            unique=True,
            job_id="sync-notifications",
            run_at_startup=True,
        )
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = settings.worker_max_jobs
    job_timeout = 300
    keep_result = 0
    health_check_interval = 30
    on_startup = worker_startup
