import uuid
from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import ORMModel


class SystemBackupOut(ORMModel):
    id: uuid.UUID
    filename: str
    size_bytes: int | None
    status: str
    error_message: str | None
    created_by_id: uuid.UUID | None
    created_by_name: str | None = None
    created_at: datetime
    finished_at: datetime | None


class BackupSettingsOut(ORMModel):
    enabled: bool
    retention_days: int
    hour: int
    minute: int
    run_at: str
    timezone: str
    keep_max: int
    latest_size_bytes: int | None = None
    estimated_bytes: int | None = None


class BackupSettingsPatch(ORMModel):
    enabled: bool | None = None
    retention_days: int | None = Field(None, ge=1, le=365)
    hour: int | None = Field(None, ge=0, le=23)
    minute: int | None = Field(None, ge=0, le=59)
    run_at: str | None = None

    @field_validator("run_at")
    @classmethod
    def _run_at_hhmm(cls, value: str | None) -> str | None:
        if value is None or not str(value).strip():
            return None
        raw = str(value).strip()
        parts = raw.split(":")
        if len(parts) != 2:
            raise ValueError("Время в формате ЧЧ:ММ, например 07:00 или 19:30")
        try:
            hour = int(parts[0])
            minute = int(parts[1])
        except ValueError as exc:
            raise ValueError("Время в формате ЧЧ:ММ, например 07:00 или 19:30") from exc
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise ValueError("Часы 00–23, минуты 00–59")
        return f"{hour:02d}:{minute:02d}"
