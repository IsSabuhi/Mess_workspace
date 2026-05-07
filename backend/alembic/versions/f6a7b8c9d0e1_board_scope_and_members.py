"""boards scope/system + board_members

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "boards",
        sa.Column("scope", sa.String(length=16), nullable=False, server_default=sa.text("'global'")),
    )
    op.add_column("boards", sa.Column("system_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column(
        "boards",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_foreign_key(
        "fk_boards_system_id_systems",
        "boards",
        "systems",
        ["system_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "ck_boards_scope_system",
        "boards",
        "(scope = 'global' AND system_id IS NULL) OR (scope = 'system' AND system_id IS NOT NULL)",
    )
    op.alter_column("boards", "scope", server_default=None)
    op.alter_column("boards", "is_archived", server_default=None)

    op.create_table(
        "board_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("board_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False, server_default=sa.text("'viewer'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("board_id", "user_id", name="uq_board_member"),
    )
    op.create_index("ix_board_members_board_id", "board_members", ["board_id"], unique=False)
    op.create_index("ix_board_members_user_id", "board_members", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_board_members_user_id", table_name="board_members")
    op.drop_index("ix_board_members_board_id", table_name="board_members")
    op.drop_table("board_members")

    op.drop_constraint("ck_boards_scope_system", "boards", type_="check")
    op.drop_constraint("fk_boards_system_id_systems", "boards", type_="foreignkey")
    op.drop_column("boards", "is_archived")
    op.drop_column("boards", "system_id")
    op.drop_column("boards", "scope")
