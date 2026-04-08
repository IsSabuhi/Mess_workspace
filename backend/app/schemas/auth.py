import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginJson(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., max_length=255)


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(None, max_length=255)
    birth_date: date | None = None
    position_id: uuid.UUID | None = None


class LoginAuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
