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


def ru_holiday_names(year: int, month: int) -> dict[int, str]:
    """Названия официальных праздничных дней РФ в выбранном месяце: {day -> name}."""
    dim = calendar.monthrange(year, month)[1]
    out: dict[int, str] = {}
    if _holidays_lib is not None:
        ru = _holidays_lib.Russia(years=[year])
        for d in range(1, dim + 1):
            dt = date(year, month, d)
            if dt in ru:
                name = str(ru.get(dt) or "").strip()
                out[d] = name or "Праздничный день"
        return out

    fixed_names: dict[tuple[int, int], str] = {
        (1, 1): "Новогодние каникулы",
        (1, 2): "Новогодние каникулы",
        (1, 3): "Новогодние каникулы",
        (1, 4): "Новогодние каникулы",
        (1, 5): "Новогодние каникулы",
        (1, 6): "Новогодние каникулы",
        (1, 7): "Рождество Христово",
        (1, 8): "Новогодние каникулы",
        (2, 23): "День защитника Отечества",
        (3, 8): "Международный женский день",
        (5, 1): "Праздник Весны и Труда",
        (5, 9): "День Победы",
        (6, 12): "День России",
        (11, 4): "День народного единства",
    }
    for d in range(1, dim + 1):
        name = fixed_names.get((month, d))
        if name:
            out[d] = name
    return out


def is_weekend(year: int, month: int, day: int) -> bool:
    """Суббота или воскресенье."""
    wd = date(year, month, day).weekday()
    return wd >= 5
