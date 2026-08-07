from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    EmployeeProfile,
    KanbanColumn,
    Notification,
    NotificationType,
    Permission,
    Task,
    User,
)
from app.models.role import RolePermission, UserRole
from app.models.task import task_assignees_table
from app.permissions import EMPLOYEE_DIRECTORY_COMPLIANCE_NOTIFICATIONS_RECEIVE

_DUE_SOON_WINDOW = timedelta(days=3)


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
        .on_conflict_do_nothing(index_elements=["user_id", "type", "task_id"])
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
        .on_conflict_do_nothing(index_elements=["user_id", "type", "task_id"])
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
        .where(User.is_active.is_(True))
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
        )
        .join(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(User.is_active.is_(True))
        .where(
            or_(
                and_(
                    EmployeeProfile.pass_has.is_(True),
                    EmployeeProfile.pass_valid_to.is_not(None),
                    EmployeeProfile.pass_valid_to <= due_until,
                ),
                and_(
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
    for employee_id, employee_name, pass_has, pass_valid_to, exam_passed, exam_valid_to in employees:
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
        if exam_passed:
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
