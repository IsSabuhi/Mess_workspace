"""note reminder repeat daily

Revision ID: q8e9f0a1b2c3
Revises: p7d8e9f0a1b2
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "q8e9f0a1b2c3"
down_revision = "p7d8e9f0a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "personal_notes",
        sa.Column("reminder_repeat_daily", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.alter_column("personal_notes", "reminder_repeat_daily", server_default=None)
    op.drop_constraint("uq_notifications_user_type_personal_note", "notifications", type_="unique")
    op.create_index(
        "ix_notifications_user_type_personal_note",
        "notifications",
        ["user_id", "type", "personal_note_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_user_type_personal_note", table_name="notifications")
    op.create_unique_constraint(
        "uq_notifications_user_type_personal_note",
        "notifications",
        ["user_id", "type", "personal_note_id"],
    )
    op.drop_column("personal_notes", "reminder_repeat_daily")
