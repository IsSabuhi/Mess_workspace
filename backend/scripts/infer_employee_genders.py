#!/usr/bin/env python3
"""
Разовый прогон: выставить пол в employee_profiles по эвристике из ФИО (users.full_name).

Запуск из каталога backend:
  python scripts/infer_employee_genders.py           # только отчёт, без записи
  python scripts/infer_employee_genders.py --write   # записать в БД

По умолчанию обновляются только записи с gender = unspecified.
  python scripts/infer_employee_genders.py --write --include-set
        # также перезаписать уже выставленный male/female (осторожно)
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# backend/ на PYTHONPATH
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import async_session_maker
from app.models import User
from app.models.employee_profile import EmployeeProfile
from app.models.employee_work_schedule import (
    EMPLOYEE_GENDER_FEMALE,
    EMPLOYEE_GENDER_MALE,
    EMPLOYEE_GENDER_UNSPECIFIED,
)
from app.services.russian_name_gender import infer_gender_from_russian_full_name


async def run(*, write: bool, include_set: bool) -> None:
    async with async_session_maker() as session:
        stmt = (
            select(User)
            .options(selectinload(User.employee_profile))
            .join(EmployeeProfile, EmployeeProfile.user_id == User.id)
            .order_by(User.full_name)
        )
        if not include_set:
            stmt = stmt.where(EmployeeProfile.gender == EMPLOYEE_GENDER_UNSPECIFIED)

        users = (await session.execute(stmt)).scalars().unique().all()

        updates: list[tuple[User, EmployeeProfile, str, str]] = []
        for u in users:
            p = u.employee_profile
            if not p:
                continue
            before = p.gender
            inferred = infer_gender_from_russian_full_name(u.full_name)
            if inferred == EMPLOYEE_GENDER_UNSPECIFIED:
                continue
            if before == inferred:
                continue
            updates.append((u, p, before, inferred))

        for u, p, before, inferred in updates:
            label = "female" if inferred == EMPLOYEE_GENDER_FEMALE else "male"
            print(f"{u.full_name!s}\n  email={u.email}\n  gender: {before} -> {inferred} ({label})\n")

        print(f"Итого к изменению: {len(updates)}")

        if write and updates:
            for _, p, _, inferred in updates:
                p.gender = inferred
            await session.commit()
            print("Записано в БД.")
        elif write and not updates:
            print("Нечего записывать.")
        elif not write and updates:
            print("Повторите с --write для сохранения.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Эвристика пола по ФИО для employee_profiles.gender")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Записать изменения (без флага только вывод в консоль)",
    )
    parser.add_argument(
        "--include-set",
        action="store_true",
        help="Обрабатывать и тех, у кого пол уже male/female (перезапись по ФИО)",
    )
    args = parser.parse_args()
    asyncio.run(run(write=args.write, include_set=args.include_set))


if __name__ == "__main__":
    main()
