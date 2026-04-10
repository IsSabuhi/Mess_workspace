"""user schedule_mode for autofill

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("schedule_mode", sa.String(length=32), nullable=False, server_default="manual"),
    )
    op.alter_column("users", "schedule_mode", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "schedule_mode")
