import { apiFetch } from "./client";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type TaskOut = {
  id: string;
  title: string;
  description: string | null;
  board_id: string;
  column_id: string;
  system_id: string;
  creator_id: string | null;
  priority: TaskPriority;
  due_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  assignees: { id: string; email: string; full_name: string }[];
  creator: { id: string; email: string; full_name: string } | null;
  system: { id: string; name: string; slug: string } | null;
  column: { id: string; name: string; slug: string; is_done_column?: boolean } | null;
  tags: { id: string; name: string; color: string }[];
};

export type TaskCommentOut = {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  author: { id: string; email: string; full_name: string } | null;
};

export type TaskAnalyticsBucketOut = {
  key: string;
  label: string;
  total: number;
  active: number;
  overdue: number;
};

export type TaskDueTrendPointOut = {
  date: string;
  due_total: number;
  overdue_total: number;
};

export type TaskAnalyticsOut = {
  kpi: {
    total: number;
    active: number;
    overdue: number;
    due_soon: number;
    unassigned: number;
    high_priority: number;
  };
  by_system: TaskAnalyticsBucketOut[];
  by_column: TaskAnalyticsBucketOut[];
  by_assignee: TaskAnalyticsBucketOut[];
  due_trend: TaskDueTrendPointOut[];
};

export type TaskCreate = {
  title: string;
  description?: string | null;
  board_id?: string;
  column_id: string;
  /** Для руководителя (tasks.read.all) обязателен; иначе можно не передавать при одной системе */
  system_id?: string;
  assignee_ids?: string[];
  priority?: TaskPriority;
  due_at?: string | null;
  position?: number;
  tag_ids?: string[];
};

export type TaskUpdate = {
  title?: string;
  description?: string | null;
  column_id?: string;
  system_id?: string;
  assignee_ids?: string[];
  priority?: TaskPriority;
  due_at?: string | null;
  position?: number;
  archived_at?: string | null;
  tag_ids?: string[];
};

export async function getTask(taskId: string): Promise<TaskOut> {
  return apiFetch<TaskOut>(`/api/v1/tasks/${taskId}`);
}

export async function listTasks(params?: {
  board_id?: string;
  system_id?: string;
  assignee_id?: string;
  column_id?: string;
  include_archived?: boolean;
}): Promise<TaskOut[]> {
  const sp = new URLSearchParams();
  if (params?.board_id) sp.set("board_id", params.board_id);
  if (params?.system_id) sp.set("system_id", params.system_id);
  if (params?.assignee_id) sp.set("assignee_id", params.assignee_id);
  if (params?.column_id) sp.set("column_id", params.column_id);
  if (params?.include_archived) sp.set("include_archived", "true");
  const q = sp.toString();
  return apiFetch<TaskOut[]>(`/api/v1/tasks${q ? `?${q}` : ""}`);
}

export async function getTasksAnalytics(params?: {
  system_id?: string;
  assignee_id?: string;
  column_id?: string;
  include_archived?: boolean;
  trend_days?: number;
}): Promise<TaskAnalyticsOut> {
  const sp = new URLSearchParams();
  if (params?.system_id) sp.set("system_id", params.system_id);
  if (params?.assignee_id) sp.set("assignee_id", params.assignee_id);
  if (params?.column_id) sp.set("column_id", params.column_id);
  if (params?.include_archived) sp.set("include_archived", "true");
  if (typeof params?.trend_days === "number") sp.set("trend_days", String(params.trend_days));
  const q = sp.toString();
  return apiFetch<TaskAnalyticsOut>(`/api/v1/tasks/analytics${q ? `?${q}` : ""}`);
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

export async function listTaskComments(taskId: string): Promise<TaskCommentOut[]> {
  return apiFetch<TaskCommentOut[]>(`/api/v1/tasks/${taskId}/comments`);
}

export async function createTaskComment(taskId: string, body: { body: string }): Promise<TaskCommentOut> {
  return apiFetch<TaskCommentOut>(`/api/v1/tasks/${taskId}/comments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTaskComment(taskId: string, commentId: string, body: { body: string }): Promise<TaskCommentOut> {
  return apiFetch<TaskCommentOut>(`/api/v1/tasks/${taskId}/comments/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTaskComment(taskId: string, commentId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/tasks/${taskId}/comments/${commentId}`, {
    method: "DELETE",
  });
}
