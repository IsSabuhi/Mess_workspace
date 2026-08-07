"""add employee personnel_number

Revision ID: k2e3f4a5b6c7
Revises: j1d2e3f4a5b6
Create Date: 2026-08-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "k2e3f4a5b6c7"
down_revision = "j1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("personnel_number", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employee_profiles", "personnel_number")
