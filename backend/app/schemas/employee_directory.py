import uuid
from datetime import date

from pydantic import BaseModel

from app.schemas.position import PositionBrief
from app.schemas.system import SystemBrief


class EmployeeDirectoryRowOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    is_active: bool
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


class EmployeeDirectoryPatch(BaseModel):
    exam_electrical_passed: bool | None = None
    exam_electrical_date: date | None = None
    exam_electrical_valid_to: date | None = None
    pass_has: bool | None = None
    pass_number: str | None = None
    pass_valid_from: date | None = None
    pass_valid_to: date | None = None
    notes: str | None = None
