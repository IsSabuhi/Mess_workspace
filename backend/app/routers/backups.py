import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import require_any_permission
from app.models import User
from app.models.system_backup import SystemBackup
from app.permissions import ROLES_MANAGE, USERS_MANAGE
from app.schemas.backup import BackupSettingsOut, BackupSettingsPatch, SystemBackupOut
from app.schemas.common import Message
from app.services.audit import record_audit_event
from app.services.db_backup import (
    BackupScheduleSettings,
    create_backup_record,
    delete_backup,
    enqueue_create_backup,
    get_backup_schedule_settings,
    has_active_backup,
    prune_old_backups,
    resolve_backup_file,
    set_backup_schedule_settings,
)

router = APIRouter(prefix="/backups", tags=["backups"])
_ADMIN = require_any_permission(USERS_MANAGE, ROLES_MANAGE)


def _to_out(row: SystemBackup) -> SystemBackupOut:
    if row.created_by is not None:
        name = row.created_by.full_name
    elif row.created_by_id is None:
        name = "по расписанию"
    else:
        name = None
    return SystemBackupOut.model_validate(row).model_copy(update={"created_by_name": name})


def _settings_out(cfg: BackupScheduleSettings) -> BackupSettingsOut:
    return BackupSettingsOut(
        enabled=cfg.enabled,
        retention_days=cfg.retention_days,
        hour=cfg.hour,
        minute=cfg.minute,
        run_at=cfg.run_at,
        timezone=cfg.timezone,
        keep_max=cfg.keep_max,
        latest_size_bytes=cfg.latest_size_bytes,
        estimated_bytes=cfg.estimated_bytes,
    )


@router.get("", response_model=list[SystemBackupOut])
async def list_backups(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_ADMIN)],
) -> list[SystemBackupOut]:
    rows = (
        await session.execute(
            select(SystemBackup)
            .options(selectinload(SystemBackup.created_by))
            .order_by(SystemBackup.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    return [_to_out(r) for r in rows]


@router.get("/settings", response_model=BackupSettingsOut)
async def get_backup_settings(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_ADMIN)],
) -> BackupSettingsOut:
    return _settings_out(await get_backup_schedule_settings(session))


@router.patch("/settings", response_model=BackupSettingsOut)
async def patch_backup_settings(
    body: BackupSettingsPatch,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_ADMIN)],
) -> BackupSettingsOut:
    cfg = await set_backup_schedule_settings(
        session,
        enabled=body.enabled,
        retention_days=body.retention_days,
        hour=body.hour,
        minute=body.minute,
        run_at=body.run_at,
    )
    await prune_old_backups(session)
    await record_audit_event(
        session,
        entity_type="system_backup",
        entity_id=None,
        action="system_backup.settings_updated",
        actor_user_id=user.id,
        details={
            "enabled": cfg.enabled,
            "retention_days": cfg.retention_days,
            "run_at": cfg.run_at,
        },
    )
    return _settings_out(cfg)


@router.post("", response_model=SystemBackupOut, status_code=status.HTTP_202_ACCEPTED)
async def create_backup(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_ADMIN)],
) -> SystemBackupOut:
    if await has_active_backup(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Уже идёт создание резервной копии. Дождитесь завершения.",
        )
    row = await create_backup_record(session, actor_user_id=user.id)
    await record_audit_event(
        session,
        entity_type="system_backup",
        entity_id=row.id,
        action="system_backup.requested",
        actor_user_id=user.id,
        details={"filename": row.filename},
    )
    await session.commit()

    try:
        await enqueue_create_backup(row.id)
    except Exception as exc:  # noqa: BLE001
        fresh = await session.get(SystemBackup, row.id)
        if fresh:
            fresh.status = "failed"
            fresh.error_message = f"Очередь воркера: {exc}"[:2000]
            await session.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Не удалось запустить воркер для дампа. Проверьте, что сервис worker запущен.",
        ) from exc

    row = await session.scalar(
        select(SystemBackup).options(selectinload(SystemBackup.created_by)).where(SystemBackup.id == row.id)
    )
    assert row is not None
    return _to_out(row)


@router.get("/{backup_id}/download")
async def download_backup(
    backup_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_ADMIN)],
) -> FileResponse:
    row = await session.get(SystemBackup, backup_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Резервная копия не найдена")
    if row.status != "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Дамп ещё не готов")
    path = resolve_backup_file(row)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл дампа отсутствует на диске")
    await record_audit_event(
        session,
        entity_type="system_backup",
        entity_id=row.id,
        action="system_backup.downloaded",
        actor_user_id=user.id,
        details={"filename": row.filename},
    )
    return FileResponse(
        path=path,
        filename=row.filename,
        media_type="application/octet-stream",
        headers={"X-Accel-Buffering": "no"},
    )


@router.delete("/{backup_id}", response_model=Message)
async def remove_backup(
    backup_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_ADMIN)],
) -> Message:
    row = await session.get(SystemBackup, backup_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Резервная копия не найдена")
    if row.status in ("pending", "running"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Нельзя удалить дамп, пока он создаётся")
    filename = row.filename
    await delete_backup(session, row)
    await record_audit_event(
        session,
        entity_type="system_backup",
        entity_id=backup_id,
        action="system_backup.deleted",
        actor_user_id=user.id,
        details={"filename": filename},
    )
    return Message(detail="Резервная копия удалена")
