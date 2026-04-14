"""add system settings table for task archive config

Revision ID: c9d0e1f2a3b4
Revises: b2c3d4e5f6a8
Create Date: 2026-04-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b2c3d4e5f6a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.execute(
        sa.text(
            """
            INSERT INTO system_settings ("key", value, updated_at)
            VALUES ('task_auto_archive_done_days', '60', NOW())
            """
        )
    )


def downgrade() -> None:
    op.drop_table("system_settings")
