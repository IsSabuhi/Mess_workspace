"""Подписи действий аудита — держать в синхроне с frontend/src/lib/auditFormat.ts."""

from __future__ import annotations

# Код события → подпись в журнале.
AUDIT_ACTION_LABELS: dict[str, str] = {
    "auth.login": "Вход в систему",
    "auth.logout": "Выход из системы",
    "board.created": "Создана доска",
    "board.updated": "Изменена доска",
    "board.deleted": "Удалена доска",
    "board.members.replaced": "Обновлены участники доски",
    "board.editing_lock.changed": "Блокировка редактирования доски",
    "board.column.created": "Создана колонка",
    "board.column.updated": "Изменена колонка",
    "board.column.deleted": "Удалена колонка",
    "task.created": "Создана задача",
    "task.updated": "Изменена задача",
    "task.deleted": "Удалена задача",
    "task.comment.created": "Добавлен комментарий",
    "task.comment.updated": "Изменён комментарий",
    "task.comment.deleted": "Удалён комментарий",
    "task.attachment.uploaded": "Прикреплён файл",
    "task.attachment.deleted": "Удалён файл",
    "schedule.cell.updated": "Изменена ячейка графика",
    "schedule.cell.cleared": "Очищена ячейка графика",
    "schedule.row_color.updated": "Цвет строки графика",
    "schedule.row_color.cleared": "Сброшен цвет строки графика",
    "schedule.autofill.ran": "Автозаполнение графика",
    "schedule.regenerate.ran": "Перегенерация графика",
    "schedule.import_excel.ran": "Импорт графика из Excel",
    "knowledge.space.updated": "Изменено пространство БЗ",
    "knowledge.space.deleted": "Удалено пространство БЗ",
    "schedule.user_mode.updated": "Режим графика пользователя",
    "employee_directory.profile.updated": "Обновлён профиль сотрудника",
    "employee_directory.bulk_profile.updated": "Массовое обновление профилей",
    "employee_directory.vacations.imported": "Импорт отпусков из Excel",
    "system_backup.requested": "Запрошена резервная копия БД",
    "system_backup.downloaded": "Скачана резервная копия БД",
    "system_backup.deleted": "Удалена резервная копия БД",
    "system_backup.settings_updated": "Изменены настройки резервных копий",
    "uspd.created": "Создан объект УСПД",
    "uspd.updated": "Изменён объект УСПД",
    "uspd.entry.created": "Добавлена строка УСПД",
    "uspd.entry.updated": "Изменена строка УСПД",
    "uspd.entry.deleted": "Удалена строка УСПД",
    "uspd.model.created": "Добавлена модель УСПД",
    "uspd.imported": "Импорт УСПД из Obsidian",
    "uspd.sim.imported": "Импорт SIM УСПД из Excel",
}


def matching_audit_action_codes(query: str) -> list[str]:
    """Коды действий, у которых код или русская подпись содержит запрос."""
    needle = query.strip().lower()
    if not needle:
        return []
    return [
        code
        for code, label in AUDIT_ACTION_LABELS.items()
        if needle in code.lower() or needle in label.lower()
    ]
