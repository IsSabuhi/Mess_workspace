"""Granular employee_directory compliance vs profile permissions

Revision ID: f0a1b2c3d4e5
Revises: e5f6a7b8c9d0
Create Date: 2026-04-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
import uuid

revision: str = "f0a1b2c3d4e5"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    ins = sa.text(
        """
        INSERT INTO permissions (id, code, description)
        VALUES (:id, :code, :description)
        ON CONFLICT (code) DO NOTHING
        """
    )
    conn.execute(
        ins,
        {
            "id": uuid.uuid4(),
            "code": "employee_directory.compliance.manage",
            "description": "Редактирование экзаменов и пропусков (вкладка «Экзамены и пропуски»)",
        },
    )
    conn.execute(
        ins,
        {
            "id": uuid.uuid4(),
            "code": "employee_directory.profile.manage",
            "description": "Кадровый справочник: график, отпуск, должность, системы, дата рождения",
        },
    )
    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT DISTINCT rp.role_id, p_new.id
            FROM role_permissions rp
            JOIN permissions p_old ON p_old.id = rp.permission_id
              AND p_old.code = 'employee_directory.manage'
            CROSS JOIN permissions p_new
            WHERE p_new.code IN (
              'employee_directory.compliance.manage',
              'employee_directory.profile.manage'
            )
            ON CONFLICT DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            DELETE FROM role_permissions
            WHERE permission_id IN (
              SELECT id FROM permissions
              WHERE code IN (
                'employee_directory.compliance.manage',
                'employee_directory.profile.manage'
              )
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            DELETE FROM permissions
            WHERE code IN (
              'employee_directory.compliance.manage',
              'employee_directory.profile.manage'
            )
            """
        )
    )
