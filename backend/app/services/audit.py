from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEvent
from app.models.system_setting import SystemSetting

AUDIT_ENABLED_KEY = "audit_enabled"
AUDIT_RETENTION_DAYS_KEY = "audit_retention_days"
AUDIT_LAST_CLEANUP_AT_KEY = "audit_last_cleanup_at"

AUDIT_ENABLED_DEFAULT = True
AUDIT_RETENTION_DAYS_DEFAULT = 180


async def get_audit_enabled(session: AsyncSession) -> bool:
    row = await session.get(SystemSetting, AUDIT_ENABLED_KEY)
    if not row:
        return AUDIT_ENABLED_DEFAULT
    return str(row.value).strip().lower() not in {"0", "false", "off", "no"}


async def get_audit_retention_days(session: AsyncSession) -> int:
    row = await session.get(SystemSetting, AUDIT_RETENTION_DAYS_KEY)
    if not row:
        return AUDIT_RETENTION_DAYS_DEFAULT
    try:
        days = int(row.value)
    except (TypeError, ValueError):
        return AUDIT_RETENTION_DAYS_DEFAULT
    return max(7, min(days, 3650))


async def set_audit_settings(session: AsyncSession, *, enabled: bool | None, retention_days: int | None) -> tuple[bool, int]:
    if enabled is not None:
        row = await session.get(SystemSetting, AUDIT_ENABLED_KEY)
        value = "1" if enabled else "0"
        if row:
            row.value = value
        else:
            session.add(SystemSetting(key=AUDIT_ENABLED_KEY, value=value))
    if retention_days is not None:
        normalized = max(7, min(int(retention_days), 3650))
        row = await session.get(SystemSetting, AUDIT_RETENTION_DAYS_KEY)
        if row:
            row.value = str(normalized)
        else:
            session.add(SystemSetting(key=AUDIT_RETENTION_DAYS_KEY, value=str(normalized)))
    await session.flush()
    return await get_audit_enabled(session), await get_audit_retention_days(session)


async def cleanup_audit_events_if_due(session: AsyncSession) -> None:
    enabled = await get_audit_enabled(session)
    if not enabled:
        return
    now = datetime.now(timezone.utc)
    row = await session.get(SystemSetting, AUDIT_LAST_CLEANUP_AT_KEY)
    if row:
        try:
            last = datetime.fromisoformat(row.value)
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if now - last < timedelta(hours=24):
                return
        except ValueError:
            pass
    retention_days = await get_audit_retention_days(session)
    cutoff = now - timedelta(days=retention_days)
    await session.execute(delete(AuditEvent).where(AuditEvent.created_at < cutoff))
    if row:
        row.value = now.isoformat()
    else:
        session.add(SystemSetting(key=AUDIT_LAST_CLEANUP_AT_KEY, value=now.isoformat()))
    await session.flush()


async def record_audit_event(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID | None,
    action: str,
    actor_user_id: uuid.UUID | None,
    details: dict | None = None,
) -> None:
    if not await get_audit_enabled(session):
        return
    await cleanup_audit_events_if_due(session)
    session.add(
        AuditEvent(
            entity_type=entity_type[:64],
            entity_id=entity_id,
            action=action[:128],
            actor_user_id=actor_user_id,
            details_json=json.dumps(details, ensure_ascii=False) if details else None,
        )
    )
    await session.flush()


async def list_audit_events_for_entity(
    session: AsyncSession, *, entity_type: str, entity_id: uuid.UUID, limit: int = 100
) -> list[AuditEvent]:
    lim = max(1, min(limit, 500))
    rows = await session.execute(
        select(AuditEvent)
        .where(AuditEvent.entity_type == entity_type, AuditEvent.entity_id == entity_id)
        .order_by(AuditEvent.created_at.desc())
        .limit(lim)
    )
    return rows.scalars().all()


async def list_audit_events(
    session: AsyncSession,
    *,
    limit: int = 100,
    offset: int = 0,
    entity_type: str | None = None,
    action: str | None = None,
    q: str | None = None,
) -> list[AuditEvent]:
    lim = max(1, min(limit, 500))
    off = max(0, offset)
    stmt = select(AuditEvent)
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type[:64])
    if action:
        stmt = stmt.where(AuditEvent.action.ilike(f"%{action[:128]}%"))
    if q:
        needle = f"%{q[:128]}%"
        stmt = stmt.where(AuditEvent.action.ilike(needle) | AuditEvent.details_json.ilike(needle))
    rows = await session.execute(
        stmt.order_by(AuditEvent.created_at.desc()).offset(off).limit(lim)
    )
    return rows.scalars().all()
