"""Сироты в MinIO/uploads: объекты, на которые больше нет ссылки в БД.

По умолчанию только считает. Удаление — STORAGE_GC_ENABLED=true, и только файлы
старше STORAGE_GC_MIN_AGE_DAYS (чтобы не снести картинку, которую только что
вставили в редактор и ещё не сохранили).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.knowledge import KnowledgeArticle, KnowledgeArticleRevision, KnowledgeTemplate
from app.models.personal_note import PersonalNote, PersonalNoteAttachment
from app.models.task import Task
from app.models.task_attachment import TaskAttachment
from app.models.uspd import UspdEntry, UspdSite
from app.services.file_storage import (
    delete_stored_keys,
    list_stored_objects,
    stored_key_from_url,
    stored_keys_from_text,
)

logger = logging.getLogger(__name__)


async def _referenced_keys(session: AsyncSession) -> set[str]:
    keys: set[str] = set()
    for url in (await session.scalars(select(TaskAttachment.url))).all():
        k = stored_key_from_url(url)
        if k:
            keys.add(k)
    for url in (await session.scalars(select(PersonalNoteAttachment.url))).all():
        k = stored_key_from_url(url)
        if k:
            keys.add(k)

    text_stmts = (
        select(Task.description),
        select(PersonalNote.content),
        select(KnowledgeArticle.content),
        select(KnowledgeArticleRevision.content),
        select(KnowledgeTemplate.content),
        select(UspdSite.notes),
        select(UspdEntry.comment),
    )
    for stmt in text_stmts:
        for text in (await session.scalars(stmt)).all():
            keys.update(stored_keys_from_text(text))
    return keys


async def gc_orphan_stored_files(session: AsyncSession) -> dict[str, int]:
    settings = get_settings()
    referenced = await _referenced_keys(session)
    try:
        stored = list_stored_objects()
    except Exception:
        logger.exception("Storage GC: не удалось получить список объектов")
        return {
            "stored": 0,
            "referenced": len(referenced),
            "orphans": 0,
            "orphans_young": 0,
            "deleted": 0,
        }
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=settings.storage_gc_min_age_days)

    orphans = [(key, lm) for key, lm in stored if key not in referenced]
    stale = [key for key, lm in orphans if lm <= cutoff]
    young = len(orphans) - len(stale)

    result = {
        "stored": len(stored),
        "referenced": len(referenced),
        "orphans": len(orphans),
        "orphans_young": young,
        "deleted": 0,
    }
    if not settings.storage_gc_enabled:
        logger.info(
            "Storage GC (удаление выключено): stored=%s referenced=%s orphans=%s young=%s",
            result["stored"],
            result["referenced"],
            result["orphans"],
            result["orphans_young"],
        )
        return result

    result["deleted"] = delete_stored_keys(stale)
    logger.info(
        "Storage GC: stored=%s referenced=%s orphans=%s young=%s deleted=%s",
        result["stored"],
        result["referenced"],
        result["orphans"],
        result["orphans_young"],
        result["deleted"],
    )
    return result
