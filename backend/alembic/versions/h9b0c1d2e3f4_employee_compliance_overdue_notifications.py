"""add overdue employee compliance notification types

Revision ID: h9b0c1d2e3f4
Revises: g8a9b0c1d2e3
Create Date: 2026-08-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "h9b0c1d2e3f4"
down_revision = "g8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'employee_pass_overdue'"))
    op.execute(
        sa.text("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'employee_exam_electrical_overdue'")
    )


def downgrade() -> None:
    # PostgreSQL does not support DROP VALUE for enum labels.
    pass
