"""uspd nested sim sub-rows

Revision ID: u3d4e5f6a7b8
Revises: t2c3d4e5f6a7
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "u3d4e5f6a7b8"
down_revision = "t2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("uspd_entries", sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("uspd_entries", sa.Column("sim_number", sa.String(length=64), nullable=True))
    op.add_column("uspd_entries", sa.Column("sim_ip", sa.String(length=128), nullable=True))
    op.add_column("uspd_entries", sa.Column("sim_iccid", sa.String(length=32), nullable=True))
    op.add_column("uspd_entries", sa.Column("sim_pin_encrypted", sa.Text(), nullable=True))
    op.add_column("uspd_entries", sa.Column("sim_puk_encrypted", sa.Text(), nullable=True))
    op.create_index("ix_uspd_entries_parent_id", "uspd_entries", ["parent_id"], unique=False)
    op.create_foreign_key(
        "fk_uspd_entries_parent_id",
        "uspd_entries",
        "uspd_entries",
        ["parent_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_uspd_entries_parent_id", "uspd_entries", type_="foreignkey")
    op.drop_index("ix_uspd_entries_parent_id", table_name="uspd_entries")
    op.drop_column("uspd_entries", "sim_puk_encrypted")
    op.drop_column("uspd_entries", "sim_pin_encrypted")
    op.drop_column("uspd_entries", "sim_iccid")
    op.drop_column("uspd_entries", "sim_ip")
    op.drop_column("uspd_entries", "sim_number")
    op.drop_column("uspd_entries", "parent_id")
