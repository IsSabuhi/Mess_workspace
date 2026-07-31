"""Схемы ответа импорта задачника Excel."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class TaskExcelImportRowDetail(BaseModel):
    row: int
    title: str
    status: str  # created | skipped | warning
    message: str | None = None
    task_id: uuid.UUID | None = None


class TaskExcelImportOut(BaseModel):
    sheet_name: str
    system_id: uuid.UUID
    system_name: str
    board_id: uuid.UUID
    created: int = 0
    skipped: int = 0
    warnings: int = 0
    rows: list[TaskExcelImportRowDetail] = Field(default_factory=list)


class TaskExcelImportFileResult(BaseModel):
    filename: str
    ok: bool
    error: str | None = None
    result: TaskExcelImportOut | None = None


class TaskExcelImportBatchOut(BaseModel):
    files_total: int = 0
    files_ok: int = 0
    files_failed: int = 0
    created_total: int = 0
    warnings_total: int = 0
    files: list[TaskExcelImportFileResult] = Field(default_factory=list)
