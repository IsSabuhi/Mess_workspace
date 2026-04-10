from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, JSON, String, Text

from app.models.employee_work_schedule import EMPLOYEE_GENDER_UNSPECIFIED, WORK_SCHEDULE_FIVE_TWO
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EmployeeProfile(Base):
    __tablename__ = "employee_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True
    )

    exam_electrical_passed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    exam_electrical_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    exam_electrical_valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    pass_has: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pass_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pass_valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    pass_valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Периоды отпуска для графика: [{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}, ...]
    vacation_periods: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # five_two — пятидневка (автозаполнение 8 / 7.2); shift — сменщик (автозаполнение смен позже)
    work_schedule_kind: Mapped[str] = mapped_column(String(32), default=WORK_SCHEDULE_FIVE_TWO, nullable=False)
    # male / female / unspecified — при 5/2 из пола считаются 8 ч или 7.2 ч
    gender: Mapped[str] = mapped_column(String(32), default=EMPLOYEE_GENDER_UNSPECIFIED, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="employee_profile")
