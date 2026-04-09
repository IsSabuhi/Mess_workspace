import { apiFetch } from "./client";

export type SystemOut = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_count: number;
};

export type SystemMemberOut = {
  id: string;
  full_name: string;
  email: string;
  position: { id: string; name: string; slug: string } | null;
};

export type SystemCreate = {
  name: string;
  slug: string;
  description?: string | null;
  sort_order?: number;
};

export type SystemUpdate = {
  name?: string;
  slug?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export async function listSystems(activeOnly = true): Promise<SystemOut[]> {
  const q = activeOnly ? "?active_only=true" : "?active_only=false";
  return apiFetch<SystemOut[]>(`/api/v1/systems${q}`);
}

export async function createSystem(body: SystemCreate): Promise<SystemOut> {
  return apiFetch<SystemOut>("/api/v1/systems", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateSystem(systemId: string, body: SystemUpdate): Promise<SystemOut> {
  return apiFetch<SystemOut>(`/api/v1/systems/${systemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteSystem(systemId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/systems/${systemId}`, { method: "DELETE" });
}

export async function listSystemMembers(systemId: string): Promise<SystemMemberOut[]> {
  return apiFetch<SystemMemberOut[]>(`/api/v1/systems/${systemId}/members`);
}
