import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.models.personal_note import NOTE_COLORS
from app.schemas.common import ORMModel


class ChecklistItemIn(BaseModel):
    id: str = Field(..., max_length=64)
    text: str = Field("", max_length=2000)
    done: bool = False


class ChecklistItemOut(BaseModel):
    id: str
    text: str
    done: bool


class PersonalNoteTagOut(ORMModel):
    id: uuid.UUID
    name: str
    created_at: datetime


class PersonalNoteAttachmentOut(ORMModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    url: str
    created_at: datetime


class PersonalNoteOut(ORMModel):
    id: uuid.UUID
    title: str
    content: str
    color: str
    checklist_items: list[ChecklistItemOut] = []
    is_pinned: bool
    is_archived: bool
    reminder_at: datetime | None = None
    reminder_repeat_daily: bool = False
    deleted_at: datetime | None = None
    tags: list[PersonalNoteTagOut] = []
    attachments: list[PersonalNoteAttachmentOut] = []
    created_at: datetime
    updated_at: datetime


class PersonalNoteCreate(BaseModel):
    title: str = Field("", max_length=255)
    content: str = ""
    color: str = "default"
    checklist_items: list[ChecklistItemIn] = []
    is_pinned: bool = False
    is_archived: bool = False
    reminder_at: datetime | None = None
    reminder_repeat_daily: bool = False
    tag_ids: list[uuid.UUID] = []

    @field_validator("color")
    @classmethod
    def _color(cls, v: str) -> str:
        c = (v or "default").strip().lower()
        if c not in NOTE_COLORS:
            raise ValueError(f"Invalid color: {c}")
        return c


class PersonalNoteUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    content: str | None = None
    color: str | None = None
    checklist_items: list[ChecklistItemIn] | None = None
    is_pinned: bool | None = None
    is_archived: bool | None = None
    reminder_at: datetime | None = None
    reminder_repeat_daily: bool | None = None
    clear_reminder: bool | None = None
    tag_ids: list[uuid.UUID] | None = None

    @field_validator("color")
    @classmethod
    def _color(cls, v: str | None) -> str | None:
        if v is None:
            return None
        c = v.strip().lower()
        if c not in NOTE_COLORS:
            raise ValueError(f"Invalid color: {c}")
        return c


class PersonalNoteTagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


class PersonalNoteTagUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


NoteScope = Literal["active", "archived", "trash", "all"]
