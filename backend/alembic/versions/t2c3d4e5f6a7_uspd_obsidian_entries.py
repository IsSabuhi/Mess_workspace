"""uspd obsidian-style entries

Revision ID: t2c3d4e5f6a7
Revises: s1b2c3d4e5f6
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "t2c3d4e5f6a7"
down_revision = "s1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uspd_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("object", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("ip", sa.Text(), nullable=True),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("password_encrypted", sa.Text(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("section", sa.String(length=128), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["uspd_sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_uspd_entries_site_id", "uspd_entries", ["site_id"], unique=False)

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO uspd_entries (id, site_id, object, ip, username, password_encrypted, comment, section, sort_order)
            SELECT id, site_id,
                   COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(model), ''), 'Cisco'),
                   ip, username, password_encrypted, notes, NULL, sort_order
            FROM uspd_ciscos
            """
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT INTO uspd_entries (id, site_id, object, ip, username, password_encrypted, comment, section, sort_order)
            SELECT id, site_id,
                   COALESCE(NULLIF(btrim(name), ''), 'БС'),
                   ip, username, password_encrypted, notes, NULL, sort_order + 1000
            FROM uspd_base_stations
            """
        )
    )
    conn.execute(
        sa.text(
            """
            INSERT INTO uspd_entries (id, site_id, object, ip, username, password_encrypted, comment, section, sort_order)
            SELECT id, site_id,
                   COALESCE(NULLIF(btrim(name), ''), NULLIF(btrim(model), ''), 'GSM'),
                   COALESCE(NULLIF(btrim(ip), ''), sim_ip),
                   username, password_encrypted,
                   NULLIF(concat_ws(' · ',
                     CASE WHEN sim_number IS NOT NULL AND btrim(sim_number) <> '' THEN 'Номер ' || sim_number END,
                     CASE WHEN sim_ip IS NOT NULL AND btrim(sim_ip) <> '' THEN 'IP SIM ' || sim_ip END,
                     CASE WHEN sim_iccid IS NOT NULL AND btrim(sim_iccid) <> '' THEN 'ICCID ' || sim_iccid END,
                     notes
                   ), ''),
                   NULL, sort_order + 2000
            FROM uspd_phones
            """
        )
    )

    op.drop_index("ix_uspd_phones_site_id", table_name="uspd_phones")
    op.drop_table("uspd_phones")
    op.drop_index("ix_uspd_base_stations_site_id", table_name="uspd_base_stations")
    op.drop_table("uspd_base_stations")
    op.drop_index("ix_uspd_ciscos_site_id", table_name="uspd_ciscos")
    op.drop_table("uspd_ciscos")


def downgrade() -> None:
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
    op.drop_index("ix_uspd_entries_site_id", table_name="uspd_entries")
    op.drop_table("uspd_entries")
