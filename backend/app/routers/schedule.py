import calendar
import uuid
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import require_any_permission, require_permission
from app.models import ScheduleEntry, System, User
from app.models.employee_work_schedule import normalize_profile_schedule
from app.models.schedule_mode import SCHEDULE_MODE_VALUES, ScheduleMode
from app.models.user_system import UserSystem
from app.permissions import SCHEDULE_MANAGE, SCHEDULE_READ
from app.schemas.schedule import (
    ScheduleAutofillIn,
    ScheduleAutofillOut,
    ScheduleCellOut,
    ScheduleCellPatch,
    ScheduleDayInfo,
    ScheduleGroupOut,
    ScheduleModePatchOut,
    ScheduleMonthOut,
    ScheduleUserModePatch,
    ScheduleUserRow,
)
from app.services.ru_calendar import is_weekend, ru_holiday_dates
from app.services.schedule_autofill import run_schedule_autofill
from app.services.schedule_hours import sum_month_hours

router = APIRouter(prefix="/schedule", tags=["schedule"])


def _days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _row_kind(mode: str) -> str:
    if mode in (ScheduleMode.shift_11_3_8.value, ScheduleMode.shift_11d_11v.value):
        return "shift"
    if mode == ScheduleMode.everyday_72.value:
        return "fixed"
    if mode == ScheduleMode.five_two.value:
        return "five_two"
    return "manual"


def _infer_row_kind_from_cells(dim: int, day_to_code: dict[int, str]) -> str:
    """Подсветка строки по содержимому ячеек (без привязки к режиму в БД)."""
    vals: list[str] = []
    for d in range(1, dim + 1):
        v = str(day_to_code.get(d, "") or "").strip().lower()
        if v:
            vals.append(v)
    if not vals:
        return "manual"
    joined = " ".join(vals)
    if "11д" in joined or "11в" in joined:
        return "shift"
    if "7.2" in joined:
        return "fixed"
    if any(v in ("11", "3", "8") for v in vals):
        return "shift"
    if "8" in joined and "о" in joined:
        return "five_two"
    return "manual"


def _primary_active_system_id(user: User) -> uuid.UUID | None:
    """Система для группировки в расписании: среди активных систем сотрудника — с минимальным sort_order, затем по имени."""
    members = [m for m in user.system_memberships if m.system and m.system.is_active]
    if not members:
        return None
    best = min(members, key=lambda m: (m.system.sort_order, m.system.name.lower()))
    return best.system.id


def _build_schedule_user_row(
    u: User,
    *,
    dim: int,
    by_user: dict[uuid.UUID, dict[int, str]],
) -> ScheduleUserRow:
    sys_names = sorted(
        {us.system.name for us in u.system_memberships if us.system and us.system.is_active},
        key=lambda n: n.lower(),
    )
    systems_label = ", ".join(sys_names) if sys_names else "—"
    mode = u.schedule_mode if u.schedule_mode in SCHEDULE_MODE_VALUES else ScheduleMode.manual.value
    wkind, gsch = normalize_profile_schedule(u.employee_profile)

    cells: dict[str, str | None] = {}
    ud = by_user.get(u.id, {})
    day_codes: dict[int, str] = {}
    for d in range(1, dim + 1):
        if d in ud:
            v = ud[d]
            cells[str(d)] = v if v != "" else None
            day_codes[d] = v or ""
        else:
            cells[str(d)] = None
            day_codes[d] = ""
    return ScheduleUserRow(
        user_id=u.id,
        full_name=u.full_name,
        email=u.email,
        schedule_mode=mode,
        systems_label=systems_label,
        work_schedule_kind=wkind,
        gender=gsch,
        row_kind=_infer_row_kind_from_cells(dim, day_codes),
        cells=cells,
        hours_total=sum_month_hours(dim, day_codes),
    )


@router.get("/month", response_model=ScheduleMonthOut)
async def get_schedule_month(
    session: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(require_any_permission(SCHEDULE_READ, SCHEDULE_MANAGE))],
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
) -> ScheduleMonthOut:
    dim = _days_in_month(year, month)
    holiday_days = ru_holiday_dates(year, month)

    day_infos: list[ScheduleDayInfo] = []
    for d in range(1, dim + 1):
        day_infos.append(
            ScheduleDayInfo(
                day=d,
                is_weekend=is_weekend(year, month, d),
                is_ru_holiday=d in holiday_days,
            )
        )

    users = (
        await session.execute(
            select(User)
            .where(User.is_active.is_(True))
            .options(
                selectinload(User.system_memberships).selectinload(UserSystem.system),
                selectinload(User.employee_profile),
            )
        )
    ).scalars().unique().all()

    entries = (
        await session.execute(
            select(ScheduleEntry).where(
                ScheduleEntry.year == year,
                ScheduleEntry.month == month,
            )
        )
    ).scalars().all()
    by_user: dict[uuid.UUID, dict[int, str]] = {}
    for e in entries:
        if e.day < 1 or e.day > dim:
            continue
        by_user.setdefault(e.user_id, {})[e.day] = e.code if e.code else ""

    buckets: dict[uuid.UUID | None, list[User]] = defaultdict(list)
    for u in users:
        buckets[_primary_active_system_id(u)].append(u)

    for sid in buckets:
        buckets[sid].sort(key=lambda x: (x.full_name.lower(), x.email.lower()))

    non_null_ids = [k for k in buckets if k is not None]
    sys_map: dict[uuid.UUID, System] = {}
    if non_null_ids:
        sys_rows = (await session.execute(select(System).where(System.id.in_(non_null_ids)))).scalars().all()
        sys_map = {s.id: s for s in sys_rows}

    ordered_sids = sorted(
        non_null_ids,
        key=lambda i: (
            sys_map[i].sort_order if i in sys_map else 10**9,
            (sys_map[i].name if i in sys_map else "").lower(),
        ),
    )

    groups: list[ScheduleGroupOut] = []
    for sid in ordered_sids:
        s = sys_map.get(sid)
        label = s.name if s else "Система"
        groups.append(
            ScheduleGroupOut(
                system_id=sid,
                label=label,
                users=[_build_schedule_user_row(u, dim=dim, by_user=by_user) for u in buckets[sid]],
            )
        )
    if None in buckets:
        groups.append(
            ScheduleGroupOut(
                system_id=None,
                label="Без системы",
                users=[_build_schedule_user_row(u, dim=dim, by_user=by_user) for u in buckets[None]],
            )
        )

    return ScheduleMonthOut(
        year=year,
        month=month,
        days_in_month=dim,
        days=day_infos,
        groups=groups,
    )


@router.patch("/cell", response_model=ScheduleCellOut)
async def patch_schedule_cell(
    body: ScheduleCellPatch,
    session: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(require_permission(SCHEDULE_MANAGE))],
) -> ScheduleCellOut:
    dim = _days_in_month(body.year, body.month)
    if body.day < 1 or body.day > dim:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid day for month")

    target = await session.get(User, body.user_id)
    if not target or not target.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user")

    code = body.code.strip() if body.code else None
    if code == "":
        code = None

    stmt = select(ScheduleEntry).where(
        ScheduleEntry.year == body.year,
        ScheduleEntry.month == body.month,
        ScheduleEntry.user_id == body.user_id,
        ScheduleEntry.day == body.day,
    )
    existing = (await session.execute(stmt)).scalar_one_or_none()

    if code is None:
        if existing:
            await session.delete(existing)
        await session.commit()
        return ScheduleCellOut(
            year=body.year,
            month=body.month,
            user_id=body.user_id,
            day=body.day,
            code=None,
        )

    if existing:
        existing.code = code
        existing.updated_by_id = editor.id
    else:
        session.add(
            ScheduleEntry(
                year=body.year,
                month=body.month,
                day=body.day,
                user_id=body.user_id,
                code=code,
                updated_by_id=editor.id,
            )
        )
    await session.commit()
    return ScheduleCellOut(
        year=body.year,
        month=body.month,
        user_id=body.user_id,
        day=body.day,
        code=code,
    )


@router.post("/autofill", response_model=ScheduleAutofillOut)
async def autofill_schedule(
    body: ScheduleAutofillIn,
    session: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(require_permission(SCHEDULE_MANAGE))],
) -> ScheduleAutofillOut:
    n = await run_schedule_autofill(
        session,
        year=body.year,
        month=body.month,
        only_empty=body.only_empty,
        editor_id=editor.id,
    )
    return ScheduleAutofillOut(cells_written=n)


@router.patch("/users/{user_id}/mode", response_model=ScheduleModePatchOut)
async def patch_user_schedule_mode(
    user_id: uuid.UUID,
    body: ScheduleUserModePatch,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(SCHEDULE_MANAGE))],
) -> ScheduleModePatchOut:
    if body.schedule_mode not in SCHEDULE_MODE_VALUES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid schedule_mode")

    u = await session.get(User, user_id)
    if not u or not u.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    u.schedule_mode = body.schedule_mode
    await session.commit()
    mode = u.schedule_mode
    return ScheduleModePatchOut(
        user_id=u.id,
        schedule_mode=mode,
        row_kind=_row_kind(mode),
    )
