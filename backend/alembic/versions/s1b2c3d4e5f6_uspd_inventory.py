"""uspd inventory

Revision ID: s1b2c3d4e5f6
Revises: r0a1b2c3d4e5
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "s1b2c3d4e5f6"
down_revision = "r0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uspd_sites",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("ip", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("system_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["system_id"], ["systems.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_uspd_sites_name", "uspd_sites", ["name"], unique=False)
    op.create_index("ix_uspd_sites_system_id", "uspd_sites", ["system_id"], unique=False)

    op.create_table(
        "uspd_ciscos",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("model", sa.String(length=255), nullable=True),
        sa.Column("ip", sa.String(length=128), nullable=True),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("password_encrypted", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["uspd_sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_uspd_ciscos_site_id", "uspd_ciscos", ["site_id"], unique=False)

    op.create_table(
        "uspd_base_stations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("ip", sa.String(length=128), nullable=True),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("password_encrypted", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["uspd_sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_uspd_base_stations_site_id", "uspd_base_stations", ["site_id"], unique=False)

    op.create_table(
        "uspd_phones",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("model", sa.String(length=255), nullable=True),
        sa.Column("ip", sa.String(length=128), nullable=True),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("password_encrypted", sa.Text(), nullable=True),
        sa.Column("sim_number", sa.String(length=64), nullable=True),
        sa.Column("sim_ip", sa.String(length=128), nullable=True),
        sa.Column("sim_iccid", sa.String(length=32), nullable=True),
        sa.Column("sim_pin_encrypted", sa.Text(), nullable=True),
        sa.Column("sim_puk_encrypted", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["uspd_sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_uspd_phones_site_id", "uspd_phones", ["site_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_uspd_phones_site_id", table_name="uspd_phones")
    op.drop_table("uspd_phones")
    op.drop_index("ix_uspd_base_stations_site_id", table_name="uspd_base_stations")
    op.drop_table("uspd_base_stations")
    op.drop_index("ix_uspd_ciscos_site_id", table_name="uspd_ciscos")
    op.drop_table("uspd_ciscos")
    op.drop_index("ix_uspd_sites_system_id", table_name="uspd_sites")
    op.drop_index("ix_uspd_sites_name", table_name="uspd_sites")
    op.drop_table("uspd_sites")
