"""employee_profiles work_schedule_kind + gender_for_schedule

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c0
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("work_schedule_kind", sa.String(length=32), nullable=False, server_default="five_two"),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("gender_for_schedule", sa.String(length=32), nullable=False, server_default="unspecified"),
    )
    op.alter_column("employee_profiles", "work_schedule_kind", server_default=None)
    op.alter_column("employee_profiles", "gender_for_schedule", server_default=None)


def downgrade() -> None:
    op.drop_column("employee_profiles", "gender_for_schedule")
    op.drop_column("employee_profiles", "work_schedule_kind")
