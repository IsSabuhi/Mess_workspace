import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KnowledgeArticle, KnowledgeSpace, KnowledgeSpaceMember, User
from app.models.knowledge import ArticleStatus, SpaceMemberRole
from app.permissions import KNOWLEDGE_MANAGE_ALL, KNOWLEDGE_READ_ALL, KNOWLEDGE_SPACE_MANAGE
from app.services.authz import user_has_permission


async def _member(session: AsyncSession, user_id: uuid.UUID, space_id: uuid.UUID) -> KnowledgeSpaceMember | None:
    stmt = select(KnowledgeSpaceMember).where(
        KnowledgeSpaceMember.space_id == space_id,
        KnowledgeSpaceMember.user_id == user_id,
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def can_list_space(session: AsyncSession, user: User, space: KnowledgeSpace) -> bool:
    if user.is_superuser:
        return True
    if await user_has_permission(session, user, KNOWLEDGE_READ_ALL):
        return True
    m = await _member(session, user.id, space.id)
    return m is not None


async def can_read_space(session: AsyncSession, user: User, space: KnowledgeSpace) -> bool:
    return await can_list_space(session, user, space)


async def can_edit_article(session: AsyncSession, user: User, space: KnowledgeSpace) -> bool:
    if user.is_superuser:
        return True
    if await user_has_permission(session, user, KNOWLEDGE_MANAGE_ALL):
        return True
    m = await _member(session, user.id, space.id)
    if m and m.role in (SpaceMemberRole.editor, SpaceMemberRole.admin):
        return True
    return await user_has_permission(session, user, KNOWLEDGE_SPACE_MANAGE)


async def can_manage_space_acl(session: AsyncSession, user: User, space: KnowledgeSpace) -> bool:
    if user.is_superuser:
        return True
    if await user_has_permission(session, user, KNOWLEDGE_MANAGE_ALL):
        return True
    m = await _member(session, user.id, space.id)
    return bool(m and m.role == SpaceMemberRole.admin)


async def can_view_article(session: AsyncSession, user: User, article: KnowledgeArticle) -> bool:
    """Опубликованные статьи видны всем с доступом к пространству. Черновики — автору, суперпользователю и тем, у кого есть knowledge.manage.all"""
    if article.status != ArticleStatus.draft:
        return True
    if user.is_superuser:
        return True
    if await user_has_permission(session, user, KNOWLEDGE_MANAGE_ALL):
        return True
    if article.created_by_id is not None and article.created_by_id == user.id:
        return True
    return False
