"""add indexes for task, assignment, and employee deadline queries

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-08-03
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Основные выборки Kanban работают только с активными задачами и сортируют их
    # внутри доски/колонки. Частичные индексы не раздуваются архивными задачами.
    op.create_index(
        "ix_tasks_active_board_position_created",
        "tasks",
        ["board_id", "position", "created_at"],
        unique=False,
        postgresql_where=sa.text("archived_at IS NULL"),
    )
    op.create_index(
        "ix_tasks_active_system_position_created",
        "tasks",
        ["system_id", "position", "created_at"],
        unique=False,
        postgresql_where=sa.text("archived_at IS NULL"),
    )
    op.create_index(
        "ix_tasks_active_column_position_created",
        "tasks",
        ["column_id", "position", "created_at"],
        unique=False,
        postgresql_where=sa.text("archived_at IS NULL"),
    )
    # Используется фоновой проверкой дедлайнов; законченные и архивные задачи исключены.
    op.create_index(
        "ix_tasks_active_due_at",
        "tasks",
        ["due_at"],
        unique=False,
        postgresql_where=sa.text("archived_at IS NULL AND due_at IS NOT NULL"),
    )
    # Архивация выполненных задач вызывается перед выдачей списка задач.
    op.create_index(
        "ix_tasks_active_updated_at",
        "tasks",
        ["updated_at"],
        unique=False,
        postgresql_where=sa.text("archived_at IS NULL"),
    )
    # Первичный ключ начинается с task_id; для выборки задач конкретного сотрудника
    # нужен обратный порядок.
    op.create_index(
        "ix_task_assignees_user_task",
        "task_assignees",
        ["user_id", "task_id"],
        unique=False,
    )
    # Подготовка к проверкам срока пропуска и допуска к электроустановкам.
    op.create_index(
        "ix_employee_profiles_pass_valid_to",
        "employee_profiles",
        ["pass_valid_to"],
        unique=False,
        postgresql_where=sa.text("pass_valid_to IS NOT NULL"),
    )
    op.create_index(
        "ix_employee_profiles_exam_electrical_valid_to",
        "employee_profiles",
        ["exam_electrical_valid_to"],
        unique=False,
        postgresql_where=sa.text("exam_electrical_valid_to IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_employee_profiles_exam_electrical_valid_to", table_name="employee_profiles")
    op.drop_index("ix_employee_profiles_pass_valid_to", table_name="employee_profiles")
    op.drop_index("ix_task_assignees_user_task", table_name="task_assignees")
    op.drop_index("ix_tasks_active_updated_at", table_name="tasks")
    op.drop_index("ix_tasks_active_due_at", table_name="tasks")
    op.drop_index("ix_tasks_active_column_position_created", table_name="tasks")
    op.drop_index("ix_tasks_active_system_position_created", table_name="tasks")
    op.drop_index("ix_tasks_active_board_position_created", table_name="tasks")
