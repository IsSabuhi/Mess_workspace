import { apiFetch } from "./client";

export type PositionOut = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  user_count: number;
};

export type PositionCreate = {
  name: string;
  slug: string;
  description?: string | null;
  sort_order?: number;
};

export type PositionUpdate = {
  name?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export async function listPositions(activeOnly = true): Promise<PositionOut[]> {
  const sp = new URLSearchParams();
  sp.set("active_only", activeOnly ? "true" : "false");
  return apiFetch<PositionOut[]>(`/api/v1/positions?${sp.toString()}`);
}

export async function createPosition(body: PositionCreate): Promise<PositionOut> {
  return apiFetch<PositionOut>("/api/v1/positions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updatePosition(id: string, body: PositionUpdate): Promise<PositionOut> {
  return apiFetch<PositionOut>(`/api/v1/positions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deletePosition(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/positions/${id}`, { method: "DELETE" });
}
