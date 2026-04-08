import { apiFetch } from "./client";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type TaskOut = {
  id: string;
  title: string;
  description: string | null;
  board_id: string;
  column_id: string;
  system_id: string;
  assignee_id: string | null;
  creator_id: string | null;
  priority: TaskPriority;
  due_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  assignee: { id: string; email: string; full_name: string } | null;
  creator: { id: string; email: string; full_name: string } | null;
  system: { id: string; name: string; slug: string } | null;
  column: { id: string; name: string; slug: string; is_done_column?: boolean } | null;
};

export type TaskCreate = {
  title: string;
  description?: string | null;
  column_id: string;
  /** Для руководителя (tasks.read.all) обязателен; иначе можно не передавать при одной системе */
  system_id?: string;
  assignee_id?: string | null;
  priority?: TaskPriority;
  due_at?: string | null;
  position?: number;
};

export type TaskUpdate = {
  title?: string;
  description?: string | null;
  column_id?: string;
  system_id?: string;
  assignee_id?: string | null;
  priority?: TaskPriority;
  due_at?: string | null;
  position?: number;
  archived_at?: string | null;
};

export async function getTask(taskId: string): Promise<TaskOut> {
  return apiFetch<TaskOut>(`/api/v1/tasks/${taskId}`);
}

export async function listTasks(params?: {
  system_id?: string;
  assignee_id?: string;
  column_id?: string;
  include_archived?: boolean;
}): Promise<TaskOut[]> {
  const sp = new URLSearchParams();
  if (params?.system_id) sp.set("system_id", params.system_id);
  if (params?.assignee_id) sp.set("assignee_id", params.assignee_id);
  if (params?.column_id) sp.set("column_id", params.column_id);
  if (params?.include_archived) sp.set("include_archived", "true");
  const q = sp.toString();
  return apiFetch<TaskOut[]>(`/api/v1/tasks${q ? `?${q}` : ""}`);
}

export async function createTask(body: TaskCreate): Promise<TaskOut> {
  return apiFetch<TaskOut>("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTask(taskId: string, body: TaskUpdate): Promise<TaskOut> {
  return apiFetch<TaskOut>(`/api/v1/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/tasks/${taskId}`, { method: "DELETE" });
}
