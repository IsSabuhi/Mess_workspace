import { apiFetch } from "./client";

export type NotificationType = "task_due_3_days" | "task_overdue" | "release_note";

export type NotificationOut = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  task_id: string | null;
  release_note_id: string | null;
  created_at: string;
  read_at: string | null;
};

export async function listNotifications(params?: {
  unread_only?: boolean;
  limit?: number;
}): Promise<NotificationOut[]> {
  const sp = new URLSearchParams();
  if (params?.unread_only) sp.set("unread_only", "true");
  if (params?.limit) sp.set("limit", String(params.limit));
  const q = sp.toString();
  return apiFetch<NotificationOut[]>(`/api/v1/notifications${q ? `?${q}` : ""}`);
}

export async function getUnreadNotificationCount(): Promise<number> {
  const data = await apiFetch<{ unread_count: number }>("/api/v1/notifications/unread-count");
  return data.unread_count;
}

export async function markNotificationRead(notificationId: string): Promise<NotificationOut> {
  return apiFetch<NotificationOut>(`/api/v1/notifications/${notificationId}/read`, {
    method: "POST",
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch("/api/v1/notifications/read-all", { method: "POST" });
}
