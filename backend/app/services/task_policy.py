from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Board, Task, User
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
from app.services.authz import (
    get_user_permission_codes,
    user_has_permission,
    user_sees_all_tasks,
    user_system_id_set,
)
from app.services.board_lock import can_bypass_board_editing_lock, is_global_board_locked
from app.services.board_members import effective_board_member_role, prefetch_board_member_roles


async def _user_in_task_assignees(task: Task, user_id) -> bool:
    return any(a.id == user_id for a in (task.assignees or []))


def _attached_board(task: Task) -> Board | None:
    """Уже загруженная доска без lazy-load в async."""
    state = sa_inspect(task)
    if "board" in state.unloaded:
        return None
    return task.board


async def _board_for_task(session: AsyncSession, task: Task) -> Board | None:
    loaded = _attached_board(task)
    if loaded is not None:
        return loaded
    cache: dict = session.info.setdefault("_board_by_id", {})
    if task.board_id in cache:
        return cache[task.board_id]
    board = await session.get(Board, task.board_id)
    cache[task.board_id] = board
    return board


async def _board_member_role(session: AsyncSession, board: Board, user_id) -> str | None:
    return await effective_board_member_role(session, board, user_id)


async def can_read_task(session: AsyncSession, user: User, task: Task) -> bool:
    board = await _board_for_task(session, task)
    if board and board.scope == BOARD_SCOPE_SYSTEM:
        if user.is_superuser:
            return True
        # Руководитель (tasks.read.all / update.all): видит задачи на всех досках,
        # которые ему уже доступны в списке (в т.ч. через board.columns.manage).
        if await user_sees_all_tasks(session, user):
            return True
        role = await _board_member_role(session, board, user.id)
        return role is not None

    if await user_sees_all_tasks(session, user):
        return True
    if task.system_id in await user_system_id_set(session, user.id):
        return True
    if await user_has_permission(session, user, TASKS_READ_ASSIGNED):
        if _user_in_task_assignees(task, user.id):
            return True
    return False


async def filter_readable_tasks(session: AsyncSession, user: User, tasks: Sequence[Task]) -> list[Task]:
    """Список задач с проверкой can_read_task без N+1: права, системы и роли досок — один раз."""
    if not tasks:
        return []
    if await user_sees_all_tasks(session, user):
        return list(tasks)

    await get_user_permission_codes(session, user)
    await user_system_id_set(session, user.id)

    boards: dict = {}
    missing_ids: set = set()
    for task in tasks:
        loaded = _attached_board(task)
        if loaded is not None:
            boards[loaded.id] = loaded
        elif task.board_id not in boards:
            missing_ids.add(task.board_id)
    if missing_ids:
        found = (await session.execute(select(Board).where(Board.id.in_(missing_ids)))).scalars().all()
        for board in found:
            boards[board.id] = board
    session.info.setdefault("_board_by_id", {}).update(boards)

    await prefetch_board_member_roles(session, user.id, list(boards.values()))
    return [task for task in tasks if await can_read_task(session, user, task)]


async def _has_task_edit_permission(session: AsyncSession, user: User, task: Task) -> bool:
    board = await _board_for_task(session, task)
    if board and board.scope == BOARD_SCOPE_SYSTEM:
        if user.is_superuser:
            return True
        if await user_has_permission(session, user, TASKS_UPDATE_ALL):
            return True
        role = await _board_member_role(session, board, user.id)
        if role in {BOARD_MEMBER_ROLE_EDITOR, BOARD_MEMBER_ROLE_MANAGER}:
            return True
        if await user_has_permission(session, user, TASKS_UPDATE_ASSIGNED):
            if _user_in_task_assignees(task, user.id):
                return True
            if task.system_id in await user_system_id_set(session, user.id):
                return True
        return False

    if user.is_superuser:
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ALL):
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ASSIGNED):
        if _user_in_task_assignees(task, user.id):
            return True
        if task.system_id in await user_system_id_set(session, user.id):
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
        if await user_has_permission(session, user, TASKS_DELETE):
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
        # Создавать на чужой системной доске можно при глобальном праве на создание
        # и праве видеть все задачи (начальник отдела / руководитель).
        if await user_has_permission(session, user, TASKS_CREATE) and await user_sees_all_tasks(session, user):
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
        if await user_has_permission(session, user, TASKS_MOVE):
            return True
        if await user_has_permission(session, user, TASKS_UPDATE_ALL):
            return True
        role = await _board_member_role(session, board, user.id)
        if role in {BOARD_MEMBER_ROLE_EDITOR, BOARD_MEMBER_ROLE_MANAGER}:
            return True
        if await user_has_permission(session, user, TASKS_UPDATE_ASSIGNED):
            if _user_in_task_assignees(task, user.id):
                return True
            if task.system_id in await user_system_id_set(session, user.id):
                return True
        return False

    if user.is_superuser:
        return True
    if await user_has_permission(session, user, TASKS_MOVE):
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ALL):
        return True
    if await user_has_permission(session, user, TASKS_UPDATE_ASSIGNED):
        if _user_in_task_assignees(task, user.id):
            return True
        if task.system_id in await user_system_id_set(session, user.id):
            return True
    return False
