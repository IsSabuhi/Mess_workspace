"""kanban columns: is_done_column for reporting

Revision ID: c7d8e9f0a1b2
Revises: 946b18bb08df
Create Date: 2026-04-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "946b18bb08df"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "kanban_columns",
        sa.Column("is_done_column", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.execute(sa.text("UPDATE kanban_columns SET is_done_column = true WHERE slug = 'done'"))
    op.alter_column("kanban_columns", "is_done_column", server_default=None)


def downgrade() -> None:
    op.drop_column("kanban_columns", "is_done_column")
