import uuid

from sqlalchemy import func, select
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

_PERM_CODES_CACHE = "_perm_codes_by_user"
_SYSTEM_IDS_CACHE = "_user_system_ids"


async def user_system_id_set(session: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Производственные системы пользователя (кэш на сессию запроса)."""
    cache: dict = session.info.setdefault(_SYSTEM_IDS_CACHE, {})
    cached = cache.get(user_id)
    if cached is not None:
        return cached
    r = await session.execute(select(UserSystem.system_id).where(UserSystem.user_id == user_id))
    ids = set(r.scalars().all())
    cache[user_id] = ids
    return ids


async def get_user_permission_codes(session: AsyncSession, user: User) -> set[str]:
    if user.is_superuser:
        return set()

    cache: dict = session.info.setdefault(_PERM_CODES_CACHE, {})
    cached = cache.get(user.id)
    if cached is not None:
        return cached

    stmt = (
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user.id)
    )
    result = await session.execute(stmt)
    codes = {row[0] for row in result.all()}
    cache[user.id] = codes
    return codes


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
    codes = await get_user_permission_codes(session, user)
    return TASKS_READ_ALL in codes or TASKS_UPDATE_ALL in codes


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    """Ищем пользователя по email без учёта регистра.

    Менеджеры паролей часто подставляют BabichDD@nornik.ru при том, что в БД
    лежит babichdd@nornik.ru — точное сравнение тогда врёт «неверный пароль».
    Если ввели учётную запись без домена, ищем по локальной части email.
    """
    raw = (email or "").strip()
    if not raw:
        return None
    if "@" in raw:
        stmt = select(User).where(func.lower(User.email) == raw.lower())
    else:
        stmt = select(User).where(func.lower(func.split_part(User.email, "@", 1)) == raw.lower())
    stmt = stmt.options(*USER_LOAD_OPTIONS)
    rows = (await session.execute(stmt)).scalars().unique().all()
    if len(rows) == 1:
        return rows[0]
    return None


async def get_user_by_id(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    stmt = select(User).where(User.id == user_id).options(*USER_LOAD_OPTIONS)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
