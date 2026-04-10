"""
Эвристика пола по русскому ФИО для графика (7.2 ч / 8 ч).

Надёжнее всего отчество (третье слово при «Фамилия Имя Отчество»):
- жен.: окончания -вна, -чна (и редкие -шна, -зна в том же классе);
- муж.: -ович, -евич, -ыч, -ич (Ильич, Кузьмич).

Двухсловные строки, инициалы, иностранные ФИО — чаще дают unspecified.
"""

from __future__ import annotations

import re

from app.models.employee_work_schedule import (
    EMPLOYEE_GENDER_FEMALE,
    EMPLOYEE_GENDER_MALE,
    EMPLOYEE_GENDER_UNSPECIFIED,
)


def infer_gender_from_russian_full_name(full_name: str | None) -> str:
    if not full_name or not str(full_name).strip():
        return EMPLOYEE_GENDER_UNSPECIFIED

    # Убираем лишние пробелы; буквы в нижний регистр для суффиксов
    raw = " ".join(str(full_name).split())
    if len(raw) < 3:
        return EMPLOYEE_GENDER_UNSPECIFIED

    parts = raw.split()
    if not parts:
        return EMPLOYEE_GENDER_UNSPECIFIED

    # Инициалы вида «И.» или «И.О.» — не использовать как отчество
    def _looks_like_initial(token: str) -> bool:
        t = token.strip()
        return bool(re.match(r"^[А-ЯЁA-Z]\.?$", t)) or bool(re.match(r"^[А-ЯЁA-Z]\.[А-ЯЁA-Z]\.?$", t))

    # Берём последнее «слово», похожее на полное слово (не инициал)
    candidate = parts[-1].strip()
    if _looks_like_initial(candidate) and len(parts) >= 2:
        candidate = parts[-2].strip()
        if _looks_like_initial(candidate):
            return EMPLOYEE_GENDER_UNSPECIFIED

    low = candidate.lower()
    # Латиница / не кириллица в ключевом слове — не угадываем
    if not re.search(r"[а-яё]", low):
        return EMPLOYEE_GENDER_UNSPECIFIED

    # Женские отчества (типичные окончания рус./близких к рус.)
    if low.endswith("вна") or low.endswith("чна"):
        return EMPLOYEE_GENDER_FEMALE

    # Мужские отчества
    if low.endswith(("ович", "евич", "ыч")):
        return EMPLOYEE_GENDER_MALE
    # Ильич, Кузьмич, …ич
    if low.endswith("ич") and len(low) >= 4:
        return EMPLOYEE_GENDER_MALE

    return EMPLOYEE_GENDER_UNSPECIFIED
