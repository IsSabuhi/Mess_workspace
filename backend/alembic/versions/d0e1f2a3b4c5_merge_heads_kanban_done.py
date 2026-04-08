"""merge heads (898c92c9d88b + c7d8e9f0a1b2)

Revision ID: d0e1f2a3b4c5
Revises: 898c92c9d88b, c7d8e9f0a1b2
Create Date: 2026-04-08

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, tuple[str, ...], None] = ("898c92c9d88b", "c7d8e9f0a1b2")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
