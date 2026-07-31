"""knowledge: edit only via space membership; lead read-only KB

Revision ID: c4d5e6f7a8b0
Revises: a2b3c4d5e6f7
Create Date: 2026-07-22
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "c4d5e6f7a8b0"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None

_PERM_DESCS: dict[str, str] = {
    "knowledge.read.all": (
        "Чтение всей базы знаний\n"
        "Видит все пространства и опубликованные статьи. Не даёт редактирование."
    ),
    "knowledge.manage.all": (
        "Создание пространств БЗ и глобальных шаблонов\n"
        "Не даёт само по себе править чужие пространства — для правок нужна роль "
        "editor/admin в участниках пространства."
    ),
    "knowledge.space.manage": (
        "Устарело\n"
        "Редактирование статей только через роль editor/admin в участниках пространства. "
        "Право можно не выдавать."
    ),
}


def upgrade() -> None:
    conn = op.get_bind()
    # Начальник отдела: только чтение БЗ, без manage/space.manage.
    conn.execute(
        text(
            """
            DELETE FROM role_permissions
            WHERE role_id IN (SELECT id FROM roles WHERE slug = 'lead')
              AND permission_id IN (
                SELECT id FROM permissions
                WHERE code IN ('knowledge.manage.all', 'knowledge.space.manage')
              )
            """
        )
    )
    for code, desc in _PERM_DESCS.items():
        conn.execute(
            text("UPDATE permissions SET description = :desc WHERE code = :code"),
            {"desc": desc, "code": code},
        )
    conn.execute(
        text(
            """
            UPDATE roles
            SET description = :desc
            WHERE slug = 'lead'
            """
        ),
        {
            "desc": (
                "Задачи (просмотр/редактирование), системы; база знаний — только чтение. "
                "Без управления колонками, тегами и настройками доски."
            )
        },
    )


def downgrade() -> None:
    conn = op.get_bind()
    # Вернуть lead manage/space.manage (как в исходном сиде).
    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            CROSS JOIN permissions p
            WHERE r.slug = 'lead'
              AND p.code IN ('knowledge.manage.all', 'knowledge.space.manage')
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp
                WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        )
    )
    conn.execute(
        text(
            """
            UPDATE roles
            SET description = :desc
            WHERE slug = 'lead'
            """
        ),
        {
            "desc": (
                "Задачи (просмотр/редактирование), системы и БЗ. "
                "Без управления колонками, тегами и настройками доски."
            )
        },
    )
