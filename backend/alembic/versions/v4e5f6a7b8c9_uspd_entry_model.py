"""uspd entry hardware model

Revision ID: v4e5f6a7b8c9
Revises: u3d4e5f6a7b8
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "v4e5f6a7b8c9"
down_revision = "u3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("uspd_entries", sa.Column("model", sa.String(length=128), nullable=True))
    op.create_index("ix_uspd_entries_model", "uspd_entries", ["model"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_uspd_entries_model", table_name="uspd_entries")
    op.drop_column("uspd_entries", "model")
