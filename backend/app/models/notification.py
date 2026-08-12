from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class NotificationType(str, enum.Enum):
    task_due_3_days = "task_due_3_days"
    task_overdue = "task_overdue"
    task_mention = "task_mention"
    release_note = "release_note"
    employee_pass_due_3_days = "employee_pass_due_3_days"
    employee_pass_overdue = "employee_pass_overdue"
    employee_exam_electrical_due_3_days = "employee_exam_electrical_due_3_days"
    employee_exam_electrical_overdue = "employee_exam_electrical_overdue"
    note_reminder = "note_reminder"


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        # Для дедлайнов по задаче хотим только одну запись на тип/задачу/пользователя.
        UniqueConstraint("user_id", "type", "task_id", name="uq_notifications_user_type_task"),
        # Для релиз-нотов — тоже одна запись на пользователя.
        UniqueConstraint("user_id", "type", "release_note_id", name="uq_notifications_user_type_release_note"),
        # Срок пропуска/экзамена — одна запись на получателя, тип и сотрудника.
        UniqueConstraint("user_id", "type", "employee_user_id", name="uq_notifications_user_type_employee"),
        UniqueConstraint("user_id", "type", "personal_note_id", name="uq_notifications_user_type_personal_note"),
        Index("ix_notifications_user_created_at", "user_id", "created_at"),
        Index("ix_notifications_user_read_at", "user_id", "read_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[NotificationType] = mapped_column(
        Enum(NotificationType, name="notification_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=True,
    )
    release_note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("release_notes.id", ondelete="CASCADE"),
        nullable=True,
    )
    employee_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    personal_note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("personal_notes.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="notifications", foreign_keys=[user_id])
    task: Mapped["Task | None"] = relationship("Task")
    release_note: Mapped["ReleaseNote | None"] = relationship("ReleaseNote")
    employee: Mapped["User | None"] = relationship("User", foreign_keys=[employee_user_id])
    personal_note: Mapped["PersonalNote | None"] = relationship("PersonalNote")
