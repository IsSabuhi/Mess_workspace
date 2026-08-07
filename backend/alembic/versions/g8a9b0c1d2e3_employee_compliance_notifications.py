"""add employee compliance notification permission and recipient link

Revision ID: g8a9b0c1d2e3
Revises: f7a8b9c0d1e2
Create Date: 2026-08-03
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op

revision = "g8a9b0c1d2e3"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None

_PERMISSION_CODE = "employee_directory.compliance.notifications.receive"


def upgrade() -> None:
    # PostgreSQL enum labels cannot be removed safely in downgrade; adding them before
    # the column makes both the model and worker compatible with the deployed schema.
    op.execute(sa.text("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'employee_pass_due_3_days'"))
    op.execute(sa.text("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'employee_exam_electrical_due_3_days'"))
    op.add_column(
        "notifications",
        sa.Column("employee_user_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_notifications_employee_user_id_users",
        "notifications",
        "users",
        ["employee_user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_notifications_user_type_employee",
        "notifications",
        ["user_id", "type", "employee_user_id"],
    )
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO permissions (id, code, description)
            VALUES (:id, :code, :description)
            ON CONFLICT (code) DO NOTHING
            """
        ),
        {
            "id": uuid.uuid4(),
            "code": _PERMISSION_CODE,
            "description": (
                "Получение уведомлений о сроках пропусков и допуска "
                "к экзамену сотрудников"
            ),
        },
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            DELETE FROM role_permissions
            WHERE permission_id = (
                SELECT id FROM permissions WHERE code = :code
            )
            """
        ),
        {"code": _PERMISSION_CODE},
    )
    conn.execute(sa.text("DELETE FROM permissions WHERE code = :code"), {"code": _PERMISSION_CODE})
    op.drop_constraint("uq_notifications_user_type_employee", "notifications", type_="unique")
    op.drop_constraint("fk_notifications_employee_user_id_users", "notifications", type_="foreignkey")
    op.drop_column("notifications", "employee_user_id")
    # PostgreSQL does not support DROP VALUE for enum labels. Keeping the unused labels
    # is safe and avoids recreating notification_type while production data exists.
