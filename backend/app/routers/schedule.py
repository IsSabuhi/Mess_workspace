import calendar
import re
import uuid
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import require_any_permission, require_permission
from app.models import ScheduleEntry, ScheduleRowColor, System, User
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
    ScheduleExcelImportOut,
    ScheduleGroupOut,
    ScheduleRowColorOut,
    ScheduleRowColorPatch,
    ScheduleModePatchOut,
    ScheduleMonthOut,
    ScheduleRegenerateIn,
    ScheduleUserModePatch,
    ScheduleUserRow,
    ShiftCoverageWarningOut,
    ShiftStaffingNoteOut,
)
from app.services.ru_calendar import is_weekend, ru_holiday_dates
from app.services.schedule_autofill import (
    _norm_code as schedule_norm_code,
    run_schedule_autofill,
    run_schedule_regenerate_from_manual,
)
from app.services.schedule_coverage import MIN_SHIFT_STAFF_DEFAULT, build_shift_coverage_reports
from app.services.schedule_excel_import import import_schedule_month_excel
from app.services.schedule_hours import sum_month_hours

router = APIRouter(prefix="/schedule", tags=["schedule"])
_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
AUTO_SHIFT_COLORS = ["#3b82f6", "#facc15", "#10b981", "#a855f7", "#22c55e"]


def _days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _validate_hex_color(raw: str) -> str:
    c = raw.strip()
    if not _HEX_COLOR_RE.fullmatch(c):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid color '{raw}'")
    return c.lower()


def _prev_year_month(year: int, month: int) -> tuple[int, int]:
    if month > 1:
        return year, month - 1
    return year - 1, 12


def _phase_to_auto_color(phase: int) -> str:
    i = max(0, min(len(AUTO_SHIFT_COLORS) - 1, int(phase)))
    return AUTO_SHIFT_COLORS[i]


async def _load_row_colors_with_fallback(
    session: AsyncSession, year: int, month: int
) -> dict[uuid.UUID, str]:
    cur_rows = (
        await session.execute(
            select(ScheduleRowColor).where(
                ScheduleRowColor.year == year,
                ScheduleRowColor.month == month,
            )
        )
    ).scalars().all()
    out: dict[uuid.UUID, str] = {r.user_id: r.color for r in cur_rows}
    py, pm = _prev_year_month(year, month)
    prev_rows = (
        await session.execute(
            select(ScheduleRowColor).where(
                ScheduleRowColor.year == py,
                ScheduleRowColor.month == pm,
            )
        )
    ).scalars().all()
    for r in prev_rows:
        out.setdefault(r.user_id, r.color)
    return out


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


def _norm_shift_token(raw: str | None) -> str:
    if raw is None:
        return "_"
    n = schedule_norm_code(raw)
    if n is None:
        return "_"
    s = str(n).strip().lower().replace(",", ".")
    if s in {"11", "3", "8"}:
        return s
    if re.fullmatch(r"11(?:\.0+)?", s):
        return "11"
    if re.fullmatch(r"3(?:\.0+)?", s):
        return "3"
    if re.fullmatch(r"8(?:\.0+)?", s):
        return "8"
    return "_"


def _month_shift_tokens(ud: dict[int, str], dim: int) -> list[str]:
    return [_norm_shift_token(ud.get(d)) for d in range(1, dim + 1)]


def _share_same_code_some_day(a: list[str], b: list[str]) -> bool:
    for i in range(min(len(a), len(b))):
        if a[i] != "_" and a[i] == b[i]:
            return True
    return False


def _expected_shift_token(day1_based: int, phase: int) -> str:
    cycle = ("11", "3", "8", "_")
    return cycle[(day1_based - 1 + phase) % 4]


def _fit_phase_score(tokens: list[str], phase: int) -> int:
    score = 0
    for i, got in enumerate(tokens):
        if got == "_":
            continue
        exp = _expected_shift_token(i + 1, phase)
        if exp == "_":
            continue
        if got == exp:
            score += 1
    return score


def _infer_best_phase(tokens: list[str]) -> tuple[int, int]:
    best_phase = 0
    best_score = -1
    for p in range(4):
        s = _fit_phase_score(tokens, p)
        if s > best_score or (s == best_score and p < best_phase):
            best_phase = p
            best_score = s
    return best_phase, best_score


def _min_phase_agreement_days(month_len: int) -> int:
    return min(month_len, max(2, (month_len + 9) // 10))


def _rows_linked_for_highlight(a: list[str], b: list[str]) -> bool:
    if _share_same_code_some_day(a, b):
        return True
    pa, sa = _infer_best_phase(a)
    pb, sb = _infer_best_phase(b)
    min_sc = _min_phase_agreement_days(min(len(a), len(b)))
    return pa == pb and sa >= min_sc and sb >= min_sc


def _collect_shift_brigade_row_colors(
    users: list[User],
    by_user: dict[uuid.UUID, dict[int, str]],
    dim: int,
) -> dict[uuid.UUID, int]:
    """
    Граф связности по 11/3/8 в текущем месяце.
    Связь есть, если:
    - у пары есть хотя бы один день с одинаковым кодом 11/3/8, или
    - совпала фаза цикла 11→3→8 по токенам месяца (с мягким порогом совпадений).
    """
    eligible_users: list[User] = []
    token_list: list[list[str]] = []
    for u in users:
        wkind, _ = normalize_profile_schedule(u.employee_profile)
        if wkind != "shift":
            continue
        ud = by_user.get(u.id, {})
        tokens = _month_shift_tokens(ud, dim)
        if not any(t != "_" for t in tokens):
            continue
        eligible_users.append(u)
        token_list.append(tokens)

    n = len(eligible_users)
    if n < 2:
        return {}

    parent = list(range(n))
    rank = [0] * n

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri = find(i)
        rj = find(j)
        if ri == rj:
            return
        if rank[ri] < rank[rj]:
            parent[ri] = rj
        elif rank[ri] > rank[rj]:
            parent[rj] = ri
        else:
            parent[rj] = ri
            rank[ri] += 1

    for i in range(n):
        for j in range(i + 1, n):
            if _rows_linked_for_highlight(token_list[i], token_list[j]):
                union(i, j)

    by_root: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        by_root[find(i)].append(i)

    out: dict[uuid.UUID, int] = {}
    components = [grp for grp in by_root.values() if len(grp) >= 2]
    components.sort(key=lambda grp: str(eligible_users[grp[0]].id))
    for color_idx, grp in enumerate(components):
        phase = color_idx % 5
        for idx in grp:
            out[eligible_users[idx].id] = phase
    return out


def _primary_active_system_id(user: User) -> uuid.UUID | None:
    """Система для группировки в расписании: среди активных систем сотрудника — с минимальным sort_order, затем по имени."""
    members = [m for m in user.system_memberships if m.system and m.system.is_active]
    if not members:
        return None
    best = min(members, key=lambda m: (m.system.sort_order, m.system.name.lower()))
    return best.system.id


def _schedule_kind_order_for_system_block(user: User) -> int:
    """
    Порядок строк внутри блока системы:
    1) 5/2
    2) остальные графики (сменный, 2/2)
    """
    wkind, _ = normalize_profile_schedule(user.employee_profile)
    return 0 if wkind == "five_two" else 1


def _build_schedule_user_row(
    u: User,
    *,
    dim: int,
    by_user: dict[uuid.UUID, dict[int, str]],
    row_colors: dict[uuid.UUID, str] | None = None,
    auto_row_colors: dict[uuid.UUID, str] | None = None,
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

    manual_row_color: str | None = None
    if row_colors is not None and u.id in row_colors:
        manual_row_color = row_colors[u.id]
    auto_row_color: str | None = None
    if auto_row_colors is not None and u.id in auto_row_colors:
        auto_row_color = auto_row_colors[u.id]

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
        manual_row_color=manual_row_color,
        auto_row_color=auto_row_color,
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
            .where(User.is_active.is_(True), User.position_id.is_not(None))
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
        # Пустая ячейка может быть явной (строка с code NULL после очистки).
        by_user.setdefault(e.user_id, {})[e.day] = e.code if e.code is not None else ""

    buckets: dict[uuid.UUID | None, list[User]] = defaultdict(list)
    for u in users:
        buckets[_primary_active_system_id(u)].append(u)

    for sid in buckets:
        buckets[sid].sort(
            key=lambda x: (
                _schedule_kind_order_for_system_block(x),
                x.full_name.lower(),
                x.email.lower(),
            )
        )

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

    row_colors = await _load_row_colors_with_fallback(session, year, month)
    auto_phase_by_user = _collect_shift_brigade_row_colors(users, by_user, dim)
    auto_row_colors: dict[uuid.UUID, str] = {}
    for uid, phase in auto_phase_by_user.items():
        if uid in row_colors:
            continue  # ручной цвет (включая fallback из прошлого месяца) имеет приоритет
        auto_row_colors[uid] = _phase_to_auto_color(phase)

    groups: list[ScheduleGroupOut] = []
    for sid in ordered_sids:
        s = sys_map.get(sid)
        label = s.name if s else "Система"
        groups.append(
            ScheduleGroupOut(
                system_id=sid,
                label=label,
                users=[
                    _build_schedule_user_row(
                        u,
                        dim=dim,
                        by_user=by_user,
                        row_colors=row_colors,
                        auto_row_colors=auto_row_colors,
                    )
                    for u in buckets[sid]
                ],
            )
        )
    if None in buckets:
        groups.append(
            ScheduleGroupOut(
                system_id=None,
                label="Без системы",
                users=[
                    _build_schedule_user_row(
                        u,
                        dim=dim,
                        by_user=by_user,
                        row_colors=row_colors,
                        auto_row_colors=auto_row_colors,
                    )
                    for u in buckets[None]
                ],
            )
        )

    system_names: dict[uuid.UUID, str] = {}
    for u in users:
        for us in u.system_memberships:
            if us.system and us.system.is_active:
                system_names[us.system.id] = us.system.name

    raw_notes, raw_warns = build_shift_coverage_reports(
        list(users),
        by_user,
        dim,
        system_names=system_names,
        min_staff=MIN_SHIFT_STAFF_DEFAULT,
    )
    return ScheduleMonthOut(
        year=year,
        month=month,
        days_in_month=dim,
        days=day_infos,
        groups=groups,
        min_shift_staff_required=MIN_SHIFT_STAFF_DEFAULT,
        shift_staffing_notes=[ShiftStaffingNoteOut(**n) for n in raw_notes],
        shift_coverage_warnings=[ShiftCoverageWarningOut(**w) for w in raw_warns],
    )


@router.patch("/row-color", response_model=ScheduleRowColorOut)
async def patch_schedule_row_color(
    body: ScheduleRowColorPatch,
    session: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(require_permission(SCHEDULE_MANAGE))],
) -> ScheduleRowColorOut:
    target = await session.get(User, body.user_id)
    if not target or not target.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user")

    existing = (
        await session.execute(
            select(ScheduleRowColor).where(
                ScheduleRowColor.year == body.year,
                ScheduleRowColor.month == body.month,
                ScheduleRowColor.user_id == body.user_id,
            )
        )
    ).scalar_one_or_none()

    if body.color is None or body.color.strip() == "":
        if existing is not None:
            await session.delete(existing)
            await session.commit()
        return ScheduleRowColorOut(year=body.year, month=body.month, user_id=body.user_id, color=None)

    color = _validate_hex_color(body.color)
    if existing is None:
        session.add(
            ScheduleRowColor(
                year=body.year,
                month=body.month,
                user_id=body.user_id,
                color=color,
                updated_by_id=editor.id,
            )
        )
    else:
        existing.color = color
        existing.updated_by_id = editor.id
    await session.commit()
    return ScheduleRowColorOut(year=body.year, month=body.month, user_id=body.user_id, color=color)


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
        # Оставляем строку с code=NULL, чтобы updated_at фиксировал явную очистку ячейки
        # (перегенерация графика сохраняет такие пустые дни и не затирает их циклом).
        if existing:
            existing.code = None
            existing.updated_by_id = editor.id
        else:
            session.add(
                ScheduleEntry(
                    year=body.year,
                    month=body.month,
                    day=body.day,
                    user_id=body.user_id,
                    code=None,
                    updated_by_id=editor.id,
                )
            )
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


@router.post("/regenerate", response_model=ScheduleAutofillOut)
async def regenerate_schedule(
    body: ScheduleRegenerateIn,
    session: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(require_permission(SCHEDULE_MANAGE))],
) -> ScheduleAutofillOut:
    eligible = (
        await session.execute(
            select(User.id).where(
                User.id == body.user_id,
                User.is_active.is_(True),
                User.position_id.is_not(None),
            )
        )
    ).scalar_one_or_none()
    if eligible is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сотрудник не найден или не выводится в расписании",
        )
    n = await run_schedule_regenerate_from_manual(
        session,
        year=body.year,
        month=body.month,
        editor_id=editor.id,
        target_user_id=body.user_id,
    )
    return ScheduleAutofillOut(cells_written=n)


@router.post("/import-excel", response_model=ScheduleExcelImportOut)
async def import_schedule_excel(
    session: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(require_permission(SCHEDULE_MANAGE))],
    year: int = Form(..., ge=2000, le=2100),
    month: int = Form(..., ge=1, le=12),
    sheet_name: str | None = Form(None),
    file: UploadFile = File(..., description="Excel .xlsx с листами по месяцам"),
) -> ScheduleExcelImportOut:
    fname = (file.filename or "").lower()
    if not fname.endswith(".xlsx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ожидается файл .xlsx")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл больше 20 МБ")

    res = await import_schedule_month_excel(
        session,
        year=year,
        month=month,
        content=content,
        editor_id=editor.id,
        sheet_name=sheet_name,
    )
    if "error" in res:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=res["error"])
    return ScheduleExcelImportOut(**res)


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
