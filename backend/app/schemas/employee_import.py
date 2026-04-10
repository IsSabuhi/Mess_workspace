import uuid
from enum import StrEnum

from pydantic import BaseModel, Field


class EmployeeImportRowStatus(StrEnum):
    created = "created"
    skipped_duplicate_file = "skipped_duplicate_file"
    skipped_exists = "skipped_exists"
    skipped_invalid = "skipped_invalid"


class EmployeeImportRowDetail(BaseModel):
    sheet_row: int = Field(..., description="Номер строки в Excel (1-based)")
    login: str | None = None
    status: EmployeeImportRowStatus
    user_id: uuid.UUID | None = None
    email: str | None = None
    message: str | None = None


class EmployeeImportOut(BaseModel):
    """Результат массового импорта из Excel (УчетнаяЗапись, ФИО, Должность)."""

    created: int
    skipped: int
    rows: list[EmployeeImportRowDetail]
