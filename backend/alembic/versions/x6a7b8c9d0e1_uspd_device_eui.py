"""uspd device eui

Revision ID: x6a7b8c9d0e1
Revises: w5f6a7b8c9d0
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "x6a7b8c9d0e1"
down_revision = "w5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("uspd_entries", sa.Column("device_eui", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("uspd_entries", "device_eui")
