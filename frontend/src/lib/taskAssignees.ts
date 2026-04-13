import type { TaskOut } from "../api/tasks";

export function taskAssigneesList(task: TaskOut): { id: string; full_name: string }[] {
  return task.assignees ?? [];
}

export function taskHasAssignee(task: TaskOut, userId: string): boolean {
  return (task.assignees ?? []).some((a) => a.id === userId);
}

/** Краткая строка для карточки канбана */
export function formatAssigneesLabel(task: TaskOut, maxNames = 2): string {
  const names = (task.assignees ?? []).map((a) => a.full_name);
  if (names.length === 0) return "";
  if (names.length <= maxNames) return names.join(", ");
  return `${names.slice(0, maxNames).join(", ")} +${names.length - maxNames}`;
}
