"""Автозаполнение графика по данным справочника.

5/2: 8 / 7.2, праздники РФ — «о», сб/вс — пусто.
Сменщики: циклы по schedule_mode (11-3-8 или 2/2: 11д/11в) + отпуск «о».
"""

from __future__ import annotations

import calendar
import uuid
from collections import defaultdict
from datetime import date, timedelta, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import ScheduleEntry, User
from app.models.user_system import UserSystem
from app.models.employee_work_schedule import (
    EMPLOYEE_GENDER_FEMALE,
    WORK_SCHEDULE_FIVE_TWO,
    WORK_SCHEDULE_SHIFT,
    WORK_SCHEDULE_TWO_TWO,
    normalize_profile_schedule,
)
from app.services.ru_calendar import is_weekend, ru_holiday_dates

VACATION_CODES = frozenset({"о", "у"})


def _norm_code(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = raw.strip()
    return s if s else None


def _is_vacation(code: str | None) -> bool:
    c = _norm_code(code)
    if not c:
        return False
    return c.lower() in VACATION_CODES


def _parse_iso_date(v) -> date | None:
    if v is None:
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def vacation_days_in_month(year: int, month: int, periods: list | None) -> set[int]:
    if not periods:
        return set()
    dim = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, dim)
    out: set[int] = set()
    for p in periods:
        if not isinstance(p, dict):
            continue
        s = _parse_iso_date(p.get("start"))
        e = _parse_iso_date(p.get("end"))
        if s is None or e is None:
            continue
        cur = max(s, month_start)
        end = min(e, month_end)
        while cur <= end:
            if cur.year == year and cur.month == month:
                out.add(cur.day)
            cur += timedelta(days=1)
    return out


def _apply_profile_vacation_to_existing(
    year: int,
    month: int,
    dim: int,
    existing: dict[int, str | None],
    vacation_days: set[int],
    *,
    only_empty: bool,
) -> set[int]:
    marked: set[int] = set()
    for d in vacation_days:
        if d < 1 or d > dim:
            continue
        cur = existing.get(d)
        if only_empty and _norm_code(cur) is not None:
            continue
        existing[d] = "о"
        marked.add(d)
    return marked


def _workday_code_for_gender(gender: str) -> str:
    return "7.2" if gender == EMPLOYEE_GENDER_FEMALE else "8"


def _autofill_five_two(
    year: int,
    month: int,
    dim: int,
    holiday_days: set[int],
    existing: dict[int, str | None],
    *,
    only_empty: bool,
    workday_code: str,
) -> dict[int, str | None]:
    """Пн–пт без праздника: workday_code (8 или 7.2). Праздники РФ (будни) — «о». Сб/вс — пусто (не «о»)."""
    out: dict[int, str | None] = {}
    for d in range(1, dim + 1):
        cur = existing.get(d)
        if _is_vacation(cur):
            continue
        if only_empty and _norm_code(cur) is not None:
            continue
        if is_weekend(year, month, d):
            if not only_empty:
                out[d] = None
            continue
        if d in holiday_days:
            out[d] = "о"
        else:
            out[d] = workday_code
    return out


def _shift_cycle_for_kind(kind: str) -> tuple[str, ...]:
    """Базовый цикл автозаполнения для сменных графиков по типу сотрудника."""
    if kind == WORK_SCHEDULE_TWO_TWO:
        # Для 2/2 конкретная расстановка берется из _two_two_cycle_by_phase.
        return ("11д", "11в", "о", "о")
    # Базовый сменный график.
    return ("11", "3", "8", "о")


def _two_two_cycle_by_phase(phase_offset: int) -> tuple[str, ...]:
    """
    2/2 с чередованием дневной/вечерней внутри системы:
    - часть сотрудников работает блоком в первые 2 дня, часть — в следующие 2 дня,
    - в рабочий день одновременно есть и 11д, и 11в (при >=2 сотрудниках в блоке).
    """
    phase = phase_offset % 4
    if phase == 0:
        return ("11д", "11в", "о", "о")
    if phase == 1:
        return ("11в", "11д", "о", "о")
    if phase == 2:
        return ("о", "о", "11д", "11в")
    return ("о", "о", "11в", "11д")


def _autofill_shift(
    *,
    dim: int,
    existing: dict[int, str | None],
    only_empty: bool,
    kind: str,
    phase_offset: int,
) -> dict[int, str | None]:
    out: dict[int, str | None] = {}
    cycle = _two_two_cycle_by_phase(phase_offset) if kind == WORK_SCHEDULE_TWO_TWO else _shift_cycle_for_kind(kind)
    clen = len(cycle)
    for d in range(1, dim + 1):
        cur = existing.get(d)
        if _is_vacation(cur):
            continue
        if only_empty and _norm_code(cur) is not None:
            continue
        if kind == WORK_SCHEDULE_TWO_TWO:
            # Для 2/2 фаза уже зашита в выбранном цикле.
            out[d] = cycle[(d - 1) % clen]
        else:
            out[d] = cycle[(d - 1 + phase_offset) % clen]
    return out


def _primary_active_system_key(user: User) -> uuid.UUID | None:
    members = [m for m in user.system_memberships if m.system and m.system.is_active]
    if not members:
        return None
    best = min(members, key=lambda m: (m.system.sort_order, m.system.name.lower()))
    return best.system.id


def _build_shift_phase_offsets(users: list[User]) -> dict[uuid.UUID, int]:
    """
    Распределяем фазы внутри системы «шахматно», чтобы не было синхронного «всем выходной».
    - shift (11/3/8/о): циклический сдвиг 0..3.
    - two_two (11д/11в/о/о): сдвиг 0 или 2 (две противофазы).
    """
    buckets: dict[uuid.UUID | None, list[User]] = defaultdict(list)
    for u in users:
        kind, _ = normalize_profile_schedule(u.employee_profile)
        if kind in (WORK_SCHEDULE_SHIFT, WORK_SCHEDULE_TWO_TWO):
            buckets[_primary_active_system_key(u)].append(u)

    out: dict[uuid.UUID, int] = {}
    for _, staff in buckets.items():
        staff.sort(key=lambda x: (x.full_name.lower(), x.email.lower()))
        for idx, u in enumerate(staff):
            kind, _ = normalize_profile_schedule(u.employee_profile)
            if kind == WORK_SCHEDULE_TWO_TWO:
                out[u.id] = idx % 4
            else:
                out[u.id] = idx % 4
    return out


def _prev_year_month(year: int, month: int) -> tuple[int, int]:
    if month > 1:
        return year, month - 1
    return year - 1, 12


def _infer_phase_from_existing(
    *,
    kind: str,
    dim: int,
    existing: dict[int, str | None],
    default_phase: int,
) -> int:
    """Подбирает фазу цикла так, чтобы она совпадала с уже заполненными вручную ячейками."""
    sample_days = [d for d in range(1, dim + 1) if _norm_code(existing.get(d)) and not _is_vacation(existing.get(d))]
    if not sample_days:
        return default_phase

    best_phase = default_phase
    best_score = -1
    for phase in range(4):
        cycle = _two_two_cycle_by_phase(phase) if kind == WORK_SCHEDULE_TWO_TWO else _shift_cycle_for_kind(kind)
        score = 0
        for d in sample_days:
            if kind == WORK_SCHEDULE_TWO_TWO:
                exp = cycle[(d - 1) % len(cycle)].lower()
            else:
                exp = cycle[(d - 1 + phase) % len(cycle)].lower()
            got = str(existing.get(d) or "").strip().lower()
            if got == exp:
                score += 1
        if score > best_score:
            best_score = score
            best_phase = phase
    return best_phase


def _infer_phase_from_days(
    *,
    kind: str,
    existing: dict[int, str | None],
    sample_days: list[int],
    default_phase: int,
) -> int:
    if not sample_days:
        return default_phase
    best_phase = default_phase
    best_score = -1
    for phase in range(4):
        cycle = _two_two_cycle_by_phase(phase) if kind == WORK_SCHEDULE_TWO_TWO else _shift_cycle_for_kind(kind)
        score = 0
        for d in sample_days:
            if kind == WORK_SCHEDULE_TWO_TWO:
                exp = cycle[(d - 1) % len(cycle)].lower()
            else:
                exp = cycle[(d - 1 + phase) % len(cycle)].lower()
            got = str(existing.get(d) or "").strip().lower()
            if got == exp:
                score += 1
        if score > best_score:
            best_score = score
            best_phase = phase
    return best_phase


def _infer_phase_from_month_tail(
    *,
    kind: str,
    dim: int,
    existing: dict[int, str | None],
    default_phase: int,
) -> int:
    """
    Фаза по «хвосту» прошлого месяца: берем последние 1-4 непустые не-отпускные дни.
    Это дает корректный переход на 1-е число следующего месяца.
    """
    tail_days: list[int] = []
    for d in range(dim, 0, -1):
        v = _norm_code(existing.get(d))
        if not v or _is_vacation(v):
            continue
        tail_days.append(d)
        if len(tail_days) >= 4:
            break
    tail_days.reverse()
    return _infer_phase_from_days(
        kind=kind,
        existing=existing,
        sample_days=tail_days,
        default_phase=default_phase,
    )


def _phase_from_prev_month_edge_for_shift(
    *,
    prev_dim: int,
    prev_existing: dict[int, str | None],
    default_phase: int,
) -> tuple[int, bool]:
    """
    Жесткий переход месяца для цикла 11 -> 3 -> 8 -> off.
    Нужен для случаев вида: 31-го '3' => 1-го '8'.
    Возвращает phase_offset для текущего месяца.
    """
    last = _norm_code(prev_existing.get(prev_dim))
    if last and not _is_vacation(last):
        c = last.lower()
        if c == "11":
            return 1, True  # day1 => "3"
        if c == "3":
            return 2, True  # day1 => "8"
        if c == "8":
            return 3, True  # day1 => off
    if last is None:
        # 31-го пусто => следующий шаг цикла 11
        return 0, True
    return default_phase, False


async def run_schedule_autofill(
    session: AsyncSession,
    *,
    year: int,
    month: int,
    only_empty: bool,
    editor_id: uuid.UUID,
) -> int:
    dim = calendar.monthrange(year, month)[1]
    holiday_days = ru_holiday_dates(year, month)

    users = (
        await session.execute(
            select(User)
            .where(User.is_active.is_(True), User.position_id.is_not(None))
            .options(
                selectinload(User.employee_profile),
                selectinload(User.system_memberships).selectinload(UserSystem.system),
            )
        )
    ).scalars().unique().all()
    shift_phase_by_user = _build_shift_phase_offsets(list(users))

    entries = (
        await session.execute(
            select(ScheduleEntry).where(ScheduleEntry.year == year, ScheduleEntry.month == month)
        )
    ).scalars().all()
    prev_year, prev_month = _prev_year_month(year, month)
    prev_entries = (
        await session.execute(
            select(ScheduleEntry).where(ScheduleEntry.year == prev_year, ScheduleEntry.month == prev_month)
        )
    ).scalars().all()

    by_user: dict[uuid.UUID, dict[int, str | None]] = {}
    for e in entries:
        if e.day < 1 or e.day > dim:
            continue
        by_user.setdefault(e.user_id, {})[e.day] = e.code
    prev_dim = calendar.monthrange(prev_year, prev_month)[1]
    prev_by_user: dict[uuid.UUID, dict[int, str | None]] = {}
    for e in prev_entries:
        if e.day < 1 or e.day > prev_dim:
            continue
        prev_by_user.setdefault(e.user_id, {})[e.day] = e.code

    written = 0
    for u in users:
        profile = u.employee_profile
        periods = profile.vacation_periods if profile and profile.vacation_periods else None
        vac_days = vacation_days_in_month(year, month, periods)
        kind, emp_gender = normalize_profile_schedule(profile)

        existing = dict(by_user.get(u.id, {}))
        full_existing: dict[int, str | None] = {d: existing.get(d) for d in range(1, dim + 1)}
        # Синхронизация отпусков при повторном автозаполнении:
        # - добавленные дни отпуска должны проставляться всегда,
        # - снятые дни отпуска (о/у) должны освобождаться под пересчёт.
        for d in range(1, dim + 1):
            cur = _norm_code(full_existing.get(d))
            if not cur or not _is_vacation(cur):
                continue
            if d not in vac_days:
                full_existing[d] = None

        vac_marked = _apply_profile_vacation_to_existing(
            year, month, dim, full_existing, vac_days, only_empty=False
        )

        if kind in (WORK_SCHEDULE_SHIFT, WORK_SCHEDULE_TWO_TWO):
            # Приоритет фазы: прошлый месяц -> текущий (если уже есть ручные точки) -> системная шахматка.
            prev_existing = {d: prev_by_user.get(u.id, {}).get(d) for d in range(1, prev_dim + 1)}
            if kind == WORK_SCHEDULE_SHIFT:
                phase, locked_by_edge = _phase_from_prev_month_edge_for_shift(
                    prev_dim=prev_dim,
                    prev_existing=prev_existing,
                    default_phase=shift_phase_by_user.get(u.id, 0),
                )
                # Если край месяца дал однозначный переход, не переопределяем его хвостовым подбором.
                if not locked_by_edge:
                    phase = _infer_phase_from_month_tail(
                        kind=kind,
                        dim=prev_dim,
                        existing=prev_existing,
                        default_phase=phase,
                    )
            else:
                phase = _infer_phase_from_month_tail(
                    kind=kind,
                    dim=prev_dim,
                    existing=prev_existing,
                    default_phase=shift_phase_by_user.get(u.id, 0),
                )
            phase = _infer_phase_from_existing(
                kind=kind,
                dim=dim,
                existing=full_existing,
                default_phase=phase,
            )
            new_cells = _autofill_shift(
                dim=dim,
                existing=full_existing,
                only_empty=only_empty,
                kind=kind,
                phase_offset=phase,
            )
        else:
            workday_code = _workday_code_for_gender(emp_gender)
            new_cells = _autofill_five_two(
                year, month, dim, holiday_days, full_existing, only_empty=only_empty, workday_code=workday_code
            )

        for d in vac_marked:
            new_cells[d] = "о"

        for day, code in new_cells.items():
            stmt = select(ScheduleEntry).where(
                ScheduleEntry.year == year,
                ScheduleEntry.month == month,
                ScheduleEntry.user_id == u.id,
                ScheduleEntry.day == day,
            )
            row = (await session.execute(stmt)).scalar_one_or_none()
            if code is None:
                if row:
                    await session.delete(row)
                    written += 1
                continue
            if row:
                row.code = code
                row.updated_by_id = editor_id
            else:
                session.add(
                    ScheduleEntry(
                        year=year,
                        month=month,
                        day=day,
                        user_id=u.id,
                        code=code,
                        updated_by_id=editor_id,
                    )
                )
            written += 1

    await session.commit()
    return written


async def run_schedule_regenerate_from_manual(
    session: AsyncSession,
    *,
    year: int,
    month: int,
    editor_id: uuid.UUID,
) -> int:
    """
    Перегенерация расписания с учетом уже введенных вручную ячеек:
    - существующие непустые коды используются как «якоря» для подбора фазы цикла;
    - затем месяц достраивается по циклу, отпускные дни остаются «о».
    """
    dim = calendar.monthrange(year, month)[1]
    holiday_days = ru_holiday_dates(year, month)

    users = (
        await session.execute(
            select(User)
            .where(User.is_active.is_(True), User.position_id.is_not(None))
            .options(
                selectinload(User.employee_profile),
                selectinload(User.system_memberships).selectinload(UserSystem.system),
            )
        )
    ).scalars().unique().all()
    base_phase_by_user = _build_shift_phase_offsets(list(users))

    entries = (
        await session.execute(
            select(ScheduleEntry).where(ScheduleEntry.year == year, ScheduleEntry.month == month)
        )
    ).scalars().all()
    by_user: dict[uuid.UUID, dict[int, str | None]] = {}
    by_user_rows: dict[uuid.UUID, list[ScheduleEntry]] = defaultdict(list)
    for e in entries:
        if 1 <= e.day <= dim:
            by_user.setdefault(e.user_id, {})[e.day] = e.code
            by_user_rows[e.user_id].append(e)

    # Последние ручные правки (короткое окно) — это «якоря» для перегенерации.
    # Большое окно захватывает прошлое автозаполнение целиком и мешает перестройке.
    latest_ts: datetime | None = None
    for e in entries:
        if e.updated_at is not None and (latest_ts is None or e.updated_at > latest_ts):
            latest_ts = e.updated_at
    border = (latest_ts - timedelta(minutes=10)) if latest_ts else None

    recent_anchor_days_by_user: dict[uuid.UUID, set[int]] = defaultdict(set)
    for e in entries:
        if not (1 <= e.day <= dim):
            continue
        if border is not None and (e.updated_at is None or e.updated_at < border):
            continue
        code = _norm_code(e.code)
        if not code or _is_vacation(code):
            continue
        recent_anchor_days_by_user[e.user_id].add(int(e.day))

    # Фаза для сотрудников сменных систем:
    # 1) якорный сотрудник (у кого есть свежие правки) задаёт фазу;
    # 2) остальные в системе получают фазу относительно него.
    manual_phase_by_user: dict[uuid.UUID, int] = {}
    system_buckets: dict[uuid.UUID | None, list[User]] = defaultdict(list)
    for u in users:
        system_buckets[_primary_active_system_key(u)].append(u)

    for _, staff in system_buckets.items():
        staff.sort(key=lambda x: (x.full_name.lower(), x.email.lower()))
        idx_by_uid = {u.id: i for i, u in enumerate(staff)}
        anchors = [u for u in staff if recent_anchor_days_by_user.get(u.id)]
        anchor_user = anchors[0] if anchors else None
        if anchor_user is not None:
            kind, _ = normalize_profile_schedule(anchor_user.employee_profile)
            if kind in (WORK_SCHEDULE_SHIFT, WORK_SCHEDULE_TWO_TWO):
                existing_anchor = {d: by_user.get(anchor_user.id, {}).get(d) for d in range(1, dim + 1)}
                anchor_days = sorted(recent_anchor_days_by_user[anchor_user.id])
                anchor_phase = _infer_phase_from_days(
                    kind=kind,
                    existing=existing_anchor,
                    sample_days=anchor_days,
                    default_phase=base_phase_by_user.get(anchor_user.id, 0),
                )
                manual_phase_by_user[anchor_user.id] = anchor_phase
                anchor_idx = idx_by_uid[anchor_user.id]
                for u in staff:
                    k, _ = normalize_profile_schedule(u.employee_profile)
                    if k not in (WORK_SCHEDULE_SHIFT, WORK_SCHEDULE_TWO_TWO):
                        continue
                    if u.id == anchor_user.id:
                        continue
                    manual_phase_by_user[u.id] = (anchor_phase + (idx_by_uid[u.id] - anchor_idx)) % 4
            continue

        # Если свежих якорей нет — fallback на уже существующую фазу по месяцу/базе.
        for u in staff:
            kind, _ = normalize_profile_schedule(u.employee_profile)
            if kind not in (WORK_SCHEDULE_SHIFT, WORK_SCHEDULE_TWO_TWO):
                continue
            existing_u = {d: by_user.get(u.id, {}).get(d) for d in range(1, dim + 1)}
            manual_phase_by_user[u.id] = _infer_phase_from_existing(
                kind=kind,
                dim=dim,
                existing=existing_u,
                default_phase=base_phase_by_user.get(u.id, 0),
            )

    written = 0
    for u in users:
        profile = u.employee_profile
        periods = profile.vacation_periods if profile and profile.vacation_periods else None
        vac_days = vacation_days_in_month(year, month, periods)
        kind, emp_gender = normalize_profile_schedule(profile)

        existing = dict(by_user.get(u.id, {}))
        full_existing: dict[int, str | None] = {d: existing.get(d) for d in range(1, dim + 1)}
        anchor_days = recent_anchor_days_by_user.get(u.id, set())

        if kind in (WORK_SCHEDULE_SHIFT, WORK_SCHEDULE_TWO_TWO):
            phase = manual_phase_by_user.get(u.id, base_phase_by_user.get(u.id, 0))
            new_cells = _autofill_shift(
                dim=dim,
                existing={},
                only_empty=False,
                kind=kind,
                phase_offset=phase,
            )
        else:
            workday_code = _workday_code_for_gender(emp_gender)
            new_cells = _autofill_five_two(
                year, month, dim, holiday_days, {}, only_empty=False, workday_code=workday_code
            )

        # Отпуск из профиля имеет приоритет.
        for d in vac_days:
            if 1 <= d <= dim:
                new_cells[d] = "о"

        # Сохраняем только свежие ручные якоря (те, что пользователь менял перед нажатием кнопки).
        for d in anchor_days:
            cur = _norm_code(full_existing.get(d))
            if cur:
                new_cells[d] = cur

        # Всегда сохраняем отпуск/учебу из текущей таблицы.
        for d in range(1, dim + 1):
            cur = _norm_code(full_existing.get(d))
            if cur and _is_vacation(cur):
                new_cells[d] = cur

        for day in range(1, dim + 1):
            code = _norm_code(new_cells.get(day))
            stmt = select(ScheduleEntry).where(
                ScheduleEntry.year == year,
                ScheduleEntry.month == month,
                ScheduleEntry.user_id == u.id,
                ScheduleEntry.day == day,
            )
            row = (await session.execute(stmt)).scalar_one_or_none()
            if code is None:
                if row:
                    await session.delete(row)
                    written += 1
                continue
            if row:
                row.code = code
                row.updated_by_id = editor_id
            else:
                session.add(
                    ScheduleEntry(
                        year=year,
                        month=month,
                        day=day,
                        user_id=u.id,
                        code=code,
                        updated_by_id=editor_id,
                    )
                )
            written += 1

    await session.commit()
    return written
