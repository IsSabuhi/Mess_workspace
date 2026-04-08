import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.http_errors import (
    EMAIL_ALREADY_REGISTERED,
    INVALID_POSITION,
    UNKNOWN_ROLE,
    UNKNOWN_SYSTEM,
    USER_NOT_FOUND,
    USER_VIEW_FORBIDDEN,
)
from app.models import Position, Role, System, User, UserRole
from app.models.user_system import UserSystem
from app.permissions import USERS_MANAGE
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.security import hash_password
from app.services.authz import (
    USER_LOAD_OPTIONS,
    get_user_by_id,
    user_has_permission,
    user_sees_all_tasks,
)
from app.services.users_display import user_to_out

router = APIRouter(prefix="/users", tags=["users"])


async def _system_ids_for_user(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    r = await session.execute(select(UserSystem.system_id).where(UserSystem.user_id == user_id))
    return list(r.scalars().all())


@router.get("/assignee-candidates", response_model=list[UserOut])
async def list_assignee_candidates(
    session: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> list[UserOut]:
    """Кандидаты в исполнители: все сотрудники для руководителя; участники тех же производственных систем — для остальных."""
    if not current.is_active:
        return []

    if await user_sees_all_tasks(session, current):
        stmt = select(User).where(User.is_active.is_(True)).options(*USER_LOAD_OPTIONS).order_by(User.email)
        result = await session.execute(stmt)
        rows = result.scalars().unique().all()
        return [user_to_out(u) for u in rows]

    system_ids = await _system_ids_for_user(session, current.id)
    if not system_ids:
        return []

    peer_subq = select(UserSystem.user_id).where(UserSystem.system_id.in_(system_ids)).distinct()
    stmt = (
        select(User)
        .where(User.id.in_(peer_subq), User.is_active.is_(True))
        .options(*USER_LOAD_OPTIONS)
        .order_by(User.email)
    )
    result = await session.execute(stmt)
    rows = result.scalars().unique().all()
    return [user_to_out(u) for u in rows]


@router.get("", response_model=list[UserOut])
async def list_users(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(USERS_MANAGE))],
) -> list[UserOut]:
    stmt = select(User).options(*USER_LOAD_OPTIONS).order_by(User.email)
    result = await session.execute(stmt)
    users = result.scalars().unique().all()
    return [user_to_out(u) for u in users]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(USERS_MANAGE))],
) -> UserOut:
    existing = await session.scalar(select(User.id).where(User.email == body.email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=EMAIL_ALREADY_REGISTERED)

    if body.position_id:
        pos = await session.get(Position, body.position_id)
        if not pos:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_POSITION)

    user = User(
        email=body.email,
        full_name=body.full_name,
        position_id=body.position_id,
        birth_date=body.birth_date,
        hashed_password=hash_password(body.password),
        is_superuser=body.is_superuser,
        is_active=True,
    )
    session.add(user)
    await session.flush()

    if body.role_ids:
        roles = (await session.execute(select(Role).where(Role.id.in_(body.role_ids)))).scalars().all()
        if len(roles) != len(set(body.role_ids)):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNKNOWN_ROLE)
        for r in roles:
            session.add(UserRole(user_id=user.id, role_id=r.id))

    if body.system_ids:
        for sid in set(body.system_ids):
            sys_row = await session.get(System, sid)
            if not sys_row:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNKNOWN_SYSTEM)
            session.add(UserSystem(user_id=user.id, system_id=sid))

    await session.flush()
    u = await get_user_by_id(session, user.id)
    assert u
    await session.commit()
    return user_to_out(u)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> UserOut:
    if current.id != user_id and not (await _can_manage_users(session, current)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=USER_VIEW_FORBIDDEN)
    u = await get_user_by_id(session, user_id)
    if not u:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=USER_NOT_FOUND)
    return user_to_out(u)


async def _can_manage_users(session: AsyncSession, user: User) -> bool:
    return user.is_superuser or await user_has_permission(session, user, USERS_MANAGE)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(USERS_MANAGE))],
) -> UserOut:
    u = await get_user_by_id(session, user_id)
    if not u:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=USER_NOT_FOUND)

    if body.email is not None:
        u.email = body.email
    if body.full_name is not None:
        u.full_name = body.full_name
    if body.password is not None:
        u.hashed_password = hash_password(body.password)
    if body.is_active is not None:
        u.is_active = body.is_active
    if body.is_superuser is not None:
        u.is_superuser = body.is_superuser

    patch = body.model_dump(exclude_unset=True)
    if "birth_date" in patch:
        u.birth_date = patch["birth_date"]
    if "position_id" in patch:
        pid = patch["position_id"]
        if pid is not None:
            pos = await session.get(Position, pid)
            if not pos:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_POSITION)
        u.position_id = pid

    if body.role_ids is not None:
        await session.execute(delete(UserRole).where(UserRole.user_id == user_id))
        if body.role_ids:
            roles = (await session.execute(select(Role).where(Role.id.in_(body.role_ids)))).scalars().all()
            if len(roles) != len(set(body.role_ids)):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNKNOWN_ROLE)
            for r in roles:
                session.add(UserRole(user_id=u.id, role_id=r.id))

    if body.system_ids is not None:
        await session.execute(delete(UserSystem).where(UserSystem.user_id == user_id))
        for sid in set(body.system_ids):
            sys_row = await session.get(System, sid)
            if not sys_row:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNKNOWN_SYSTEM)
            session.add(UserSystem(user_id=u.id, system_id=sid))

    await session.flush()
    u2 = await get_user_by_id(session, user_id)
    assert u2
    await session.commit()
    return user_to_out(u2)
