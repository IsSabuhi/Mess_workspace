import { ApiError, apiFetch } from "./client";

const API_BASE = import.meta.env.VITE_API_BASE || "/mes/api";

export type SystemBackupOut = {
  id: string;
  filename: string;
  size_bytes: number | null;
  status: "pending" | "running" | "completed" | "failed" | string;
  source: "manual" | "scheduled" | string;
  error_message: string | null;
  created_by_id: string | null;
  created_by_name: string | null;
  created_at: string;
  finished_at: string | null;
};

export function listSystemBackups() {
  return apiFetch<SystemBackupOut[]>("/api/v1/backups");
}

export function requestSystemBackup() {
  return apiFetch<SystemBackupOut>("/api/v1/backups", { method: "POST" });
}

export async function deleteSystemBackup(backupId: string) {
  await apiFetch<{ detail: string }>(`/api/v1/backups/${backupId}`, { method: "DELETE" });
}

export type BackupSettingsOut = {
  enabled: boolean;
  retention_days: number;
  hour: number;
  minute: number;
  run_at: string;
  timezone: string;
  keep_max: number;
  latest_size_bytes: number | null;
  estimated_bytes: number | null;
};

export function getBackupSettings() {
  return apiFetch<BackupSettingsOut>("/api/v1/backups/settings");
}

export function patchBackupSettings(body: {
  enabled?: boolean;
  retention_days?: number;
  hour?: number;
  minute?: number;
  run_at?: string;
}) {
  return apiFetch<BackupSettingsOut>("/api/v1/backups/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function parseError(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return res.statusText || `HTTP ${res.status}`;
  try {
    const data = JSON.parse(text) as { detail?: unknown };
    if (typeof data.detail === "string") return data.detail;
    if (data.detail != null) return JSON.stringify(data.detail);
  } catch {
    /* ignore */
  }
  return text.slice(0, 400);
}

export async function downloadSystemBackup(backupId: string, filename: string): Promise<void> {
  const path = `/api/v1/backups/${backupId}/download`;
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      credentials: "include",
    });

  let res = await doFetch();
  if (res.status === 401) {
    const rr = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
    });
    if (rr.ok) res = await doFetch();
  }
  if (!res.ok) {
    throw new ApiError(res.status, await parseError(res));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
