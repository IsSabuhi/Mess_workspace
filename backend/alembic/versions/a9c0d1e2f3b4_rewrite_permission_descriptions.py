"""rewrite permission titles and descriptions

Revision ID: a9c0d1e2f3b4
Revises: z8c9d0e1f2a3
Create Date: 2026-08-26
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

from app.permission_texts import packed_permission_descriptions

revision = "a9c0d1e2f3b4"
down_revision = "z8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    for code, desc in packed_permission_descriptions().items():
        conn.execute(
            text("UPDATE permissions SET description = :desc WHERE code = :code"),
            {"desc": desc, "code": code},
        )


def downgrade() -> None:
    # Тексты только улучшали формулировки — откат к предыдущим строкам не восстанавливаем.
    pass
