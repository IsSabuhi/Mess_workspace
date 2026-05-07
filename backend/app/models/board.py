import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

BOARD_SCOPE_GLOBAL = "global"
BOARD_SCOPE_SYSTEM = "system"

BOARD_MEMBER_ROLE_VIEWER = "viewer"
BOARD_MEMBER_ROLE_EDITOR = "editor"
BOARD_MEMBER_ROLE_MANAGER = "manager"


class Board(Base):
    """Доска Kanban: общая или привязанная к системе."""

    __tablename__ = "boards"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    scope: Mapped[str] = mapped_column(String(16), default=BOARD_SCOPE_GLOBAL, nullable=False)
    system_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("systems.id", ondelete="SET NULL"), nullable=True
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    columns: Mapped[list["KanbanColumn"]] = relationship(
        back_populates="board", order_by="KanbanColumn.sort_order", cascade="all, delete-orphan"
    )
    tasks: Mapped[list["Task"]] = relationship(back_populates="board")
    members: Mapped[list["BoardMember"]] = relationship(
        "BoardMember", back_populates="board", cascade="all, delete-orphan"
    )


class BoardMember(Base):
    __tablename__ = "board_members"
    __table_args__ = (UniqueConstraint("board_id", "user_id", name="uq_board_member"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    board_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), default=BOARD_MEMBER_ROLE_VIEWER, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    board: Mapped["Board"] = relationship("Board", back_populates="members")
    user: Mapped["User"] = relationship("User")


class KanbanColumn(Base):
    __tablename__ = "kanban_columns"
    __table_args__ = (UniqueConstraint("board_id", "slug", name="uq_board_column_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    board_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_system_column: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_done_column: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )  # одна на доску — «выполнено» для отчётов; не путать с slug done
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    board: Mapped["Board"] = relationship(back_populates="columns")
    tasks: Mapped[list["Task"]] = relationship(back_populates="column")
