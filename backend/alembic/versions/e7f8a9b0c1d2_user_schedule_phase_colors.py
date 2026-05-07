"""user schedule phase colors

Revision ID: e7f8a9b0c1d2
Revises: d2e3f4a5b6c7
Create Date: 2026-05-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_schedule_phase_colors",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("phase", sa.SmallInteger(), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "phase"),
        sa.CheckConstraint("phase >= 0 AND phase <= 3", name="ck_user_schedule_phase_colors_phase_range"),
    )
    op.create_index(
        "ix_user_schedule_phase_colors_user_id",
        "user_schedule_phase_colors",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_schedule_phase_colors_user_id", table_name="user_schedule_phase_colors")
    op.drop_table("user_schedule_phase_colors")
