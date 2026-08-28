from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from arq.connections import RedisSettings
from arq.cron import cron
from arq.worker import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import async_session_maker
from app.services.auth_sessions import purge_expired_sessions
from app.services.db_backup import maybe_enqueue_scheduled_backup, run_backup
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


async def purge_auth_sessions_job(_: dict[str, Any]) -> int:
    """Удаляет давно истёкшие refresh-сессии, чтобы таблица не росла бесконечно."""
    async with async_session_maker() as session:
        removed = await purge_expired_sessions(session)
        await session.commit()
    logger.info("Purged expired refresh sessions: %s", removed)
    return removed


async def create_database_backup(ctx: dict[str, Any], backup_id: str) -> None:
    """Полный pg_dump в том /backups. Не ставить в HTTP-запрос: дамп может идти минуты."""
    del ctx
    bid = uuid.UUID(backup_id)
    async with async_session_maker() as session:
        await run_backup(session, bid)
    logger.info("Database backup finished: %s", backup_id)


async def schedule_daily_backup(ctx: dict[str, Any]) -> str:
    """Раз в час: если уже наступило окно и сегодня дампа ещё нет — ставим в очередь."""
    async with async_session_maker() as session:
        result = await maybe_enqueue_scheduled_backup(session, redis=ctx.get("redis"))
    logger.info("Scheduled backup check: %s", result)
    return result


async def worker_startup(_: dict[str, Any]) -> None:
    logger.info(
        "Notification worker started; interval=%s min, max_jobs=%s, backup_tz=%s",
        settings.notification_sync_minutes,
        settings.worker_max_jobs,
        settings.backup_tz,
    )


class WorkerSettings:
    functions = [
        sync_notifications_job,
        func(create_database_backup, name="create_database_backup", timeout=1800, max_tries=2),
        schedule_daily_backup,
        purge_auth_sessions_job,
    ]
    cron_jobs = [
        cron(
            sync_notifications_job,
            minute=set(range(0, 60, settings.notification_sync_minutes)),
            unique=True,
            job_id="sync-notifications",
            run_at_startup=True,
        ),
        cron(
            schedule_daily_backup,
            minute=set(range(0, 60, 5)),
            unique=True,
            job_id="daily-database-backup",
            run_at_startup=True,
        ),
        cron(
            purge_auth_sessions_job,
            hour={4},
            minute={20},
            unique=True,
            job_id="purge-auth-sessions",
        ),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = settings.worker_max_jobs
    job_timeout = 300
    keep_result = 0
    health_check_interval = 30
    on_startup = worker_startup
