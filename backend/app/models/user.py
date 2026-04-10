from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, JSON, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    job_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("positions.id", ondelete="SET NULL"), nullable=True
    )
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    dashboard_preferences: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    schedule_mode: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    position: Mapped["Position | None"] = relationship("Position", back_populates="users")
    roles: Mapped[list["UserRole"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    created_tasks: Mapped[list["Task"]] = relationship(
        "Task",
        foreign_keys="Task.creator_id",
        back_populates="creator",
    )
    assigned_tasks: Mapped[list["Task"]] = relationship(
        "Task",
        foreign_keys="Task.assignee_id",
        back_populates="assignee",
    )
    knowledge_memberships: Mapped[list["KnowledgeSpaceMember"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    login_audits: Mapped[list["LoginAudit"]] = relationship(
        "LoginAudit",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    system_memberships: Mapped[list["UserSystem"]] = relationship(
        "UserSystem",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    employee_profile: Mapped["EmployeeProfile | None"] = relationship(
        "EmployeeProfile",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification",
        back_populates="user",
        cascade="all, delete-orphan",
    )
