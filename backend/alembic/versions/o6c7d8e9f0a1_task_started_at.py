"""task started_at when assignee assigned

Revision ID: o6c7d8e9f0a1
Revises: n5b6c7d8e9f0
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "o6c7d8e9f0a1"
down_revision = "n5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "started_at")
