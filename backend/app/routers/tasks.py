import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import false, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.http_errors import (
    FORBIDDEN,
    TASK_NO_SYSTEM_MEMBERSHIP,
    TASK_PICK_SYSTEM,
    TASK_SYSTEM_NOT_ALLOWED,
    TASK_SYSTEM_REQUIRED,
    UNKNOWN_SYSTEM,
)
from app.deps import get_current_user, require_permission
from app.models import Board, KanbanColumn, System, Task, User, UserSystem
from app.permissions import TASKS_CREATE, TASKS_READ_ASSIGNED
from app.schemas.task import ColumnMini, SystemMini, TaskCreate, TaskOut, TaskUpdate, UserMini
from app.services.authz import user_has_permission, user_sees_all_tasks
from app.services.task_policy import can_delete_task, can_read_task, can_update_task

router = APIRouter(prefix="/tasks", tags=["tasks"])


async def _user_system_ids(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    r = await session.execute(select(UserSystem.system_id).where(UserSystem.user_id == user_id))
    return list(r.scalars().all())

_TASK_LOAD = (
    selectinload(Task.assignee),
    selectinload(Task.creator),
    selectinload(Task.system),
    selectinload(Task.column),
)


def _task_to_out(task: Task) -> TaskOut:
    return TaskOut(
        id=task.id,
        title=task.title,
        description=task.description,
        board_id=task.board_id,
        column_id=task.column_id,
        system_id=task.system_id,
        assignee_id=task.assignee_id,
        creator_id=task.creator_id,
        priority=task.priority,
        due_at=task.due_at,
        position=task.position,
        created_at=task.created_at,
        updated_at=task.updated_at,
        archived_at=task.archived_at,
        assignee=UserMini.model_validate(task.assignee) if task.assignee else None,
        creator=UserMini.model_validate(task.creator) if task.creator else None,
        system=SystemMini.model_validate(task.system) if task.system else None,
        column=ColumnMini.model_validate(task.column) if task.column else None,
    )


async def _apply_task_list_scope(session: AsyncSession, user: User, stmt):
    if await user_sees_all_tasks(session, user):
        return stmt
    system_ids = await _user_system_ids(session, user.id)
    if system_ids:
        return stmt.where(Task.system_id.in_(system_ids))
    if await user_has_permission(session, user, TASKS_READ_ASSIGNED):
        return stmt.where(Task.assignee_id == user.id)
    return stmt.where(false())


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    system_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
    column_id: uuid.UUID | None = None,
    include_archived: bool = False,
) -> list[TaskOut]:
    stmt = select(Task).options(*_TASK_LOAD).order_by(Task.position, Task.created_at)
    stmt = await _apply_task_list_scope(session, user, stmt)
    if not include_archived:
        stmt = stmt.where(Task.archived_at.is_(None))
    if system_id:
        stmt = stmt.where(Task.system_id == system_id)
    if assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if column_id:
        stmt = stmt.where(Task.column_id == column_id)

    result = await session.execute(stmt)
    tasks = result.scalars().unique().all()
    out: list[TaskOut] = []
    for t in tasks:
        if await can_read_task(session, user, t):
            out.append(_task_to_out(t))
    return out


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
    return _task_to_out(task)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(TASKS_CREATE))],
) -> TaskOut:
    board_id = await session.scalar(select(Board.id).where(Board.is_default.is_(True)))
    if not board_id:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Default board missing")

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

    if body.assignee_id:
        assignee = await session.get(User, body.assignee_id)
        if not assignee or not assignee.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignee")

    task = Task(
        title=body.title,
        description=body.description,
        board_id=board_id,
        column_id=body.column_id,
        system_id=resolved_system_id,
        assignee_id=body.assignee_id,
        creator_id=user.id,
        priority=body.priority,
        due_at=body.due_at,
        position=body.position,
    )
    session.add(task)
    await session.flush()
    await session.commit()

    t = (await session.execute(select(Task).where(Task.id == task.id).options(*_TASK_LOAD))).scalar_one()
    return _task_to_out(t)


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
    if not await can_update_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

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
    if body.assignee_id is not None:
        if body.assignee_id:
            assignee = await session.get(User, body.assignee_id)
            if not assignee or not assignee.is_active:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignee")
        task.assignee_id = body.assignee_id
    if body.priority is not None:
        task.priority = body.priority
    if body.due_at is not None:
        task.due_at = body.due_at
    if body.position is not None:
        task.position = body.position
    if body.archived_at is not None:
        task.archived_at = body.archived_at

    await session.flush()
    t = (await session.execute(select(Task).where(Task.id == task_id).options(*_TASK_LOAD))).scalar_one()
    return _task_to_out(t)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    stmt = select(Task).where(Task.id == task_id)
    task = (await session.execute(stmt)).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not await can_delete_task(session, user, task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    await session.delete(task)
