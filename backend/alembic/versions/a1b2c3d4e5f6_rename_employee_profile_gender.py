"""Rename gender_for_schedule -> gender on employee_profiles

Revision ID: a1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-04-09
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('ALTER TABLE employee_profiles RENAME COLUMN gender_for_schedule TO gender')


def downgrade() -> None:
    op.execute('ALTER TABLE employee_profiles RENAME COLUMN gender TO gender_for_schedule')
