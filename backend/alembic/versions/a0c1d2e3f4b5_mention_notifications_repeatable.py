"""allow repeated task_mention notifications per task

Revision ID: a0c1d2e3f4b5
Revises: aa1b2c3d4e5f
Create Date: 2026-09-03

Unique (user, type, task) остаётся только для дедлайнов. Упоминания в комментариях
могут повторяться: каждый новый комментарий с @ даёт новое уведомление.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a0c1d2e3f4b5"
down_revision = "aa1b2c3d4e5f"
branch_labels = None
depends_on = None

_DEADLINE_WHERE = (
    "type IN ('task_due_3_days'::notification_type, 'task_overdue'::notification_type)"
)


def upgrade() -> None:
    op.drop_constraint("uq_notifications_user_type_task", "notifications", type_="unique")
    op.create_index(
        "uq_notifications_user_type_task",
        "notifications",
        ["user_id", "type", "task_id"],
        unique=True,
        postgresql_where=sa.text(_DEADLINE_WHERE),
    )


def downgrade() -> None:
    op.drop_index("uq_notifications_user_type_task", table_name="notifications")
    op.create_unique_constraint(
        "uq_notifications_user_type_task",
        "notifications",
        ["user_id", "type", "task_id"],
    )
