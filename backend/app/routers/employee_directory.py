import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, delete, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.http_errors import INVALID_POSITION, UNKNOWN_SYSTEM
from app.models import EmployeeProfile, Position, System, User, UserSystem
from app.models.employee_work_schedule import (
    EMPLOYEE_GENDER_VALUES,
    WORK_SCHEDULE_VALUES,
    normalize_profile_schedule,
)
from app.permissions import (
    EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE,
    EMPLOYEE_DIRECTORY_MANAGE,
    EMPLOYEE_DIRECTORY_PROFILE_MANAGE,
    EMPLOYEE_DIRECTORY_READ,
)
from app.services.authz import user_has_permission
from app.schemas.employee_directory import (
    EmployeeDirectoryBulkProfileIn,
    EmployeeDirectoryBulkProfileOut,
    EmployeeDirectoryPatch,
    EmployeeDirectoryRowOut,
    VacationPeriodOut,
)
from app.schemas.position import PositionBrief
from app.schemas.system import SystemBrief

router = APIRouter(prefix="/employee-directory", tags=["employee-directory"])

_COMPLIANCE_PATCH_FIELDS = frozenset({
    "exam_electrical_passed",
    "exam_electrical_date",
    "exam_electrical_valid_to",
    "pass_has",
    "pass_number",
    "pass_valid_from",
    "pass_valid_to",
    "notes",
})
_PROFILE_PATCH_FIELDS = frozenset({
    "vacation_periods",
    "work_schedule_kind",
    "gender",
    "birth_date",
    "position_id",
    "system_ids",
})
_BULK_PROFILE_KEYS = frozenset({"work_schedule_kind", "gender", "position_id", "system_ids"})


def _parse_iso(d) -> date | None:
    if d is None:
        return None
    if isinstance(d, date):
        return d
    try:
        return date.fromisoformat(str(d)[:10])
    except (TypeError, ValueError):
        return None


def _vacation_periods_out(raw) -> list[VacationPeriodOut]:
    if not raw:
        return []
    out: list[VacationPeriodOut] = []
    for x in raw:
        if not isinstance(x, dict):
            continue
        s = _parse_iso(x.get("start"))
        e = _parse_iso(x.get("end"))
        if s is None or e is None or e < s:
            continue
        kind_raw = str(x.get("kind") or "vacation").strip().lower()
        kind = "study" if kind_raw == "study" else "vacation"
        out.append(VacationPeriodOut(start=s, end=e, kind=kind))
    return out


def _row_to_out(user: User) -> EmployeeDirectoryRowOut:
    p = user.employee_profile
    wk, gs = normalize_profile_schedule(p)
    systems = [SystemBrief.model_validate(m.system) for m in user.system_memberships if m.system]
    return EmployeeDirectoryRowOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        is_active=user.is_active,
        birth_date=user.birth_date,
        position=PositionBrief.model_validate(user.position) if user.position else None,
        systems=systems,
        exam_electrical_passed=bool(p.exam_electrical_passed) if p else False,
        exam_electrical_date=p.exam_electrical_date if p else None,
        exam_electrical_valid_to=p.exam_electrical_valid_to if p else None,
        pass_has=bool(p.pass_has) if p else False,
        pass_number=p.pass_number if p else None,
        pass_valid_from=p.pass_valid_from if p else None,
        pass_valid_to=p.pass_valid_to if p else None,
        notes=p.notes if p else None,
        vacation_periods=_vacation_periods_out(p.vacation_periods) if p else [],
        work_schedule_kind=wk,
        gender=gs,
    )


async def _apply_directory_patch_core(session: AsyncSession, user: User, body: EmployeeDirectoryPatch) -> None:
    """Применить PATCH к пользователю (профиль + user.position_id / system_ids). Без проверки прав и без commit."""
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        return

    user_id = user.id
    profile = (
        await session.execute(select(EmployeeProfile).where(EmployeeProfile.user_id == user_id))
    ).scalar_one_or_none()
    if not profile:
        profile = EmployeeProfile(user_id=user_id)
        session.add(profile)
        await session.flush()

    if "vacation_periods" in patch:
        vps = body.vacation_periods
        if vps is None:
            profile.vacation_periods = []
        else:
            profile.vacation_periods = [
                {
                    "start": p.start.isoformat(),
                    "end": p.end.isoformat(),
                    "kind": (p.kind or "vacation"),
                }
                for p in vps
            ]
        patch.pop("vacation_periods", None)

    if "birth_date" in patch:
        user.birth_date = patch.pop("birth_date")

    if "position_id" in patch:
        pid = patch.pop("position_id")
        if pid is not None:
            pos = await session.get(Position, pid)
            if not pos:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_POSITION)
        user.position_id = pid

    if "system_ids" in patch:
        sids = patch.pop("system_ids")
        if sids is not None:
            await session.execute(delete(UserSystem).where(UserSystem.user_id == user_id))
            for sid in set(sids):
                sys_row = await session.get(System, sid)
                if not sys_row:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNKNOWN_SYSTEM)
                session.add(UserSystem(user_id=user.id, system_id=sid))

    for k, v in patch.items():
        setattr(profile, k, v)


@router.get("", response_model=list[EmployeeDirectoryRowOut])
async def list_employee_directory(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(EMPLOYEE_DIRECTORY_READ))],
    search: str | None = None,
    system_ids: Annotated[
        list[uuid.UUID],
        Query(description="Повтор параметра: сотрудник состоит хотя бы в одной из систем (ИЛИ)"),
    ] = [],
    position_ids: Annotated[
        list[uuid.UUID],
        Query(description="Повтор параметра: должность совпадает с одной из выбранных (ИЛИ)"),
    ] = [],
    system_id: uuid.UUID | None = None,
    position_id: uuid.UUID | None = None,
    exam_electrical_passed: bool | None = None,
    pass_has: bool | None = None,
    exam_valid_to_from: date | None = None,
    exam_valid_to_to: date | None = None,
    pass_valid_to_from: date | None = None,
    pass_valid_to_to: date | None = None,
    expiring_in_days: int | None = None,
    expired_only: bool = False,
    include_inactive_users: bool = False,
    gender: str | None = Query(
        None,
        description="Фильтр по полу (male / female / unspecified). Учитывается как в API-строке: нет профиля → unspecified.",
    ),
    work_schedule_kind: str | None = Query(
        None,
        description="Фильтр по графику (five_two / shift / two_two). Нет профиля → five_two.",
    ),
) -> list[EmployeeDirectoryRowOut]:
    stmt = (
        select(User)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .options(
            selectinload(User.position),
            selectinload(User.employee_profile),
            selectinload(User.system_memberships).selectinload(UserSystem.system),
        )
        .order_by(User.full_name, User.email)
    )

    cond = []
    # В справочнике сотрудников показываем только сотрудников с назначенной должностью.
    cond.append(User.position_id.is_not(None))
    if not include_inactive_users:
        cond.append(User.is_active.is_(True))
    if search:
        q = f"%{search.strip()}%"
        cond.append(or_(User.full_name.ilike(q), User.email.ilike(q)))
    sids = list(system_ids)
    if system_id is not None and system_id not in sids:
        sids.append(system_id)
    pids = list(position_ids)
    if position_id is not None and position_id not in pids:
        pids.append(position_id)

    if pids:
        cond.append(User.position_id.in_(pids))
    if sids:
        subq = select(UserSystem.user_id).where(UserSystem.system_id.in_(sids)).distinct()
        cond.append(User.id.in_(subq))
    if exam_electrical_passed is not None:
        cond.append(EmployeeProfile.exam_electrical_passed.is_(exam_electrical_passed))
    if pass_has is not None:
        cond.append(EmployeeProfile.pass_has.is_(pass_has))
    if exam_valid_to_from:
        cond.append(EmployeeProfile.exam_electrical_valid_to >= exam_valid_to_from)
    if exam_valid_to_to:
        cond.append(EmployeeProfile.exam_electrical_valid_to <= exam_valid_to_to)
    if pass_valid_to_from:
        cond.append(EmployeeProfile.pass_valid_to >= pass_valid_to_from)
    if pass_valid_to_to:
        cond.append(EmployeeProfile.pass_valid_to <= pass_valid_to_to)

    if expired_only:
        today = date.today()
        cond.append(
            or_(
                and_(EmployeeProfile.exam_electrical_valid_to.is_not(None), EmployeeProfile.exam_electrical_valid_to < today),
                and_(EmployeeProfile.pass_valid_to.is_not(None), EmployeeProfile.pass_valid_to < today),
            )
        )
    elif expiring_in_days is not None and expiring_in_days >= 0:
        today = date.today()
        to_day = today + timedelta(days=expiring_in_days)
        cond.append(
            or_(
                and_(
                    EmployeeProfile.exam_electrical_valid_to.is_not(None),
                    EmployeeProfile.exam_electrical_valid_to >= today,
                    EmployeeProfile.exam_electrical_valid_to <= to_day,
                ),
                and_(
                    EmployeeProfile.pass_valid_to.is_not(None),
                    EmployeeProfile.pass_valid_to >= today,
                    EmployeeProfile.pass_valid_to <= to_day,
                ),
            )
        )

    if gender is not None:
        if gender not in EMPLOYEE_GENDER_VALUES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Недопустимое значение gender, ожидается одно из: {sorted(EMPLOYEE_GENDER_VALUES)}",
            )
        gender_effective = case(
            (EmployeeProfile.id.is_(None), literal("unspecified")),
            (EmployeeProfile.gender.in_(tuple(EMPLOYEE_GENDER_VALUES)), EmployeeProfile.gender),
            else_=literal("unspecified"),
        )
        cond.append(gender_effective == gender)

    if work_schedule_kind is not None:
        if work_schedule_kind not in WORK_SCHEDULE_VALUES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Недопустимое значение work_schedule_kind, ожидается одно из: {sorted(WORK_SCHEDULE_VALUES)}",
            )
        schedule_effective = case(
            (EmployeeProfile.id.is_(None), literal("five_two")),
            (EmployeeProfile.work_schedule_kind.in_(tuple(WORK_SCHEDULE_VALUES)), EmployeeProfile.work_schedule_kind),
            else_=literal("five_two"),
        )
        cond.append(schedule_effective == work_schedule_kind)

    if cond:
        stmt = stmt.where(*cond)

    users = (await session.execute(stmt)).scalars().unique().all()
    return [_row_to_out(u) for u in users]


@router.get("/{user_id}", response_model=EmployeeDirectoryRowOut)
async def get_employee_directory_row(
    user_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(EMPLOYEE_DIRECTORY_READ))],
) -> EmployeeDirectoryRowOut:
    """Одна карточка справочника (тот же состав полей, что и в списке)."""
    u = (
        await session.execute(
            select(User)
            .where(User.id == user_id)
            .options(
                selectinload(User.position),
                selectinload(User.employee_profile),
                selectinload(User.system_memberships).selectinload(UserSystem.system),
            ),
        )
    ).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _row_to_out(u)


@router.post("/bulk-profile", response_model=EmployeeDirectoryBulkProfileOut)
async def bulk_profile_patch(
    body: EmployeeDirectoryBulkProfileIn,
    session: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(get_current_user)],
) -> EmployeeDirectoryBulkProfileOut:
    """Массово применить одни и те же кадровые поля к списку пользователей (по id из текущей выборки в UI)."""
    full = editor.is_superuser or await user_has_permission(session, editor, EMPLOYEE_DIRECTORY_MANAGE)
    can_prof = full or await user_has_permission(session, editor, EMPLOYEE_DIRECTORY_PROFILE_MANAGE)
    if not can_prof:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет права на кадровый справочник")

    raw_patch = body.patch.model_dump(exclude_unset=True)
    if not raw_patch.keys() <= _BULK_PROFILE_KEYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимые поля в patch")

    patch_model = EmployeeDirectoryPatch(**raw_patch)
    updated = 0
    for uid in dict.fromkeys(body.user_ids):
        user = await session.get(User, uid)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Пользователь не найден: {uid}",
            )
        await _apply_directory_patch_core(session, user, patch_model)
        updated += 1

    await session.commit()
    return EmployeeDirectoryBulkProfileOut(updated=updated)


@router.patch("/{user_id}", response_model=EmployeeDirectoryRowOut)
async def patch_employee_profile(
    user_id: uuid.UUID,
    body: EmployeeDirectoryPatch,
    session: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(get_current_user)],
) -> EmployeeDirectoryRowOut:
    full = editor.is_superuser or await user_has_permission(session, editor, EMPLOYEE_DIRECTORY_MANAGE)
    can_comp = full or await user_has_permission(session, editor, EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE)
    can_prof = full or await user_has_permission(session, editor, EMPLOYEE_DIRECTORY_PROFILE_MANAGE)
    if not (can_comp or can_prof):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет права на редактирование справочника")

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нет полей для обновления")

    for key in patch:
        if key in _COMPLIANCE_PATCH_FIELDS and not can_comp:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Нет права на раздел «Экзамены и пропуски»",
            )
        if key in _PROFILE_PATCH_FIELDS and not can_prof:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Нет права на кадровый справочник",
            )

    await _apply_directory_patch_core(session, user, body)

    await session.flush()
    u = (
        await session.execute(
            select(User)
            .where(User.id == user_id)
            .options(
                selectinload(User.position),
                selectinload(User.employee_profile),
                selectinload(User.system_memberships).selectinload(UserSystem.system),
            )
        )
    ).scalar_one()
    return _row_to_out(u)
