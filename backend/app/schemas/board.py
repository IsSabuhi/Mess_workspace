import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

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
    scope: str
    system_id: uuid.UUID | None = None
    system_name: str | None = None
    is_default: bool
    is_archived: bool = False
    created_at: datetime
    columns: list[KanbanColumnOut] = []


class BoardMemberOut(ORMModel):
    id: uuid.UUID
    board_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    created_at: datetime


class BoardCreate(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(..., max_length=128, pattern=r"^[a-z0-9_\-]+$")
    scope: str = Field("global", max_length=16, description="global | system")
    system_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def validate_scope_system(self) -> "BoardCreate":
        if self.scope not in {"global", "system"}:
            raise ValueError("scope must be global or system")
        if self.scope == "system" and self.system_id is None:
            raise ValueError("system_id required for scope=system")
        if self.scope == "global":
            self.system_id = None
        return self


class BoardUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)


class BoardMemberSetItem(BaseModel):
    user_id: uuid.UUID
    role: str = Field("viewer", max_length=16, description="viewer | editor | manager")

    @model_validator(mode="after")
    def validate_role(self) -> "BoardMemberSetItem":
        if self.role not in {"viewer", "editor", "manager"}:
            raise ValueError("role must be viewer, editor or manager")
        return self


class BoardMembersReplace(BaseModel):
    members: list[BoardMemberSetItem] = Field(default_factory=list, max_length=2000)
