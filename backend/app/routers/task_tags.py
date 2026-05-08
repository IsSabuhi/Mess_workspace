import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import Board, BoardMember, TaskTag, User
from app.models.board import BOARD_MEMBER_ROLE_EDITOR, BOARD_MEMBER_ROLE_MANAGER, BOARD_SCOPE_SYSTEM
from app.permissions import TASKS_CREATE
from app.services.authz import user_has_permission
from app.schemas.task_tag import TaskTagCreate, TaskTagOut, TaskTagUpdate

router = APIRouter(prefix="/task-tags", tags=["task-tags"])


async def _can_manage_tags(session: AsyncSession, user: User) -> bool:
    if user.is_superuser:
        return True
    if await user_has_permission(session, user, TASKS_CREATE):
        return True
    role = await session.scalar(
        select(BoardMember.role)
        .join(Board, Board.id == BoardMember.board_id)
        .where(
            BoardMember.user_id == user.id,
            Board.scope == BOARD_SCOPE_SYSTEM,
            Board.is_archived.is_(False),
            BoardMember.role.in_([BOARD_MEMBER_ROLE_EDITOR, BOARD_MEMBER_ROLE_MANAGER]),
        )
        .limit(1)
    )
    return role is not None


@router.get("", response_model=list[TaskTagOut])
async def list_task_tags(
    session: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> list[TaskTagOut]:
    tags = (await session.execute(select(TaskTag).order_by(TaskTag.sort_order, TaskTag.name))).scalars().all()
    return [TaskTagOut.model_validate(t) for t in tags]


@router.post("", response_model=TaskTagOut, status_code=status.HTTP_201_CREATED)
async def create_task_tag(
    body: TaskTagCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TaskTagOut:
    if not await _can_manage_tags(session, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    exists = await session.scalar(select(TaskTag.id).where(TaskTag.name == body.name.strip()))
    if exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag already exists")
    tag = TaskTag(name=body.name.strip(), color=body.color, sort_order=body.sort_order)
    session.add(tag)
    await session.flush()
    return TaskTagOut.model_validate(tag)


@router.patch("/{tag_id}", response_model=TaskTagOut)
async def update_task_tag(
    tag_id: uuid.UUID,
    body: TaskTagUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TaskTagOut:
    if not await _can_manage_tags(session, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    tag = await session.get(TaskTag, tag_id)
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if body.name is not None:
        name = body.name.strip()
        exists = await session.scalar(select(TaskTag.id).where(TaskTag.name == name, TaskTag.id != tag_id))
        if exists:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag already exists")
        tag.name = name
    if body.color is not None:
        tag.color = body.color
    if body.sort_order is not None:
        tag.sort_order = body.sort_order
    await session.flush()
    return TaskTagOut.model_validate(tag)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_tag(
    tag_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    if not await _can_manage_tags(session, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    tag = await session.get(TaskTag, tag_id)
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    await session.delete(tag)
