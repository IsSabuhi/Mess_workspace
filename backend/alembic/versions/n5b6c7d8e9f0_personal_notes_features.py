"""personal notes tags color checklist trash reminders attachments

Revision ID: n5b6c7d8e9f0
Revises: m4a5b6c7d8e9
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "n5b6c7d8e9f0"
down_revision = "m4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "personal_notes",
        sa.Column("color", sa.String(length=32), nullable=False, server_default="default"),
    )
    op.add_column(
        "personal_notes",
        sa.Column("checklist_items", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::json")),
    )
    op.add_column("personal_notes", sa.Column("reminder_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("personal_notes", sa.Column("reminder_notified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("personal_notes", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("personal_notes", "color", server_default=None)
    op.alter_column("personal_notes", "checklist_items", server_default=None)

    op.drop_index("ix_personal_notes_owner_archived_pinned_updated", table_name="personal_notes")
    op.create_index(
        "ix_personal_notes_owner_deleted_archived_pinned_updated",
        "personal_notes",
        ["owner_user_id", "deleted_at", "is_archived", "is_pinned", "updated_at"],
    )
    op.create_index("ix_personal_notes_reminder_at", "personal_notes", ["reminder_at"])

    op.create_table(
        "personal_note_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_user_id", "name", name="uq_personal_note_tags_owner_name"),
    )
    op.create_index("ix_personal_note_tags_owner_user_id", "personal_note_tags", ["owner_user_id"])

    op.create_table(
        "personal_note_tag_links",
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["personal_notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["personal_note_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("note_id", "tag_id"),
    )

    op.create_table(
        "personal_note_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("note_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("url", sa.String(length=1024), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["personal_notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_personal_note_attachments_note_id", "personal_note_attachments", ["note_id"])

    op.execute(sa.text("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'note_reminder'"))
    op.add_column(
        "notifications",
        sa.Column("personal_note_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_notifications_personal_note_id",
        "notifications",
        "personal_notes",
        ["personal_note_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_notifications_user_type_personal_note",
        "notifications",
        ["user_id", "type", "personal_note_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_notifications_user_type_personal_note", "notifications", type_="unique")
    op.drop_constraint("fk_notifications_personal_note_id", "notifications", type_="foreignkey")
    op.drop_column("notifications", "personal_note_id")

    op.drop_index("ix_personal_note_attachments_note_id", table_name="personal_note_attachments")
    op.drop_table("personal_note_attachments")
    op.drop_table("personal_note_tag_links")
    op.drop_index("ix_personal_note_tags_owner_user_id", table_name="personal_note_tags")
    op.drop_table("personal_note_tags")

    op.drop_index("ix_personal_notes_reminder_at", table_name="personal_notes")
    op.drop_index("ix_personal_notes_owner_deleted_archived_pinned_updated", table_name="personal_notes")
    op.create_index(
        "ix_personal_notes_owner_archived_pinned_updated",
        "personal_notes",
        ["owner_user_id", "is_archived", "is_pinned", "updated_at"],
    )
    op.drop_column("personal_notes", "deleted_at")
    op.drop_column("personal_notes", "reminder_notified_at")
    op.drop_column("personal_notes", "reminder_at")
    op.drop_column("personal_notes", "checklist_items")
    op.drop_column("personal_notes", "color")
