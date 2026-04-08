import uuid

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class PermissionOut(ORMModel):
    id: uuid.UUID
    code: str
    description: str | None


class RoleCreate(BaseModel):
    name: str = Field(..., max_length=128)
    slug: str = Field(..., max_length=128, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    permission_ids: list[uuid.UUID] = []


class RoleUpdate(BaseModel):
    name: str | None = Field(None, max_length=128)
    description: str | None = None
    permission_ids: list[uuid.UUID] | None = None


class RoleOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    is_system: bool
    user_count: int = 0
    permissions: list[PermissionOut] = []
