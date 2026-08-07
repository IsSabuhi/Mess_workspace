"""add employee workplace profile fields

Revision ID: i0c1d2e3f4a5
Revises: h9b0c1d2e3f4
Create Date: 2026-08-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "i0c1d2e3f4a5"
down_revision = "h9b0c1d2e3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("is_remote", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("work_address", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("is_field_worker", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.alter_column("employee_profiles", "is_remote", server_default=None)
    op.alter_column("employee_profiles", "is_field_worker", server_default=None)


def downgrade() -> None:
    op.drop_column("employee_profiles", "is_field_worker")
    op.drop_column("employee_profiles", "work_address")
    op.drop_column("employee_profiles", "is_remote")
