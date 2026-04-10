from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, NotificationType, ReleaseNote, User


async def publish_release_note(
    session: AsyncSession,
    *,
    author: User,
    version: str,
    title: str,
    body: str,
) -> tuple[ReleaseNote, int]:
    existing = await session.scalar(select(ReleaseNote).where(ReleaseNote.version == version))
    if existing:
        return existing, 0

    note = ReleaseNote(
        version=version.strip(),
        title=title.strip(),
        body=body.strip(),
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
