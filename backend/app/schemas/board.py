import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class KanbanColumnCreate(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(..., max_length=64, pattern=r"^[a-z0-9_]+$")
    sort_order: int = 0
    is_done_column: bool = False


class KanbanColumnUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    sort_order: int | None = None
    is_done_column: bool | None = None


class KanbanColumnOut(ORMModel):
    id: uuid.UUID
    board_id: uuid.UUID
    name: str
    slug: str
    sort_order: int
    is_system_column: bool
    is_done_column: bool
    created_at: datetime


class BoardOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    is_default: bool
    created_at: datetime
    columns: list[KanbanColumnOut] = []
