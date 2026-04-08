import type { TaskOut } from "../api/tasks";

/**
 * Задача считается выполненной для отчётов, если колонка помечена `is_done_column`
 * (на доске может быть только одна такая колонка) или у колонки из сида slug `done`.
 */
export function taskInDoneColumn(t: Pick<TaskOut, "column">): boolean {
  const c = t.column;
  if (!c) return false;
  if (c.is_done_column === true) return true;
  return c.slug === "done";
}

/** Задача участвует в метриках «активных» на дашборде: не архив и не в колонке «Выполнено». */
export function taskIsActiveForDashboard(t: TaskOut): boolean {
  if (t.archived_at) return false;
  return !taskInDoneColumn(t);
}

/** Просрочка для отчётов: не архив, не «Выполнено», срок в прошлом. */
export function taskIsOverdueForDashboard(t: TaskOut): boolean {
  if (t.archived_at) return false;
  if (taskInDoneColumn(t)) return false;
  if (!t.due_at) return false;
  return new Date(t.due_at) < new Date();
}
