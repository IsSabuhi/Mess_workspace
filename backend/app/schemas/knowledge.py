import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.knowledge import ArticleStatus, SpaceMemberRole
from app.schemas.common import ORMModel


class KnowledgeSpaceCreate(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(..., max_length=128, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    system_id: uuid.UUID | None = None


class KnowledgeSpaceUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    description: str | None = None
    system_id: uuid.UUID | None = None


class KnowledgeSpaceOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    system_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    can_edit: bool = False
    can_manage_members: bool = False


class SpaceMemberIn(BaseModel):
    user_id: uuid.UUID
    role: SpaceMemberRole = SpaceMemberRole.viewer


class SpaceMemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    role: SpaceMemberRole


class SpaceMemberUpdate(BaseModel):
    role: SpaceMemberRole


class KnowledgeDirectoryUser(BaseModel):
    """Краткая карточка пользователя для выдачи доступа к пространству БЗ."""

    id: uuid.UUID
    email: str
    full_name: str


class KnowledgeArticleCreate(BaseModel):
    title: str = Field(..., max_length=512)
    slug: str = Field(..., max_length=256, pattern=r"^[a-z0-9-]+$")
    content: str | None = None
    parent_id: uuid.UUID | None = None
    status: ArticleStatus = ArticleStatus.draft
    position: int = 0


class KnowledgeArticleUpdate(BaseModel):
    title: str | None = Field(None, max_length=512)
    content: str | None = None
    parent_id: uuid.UUID | None = None
    status: ArticleStatus | None = None
    position: int | None = None


class KnowledgeArticleOut(ORMModel):
    id: uuid.UUID
    space_id: uuid.UUID
    title: str
    slug: str
    content: str | None
    parent_id: uuid.UUID | None
    status: ArticleStatus
    position: int
    created_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
