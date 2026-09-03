"""task completed_at when moved to done column

Revision ID: c2d3e4f5a6b7
Revises: a0c1d2e3f4b5
Create Date: 2026-09-03

Дата закрытия для дашборда. Нельзя брать updated_at: комментарий или тег
сдвигают «закрытие» в другую неделю.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c2d3e4f5a6b7"
down_revision = "a0c1d2e3f4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE tasks AS t
            SET completed_at = t.updated_at
            FROM kanban_columns AS c
            WHERE t.column_id = c.id
              AND c.is_done_column IS TRUE
              AND t.completed_at IS NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_column("tasks", "completed_at")
