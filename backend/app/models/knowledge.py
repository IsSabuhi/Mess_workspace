from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SpaceMemberRole(str, enum.Enum):
    viewer = "viewer"
    editor = "editor"
    admin = "admin"


class ArticleStatus(str, enum.Enum):
    draft = "draft"
    published = "published"


class KnowledgeSpace(Base):
    """Пространство БЗ: привязка к системе опциональна; доступ через members + суперпользователь."""

    __tablename__ = "knowledge_spaces"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    system_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("systems.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    system: Mapped["System | None"] = relationship(back_populates="knowledge_spaces")
    members: Mapped[list[KnowledgeSpaceMember]] = relationship(back_populates="space", cascade="all, delete-orphan")
    articles: Mapped[list[KnowledgeArticle]] = relationship(back_populates="space", cascade="all, delete-orphan")


class KnowledgeSpaceMember(Base):
    __tablename__ = "knowledge_space_members"
    __table_args__ = (UniqueConstraint("space_id", "user_id", name="uq_space_member"),)

    space_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("knowledge_spaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[SpaceMemberRole] = mapped_column(
        Enum(SpaceMemberRole, name="space_member_role", values_callable=lambda x: [e.value for e in x]),
        default=SpaceMemberRole.viewer,
        nullable=False,
    )

    space: Mapped[KnowledgeSpace] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="knowledge_memberships")


class KnowledgeArticle(Base):
    __tablename__ = "knowledge_articles"
    __table_args__ = (UniqueConstraint("space_id", "slug", name="uq_article_slug_per_space"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    space_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("knowledge_spaces.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    slug: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_articles.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[ArticleStatus] = mapped_column(
        Enum(ArticleStatus, name="article_status", values_callable=lambda x: [e.value for e in x]),
        default=ArticleStatus.draft,
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    space: Mapped["KnowledgeSpace"] = relationship(back_populates="articles")


class KnowledgeArticleRevision(Base):
    __tablename__ = "knowledge_article_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    article_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_articles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    space_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_spaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ArticleStatus] = mapped_column(
        Enum(ArticleStatus, name="article_status", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    saved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


class KnowledgeTemplate(Base):
    __tablename__ = "knowledge_templates"
    __table_args__ = (UniqueConstraint("space_id", "slug", name="uq_knowledge_template_slug_per_space"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    space_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_spaces.id", ondelete="CASCADE"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


