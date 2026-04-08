import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.http_errors import FORBIDDEN
from app.deps import get_current_user, require_permission
from app.models import KnowledgeArticle, KnowledgeSpace, KnowledgeSpaceMember, System, User
from app.models.knowledge import ArticleStatus, SpaceMemberRole
from app.permissions import KNOWLEDGE_MANAGE_ALL, KNOWLEDGE_READ_ALL
from app.schemas.knowledge import (
    KnowledgeArticleCreate,
    KnowledgeArticleOut,
    KnowledgeArticleUpdate,
    KnowledgeSpaceCreate,
    KnowledgeSpaceOut,
    KnowledgeDirectoryUser,
    KnowledgeSpaceUpdate,
    SpaceMemberIn,
    SpaceMemberOut,
    SpaceMemberUpdate,
)
from app.services.authz import user_has_permission
from app.schemas.upload import UploadOut
from app.services.knowledge_access import can_edit_article, can_manage_space_acl, can_read_space, can_view_article
from app.services.file_storage import save_kb_image

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


async def _space_to_out(session: AsyncSession, user: User, space: KnowledgeSpace) -> KnowledgeSpaceOut:
    base = KnowledgeSpaceOut.model_validate(space)
    can_edit = await can_edit_article(session, user, space)
    can_manage = await can_manage_space_acl(session, user, space)
    return base.model_copy(update={"can_edit": can_edit, "can_manage_members": can_manage})

_MAX_UPLOAD_BYTES = 8 * 1024 * 1024
_ALLOWED_IMAGE_CT = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
}


async def _validate_article_parent(
    session: AsyncSession,
    space_id: uuid.UUID,
    article_id: uuid.UUID | None,
    parent_id: uuid.UUID | None,
) -> None:
    """Родитель в том же пространстве; при смене родителя — без циклов (родитель не может быть потомком этой статьи)."""
    if parent_id is None:
        return
    parent = await session.get(KnowledgeArticle, parent_id)
    if not parent or parent.space_id != space_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent article")
    if article_id is None:
        return
    if parent_id == article_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Article cannot be its own parent")
    cur: uuid.UUID | None = parent_id
    for _ in range(512):
        if cur == article_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot set parent: would create a cycle",
            )
        row = await session.get(KnowledgeArticle, cur)
        if not row:
            break
        cur = row.parent_id


@router.get("/spaces", response_model=list[KnowledgeSpaceOut])
async def list_spaces(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[KnowledgeSpaceOut]:
    if user.is_superuser or await user_has_permission(session, user, KNOWLEDGE_READ_ALL):
        stmt = select(KnowledgeSpace).order_by(KnowledgeSpace.name)
        result = await session.execute(stmt)
        spaces = result.scalars().all()
    else:
        stmt = (
            select(KnowledgeSpace)
            .join(KnowledgeSpaceMember, KnowledgeSpaceMember.space_id == KnowledgeSpace.id)
            .where(KnowledgeSpaceMember.user_id == user.id)
            .order_by(KnowledgeSpace.name)
        )
        result = await session.execute(stmt)
        spaces = result.scalars().unique().all()
    return [await _space_to_out(session, user, s) for s in spaces]


@router.post("/spaces", response_model=KnowledgeSpaceOut, status_code=status.HTTP_201_CREATED)
async def create_space(
    body: KnowledgeSpaceCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(KNOWLEDGE_MANAGE_ALL))],
) -> KnowledgeSpaceOut:
    existing = await session.scalar(select(KnowledgeSpace.id).where(KnowledgeSpace.slug == body.slug))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")
    if body.system_id:
        sys = await session.get(System, body.system_id)
        if not sys:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid system")

    space = KnowledgeSpace(
        name=body.name,
        slug=body.slug,
        description=body.description,
        system_id=body.system_id,
        created_by_id=user.id,
    )
    session.add(space)
    await session.flush()
    session.add(
        KnowledgeSpaceMember(space_id=space.id, user_id=user.id, role=SpaceMemberRole.admin)
    )
    await session.flush()
    return await _space_to_out(session, user, space)


@router.get("/spaces/{space_id}", response_model=KnowledgeSpaceOut)
async def get_space(
    space_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> KnowledgeSpaceOut:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_read_space(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    return await _space_to_out(session, user, space)


@router.patch("/spaces/{space_id}", response_model=KnowledgeSpaceOut)
async def update_space(
    space_id: uuid.UUID,
    body: KnowledgeSpaceUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> KnowledgeSpaceOut:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_manage_space_acl(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    if body.name is not None:
        space.name = body.name
    if body.description is not None:
        space.description = body.description
    if body.system_id is not None:
        if body.system_id:
            sys = await session.get(System, body.system_id)
            if not sys:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid system")
        space.system_id = body.system_id
    await session.flush()
    return await _space_to_out(session, user, space)


@router.post("/spaces/{space_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def add_space_member(
    space_id: uuid.UUID,
    body: SpaceMemberIn,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_manage_space_acl(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    existing = await session.scalar(
        select(KnowledgeSpaceMember.user_id).where(
            KnowledgeSpaceMember.space_id == space_id,
            KnowledgeSpaceMember.user_id == body.user_id,
        )
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Member already exists")

    session.add(KnowledgeSpaceMember(space_id=space_id, user_id=body.user_id, role=body.role))
    await session.flush()


@router.get("/spaces/{space_id}/user-directory", response_model=list[KnowledgeDirectoryUser])
async def space_user_directory(
    space_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    q: str = "",
) -> list[KnowledgeDirectoryUser]:
    """Поиск активных пользователей для приглашения в пространство (без права users.manage)."""
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_manage_space_acl(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    stmt = select(User.id, User.email, User.full_name).where(User.is_active.is_(True))
    if q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(pat), User.full_name.ilike(pat)))
    stmt = stmt.order_by(User.email).limit(50)
    result = await session.execute(stmt)
    return [KnowledgeDirectoryUser(id=row.id, email=row.email, full_name=row.full_name) for row in result.all()]


@router.get("/spaces/{space_id}/members", response_model=list[SpaceMemberOut])
async def list_space_members(
    space_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[SpaceMemberOut]:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_manage_space_acl(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    stmt = (
        select(KnowledgeSpaceMember, User)
        .join(User, KnowledgeSpaceMember.user_id == User.id)
        .where(KnowledgeSpaceMember.space_id == space_id)
        .order_by(User.email)
    )
    result = await session.execute(stmt)
    return [
        SpaceMemberOut(user_id=u.id, email=u.email, full_name=u.full_name, role=m.role)
        for m, u in result.all()
    ]


@router.patch("/spaces/{space_id}/members/{member_user_id}", response_model=SpaceMemberOut)
async def update_space_member(
    space_id: uuid.UUID,
    member_user_id: uuid.UUID,
    body: SpaceMemberUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> SpaceMemberOut:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_manage_space_acl(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    m = await session.scalar(
        select(KnowledgeSpaceMember).where(
            KnowledgeSpaceMember.space_id == space_id,
            KnowledgeSpaceMember.user_id == member_user_id,
        )
    )
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    m.role = body.role
    await session.flush()
    u = await session.get(User, member_user_id)
    assert u
    return SpaceMemberOut(user_id=u.id, email=u.email, full_name=u.full_name, role=m.role)


@router.delete("/spaces/{space_id}/members/{member_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_space_member(
    space_id: uuid.UUID,
    member_user_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_manage_space_acl(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    m = await session.scalar(
        select(KnowledgeSpaceMember).where(
            KnowledgeSpaceMember.space_id == space_id,
            KnowledgeSpaceMember.user_id == member_user_id,
        )
    )
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    await session.delete(m)
    await session.flush()


@router.post("/upload", response_model=UploadOut)
async def upload_knowledge_image(
    file: Annotated[UploadFile, File()],
    _: Annotated[User, Depends(get_current_user)],
) -> UploadOut:
    """Загрузка изображения для статей БЗ (вставка в редактор). Доступно авторизованным пользователям."""
    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct not in _ALLOWED_IMAGE_CT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only image files allowed")
    raw = await file.read()
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large (max 8MB)")
    return UploadOut(url=save_kb_image(raw, ct))


@router.get("/spaces/{space_id}/articles/{article_id}", response_model=KnowledgeArticleOut)
async def get_article(
    space_id: uuid.UUID,
    article_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> KnowledgeArticleOut:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_read_space(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    article = await session.get(KnowledgeArticle, article_id)
    if not article or article.space_id != space_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    if not await can_view_article(session, user, article):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    return KnowledgeArticleOut.model_validate(article)


@router.get("/spaces/{space_id}/articles", response_model=list[KnowledgeArticleOut])
async def list_articles(
    space_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[KnowledgeArticleOut]:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_read_space(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    sees_all_drafts = user.is_superuser or await user_has_permission(session, user, KNOWLEDGE_MANAGE_ALL)
    if sees_all_drafts:
        stmt = (
            select(KnowledgeArticle)
            .where(KnowledgeArticle.space_id == space_id)
            .order_by(KnowledgeArticle.position, KnowledgeArticle.title)
        )
    else:
        stmt = (
            select(KnowledgeArticle)
            .where(
                KnowledgeArticle.space_id == space_id,
                or_(
                    KnowledgeArticle.status != ArticleStatus.draft,
                    KnowledgeArticle.created_by_id == user.id,
                ),
            )
            .order_by(KnowledgeArticle.position, KnowledgeArticle.title)
        )
    result = await session.execute(stmt)
    return [KnowledgeArticleOut.model_validate(a) for a in result.scalars().all()]


@router.post("/spaces/{space_id}/articles", response_model=KnowledgeArticleOut, status_code=status.HTTP_201_CREATED)
async def create_article(
    space_id: uuid.UUID,
    body: KnowledgeArticleCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> KnowledgeArticleOut:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_edit_article(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    existing = await session.scalar(
        select(KnowledgeArticle.id).where(
            KnowledgeArticle.space_id == space_id,
            KnowledgeArticle.slug == body.slug,
        )
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists in space")

    await _validate_article_parent(session, space_id, None, body.parent_id)

    article = KnowledgeArticle(
        space_id=space_id,
        title=body.title,
        slug=body.slug,
        content=body.content,
        parent_id=body.parent_id,
        status=body.status,
        position=body.position,
        created_by_id=user.id,
    )
    session.add(article)
    await session.flush()
    return KnowledgeArticleOut.model_validate(article)


@router.patch("/spaces/{space_id}/articles/{article_id}", response_model=KnowledgeArticleOut)
async def update_article(
    space_id: uuid.UUID,
    article_id: uuid.UUID,
    body: KnowledgeArticleUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> KnowledgeArticleOut:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_edit_article(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    article = await session.get(KnowledgeArticle, article_id)
    if not article or article.space_id != space_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    if not await can_view_article(session, user, article):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")

    patch = body.model_dump(exclude_unset=True)
    if "parent_id" in patch:
        await _validate_article_parent(session, space_id, article_id, patch["parent_id"])
        article.parent_id = patch["parent_id"]
    if body.title is not None:
        article.title = body.title
    if body.content is not None:
        article.content = body.content
    if body.status is not None:
        article.status = body.status
    if body.position is not None:
        article.position = body.position
    await session.flush()
    return KnowledgeArticleOut.model_validate(article)


@router.delete("/spaces/{space_id}/articles/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_article(
    space_id: uuid.UUID,
    article_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_edit_article(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

    article = await session.get(KnowledgeArticle, article_id)
    if not article or article.space_id != space_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    if not await can_view_article(session, user, article):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    await session.delete(article)
    await session.commit()
