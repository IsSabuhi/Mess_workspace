from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, User, UserSystem
from app.permissions import (
    TASKS_DELETE,
    TASKS_MOVE,
    TASKS_READ_ASSIGNED,
    TASKS_UPDATE_ALL,
    TASKS_UPDATE_ASSIGNED,
)
from app.services.authz import user_has_permission, user_sees_all_tasks


async def _user_system_id_set(session: AsyncSession, user_id) -> set:
    r = await session.execute(select(UserSystem.system_id).where(UserSystem.user_id == user_id))
    return set(r.scalars().all())


def _user_in_task_assignees(task: Task, user_id) -> bool:
    return any(a.id == user_id for a in (task.assignees or []))


async def can_read_task(session: AsyncSession, user: User, task: Task) -> bool:
    if await user_sees_all_tasks(session, user):
        return True
    if task.system_id in await _user_system_id_set(session, user.id):
        return True
    if await user_has_permission(session, user, TASKS_READ_ASSIGNED):
        if _user_in_task_assignees(task, user.id):
            return True
    return False


async def can_update_task(session: AsyncSession, user: User, task: Task) -> bool:
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


async def can_delete_task(session: AsyncSession, user: User, task: Task) -> bool:
    if user.is_superuser:
        return True
    return await user_has_permission(session, user, TASKS_DELETE)


async def can_move_task(session: AsyncSession, user: User, task: Task) -> bool:
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
