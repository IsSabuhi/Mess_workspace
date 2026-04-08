import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(BaseModel):
    detail: str


class IdOut(BaseModel):
    id: uuid.UUID


class Timestamps(BaseModel):
    created_at: datetime
    updated_at: datetime | None = None
