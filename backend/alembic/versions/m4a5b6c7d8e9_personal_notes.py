"""personal notes

Revision ID: m4a5b6c7d8e9
Revises: l3f4a5b6c7d8
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "m4a5b6c7d8e9"
down_revision = "l3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "personal_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_personal_notes_owner_user_id", "personal_notes", ["owner_user_id"])
    op.create_index(
        "ix_personal_notes_owner_archived_pinned_updated",
        "personal_notes",
        ["owner_user_id", "is_archived", "is_pinned", "updated_at"],
    )
    op.alter_column("personal_notes", "title", server_default=None)
    op.alter_column("personal_notes", "content", server_default=None)
    op.alter_column("personal_notes", "is_pinned", server_default=None)
    op.alter_column("personal_notes", "is_archived", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_personal_notes_owner_archived_pinned_updated", table_name="personal_notes")
    op.drop_index("ix_personal_notes_owner_user_id", table_name="personal_notes")
    op.drop_table("personal_notes")
