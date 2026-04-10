"""Режим графика для пользователя (автозаполнение расписания)."""

from __future__ import annotations

import enum


class ScheduleMode(str, enum.Enum):
    """Ручной ввод без автозаполнения."""
    manual = "manual"
    """Пятидневка 8 ч: пн–пт «8», сб–вс и праздники РФ — «о»."""
    five_two = "five_two"
    """Цикл смен 11 → 3 → 8 (сменщики)."""
    shift_11_3_8 = "shift_11_3_8"
    """Чередование 11д / 11в."""
    shift_11d_11v = "shift_11d_11v"
    """Каждый день 7.2 (кроме отмеченных «о» / «у»)."""
    everyday_72 = "everyday_72"


SCHEDULE_MODE_VALUES = tuple(m.value for m in ScheduleMode)
