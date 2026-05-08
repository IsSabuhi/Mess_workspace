from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_permission
from app.models import User
from app.permissions import USERS_MANAGE
from app.schemas.common import Message
from app.schemas.release_note import ReleaseNotePublishIn
from app.services.release_notes import publish_release_note

router = APIRouter(prefix="/release-notes", tags=["release-notes"])


@router.post("/publish", response_model=Message, status_code=status.HTTP_201_CREATED)
async def publish_release(
    body: ReleaseNotePublishIn,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_permission(USERS_MANAGE))],
) -> Message:
    note, delivered = await publish_release_note(
        session,
        author=user,
        version=body.version,
        title=body.title,
        body=body.body,
        summary=body.summary,
        whats_new=body.whats_new,
        improvements=body.improvements,
        notes=body.notes,
        links=body.links,
    )
    if delivered == 0:
        return Message(detail=f"Релиз {note.version} уже опубликован ранее")
    return Message(detail=f"Релиз {note.version} опубликован, уведомлено пользователей: {delivered}")
