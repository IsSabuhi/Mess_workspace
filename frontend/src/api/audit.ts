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
