from sqlalchemy.ext.asyncio import AsyncSession

from app.models import KnowledgeArticle, KnowledgeSpace, User
from app.models.knowledge import ArticleStatus, SpaceMemberRole
from app.permissions import KNOWLEDGE_READ_ALL
from app.services.authz import user_has_permission
from app.services.knowledge_space_members import effective_space_member_role


async def can_list_space(session: AsyncSession, user: User, space: KnowledgeSpace) -> bool:
    if user.is_superuser:
        return True
    if await user_has_permission(session, user, KNOWLEDGE_READ_ALL):
        return True
    role = await effective_space_member_role(session, space, user.id)
    return role is not None


async def can_read_space(session: AsyncSession, user: User, space: KnowledgeSpace) -> bool:
    return await can_list_space(session, user, space)


async def can_edit_article(session: AsyncSession, user: User, space: KnowledgeSpace) -> bool:
    """Редактирование статей — только участник пространства (editor/admin) или суперпользователь.

    Глобальные knowledge.manage.all / knowledge.space.manage сами по себе не дают правку чужих пространств.
    """
    if user.is_superuser:
        return True
    role = await effective_space_member_role(session, space, user.id)
    return role in (SpaceMemberRole.editor, SpaceMemberRole.admin)


async def can_manage_space_acl(session: AsyncSession, user: User, space: KnowledgeSpace) -> bool:
    """Участники и настройки пространства — только admin в участниках или суперпользователь."""
    if user.is_superuser:
        return True
    role = await effective_space_member_role(session, space, user.id)
    return role == SpaceMemberRole.admin


async def can_view_article(session: AsyncSession, user: User, article: KnowledgeArticle) -> bool:
    """Опубликованные — при доступе к пространству. Черновики — автор, суперпользователь или editor/admin пространства."""
    if article.status != ArticleStatus.draft:
        return True
    if user.is_superuser:
        return True
    if article.created_by_id is not None and article.created_by_id == user.id:
        return True
    space = await session.get(KnowledgeSpace, article.space_id)
    if space is None:
        return False
    return await can_edit_article(session, user, space)
