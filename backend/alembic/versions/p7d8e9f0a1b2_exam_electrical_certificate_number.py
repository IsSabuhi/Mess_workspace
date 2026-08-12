"""add exam_electrical_certificate_number

Revision ID: p7d8e9f0a1b2
Revises: o6c7d8e9f0a1
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "p7d8e9f0a1b2"
down_revision = "o6c7d8e9f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("exam_electrical_certificate_number", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employee_profiles", "exam_electrical_certificate_number")
