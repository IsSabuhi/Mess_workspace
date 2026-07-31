"""admin section: systems.manage no longer opens Administration

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b0
Create Date: 2026-07-22
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            """
            UPDATE permissions
            SET description = :desc
            WHERE code = 'systems.manage'
            """
        ),
        {
            "desc": (
                "Управление системами\n"
                "Справочник производственных систем (/systems). "
                "Не открывает раздел «Администрирование»."
            )
        },
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            """
            UPDATE permissions
            SET description = :desc
            WHERE code = 'systems.manage'
            """
        ),
        {"desc": "Управление системами\nСправочник производственных систем."},
    )
