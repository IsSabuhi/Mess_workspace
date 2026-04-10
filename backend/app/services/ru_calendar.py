"""Производственный календарь РФ: выходные и праздники."""

from __future__ import annotations

import calendar
from datetime import date

try:
    import holidays as _holidays_lib
except ImportError:
    _holidays_lib = None


def ru_holiday_dates(year: int, month: int) -> set[int]:
    """Дни месяца (1..N), попадающие на официальные праздничные дни РФ."""
    dim = calendar.monthrange(year, month)[1]
    out: set[int] = set()
    if _holidays_lib is not None:
        ru = _holidays_lib.Russia(years=[year])
        for d in range(1, dim + 1):
            if date(year, month, d) in ru:
                out.add(d)
        return out
    # Fallback без пакета holidays: только типовые фиксированные даты (без переносов).
    fixed: dict[tuple[int, int], None] = {
        (1, 1): None,
        (1, 2): None,
        (1, 3): None,
        (1, 4): None,
        (1, 5): None,
        (1, 6): None,
        (1, 7): None,
        (1, 8): None,
        (2, 23): None,
        (3, 8): None,
        (5, 1): None,
        (5, 9): None,
        (6, 12): None,
        (11, 4): None,
    }
    for d in range(1, dim + 1):
        if (month, d) in fixed:
            out.add(d)
    return out


def is_weekend(year: int, month: int, day: int) -> bool:
    """Суббота или воскресенье."""
    wd = date(year, month, day).weekday()
    return wd >= 5
