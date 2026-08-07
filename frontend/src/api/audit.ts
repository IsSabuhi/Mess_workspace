import { apiFetch } from "./client";

export type AuditSettingsOut = {
  enabled: boolean;
  retention_days: number;
};

export type AuditEventOut = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  actor_user_id: string | null;
  actor_name: string | null;
  details_json: string | null;
  created_at: string;
};

export async function getAuditSettings(): Promise<AuditSettingsOut> {
  return apiFetch<AuditSettingsOut>("/api/v1/audit/settings");
}

export async function patchAuditSettings(body: {
  enabled?: boolean;
  retention_days?: number;
}): Promise<AuditSettingsOut> {
  return apiFetch<AuditSettingsOut>("/api/v1/audit/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function listAuditEvents(params?: {
  limit?: number;
  offset?: number;
  entity_type?: string;
  action?: string;
  q?: string;
  actor_user_id?: string;
  actor_q?: string;
  system_only?: boolean;
}): Promise<AuditEventOut[]> {
  const sp = new URLSearchParams();
  if (typeof params?.limit === "number") sp.set("limit", String(params.limit));
  if (typeof params?.offset === "number") sp.set("offset", String(params.offset));
  if (params?.entity_type?.trim()) sp.set("entity_type", params.entity_type.trim());
  if (params?.action?.trim()) sp.set("action", params.action.trim());
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  if (params?.actor_user_id?.trim()) sp.set("actor_user_id", params.actor_user_id.trim());
  if (params?.actor_q?.trim()) sp.set("actor_q", params.actor_q.trim());
  if (params?.system_only) sp.set("system_only", "true");
  const qs = sp.toString();
  return apiFetch<AuditEventOut[]>(`/api/v1/audit/events${qs ? `?${qs}` : ""}`);
}
