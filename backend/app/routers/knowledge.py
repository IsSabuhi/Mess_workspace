import os
import tempfile
import uuid
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.formparsers import MultiPartException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.http_errors import FORBIDDEN, INVALID_PASSWORD
from app.deps import get_current_user, require_any_permission, require_permission
from app.models import (
    KnowledgeArticle,
    KnowledgeArticleRevision,
    KnowledgeSpace,
    KnowledgeSpaceMember,
    KnowledgeTemplate,
    System,
    User,
    UserSystem,
)
from app.models.knowledge import ArticleStatus, SpaceMemberRole
from app.permissions import ADMIN_IMPORT_KNOWLEDGE, KNOWLEDGE_MANAGE_ALL, KNOWLEDGE_READ_ALL
from app.services.employee_status import user_is_not_dismissed
from app.schemas.knowledge import (
    KnowledgeArticleCreate,
    KnowledgeArticleOut,
    KnowledgeArticleUpdate,
    KnowledgeArticleRevisionOut,
    KnowledgeArticleRestoreIn,
    KnowledgeSpaceCreate,
    KnowledgeSpaceDeleteIn,
    KnowledgeObsidianImportOut,
    KnowledgeObsidianFileResult,
    KnowledgeSearchResultOut,
    KnowledgeSpaceOut,
    KnowledgeDirectoryUser,
    KnowledgeSpaceUpdate,
    KnowledgeTemplateCreate,
    KnowledgeTemplateOut,
    SpaceMemberIn,
    SpaceMemberOut,
    SpaceMemberUpdate,
)
from app.services.authz import user_has_permission
from app.schemas.upload import UploadOut
from app.security import verify_password
from app.services.knowledge_access import can_edit_article, can_manage_space_acl, can_read_space, can_view_article
from app.services.knowledge_children_toc import sync_parent_children_toc, sync_parents_children_toc
from app.services.knowledge_space_members import (
    build_space_member_list,
    sync_system_members_on_space_create,
    user_in_space_system,
)
from app.services.file_storage import rewrite_stored_media_urls, save_kb_image
from app.services.sql_like import ilike_contains, ilike_escape_char
from app.services.knowledge_obsidian import (
    ImportItems,
    add_import_bytes,
    basename_key,
    detect_common_root,
    find_space_import_hub,
    folder_title_from_segment,
    image_content_type,
    normalize_hub_title,
    normalize_relpath,
    note_folder_segments,
    parse_note,
    slugify_title,
    unique_slug,
    unpack_obsidian_zip,
    upload_kind,
)
from app.services.audit import record_audit_event

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

_ARTICLE_LOAD = (selectinload(KnowledgeArticle.created_by),)


def _article_to_out(article: KnowledgeArticle) -> KnowledgeArticleOut:
    out = KnowledgeArticleOut.model_validate(article)
    return out.model_copy(update={"content": rewrite_stored_media_urls(out.content)})


async def _article_out(session: AsyncSession, article_id: uuid.UUID) -> KnowledgeArticleOut:
    article = (
        await session.execute(
            select(KnowledgeArticle).where(KnowledgeArticle.id == article_id).options(*_ARTICLE_LOAD)
        )
    ).scalar_one()
    return _article_to_out(article)


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
    "image/bmp",
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


def _article_snippet(article: KnowledgeArticle, query: str) -> str | None:
    if not query.strip():
        return None
    text = (article.content or "").replace("\n", " ")
    if not text:
        return None
    idx = text.lower().find(query.lower())
    if idx < 0:
        return text[:160] if len(text) > 160 else text
    start = max(0, idx - 60)
    end = min(len(text), idx + 100)
    return text[start:end].strip()


async def _save_article_revision(session: AsyncSession, article: KnowledgeArticle, user: User) -> None:
    session.add(
        KnowledgeArticleRevision(
            article_id=article.id,
            space_id=article.space_id,
            title=article.title,
            content=article.content,
            status=article.status,
            parent_id=article.parent_id,
            saved_by_id=user.id,
        )
    )


@router.get("/spaces", response_model=list[KnowledgeSpaceOut])
async def list_spaces(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[KnowledgeSpaceOut]:
    if user.is_superuser or await user_has_permission(session, user, KNOWLEDGE_READ_ALL) or await user_has_permission(
        session, user, ADMIN_IMPORT_KNOWLEDGE
    ):
        stmt = select(KnowledgeSpace).order_by(KnowledgeSpace.name)
        result = await session.execute(stmt)
        spaces = result.scalars().all()
    else:
        system_ids = list(
            (
                await session.execute(select(UserSystem.system_id).where(UserSystem.user_id == user.id))
            ).scalars().all()
        )
        clauses = [KnowledgeSpaceMember.user_id == user.id]
        if system_ids:
            clauses.append(KnowledgeSpace.system_id.in_(system_ids))
        member_join = (
            select(KnowledgeSpace)
            .outerjoin(KnowledgeSpaceMember, KnowledgeSpaceMember.space_id == KnowledgeSpace.id)
            .where(or_(*clauses))
            .order_by(KnowledgeSpace.name)
        )
        result = await session.execute(member_join)
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
    await sync_system_members_on_space_create(session, space, user.id)
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

    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and patch["name"] is not None:
        space.name = patch["name"]
    if "description" in patch:
        space.description = patch["description"]
    if "system_id" in patch:
        sid = patch["system_id"]
        if sid:
            sys = await session.get(System, sid)
            if not sys:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid system")
        space.system_id = sid
    await session.flush()
    await record_audit_event(
        session,
        entity_type="knowledge_space",
        entity_id=space.id,
        action="knowledge.space.updated",
        actor_user_id=user.id,
        details={"name": space.name, "changed": list(patch.keys())},
    )
    await session.commit()
    return await _space_to_out(session, user, space)


@router.delete("/spaces/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_space(
    space_id: uuid.UUID,
    body: KnowledgeSpaceDeleteIn,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_manage_space_acl(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_PASSWORD)

    name = space.name
    slug = space.slug
    await record_audit_event(
        session,
        entity_type="knowledge_space",
        entity_id=space.id,
        action="knowledge.space.deleted",
        actor_user_id=user.id,
        details={"name": name, "slug": slug},
    )
    await session.delete(space)
    await session.commit()


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

    stmt = select(User.id, User.email, User.full_name).where(User.is_active.is_(True), user_is_not_dismissed())
    pat = ilike_contains(q)
    if pat:
        esc = ilike_escape_char()
        stmt = stmt.where(or_(User.email.ilike(pat, escape=esc), User.full_name.ilike(pat, escape=esc)))
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

    return await build_space_member_list(session, space)


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
    is_system = await user_in_space_system(session, space, member_user_id)
    if not m:
        if not is_system:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        # Повышение роли сотрудника системы — создаём явную запись.
        m = KnowledgeSpaceMember(space_id=space_id, user_id=member_user_id, role=body.role)
        session.add(m)
    else:
        m.role = body.role
    await session.flush()
    u = await session.get(User, member_user_id)
    assert u
    return SpaceMemberOut(
        user_id=u.id,
        email=u.email,
        full_name=u.full_name,
        role=m.role,
        is_system_member=is_system,
    )


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

    if await user_in_space_system(session, space, member_user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя удалить сотрудника системы пространства. Снимите привязку к системе или уберите пользователя из системы.",
        )

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


_MAX_MD_BYTES = 2 * 1024 * 1024
_MAX_IMPORT_FILES = 8000
_MAX_ZIP_BYTES = 400 * 1024 * 1024
_MAX_ZIP_UNCOMPRESSED = 1_200 * 1024 * 1024
_KB_IMPORT_ADMIN = require_any_permission(ADMIN_IMPORT_KNOWLEDGE, KNOWLEDGE_MANAGE_ALL)
_ZIP_SPOOL_CHUNK = 1024 * 1024


async def _spool_upload_to_temp(upload: StarletteUploadFile, max_bytes: int) -> tuple[str, int]:
    """Пишет upload на диск чанками: zip не держим целиком в RAM."""
    fd, path = tempfile.mkstemp(suffix=".zip")
    total = 0
    try:
        with os.fdopen(fd, "wb") as out:
            fd = -1
            while True:
                chunk = await upload.read(_ZIP_SPOOL_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Zip больше 400 МБ",
                    )
                out.write(chunk)
        return path, total
    except Exception:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(path)
        except OSError:
            pass
        raise


def _as_uploads(value: object) -> list[StarletteUploadFile]:
    if value is None:
        return []
    if isinstance(value, list):
        return [v for v in value if isinstance(v, StarletteUploadFile)]
    if isinstance(value, StarletteUploadFile):
        return [value]
    return []


@router.post("/import-obsidian", response_model=KnowledgeObsidianImportOut)
async def import_obsidian_knowledge(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_KB_IMPORT_ADMIN)],
) -> KnowledgeObsidianImportOut:
    try:
        form = await request.form(
            max_files=_MAX_IMPORT_FILES,
            max_fields=50,
            max_part_size=_MAX_ZIP_BYTES,
        )
    except MultiPartException as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Слишком много файлов за раз. Запакуйте хранилище (папки с .md и PNG) в один zip.",
        ) from exc

    try:
        space_raw = form.get("space_id")
        try:
            space_id = UUID(str(space_raw or "").strip())
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Не указано пространство") from None
        space = await session.get(KnowledgeSpace, space_id)
        if not space:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пространство не найдено")
        if not await can_edit_article(session, user, space) and not await user_has_permission(
            session, user, ADMIN_IMPORT_KNOWLEDGE
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)

        uploads = _as_uploads(form.getlist("files"))
        archives = _as_uploads(form.get("archive")) or _as_uploads(form.getlist("archive"))
        if not uploads and not archives:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Выберите zip или файлы")
        if len(uploads) > _MAX_IMPORT_FILES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Слишком много файлов за раз. Запакуйте хранилище в один zip.",
            )

        items = ImportItems()
        for archive in archives:
            name = (archive.filename or "").lower()
            tmp_path: str | None = None
            try:
                tmp_path, total = await _spool_upload_to_temp(archive, _MAX_ZIP_BYTES)
                if total == 0:
                    continue
                if not (name.endswith(".zip") or (archive.content_type or "").endswith("zip")):
                    with open(tmp_path, "rb") as probe:
                        magic = probe.read(4)
                    if magic not in (b"PK\x03\x04", b"PK\x05\x06"):
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Архив должен быть в формате zip",
                        )
                unpacked = unpack_obsidian_zip(
                    tmp_path,
                    max_md_bytes=_MAX_MD_BYTES,
                    max_image_bytes=_MAX_UPLOAD_BYTES,
                    max_files=_MAX_IMPORT_FILES,
                    max_uncompressed=_MAX_ZIP_UNCOMPRESSED,
                )
                items.notes.extend(unpacked.notes)
                items.images.extend(unpacked.images)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
            finally:
                if tmp_path:
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

        for upload in uploads:
            filename = normalize_relpath(upload.filename or "") or (upload.filename or "без имени")
            if upload_kind(filename) is None:
                continue
            raw = await upload.read()
            add_import_bytes(
                items,
                filename,
                raw,
                declared_type=upload.content_type,
                max_md_bytes=_MAX_MD_BYTES,
                max_image_bytes=_MAX_UPLOAD_BYTES,
            )

        notes, images = items.notes, items.images
        if not notes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Не найдено ни одной заметки .md",
            )
    finally:
        await form.close()

    url_by_path: dict[str, str] = {}
    url_by_name: dict[str, str] = {}
    images_uploaded = 0
    for filename, raw, ct in images:
        url = save_kb_image(raw, ct)
        url_by_path[normalize_relpath(filename).lower()] = url
        url_by_name[basename_key(filename)] = url
        images_uploaded += 1

    existing_rows = (
        await session.execute(
            select(KnowledgeArticle.id, KnowledgeArticle.title, KnowledgeArticle.parent_id, KnowledgeArticle.slug).where(
                KnowledgeArticle.space_id == space_id
            )
        )
    ).all()
    existing_by_parent_title: dict[tuple[uuid.UUID | None, str], uuid.UUID] = {}
    taken_slugs: set[str] = set()
    for aid, title, pid, slug in existing_rows:
        existing_by_parent_title[(pid, (title or "").strip().lower())] = aid
        if slug:
            taken_slugs.add(slug)

    common_root = detect_common_root([fn for fn, _ in notes])
    notes = sorted(notes, key=lambda item: normalize_relpath(item[0]).lower())
    hub = find_space_import_hub(existing_rows)
    hub_id: uuid.UUID | None = hub[0] if hub else None
    hub_title = hub[1] if hub else ""
    hub_title_key = normalize_hub_title(hub_title)

    results: list[KnowledgeObsidianFileResult] = []
    created = skipped = failed = folders_created = 0
    parents_to_sync: set[uuid.UUID] = set()
    if hub_id is not None:
        parents_to_sync.add(hub_id)

    async def ensure_folders(segments: list[str]) -> uuid.UUID | None:
        nonlocal folders_created
        parent_id: uuid.UUID | None = hub_id
        for seg in segments:
            folder_title = folder_title_from_segment(seg)
            if hub_id is not None and parent_id == hub_id and normalize_hub_title(folder_title) == hub_title_key:
                continue
            key = (parent_id, folder_title.lower())
            found = existing_by_parent_title.get(key)
            if found:
                parent_id = found
                continue
            slug = unique_slug(slugify_title(folder_title, fallback="folder"), taken_slugs, fallback="folder")
            async with session.begin_nested():
                folder = KnowledgeArticle(
                    space_id=space_id,
                    title=folder_title,
                    slug=slug,
                    content=None,
                    parent_id=parent_id,
                    status=ArticleStatus.published,
                    position=0,
                    created_by_id=user.id,
                )
                session.add(folder)
                await session.flush()
                await _save_article_revision(session, folder, user)
                await record_audit_event(
                    session,
                    entity_type="knowledge",
                    entity_id=folder.id,
                    action="knowledge.imported",
                    actor_user_id=user.id,
                    details={
                        "title": folder_title,
                        "folder": True,
                        "space_id": str(space_id),
                    },
                )
            existing_by_parent_title[key] = folder.id
            taken_slugs.add(slug)
            folders_created += 1
            if parent_id is not None:
                parents_to_sync.add(parent_id)
            parent_id = folder.id
        return parent_id

    for filename, text in notes:
        title = None
        try:
            if not text:
                raise ValueError("Не удалось прочитать файл (кодировка или больше 2 МБ)")
            parsed = parse_note(filename, text, url_by_path, url_by_name)
            title = parsed.title
            if not title:
                raise ValueError("Не удалось определить заголовок")
            parent_id = await ensure_folders(note_folder_segments(filename, common_root))
            if hub_id is not None and parent_id == hub_id and normalize_hub_title(title) == hub_title_key:
                skipped += 1
                results.append(
                    KnowledgeObsidianFileResult(
                        filename=filename,
                        title=title,
                        skipped=True,
                        error="Совпадает с родительской страницей пространства — не дублируем",
                    )
                )
                continue
            dup_key = (parent_id, title.lower())
            if dup_key in existing_by_parent_title:
                skipped += 1
                results.append(
                    KnowledgeObsidianFileResult(
                        filename=filename,
                        title=title,
                        skipped=True,
                        error="Статья с таким названием уже есть в этой папке",
                    )
                )
                continue
            slug = unique_slug(slugify_title(title), taken_slugs)
            async with session.begin_nested():
                article = KnowledgeArticle(
                    space_id=space_id,
                    title=title,
                    slug=slug,
                    content=parsed.html or None,
                    parent_id=parent_id,
                    status=ArticleStatus.published,
                    position=0,
                    created_by_id=user.id,
                )
                session.add(article)
                await session.flush()
                await _save_article_revision(session, article, user)
                await record_audit_event(
                    session,
                    entity_type="knowledge",
                    entity_id=article.id,
                    action="knowledge.imported",
                    actor_user_id=user.id,
                    details={"title": title, "file": filename, "space_id": str(space_id)},
                )
            existing_by_parent_title[dup_key] = article.id
            taken_slugs.add(slug)
            created += 1
            if parent_id is not None:
                parents_to_sync.add(parent_id)
            results.append(
                KnowledgeObsidianFileResult(
                    filename=filename,
                    title=title,
                    created=True,
                    images_rewritten=parsed.images_rewritten,
                    missing_images=parsed.missing_images,
                )
            )
        except Exception as exc:  # noqa: BLE001
            failed += 1
            results.append(
                KnowledgeObsidianFileResult(
                    filename=filename,
                    title=title,
                    error=str(exc)[:400],
                )
            )

    await sync_parents_children_toc(session, space_id, parents_to_sync, sync_ancestors=True)

    return KnowledgeObsidianImportOut(
        created=created,
        skipped=skipped,
        failed=failed,
        images_uploaded=images_uploaded,
        folders_created=folders_created,
        files=results,
    )


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
    return await _article_out(session, article.id)


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

    sees_all_drafts = await can_edit_article(session, user, space)
    if sees_all_drafts:
        stmt = (
            select(KnowledgeArticle)
            .where(KnowledgeArticle.space_id == space_id)
            .options(*_ARTICLE_LOAD)
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
            .options(*_ARTICLE_LOAD)
            .order_by(KnowledgeArticle.position, KnowledgeArticle.title)
        )
    result = await session.execute(stmt)
    return [_article_to_out(a) for a in result.scalars().all()]


@router.get("/spaces/{space_id}/search/articles", response_model=list[KnowledgeSearchResultOut])
async def search_articles(
    space_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    q: str = "",
) -> list[KnowledgeSearchResultOut]:
    space = await session.get(KnowledgeSpace, space_id)
    if not space:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    if not await can_read_space(session, user, space):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    query = q.strip()
    if not query:
        return []
    sees_all_drafts = await can_edit_article(session, user, space)
    stmt = select(KnowledgeArticle).where(KnowledgeArticle.space_id == space_id).options(*_ARTICLE_LOAD)
    if not sees_all_drafts:
        stmt = stmt.where(
            or_(
                KnowledgeArticle.status != ArticleStatus.draft,
                KnowledgeArticle.created_by_id == user.id,
            )
        )
    like = ilike_contains(query)
    if not like:
        return []
    esc = ilike_escape_char()
    stmt = stmt.where(
        or_(
            KnowledgeArticle.title.ilike(like, escape=esc),
            KnowledgeArticle.content.ilike(like, escape=esc),
        )
    ).order_by(
        KnowledgeArticle.updated_at.desc()
    ).limit(50)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        KnowledgeSearchResultOut(article=_article_to_out(a), snippet=_article_snippet(a, query))
        for a in rows
    ]


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
    await _save_article_revision(session, article, user)
    if article.parent_id is not None:
        await sync_parent_children_toc(session, space_id, article.parent_id)
    return await _article_out(session, article.id)


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
    old_parent_id = article.parent_id
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
    await _save_article_revision(session, article, user)

    if any(k in patch for k in ("title", "parent_id", "position")):
        parents: set[uuid.UUID] = set()
        if old_parent_id is not None:
            parents.add(old_parent_id)
        if article.parent_id is not None:
            parents.add(article.parent_id)
        for pid in parents:
            await sync_parent_children_toc(session, space_id, pid)

    return await _article_out(session, article.id)


@router.get("/spaces/{space_id}/articles/{article_id}/revisions", response_model=list[KnowledgeArticleRevisionOut])
async def list_article_revisions(
    space_id: uuid.UUID,
    article_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[KnowledgeArticleRevisionOut]:
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
    rows = (
        await session.execute(
            select(KnowledgeArticleRevision)
            .where(
                KnowledgeArticleRevision.space_id == space_id,
                KnowledgeArticleRevision.article_id == article_id,
            )
            .order_by(KnowledgeArticleRevision.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    return [KnowledgeArticleRevisionOut.model_validate(x) for x in rows]


@router.post("/spaces/{space_id}/articles/{article_id}/restore", response_model=KnowledgeArticleOut)
async def restore_article_revision(
    space_id: uuid.UUID,
    article_id: uuid.UUID,
    body: KnowledgeArticleRestoreIn,
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
    rev = await session.scalar(
        select(KnowledgeArticleRevision).where(
            and_(
                KnowledgeArticleRevision.id == body.revision_id,
                KnowledgeArticleRevision.article_id == article_id,
                KnowledgeArticleRevision.space_id == space_id,
            )
        )
    )
    if not rev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    article.title = rev.title
    article.content = rev.content
    article.status = rev.status
    old_parent_id = article.parent_id
    article.parent_id = rev.parent_id
    await session.flush()
    await _save_article_revision(session, article, user)
    parents: set[uuid.UUID] = set()
    if old_parent_id is not None:
        parents.add(old_parent_id)
    if article.parent_id is not None:
        parents.add(article.parent_id)
    for pid in parents:
        await sync_parent_children_toc(session, space_id, pid)
    return await _article_out(session, article.id)


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
    parent_id = article.parent_id
    await session.delete(article)
    await session.flush()
    if parent_id is not None:
        await sync_parent_children_toc(session, space_id, parent_id)
    await session.commit()


@router.get("/templates", response_model=list[KnowledgeTemplateOut])
async def list_templates(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    space_id: uuid.UUID | None = None,
) -> list[KnowledgeTemplateOut]:
    stmt = select(KnowledgeTemplate).order_by(KnowledgeTemplate.name)
    if space_id:
        stmt = stmt.where(or_(KnowledgeTemplate.space_id == space_id, KnowledgeTemplate.space_id.is_(None)))
    else:
        stmt = stmt.where(KnowledgeTemplate.space_id.is_(None))
    rows = (await session.execute(stmt)).scalars().all()
    if user.is_superuser or await user_has_permission(session, user, KNOWLEDGE_MANAGE_ALL):
        return [KnowledgeTemplateOut.model_validate(x) for x in rows]
    filtered: list[KnowledgeTemplate] = []
    for t in rows:
        if t.space_id is None:
            filtered.append(t)
            continue
        space = await session.get(KnowledgeSpace, t.space_id)
        if space and await can_read_space(session, user, space):
            filtered.append(t)
    return [KnowledgeTemplateOut.model_validate(x) for x in filtered]


@router.post("/templates", response_model=KnowledgeTemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    body: KnowledgeTemplateCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> KnowledgeTemplateOut:
    if body.space_id is None:
        if not (user.is_superuser or await user_has_permission(session, user, KNOWLEDGE_MANAGE_ALL)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    else:
        space = await session.get(KnowledgeSpace, body.space_id)
        if not space:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
        if not await can_edit_article(session, user, space):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN)
    exists = await session.scalar(
        select(KnowledgeTemplate.id).where(
            KnowledgeTemplate.slug == body.slug,
            KnowledgeTemplate.space_id == body.space_id,
        )
    )
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Template slug already exists")
    row = KnowledgeTemplate(
        name=body.name,
        slug=body.slug,
        content=body.content,
        space_id=body.space_id,
        created_by_id=user.id,
    )
    session.add(row)
    await session.flush()
    return KnowledgeTemplateOut.model_validate(row)
