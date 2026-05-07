import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class AuditEventOut(ORMModel):
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID | None = None
    action: str
    actor_user_id: uuid.UUID | None = None
    actor_name: str | None = None
    details_json: str | None = None
    created_at: datetime


class AuditSettingsOut(BaseModel):
    enabled: bool
    retention_days: int


class AuditSettingsPatch(BaseModel):
    enabled: bool | None = None
    retention_days: int | None = Field(None, ge=7, le=3650)
