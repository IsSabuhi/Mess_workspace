"""positions table and positions.manage permission

Revision ID: d1e2f3a4b5c6
Revises: 946b18bb08df
Create Date: 2026-04-07

"""
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "946b18bb08df"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "positions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_positions_slug"), "positions", ["slug"], unique=True)
    op.add_column("users", sa.Column("position_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_users_position_id", "users", "positions", ["position_id"], ["id"], ondelete="SET NULL")

    now = datetime.now(timezone.utc)
    conn = op.get_bind()
    for name, slug, so in [
        ("Руководитель направления", "lead", 0),
        ("Ведущий инженер", "senior-engineer", 1),
        ("Инженер", "engineer", 2),
    ]:
        conn.execute(
            text(
                "INSERT INTO positions (id, name, slug, description, sort_order, is_active, created_at) "
                "VALUES (:id, :name, :slug, NULL, :so, true, :created_at)"
            ),
            {"id": uuid.uuid4(), "name": name, "slug": slug, "so": so, "created_at": now},
        )

    perm_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO permissions (id, code, description) VALUES (:id, 'positions.manage', :desc) "
            "ON CONFLICT (code) DO NOTHING"
        ),
        {"id": perm_id, "desc": "Управление справочником должностей"},
    )
    row = conn.execute(text("SELECT id FROM permissions WHERE code = 'positions.manage'")).fetchone()
    if row:
        pid = row[0]
        conn.execute(
            text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "SELECT r.id, CAST(:pid AS uuid) FROM roles r "
                "WHERE r.slug IN ('super_admin', 'admin') "
                "AND NOT EXISTS ("
                " SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = CAST(:pid AS uuid)"
                ")"
            ),
            {"pid": str(pid)},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'positions.manage')"))
    conn.execute(text("DELETE FROM permissions WHERE code = 'positions.manage'"))
    op.drop_constraint("fk_users_position_id", "users", type_="foreignkey")
    op.drop_column("users", "position_id")
    op.drop_index(op.f("ix_positions_slug"), table_name="positions")
    op.drop_table("positions")
