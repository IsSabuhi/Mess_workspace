/** Человекочитаемые подписи и детали для журнала аудита. */

const ACTION_LABELS: Record<string, string> = {
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
};

const FIELD_LABELS: Record<string, string> = {
  title: "заголовок",
  description: "описание",
  column_id: "колонка",
  system_id: "система",
  assignee_ids: "исполнители",
  priority: "приоритет",
  due_at: "срок",
  estimate_hours: "оценка",
  checklist: "чеклист",
  position: "позиция",
  archived_at: "архив",
  tag_ids: "теги",
};

function parseDetails(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

function asStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function renameLine(oldName: unknown, newName: unknown, noun = "Название"): string | null {
  const o = asStr(oldName);
  const n = asStr(newName);
  if (o && n && o !== n) return `${noun}: «${o}» → «${n}»`;
  if (n && !o) return `${noun}: «${n}»`;
  if (o && !n) return `${noun}: «${o}»`;
  return null;
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Сводка для вкладки «История» в карточке задачи — акцент на смене колонки/статуса. */
export function formatTaskHistorySummary(action: string, detailsJson: string | null | undefined): string {
  const d = parseDetails(detailsJson);
  if (!d) return formatAuditDetails(action, detailsJson);

  if (action === "task.updated") {
    const parts: string[] = [];
    if (d.old_column_name || d.new_column_name) {
      const move = renameLine(d.old_column_name, d.new_column_name, "Статус");
      if (move) parts.push(move);
    } else if (d.old_column_id && d.new_column_id) {
      parts.push("перенесена в другую колонку");
    }
    const titleRen = renameLine(d.old_title, d.title, "Заголовок");
    if (titleRen) parts.push(titleRen);
    const fields = Array.isArray(d.changed_fields)
      ? d.changed_fields
          .map((f) => String(f))
          .filter((f) => f !== "column_id" && f !== "position")
          .map((f) => FIELD_LABELS[f] ?? f)
      : [];
    if (fields.length) parts.push(`изменено: ${fields.join(", ")}`);
    if (d.archived_at != null || (Array.isArray(d.changed_fields) && d.changed_fields.includes("archived_at"))) {
      if (d.archived_at) parts.push("отправлена в архив");
      else if (Array.isArray(d.changed_fields) && d.changed_fields.includes("archived_at") && !d.archived_at) {
        parts.push("восстановлена из архива");
      }
    }
    if (parts.length) return parts.join(" · ");
  }

  if (action === "task.created") {
    const col = asStr(d.column_name) ?? asStr(d.column);
    if (col) return `Создана в колонке «${col}»`;
    return "Задача создана";
  }

  return formatAuditDetails(action, detailsJson);
}

/** Краткая человекочитаемая сводка по details_json. */
export function formatAuditDetails(action: string, detailsJson: string | null | undefined): string {
  const d = parseDetails(detailsJson);
  if (!d) return detailsJson?.trim() || "—";

  const parts: string[] = [];

  if (action === "board.updated") {
    const ren = renameLine(d.old_name, d.name);
    if (ren) parts.push(ren);
  } else if (action === "board.created" || action === "board.deleted") {
    const n = asStr(d.name);
    if (n) parts.push(`Доска: «${n}»`);
    if (action === "board.deleted" && d.tasks_deleted != null) {
      parts.push(`удалено задач: ${String(d.tasks_deleted)}`);
    }
    if (d.scope) parts.push(`область: ${String(d.scope)}`);
  } else if (action.startsWith("board.column.")) {
    const board = asStr(d.board_name);
    if (board) parts.push(`Доска: «${board}»`);
    const ren = renameLine(d.old_name, d.name, "Колонка");
    if (ren) parts.push(ren);
    else if (asStr(d.name)) parts.push(`Колонка: «${asStr(d.name)}»`);
    if (d.old_is_done_column != null || d.is_done_column != null) {
      const was = d.old_is_done_column;
      const now = d.is_done_column;
      if (was != null && now != null && was !== now) {
        parts.push(now ? "отмечена как «Выполнено»" : "снята отметка «Выполнено»");
      } else if (now === true) {
        parts.push("колонка «Выполнено»");
      }
    }
  } else if (action === "board.editing_lock.changed") {
    parts.push(d.is_editing_locked ? "блокировка включена" : "блокировка снята");
  } else if (action === "board.members.replaced") {
    if (d.member_count != null) parts.push(`участников: ${String(d.member_count)}`);
  } else if (action === "task.created" || action === "task.deleted") {
    const t = asStr(d.title);
    if (t) parts.push(`Задача: «${t}»`);
  } else if (action === "task.updated") {
    const titleRen = renameLine(d.old_title, d.title, "Задача");
    if (titleRen) parts.push(titleRen);
    else if (asStr(d.title)) parts.push(`Задача: «${asStr(d.title)}»`);
    const fields = Array.isArray(d.changed_fields)
      ? d.changed_fields.map((f) => FIELD_LABELS[String(f)] ?? String(f))
      : [];
    if (fields.length) parts.push(`изменено: ${fields.join(", ")}`);
    if (d.old_column_name || d.new_column_name) {
      const move = renameLine(d.old_column_name, d.new_column_name, "Колонка");
      if (move) parts.push(move);
    } else if (d.old_column_id && d.new_column_id) {
      parts.push("перенесена в другую колонку");
    }
  } else if (action.startsWith("task.comment.")) {
    const t = asStr(d.title);
    if (t) parts.push(`Задача: «${t}»`);
  } else if (action.startsWith("task.attachment.")) {
    const fn = asStr(d.filename);
    if (fn) parts.push(`Файл: «${fn}»`);
    const t = asStr(d.title);
    if (t) parts.push(`задача: «${t}»`);
  } else if (action.startsWith("schedule.cell.")) {
    const y = d.year;
    const m = d.month;
    const day = d.day;
    if (y != null && m != null && day != null) parts.push(`${day}.${m}.${y}`);
    if (d.code != null && String(d.code) !== "") parts.push(`код: ${String(d.code)}`);
    const un = asStr(d.user_name);
    if (un) parts.push(`сотрудник: ${un}`);
  } else if (action === "schedule.user_mode.updated") {
    const ren = renameLine(d.old_mode, d.new_mode, "Режим");
    if (ren) parts.push(ren);
  } else if (action === "schedule.autofill.ran" || action === "schedule.regenerate.ran") {
    if (d.year != null && d.month != null) parts.push(`${d.month}.${d.year}`);
    if (d.cells_written != null) parts.push(`ячеек: ${String(d.cells_written)}`);
  } else if (action === "schedule.import_excel.ran") {
    if (d.year != null && d.month != null) parts.push(`${d.month}.${d.year}`);
    if (d.matched != null) parts.push(`сопоставлено: ${String(d.matched)}`);
    if (d.unmatched != null) parts.push(`не найдено: ${String(d.unmatched)}`);
  } else if (action.startsWith("employee_directory.")) {
    if (Array.isArray(d.fields) && d.fields.length) parts.push(`поля: ${d.fields.join(", ")}`);
    if (d.users_count != null) parts.push(`сотрудников: ${String(d.users_count)}`);
  } else if (action.startsWith("auth.")) {
    const ip = asStr(d.ip);
    if (ip) parts.push(`IP: ${ip}`);
  }

  if (parts.length === 0) {
    // fallback: кратко показать пары ключ=значение без сырого JSON-вала
    for (const [k, v] of Object.entries(d)) {
      if (v == null || v === "") continue;
      if (typeof v === "object") continue;
      parts.push(`${k}: ${String(v)}`);
      if (parts.length >= 4) break;
    }
  }

  return parts.length ? parts.join(" · ") : "—";
}
