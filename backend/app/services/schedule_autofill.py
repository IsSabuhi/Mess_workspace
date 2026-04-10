"""Автозаполнение графика по данным справочника: 5/2 (8 / 7.2), праздники РФ — «о», сб/вс — пусто; сменщик — пока только отпуск «о»."""

from __future__ import annotations

import calendar
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import ScheduleEntry, User
from app.models.employee_work_schedule import (
    EMPLOYEE_GENDER_FEMALE,
    WORK_SCHEDULE_FIVE_TWO,
    WORK_SCHEDULE_SHIFT,
    normalize_profile_schedule,
)
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


def _parse_iso_date(v) -> date | None:
    if v is None:
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def vacation_days_in_month(year: int, month: int, periods: list | None) -> set[int]:
    if not periods:
        return set()
    dim = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, dim)
    out: set[int] = set()
    for p in periods:
        if not isinstance(p, dict):
            continue
        s = _parse_iso_date(p.get("start"))
        e = _parse_iso_date(p.get("end"))
        if s is None or e is None:
            continue
        cur = max(s, month_start)
        end = min(e, month_end)
        while cur <= end:
            if cur.year == year and cur.month == month:
                out.add(cur.day)
            cur += timedelta(days=1)
    return out


def _apply_profile_vacation_to_existing(
    year: int,
    month: int,
    dim: int,
    existing: dict[int, str | None],
    vacation_days: set[int],
    *,
    only_empty: bool,
) -> set[int]:
    marked: set[int] = set()
    for d in vacation_days:
        if d < 1 or d > dim:
            continue
        cur = existing.get(d)
        if only_empty and _norm_code(cur) is not None:
            continue
        existing[d] = "о"
        marked.add(d)
    return marked


def _workday_code_for_gender(gender: str) -> str:
    return "7.2" if gender == EMPLOYEE_GENDER_FEMALE else "8"


def _autofill_five_two(
    year: int,
    month: int,
    dim: int,
    holiday_days: set[int],
    existing: dict[int, str | None],
    *,
    only_empty: bool,
    workday_code: str,
) -> dict[int, str | None]:
    """Пн–пт без праздника: workday_code (8 или 7.2). Праздники РФ (будни) — «о». Сб/вс — пусто (не «о»)."""
    out: dict[int, str | None] = {}
    for d in range(1, dim + 1):
        cur = existing.get(d)
        if _is_vacation(cur):
            continue
        if only_empty and _norm_code(cur) is not None:
            continue
        if is_weekend(year, month, d):
            if not only_empty:
                out[d] = None
            continue
        if d in holiday_days:
            out[d] = "о"
        else:
            out[d] = workday_code
    return out


async def run_schedule_autofill(
    session: AsyncSession,
    *,
    year: int,
    month: int,
    only_empty: bool,
    editor_id: uuid.UUID,
) -> int:
    dim = calendar.monthrange(year, month)[1]
    holiday_days = ru_holiday_dates(year, month)

    users = (
        await session.execute(
            select(User)
            .where(User.is_active.is_(True))
            .options(selectinload(User.employee_profile))
        )
    ).scalars().unique().all()

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
        profile = u.employee_profile
        periods = profile.vacation_periods if profile and profile.vacation_periods else None
        vac_days = vacation_days_in_month(year, month, periods)
        kind, emp_gender = normalize_profile_schedule(profile)

        existing = dict(by_user.get(u.id, {}))
        full_existing: dict[int, str | None] = {d: existing.get(d) for d in range(1, dim + 1)}
        vac_marked = _apply_profile_vacation_to_existing(
            year, month, dim, full_existing, vac_days, only_empty=only_empty
        )

        if kind == WORK_SCHEDULE_SHIFT:
            new_cells: dict[int, str | None] = {}
        else:
            workday_code = _workday_code_for_gender(emp_gender)
            new_cells = _autofill_five_two(
                year, month, dim, holiday_days, full_existing, only_empty=only_empty, workday_code=workday_code
            )

        for d in vac_marked:
            new_cells[d] = "о"

        for day, code in new_cells.items():
            stmt = select(ScheduleEntry).where(
                ScheduleEntry.year == year,
                ScheduleEntry.month == month,
                ScheduleEntry.user_id == u.id,
                ScheduleEntry.day == day,
            )
            row = (await session.execute(stmt)).scalar_one_or_none()
            if code is None:
                if row:
                    await session.delete(row)
                    written += 1
                continue
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
