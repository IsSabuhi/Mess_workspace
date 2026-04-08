import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Permission, Role, User, UserRole
from app.models.role import RolePermission
from app.models.user_system import UserSystem
from app.permissions import TASKS_READ_ALL, TASKS_UPDATE_ALL

USER_LOAD_OPTIONS = (
    selectinload(User.roles).selectinload(UserRole.role),
    selectinload(User.position),
    selectinload(User.system_memberships).selectinload(UserSystem.system),
)


async def get_user_permission_codes(session: AsyncSession, user: User) -> set[str]:
    if user.is_superuser:
        return set()

    stmt = (
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user.id)
    )
    result = await session.execute(stmt)
    return {row[0] for row in result.all()}


async def user_has_permission(session: AsyncSession, user: User, code: str) -> bool:
    if user.is_superuser:
        return True
    if not user.is_active:
        return False
    codes = await get_user_permission_codes(session, user)
    return code in codes


async def user_sees_all_tasks(session: AsyncSession, user: User) -> bool:
    """Задачи по всем производственным системам (руководитель / полный доступ к задачам)."""
    if user.is_superuser:
        return True
    if await user_has_permission(session, user, TASKS_READ_ALL):
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ALL):
        return True
    return False


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    stmt = select(User).where(User.email == email).options(*USER_LOAD_OPTIONS)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_user_by_id(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    stmt = select(User).where(User.id == user_id).options(*USER_LOAD_OPTIONS)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
