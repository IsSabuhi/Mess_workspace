"""employee directory profile and permissions

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-04-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
import uuid

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "employee_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("exam_electrical_passed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("exam_electrical_date", sa.Date(), nullable=True),
        sa.Column("exam_electrical_valid_to", sa.Date(), nullable=True),
        sa.Column("pass_has", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pass_number", sa.String(length=128), nullable=True),
        sa.Column("pass_valid_from", sa.Date(), nullable=True),
        sa.Column("pass_valid_to", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_employee_profiles_user_id", "employee_profiles", ["user_id"], unique=False)
    op.alter_column("employee_profiles", "exam_electrical_passed", server_default=None)
    op.alter_column("employee_profiles", "pass_has", server_default=None)

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO permissions (id, code, description)
            VALUES (:id, :code, :description)
            ON CONFLICT (code) DO NOTHING
            """
        ),
        [
            {
                "id": uuid.uuid4(),
                "code": "employee_directory.read",
                "description": "Чтение справочника сотрудников",
            },
            {
                "id": uuid.uuid4(),
                "code": "employee_directory.manage",
                "description": "Редактирование справочника сотрудников",
            },
        ],
    )
    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            JOIN permissions p ON p.code IN ('employee_directory.read', 'employee_directory.manage')
            WHERE r.slug IN ('super_admin', 'admin', 'lead')
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
              WHERE code IN ('employee_directory.read', 'employee_directory.manage')
            )
            """
        )
    )
    op.execute(
        sa.text(
            "DELETE FROM permissions WHERE code IN ('employee_directory.read', 'employee_directory.manage')"
        )
    )
    op.drop_index("ix_employee_profiles_user_id", table_name="employee_profiles")
    op.drop_table("employee_profiles")
