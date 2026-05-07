from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_permission
from app.models import User
from app.permissions import SYSTEMS_MANAGE
from app.schemas.audit import AuditSettingsOut, AuditSettingsPatch
from app.services.audit import get_audit_enabled, get_audit_retention_days, set_audit_settings

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
