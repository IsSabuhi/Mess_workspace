"""Участники системных досок: явные записи board_members + сотрудники производственной системы."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Board, BoardMember, User, UserSystem
from app.models.board import (
    BOARD_MEMBER_ROLE_VIEWER,
    BOARD_SCOPE_SYSTEM,
)
from app.schemas.board import BoardMemberOut


async def _active_system_users(session: AsyncSession, system_id: uuid.UUID) -> list[User]:
    stmt = (
        select(User)
        .join(UserSystem, UserSystem.user_id == User.id)
        .where(UserSystem.system_id == system_id, User.is_active.is_(True))
        .order_by(User.full_name, User.email)
    )
    return list((await session.execute(stmt)).scalars().unique().all())


async def effective_board_member_role(
    session: AsyncSession, board: Board, user_id: uuid.UUID
) -> str | None:
    """Роль на доске: явная запись или viewer для сотрудника системы (системные доски)."""
    explicit = await session.scalar(
        select(BoardMember.role).where(
            BoardMember.board_id == board.id, BoardMember.user_id == user_id
        ).limit(1)
    )
    if explicit is not None:
        return str(explicit)
    if board.scope != BOARD_SCOPE_SYSTEM or board.system_id is None:
        return None
    in_system = await session.scalar(
        select(UserSystem.user_id)
        .join(User, User.id == UserSystem.user_id)
        .where(
            UserSystem.user_id == user_id,
            UserSystem.system_id == board.system_id,
            User.is_active.is_(True),
        )
        .limit(1)
    )
    if in_system is not None:
        return BOARD_MEMBER_ROLE_VIEWER
    return None


async def build_board_member_list(session: AsyncSession, board: Board) -> list[BoardMemberOut]:
    explicit_by_user = {m.user_id: m for m in (board.members or [])}

    if board.scope != BOARD_SCOPE_SYSTEM or board.system_id is None:
        user_ids = list(explicit_by_user)
        names = await _user_names(session, user_ids)
        rows = sorted(
            board.members or [],
            key=lambda m: (names.get(m.user_id, "").lower(), str(m.user_id)),
        )
        return [
            BoardMemberOut(
                id=m.id,
                board_id=m.board_id,
                user_id=m.user_id,
                full_name=names.get(m.user_id, ""),
                role=m.role,
                created_at=m.created_at,
                is_system_member=False,
            )
            for m in rows
        ]

    system_users = await _active_system_users(session, board.system_id)
    system_user_ids = {u.id for u in system_users}
    out: list[BoardMemberOut] = []

    for user in system_users:
        explicit = explicit_by_user.get(user.id)
        out.append(
            BoardMemberOut(
                id=explicit.id if explicit else None,
                board_id=board.id,
                user_id=user.id,
                full_name=user.full_name,
                role=explicit.role if explicit else BOARD_MEMBER_ROLE_VIEWER,
                created_at=explicit.created_at if explicit else None,
                is_system_member=True,
            )
        )

    # Участники вне системы (например суперпользователь, добавленный вручную).
    for user_id, explicit in explicit_by_user.items():
        if user_id in system_user_ids:
            continue
        full_name = await session.scalar(select(User.full_name).where(User.id == user_id))
        out.append(
            BoardMemberOut(
                id=explicit.id,
                board_id=explicit.board_id,
                user_id=explicit.user_id,
                full_name=str(full_name or ""),
                role=explicit.role,
                created_at=explicit.created_at,
                is_system_member=False,
            )
        )

    out.sort(key=lambda m: (m.full_name.lower(), str(m.user_id)))
    return out


async def sync_system_members_on_board_create(
    session: AsyncSession, board: Board, creator_id: uuid.UUID
) -> None:
    """При создании системной доски добавить всех сотрудников системы (создатель — manager)."""
    if board.scope != BOARD_SCOPE_SYSTEM or board.system_id is None:
        return
    from app.models.board import BOARD_MEMBER_ROLE_MANAGER

    for user in await _active_system_users(session, board.system_id):
        role = BOARD_MEMBER_ROLE_MANAGER if user.id == creator_id else BOARD_MEMBER_ROLE_VIEWER
        session.add(BoardMember(board_id=board.id, user_id=user.id, role=role))


async def merge_system_board_members(
    session: AsyncSession,
    board: Board,
    submitted: list,
) -> list:
    """Для системной доски гарантировать всех сотрудников системы (неявные — viewer)."""
    from app.schemas.board import BoardMemberSetItem

    if board.scope != BOARD_SCOPE_SYSTEM or board.system_id is None:
        return list({m.user_id: m for m in submitted}.values())

    by_user = {m.user_id: m for m in submitted}
    for user in await _active_system_users(session, board.system_id):
        if user.id not in by_user:
            by_user[user.id] = BoardMemberSetItem(user_id=user.id, role=BOARD_MEMBER_ROLE_VIEWER)
    return list(by_user.values())


async def _user_names(session: AsyncSession, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    rows = await session.execute(select(User.id, User.full_name).where(User.id.in_(user_ids)))
    return {uid: name for uid, name in rows.all()}
