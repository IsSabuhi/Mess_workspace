"""Создание пользователей из распарсенных строк Excel."""

from __future__ import annotations

import uuid

from pydantic import EmailStr, TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EmployeeProfile, Position, Role, User, UserRole
from app.models.employee_work_schedule import EMPLOYEE_GENDER_UNSPECIFIED, WORK_SCHEDULE_FIVE_TWO
from app.schemas.employee_import import EmployeeImportOut, EmployeeImportRowDetail, EmployeeImportRowStatus
from app.security import hash_password
from app.services.employee_excel_import import ParsedEmployeeRow


def _norm_pos_name(s: str) -> str:
    return " ".join((s or "").split()).lower()


def _email_for_login(login: str) -> str:
    return f"{login.strip()}@nornik.ru"


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

    details: list[EmployeeImportRowDetail] = []
    created = 0
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
        if existing:
            skipped += 1
            details.append(
                EmployeeImportRowDetail(
                    sheet_row=pr.sheet_row,
                    login=login,
                    email=email,
                    status=EmployeeImportRowStatus.skipped_exists,
                    message="Пользователь с таким email уже есть",
                )
            )
            continue

        position_id: uuid.UUID | None = None
        pos_msg: str | None = None
        if pr.position_title and pr.position_title.strip():
            pk = _norm_pos_name(pr.position_title)
            if pk in pos_map:
                position_id = pos_map[pk]
            else:
                pos_msg = f"Должность «{pr.position_title.strip()}» не найдена в справочнике"

        password_plain = login
        user = User(
            email=el,
            full_name=full_name,
            position_id=position_id,
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
    return EmployeeImportOut(created=created, skipped=skipped, rows=details)
