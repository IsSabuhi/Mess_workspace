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
    work_schedule_kind: str = Field(description="five_two | shift | two_two — из справочника сотрудника")
    gender: str = Field(description="male | female | unspecified — для 5/2 из пола считаются 8 ч или 7.2 ч")
    row_kind: str = Field(
        description="shift | five_two | fixed | manual — для подсветки строки",
    )
    cells: dict[str, str | None] = Field(
        default_factory=dict,
        description="Ключ — номер дня (1..31), значение — код или null",
    )
    hours_total: float = Field(
        description="Сумма часов за месяц: только числовые ячейки (8, 7.2, 11, 3…); буквы и коды смен не суммируются",
    )


class ScheduleGroupOut(BaseModel):
    """Блок строк расписания: сотрудники одной «ведущей» системы (минимальный sort_order среди систем сотрудника)."""

    system_id: uuid.UUID | None = None
    label: str
    users: list[ScheduleUserRow]


class ShiftStaffingNoteOut(BaseModel):
    """В системе меньше сменщиков, чем требуемый минимум на смену — правило недостижимо."""

    system_id: uuid.UUID
    system_name: str
    shift_staff_total: int
    message: str


class ShiftCoverageWarningOut(BaseModel):
    """В этот день у сменщиков системы «на работе» меньше min, «о»/«у» и пустые ячейки не считаются."""

    system_id: uuid.UUID
    system_name: str
    day: int
    working_count: int
    shift_staff_total: int
    message: str


class ScheduleMonthOut(BaseModel):
    year: int
    month: int
    days_in_month: int
    days: list[ScheduleDayInfo]
    groups: list[ScheduleGroupOut]
    min_shift_staff_required: int = Field(
        2,
        description="Минимум сменщиков «на работе» в день по каждой системе (проверка покрытия)",
    )
    shift_staffing_notes: list[ShiftStaffingNoteOut] = Field(default_factory=list)
    shift_coverage_warnings: list[ShiftCoverageWarningOut] = Field(default_factory=list)


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


class ScheduleRegenerateIn(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)


class ScheduleExcelImportOut(BaseModel):
    year: int
    month: int
    sheet_used: str
    users_matched: int
    rows_parsed: int
    cells_imported: int
    unmatched_names: list[str] = Field(default_factory=list)


class ScheduleUserModePatch(BaseModel):
    schedule_mode: str = Field(..., max_length=32)


class ScheduleModePatchOut(BaseModel):
    user_id: uuid.UUID
    schedule_mode: str
    row_kind: str
