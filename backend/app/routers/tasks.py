import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import exists, false, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.http_errors import (
    FORBIDDEN,
    TASK_ASSIGNEE_NOT_ALLOWED,
    TASK_NO_SYSTEM_MEMBERSHIP,
    TASK_PICK_SYSTEM,
    TASK_SYSTEM_NOT_ALLOWED,
    TASK_SYSTEM_REQUIRED,
    UNKNOWN_SYSTEM,
)
from app.deps import get_current_user, require_any_permission, require_permission
from app.models import (
    Board,
    KanbanColumn,
    Notification,
    NotificationType,
    System,
    Task,
    TaskAttachment,
    TaskComment,
    TaskTag,
    User,
    UserSystem,
)
from app.models.board import BOARD_SCOPE_SYSTEM
from app.models.task import task_assignees_table
from app.permissions import ROLES_MANAGE, TASKS_READ_ASSIGNED, USERS_MANAGE
from app.schemas.audit import AuditEventOut
from app.schemas.task import (
    ChecklistItem,
    ColumnMini,
    TaskAnalyticsBucketOut,
    TaskAnalyticsKpiOut,
    TaskAnalyticsOut,
    TaskAttachmentOut,
    TaskDueTrendPointOut,
    SystemMini,
    TagMini,
    TaskCommentCreate,
    TaskCommentOut,
    TaskCommentUpdate,
    TaskCreate,
    TaskOut,
    TaskUpdate,
    UserMini,
)
from app.schemas.task_excel_import import TaskExcelImportBatchOut
from app.services.authz import user_has_permission, user_sees_all_tasks
from app.services.audit import list_audit_events_for_entity, record_audit_event
from app.services.board_lock import can_bypass_board_editing_lock, is_global_board_locked
from app.services.board_members import allowed_assignee_ids_for_board
from app.services.file_storage import save_task_file
from app.services.task_archive import auto_archive_done_tasks
from app.services.task_excel_import import import_tasks_from_excel_batch
from app.services.task_policy import (
    can_comment_on_task,
    can_create_task_on_board,
    can_delete_task,
    can_move_task,
    can_read_task,
    can_update_task,
    can_update_task_description_when_locked,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])
_MENTION_RE = re.compile(r"@([a-zA-Z0-9_.+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})")
_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
_ALLOWED_ATTACHMENT_CT = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
}


def _task_in_done_column(task: Task) -> bool:
    c = task.column
    if not c:
        return False
    if c.is_done_column:
        return True
    return (c.slug or "") == "done"


def _task_is_active(task: Task) -> bool:
    if task.archived_at is not None:
        return False
    return not _task_in_done_column(task)


def _task_is_overdue(task: Task, now: datetime) -> bool:
    if not _task_is_active(task):
        return False
    if task.due_at is None:
        return False
    return task.due_at < now


async def _user_system_ids(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    r = await session.execute(select(UserSystem.system_id).where(UserSystem.user_id == user_id))
    return list(r.scalars().all())


_TASK_LOAD = (
    selectinload(Task.assignees),
    selectinload(Task.creator),
    selectinload(Task.system),
    selectinload(Task.column),
    selectinload(Task.board),
    selectinload(Task.tags),
    selectinload(Task.attachments).selectinload(TaskAttachment.uploaded_by),
)


def _normalize_checklist(items: list[ChecklistItem] | list[dict] | None) -> list[dict]:
    if not items:
        return []
    out: list[dict] = []
    for raw in items:
        if isinstance(raw, ChecklistItem):
            item = raw
        else:
            item = ChecklistItem.model_validate(raw)
        out.append(item.model_dump())
    return out


def _attachment_to_out(att: TaskAttachment) -> TaskAttachmentOut:
    return TaskAttachmentOut(
        id=att.id,
        task_id=att.task_id,
        filename=att.filename,
        content_type=att.content_type,
        size_bytes=att.size_bytes,
        url=att.url,
        uploaded_by_id=att.uploaded_by_id,
        created_at=att.created_at,
        uploaded_by=UserMini.model_validate(att.uploaded_by) if att.uploaded_by else None,
    )


async def _comments_counts(
    session: AsyncSession, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not task_ids:
        return {}
    rows = (
        await session.execute(
            select(TaskComment.task_id, func.count())
            .where(TaskComment.task_id.in_(task_ids))
            .group_by(TaskComment.task_id)
        )
    ).all()
    return {tid: int(n) for tid, n in rows}


def _task_to_out(task: Task, *, comments_count: int = 0) -> TaskOut:
    checklist = _normalize_checklist(task.checklist or [])
    return TaskOut(
        id=task.id,
        title=task.title,
        description=task.description,
        board_id=task.board_id,
        column_id=task.column_id,
        system_id=task.system_id,
        creator_id=task.creator_id,
        priority=task.priority,
        due_at=task.due_at,
        estimate_hours=task.estimate_hours,
        checklist=[ChecklistItem.model_validate(x) for x in checklist],
        position=task.position,
        created_at=task.created_at,
        updated_at=task.updated_at,
        archived_at=task.archived_at,
        assignees=[UserMini.model_validate(u) for u in task.assignees],
        creator=UserMini.model_validate(task.creator) if task.creator else None,
        system=SystemMini.model_validate(task.system) if task.system else None,
        column=ColumnMini.model_validate(task.column) if task.column else None,
        tags=[TagMini.model_validate(t) for t in task.tags],
        attachments=[_attachment_to_out(a) for a in (task.attachments or [])],
        comments_count=max(0, int(comments_count)),
    )


async def _task_to_out_with_counts(session: AsyncSession, task: Task) -> TaskOut:
    counts = await _comments_counts(session, [task.id])
    return _task_to_out(task, comments_count=counts.get(task.id, 0))


async def _resolve_tags(session: AsyncSession, tag_ids: list[uuid.UUID]) -> list[TaskTag]:
    if not tag_ids:
        return []
    unique_ids = list(dict.fromkeys(tag_ids))
    tags = (await session.execute(select(TaskTag).where(TaskTag.id.in_(unique_ids)))).scalars().all()
    if len(tags) != len(unique_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tags")
    tags_by_id = {t.id: t for t in tags}
    return [tags_by_id[i] for i in unique_ids]


async def _resolve_assignee_users(
    session: AsyncSession,
    ids: list[uuid.UUID],
    *,
    board: Board | None = None,
    allow_existing_ids: set[uuid.UUID] | None = None,
) -> list[User]:
    uniq = list(dict.fromkeys(ids))
    allowed: set[uuid.UUID] | None = None
    if board is not None:
        allowed = await allowed_assignee_ids_for_board(session, board)
    out: list[User] = []
    for uid in uniq:
        u = await session.get(User, uid)
        if not u or not u.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignee")
        if allowed is not None and uid not in allowed:
            if not allow_existing_ids or uid not in allow_existing_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=TASK_ASSIGNEE_NOT_ALLOWED
                )
        out.append(u)
    return out


async def _apply_task_list_scope(session: AsyncSession, user: User, stmt):
    if await user_sees_all_tasks(session, user):
        return stmt
    system_ids = await _user_system_ids(session, user.id)
    if system_ids:
        return stmt.where(Task.system_id.in_(system_ids))
    if await user_has_permission(session, user, TASKS_READ_ASSIGNED):
        sub = exists().where(
            task_assignees_table.c.task_id == Task.id,
            task_assignees_table.c.user_id == user.id,
        )
        return stmt.where(sub)
    return stmt.where(false())


def _comment_to_out(comment: TaskComment) -> TaskCommentOut:
    return TaskCommentOut(
        id=comment.id,
        task_id=comment.task_id,
        author_id=comment.author_id,
        body=comment.body,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        author=UserMini.model_validate(comment.author) if comment.author else None,
    )


async def _can_manage_comment(session: AsyncSession, user: User, task: Task, comment: TaskComment) -> bool:
    del session, task
    if user.is_superuser:
        return True
    return comment.author_id == user.id


async def _notify_mentions(session: AsyncSession, task: Task, actor: User, text: str) -> None:
    mentioned_emails = {m.lower() for m in _MENTION_RE.findall(text)}
    mentioned_names = {m.strip().lower() for m in re.findall(r"@\[([^\]]{1,255})\]", text) if m.strip()}
    users_by_id: dict[uuid.UUID, User] = {}
    if mentioned_emails:
        users_by_email = (
            await session.execute(
                select(User).where(User.is_active.is_(True)).where(User.email.in_(mentioned_emails))
            )
        ).scalars().all()
        for u in users_by_email:
            users_by_id[u.id] = u
    if mentioned_names:
        users_by_name = (await session.execute(select(User).where(User.is_active.is_(True)))).scalars().all()
        for u in users_by_name:
            if u.full_name.strip().lower() in mentioned_names:
                users_by_id[u.id] = u
    for mentioned in users_by_id.values():
        if mentioned.id == actor.id:
            continue
        if not await can_read_task(session, mentioned, task):
            continue
        already = await session.scalar(
            select(Notification.id)
            .where(Notification.user_id == mentioned.id)
            .where(Notification.type == NotificationType.task_mention)
            .where(Notification.task_id == task.id)
        )
        if already:
            continue
        session.add(
            Notification(
                user_id=mentioned.id,
                type=NotificationType.task_mention,
                title=f"Вас упомянули в задаче: {task.title}",
                body=f"{actor.full_name}: {text[:220]}",
                task_id=task.id,
            )
        )


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    system_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
    column_id: uuid.UUID | None = None,
    board_id: uuid.UUID | None = None,
    include_archived: bool = False,
) -> list[TaskOut]:
    await auto_archive_done_tasks(session)
    stmt = select(Task).options(*_TASK_LOAD).order_by(Task.position, Task.created_at)
    stmt = await _apply_task_list_scope(session, user, stmt)
    if not include_archived:
        stmt = stmt.where(Task.archived_at.is_(None))
    if system_id:
        stmt = stmt.where(Task.system_id == system_id)
    if assignee_id:
        sub = exists().where(
            task_assignees_table.c.task_id == Task.id,
            task_assignees_table.c.user_id == assignee_id,
        )
        stmt = stmt.where(sub)
    if column_id:
        stmt = stmt.where(Task.column_id == column_id)
    if board_id:
        stmt = stmt.where(Task.board_id == board_id)

    result = await session.execute(stmt)
    tasks = result.scalars().unique().all()
    allowed: list[Task] = []
    for t in tasks:
        if await can_read_task(session, user, t):
            allowed.append(t)
    counts = await _comments_counts(session, [t.id for t in allowed])
    return [_task_to_out(t, comments_count=counts.get(t.id, 0)) for t in allowed]


@router.get("/analytics", response_model=TaskAnalyticsOut)
async def tasks_analytics(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    system_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
    column_id: uuid.UUID | None = None,
    include_archived: bool = False,
    trend_days: int = 14,
) -> TaskAnalyticsOut:
    await auto_archive_done_tasks(session)
    stmt = select(Task).options(*_TASK_LOAD).order_by(Task.position, Task.created_at)
    stmt = await _apply_task_list_scope(session, user, stmt)
    if not include_archived:
        stmt = stmt.where(Task.archived_at.is_(None))
    if system_id:
        stmt = stmt.where(Task.system_id == system_id)
    if assignee_id:
        sub = exists().where(
            task_assignees_table.c.task_id == Task.id,
            task_assignees_table.c.user_id == assignee_id,
        )
        stmt = stmt.where(sub)
    if column_id:
        stmt = stmt.where(Task.column_id == column_id)

    result = await session.execute(stmt)
    rows = [t for t in result.scalars().unique().all() if await can_read_task(session, user, t)]
    now = datetime.now(timezone.utc)
    due_soon_limit = now + timedelta(days=3)
    trend_days = max(1, min(90, trend_days))
    trend_from = now - timedelta(days=trend_days - 1)

    kpi_total = 0
    kpi_active = 0
    kpi_overdue = 0
    kpi_due_soon = 0
    kpi_unassigned = 0
    kpi_high = 0

    by_system: dict[str, TaskAnalyticsBucketOut] = {}
    by_column: dict[str, TaskAnalyticsBucketOut] = {}
    by_assignee: dict[str, TaskAnalyticsBucketOut] = {}
    trend_map: dict[str, TaskDueTrendPointOut] = {}
    for i in range(trend_days):
        d = (trend_from + timedelta(days=i)).date().isoformat()
        trend_map[d] = TaskDueTrendPointOut(date=d, due_total=0, overdue_total=0)

    def _upd_bucket(m: dict[str, TaskAnalyticsBucketOut], key: str, label: str, is_active: bool, is_overdue: bool):
        if key not in m:
            m[key] = TaskAnalyticsBucketOut(key=key, label=label, total=0, active=0, overdue=0)
        b = m[key]
        b.total += 1
        if is_active:
            b.active += 1
        if is_overdue:
            b.overdue += 1

    for t in rows:
        is_active = _task_is_active(t)
        is_overdue = _task_is_overdue(t, now)
        kpi_total += 1
        if is_active:
            kpi_active += 1
        if is_overdue:
            kpi_overdue += 1
        if is_active and t.due_at is not None and now <= t.due_at <= due_soon_limit:
            kpi_due_soon += 1
        if len(t.assignees or []) == 0:
            kpi_unassigned += 1
        if t.priority.value in ("high", "urgent"):
            kpi_high += 1

        sys_key = str(t.system.id) if t.system else "__none__"
        sys_label = t.system.name if t.system else "Без системы"
        _upd_bucket(by_system, sys_key, sys_label, is_active, is_overdue)

        col_key = str(t.column.id) if t.column else "__none__"
        col_label = t.column.name if t.column else "Без колонки"
        _upd_bucket(by_column, col_key, col_label, is_active, is_overdue)

        if len(t.assignees or []) == 0:
            _upd_bucket(by_assignee, "__none__", "Не назначен", is_active, is_overdue)
        else:
            for a in t.assignees:
                _upd_bucket(by_assignee, str(a.id), a.full_name, is_active, is_overdue)

        if t.due_at is not None:
            dd = t.due_at.date().isoformat()
            if dd in trend_map:
                trend_map[dd].due_total += 1
                if is_overdue:
                    trend_map[dd].overdue_total += 1

    return TaskAnalyticsOut(
        kpi=TaskAnalyticsKpiOut(
            total=kpi_total,
            active=kpi_active,
            overdue=kpi_overdue,
            due_soon=kpi_due_soon,
            unassigned=kpi_unassigned,
            high_priority=kpi_high,
        ),
        by_system=sorted(by_system.values(), key=lambda x: (x.overdue, x.total), reverse=True),
        by_column=sorted(by_column.values(), key=lambda x: (x.total, x.overdue), reverse=True),
        by_assignee=sorted(by_assignee.values(), key=lambda x: (x.overdue, x.total), reverse=True),
        due_trend=list(trend_map.values()),
    )


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TaskOut:
    stmt = select(Task).where(Task.id == task_id).options(*_TASK_LOAD)
    task = (await session.execute(stmt)).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_read_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    return await _task_to_out_with_counts(session, task)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TaskOut:
    board_id = body.board_id
    if board_id is None:
        board_id = await session.scalar(select(Board.id).where(Board.is_default.is_(True)))
    if not board_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Default board missing")

    board = await session.get(Board, board_id)
    if not board or board.is_archived:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid board")
    if not await can_create_task_on_board(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    col = await session.get(KanbanColumn, body.column_id)
    if not col or col.board_id != board_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid column for default board")

    resolved_system_id: uuid.UUID | None = body.system_id
    if await user_sees_all_tasks(session, user):
        if resolved_system_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=TASK_SYSTEM_REQUIRED)
    else:
        memberships = await _user_system_ids(session, user.id)
        if not memberships:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=TASK_NO_SYSTEM_MEMBERSHIP)
        if resolved_system_id is None:
            if len(memberships) == 1:
                resolved_system_id = memberships[0]
            else:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=TASK_PICK_SYSTEM)
        elif resolved_system_id not in memberships:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=TASK_SYSTEM_NOT_ALLOWED)

    sys = await session.get(System, resolved_system_id)
    if not sys or not sys.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNKNOWN_SYSTEM)

    assignees = await _resolve_assignee_users(session, body.assignee_ids, board=board)

    task = Task(
        title=body.title,
        description=body.description,
        board_id=board_id,
        column_id=body.column_id,
        system_id=resolved_system_id,
        creator_id=user.id,
        priority=body.priority,
        due_at=body.due_at,
        estimate_hours=body.estimate_hours,
        checklist=_normalize_checklist(body.checklist),
        position=body.position,
    )
    task.tags = await _resolve_tags(session, body.tag_ids)
    task.assignees = assignees
    session.add(task)
    await session.flush()
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=task.id,
        action="task.created",
        actor_user_id=user.id,
        details={
            "title": task.title,
            "board_id": str(task.board_id),
            "column_id": str(task.column_id),
            "column_name": col.name if col else None,
            "system_id": str(task.system_id),
            "assignees_count": len(task.assignees or []),
        },
    )
    await session.commit()

    t = (await session.execute(select(Task).where(Task.id == task.id).options(*_TASK_LOAD))).scalar_one()
    return await _task_to_out_with_counts(session, t)


@router.post(
    "/import-excel",
    response_model=TaskExcelImportBatchOut,
    summary="Импорт задачника Excel на основную доску (один или несколько файлов)",
)
async def import_tasks_excel(
    session: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(require_any_permission(USERS_MANAGE, ROLES_MANAGE))],
    files: Annotated[list[UploadFile], File(..., description="Один или несколько .xlsx задачника")],
    system_id: Annotated[uuid.UUID | None, Form()] = None,
    sheet_name: str | None = Form(None),
) -> TaskExcelImportBatchOut:
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Добавьте хотя бы один файл")

    payloads: list[tuple[str, bytes]] = []
    for f in files:
        fname = f.filename or "file.xlsx"
        if not fname.lower().endswith(".xlsx"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ожидается .xlsx: {fname}",
            )
        content = await f.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Файл больше 20 МБ: {fname}",
            )
        payloads.append((fname, content))

    if system_id is not None and len(payloads) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="При загрузке нескольких файлов систему указывать нельзя — она определяется по имени файла/листа",
        )

    batch = await import_tasks_from_excel_batch(
        session,
        files=payloads,
        creator_id=editor.id,
        system_id=system_id,
        sheet_name=sheet_name,
    )
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=None,
        action="task.import_excel.ran",
        actor_user_id=editor.id,
        details={
            "files_total": batch.files_total,
            "files_ok": batch.files_ok,
            "files_failed": batch.files_failed,
            "created_total": batch.created_total,
            "warnings_total": batch.warnings_total,
            "system_id": str(system_id) if system_id else None,
            "filenames": [x.filename for x in batch.files],
        },
    )
    await session.commit()
    return batch


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TaskOut:
    stmt = select(Task).where(Task.id == task_id).options(*_TASK_LOAD)
    task = (await session.execute(stmt)).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    board = await session.get(Board, task.board_id)
    requested_fields = body.model_fields_set
    move_only_fields = {"column_id", "position"}
    locked_allowed_fields = {"column_id", "position", "description"}
    is_move_only = bool(requested_fields) and requested_fields.issubset(move_only_fields)
    is_checklist_only = bool(requested_fields) and requested_fields.issubset({"checklist"})

    if board and is_global_board_locked(board) and not await can_bypass_board_editing_lock(session, user):
        if not requested_fields.issubset(locked_allowed_fields):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Доска заблокирована: можно менять только статус (колонку) и описание",
            )
        if requested_fields & move_only_fields and not await can_move_task(session, user, task):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
        if "description" in requested_fields and not await can_update_task_description_when_locked(session, user, task):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    elif is_move_only:
        if not await can_move_task(session, user, task):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    elif is_checklist_only:
        if not await can_comment_on_task(session, user, task):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    elif not await can_update_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    changed_fields = sorted(list(requested_fields))
    old_column_id = task.column_id
    old_system_id = task.system_id
    old_title = task.title
    old_column_name: str | None = None
    if task.column_id is not None:
        old_col = await session.get(KanbanColumn, task.column_id)
        old_column_name = old_col.name if old_col else None
    if body.title is not None:
        task.title = body.title
    if body.description is not None:
        task.description = body.description
    if body.column_id is not None:
        col = await session.get(KanbanColumn, body.column_id)
        if not col or col.board_id != task.board_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid column")
        task.column_id = body.column_id
    if body.system_id is not None:
        if not await user_sees_all_tasks(session, user):
            memberships = await _user_system_ids(session, user.id)
            if body.system_id not in memberships:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=TASK_SYSTEM_NOT_ALLOWED)
        sys = await session.get(System, body.system_id)
        if not sys or not sys.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNKNOWN_SYSTEM)
        task.system_id = body.system_id
    if body.assignee_ids is not None:
        board = await session.get(Board, task.board_id)
        existing_ids = {a.id for a in (task.assignees or [])}
        task.assignees = await _resolve_assignee_users(
            session,
            body.assignee_ids,
            board=board,
            allow_existing_ids=existing_ids,
        )
    if body.priority is not None:
        task.priority = body.priority
    if body.due_at is not None:
        task.due_at = body.due_at
    if "estimate_hours" in body.model_fields_set:
        task.estimate_hours = body.estimate_hours
    if body.checklist is not None:
        task.checklist = _normalize_checklist(body.checklist)
    if body.position is not None:
        task.position = body.position
    if "archived_at" in body.model_fields_set:
        task.archived_at = body.archived_at
    if body.tag_ids is not None:
        task.tags = await _resolve_tags(session, body.tag_ids)

    await session.flush()
    new_column_name: str | None = None
    if old_column_id != task.column_id and task.column_id is not None:
        new_col = await session.get(KanbanColumn, task.column_id)
        new_column_name = new_col.name if new_col else None
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=task.id,
        action="task.updated",
        actor_user_id=user.id,
        details={
            "title": task.title,
            "old_title": old_title if "title" in requested_fields and old_title != task.title else None,
            "changed_fields": changed_fields,
            "old_column_id": str(old_column_id) if old_column_id != task.column_id else None,
            "new_column_id": str(task.column_id) if old_column_id != task.column_id else None,
            "old_column_name": old_column_name if old_column_id != task.column_id else None,
            "new_column_name": new_column_name if old_column_id != task.column_id else None,
            "old_system_id": str(old_system_id) if old_system_id != task.system_id else None,
            "new_system_id": str(task.system_id) if old_system_id != task.system_id else None,
        },
    )
    t = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one()
    return await _task_to_out_with_counts(session, t)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    stmt = select(Task).where(Task.id == task_id).options(*_TASK_LOAD)
    task = (await session.execute(stmt)).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_delete_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=task.id,
        action="task.deleted",
        actor_user_id=user.id,
        details={"title": task.title},
    )
    await session.delete(task)


@router.get("/{task_id}/history", response_model=list[AuditEventOut])
async def get_task_history(
    task_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[AuditEventOut]:
    """История изменений задачи (аудит): смена колонки/статуса, поля, комментарии, вложения."""
    task = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_read_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    rows = await list_audit_events_for_entity(
        session, entity_type="task", entity_id=task_id, limit=limit
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


@router.get("/{task_id}/comments", response_model=list[TaskCommentOut])
async def list_task_comments(
    task_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[TaskCommentOut]:
    task = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_read_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    stmt = (
        select(TaskComment)
        .where(TaskComment.task_id == task_id)
        .order_by(TaskComment.created_at.asc())
        .options(selectinload(TaskComment.author))
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [_comment_to_out(c) for c in rows]


@router.post("/{task_id}/comments", response_model=TaskCommentOut, status_code=status.HTTP_201_CREATED)
async def create_task_comment(
    task_id: uuid.UUID,
    body: TaskCommentCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TaskCommentOut:
    task = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_comment_on_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    comment = TaskComment(task_id=task.id, author_id=user.id, body=body.body.strip())
    session.add(comment)
    await session.flush()
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=task.id,
        action="task.comment.created",
        actor_user_id=user.id,
        details={"comment_id": str(comment.id)},
    )

    await _notify_mentions(session, task, user, comment.body)

    await session.commit()
    created = (
        await session.execute(
            select(TaskComment).where(TaskComment.id == comment.id).options(selectinload(TaskComment.author))
        )
    ).scalar_one()
    return _comment_to_out(created)


@router.patch("/{task_id}/comments/{comment_id}", response_model=TaskCommentOut)
async def update_task_comment(
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: TaskCommentUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TaskCommentOut:
    task = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_comment_on_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    comment = (
        await session.execute(
            select(TaskComment)
            .where(TaskComment.id == comment_id)
            .where(TaskComment.task_id == task_id)
            .options(selectinload(TaskComment.author))
        )
    ).scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if not await _can_manage_comment(session, user, task, comment):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    comment.body = body.body.strip()
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=task.id,
        action="task.comment.updated",
        actor_user_id=user.id,
        details={"comment_id": str(comment.id)},
    )
    await _notify_mentions(session, task, user, comment.body)
    await session.commit()
    updated = (
        await session.execute(select(TaskComment).where(TaskComment.id == comment_id).options(selectinload(TaskComment.author)))
    ).scalar_one()
    return _comment_to_out(updated)


@router.delete("/{task_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_comment(
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    task = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_comment_on_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    comment = (
        await session.execute(
            select(TaskComment)
            .where(TaskComment.id == comment_id)
            .where(TaskComment.task_id == task_id)
        )
    ).scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if not await _can_manage_comment(session, user, task, comment):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=task.id,
        action="task.comment.deleted",
        actor_user_id=user.id,
        details={"comment_id": str(comment.id)},
    )
    await session.delete(comment)
    await session.commit()


@router.post("/{task_id}/attachments", response_model=TaskAttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_task_attachment(
    task_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    file: Annotated[UploadFile, File()],
) -> TaskAttachmentOut:
    task = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_update_task(session, user, task) and not await can_comment_on_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    ct = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if ct not in _ALLOWED_ATTACHMENT_CT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(raw) > _MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large (max 20MB)")

    filename = (file.filename or "file").strip()[:512] or "file"
    url = save_task_file(raw, ct, filename)
    att = TaskAttachment(
        task_id=task.id,
        filename=filename,
        content_type=ct,
        size_bytes=len(raw),
        url=url,
        uploaded_by_id=user.id,
    )
    session.add(att)
    await session.flush()
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=task.id,
        action="task.attachment.uploaded",
        actor_user_id=user.id,
        details={"attachment_id": str(att.id), "filename": filename},
    )
    await session.commit()
    loaded = (
        await session.execute(
            select(TaskAttachment)
            .where(TaskAttachment.id == att.id)
            .options(selectinload(TaskAttachment.uploaded_by))
        )
    ).scalar_one()
    return _attachment_to_out(loaded)


@router.delete("/{task_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_attachment(
    task_id: uuid.UUID,
    attachment_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    task = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_update_task(session, user, task) and not await can_delete_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    att = (
        await session.execute(
            select(TaskAttachment)
            .where(TaskAttachment.id == attachment_id)
            .where(TaskAttachment.task_id == task_id)
        )
    ).scalar_one_or_none()
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    await record_audit_event(
        session,
        entity_type="task",
        entity_id=task.id,
        action="task.attachment.deleted",
        actor_user_id=user.id,
        details={"attachment_id": str(att.id), "filename": att.filename},
    )
    await session.delete(att)
    await session.commit()
