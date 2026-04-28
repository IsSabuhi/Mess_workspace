import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# Блоки главной: false в home[block_id] = скрыть (по умолчанию показывать).
ALLOWED_HOME_DASHBOARD_BLOCK_IDS = frozenset(
    {
        "employee_expiry",
        "my_tasks_panel",
        "employee_focus",
        "manager_approval",
        "manager_team_overdue",
        "manager_by_system",
        "manager_analytics",
        "manager_own_tasks",
    }
)


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


class DashboardPreferencesUpdate(BaseModel):
    """Частичное обновление: для каждого ключа True = показывать (сброс скрытия), False = скрыть."""

    home: dict[str, bool] | None = None

    @field_validator("home")
    @classmethod
    def _validate_home_blocks(cls, v: dict[str, bool] | None) -> dict[str, bool] | None:
        if v is None:
            return None
        bad = set(v.keys()) - ALLOWED_HOME_DASHBOARD_BLOCK_IDS
        if bad:
            raise ValueError(f"Unknown home dashboard blocks: {sorted(bad)}")
        return v


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(None, max_length=255)
    birth_date: date | None = None
    position_id: uuid.UUID | None = None
    dashboard_preferences: DashboardPreferencesUpdate | None = None
    # Текущий пароль обязателен на бэкенде, если new_password непустой.
    current_password: str | None = Field(None, max_length=128)
    new_password: str | None = Field(None, min_length=8, max_length=128)


class LoginAuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
