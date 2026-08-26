"""backup source manual vs scheduled

Revision ID: y7b8c9d0e1f2
Revises: x6a7b8c9d0e1
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "y7b8c9d0e1f2"
down_revision = "x6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "system_backups",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
    )
    op.execute(
        sa.text("UPDATE system_backups SET source = 'scheduled' WHERE created_by_id IS NULL")
    )
    op.create_index("ix_system_backups_source", "system_backups", ["source"], unique=False)
    op.alter_column("system_backups", "source", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_system_backups_source", table_name="system_backups")
    op.drop_column("system_backups", "source")
