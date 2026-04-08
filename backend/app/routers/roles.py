import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.http_errors import PERMISSION_DENIED
from app.deps import get_current_user, require_permission
from app.models import Permission, Role, RolePermission, User, UserRole
from app.permissions import ROLES_MANAGE, USERS_MANAGE
from app.schemas.role import PermissionOut, RoleCreate, RoleOut, RoleUpdate
from app.services.authz import user_has_permission

router = APIRouter(prefix="/roles", tags=["roles"])


def _role_to_out(role: Role, user_count: int = 0) -> RoleOut:
    perms = []
    for rp in role.permissions:
        if rp.permission:
            perms.append(PermissionOut.model_validate(rp.permission))
    return RoleOut(
        id=role.id,
        name=role.name,
        slug=role.slug,
        description=role.description,
        is_system=role.is_system,
        user_count=user_count,
        permissions=perms,
    )


async def _user_counts_by_role(session: AsyncSession) -> dict[uuid.UUID, int]:
    stmt = select(UserRole.role_id, func.count().label("c")).group_by(UserRole.role_id)
    rows = (await session.execute(stmt)).all()
    return {rid: int(n) for rid, n in rows}


@router.get("/permissions", response_model=list[PermissionOut])
async def list_permissions_catalog(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[PermissionOut]:
    stmt = select(Permission).order_by(Permission.code)
    result = await session.execute(stmt)
    return [PermissionOut.model_validate(p) for p in result.scalars().all()]


@router.get("", response_model=list[RoleOut])
async def list_roles(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[RoleOut]:
    if not (
        user.is_superuser
        or await user_has_permission(session, user, ROLES_MANAGE)
        or await user_has_permission(session, user, USERS_MANAGE)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PERMISSION_DENIED)
    stmt = (
        select(Role)
        .options(selectinload(Role.permissions).selectinload(RolePermission.permission))
        .order_by(Role.name)
    )
    result = await session.execute(stmt)
    roles = result.scalars().unique().all()
    counts = await _user_counts_by_role(session)
    return [_role_to_out(r, counts.get(r.id, 0)) for r in roles]


@router.post("", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(ROLES_MANAGE))],
) -> RoleOut:
    existing = await session.scalar(select(Role.id).where(Role.slug == body.slug))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")

    role = Role(name=body.name, slug=body.slug, description=body.description, is_system=False)
    session.add(role)
    await session.flush()

    if body.permission_ids:
        perms = (await session.execute(select(Permission).where(Permission.id.in_(body.permission_ids)))).scalars().all()
        if len(perms) != len(set(body.permission_ids)):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown permission id")
        for p in perms:
            session.add(RolePermission(role_id=role.id, permission_id=p.id))

    await session.flush()
    stmt = (
        select(Role)
        .where(Role.id == role.id)
        .options(selectinload(Role.permissions).selectinload(RolePermission.permission))
    )
    r = (await session.execute(stmt)).scalar_one()
    return _role_to_out(r, 0)


@router.patch("/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: uuid.UUID,
    body: RoleUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(ROLES_MANAGE))],
) -> RoleOut:
    stmt = (
        select(Role)
        .where(Role.id == role_id)
        .options(selectinload(Role.permissions).selectinload(RolePermission.permission))
    )
    role = (await session.execute(stmt)).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    if role.is_system and not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Системную роль может изменять только суперпользователь",
        )

    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description

    if body.permission_ids is not None:
        await session.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
        if body.permission_ids:
            perms = (
                await session.execute(select(Permission).where(Permission.id.in_(body.permission_ids)))
            ).scalars().all()
            if len(perms) != len(set(body.permission_ids)):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown permission id")
            for p in perms:
                session.add(RolePermission(role_id=role.id, permission_id=p.id))

    await session.flush()
    stmt = (
        select(Role)
        .where(Role.id == role_id)
        .options(selectinload(Role.permissions).selectinload(RolePermission.permission))
    )
    r = (await session.execute(stmt)).scalar_one()
    cnt = await session.scalar(select(func.count()).select_from(UserRole).where(UserRole.role_id == r.id))
    return _role_to_out(r, int(cnt or 0))


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(ROLES_MANAGE))],
) -> None:
    role = await session.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    if role.is_system:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Системную роль удалить нельзя",
        )
    await session.delete(role)
    await session.flush()
