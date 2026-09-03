import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import get_current_user
from app.models import PersonalNote, User
from app.models.personal_note import (
    NOTE_COLOR_DEFAULT,
    PersonalNoteAttachment,
    PersonalNoteTag,
    PersonalNoteTagLink,
)
from app.schemas.personal_note import (
    NoteScope,
    PersonalNoteAttachmentOut,
    PersonalNoteCreate,
    PersonalNoteOut,
    PersonalNoteTagCreate,
    PersonalNoteTagOut,
    PersonalNoteTagUpdate,
    PersonalNoteUpdate,
)
from app.services.file_storage import delete_stored_files, delete_stored_keys, save_note_file, stored_keys_from_text
from app.services.notifications import next_daily_reminder_at

router = APIRouter(prefix="/notes", tags=["notes"])

_MAX_UPLOAD_BYTES = 12 * 1024 * 1024
_NOTE_LOAD = (
    selectinload(PersonalNote.tags),
    selectinload(PersonalNote.attachments),
)


def _normalize_checklist(items: list[Any] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in items or []:
        if isinstance(raw, dict):
            item_id = str(raw.get("id") or uuid.uuid4())
            text = str(raw.get("text") or "")[:2000]
            done = bool(raw.get("done"))
        else:
            item_id = str(getattr(raw, "id", uuid.uuid4()))
            text = str(getattr(raw, "text", "") or "")[:2000]
            done = bool(getattr(raw, "done", False))
        out.append({"id": item_id, "text": text, "done": done})
    return out


def _note_to_out(note: PersonalNote) -> PersonalNoteOut:
    return PersonalNoteOut.model_validate(note)


async def _get_owned_note(
    session: AsyncSession,
    note_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    include_deleted: bool = True,
) -> PersonalNote:
    stmt = (
        select(PersonalNote)
        .where(PersonalNote.id == note_id, PersonalNote.owner_user_id == user_id)
        .options(*_NOTE_LOAD)
    )
    note = await session.scalar(stmt)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    if not include_deleted and note.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return note


async def _resolve_tags(
    session: AsyncSession,
    user_id: uuid.UUID,
    tag_ids: list[uuid.UUID],
) -> list[PersonalNoteTag]:
    if not tag_ids:
        return []
    rows = (
        await session.execute(
            select(PersonalNoteTag).where(
                PersonalNoteTag.owner_user_id == user_id,
                PersonalNoteTag.id.in_(tag_ids),
            )
        )
    ).scalars().all()
    if len(rows) != len(set(tag_ids)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown tag")
    return list(rows)


@router.get("/tags", response_model=list[PersonalNoteTagOut])
async def list_tags(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[PersonalNoteTagOut]:
    rows = (
        await session.execute(
            select(PersonalNoteTag)
            .where(PersonalNoteTag.owner_user_id == user.id)
            .order_by(PersonalNoteTag.name)
        )
    ).scalars().all()
    return [PersonalNoteTagOut.model_validate(t) for t in rows]


@router.post("/tags", response_model=PersonalNoteTagOut, status_code=status.HTTP_201_CREATED)
async def create_tag(
    body: PersonalNoteTagCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PersonalNoteTagOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty tag name")
    existing = await session.scalar(
        select(PersonalNoteTag).where(
            PersonalNoteTag.owner_user_id == user.id,
            PersonalNoteTag.name == name,
        )
    )
    if existing:
        return PersonalNoteTagOut.model_validate(existing)
    tag = PersonalNoteTag(owner_user_id=user.id, name=name)
    session.add(tag)
    await session.commit()
    await session.refresh(tag)
    return PersonalNoteTagOut.model_validate(tag)


@router.patch("/tags/{tag_id}", response_model=PersonalNoteTagOut)
async def update_tag(
    tag_id: uuid.UUID,
    body: PersonalNoteTagUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PersonalNoteTagOut:
    tag = await session.scalar(
        select(PersonalNoteTag).where(PersonalNoteTag.id == tag_id, PersonalNoteTag.owner_user_id == user.id)
    )
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty tag name")
    clash = await session.scalar(
        select(PersonalNoteTag).where(
            PersonalNoteTag.owner_user_id == user.id,
            PersonalNoteTag.name == name,
            PersonalNoteTag.id != tag_id,
        )
    )
    if clash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already exists")
    tag.name = name
    await session.commit()
    await session.refresh(tag)
    return PersonalNoteTagOut.model_validate(tag)


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    tag = await session.scalar(
        select(PersonalNoteTag).where(PersonalNoteTag.id == tag_id, PersonalNoteTag.owner_user_id == user.id)
    )
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    await session.delete(tag)
    await session.commit()


@router.get("", response_model=list[PersonalNoteOut])
async def list_notes(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    q: Annotated[str | None, Query(max_length=200)] = None,
    scope: Annotated[NoteScope, Query()] = "active",
    tag_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 300,
) -> list[PersonalNoteOut]:
    stmt = select(PersonalNote).where(PersonalNote.owner_user_id == user.id).options(*_NOTE_LOAD)

    if scope == "active":
        stmt = stmt.where(PersonalNote.deleted_at.is_(None), PersonalNote.is_archived.is_(False))
    elif scope == "archived":
        stmt = stmt.where(PersonalNote.deleted_at.is_(None), PersonalNote.is_archived.is_(True))
    elif scope == "trash":
        stmt = stmt.where(PersonalNote.deleted_at.is_not(None))
    # scope == all: no extra filter

    if tag_id is not None:
        stmt = stmt.join(PersonalNoteTagLink, PersonalNoteTagLink.note_id == PersonalNote.id).where(
            PersonalNoteTagLink.tag_id == tag_id
        )

    needle = (q or "").strip()
    if needle:
        pattern = f"%{needle}%"
        stmt = stmt.where(or_(PersonalNote.title.ilike(pattern), PersonalNote.content.ilike(pattern)))

    stmt = stmt.order_by(PersonalNote.is_pinned.desc(), PersonalNote.updated_at.desc()).limit(limit)
    rows = (await session.execute(stmt)).scalars().unique().all()
    return [_note_to_out(n) for n in rows]


@router.post("", response_model=PersonalNoteOut, status_code=status.HTTP_201_CREATED)
async def create_note(
    body: PersonalNoteCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PersonalNoteOut:
    tags = await _resolve_tags(session, user.id, body.tag_ids)
    note = PersonalNote(
        owner_user_id=user.id,
        title=(body.title or "").strip()[:255],
        content=body.content or "",
        color=body.color or NOTE_COLOR_DEFAULT,
        checklist_items=_normalize_checklist(body.checklist_items),
        is_pinned=bool(body.is_pinned),
        is_archived=bool(body.is_archived),
        reminder_at=body.reminder_at,
        reminder_notified_at=None,
        reminder_repeat_daily=bool(body.reminder_repeat_daily) if body.reminder_at else False,
        tags=tags,
    )
    session.add(note)
    await session.commit()
    note = await _get_owned_note(session, note.id, user.id)
    return _note_to_out(note)


@router.get("/{note_id}", response_model=PersonalNoteOut)
async def get_note(
    note_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PersonalNoteOut:
    note = await _get_owned_note(session, note_id, user.id)
    return _note_to_out(note)


@router.patch("/{note_id}", response_model=PersonalNoteOut)
async def update_note(
    note_id: uuid.UUID,
    body: PersonalNoteUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PersonalNoteOut:
    note = await _get_owned_note(session, note_id, user.id)
    if note.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Restore note from trash first")

    data = body.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        note.title = str(data["title"]).strip()[:255]
    if "content" in data and data["content"] is not None:
        note.content = str(data["content"])
    if "color" in data and data["color"] is not None:
        note.color = str(data["color"])
    if "checklist_items" in data and data["checklist_items"] is not None:
        note.checklist_items = _normalize_checklist(data["checklist_items"])
    if "is_pinned" in data and data["is_pinned"] is not None:
        note.is_pinned = bool(data["is_pinned"])
    if "is_archived" in data and data["is_archived"] is not None:
        note.is_archived = bool(data["is_archived"])
    if data.get("clear_reminder"):
        note.reminder_at = None
        note.reminder_notified_at = None
        note.reminder_repeat_daily = False
    elif "reminder_at" in data:
        note.reminder_at = data["reminder_at"]
        note.reminder_notified_at = None
        if data["reminder_at"] is None:
            note.reminder_repeat_daily = False
    if "reminder_repeat_daily" in data and data["reminder_repeat_daily"] is not None:
        note.reminder_repeat_daily = bool(data["reminder_repeat_daily"]) and note.reminder_at is not None
        if note.reminder_repeat_daily and note.reminder_at is not None:
            now = datetime.now(timezone.utc)
            at = note.reminder_at
            if at.tzinfo is None:
                at = at.replace(tzinfo=timezone.utc)
            # Уже сработавшее разовое — не слать сразу, а сдвинуть на ближайшее будущее.
            if note.reminder_notified_at is not None and at <= now:
                note.reminder_at = next_daily_reminder_at(at, now)
            note.reminder_notified_at = None
    if "tag_ids" in data and data["tag_ids"] is not None:
        note.tags = await _resolve_tags(session, user.id, data["tag_ids"])

    note.updated_at = datetime.now(timezone.utc)
    await session.commit()
    note = await _get_owned_note(session, note_id, user.id)
    return _note_to_out(note)


@router.post("/{note_id}/trash", response_model=PersonalNoteOut)
async def move_to_trash(
    note_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PersonalNoteOut:
    note = await _get_owned_note(session, note_id, user.id)
    note.deleted_at = datetime.now(timezone.utc)
    note.updated_at = datetime.now(timezone.utc)
    await session.commit()
    note = await _get_owned_note(session, note_id, user.id)
    return _note_to_out(note)


@router.post("/{note_id}/restore", response_model=PersonalNoteOut)
async def restore_note(
    note_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PersonalNoteOut:
    note = await _get_owned_note(session, note_id, user.id)
    note.deleted_at = None
    note.is_archived = False
    note.updated_at = datetime.now(timezone.utc)
    await session.commit()
    note = await _get_owned_note(session, note_id, user.id)
    return _note_to_out(note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    permanent: Annotated[bool, Query()] = False,
) -> None:
    note = await _get_owned_note(session, note_id, user.id)
    if permanent or note.deleted_at is not None:
        file_urls = [a.url for a in note.attachments]
        content_keys = stored_keys_from_text(note.content)
        await session.delete(note)
        await session.commit()
        delete_stored_files(file_urls)
        delete_stored_keys(content_keys)
        return
    note.deleted_at = datetime.now(timezone.utc)
    note.updated_at = datetime.now(timezone.utc)
    await session.commit()


@router.post("/{note_id}/attachments", response_model=PersonalNoteAttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    note_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    file: UploadFile = File(...),
) -> PersonalNoteAttachmentOut:
    note = await _get_owned_note(session, note_id, user.id, include_deleted=False)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large (max 12 MB)")
    ct = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    url = save_note_file(raw, ct, file.filename)
    att = PersonalNoteAttachment(
        note_id=note.id,
        filename=(file.filename or "file")[:512],
        content_type=ct[:128],
        size_bytes=len(raw),
        url=url,
    )
    session.add(att)
    note.updated_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(att)
    return PersonalNoteAttachmentOut.model_validate(att)


@router.delete("/{note_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    note_id: uuid.UUID,
    attachment_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    note = await _get_owned_note(session, note_id, user.id, include_deleted=False)
    att = await session.scalar(
        select(PersonalNoteAttachment).where(
            PersonalNoteAttachment.id == attachment_id,
            PersonalNoteAttachment.note_id == note.id,
        )
    )
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    await session.delete(att)
    note.updated_at = datetime.now(timezone.utc)
    await session.commit()
    delete_stored_files([att.url])
