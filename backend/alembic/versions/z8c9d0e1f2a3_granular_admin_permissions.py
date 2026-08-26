"""granular admin permissions: users, imports, backups

Revision ID: z8c9d0e1f2a3
Revises: y7b8c9d0e1f2
Create Date: 2026-08-26
"""

from __future__ import annotations

import uuid

from alembic import op
from sqlalchemy import text

revision = "z8c9d0e1f2a3"
down_revision = "y7b8c9d0e1f2"
branch_labels = None
depends_on = None

_NEW = [
    (
        "users.create",
        "Добавление пользователей\nСоздание учётных записей. Полное редактирование — отдельное право «Управление пользователями».",
    ),
    (
        "users.password.reset",
        "Сброс пароля\nМожно задать новый пароль пользователю. Не даёт создавать или удалять учётные записи.",
    ),
    (
        "users.delete",
        "Удаление пользователей\nБезвозвратное удаление учётной записи.",
    ),
    (
        "admin.settings.manage",
        "Настройки системы в админке\nАвтоархивация задач, аудит, хранение уведомлений.",
    ),
    (
        "admin.backups.manage",
        "Резервные копии\nСоздание, скачивание и удаление дампов БД, расписание бэкапов.",
    ),
    (
        "admin.audit.read",
        "Журнал аудита\nПросмотр журнала действий в админке.",
    ),
    (
        "admin.import.users",
        "Импорт сотрудников из Excel\nЗагрузка пользователей из файла в админке.",
    ),
    (
        "admin.import.tasks",
        "Импорт задач из Excel\nЗагрузка задачника в админке.",
    ),
    (
        "admin.import.vacations",
        "Импорт отпусков из Excel\nЗагрузка графика отпусков в админке.",
    ),
    (
        "admin.import.knowledge",
        "Импорт базы знаний из Obsidian\nЗагрузка статей из zip/папок в админке.",
    ),
    (
        "admin.import.uspd",
        "Импорт УСПД\nObsidian и Excel SIM для справочника УСПД в админке.",
    ),
]


def upgrade() -> None:
    conn = op.get_bind()
    for code, desc in _NEW:
        conn.execute(
            text(
                """
                INSERT INTO permissions (id, code, description)
                VALUES (:id, :code, :description)
                ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
                """
            ),
            {"id": uuid.uuid4(), "code": code, "description": desc},
        )
    conn.execute(
        text(
            """
            UPDATE permissions
            SET description = :desc
            WHERE code = 'users.manage'
            """
        ),
        {
            "desc": (
                "Управление пользователями\n"
                "Список, правка ФИО/ролей/систем, активация. Создание, пароль и удаление пользователей"
            )
        },
    )
    conn.execute(
        text(
            """
            UPDATE permissions
            SET description = :desc
            WHERE code = 'roles.manage'
            """
        ),
        {
            "desc": (
                "Управление ролями и правами\n"
                "Создание ролей и переключатели прав."
            )
        },
    )
    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            JOIN permissions p ON p.code IN (
                'users.create', 'users.password.reset', 'users.delete',
                'admin.settings.manage', 'admin.backups.manage', 'admin.audit.read',
                'admin.import.users', 'admin.import.tasks', 'admin.import.vacations',
                'admin.import.knowledge', 'admin.import.uspd'
            )
            WHERE r.id IN (
                SELECT rp.role_id
                FROM role_permissions rp
                JOIN permissions px ON px.id = rp.permission_id
                WHERE px.code IN ('users.manage', 'roles.manage')
            )
            AND NOT EXISTS (
                SELECT 1 FROM role_permissions x
                WHERE x.role_id = r.id AND x.permission_id = p.id
            )
            """
        )
    )
    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            CROSS JOIN permissions p
            WHERE r.slug = 'super_admin'
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions x
                WHERE x.role_id = r.id AND x.permission_id = p.id
              )
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    codes = [c for c, _ in _NEW]
    for code in codes:
        conn.execute(
            text(
                "DELETE FROM role_permissions WHERE permission_id IN "
                "(SELECT id FROM permissions WHERE code = :code)"
            ),
            {"code": code},
        )
        conn.execute(text("DELETE FROM permissions WHERE code = :code"), {"code": code})
