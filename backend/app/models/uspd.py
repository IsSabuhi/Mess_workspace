from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UspdSite(Base):
    """Объект (как заголовок в Obsidian): # Солнечная 12."""

    __tablename__ = "uspd_sites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(128), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    system_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("systems.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    entries: Mapped[list["UspdEntry"]] = relationship(
        back_populates="site", cascade="all, delete-orphan", order_by="UspdEntry.sort_order"
    )


class UspdEntry(Base):
    """Строка таблицы: Object | Model | Ip | Cred | Comment."""

    __tablename__ = "uspd_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("uspd_sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    object_name: Mapped[str] = mapped_column("object", String(255), nullable=False, default="")
    hw_model: Mapped[str | None] = mapped_column("model", String(128), nullable=True)
    device_eui: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ip: Mapped[str | None] = mapped_column(Text, nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    section: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("uspd_entries.id", ondelete="CASCADE"), nullable=True, index=True
    )
    sim_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sim_ip: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sim_iccid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sim_pin_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    sim_puk_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    site: Mapped[UspdSite] = relationship(back_populates="entries")


class UspdHwModel(Base):
    """Справочник линеек: LT40, Simatic, IROBO."""

    __tablename__ = "uspd_hw_models"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
