import uuid
from datetime import datetime

from app.models.notification import NotificationType
from app.schemas.common import ORMModel


class NotificationOut(ORMModel):
    id: uuid.UUID
    type: NotificationType
    title: str
    body: str | None
    task_id: uuid.UUID | None
    release_note_id: uuid.UUID | None
    created_at: datetime
    read_at: datetime | None


class NotificationUnreadCount(ORMModel):
    unread_count: int
