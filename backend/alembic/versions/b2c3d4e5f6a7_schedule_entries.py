"""schedule entries and permissions

Revision ID: b2c3d4e5f6a7
Revises: a9b8c7d6e5f4
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
import uuid

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a9b8c7d6e5f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schedule_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("day", sa.Integer(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "month", "user_id", "day", name="uq_schedule_entry_user_day"),
        sa.CheckConstraint("month >= 1 AND month <= 12", name="ck_schedule_month"),
        sa.CheckConstraint("day >= 1 AND day <= 31", name="ck_schedule_day"),
    )
    op.create_index("ix_schedule_entries_year_month", "schedule_entries", ["year", "month"], unique=False)
    op.create_index("ix_schedule_entries_user_id", "schedule_entries", ["user_id"], unique=False)
    op.alter_column("schedule_entries", "updated_at", server_default=None)

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO permissions (id, code, description)
            VALUES (:id_a, 'schedule.read', 'Просмотр графика смен')
            ON CONFLICT (code) DO NOTHING
            """
        ),
        {"id_a": uuid.uuid4()},
    )
    conn.execute(
        sa.text(
            """
            INSERT INTO permissions (id, code, description)
            VALUES (:id_b, 'schedule.manage', 'Редактирование графика смен')
            ON CONFLICT (code) DO NOTHING
            """
        ),
        {"id_b": uuid.uuid4()},
    )

    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            JOIN permissions p ON p.code = 'schedule.read'
            WHERE r.slug IN ('super_admin', 'lead', 'employee')
            ON CONFLICT DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            JOIN permissions p ON p.code = 'schedule.manage'
            WHERE r.slug IN ('super_admin', 'lead')
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
              SELECT id FROM permissions WHERE code IN ('schedule.read', 'schedule.manage')
            )
            """
        )
    )
    op.execute(sa.text("DELETE FROM permissions WHERE code IN ('schedule.read', 'schedule.manage')"))
    op.drop_index("ix_schedule_entries_user_id", table_name="schedule_entries")
    op.drop_index("ix_schedule_entries_year_month", table_name="schedule_entries")
    op.drop_table("schedule_entries")
