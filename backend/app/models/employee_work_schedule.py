"""Тип графика и пол сотрудника (для 5/2: из пола выводятся 8 ч или 7.2 ч)."""

from __future__ import annotations

# График работы (автозаполнение расписания)
WORK_SCHEDULE_FIVE_TWO = "five_two"
WORK_SCHEDULE_SHIFT = "shift"
WORK_SCHEDULE_VALUES = frozenset({WORK_SCHEDULE_FIVE_TWO, WORK_SCHEDULE_SHIFT})

# Пол: для пятидневки женский → 7.2 ч, остальные варианты → 8 ч (ст. 320 ТК РФ)
EMPLOYEE_GENDER_MALE = "male"
EMPLOYEE_GENDER_FEMALE = "female"
EMPLOYEE_GENDER_UNSPECIFIED = "unspecified"
EMPLOYEE_GENDER_VALUES = frozenset({EMPLOYEE_GENDER_MALE, EMPLOYEE_GENDER_FEMALE, EMPLOYEE_GENDER_UNSPECIFIED})


def normalize_profile_schedule(profile) -> tuple[str, str]:
    """(work_schedule_kind, gender) с безопасными значениями по умолчанию."""
    if profile is None:
        return WORK_SCHEDULE_FIVE_TWO, EMPLOYEE_GENDER_UNSPECIFIED
    kind = (
        profile.work_schedule_kind
        if getattr(profile, "work_schedule_kind", None) in WORK_SCHEDULE_VALUES
        else WORK_SCHEDULE_FIVE_TWO
    )
    gender = getattr(profile, "gender", None)
    if gender not in EMPLOYEE_GENDER_VALUES:
        gender = EMPLOYEE_GENDER_UNSPECIFIED
    return kind, gender
