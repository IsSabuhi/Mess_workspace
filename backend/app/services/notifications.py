from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, delete, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

from app.models import (
    EmployeeProfile,
    KanbanColumn,
    Notification,
    NotificationType,
    Permission,
    PersonalNote,
    Task,
    User,
)
from app.models.role import RolePermission, UserRole
from app.models.system_setting import SystemSetting
from app.models.task import task_assignees_table
from app.permissions import EMPLOYEE_DIRECTORY_COMPLIANCE_NOTIFICATIONS_RECEIVE
from app.services.employee_status import user_is_not_dismissed

NOTIFICATIONS_LAST_CLEANUP_AT_KEY = "notifications_last_cleanup_at"
NOTIFICATIONS_CLEANUP_ENABLED_KEY = "notifications_cleanup_enabled"
NOTIFICATIONS_RETENTION_READ_DAYS_KEY = "notifications_retention_read_days"
NOTIFICATIONS_RETENTION_UNREAD_DAYS_KEY = "notifications_retention_unread_days"
NOTIFICATIONS_RETENTION_NOTE_REMINDER_DAYS_KEY = "notifications_retention_note_reminder_days"

NOTIFICATIONS_CLEANUP_ENABLED_DEFAULT = True
_RETENTION_DAYS_MIN = 7
_RETENTION_DAYS_MAX = 3650

_DUE_SOON_WINDOW = timedelta(days=3)
# Совпадает с частичным unique-индексом uq_notifications_user_type_task (только дедлайны).
_DEADLINE_TASK_UNIQUE_WHERE = text(
    "type IN ('task_due_3_days'::notification_type, 'task_overdue'::notification_type)"
)


def _clamp_retention_days(value: int) -> int:
    return max(_RETENTION_DAYS_MIN, min(int(value), _RETENTION_DAYS_MAX))


async def _get_bool_setting(session: AsyncSession, key: str, default: bool) -> bool:
    row = await session.get(SystemSetting, key)
    if not row:
        return default
    return str(row.value).strip().lower() not in {"0", "false", "off", "no"}


async def _get_int_setting(session: AsyncSession, key: str, default: int) -> int:
    row = await session.get(SystemSetting, key)
    if not row:
        return _clamp_retention_days(default)
    try:
        return _clamp_retention_days(int(row.value))
    except (TypeError, ValueError):
        return _clamp_retention_days(default)


async def _set_setting(session: AsyncSession, key: str, value: str) -> None:
    row = await session.get(SystemSetting, key)
    if row:
        row.value = value
    else:
        session.add(SystemSetting(key=key, value=value))


async def get_notification_cleanup_enabled(session: AsyncSession) -> bool:
    return await _get_bool_setting(session, NOTIFICATIONS_CLEANUP_ENABLED_KEY, NOTIFICATIONS_CLEANUP_ENABLED_DEFAULT)


async def get_notification_retention_settings(session: AsyncSession) -> tuple[bool, int, int, int]:
    defaults = get_settings()
    enabled = await get_notification_cleanup_enabled(session)
    read_days = await _get_int_setting(
        session, NOTIFICATIONS_RETENTION_READ_DAYS_KEY, defaults.notification_retention_read_days
    )
    unread_days = await _get_int_setting(
        session, NOTIFICATIONS_RETENTION_UNREAD_DAYS_KEY, defaults.notification_retention_unread_days
    )
    note_days = await _get_int_setting(
        session,
        NOTIFICATIONS_RETENTION_NOTE_REMINDER_DAYS_KEY,
        defaults.notification_retention_note_reminder_days,
    )
    unread_days = max(unread_days, read_days)
    return enabled, read_days, unread_days, note_days


async def set_notification_retention_settings(
    session: AsyncSession,
    *,
    enabled: bool | None = None,
    read_days: int | None = None,
    unread_days: int | None = None,
    note_reminder_days: int | None = None,
) -> tuple[bool, int, int, int]:
    if enabled is not None:
        await _set_setting(session, NOTIFICATIONS_CLEANUP_ENABLED_KEY, "1" if enabled else "0")
    if read_days is not None:
        await _set_setting(
            session, NOTIFICATIONS_RETENTION_READ_DAYS_KEY, str(_clamp_retention_days(read_days))
        )
    if unread_days is not None:
        await _set_setting(
            session, NOTIFICATIONS_RETENTION_UNREAD_DAYS_KEY, str(_clamp_retention_days(unread_days))
        )
    if note_reminder_days is not None:
        await _set_setting(
            session,
            NOTIFICATIONS_RETENTION_NOTE_REMINDER_DAYS_KEY,
            str(_clamp_retention_days(note_reminder_days)),
        )
    enabled_out, read_out, unread_out, note_out = await get_notification_retention_settings(session)
    if unread_out < read_out:
        unread_out = read_out
        await _set_setting(session, NOTIFICATIONS_RETENTION_UNREAD_DAYS_KEY, str(unread_out))
    await session.flush()
    return enabled_out, read_out, unread_out, note_out


def next_daily_reminder_at(current: datetime, now: datetime) -> datetime:
    """Следующее срабатывание ежедневного напоминания строго в будущем."""
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    nxt = current + timedelta(days=1)
    while nxt <= now:
        nxt += timedelta(days=1)
    return nxt


def _deadline_notification_payload(
    *,
    user_id,
    task_id,
    task_title: str,
    due_at: datetime,
    now: datetime,
) -> dict | None:
    if due_at < now:
        notification_type = NotificationType.task_overdue
        title = f"Задача просрочена: {task_title}"
        body = "Срок задачи истек. Откройте задачу и обновите дедлайн или статус."
    elif due_at <= now + _DUE_SOON_WINDOW:
        notification_type = NotificationType.task_due_3_days
        title = f"Срок задачи до 3 дней: {task_title}"
        body = "Приближается дедлайн задачи. Проверьте прогресс и план закрытия."
    else:
        return None
    return {
        "user_id": user_id,
        "type": notification_type,
        "title": title,
        "body": body,
        "task_id": task_id,
    }


async def sync_task_deadline_notifications_for_user(session: AsyncSession, user_id) -> int:
    """Идемпотентно создаёт уведомления о сроках для одного активного пользователя."""
    now = datetime.now(timezone.utc)
    stmt = (
        select(Task.id, Task.title, Task.due_at)
        .join(KanbanColumn, KanbanColumn.id == Task.column_id)
        .join(task_assignees_table, task_assignees_table.c.task_id == Task.id)
        .where(task_assignees_table.c.user_id == user_id)
        .where(Task.archived_at.is_(None))
        .where(Task.due_at.is_not(None))
        .where(KanbanColumn.is_done_column.is_(False))
    )
    rows = (await session.execute(stmt)).all()
    payloads = []
    for task_id, task_title, due_at in rows:
        if due_at is None:
            continue
        payload = _deadline_notification_payload(
            user_id=user_id,
            task_id=task_id,
            task_title=task_title,
            due_at=due_at,
            now=now,
        )
        if payload is not None:
            payloads.append(payload)
    if not payloads:
        return 0

    result = await session.execute(
        insert(Notification)
        .values(payloads)
        .on_conflict_do_nothing(
            index_elements=["user_id", "type", "task_id"],
            index_where=_DEADLINE_TASK_UNIQUE_WHERE,
        )
        .returning(Notification.id)
    )
    return len(result.scalars().all())


async def sync_task_deadline_notifications_all(session: AsyncSession) -> int:
    """Фоновая проверка дедлайнов всех активных назначенных пользователей."""
    now = datetime.now(timezone.utc)
    stmt = (
        select(task_assignees_table.c.user_id, Task.id, Task.title, Task.due_at)
        .join(Task, Task.id == task_assignees_table.c.task_id)
        .join(User, User.id == task_assignees_table.c.user_id)
        .join(KanbanColumn, KanbanColumn.id == Task.column_id)
        .where(User.is_active.is_(True))
        .where(Task.archived_at.is_(None))
        .where(Task.due_at.is_not(None))
        .where(KanbanColumn.is_done_column.is_(False))
    )
    rows = (await session.execute(stmt)).all()
    payloads = []
    for user_id, task_id, task_title, due_at in rows:
        if due_at is None:
            continue
        payload = _deadline_notification_payload(
            user_id=user_id,
            task_id=task_id,
            task_title=task_title,
            due_at=due_at,
            now=now,
        )
        if payload is not None:
            payloads.append(payload)
    if not payloads:
        return 0

    result = await session.execute(
        insert(Notification)
        .values(payloads)
        .on_conflict_do_nothing(
            index_elements=["user_id", "type", "task_id"],
            index_where=_DEADLINE_TASK_UNIQUE_WHERE,
        )
        .returning(Notification.id)
    )
    created = len(result.scalars().all())
    if created:
        await session.commit()
    return created


async def sync_task_deadline_notifications(session: AsyncSession, user: User) -> int:
    """Совместимость для точечных вызовов; HTTP endpoints больше её не вызывают."""
    created = await sync_task_deadline_notifications_for_user(session, user.id)
    if created:
        await session.commit()
    return created


async def _compliance_notification_recipient_ids(session: AsyncSession) -> set:
    """Активные пользователи с назначенным правом плюс все суперпользователи."""
    stmt = (
        select(User.id)
        .outerjoin(UserRole, UserRole.user_id == User.id)
        .outerjoin(RolePermission, RolePermission.role_id == UserRole.role_id)
        .outerjoin(Permission, Permission.id == RolePermission.permission_id)
        .where(User.is_active.is_(True), user_is_not_dismissed())
        .where(
            or_(
                User.is_superuser.is_(True),
                Permission.code == EMPLOYEE_DIRECTORY_COMPLIANCE_NOTIFICATIONS_RECEIVE,
            )
        )
        .distinct()
    )
    return set((await session.execute(stmt)).scalars().all())


def _compliance_notification_payload(
    *,
    recipient_id,
    employee_user_id,
    employee_name: str,
    valid_to: date,
    notification_type: NotificationType,
    title_subject: str,
    body_subject: str,
    overdue: bool,
) -> dict:
    if overdue:
        title = f"{title_subject} просрочен: {employee_name}"
        body = f"Срок {body_subject} сотрудника {employee_name} истёк {valid_to:%d.%m.%Y}."
    else:
        title = f"Срок {body_subject} истекает: {employee_name}"
        body = f"Срок {body_subject} сотрудника {employee_name} истекает {valid_to:%d.%m.%Y}."
    return {
        "user_id": recipient_id,
        "type": notification_type,
        "title": title,
        "body": body,
        "employee_user_id": employee_user_id,
    }


def _append_compliance_payloads(
    payloads: list[dict],
    *,
    recipients: set,
    employee_id,
    employee_name: str,
    valid_to: date | None,
    today: date,
    due_until: date,
    due_type: NotificationType,
    overdue_type: NotificationType,
    title_subject: str,
    body_subject: str,
) -> None:
    if valid_to is None:
        return
    if valid_to < today:
        notification_type = overdue_type
        overdue = True
    elif valid_to <= due_until:
        notification_type = due_type
        overdue = False
    else:
        return
    payloads.extend(
        _compliance_notification_payload(
            recipient_id=recipient_id,
            employee_user_id=employee_id,
            employee_name=employee_name,
            valid_to=valid_to,
            notification_type=notification_type,
            title_subject=title_subject,
            body_subject=body_subject,
            overdue=overdue,
        )
        for recipient_id in recipients
    )


async def sync_employee_compliance_notifications(session: AsyncSession) -> int:
    """Уведомляет сотрудника и назначенных получателей о скором/истёкшем сроке документов."""
    today = datetime.now().date()
    due_until = today + _DUE_SOON_WINDOW
    stmt = (
        select(
            User.id,
            User.full_name,
            EmployeeProfile.pass_has,
            EmployeeProfile.pass_valid_to,
            EmployeeProfile.exam_electrical_passed,
            EmployeeProfile.exam_electrical_valid_to,
            EmployeeProfile.is_remote,
        )
        .join(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(User.is_active.is_(True), EmployeeProfile.is_dismissed.is_(False))
        .where(
            or_(
                and_(
                    EmployeeProfile.pass_has.is_(True),
                    EmployeeProfile.pass_valid_to.is_not(None),
                    EmployeeProfile.pass_valid_to <= due_until,
                ),
                and_(
                    EmployeeProfile.is_remote.is_(False),
                    EmployeeProfile.exam_electrical_passed.is_(True),
                    EmployeeProfile.exam_electrical_valid_to.is_not(None),
                    EmployeeProfile.exam_electrical_valid_to <= due_until,
                ),
            )
        )
    )
    employees = (await session.execute(stmt)).all()
    if not employees:
        return 0

    authorized_recipients = await _compliance_notification_recipient_ids(session)
    payloads: list[dict] = []
    for (
        employee_id,
        employee_name,
        pass_has,
        pass_valid_to,
        exam_passed,
        exam_valid_to,
        is_remote,
    ) in employees:
        recipients = authorized_recipients | {employee_id}
        if pass_has:
            _append_compliance_payloads(
                payloads,
                recipients=recipients,
                employee_id=employee_id,
                employee_name=employee_name,
                valid_to=pass_valid_to,
                today=today,
                due_until=due_until,
                due_type=NotificationType.employee_pass_due_3_days,
                overdue_type=NotificationType.employee_pass_overdue,
                title_subject="Пропуск",
                body_subject="пропуска",
            )
        if exam_passed and not is_remote:
            _append_compliance_payloads(
                payloads,
                recipients=recipients,
                employee_id=employee_id,
                employee_name=employee_name,
                valid_to=exam_valid_to,
                today=today,
                due_until=due_until,
                due_type=NotificationType.employee_exam_electrical_due_3_days,
                overdue_type=NotificationType.employee_exam_electrical_overdue,
                title_subject="Экзамен",
                body_subject="экзамена по электробезопасности",
            )
    if not payloads:
        return 0

    result = await session.execute(
        insert(Notification)
        .values(payloads)
        .on_conflict_do_nothing(constraint="uq_notifications_user_type_employee")
        .returning(Notification.id)
    )
    created = len(result.scalars().all())
    if created:
        await session.commit()
    return created


async def sync_note_reminder_notifications(session: AsyncSession) -> int:
    """Создать уведомления по наступившим напоминаниям личных заметок."""
    now = datetime.now(timezone.utc)
    notes = (
        await session.execute(
            select(PersonalNote).where(
                PersonalNote.reminder_at.is_not(None),
                PersonalNote.reminder_at <= now,
                PersonalNote.deleted_at.is_(None),
                or_(
                    PersonalNote.reminder_repeat_daily.is_(True),
                    PersonalNote.reminder_notified_at.is_(None),
                ),
            )
        )
    ).scalars().all()
    if not notes:
        return 0

    created = 0
    for note in notes:
        title_text = (note.title or "").strip() or "Без названия"
        daily = bool(note.reminder_repeat_daily)
        session.add(
            Notification(
                user_id=note.owner_user_id,
                type=NotificationType.note_reminder,
                title=f"Напоминание: {title_text}",
                body=(
                    "Ежедневное напоминание по личной заметке."
                    if daily
                    else "Срок напоминания по личной заметке."
                ),
                personal_note_id=note.id,
            )
        )
        created += 1
        if daily and note.reminder_at is not None:
            note.reminder_at = next_daily_reminder_at(note.reminder_at, now)
            note.reminder_notified_at = None
        else:
            note.reminder_notified_at = now

    await session.commit()
    return created


async def cleanup_old_notifications(session: AsyncSession, *, force: bool = False) -> int:
    """Удаляет устаревшие уведомления. Не чаще одного раза в сутки.

    Сроки берутся из настроек админки (иначе — значения по умолчанию / .env).
    """
    enabled, read_days, unread_days, note_days = await get_notification_retention_settings(session)
    if not enabled:
        return 0

    now = datetime.now(timezone.utc)
    last_row = await session.get(SystemSetting, NOTIFICATIONS_LAST_CLEANUP_AT_KEY)
    if last_row and not force:
        try:
            last = datetime.fromisoformat(last_row.value)
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if now - last < timedelta(hours=24):
                return 0
        except ValueError:
            pass

    read_cutoff = now - timedelta(days=read_days)
    unread_cutoff = now - timedelta(days=unread_days)
    note_cutoff = now - timedelta(days=note_days)

    result = await session.execute(
        delete(Notification).where(
            or_(
                and_(
                    Notification.type == NotificationType.note_reminder,
                    Notification.created_at < note_cutoff,
                ),
                and_(
                    Notification.type != NotificationType.note_reminder,
                    Notification.read_at.is_not(None),
                    Notification.created_at < read_cutoff,
                ),
                and_(
                    Notification.type != NotificationType.note_reminder,
                    Notification.read_at.is_(None),
                    Notification.created_at < unread_cutoff,
                ),
            )
        )
    )
    deleted = int(result.rowcount or 0)
    stamp = now.isoformat()
    if last_row:
        last_row.value = stamp
    else:
        session.add(SystemSetting(key=NOTIFICATIONS_LAST_CLEANUP_AT_KEY, value=stamp))
    await session.commit()
    return deleted
