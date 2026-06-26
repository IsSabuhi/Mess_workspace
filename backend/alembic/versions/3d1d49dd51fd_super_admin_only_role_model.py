"""super_admin_only_role_model

Revision ID: 3d1d49dd51fd
Revises: fab1b5cb1808
Create Date: 2026-05-29 17:19:38.299719

"""
from datetime import datetime, timezone
import uuid
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '3d1d49dd51fd'
down_revision: Union[str, None] = 'fab1b5cb1808'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    super_admin_id = conn.execute(text("SELECT id FROM roles WHERE slug = 'super_admin'")).scalar()
    viewer_id = conn.execute(text("SELECT id FROM roles WHERE slug = 'viewer'")).scalar()
    admin_id = conn.execute(text("SELECT id FROM roles WHERE slug = 'admin'")).scalar()

    if super_admin_id is not None:
        conn.execute(
            text(
                """
                UPDATE roles
                SET name = 'Администратор',
                    description = 'Полный доступ ко всем функциям (системная роль).'
                WHERE id = CAST(:role_id AS uuid)
                """
            ),
            {"role_id": str(super_admin_id)},
        )
        # Администратор (slug=super_admin) всегда имеет все доступные на момент миграции права.
        conn.execute(
            text(
                """
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT CAST(:role_id AS uuid), p.id
                FROM permissions p
                WHERE NOT EXISTS (
                    SELECT 1 FROM role_permissions rp
                    WHERE rp.role_id = CAST(:role_id AS uuid) AND rp.permission_id = p.id
                )
                """
            ),
            {"role_id": str(super_admin_id)},
        )

    if viewer_id is not None:
        conn.execute(
            text(
                """
                DELETE FROM role_permissions rp
                USING permissions p
                WHERE rp.permission_id = p.id
                  AND rp.role_id = CAST(:viewer_id AS uuid)
                  AND p.code NOT IN ('tasks.read.all', 'knowledge.read.all', 'employee_directory.read', 'schedule.read')
                """
            ),
            {"viewer_id": str(viewer_id)},
        )
        conn.execute(
            text(
                """
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT CAST(:viewer_id AS uuid), p.id
                FROM permissions p
                WHERE p.code IN ('tasks.read.all', 'knowledge.read.all', 'employee_directory.read', 'schedule.read')
                  AND NOT EXISTS (
                      SELECT 1 FROM role_permissions rp
                      WHERE rp.role_id = CAST(:viewer_id AS uuid) AND rp.permission_id = p.id
                  )
                """
            ),
            {"viewer_id": str(viewer_id)},
        )

    if admin_id is not None:
        if super_admin_id is not None:
            # Переносим участников admin в super_admin.
            conn.execute(
                text(
                    """
                    INSERT INTO user_roles (user_id, role_id)
                    SELECT ur.user_id, CAST(:super_admin_id AS uuid)
                    FROM user_roles ur
                    WHERE ur.role_id = CAST(:admin_id AS uuid)
                      AND NOT EXISTS (
                          SELECT 1 FROM user_roles x
                          WHERE x.user_id = ur.user_id AND x.role_id = CAST(:super_admin_id AS uuid)
                      )
                    """
                ),
                {"admin_id": str(admin_id), "super_admin_id": str(super_admin_id)},
            )
        conn.execute(text("DELETE FROM user_roles WHERE role_id = CAST(:admin_id AS uuid)"), {"admin_id": str(admin_id)})
        conn.execute(
            text("DELETE FROM role_permissions WHERE role_id = CAST(:admin_id AS uuid)"),
            {"admin_id": str(admin_id)},
        )
        conn.execute(text("DELETE FROM roles WHERE id = CAST(:admin_id AS uuid)"), {"admin_id": str(admin_id)})


def downgrade() -> None:
    conn = op.get_bind()
    admin_id = conn.execute(text("SELECT id FROM roles WHERE slug = 'admin'")).scalar()
    if admin_id is None:
        admin_id = uuid.uuid4()
        conn.execute(
            text(
                """
                INSERT INTO roles (id, name, slug, description, is_system, created_at)
                VALUES (:id, :name, :slug, :description, true, :created_at)
                """
            ),
            {
                "id": admin_id,
                "name": "Администратор",
                "slug": "admin",
                "description": "Управление пользователями, ролями и всеми модулями (системная роль).",
                "created_at": datetime.now(timezone.utc),
            },
        )
    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT CAST(:admin_id AS uuid), p.id
            FROM permissions p
            WHERE NOT EXISTS (
                SELECT 1 FROM role_permissions rp
                WHERE rp.role_id = CAST(:admin_id AS uuid) AND rp.permission_id = p.id
            )
            """
        ),
        {"admin_id": str(admin_id)},
    )
