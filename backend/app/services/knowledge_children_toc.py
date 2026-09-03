"""Автооглавление поддерева статей в HTML родителя (блок data-kb-children-toc)."""

from __future__ import annotations

import html
import re
import uuid
from collections.abc import Iterable, Sequence
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.knowledge import KnowledgeArticle

_TOC_BLOCK_RE = re.compile(
    r"<nav\b[^>]*\bdata-kb-children-toc\b[^>]*>.*?</nav>",
    re.IGNORECASE | re.DOTALL,
)

_EMPTY_CONTENT = {"", "<p></p>", "<p><br></p>", "<p><br/></p>"}


def _heading_tag(depth: int) -> str:
    # h3 для прямых детей, глубже — h4..h6
    return f"h{min(3 + depth, 6)}"


def _render_subtree(
    space_id: uuid.UUID,
    nodes: list[KnowledgeArticle],
    by_parent: dict[uuid.UUID | None, list[KnowledgeArticle]],
    *,
    base: str,
    depth: int,
    lines: list[str],
) -> None:
    for child in nodes:
        href = html.escape(f"{base}/knowledge/{space_id}/{child.id}", quote=True)
        title = html.escape(child.title or "Без названия")
        tag = _heading_tag(depth)
        lines.append(f'<{tag}><a href="{href}">{title}</a></{tag}>')
        nested = by_parent.get(child.id, [])
        if nested:
            _render_subtree(space_id, nested, by_parent, base=base, depth=depth + 1, lines=lines)


def build_children_toc_html(
    space_id: uuid.UUID,
    all_articles: list[KnowledgeArticle],
    parent_id: uuid.UUID,
    *,
    public_base: str | None = None,
) -> str:
    by_parent: dict[uuid.UUID | None, list[KnowledgeArticle]] = defaultdict(list)
    for row in all_articles:
        by_parent[row.parent_id].append(row)
    for rows in by_parent.values():
        # Как на фронте: одинаковый position у всех соседей → А…Я; иначе ручной порядок.
        positions = {a.position for a in rows}
        if len(positions) <= 1:
            rows.sort(key=lambda a: (a.title or "").lower())
        else:
            rows.sort(key=lambda a: (a.position, (a.title or "").lower()))

    roots = by_parent.get(parent_id, [])
    if not roots:
        return ""

    base = (public_base if public_base is not None else get_settings().public_app_base).rstrip("/")
    lines = [
        '<nav data-kb-children-toc class="kb-children-toc">',
        "<h2>Содержание</h2>",
    ]
    _render_subtree(space_id, roots, by_parent, base=base, depth=0, lines=lines)
    lines.append("</nav>")
    return "\n".join(lines)


def upsert_children_toc(content: str | None, toc_html: str) -> str | None:
    raw = content or ""
    if not toc_html:
        cleaned = _TOC_BLOCK_RE.sub("", raw).strip()
        if cleaned in _EMPTY_CONTENT:
            return None
        return cleaned or None

    if _TOC_BLOCK_RE.search(raw):
        return _TOC_BLOCK_RE.sub(toc_html, raw, count=1)

    stripped = raw.strip()
    if stripped in _EMPTY_CONTENT:
        return toc_html
    return f"{stripped}\n{toc_html}"


def _ancestor_ids_from_articles(
    articles: Sequence[KnowledgeArticle],
    space_id: uuid.UUID,
    start_id: uuid.UUID | None,
    *,
    sync_ancestors: bool,
) -> list[uuid.UUID]:
    if start_id is None:
        return []
    if not sync_ancestors:
        return [start_id]
    by_id = {a.id: a for a in articles if a.space_id == space_id}
    out: list[uuid.UUID] = []
    cur: uuid.UUID | None = start_id
    guard: set[uuid.UUID] = set()
    while cur is not None and cur not in guard:
        guard.add(cur)
        out.append(cur)
        row = by_id.get(cur)
        if row is None:
            break
        cur = row.parent_id
    return out


async def _load_space_articles(session: AsyncSession, space_id: uuid.UUID) -> list[KnowledgeArticle]:
    return list(
        (
            await session.execute(
                select(KnowledgeArticle)
                .where(KnowledgeArticle.space_id == space_id)
                .order_by(KnowledgeArticle.position.asc(), KnowledgeArticle.title.asc())
            )
        ).scalars().all()
    )


async def sync_parent_children_toc(
    session: AsyncSession,
    space_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    *,
    sync_ancestors: bool = True,
    articles: Sequence[KnowledgeArticle] | None = None,
) -> None:
    """Обновляет TOC у parent_id; при sync_ancestors — также у всех предков выше."""
    if parent_id is None:
        return
    await sync_parents_children_toc(
        session,
        space_id,
        [parent_id],
        sync_ancestors=sync_ancestors,
        articles=articles,
    )


async def sync_parents_children_toc(
    session: AsyncSession,
    space_id: uuid.UUID,
    parent_ids: Iterable[uuid.UUID | None],
    *,
    sync_ancestors: bool = True,
    articles: Sequence[KnowledgeArticle] | None = None,
) -> None:
    """Один SELECT статей пространства на пачку родителей (импорт Obsidian)."""
    ids = [pid for pid in parent_ids if pid is not None]
    if not ids:
        return

    rows = list(articles) if articles is not None else await _load_space_articles(session, space_id)
    targets: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for pid in ids:
        for aid in _ancestor_ids_from_articles(rows, space_id, pid, sync_ancestors=sync_ancestors):
            if aid not in seen:
                seen.add(aid)
                targets.append(aid)
    if not targets:
        return

    by_id = {a.id: a for a in rows}
    missing = [tid for tid in targets if tid not in by_id]
    if missing:
        extra = (
            await session.execute(select(KnowledgeArticle).where(KnowledgeArticle.id.in_(missing)))
        ).scalars().all()
        for row in extra:
            if row.space_id == space_id:
                rows.append(row)
                by_id[row.id] = row

    for pid in targets:
        parent = by_id.get(pid)
        if not parent or parent.space_id != space_id:
            continue
        toc_html = build_children_toc_html(space_id, rows, pid)
        parent.content = upsert_children_toc(parent.content, toc_html)

    await session.flush()
