"""merge heads task comments and knowledge templates

Revision ID: 0b5b757fc9bc
Revises: b6c7d8e9f0a1, d2e3f4a5b6c7
Create Date: 2026-04-24 13:51:08.531324

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = '0b5b757fc9bc'
down_revision: Union[str, None] = ('b6c7d8e9f0a1', 'd2e3f4a5b6c7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
