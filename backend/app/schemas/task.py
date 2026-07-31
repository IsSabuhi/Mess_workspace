import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.models.task import TaskPriority
from app.schemas.common import ORMModel


class ChecklistItem(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    text: str = Field(..., min_length=1, max_length=500)
    done: bool = False


class TaskAttachmentOut(ORMModel):
    id: uuid.UUID
    task_id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    url: str
    uploaded_by_id: uuid.UUID | None
    created_at: datetime
    uploaded_by: "UserMini | None" = None


class TaskCreate(BaseModel):
    title: str = Field(..., max_length=512)
    description: str | None = None
    board_id: uuid.UUID | None = None
    column_id: uuid.UUID
    system_id: uuid.UUID | None = None
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)
    priority: TaskPriority = TaskPriority.normal
    due_at: datetime | None = None
    estimate_hours: Decimal | None = None
    checklist: list[ChecklistItem] = Field(default_factory=list)
    position: int = 0
    tag_ids: list[uuid.UUID] = Field(default_factory=list)

    @field_validator("estimate_hours")
    @classmethod
    def _estimate_non_negative(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        if v < 0:
            raise ValueError("estimate_hours must be >= 0")
        if v > Decimal("99999.99"):
            raise ValueError("estimate_hours too large")
        return v


class TaskUpdate(BaseModel):
    title: str | None = Field(None, max_length=512)
    description: str | None = None
    column_id: uuid.UUID | None = None
    system_id: uuid.UUID | None = None
    assignee_ids: list[uuid.UUID] | None = None
    priority: TaskPriority | None = None
    due_at: datetime | None = None
    estimate_hours: Decimal | None = None
    checklist: list[ChecklistItem] | None = None
    position: int | None = None
    archived_at: datetime | None = None
    tag_ids: list[uuid.UUID] | None = None

    @field_validator("estimate_hours")
    @classmethod
    def _estimate_non_negative(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        if v < 0:
            raise ValueError("estimate_hours must be >= 0")
        if v > Decimal("99999.99"):
            raise ValueError("estimate_hours too large")
        return v


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
    creator_id: uuid.UUID | None
    priority: TaskPriority
    due_at: datetime | None
    estimate_hours: Decimal | None = None
    checklist: list[ChecklistItem] = Field(default_factory=list)
    position: int
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    assignees: list[UserMini] = Field(default_factory=list)
    creator: UserMini | None = None
    system: SystemMini | None = None
    column: ColumnMini | None = None
    tags: list[TagMini] = Field(default_factory=list)
    attachments: list[TaskAttachmentOut] = Field(default_factory=list)
    comments_count: int = Field(default=0, description="Число комментариев к задаче")


class TaskCommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class TaskCommentUpdate(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class TaskCommentOut(ORMModel):
    id: uuid.UUID
    task_id: uuid.UUID
    author_id: uuid.UUID | None
    body: str
    created_at: datetime
    updated_at: datetime
    author: UserMini | None = None


class TaskAnalyticsKpiOut(BaseModel):
    total: int
    active: int
    overdue: int
    due_soon: int
    unassigned: int
    high_priority: int


class TaskAnalyticsBucketOut(BaseModel):
    key: str
    label: str
    total: int
    active: int
    overdue: int


class TaskDueTrendPointOut(BaseModel):
    date: str
    due_total: int
    overdue_total: int


class TaskAnalyticsOut(BaseModel):
    kpi: TaskAnalyticsKpiOut
    by_system: list[TaskAnalyticsBucketOut] = Field(default_factory=list)
    by_column: list[TaskAnalyticsBucketOut] = Field(default_factory=list)
    by_assignee: list[TaskAnalyticsBucketOut] = Field(default_factory=list)
    due_trend: list[TaskDueTrendPointOut] = Field(default_factory=list)


TaskAttachmentOut.model_rebuild()
