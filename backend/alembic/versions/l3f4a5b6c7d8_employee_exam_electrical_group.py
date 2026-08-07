"""add exam_electrical_group

Revision ID: l3f4a5b6c7d8
Revises: k2e3f4a5b6c7
Create Date: 2026-08-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "l3f4a5b6c7d8"
down_revision = "k2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("exam_electrical_group", sa.String(length=8), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employee_profiles", "exam_electrical_group")
