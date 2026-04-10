import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationOut,
} from "../api/notifications";
import { AppShell } from "../components/AppShell";
import { queryClient } from "../lib/queryClient";
import { toastApiError, toastSuccess } from "../lib/toast";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function notificationTypeLabel(type: NotificationOut["type"]): string {
  if (type === "release_note") return "Обновление системы";
  if (type === "task_overdue") return "Просрочено";
  return "До 3 дней";
}

export function NotificationsPage() {
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications({ limit: 100 }),
  });

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
      ]);
    },
    onError: (err) => toastApiError(err, "Не удалось отметить уведомление прочитанным"),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: async () => {
      toastSuccess("Все уведомления отмечены прочитанными");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
      ]);
    },
    onError: (err) => toastApiError(err, "Не удалось отметить все уведомления"),
  });

  const items = notificationsQuery.data ?? [];
  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <AppShell title="Уведомления" subtitle="События по вашим задачам и срокам">
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Непрочитанных: <span className="font-semibold text-slate-900 dark:text-white">{unreadCount}</span>
          </p>
          <button
            type="button"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending || unreadCount === 0}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
          >
            Отметить все прочитанными
          </button>
        </div>

        {notificationsQuery.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
        {!notificationsQuery.isPending && items.length === 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-400">Пока уведомлений нет.</p>
        )}

        {!notificationsQuery.isPending && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((n) => (
              <li
                key={n.id}
                className={`rounded-xl border px-4 py-3 ${
                  n.read_at
                    ? "border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/30"
                    : "border-sky-200 bg-sky-50/70 dark:border-sky-900/40 dark:bg-sky-950/20"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white">{n.title}</p>
                    {n.body && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{n.body}</p>}
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {notificationTypeLabel(n.type)} · {formatDate(n.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {n.task_id && (
                      <Link
                        to="/tasks"
                        className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
                      >
                        К задаче
                      </Link>
                    )}
                    {!n.read_at && (
                      <button
                        type="button"
                        onClick={() => markReadMutation.mutate(n.id)}
                        disabled={markReadMutation.isPending}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:hover:bg-slate-800"
                      >
                        Прочитано
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
