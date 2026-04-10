"""Автозаполнение ячеек расписания с учётом режима и отпусков (о / у)."""

from __future__ import annotations

import calendar
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import ScheduleEntry, User
from app.models.schedule_mode import ScheduleMode
from app.services.ru_calendar import is_weekend, ru_holiday_dates

VACATION_CODES = frozenset({"о", "у"})


def _norm_code(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = raw.strip()
    return s if s else None


def _is_vacation(code: str | None) -> bool:
    c = _norm_code(code)
    if not c:
        return False
    return c.lower() in VACATION_CODES


def _is_shift_token_11_3_8(code: str | None) -> bool:
    c = _norm_code(code)
    if not c:
        return False
    return c in ("11", "3", "8")


def _autofill_row_five_two(
    year: int,
    month: int,
    dim: int,
    holiday_days: set[int],
    existing: dict[int, str | None],
    *,
    only_empty: bool,
) -> dict[int, str]:
    out: dict[int, str] = {}
    for d in range(1, dim + 1):
        cur = existing.get(d)
        if _is_vacation(cur):
            continue
        if only_empty and _norm_code(cur) is not None:
            continue
        if is_weekend(year, month, d) or d in holiday_days:
            out[d] = "о"
        else:
            out[d] = "8"
    return out


def _autofill_row_everyday_72(
    dim: int,
    existing: dict[int, str | None],
    *,
    only_empty: bool,
) -> dict[int, str]:
    out: dict[int, str] = {}
    for d in range(1, dim + 1):
        cur = existing.get(d)
        if _is_vacation(cur):
            continue
        if only_empty and _norm_code(cur) is not None:
            continue
        out[d] = "7.2"
    return out


def _autofill_shift_11_3_8(
    dim: int,
    existing: dict[int, str | None],
    *,
    only_empty: bool,
) -> dict[int, str]:
    seq = ("11", "3", "8")
    out: dict[int, str] = {}
    idx = 0
    for d in range(1, dim + 1):
        cur = existing.get(d)
        if _is_vacation(cur):
            continue
        if only_empty and _norm_code(cur) is not None:
            if _is_shift_token_11_3_8(cur):
                idx += 1
            continue
        code = seq[idx % 3]
        out[d] = code
        idx += 1
    return out


def _autofill_shift_11d_11v(
    dim: int,
    existing: dict[int, str | None],
    *,
    only_empty: bool,
) -> dict[int, str]:
    out: dict[int, str] = {}
    idx = 0
    for d in range(1, dim + 1):
        cur = existing.get(d)
        if _is_vacation(cur):
            continue
        if only_empty and _norm_code(cur) is not None:
            c = _norm_code(cur)
            if c in ("11д", "11в"):
                idx += 1
            continue
        code = "11д" if idx % 2 == 0 else "11в"
        out[d] = code
        idx += 1
    return out


async def run_schedule_autofill(
    session: AsyncSession,
    *,
    year: int,
    month: int,
    only_empty: bool,
    editor_id: uuid.UUID,
) -> int:
    """Заполняет ячейки по режиму пользователя. Возвращает число записанных ячеек."""
    dim = calendar.monthrange(year, month)[1]
    holiday_days = ru_holiday_dates(year, month)

    users = (await session.execute(select(User).where(User.is_active.is_(True)))).scalars().unique().all()

    entries = (
        await session.execute(
            select(ScheduleEntry).where(ScheduleEntry.year == year, ScheduleEntry.month == month)
        )
    ).scalars().all()

    by_user: dict[uuid.UUID, dict[int, str | None]] = {}
    for e in entries:
        if e.day < 1 or e.day > dim:
            continue
        by_user.setdefault(e.user_id, {})[e.day] = e.code

    written = 0
    for u in users:
        try:
            mode = ScheduleMode(u.schedule_mode)
        except ValueError:
            mode = ScheduleMode.manual

        if mode == ScheduleMode.manual:
            continue

        existing = by_user.get(u.id, {})
        full_existing: dict[int, str | None] = {d: existing.get(d) for d in range(1, dim + 1)}

        if mode == ScheduleMode.five_two:
            new_cells = _autofill_row_five_two(year, month, dim, holiday_days, full_existing, only_empty=only_empty)
        elif mode == ScheduleMode.everyday_72:
            new_cells = _autofill_row_everyday_72(dim, full_existing, only_empty=only_empty)
        elif mode == ScheduleMode.shift_11_3_8:
            new_cells = _autofill_shift_11_3_8(dim, full_existing, only_empty=only_empty)
        elif mode == ScheduleMode.shift_11d_11v:
            new_cells = _autofill_shift_11d_11v(dim, full_existing, only_empty=only_empty)
        else:
            continue

        for day, code in new_cells.items():
            stmt = select(ScheduleEntry).where(
                ScheduleEntry.year == year,
                ScheduleEntry.month == month,
                ScheduleEntry.user_id == u.id,
                ScheduleEntry.day == day,
            )
            row = (await session.execute(stmt)).scalar_one_or_none()
            if row:
                row.code = code
                row.updated_by_id = editor_id
            else:
                session.add(
                    ScheduleEntry(
                        year=year,
                        month=month,
                        day=day,
                        user_id=u.id,
                        code=code,
                        updated_by_id=editor_id,
                    )
                )
            written += 1

    await session.commit()
    return written
