from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Board, Task, User, UserSystem
from app.models.board import (
    BOARD_MEMBER_ROLE_EDITOR,
    BOARD_MEMBER_ROLE_MANAGER,
    BOARD_SCOPE_SYSTEM,
)
from app.permissions import (
    TASKS_CREATE,
    TASKS_DELETE,
    TASKS_MOVE,
    TASKS_READ_ASSIGNED,
    TASKS_UPDATE_ALL,
    TASKS_UPDATE_ASSIGNED,
)
from app.services.authz import user_has_permission, user_sees_all_tasks
from app.services.board_lock import can_bypass_board_editing_lock, is_global_board_locked
from app.services.board_members import effective_board_member_role


async def _user_system_id_set(session: AsyncSession, user_id) -> set:
    r = await session.execute(select(UserSystem.system_id).where(UserSystem.user_id == user_id))
    return set(r.scalars().all())


def _user_in_task_assignees(task: Task, user_id) -> bool:
    return any(a.id == user_id for a in (task.assignees or []))


async def _board_for_task(session: AsyncSession, task: Task) -> Board | None:
    # Avoid touching task.board relationship directly here:
    # in async mode it can trigger lazy-load outside greenlet context.
    return await session.get(Board, task.board_id)


async def _board_member_role(session: AsyncSession, board: Board, user_id) -> str | None:
    return await effective_board_member_role(session, board, user_id)


async def can_read_task(session: AsyncSession, user: User, task: Task) -> bool:
    board = await _board_for_task(session, task)
    if board and board.scope == BOARD_SCOPE_SYSTEM:
        if user.is_superuser:
            return True
        role = await _board_member_role(session, board, user.id)
        return role is not None

    if await user_sees_all_tasks(session, user):
        return True
    if task.system_id in await _user_system_id_set(session, user.id):
        return True
    if await user_has_permission(session, user, TASKS_READ_ASSIGNED):
        if _user_in_task_assignees(task, user.id):
            return True
    return False


async def _has_task_edit_permission(session: AsyncSession, user: User, task: Task) -> bool:
    board = await _board_for_task(session, task)
    if board and board.scope == BOARD_SCOPE_SYSTEM:
        if user.is_superuser:
            return True
        role = await _board_member_role(session, board, user.id)
        return role in {BOARD_MEMBER_ROLE_EDITOR, BOARD_MEMBER_ROLE_MANAGER}

    if user.is_superuser:
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ALL):
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ASSIGNED):
        if _user_in_task_assignees(task, user.id):
            return True
        if task.system_id in await _user_system_id_set(session, user.id):
            return True
    return False


async def can_update_task(session: AsyncSession, user: User, task: Task) -> bool:
    if not await _has_task_edit_permission(session, user, task):
        return False
    board = await _board_for_task(session, task)
    if board and is_global_board_locked(board):
        return await can_bypass_board_editing_lock(session, user)
    return True


async def can_update_task_description_when_locked(session: AsyncSession, user: User, task: Task) -> bool:
    return await _has_task_edit_permission(session, user, task)


async def can_delete_task(session: AsyncSession, user: User, task: Task) -> bool:
    board = await _board_for_task(session, task)
    if board and is_global_board_locked(board):
        if not await can_bypass_board_editing_lock(session, user):
            return False

    if board and board.scope == BOARD_SCOPE_SYSTEM:
        if user.is_superuser:
            return True
        role = await _board_member_role(session, board, user.id)
        return role == BOARD_MEMBER_ROLE_MANAGER

    if user.is_superuser:
        return True
    return await user_has_permission(session, user, TASKS_DELETE)


async def can_comment_on_task(session: AsyncSession, user: User, task: Task) -> bool:
    return await can_read_task(session, user, task)


async def can_create_task_on_board(session: AsyncSession, user: User, board: Board) -> bool:
    if board.is_archived:
        return False
    if is_global_board_locked(board):
        if not await can_bypass_board_editing_lock(session, user):
            return False
    if board.scope == BOARD_SCOPE_SYSTEM:
        if user.is_superuser:
            return True
        role = await _board_member_role(session, board, user.id)
        return role in {BOARD_MEMBER_ROLE_EDITOR, BOARD_MEMBER_ROLE_MANAGER}
    if user.is_superuser:
        return True
    return await user_has_permission(session, user, TASKS_CREATE)


async def can_move_task(session: AsyncSession, user: User, task: Task) -> bool:
    board = await _board_for_task(session, task)
    if board and board.scope == BOARD_SCOPE_SYSTEM:
        if user.is_superuser:
            return True
        role = await _board_member_role(session, board, user.id)
        return role in {BOARD_MEMBER_ROLE_EDITOR, BOARD_MEMBER_ROLE_MANAGER}

    if user.is_superuser:
        return True
    if await user_has_permission(session, user, TASKS_MOVE):
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ASSIGNED):
        if _user_in_task_assignees(task, user.id):
            return True
        if task.system_id in await _user_system_id_set(session, user.id):
            return True
    return False
