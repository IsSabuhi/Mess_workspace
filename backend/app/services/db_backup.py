from __future__ import annotations

import logging
import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.system_backup import SystemBackup
from app.models.system_setting import SystemSetting
from app.paths import BACKEND_ROOT

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = ("pending", "running")
BACKUP_AUTO_ENABLED_KEY = "backup_auto_enabled"
BACKUP_RETENTION_DAYS_KEY = "backup_retention_days"
BACKUP_HOUR_KEY = "backup_hour"
BACKUP_MINUTE_KEY = "backup_minute"


def backup_tzinfo():
    name = (get_settings().backup_tz or "Asia/Krasnoyarsk").strip() or "Asia/Krasnoyarsk"
    try:
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001
        return timezone(timedelta(hours=7))


def local_now() -> datetime:
    return datetime.now(backup_tzinfo())


@dataclass(frozen=True)
class BackupScheduleSettings:
    enabled: bool
    retention_days: int
    hour: int
    minute: int
    timezone: str
    keep_max: int
    latest_size_bytes: int | None
    estimated_bytes: int | None

    @property
    def run_at(self) -> str:
        return f"{self.hour:02d}:{self.minute:02d}"


def _clamp_days(value: int) -> int:
    return max(1, min(int(value), 365))


def _clamp_hour(value: int) -> int:
    return max(0, min(int(value), 23))


def _clamp_minute(value: int) -> int:
    return max(0, min(int(value), 59))


def parse_run_at(value: str) -> tuple[int, int]:
    raw = (value or "").strip()
    parts = raw.split(":")
    if len(parts) != 2:
        raise ValueError("Ожидается время в формате ЧЧ:ММ")
    hour = _clamp_hour(int(parts[0]))
    minute = _clamp_minute(int(parts[1]))
    return hour, minute


async def _get_setting(session: AsyncSession, key: str) -> str | None:
    row = await session.get(SystemSetting, key)
    return row.value if row else None


async def _set_setting(session: AsyncSession, key: str, value: str) -> None:
    row = await session.get(SystemSetting, key)
    if row:
        row.value = value
    else:
        session.add(SystemSetting(key=key, value=value))


async def get_backup_schedule_settings(session: AsyncSession) -> BackupScheduleSettings:
    defaults = get_settings()
    raw_enabled = await _get_setting(session, BACKUP_AUTO_ENABLED_KEY)
    if raw_enabled is None:
        enabled = defaults.backup_auto_enabled
    else:
        enabled = str(raw_enabled).strip().lower() not in {"0", "false", "off", "no"}
    raw_days = await _get_setting(session, BACKUP_RETENTION_DAYS_KEY)
    try:
        retention_days = _clamp_days(int(raw_days) if raw_days is not None else defaults.backup_retention_days)
    except (TypeError, ValueError):
        retention_days = _clamp_days(defaults.backup_retention_days)
    raw_hour = await _get_setting(session, BACKUP_HOUR_KEY)
    try:
        hour = _clamp_hour(int(raw_hour) if raw_hour is not None else defaults.backup_hour)
    except (TypeError, ValueError):
        hour = _clamp_hour(defaults.backup_hour)
    raw_minute = await _get_setting(session, BACKUP_MINUTE_KEY)
    try:
        minute = _clamp_minute(int(raw_minute) if raw_minute is not None else defaults.backup_minute)
    except (TypeError, ValueError):
        minute = _clamp_minute(defaults.backup_minute)
    latest = await session.scalar(
        select(SystemBackup.size_bytes)
        .where(SystemBackup.status == "completed")
        .where(SystemBackup.size_bytes.is_not(None))
        .order_by(SystemBackup.created_at.desc())
        .limit(1)
    )
    estimated = int(latest) * retention_days if latest else None
    return BackupScheduleSettings(
        enabled=enabled,
        retention_days=retention_days,
        hour=hour,
        minute=minute,
        timezone=defaults.backup_tz or "Asia/",
        keep_max=max(1, defaults.backup_keep),
        latest_size_bytes=int(latest) if latest is not None else None,
        estimated_bytes=estimated,
    )


async def set_backup_schedule_settings(
    session: AsyncSession,
    *,
    enabled: bool | None = None,
    retention_days: int | None = None,
    hour: int | None = None,
    minute: int | None = None,
    run_at: str | None = None,
) -> BackupScheduleSettings:
    if enabled is not None:
        await _set_setting(session, BACKUP_AUTO_ENABLED_KEY, "1" if enabled else "0")
    if retention_days is not None:
        await _set_setting(session, BACKUP_RETENTION_DAYS_KEY, str(_clamp_days(retention_days)))
    if run_at is not None:
        hour, minute = parse_run_at(run_at)
    if hour is not None:
        await _set_setting(session, BACKUP_HOUR_KEY, str(_clamp_hour(hour)))
    if minute is not None:
        await _set_setting(session, BACKUP_MINUTE_KEY, str(_clamp_minute(minute)))
    await session.flush()
    return await get_backup_schedule_settings(session)


def backup_root() -> Path:
    raw = (get_settings().backup_dir or "").strip()
    root = Path(raw) if raw else BACKEND_ROOT / "var" / "backups"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _pg_dump_bin() -> str:
    found = shutil.which("pg_dump")
    if not found:
        raise RuntimeError(
            "В контейнере нет pg_dump. Нужен пакет postgresql-client (образ api/worker пересоберите)."
        )
    return found


def _dump_database_to(path: Path) -> None:
    url = make_url(get_settings().database_url)
    host = url.host or "127.0.0.1"
    port = str(url.port or 5432)
    database = url.database
    username = url.username or "postgres"
    if not database:
        raise RuntimeError("В DATABASE_URL не указано имя базы")

    env = os.environ.copy()
    if url.password is not None:
        env["PGPASSWORD"] = url.password

    cmd = [
        _pg_dump_bin(),
        "--format=custom",
        "--compress=6",
        "--no-owner",
        "--no-acl",
        "--file",
        str(path),
        "--host",
        host,
        "--port",
        port,
        "--username",
        username,
        "--dbname",
        database,
    ]
    logger.info("Running pg_dump to %s (host=%s db=%s)", path, host, database)
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip() or f"pg_dump exited {proc.returncode}"
        raise RuntimeError(err[:2000])
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError("pg_dump завершился, но файл дампа пустой")


async def has_active_backup(session: AsyncSession) -> bool:
    row = await session.scalar(
        select(SystemBackup.id).where(SystemBackup.status.in_(ACTIVE_STATUSES)).limit(1)
    )
    return row is not None


async def has_completed_backup_on_local_date(session: AsyncSession, local_day: date) -> bool:
    tz = backup_tzinfo()
    start = datetime.combine(local_day, time.min, tzinfo=tz)
    end = start + timedelta(days=1)
    row = await session.scalar(
        select(SystemBackup.id)
        .where(SystemBackup.status == "completed")
        .where(SystemBackup.source == "scheduled")
        .where(SystemBackup.created_at >= start)
        .where(SystemBackup.created_at < end)
        .limit(1)
    )
    return row is not None


async def create_backup_record(
    session: AsyncSession,
    *,
    actor_user_id: uuid.UUID | None,
    source: str = "manual",
) -> SystemBackup:
    kind = source if source in ("manual", "scheduled") else "manual"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    suffix = "_auto" if kind == "scheduled" else ""
    filename = f"mess_db_{stamp}{suffix}.dump"
    row = SystemBackup(
        filename=filename,
        status="pending",
        source=kind,
        created_by_id=actor_user_id,
    )
    session.add(row)
    await session.flush()
    return row


async def enqueue_create_backup(backup_id: uuid.UUID, redis=None) -> None:
    close_pool = False
    if redis is None:
        from arq import create_pool
        from arq.connections import RedisSettings

        redis = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
        close_pool = True
    try:
        job = await redis.enqueue_job("create_database_backup", str(backup_id))
        if job is None:
            raise RuntimeError("Не удалось поставить задачу в очередь (воркер занят той же задачей)")
    finally:
        if close_pool:
            aclose = getattr(redis, "aclose", None)
            if aclose is not None:
                await aclose()
            else:
                await redis.close()


async def maybe_enqueue_scheduled_backup(session: AsyncSession, redis=None) -> str:
    """Ежедневный дамп: не чаще одного успешного за локальные сутки."""
    cfg = await get_backup_schedule_settings(session)
    await prune_old_backups(session)
    if not cfg.enabled:
        return "disabled"
    now = local_now()
    scheduled_minutes = cfg.hour * 60 + cfg.minute
    if now.hour * 60 + now.minute < scheduled_minutes:
        return "too_early"
    if await has_completed_backup_on_local_date(session, now.date()):
        return "already_today"
    if await has_active_backup(session):
        return "active"
    row = await create_backup_record(session, actor_user_id=None, source="scheduled")
    await session.commit()
    try:
        await enqueue_create_backup(row.id, redis)
    except Exception:
        fresh = await session.get(SystemBackup, row.id)
        if fresh and fresh.status == "pending":
            fresh.status = "failed"
            fresh.error_message = "Не удалось поставить автобэкап в очередь воркера"
            fresh.finished_at = datetime.now(timezone.utc)
            await session.commit()
        raise
    logger.info("Scheduled database backup enqueued: %s", row.id)
    return f"enqueued:{row.id}"


async def run_backup(session: AsyncSession, backup_id: uuid.UUID) -> None:
    row = await session.get(SystemBackup, backup_id)
    if not row:
        logger.warning("Backup %s not found", backup_id)
        return
    if row.status == "completed":
        return
    row.status = "running"
    row.error_message = None
    await session.commit()

    dest = backup_root() / f"{row.id}.dump"
    tmp = dest.with_suffix(".dump.partial")
    try:
        if tmp.exists():
            tmp.unlink()
        _dump_database_to(tmp)
        tmp.replace(dest)
        row.storage_path = str(dest)
        row.size_bytes = dest.stat().st_size
        row.status = "completed"
        row.finished_at = datetime.now(timezone.utc)
        row.error_message = None
        await session.commit()
        try:
            await prune_old_backups(session)
        except Exception:  # noqa: BLE001
            logger.exception("Prune old backups failed after %s", backup_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Database backup %s failed", backup_id)
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        row = await session.get(SystemBackup, backup_id)
        if dest.exists() and (row is None or row.status != "completed"):
            dest.unlink(missing_ok=True)
        if row and row.status != "completed":
            row.status = "failed"
            row.error_message = str(exc)[:2000]
            row.finished_at = datetime.now(timezone.utc)
            await session.commit()


async def prune_old_backups(session: AsyncSession) -> None:
    cfg = await get_backup_schedule_settings(session)
    cutoff = datetime.now(timezone.utc) - timedelta(days=cfg.retention_days)
    stale = (
        await session.execute(
            select(SystemBackup)
            .where(SystemBackup.status.in_(("completed", "failed")))
            .where(SystemBackup.created_at < cutoff)
        )
    ).scalars().all()
    for row in stale:
        _unlink_backup_file(row)
        await session.delete(row)

    completed = (
        await session.execute(
            select(SystemBackup)
            .where(SystemBackup.status == "completed")
            .order_by(SystemBackup.created_at.desc())
        )
    ).scalars().all()
    for extra in completed[cfg.keep_max :]:
        _unlink_backup_file(extra)
        await session.delete(extra)
    await session.commit()


def resolve_backup_file(row: SystemBackup) -> Path | None:
    if not row.storage_path:
        return None
    path = Path(row.storage_path)
    try:
        path.resolve().relative_to(backup_root())
    except ValueError:
        return None
    return path if path.is_file() else None


def _unlink_backup_file(row: SystemBackup) -> None:
    path = resolve_backup_file(row)
    if path is not None:
        path.unlink(missing_ok=True)


async def delete_backup(session: AsyncSession, row: SystemBackup) -> None:
    _unlink_backup_file(row)
    await session.delete(row)
    await session.flush()
