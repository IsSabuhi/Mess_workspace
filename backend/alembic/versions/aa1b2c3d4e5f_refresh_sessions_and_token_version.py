"""refresh sessions table and users.token_version

Refresh-токены становятся отзываемыми: их jti хранится в refresh_sessions.
users.token_version обесценивает выданные access-токены при смене пароля.

Revision ID: aa1b2c3d4e5f
Revises: b0d1e2f3a4b5
Create Date: 2026-08-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "aa1b2c3d4e5f"
down_revision = "b0d1e2f3a4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {col["name"] for col in inspector.get_columns("users")}
    tables = set(inspector.get_table_names())

    if "token_version" not in user_columns:
        op.add_column(
            "users",
            sa.Column("token_version", sa.Integer(), nullable=False, server_default=sa.text("0")),
        )
        op.alter_column("users", "token_version", server_default=None)

    if "refresh_sessions" not in tables:
        op.create_table(
            "refresh_sessions",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_reason", sa.String(length=32), nullable=True),
            sa.Column("ip_address", sa.String(length=64), nullable=True),
            sa.Column("user_agent", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"], unique=False)
        op.create_index(
            "ix_refresh_sessions_expires_at", "refresh_sessions", ["expires_at"], unique=False
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    user_columns = {col["name"] for col in inspector.get_columns("users")}

    if "refresh_sessions" in tables:
        op.drop_index("ix_refresh_sessions_expires_at", table_name="refresh_sessions")
        op.drop_index("ix_refresh_sessions_user_id", table_name="refresh_sessions")
        op.drop_table("refresh_sessions")
    if "token_version" in user_columns:
        op.drop_column("users", "token_version")
