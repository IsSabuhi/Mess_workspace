"""merge_heads

Revision ID: fab1b5cb1808
Revises: 0b5b757fc9bc, c1d2e3f4a5b6, f6a7b8c9d0e1
Create Date: 2026-05-08 12:01:31.939528

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = 'fab1b5cb1808'
down_revision: Union[str, None] = ('0b5b757fc9bc', 'c1d2e3f4a5b6', 'f6a7b8c9d0e1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
