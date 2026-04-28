from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String, Table, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TaskPriority(str, enum.Enum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


task_assignees_table = Table(
    "task_assignees",
    Base.metadata,
    Column("task_id", UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    board_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    column_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("kanban_columns.id", ondelete="RESTRICT"), nullable=False)
    system_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("systems.id", ondelete="RESTRICT"), nullable=False)

    creator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    priority: Mapped[TaskPriority] = mapped_column(
        Enum(TaskPriority, name="task_priority", values_callable=lambda x: [e.value for e in x]),
        default=TaskPriority.normal,
        nullable=False,
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    board: Mapped["Board"] = relationship(back_populates="tasks")
    column: Mapped["KanbanColumn"] = relationship(back_populates="tasks")
    system: Mapped["System"] = relationship(back_populates="tasks")
    assignees: Mapped[list["User"]] = relationship(
        "User",
        secondary=task_assignees_table,
        back_populates="assigned_tasks",
    )
    creator: Mapped["User | None"] = relationship(
        foreign_keys=[creator_id],
        back_populates="created_tasks",
    )
    tags: Mapped[list["TaskTag"]] = relationship(
        secondary="task_tag_links",
        back_populates="tasks",
    )
    comments: Mapped[list["TaskComment"]] = relationship(
        "TaskComment",
        back_populates="task",
        cascade="all, delete-orphan",
    )
