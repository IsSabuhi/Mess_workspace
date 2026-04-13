"""task multi-assignees: task_assignees table, drop assignee_id

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f6
Create Date: 2026-04-09

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a8"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "task_assignees",
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id", "user_id"),
    )
    op.execute(
        sa.text(
            """
            INSERT INTO task_assignees (task_id, user_id)
            SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL
            """
        )
    )
    op.drop_constraint("tasks_assignee_id_fkey", "tasks", type_="foreignkey")
    op.drop_column("tasks", "assignee_id")


def downgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("assignee_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "tasks_assignee_id_fkey",
        "tasks",
        "users",
        ["assignee_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        sa.text(
            """
            UPDATE tasks t
            SET assignee_id = (
                SELECT user_id FROM task_assignees ta
                WHERE ta.task_id = t.id
                ORDER BY user_id
                LIMIT 1
            )
            """
        )
    )
    op.drop_table("task_assignees")
