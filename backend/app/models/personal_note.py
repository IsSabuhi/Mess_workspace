from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User

# Предустановки цвета (как в Keep)
NOTE_COLOR_DEFAULT = "default"
NOTE_COLORS = (
    "default",
    "coral",
    "peach",
    "sand",
    "mint",
    "fog",
    "lavender",
    "slate",
)


class PersonalNote(Base):
    """Личные заметки пользователя (не связаны с базой знаний)."""

    __tablename__ = "personal_notes"
    __table_args__ = (
        Index(
            "ix_personal_notes_owner_deleted_archived_pinned_updated",
            "owner_user_id",
            "deleted_at",
            "is_archived",
            "is_pinned",
            "updated_at",
        ),
        Index("ix_personal_notes_reminder_at", "reminder_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    color: Mapped[str] = mapped_column(String(32), nullable=False, default=NOTE_COLOR_DEFAULT)
    checklist_items: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=lambda: [])
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reminder_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reminder_repeat_daily: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    owner: Mapped["User"] = relationship("User", back_populates="personal_notes")
    tags: Mapped[list["PersonalNoteTag"]] = relationship(
        "PersonalNoteTag",
        secondary="personal_note_tag_links",
        back_populates="notes",
        lazy="selectin",
    )
    attachments: Mapped[list["PersonalNoteAttachment"]] = relationship(
        "PersonalNoteAttachment",
        back_populates="note",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="PersonalNoteAttachment.created_at",
    )


class PersonalNoteTag(Base):
    __tablename__ = "personal_note_tags"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_personal_note_tags_owner_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    notes: Mapped[list[PersonalNote]] = relationship(
        "PersonalNote",
        secondary="personal_note_tag_links",
        back_populates="tags",
    )


class PersonalNoteTagLink(Base):
    __tablename__ = "personal_note_tag_links"

    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personal_notes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personal_note_tags.id", ondelete="CASCADE"),
        primary_key=True,
    )


class PersonalNoteAttachment(Base):
    __tablename__ = "personal_note_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personal_notes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    note: Mapped[PersonalNote] = relationship("PersonalNote", back_populates="attachments")
