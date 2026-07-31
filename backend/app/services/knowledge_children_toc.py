"""Автооглавление поддерева статей в HTML родителя (блок data-kb-children-toc)."""

from __future__ import annotations

import html
import re
import uuid
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


async def _ancestor_ids(
    session: AsyncSession,
    space_id: uuid.UUID,
    start_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """Цепочка предков от ближайшего родителя к корню (включая start_id)."""
    out: list[uuid.UUID] = []
    cur = start_id
    guard: set[uuid.UUID] = set()
    while cur is not None and cur not in guard:
        guard.add(cur)
        out.append(cur)
        row = await session.get(KnowledgeArticle, cur)
        if not row or row.space_id != space_id:
            break
        cur = row.parent_id
    return out


async def sync_parent_children_toc(
    session: AsyncSession,
    space_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    *,
    sync_ancestors: bool = True,
) -> None:
    """Обновляет TOC у parent_id; при sync_ancestors — также у всех предков выше."""
    if parent_id is None:
        return

    targets = await _ancestor_ids(session, space_id, parent_id) if sync_ancestors else [parent_id]
    if not targets:
        return

    all_articles = (
        await session.execute(
            select(KnowledgeArticle)
            .where(KnowledgeArticle.space_id == space_id)
            .order_by(KnowledgeArticle.position.asc(), KnowledgeArticle.title.asc())
        )
    ).scalars().all()
    articles = list(all_articles)

    for pid in targets:
        parent = await session.get(KnowledgeArticle, pid)
        if not parent or parent.space_id != space_id:
            continue
        toc_html = build_children_toc_html(space_id, articles, pid)
        parent.content = upsert_children_toc(parent.content, toc_html)

    await session.flush()
