import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.common import ORMModel
from app.schemas.position import PositionBrief
from app.schemas.system import SystemBrief


class UserBase(BaseModel):
    email: EmailStr
    full_name: str = Field(..., max_length=255)


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128)
    is_superuser: bool = False
    role_ids: list[uuid.UUID] = []
    position_id: uuid.UUID | None = None
    birth_date: date | None = None
    system_ids: list[uuid.UUID] = []


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(None, max_length=255)
    password: str | None = Field(None, min_length=8, max_length=128)
    is_active: bool | None = None
    is_superuser: bool | None = None
    role_ids: list[uuid.UUID] | None = None
    position_id: uuid.UUID | None = None
    birth_date: date | None = None
    system_ids: list[uuid.UUID] | None = None


class RoleBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str


class UserOut(ORMModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    job_title: str | None = None
    position: PositionBrief | None = None
    birth_date: date | None = None
    is_active: bool
    is_superuser: bool
    created_at: datetime
    updated_at: datetime
    roles: list[RoleBrief] = []
    systems: list[SystemBrief] = []


class UserMeOut(UserOut):
    """Профиль текущего пользователя + коды прав для UI."""

    permissions: list[str] = []
    dashboard_preferences: dict | None = None
