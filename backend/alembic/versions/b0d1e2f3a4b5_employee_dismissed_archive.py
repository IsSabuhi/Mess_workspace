"""employee profile dismissed archive fields

Revision ID: b0d1e2f3a4b5
Revises: a9c0d1e2f3b4
Create Date: 2026-08-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b0d1e2f3a4b5"
down_revision = "a9c0d1e2f3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("is_dismissed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("dismissed_at", sa.Date(), nullable=True),
    )
    op.alter_column("employee_profiles", "is_dismissed", server_default=None)


def downgrade() -> None:
    op.drop_column("employee_profiles", "dismissed_at")
    op.drop_column("employee_profiles", "is_dismissed")
