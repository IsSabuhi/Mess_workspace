"""uspd hardware model catalog

Revision ID: w5f6a7b8c9d0
Revises: v4e5f6a7b8c9
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "w5f6a7b8c9d0"
down_revision = "v4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uspd_hw_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_uspd_hw_models_name_lower",
        "uspd_hw_models",
        [sa.text("lower(name)")],
        unique=True,
    )
    op.execute(
        sa.text(
            """
            INSERT INTO uspd_hw_models (id, name, created_at)
            SELECT gen_random_uuid(), src.name, now()
            FROM (
                SELECT DISTINCT ON (lower(btrim(model))) btrim(model) AS name
                FROM uspd_entries
                WHERE model IS NOT NULL AND btrim(model) <> ''
                ORDER BY lower(btrim(model)), btrim(model)
            ) src
            """
        )
    )


def downgrade() -> None:
    op.drop_index("uq_uspd_hw_models_name_lower", table_name="uspd_hw_models")
    op.drop_table("uspd_hw_models")
