import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_permission
from app.models import User
from app.permissions import SYSTEMS_MANAGE
from app.schemas.audit import AuditEventOut, AuditSettingsOut, AuditSettingsPatch
from app.services.audit import (
    get_audit_enabled,
    get_audit_retention_days,
    list_audit_events,
    set_audit_settings,
)

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/settings", response_model=AuditSettingsOut)
async def get_settings(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(SYSTEMS_MANAGE))],
) -> AuditSettingsOut:
    return AuditSettingsOut(
        enabled=await get_audit_enabled(session),
        retention_days=await get_audit_retention_days(session),
    )


@router.patch("/settings", response_model=AuditSettingsOut)
async def patch_settings(
    body: AuditSettingsPatch,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(SYSTEMS_MANAGE))],
) -> AuditSettingsOut:
    enabled, retention_days = await set_audit_settings(
        session, enabled=body.enabled, retention_days=body.retention_days
    )
    return AuditSettingsOut(enabled=enabled, retention_days=retention_days)


@router.get("/events", response_model=list[AuditEventOut])
async def get_events(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(SYSTEMS_MANAGE))],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    entity_type: str | None = None,
    action: str | None = None,
    q: str | None = None,
) -> list[AuditEventOut]:
    rows = await list_audit_events(
        session,
        limit=limit,
        offset=offset,
        entity_type=entity_type,
        action=action,
        q=q,
    )
    user_ids = {r.actor_user_id for r in rows if r.actor_user_id is not None}
    names_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users = await session.execute(select(User.id, User.full_name).where(User.id.in_(user_ids)))
        names_by_id = {uid: name for uid, name in users.all()}
    return [
        AuditEventOut(
            id=r.id,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            action=r.action,
            actor_user_id=r.actor_user_id,
            actor_name=names_by_id.get(r.actor_user_id) if r.actor_user_id else None,
            details_json=r.details_json,
            created_at=r.created_at,
        )
        for r in rows
    ]
