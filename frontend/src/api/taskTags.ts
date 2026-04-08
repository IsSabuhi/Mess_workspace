import { apiFetch } from "./client";

export type TaskTagOut = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type TaskTagCreate = {
  name: string;
  color?: string;
  sort_order?: number;
};

export type TaskTagUpdate = {
  name?: string;
  color?: string;
  sort_order?: number;
};

export async function listTaskTags(): Promise<TaskTagOut[]> {
  return apiFetch<TaskTagOut[]>("/api/v1/task-tags");
}

export async function createTaskTag(body: TaskTagCreate): Promise<TaskTagOut> {
  return apiFetch<TaskTagOut>("/api/v1/task-tags", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTaskTag(tagId: string, body: TaskTagUpdate): Promise<TaskTagOut> {
  return apiFetch<TaskTagOut>(`/api/v1/task-tags/${tagId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTaskTag(tagId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/task-tags/${tagId}`, { method: "DELETE" });
}
