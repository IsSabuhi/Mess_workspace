"""Проверка покрытия: в каждой системе для сменщиков в день должно быть ≥ N человек «на работе» (не о/у/пусто)."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from app.models.employee_work_schedule import WORK_SCHEDULE_SHIFT, WORK_SCHEDULE_TWO_TWO, normalize_profile_schedule

if TYPE_CHECKING:
    from app.models import User

MIN_SHIFT_STAFF_DEFAULT = 2


def _is_working_cell(code: str | None) -> bool:
    c = (code or "").strip().lower()
    if not c:
        return False
    if c in ("о", "у"):
        return False
    return True


def build_shift_coverage_reports(
    users: list[User],
    by_user: dict[uuid.UUID, dict[int, str]],
    dim: int,
    *,
    system_names: dict[uuid.UUID, str],
    min_staff: int = MIN_SHIFT_STAFF_DEFAULT,
) -> tuple[list[dict], list[dict]]:
    """
    Возвращает (staffing_notes, coverage_warnings).
    Учитываются только сотрудники со справочником «сменщик» (work_schedule_kind == shift)
    и активной привязкой к системе. По каждой системе отдельно.
    """
    shift_by_system: dict[uuid.UUID, list[User]] = {}
    for u in users:
        wk, _ = normalize_profile_schedule(u.employee_profile)
        if wk not in (WORK_SCHEDULE_SHIFT, WORK_SCHEDULE_TWO_TWO):
            continue
        for us in u.system_memberships:
            if us.system and us.system.is_active:
                sid = us.system.id
                shift_by_system.setdefault(sid, []).append(u)

    for sid in shift_by_system:
        seen: set[uuid.UUID] = set()
        uniq: list[User] = []
        for u in shift_by_system[sid]:
            if u.id in seen:
                continue
            seen.add(u.id)
            uniq.append(u)
        uniq.sort(key=lambda x: (x.full_name.lower(), x.email.lower()))
        shift_by_system[sid] = uniq

    staffing_notes: list[dict] = []
    coverage_warnings: list[dict] = []

    for sid, staff in sorted(shift_by_system.items(), key=lambda x: system_names.get(x[0], "").lower()):
        name = system_names.get(sid, "Система")
        n_staff = len(staff)
        if n_staff < min_staff:
            staffing_notes.append(
                {
                    "system_id": sid,
                    "system_name": name,
                    "shift_staff_total": n_staff,
                    "message": (
                        f"В системе «{name}» сменщиков в штате: {n_staff}. "
                        f"Правило «≥{min_staff} на смене» в принципе недостижимо — добавьте людей или объедините учёт."
                    ),
                }
            )
            continue

        for day in range(1, dim + 1):
            working = 0
            for u in staff:
                raw = by_user.get(u.id, {}).get(day, "")
                code = raw if raw else None
                if _is_working_cell(code):
                    working += 1
            if working < min_staff:
                coverage_warnings.append(
                    {
                        "system_id": sid,
                        "system_name": name,
                        "day": day,
                        "working_count": working,
                        "shift_staff_total": n_staff,
                        "message": (
                            f"«{name}», день {day}: на работе {working} сменщ. "
                            f"(нужно ≥{min_staff}; отпуск «о»/«у» и пустые ячейки не считаются)."
                        ),
                    }
                )

    coverage_warnings.sort(key=lambda x: (x["system_name"].lower(), x["day"]))
    return staffing_notes, coverage_warnings
