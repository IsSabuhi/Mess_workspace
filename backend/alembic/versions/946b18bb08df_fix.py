"""fix — redundant unique constraints skipped

Revision ID: 946b18bb08df
Revises: b3c4d5e6f7a8
Create Date: 2026-04-07 23:25:03.163312

Автогенерация ошибочно добавила create_unique_constraint для ограничений, которые уже
созданы в initial (e5e3ce80475c): uq_space_member, uq_role_permission, uq_user_role.
Эта ревизия намеренно пустая — схема уже корректна.

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "946b18bb08df"
down_revision: Union[str, None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
