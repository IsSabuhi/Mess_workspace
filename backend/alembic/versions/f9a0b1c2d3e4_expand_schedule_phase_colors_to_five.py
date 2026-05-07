"""expand schedule phase colors to five

Revision ID: f9a0b1c2d3e4
Revises: e7f8a9b0c1d2
Create Date: 2026-05-07
"""

from typing import Sequence, Union

from alembic import op

revision: str = "f9a0b1c2d3e4"
down_revision: Union[str, None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_user_schedule_phase_colors_phase_range",
        "user_schedule_phase_colors",
        type_="check",
    )
    op.create_check_constraint(
        "ck_user_schedule_phase_colors_phase_range",
        "user_schedule_phase_colors",
        "phase >= 0 AND phase <= 4",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_user_schedule_phase_colors_phase_range",
        "user_schedule_phase_colors",
        type_="check",
    )
    op.create_check_constraint(
        "ck_user_schedule_phase_colors_phase_range",
        "user_schedule_phase_colors",
        "phase >= 0 AND phase <= 3",
    )
