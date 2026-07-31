"""Участники пространств БЗ: явные записи + сотрудники привязанной производственной системы."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KnowledgeSpace, KnowledgeSpaceMember, User, UserSystem
from app.models.knowledge import SpaceMemberRole
from app.schemas.knowledge import SpaceMemberOut


async def _active_system_users(session: AsyncSession, system_id: uuid.UUID) -> list[User]:
    stmt = (
        select(User)
        .join(UserSystem, UserSystem.user_id == User.id)
        .where(UserSystem.system_id == system_id, User.is_active.is_(True))
        .order_by(User.full_name, User.email)
    )
    return list((await session.execute(stmt)).scalars().unique().all())


async def effective_space_member_role(
    session: AsyncSession, space: KnowledgeSpace, user_id: uuid.UUID
) -> SpaceMemberRole | None:
    """Роль в пространстве: явная запись или viewer для сотрудника привязанной системы."""
    explicit = await session.scalar(
        select(KnowledgeSpaceMember.role).where(
            KnowledgeSpaceMember.space_id == space.id,
            KnowledgeSpaceMember.user_id == user_id,
        ).limit(1)
    )
    if explicit is not None:
        return explicit
    if space.system_id is None:
        return None
    in_system = await session.scalar(
        select(UserSystem.user_id)
        .join(User, User.id == UserSystem.user_id)
        .where(
            UserSystem.user_id == user_id,
            UserSystem.system_id == space.system_id,
            User.is_active.is_(True),
        )
        .limit(1)
    )
    if in_system is not None:
        return SpaceMemberRole.viewer
    return None


async def user_in_space_system(session: AsyncSession, space: KnowledgeSpace, user_id: uuid.UUID) -> bool:
    if space.system_id is None:
        return False
    row = await session.scalar(
        select(UserSystem.user_id)
        .where(
            UserSystem.user_id == user_id,
            UserSystem.system_id == space.system_id,
        )
        .limit(1)
    )
    return row is not None


async def build_space_member_list(session: AsyncSession, space: KnowledgeSpace) -> list[SpaceMemberOut]:
    """Явные участники + сотрудники системы пространства (как viewer)."""
    explicit_rows = (
        await session.execute(
            select(KnowledgeSpaceMember, User)
            .join(User, KnowledgeSpaceMember.user_id == User.id)
            .where(KnowledgeSpaceMember.space_id == space.id)
        )
    ).all()
    explicit_by_user = {u.id: (m, u) for m, u in explicit_rows}

    if space.system_id is None:
        out = [
            SpaceMemberOut(
                user_id=u.id,
                email=u.email,
                full_name=u.full_name,
                role=m.role,
                is_system_member=False,
            )
            for m, u in explicit_rows
        ]
        out.sort(key=lambda x: (x.full_name.lower(), x.email.lower()))
        return out

    system_users = await _active_system_users(session, space.system_id)
    system_user_ids = {u.id for u in system_users}
    out: list[SpaceMemberOut] = []

    for user in system_users:
        explicit = explicit_by_user.get(user.id)
        if explicit:
            m, _ = explicit
            out.append(
                SpaceMemberOut(
                    user_id=user.id,
                    email=user.email,
                    full_name=user.full_name,
                    role=m.role,
                    is_system_member=True,
                )
            )
        else:
            out.append(
                SpaceMemberOut(
                    user_id=user.id,
                    email=user.email,
                    full_name=user.full_name,
                    role=SpaceMemberRole.viewer,
                    is_system_member=True,
                )
            )

    for user_id, (m, u) in explicit_by_user.items():
        if user_id in system_user_ids:
            continue
        out.append(
            SpaceMemberOut(
                user_id=u.id,
                email=u.email,
                full_name=u.full_name,
                role=m.role,
                is_system_member=False,
            )
        )

    out.sort(key=lambda x: (x.full_name.lower(), x.email.lower()))
    return out


async def sync_system_members_on_space_create(
    session: AsyncSession, space: KnowledgeSpace, creator_id: uuid.UUID
) -> None:
    """При создании пространства с системой добавить сотрудников как viewer (создатель уже admin)."""
    if space.system_id is None:
        return
    for user in await _active_system_users(session, space.system_id):
        if user.id == creator_id:
            continue
        session.add(
            KnowledgeSpaceMember(
                space_id=space.id,
                user_id=user.id,
                role=SpaceMemberRole.viewer,
            )
        )
