"""system backups table

Revision ID: r0a1b2c3d4e5
Revises: q8e9f0a1b2c3
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "r0a1b2c3d4e5"
down_revision = "q8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_backups",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_system_backups_status", "system_backups", ["status"], unique=False)
    op.create_index("ix_system_backups_created_at", "system_backups", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_system_backups_created_at", table_name="system_backups")
    op.drop_index("ix_system_backups_status", table_name="system_backups")
    op.drop_table("system_backups")
