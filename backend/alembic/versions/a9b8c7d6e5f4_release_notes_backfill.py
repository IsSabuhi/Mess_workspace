"""backfill release notes structures for existing databases

Revision ID: a9b8c7d6e5f4
Revises: f3a4b5c6d7e8
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9b8c7d6e5f4"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_type t
                JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE t.typname = 'notification_type'
              ) THEN
                CREATE TYPE notification_type AS ENUM ('task_due_3_days', 'task_overdue');
              END IF;
            END $$;
            """
        )
    )
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'notification_type' AND e.enumlabel = 'release_note'
              ) THEN
                ALTER TYPE notification_type ADD VALUE 'release_note';
              END IF;
            END $$;
            """
        )
    )

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS release_notes (
              id UUID PRIMARY KEY,
              version VARCHAR(64) NOT NULL,
              title VARCHAR(255) NOT NULL,
              body TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL,
              created_by_id UUID NULL REFERENCES users(id) ON DELETE SET NULL
            );
            """
        )
    )
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_release_notes_version ON release_notes (version);"))

    op.execute(
        sa.text(
            """
            ALTER TABLE notifications
            ADD COLUMN IF NOT EXISTS release_note_id UUID NULL REFERENCES release_notes(id) ON DELETE CASCADE;
            """
        )
    )

    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'uq_notifications_user_type_release_note'
              ) THEN
                ALTER TABLE notifications
                ADD CONSTRAINT uq_notifications_user_type_release_note
                UNIQUE (user_id, type, release_note_id);
              END IF;
            END $$;
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'uq_notifications_user_type_release_note'
              ) THEN
                ALTER TABLE notifications DROP CONSTRAINT uq_notifications_user_type_release_note;
              END IF;
            END $$;
            """
        )
    )
    op.execute(sa.text("ALTER TABLE notifications DROP COLUMN IF EXISTS release_note_id;"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_release_notes_version;"))
    op.execute(sa.text("DROP TABLE IF EXISTS release_notes;"))
