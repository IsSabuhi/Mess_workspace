"""fix — уникальные ограничения (идемпотентно)

Revision ID: 898c92c9d88b
Revises: a5c31458cd21
Create Date: 2026-04-08 00:42:18.909306

Автогенерация добавила те же UNIQUE, что уже есть в initial / других ревизиях.
Повторный `create_unique_constraint` на существующей БД даёт DuplicateTable/DuplicateObject.
Добавляем ограничения только если их ещё нет в pg_constraint.

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "898c92c9d88b"
down_revision: Union[str, None] = "a5c31458cd21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Статические блоки: на чистой БД создаём ограничения; если уже есть (initial) — пропуск.
    op.execute(
        text("""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_space_member') THEN
            ALTER TABLE knowledge_space_members
              ADD CONSTRAINT uq_space_member UNIQUE (space_id, user_id);
          END IF;
        END $$;
        """)
    )
    op.execute(
        text("""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_role_permission') THEN
            ALTER TABLE role_permissions
              ADD CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id);
          END IF;
        END $$;
        """)
    )
    op.execute(
        text("""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_role') THEN
            ALTER TABLE user_roles
              ADD CONSTRAINT uq_user_role UNIQUE (user_id, role_id);
          END IF;
        END $$;
        """)
    )
    op.execute(
        text("""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_system') THEN
            ALTER TABLE user_systems
              ADD CONSTRAINT uq_user_system UNIQUE (user_id, system_id);
          END IF;
        END $$;
        """)
    )


def downgrade() -> None:
    for table, name in (
        ("user_systems", "uq_user_system"),
        ("user_roles", "uq_user_role"),
        ("role_permissions", "uq_role_permission"),
        ("knowledge_space_members", "uq_space_member"),
    ):
        op.execute(text(f'ALTER TABLE "{table}" DROP CONSTRAINT IF EXISTS "{name}"'))
