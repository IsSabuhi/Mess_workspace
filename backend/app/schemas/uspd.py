import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import ORMModel


class UspdEntryOut(ORMModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None = None
    object: str
    model: str | None = None
    device_eui: str | None = None
    ip: str | None
    username: str | None
    password: str = ""
    comment: str | None
    section: str | None = None
    sim_number: str | None = None
    sim_ip: str | None = None
    sim_iccid: str | None = None
    sim_pin: str = ""
    sim_puk: str = ""
    sort_order: int = 0


class UspdSiteOut(ORMModel):
    id: uuid.UUID
    name: str
    notes: str | None
    system_id: uuid.UUID | None = None
    entries: list[UspdEntryOut]
    created_at: datetime
    updated_at: datetime


class UspdSiteWrite(ORMModel):
    name: str = Field(min_length=1, max_length=255)
    notes: str | None = Field(None, max_length=50_000)


class UspdSiteUpdate(ORMModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    notes: str | None = Field(None, max_length=50_000)


class UspdEntryWrite(ORMModel):
    object: str | None = None
    model: str | None = None
    device_eui: str | None = None
    ip: str | None = None
    username: str | None = None
    password: str | None = None
    comment: str | None = None
    section: str | None = None
    parent_id: uuid.UUID | None = None
    sim_number: str | None = None
    sim_ip: str | None = None
    sim_iccid: str | None = None
    sim_pin: str | None = None
    sim_puk: str | None = None
    sort_order: int | None = None


class UspdHwModelOut(ORMModel):
    id: uuid.UUID
    name: str
    created_at: datetime


class UspdHwModelWrite(ORMModel):
    name: str = Field(min_length=1, max_length=128)


class UspdObsidianFileResult(ORMModel):
    filename: str
    site_name: str | None = None
    created: bool = False
    skipped: bool = False
    entries: int = 0
    error: str | None = None


class UspdObsidianImportOut(ORMModel):
    created: int
    skipped: int
    failed: int
    files: list[UspdObsidianFileResult]


class UspdSimExcelRowResult(ORMModel):
    sheet_row: int
    phone: str | None = None
    ip: str | None = None
    site_name: str | None = None
    status: str
    error: str | None = None


class UspdSimExcelImportOut(ORMModel):
    created: int
    skipped: int
    unmatched: int
    empty: int
    rows: list[UspdSimExcelRowResult]
