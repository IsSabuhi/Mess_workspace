"""Создание пользователей из распарсенных строк Excel."""

from __future__ import annotations

import uuid
import re

from pydantic import EmailStr, TypeAdapter
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmployeeProfile, Position, Role, System, User, UserRole
from app.models.employee_work_schedule import EMPLOYEE_GENDER_UNSPECIFIED, WORK_SCHEDULE_FIVE_TWO
from app.models.user_system import UserSystem
from app.schemas.employee_import import EmployeeImportOut, EmployeeImportRowDetail, EmployeeImportRowStatus
from app.security import hash_password
from app.services.employee_excel_import import ParsedEmployeeRow


def _norm_pos_name(s: str) -> str:
    return " ".join((s or "").split()).lower()


def _email_for_login(login: str) -> str:
    return f"{login.strip()}@nornik.ru"


def _norm_name(s: str) -> str:
    return " ".join((s or "").split()).strip().lower()


def _slugify_system_name(name: str) -> str:
    base = re.sub(r"[^0-9A-Za-zА-Яа-яЁё]+", "-", name.strip().lower()).strip("-")
    return base or "system"


async def _ensure_system(
    session: AsyncSession,
    *,
    system_name: str,
    systems_by_norm_name: dict[str, System],
    systems_by_slug: dict[str, System],
) -> System:
    nk = _norm_name(system_name)
    existing = systems_by_norm_name.get(nk)
    if existing:
        return existing

    base_slug = _slugify_system_name(system_name)
    slug = base_slug
    idx = 2
    while slug in systems_by_slug:
        slug = f"{base_slug}-{idx}"
        idx += 1

    sys_row = System(
        name=system_name.strip(),
        slug=slug,
        is_active=True,
    )
    session.add(sys_row)
    await session.flush()
    systems_by_norm_name[nk] = sys_row
    systems_by_slug[slug] = sys_row
    return sys_row


def _validate_email(email: str) -> bool:
    try:
        TypeAdapter(EmailStr).validate_python(email)
        return True
    except Exception:
        return False


async def run_employee_import(session: AsyncSession, rows: list[ParsedEmployeeRow]) -> EmployeeImportOut:
    pos_result = await session.execute(select(Position).where(Position.is_active.is_(True)))
    positions = pos_result.scalars().all()
    pos_map: dict[str, uuid.UUID] = {}
    for p in positions:
        k = _norm_pos_name(p.name)
        if k and k not in pos_map:
            pos_map[k] = p.id

    employee_role_id: uuid.UUID | None = await session.scalar(select(Role.id).where(Role.slug == "employee"))
    systems = (await session.execute(select(System))).scalars().all()
    systems_by_norm_name: dict[str, System] = {}
    systems_by_slug: dict[str, System] = {}
    for s in systems:
        systems_by_norm_name[_norm_name(s.name)] = s
        systems_by_slug[s.slug] = s

    details: list[EmployeeImportRowDetail] = []
    created = 0
    updated = 0
    skipped = 0
    seen_emails: set[str] = set()

    for pr in rows:
        login = pr.login.strip()
        full_name = pr.full_name.strip()

        if not login or not full_name:
            skipped += 1
            details.append(
                EmployeeImportRowDetail(
                    sheet_row=pr.sheet_row,
                    login=login or None,
                    status=EmployeeImportRowStatus.skipped_invalid,
                    message="Пустая учётная запись или ФИО",
                )
            )
            continue

        email = _email_for_login(login)
        if not _validate_email(email):
            skipped += 1
            details.append(
                EmployeeImportRowDetail(
                    sheet_row=pr.sheet_row,
                    login=login,
                    status=EmployeeImportRowStatus.skipped_invalid,
                    message="Некорректный email (проверьте учётную запись)",
                )
            )
            continue

        el = email.lower()
        if el in seen_emails:
            skipped += 1
            details.append(
                EmployeeImportRowDetail(
                    sheet_row=pr.sheet_row,
                    login=login,
                    email=email,
                    status=EmployeeImportRowStatus.skipped_duplicate_file,
                    message="Повтор в файле",
                )
            )
            continue
        seen_emails.add(el)

        existing = await session.scalar(select(User.id).where(func.lower(User.email) == el))
        position_id: uuid.UUID | None = None
        pos_msg: str | None = None
        if pr.position_title and pr.position_title.strip():
            pk = _norm_pos_name(pr.position_title)
            if pk in pos_map:
                position_id = pos_map[pk]
            else:
                pos_msg = f"Должность «{pr.position_title.strip()}» не найдена в справочнике"

        system_ids: list[uuid.UUID] = []
        for sys_name in pr.systems:
            sys_row = await _ensure_system(
                session,
                system_name=sys_name,
                systems_by_norm_name=systems_by_norm_name,
                systems_by_slug=systems_by_slug,
            )
            system_ids.append(sys_row.id)

        if existing:
            user = await session.get(User, existing)
            assert user
            user.full_name = full_name
            user.email = el
            if position_id is not None:
                user.position_id = position_id
            if pr.position_title and position_id is None:
                user.job_title = pr.position_title.strip()
            # Синхронизируем системы с файлом: удаляем старые связи и добавляем актуальные.
            await session.execute(delete(UserSystem).where(UserSystem.user_id == user.id))
            for sid in set(system_ids):
                session.add(UserSystem(user_id=user.id, system_id=sid))
            updated += 1
            details.append(
                EmployeeImportRowDetail(
                    sheet_row=pr.sheet_row,
                    login=login,
                    email=email,
                    status=EmployeeImportRowStatus.updated,
                    user_id=user.id,
                    message=pos_msg or "Пользователь обновлён (ФИО/должность/системы)",
                )
            )
            continue

        password_plain = login
        user = User(
            email=el,
            full_name=full_name,
            position_id=position_id,
            job_title=pr.position_title.strip() if pr.position_title and position_id is None else None,
            hashed_password=hash_password(password_plain),
            is_active=True,
            is_superuser=False,
        )
        session.add(user)
        await session.flush()

        session.add(
            EmployeeProfile(
                user_id=user.id,
                work_schedule_kind=WORK_SCHEDULE_FIVE_TWO,
                gender=EMPLOYEE_GENDER_UNSPECIFIED,
            )
        )

        if employee_role_id:
            session.add(UserRole(user_id=user.id, role_id=employee_role_id))
        for sid in set(system_ids):
            session.add(UserSystem(user_id=user.id, system_id=sid))

        created += 1
        details.append(
            EmployeeImportRowDetail(
                sheet_row=pr.sheet_row,
                login=login,
                email=email,
                status=EmployeeImportRowStatus.created,
                user_id=user.id,
                message=pos_msg,
            )
        )

    await session.commit()
    return EmployeeImportOut(created=created, updated=updated, skipped=skipped, rows=details)
