"""schedule row colors by month

Revision ID: a1b9c8d7e6f5
Revises: f9a0b1c2d3e4
Create Date: 2026-05-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b9c8d7e6f5"
down_revision: Union[str, None] = "f9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schedule_row_colors",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "month", "user_id", name="uq_schedule_row_color_user_month"),
    )
    op.create_index("ix_schedule_row_colors_user_id", "schedule_row_colors", ["user_id"], unique=False)
    op.create_index("ix_schedule_row_colors_year_month", "schedule_row_colors", ["year", "month"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_schedule_row_colors_year_month", table_name="schedule_row_colors")
    op.drop_index("ix_schedule_row_colors_user_id", table_name="schedule_row_colors")
    op.drop_table("schedule_row_colors")
