"""notifications center tables

Revision ID: f3a4b5c6d7e8
Revises: c7d8e9f0a1b2
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    notification_type = postgresql.ENUM(
        "task_due_3_days",
        "task_overdue",
        "release_note",
        name="notification_type",
        create_type=False,
    )
    notification_type.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "release_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_release_notes_version", "release_notes", ["version"], unique=True)

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", notification_type, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("release_note_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["release_note_id"], ["release_notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "type", "task_id", name="uq_notifications_user_type_task"),
        sa.UniqueConstraint(
            "user_id",
            "type",
            "release_note_id",
            name="uq_notifications_user_type_release_note",
        ),
    )
    op.create_index("ix_notifications_user_created_at", "notifications", ["user_id", "created_at"], unique=False)
    op.create_index("ix_notifications_user_read_at", "notifications", ["user_id", "read_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_notifications_user_read_at", table_name="notifications")
    op.drop_index("ix_notifications_user_created_at", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_release_notes_version", table_name="release_notes")
    op.drop_table("release_notes")
    notification_type = postgresql.ENUM(
        "task_due_3_days",
        "task_overdue",
        "release_note",
        name="notification_type",
        create_type=False,
    )
    notification_type.drop(op.get_bind(), checkfirst=True)
