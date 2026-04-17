import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.position import PositionBrief
from app.schemas.system import SystemBrief


class VacationPeriodOut(BaseModel):
    start: date
    end: date


class VacationPeriodIn(BaseModel):
    start: date
    end: date

    @model_validator(mode="after")
    def check_range(self) -> "VacationPeriodIn":
        if self.end < self.start:
            raise ValueError("end must be >= start")
        return self


class EmployeeDirectoryRowOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    is_active: bool
    birth_date: date | None = None
    position: PositionBrief | None = None
    systems: list[SystemBrief] = []

    exam_electrical_passed: bool = False
    exam_electrical_date: date | None = None
    exam_electrical_valid_to: date | None = None

    pass_has: bool = False
    pass_number: str | None = None
    pass_valid_from: date | None = None
    pass_valid_to: date | None = None

    notes: str | None = None
    vacation_periods: list[VacationPeriodOut] = Field(default_factory=list)
    work_schedule_kind: Literal["five_two", "shift", "two_two"] = "five_two"
    gender: Literal["male", "female", "unspecified"] = "unspecified"


class EmployeeDirectoryPatch(BaseModel):
    birth_date: date | None = None
    position_id: uuid.UUID | None = None
    system_ids: list[uuid.UUID] | None = Field(None, description="Полная замена списка производственных систем.")

    exam_electrical_passed: bool | None = None
    exam_electrical_date: date | None = None
    exam_electrical_valid_to: date | None = None
    pass_has: bool | None = None
    pass_number: str | None = None
    pass_valid_from: date | None = None
    pass_valid_to: date | None = None
    notes: str | None = None
    vacation_periods: list[VacationPeriodIn] | None = Field(
        None,
        description="Полная замена списка периодов отпуска; до 24 интервалов. Учитывается при автозаполнении графика.",
    )
    work_schedule_kind: Literal["five_two", "shift", "two_two"] | None = None
    gender: Literal["male", "female", "unspecified"] | None = None

    @model_validator(mode="after")
    def limit_vacation_periods(self) -> "EmployeeDirectoryPatch":
        if self.vacation_periods is not None and len(self.vacation_periods) > 24:
            raise ValueError("At most 24 vacation periods")
        return self


class EmployeeDirectoryBulkProfilePatch(BaseModel):
    """Только кадровые поля для массового обновления."""

    work_schedule_kind: Literal["five_two", "shift", "two_two"] | None = None
    gender: Literal["male", "female", "unspecified"] | None = None
    position_id: uuid.UUID | None = None
    system_ids: list[uuid.UUID] | None = Field(None, description="Полная замена списка производственных систем.")


class EmployeeDirectoryBulkProfileIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=2000)
    patch: EmployeeDirectoryBulkProfilePatch

    @model_validator(mode="after")
    def patch_not_empty(self) -> "EmployeeDirectoryBulkProfileIn":
        data = self.patch.model_dump(exclude_unset=True)
        if not data:
            raise ValueError("В patch нужно указать хотя бы одно поле")
        return self


class EmployeeDirectoryBulkProfileOut(BaseModel):
    updated: int
