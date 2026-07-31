"""boards.create for lead/manager; ensure Manager position and role

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-07-27
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text

revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None

_PERM_CODE = "boards.create"
_PERM_DESC = (
    "Создание кастомных (системных) досок\n"
    "Доступно начальнику отдела и менеджеру; основная доска не создаётся этим правом."
)


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)

    # Право
    conn.execute(
        text(
            """
            INSERT INTO permissions (id, code, description)
            VALUES (:id, :code, :desc)
            ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
            """
        ),
        {"id": uuid.uuid4(), "code": _PERM_CODE, "desc": _PERM_DESC},
    )

    # Должность «Менеджер» (на случай старых БД без сида)
    exists_pos = conn.execute(
        text("SELECT id FROM positions WHERE slug = 'manager' LIMIT 1")
    ).fetchone()
    if not exists_pos:
        conn.execute(
            text(
                """
                INSERT INTO positions (id, name, slug, description, sort_order, is_active, created_at)
                VALUES (:id, :name, :slug, NULL, :so, true, :created_at)
                """
            ),
            {
                "id": uuid.uuid4(),
                "name": "Менеджер",
                "slug": "manager",
                "so": 4,
                "created_at": now,
            },
        )

    # Роль «Менеджер» (если ещё нет — минимальный системный набор + boards.create)
    role_row = conn.execute(text("SELECT id FROM roles WHERE slug = 'manager' LIMIT 1")).fetchone()
    if not role_row:
        role_id = uuid.uuid4()
        conn.execute(
            text(
                """
                INSERT INTO roles (id, name, slug, description, is_system, created_at)
                VALUES (:id, :name, :slug, :description, true, :created_at)
                """
            ),
            {
                "id": role_id,
                "name": "Менеджер",
                "slug": "manager",
                "description": "Просмотр задач команды и создание кастомных досок.",
                "created_at": now,
            },
        )
        for code in (
            "tasks.read.all",
            "tasks.read.assigned",
            "tasks.create",
            "tasks.update.assigned",
            "tasks.move",
            "knowledge.read.all",
            _PERM_CODE,
        ):
            conn.execute(
                text(
                    """
                    INSERT INTO role_permissions (role_id, permission_id)
                    SELECT CAST(:role_id AS uuid), p.id
                    FROM permissions p
                    WHERE p.code = :code
                      AND NOT EXISTS (
                        SELECT 1 FROM role_permissions rp
                        WHERE rp.role_id = CAST(:role_id AS uuid) AND rp.permission_id = p.id
                      )
                    """
                ),
                {"role_id": str(role_id), "code": code},
            )
    else:
        # Существующей роли manager — только boards.create
        conn.execute(
            text(
                """
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id
                FROM roles r
                CROSS JOIN permissions p
                WHERE r.slug = 'manager' AND p.code = :code
                  AND NOT EXISTS (
                    SELECT 1 FROM role_permissions rp
                    WHERE rp.role_id = r.id AND rp.permission_id = p.id
                  )
                """
            ),
            {"code": _PERM_CODE},
        )

    # Начальник отдела
    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            CROSS JOIN permissions p
            WHERE r.slug = 'lead' AND p.code = :code
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp
                WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        ),
        {"code": _PERM_CODE},
    )

    # Администратору — все права уже обычно выданы; на всякий случай добавим
    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            CROSS JOIN permissions p
            WHERE r.slug = 'super_admin' AND p.code = :code
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp
                WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        ),
        {"code": _PERM_CODE},
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            """
            DELETE FROM role_permissions
            WHERE permission_id IN (SELECT id FROM permissions WHERE code = :code)
            """
        ),
        {"code": _PERM_CODE},
    )
    conn.execute(text("DELETE FROM permissions WHERE code = :code"), {"code": _PERM_CODE})
