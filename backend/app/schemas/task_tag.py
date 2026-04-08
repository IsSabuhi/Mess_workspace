import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class TaskTagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    color: str = Field(default="#38bdf8", pattern=r"^#[0-9a-fA-F]{6}$")
    sort_order: int = 0


class TaskTagUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=64)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    sort_order: int | None = None


class TaskTagOut(ORMModel):
    id: uuid.UUID
    name: str
    color: str
    sort_order: int
    created_at: datetime
    updated_at: datetime
