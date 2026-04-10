import uuid

from pydantic import BaseModel, Field


class ScheduleDayInfo(BaseModel):
    day: int
    is_weekend: bool
    is_ru_holiday: bool


class ScheduleUserRow(BaseModel):
    user_id: uuid.UUID
    full_name: str
    email: str
    schedule_mode: str
    systems_label: str
    row_kind: str = Field(
        description="shift | five_two | fixed | manual — для подсветки строки",
    )
    cells: dict[str, str | None] = Field(
        default_factory=dict,
        description="Ключ — номер дня (1..31), значение — код или null",
    )


class ScheduleMonthOut(BaseModel):
    year: int
    month: int
    days_in_month: int
    days: list[ScheduleDayInfo]
    users: list[ScheduleUserRow]


class ScheduleCellPatch(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    user_id: uuid.UUID
    day: int = Field(..., ge=1, le=31)
    code: str | None = Field(None, max_length=32)


class ScheduleCellOut(BaseModel):
    year: int
    month: int
    user_id: uuid.UUID
    day: int
    code: str | None


class ScheduleAutofillIn(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    only_empty: bool = True


class ScheduleAutofillOut(BaseModel):
    cells_written: int


class ScheduleUserModePatch(BaseModel):
    schedule_mode: str = Field(..., max_length=32)


class ScheduleModePatchOut(BaseModel):
    user_id: uuid.UUID
    schedule_mode: str
    row_kind: str
