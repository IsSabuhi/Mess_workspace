"""add employee position_assigned_at

Revision ID: j1d2e3f4a5b6
Revises: i0c1d2e3f4a5
Create Date: 2026-08-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "j1d2e3f4a5b6"
down_revision = "i0c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("position_assigned_at", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employee_profiles", "position_assigned_at")
