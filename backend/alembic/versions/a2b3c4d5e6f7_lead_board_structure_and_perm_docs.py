"""lead role: no board structure manage; clearer permission descriptions

Revision ID: a2b3c4d5e6f7
Revises: e8f9a0b1c2d3
Create Date: 2026-07-22
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "a2b3c4d5e6f7"
down_revision = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None

# Более понятные описания в админке «Роли и права».
_PERMISSION_DESCRIPTIONS: dict[str, str] = {
    "tasks.create": "Создание задач\nПозволяет создавать новые задачи на доступных досках.",
    "tasks.read.all": "Просмотр всех задач\nВидны задачи по всем системам и доскам (без управления колонками/тегами).",
    "tasks.read.assigned": "Просмотр своих задач\nВидны только задачи, где пользователь исполнитель.",
    "tasks.update.all": "Редактирование всех задач\nИзменение полей любых доступных задач.",
    "tasks.update.assigned": "Редактирование своих задач\nИзменение задач, где пользователь исполнитель, или задач своих систем.",
    "tasks.delete": "Удаление задач",
    "tasks.move": "Перенос задач по колонкам",
    "board.columns.manage": "Управление структурой доски\nКолонки, теги, настройки доски и блокировка основной доски. Не выдавать руководителю, если нужен только просмотр/работа с задачами.",
    "systems.manage": "Управление системами\nСправочник производственных систем (/systems). Не открывает раздел «Администрирование».",
    "positions.manage": "Управление должностями",
    "users.manage": "Управление пользователями",
    "roles.manage": "Управление ролями и правами",
    "knowledge.read.all": "Чтение всей базы знаний\nВидит все пространства. Не даёт редактирование.",
    "knowledge.manage.all": "Создание пространств БЗ и глобальных шаблонов\nПравка статей — только через роль editor/admin в участниках.",
    "knowledge.space.manage": "Устарело\nРедактирование только через участников пространства (editor/admin).",
    "employee_directory.read": "Просмотр справочника сотрудников",
    "employee_directory.manage": "Полное управление справочником сотрудников",
    "employee_directory.compliance.manage": "Экзамены и пропуски\nРедактирование вкладки compliance в справочнике.",
    "employee_directory.profile.manage": "Кадровый профиль\nРедактирование кадровых полей в справочнике.",
    "schedule.read": "Просмотр графика",
    "schedule.manage": "Редактирование графика",
}


def upgrade() -> None:
    conn = op.get_bind()
    # У «Начальника отдела» убрать управление структурой доски (колонки/теги/настройки).
    conn.execute(
        text(
            """
            DELETE FROM role_permissions
            WHERE role_id IN (SELECT id FROM roles WHERE slug = 'lead')
              AND permission_id IN (SELECT id FROM permissions WHERE code = 'board.columns.manage')
            """
        )
    )
    for code, desc in _PERMISSION_DESCRIPTIONS.items():
        conn.execute(
            text("UPDATE permissions SET description = :desc WHERE code = :code"),
            {"desc": desc, "code": code},
        )
    conn.execute(
        text(
            """
            UPDATE roles
            SET description = :desc
            WHERE slug = 'lead'
            """
        ),
        {
            "desc": (
                "Задачи (просмотр/редактирование), системы; база знаний — только чтение. "
                "Без управления колонками, тегами и настройками доски."
            )
        },
    )


def downgrade() -> None:
    conn = op.get_bind()
    # Вернуть право lead (как в исходном seed), описания не откатываем детально.
    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            CROSS JOIN permissions p
            WHERE r.slug = 'lead' AND p.code = 'board.columns.manage'
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp
                WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        )
    )
