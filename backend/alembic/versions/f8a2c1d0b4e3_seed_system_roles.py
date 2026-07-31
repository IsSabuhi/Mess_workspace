"""seed system roles with permissions

Revision ID: f8a2c1d0b4e3
Revises: e5e3ce80475c
Create Date: 2026-04-07

"""
from datetime import datetime, timezone
import uuid
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "f8a2c1d0b4e3"
down_revision: Union[str, None] = "e5e3ce80475c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEAD_CODES = (
    "tasks.create",
    "tasks.read.all",
    "tasks.read.assigned",
    "tasks.update.all",
    "tasks.update.assigned",
    "tasks.delete",
    "tasks.move",
    "boards.create",
    # Структура доски (колонки/теги/настройки) — только у администратора, не у руководителя.
    "systems.manage",
    # БЗ: только чтение всех пространств; правка — через участников (editor/admin).
    "knowledge.read.all",
)

_MANAGER_CODES = (
    "tasks.create",
    "tasks.read.all",
    "tasks.read.assigned",
    "tasks.update.assigned",
    "tasks.move",
    "boards.create",
    "knowledge.read.all",
)

_EMPLOYEE_CODES = (
    "tasks.create",
    "tasks.read.assigned",
    "tasks.update.assigned",
    "tasks.move",
    "knowledge.read.all",
)

_VIEWER_CODES = (
    "tasks.read.all",
    "knowledge.read.all",
    "employee_directory.read",
    "schedule.read",
)


def upgrade() -> None:
    now = datetime.now(timezone.utc)
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, code FROM permissions")).fetchall()
    code_to_id = {r[1]: r[0] for r in rows}

    # None = выдать все права, которые уже есть в БД (после initial их меньше, чем в app.permissions;
    # жёсткая привязка к ALL_PERMISSION_CODES здесь ломала миграции и могла приводить к долгим сбоям).
    roles_spec: list[tuple[str, str, str, tuple[str, ...] | None]] = [
        (
            "super_admin",
            "Администратор",
            "Полный доступ ко всем функциям (системная роль).",
            None,
        ),
        (
            "lead",
            "Начальник отдела",
            "Задачи (просмотр/редактирование), системы, создание досок; БЗ только чтение. Без управления колонками, тегами и настройками доски.",
            _LEAD_CODES,
        ),
        (
            "manager",
            "Менеджер",
            "Просмотр задач команды и создание кастомных досок (системная роль).",
            _MANAGER_CODES,
        ),
        (
            "employee",
            "Сотрудник",
            "Свои задачи и чтение базы знаний (системная роль).",
            _EMPLOYEE_CODES,
        ),
        (
            "viewer",
            "Наблюдатель",
            "Только просмотр задач и базы знаний (системная роль).",
            _VIEWER_CODES,
        ),
    ]

    for slug, name, desc, codes in roles_spec:
        existing = conn.execute(text("SELECT id FROM roles WHERE slug = :slug"), {"slug": slug}).fetchone()
        if existing:
            continue
        role_id = uuid.uuid4()
        conn.execute(
            text(
                "INSERT INTO roles (id, name, slug, description, is_system, created_at) "
                "VALUES (:id, :name, :slug, :description, true, :created_at)"
            ),
            {"id": role_id, "name": name, "slug": slug, "description": desc, "created_at": now},
        )
        if codes is None:
            conn.execute(
                text(
                    "INSERT INTO role_permissions (role_id, permission_id) "
                    "SELECT CAST(:role_id AS uuid), p.id FROM permissions p"
                ),
                {"role_id": str(role_id)},
            )
        else:
            for code in codes:
                pid = code_to_id.get(code)
                if pid is None:
                    # Право появится в последующих миграциях; роль догонится там.
                    continue
                conn.execute(
                    text(
                        "INSERT INTO role_permissions (role_id, permission_id) "
                        "VALUES (:role_id, :permission_id)"
                    ),
                    {"role_id": role_id, "permission_id": pid},
                )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            "DELETE FROM role_permissions WHERE role_id IN "
            "(SELECT id FROM roles WHERE is_system = true)"
        )
    )
    conn.execute(
        text(
            "DELETE FROM user_roles WHERE role_id IN "
            "(SELECT id FROM roles WHERE is_system = true)"
        )
    )
    conn.execute(text("DELETE FROM roles WHERE is_system = true"))
