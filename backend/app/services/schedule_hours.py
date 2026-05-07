"""Сумма часов по строке расписания."""

from __future__ import annotations

import re

# Только целое или десятичное число.
_HOURS_NUMERIC = re.compile(r"^\s*(-?\d+(?:[.,]\d+)?)\s*$")


def hours_from_schedule_cell(raw: str | None) -> float:
    if raw is None:
        return 0.0
    s = str(raw).strip().lower().replace(",", ".")
    if not s:
        return 0.0
    # Для графика 2/2 оба кода считаем как 11 часов.
    if s in {"11д", "11в"}:
        return 11.0
    if not _HOURS_NUMERIC.fullmatch(s):
        return 0.0
    return float(s)


def sum_month_hours(dim: int, day_to_code: dict[int, str]) -> float:
    """Сумма за дни 1..dim."""
    total = sum(hours_from_schedule_cell(day_to_code.get(d, "")) for d in range(1, dim + 1))
    return round(total, 2)
