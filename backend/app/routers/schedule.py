import calendar
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import require_permission
from app.models import ScheduleEntry, User
from app.models.schedule_mode import SCHEDULE_MODE_VALUES, ScheduleMode
from app.models.user_system import UserSystem
from app.permissions import SCHEDULE_MANAGE, SCHEDULE_READ
from app.schemas.schedule import (
    ScheduleAutofillIn,
    ScheduleAutofillOut,
    ScheduleCellOut,
    ScheduleCellPatch,
    ScheduleDayInfo,
    ScheduleModePatchOut,
    ScheduleMonthOut,
    ScheduleUserModePatch,
    ScheduleUserRow,
)
from app.services.ru_calendar import is_weekend, ru_holiday_dates
from app.services.schedule_autofill import run_schedule_autofill

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


@router.get("/month", response_model=ScheduleMonthOut)
async def get_schedule_month(
    session: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(require_permission(SCHEDULE_READ))],
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
            .options(selectinload(User.system_memberships).selectinload(UserSystem.system))
            .order_by(User.full_name, User.email)
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

    rows: list[ScheduleUserRow] = []
    for u in users:
        sys_names = sorted(
            {us.system.name for us in u.system_memberships if us.system},
            key=lambda n: n.lower(),
        )
        systems_label = ", ".join(sys_names) if sys_names else "—"
        mode = u.schedule_mode if u.schedule_mode in SCHEDULE_MODE_VALUES else ScheduleMode.manual.value

        cells: dict[str, str | None] = {}
        ud = by_user.get(u.id, {})
        for d in range(1, dim + 1):
            if d in ud:
                v = ud[d]
                cells[str(d)] = v if v != "" else None
            else:
                cells[str(d)] = None
        rows.append(
            ScheduleUserRow(
                user_id=u.id,
                full_name=u.full_name,
                email=u.email,
                schedule_mode=mode,
                systems_label=systems_label,
                row_kind=_row_kind(mode),
                cells=cells,
            )
        )
    return ScheduleMonthOut(
        year=year,
        month=month,
        days_in_month=dim,
        days=day_infos,
        users=rows,
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
