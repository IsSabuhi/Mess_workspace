"""Проверки узких прав админки и запрет назначения ролей выше своих."""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.http_errors import LAST_SUPERUSER_REQUIRED, SUPERUSER_TARGET_FORBIDDEN
from app.models import Role, User
from app.models.role import RolePermission
from app.permissions import (
    ADMIN_SECTION_CODES,
    PRIVILEGED_ASSIGN_CODES,
    USERS_CREATE,
    USERS_DELETE,
    USERS_MANAGE,
    USERS_PASSWORD_RESET,
    USERS_STAFF_CODES,
)
from app.services.authz import get_user_permission_codes, user_has_permission


async def user_can_staff_users(session: AsyncSession, user: User) -> bool:
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes(session, user)
    return any(c in codes for c in USERS_STAFF_CODES)


async def user_has_admin_access(session: AsyncSession, user: User) -> bool:
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes(session, user)
    return any(c in codes for c in ADMIN_SECTION_CODES)


async def user_can_create_users(session: AsyncSession, user: User) -> bool:
    if await user_has_permission(session, user, USERS_MANAGE):
        return True
    return await user_has_permission(session, user, USERS_CREATE)


async def user_can_reset_password(session: AsyncSession, user: User) -> bool:
    if await user_has_permission(session, user, USERS_MANAGE):
        return True
    return await user_has_permission(session, user, USERS_PASSWORD_RESET)


async def user_can_delete_users(session: AsyncSession, user: User) -> bool:
    if await user_has_permission(session, user, USERS_MANAGE):
        return True
    return await user_has_permission(session, user, USERS_DELETE)


async def user_can_update_users(session: AsyncSession, user: User) -> bool:
    return await user_has_permission(session, user, USERS_MANAGE)


async def actor_effective_codes(session: AsyncSession, user: User) -> set[str]:
    """Права актора с учётом того, что users.manage включает узкие права по пользователям."""
    have = await get_user_permission_codes(session, user)
    if USERS_MANAGE in have:
        have = have | {USERS_CREATE, USERS_PASSWORD_RESET, USERS_DELETE}
    return have


async def actor_privileged_codes(session: AsyncSession, user: User) -> set[str]:
    if user.is_superuser:
        return set(PRIVILEGED_ASSIGN_CODES)
    return await actor_effective_codes(session, user) & set(PRIVILEGED_ASSIGN_CODES)


def assert_can_modify_user_account(actor: User, target: User) -> None:
    """Правки чужой учётки суперпользователя.

    Без этой проверки сотрудник с users.password.reset мог сбросить пароль суперпользователю
    и войти под ним, а с users.manage — сменить ему email или отключить учётку.
    """
    if target.is_superuser and not actor.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=SUPERUSER_TARGET_FORBIDDEN
        )


async def assert_not_last_active_superuser(session: AsyncSession, target: User) -> None:
    """Нельзя оставить систему без активного суперпользователя (отключение или снятие флага)."""
    if not target.is_superuser:
        return
    others = await session.scalar(
        select(func.count())
        .select_from(User)
        .where(
            User.is_superuser.is_(True),
            User.is_active.is_(True),
            User.id != target.id,
        )
    )
    if not others:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=LAST_SUPERUSER_REQUIRED
        )


async def assert_can_assign_roles(
    session: AsyncSession,
    actor: User,
    role_ids: list[uuid.UUID] | None,
) -> None:
    """Нельзя выдать роль с админ-правами, которых нет у текущего пользователя."""
    if not role_ids:
        return
    if actor.is_superuser:
        return
    actor_priv = await actor_privileged_codes(session, actor)
    roles = (
        await session.execute(
            select(Role)
            .where(Role.id.in_(role_ids))
            .options(selectinload(Role.permissions).selectinload(RolePermission.permission))
        )
    ).scalars().unique().all()
    if len(roles) != len(set(role_ids)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Указана неизвестная роль")
    for role in roles:
        if role.slug == "super_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Роль «Администратор» может назначать только суперпользователь",
            )
        role_priv = {
            rp.permission.code
            for rp in role.permissions
            if rp.permission and rp.permission.code in PRIVILEGED_ASSIGN_CODES
        }
        extra = role_priv - actor_priv
        if extra:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Нельзя назначить роль «{role.name}»: в ней есть права админки, которых нет у вас "
                    f"({', '.join(sorted(extra)[:6])})"
                ),
            )


def assert_can_set_superuser(actor: User, want: bool | None, current_value: bool = False) -> None:
    """Менять флаг суперпользователя может только суперпользователь.

    Форма админки присылает поле всегда, поэтому неизменившееся значение пропускаем:
    иначе обычный админ не смог бы сохранить карточку рядового сотрудника.
    """
    if want is None or bool(want) == bool(current_value):
        return
    if not actor.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Флаг суперпользователя может менять только суперпользователь",
        )


async def assert_can_grant_permission_codes(
    session: AsyncSession,
    actor: User,
    new_codes: set[str],
    old_codes: set[str] | None = None,
) -> None:
    """Нельзя включать/выключать в роли право, которого нет у самого актора.

    Проверяются любые права, а не только админские: иначе обладатель roles.manage
    правит роль, которую сам носит, и выдаёт себе tasks.delete, systems.manage и прочее.
    Неизменившиеся права роли не трогаем — админ может переименовать роль, в которой
    есть права шире его собственных.
    """
    if actor.is_superuser:
        return
    actor_codes = await actor_effective_codes(session, actor)
    previous = old_codes or set()
    added = new_codes - previous
    removed = previous - new_codes
    extra = (added | removed) - actor_codes
    if extra:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Нельзя менять права, которых нет у вас "
                f"({', '.join(sorted(extra)[:6])})"
            ),
        )
