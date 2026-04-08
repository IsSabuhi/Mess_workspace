"""fix — уникальные ограничения (идемпотентно)

Ранее те же имена уже задаются в initial (uq_space_member, uq_role_permission, uq_user_role)
и в e2f3a4b5c6d7 при создании user_systems (uq_user_system). Эта миграция оставлена в цепочке,
но применяется только если ограничения по какой-то причине отсутствуют.

Revision ID: a5c31458cd21
Revises: e2f3a4b5c6d7
Create Date: 2026-04-08 00:41:22.640913

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "a5c31458cd21"
down_revision: Union[str, None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UNIQUE: list[tuple[str, str, list[str]]] = [
    ("uq_space_member", "knowledge_space_members", ["space_id", "user_id"]),
    ("uq_role_permission", "role_permissions", ["role_id", "permission_id"]),
    ("uq_user_role", "user_roles", ["user_id", "role_id"]),
    ("uq_user_system", "user_systems", ["user_id", "system_id"]),
]


def _constraint_exists(conn, name: str) -> bool:
    row = conn.execute(
        sa.text("SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = :n"),
        {"n": name},
    ).scalar()
    return row is not None


def upgrade() -> None:
    conn = op.get_bind()
    for name, table, cols in _UNIQUE:
        if not _constraint_exists(conn, name):
            op.create_unique_constraint(name, table, cols)


def downgrade() -> None:
    conn = op.get_bind()
    for name, table, _cols in reversed(_UNIQUE):
        if _constraint_exists(conn, name):
            op.drop_constraint(name, table, type_="unique")
