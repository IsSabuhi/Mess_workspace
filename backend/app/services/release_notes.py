from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, NotificationType, ReleaseNote, User


def _clean_lines(items: list[str] | None) -> list[str]:
    out: list[str] = []
    for x in items or []:
        s = str(x).strip()
        if s:
            out.append(s)
    return out


def compose_release_body(
    *,
    body: str | None,
    summary: str | None,
    whats_new: list[str] | None,
    improvements: list[str] | None,
    notes: list[str] | None,
    links: list[str] | None,
) -> str:
    sections: list[str] = []
    summary_text = (summary or "").strip()
    if summary_text:
        sections.append(summary_text)

    def block(title: str, icon: str, lines: list[str]) -> None:
        clean = _clean_lines(lines)
        if not clean:
            return
        sections.append(f"{icon} {title}:\n" + "\n".join(f"• {line}" for line in clean))

    block("Что нового", "🆕", whats_new or [])
    block("Улучшения", "⚙️", improvements or [])
    block("Важно", "ℹ️", notes or [])
    block("Ссылки", "🔗", links or [])

    free_text = (body or "").strip()
    if free_text:
        sections.append(free_text)

    return "\n\n".join(sections).strip()


async def publish_release_note(
    session: AsyncSession,
    *,
    author: User,
    version: str,
    title: str,
    body: str | None = None,
    summary: str | None = None,
    whats_new: list[str] | None = None,
    improvements: list[str] | None = None,
    notes: list[str] | None = None,
    links: list[str] | None = None,
) -> tuple[ReleaseNote, int]:
    existing = await session.scalar(select(ReleaseNote).where(ReleaseNote.version == version))
    if existing:
        return existing, 0

    rendered_body = compose_release_body(
        body=body,
        summary=summary,
        whats_new=whats_new,
        improvements=improvements,
        notes=notes,
        links=links,
    )

    note = ReleaseNote(
        version=version.strip(),
        title=title.strip(),
        body=rendered_body,
        created_by_id=author.id,
    )
    session.add(note)
    await session.flush()

    users = (await session.execute(select(User).where(User.is_active.is_(True)))).scalars().all()
    for user in users:
        session.add(
            Notification(
                user_id=user.id,
                type=NotificationType.release_note,
                title=f"Обновление системы: {note.title}",
                body=note.body,
                release_note_id=note.id,
            )
        )
    await session.commit()
    return note, len(users)
