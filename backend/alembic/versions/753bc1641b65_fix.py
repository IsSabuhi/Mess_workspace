"""fix — autogenerate false positives (constraints already in initial)

Revision ID: 753bc1641b65
Revises: d1e2f3a4b5c6
Create Date: 2026-04-07 23:49:20.845284

`alembic revision --autogenerate` сравнил модели с БД и «нашёл» уникальные ограничения
uq_space_member, uq_role_permission, uq_user_role — они уже созданы в
e5e3ce80475c_initial.py. Повторно создавать их нельзя.

При следующем autogenerate: смотрите diff и удаляйте ложные правки или
используйте ручные миграции.

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "753bc1641b65"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
