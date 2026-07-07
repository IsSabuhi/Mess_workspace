"""Блокировка редактирования глобальной (основной) доски."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Board, User
from app.models.board import BOARD_SCOPE_GLOBAL
from app.permissions import BOARD_COLUMNS_MANAGE, TASKS_UPDATE_ALL, USERS_MANAGE
from app.services.authz import user_has_permission


def is_global_board_locked(board: Board | None) -> bool:
    return bool(board and board.scope == BOARD_SCOPE_GLOBAL and board.is_editing_locked)


async def can_bypass_board_editing_lock(session: AsyncSession, user: User) -> bool:
    """Кто может редактировать и снимать блокировку: админ / руководитель."""
    if user.is_superuser:
        return True
    if await user_has_permission(session, user, USERS_MANAGE):
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ALL):
        return True
    if await user_has_permission(session, user, BOARD_COLUMNS_MANAGE):
        return True
    return False


async def can_manage_board_editing_lock(session: AsyncSession, user: User) -> bool:
    return await can_bypass_board_editing_lock(session, user)
