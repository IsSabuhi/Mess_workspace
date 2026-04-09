import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.common import ORMModel
from app.schemas.position import PositionBrief


class SystemBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str


class SystemCreate(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(..., max_length=128, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    sort_order: int = 0


class SystemUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    slug: str | None = Field(None, max_length=128, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class SystemOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    user_count: int = 0


class SystemMemberOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: EmailStr
    position: PositionBrief | None = None
