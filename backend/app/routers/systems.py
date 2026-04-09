import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.models import System, Task, User, UserSystem
from app.permissions import SYSTEMS_MANAGE
from app.schemas.position import PositionBrief
from app.schemas.system import SystemCreate, SystemMemberOut, SystemOut, SystemUpdate

router = APIRouter(prefix="/systems", tags=["systems"])


async def _user_counts_by_system(session: AsyncSession) -> dict[uuid.UUID, int]:
    rows = await session.execute(
        select(UserSystem.system_id, func.count(UserSystem.user_id))
        .join(User, User.id == UserSystem.user_id)
        .where(User.is_active.is_(True))
        .group_by(UserSystem.system_id)
    )
    return {sid: int(cnt) for sid, cnt in rows.all()}


def _system_to_out(system: System, user_count: int = 0) -> SystemOut:
    data = SystemOut.model_validate(system).model_dump()
    data["user_count"] = user_count
    return SystemOut(**data)


@router.get("/{system_id}/members", response_model=list[SystemMemberOut])
async def list_system_members(
    system_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[SystemMemberOut]:
    sys_row = await session.get(System, system_id)
    if not sys_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")

    stmt = (
        select(User)
        .join(UserSystem, UserSystem.user_id == User.id)
        .where(UserSystem.system_id == system_id, User.is_active.is_(True))
        .options(selectinload(User.position))
        .order_by(User.full_name, User.email)
    )
    rows = (await session.execute(stmt)).scalars().unique().all()
    return [
        SystemMemberOut(
            id=u.id,
            full_name=u.full_name,
            email=u.email,
            position=PositionBrief.model_validate(u.position) if u.position else None,
        )
        for u in rows
    ]


@router.get("", response_model=list[SystemOut])
async def list_systems(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    active_only: bool = True,
) -> list[SystemOut]:
    counts = await _user_counts_by_system(session)
    stmt = select(System).order_by(System.sort_order, System.name)
    if active_only:
        stmt = stmt.where(System.is_active.is_(True))
    result = await session.execute(stmt)
    return [_system_to_out(s, counts.get(s.id, 0)) for s in result.scalars().all()]


@router.post("", response_model=SystemOut, status_code=status.HTTP_201_CREATED)
async def create_system(
    body: SystemCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(SYSTEMS_MANAGE))],
) -> SystemOut:
    existing = await session.scalar(select(System.id).where(System.slug == body.slug))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")
    s = System(
        name=body.name,
        slug=body.slug,
        description=body.description,
        sort_order=body.sort_order,
        is_active=True,
    )
    session.add(s)
    await session.flush()
    return _system_to_out(s, 0)


@router.patch("/{system_id}", response_model=SystemOut)
async def update_system(
    system_id: uuid.UUID,
    body: SystemUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(SYSTEMS_MANAGE))],
) -> SystemOut:
    s = await session.get(System, system_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    if body.name is not None:
        s.name = body.name
    if body.slug is not None:
        clash = await session.scalar(select(System.id).where(System.slug == body.slug, System.id != system_id))
        if clash:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")
        s.slug = body.slug
    if body.description is not None:
        s.description = body.description
    if body.sort_order is not None:
        s.sort_order = body.sort_order
    if body.is_active is not None:
        s.is_active = body.is_active
    await session.flush()
    counts = await _user_counts_by_system(session)
    return _system_to_out(s, counts.get(s.id, 0))


@router.delete("/{system_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system(
    system_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(SYSTEMS_MANAGE))],
) -> None:
    s = await session.get(System, system_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System not found")
    n_tasks = await session.scalar(
        select(func.count()).select_from(Task).where(Task.system_id == system_id)
    )
    if n_tasks and n_tasks > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя удалить систему: есть связанные задачи. Перенесите или удалите задачи.",
        )
    await session.delete(s)
    await session.flush()
