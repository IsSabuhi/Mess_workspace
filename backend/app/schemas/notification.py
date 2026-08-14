import uuid
from datetime import datetime

from pydantic import Field

from app.models.notification import NotificationType
from app.schemas.common import ORMModel


class NotificationOut(ORMModel):
    id: uuid.UUID
    type: NotificationType
    title: str
    body: str | None
    task_id: uuid.UUID | None
    # Доска задачи — для ссылки «К задаче» на нужный канбан
    board_id: uuid.UUID | None = None
    release_note_id: uuid.UUID | None
    personal_note_id: uuid.UUID | None = None
    created_at: datetime
    read_at: datetime | None


class NotificationUnreadCount(ORMModel):
    unread_count: int


class NotificationSettingsOut(ORMModel):
    enabled: bool
    read_days: int
    unread_days: int
    note_reminder_days: int


class NotificationSettingsPatch(ORMModel):
    enabled: bool | None = None
    read_days: int | None = Field(None, ge=7, le=3650)
    unread_days: int | None = Field(None, ge=7, le=3650)
    note_reminder_days: int | None = Field(None, ge=7, le=3650)
