import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.task import TaskPriority
from app.schemas.common import ORMModel


class TaskCreate(BaseModel):
    title: str = Field(..., max_length=512)
    description: str | None = None
    column_id: uuid.UUID
    system_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    priority: TaskPriority = TaskPriority.normal
    due_at: datetime | None = None
    position: int = 0
    tag_ids: list[uuid.UUID] = Field(default_factory=list)


class TaskUpdate(BaseModel):
    title: str | None = Field(None, max_length=512)
    description: str | None = None
    column_id: uuid.UUID | None = None
    system_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    priority: TaskPriority | None = None
    due_at: datetime | None = None
    position: int | None = None
    archived_at: datetime | None = None
    tag_ids: list[uuid.UUID] | None = None


class UserMini(ORMModel):
    id: uuid.UUID
    email: str
    full_name: str


class SystemMini(ORMModel):
    id: uuid.UUID
    name: str
    slug: str


class ColumnMini(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    is_done_column: bool = False


class TagMini(ORMModel):
    id: uuid.UUID
    name: str
    color: str


class TaskOut(ORMModel):
    id: uuid.UUID
    title: str
    description: str | None
    board_id: uuid.UUID
    column_id: uuid.UUID
    system_id: uuid.UUID
    assignee_id: uuid.UUID | None
    creator_id: uuid.UUID | None
    priority: TaskPriority
    due_at: datetime | None
    position: int
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    assignee: UserMini | None = None
    creator: UserMini | None = None
    system: SystemMini | None = None
    column: ColumnMini | None = None
    tags: list[TagMini] = Field(default_factory=list)
