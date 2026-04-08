"""user_systems — рабочие системы сотрудника (M2M)

Revision ID: e2f3a4b5c6d7
Revises: 753bc1641b65
Create Date: 2026-04-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "753bc1641b65"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_systems",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("system_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["system_id"], ["systems.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "system_id"),
        sa.UniqueConstraint("user_id", "system_id", name="uq_user_system"),
    )


def downgrade() -> None:
    op.drop_table("user_systems")
