import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class PositionCreate(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(..., max_length=128, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    sort_order: int = 0


class PositionUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PositionOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    sort_order: int
    is_active: bool
    created_at: datetime


class PositionBrief(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    slug: str
