import { apiFetch } from "./client";

export type PermissionOut = {
  id: string;
  code: string;
  description: string | null;
};

export type RoleOut = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_system: boolean;
  /** Сколько пользователей назначено на эту роль */
  user_count: number;
  permissions: PermissionOut[];
};

export type RoleCreate = {
  name: string;
  slug: string;
  description?: string | null;
  permission_ids?: string[];
};

export type RoleUpdate = {
  name?: string;
  description?: string | null;
  permission_ids?: string[] | null;
};

export async function listPermissionsCatalog(): Promise<PermissionOut[]> {
  return apiFetch<PermissionOut[]>("/api/v1/roles/permissions");
}

export async function listRoles(): Promise<RoleOut[]> {
  return apiFetch<RoleOut[]>("/api/v1/roles");
}

export async function createRole(body: RoleCreate): Promise<RoleOut> {
  return apiFetch<RoleOut>("/api/v1/roles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateRole(roleId: string, body: RoleUpdate): Promise<RoleOut> {
  return apiFetch<RoleOut>(`/api/v1/roles/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteRole(roleId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/roles/${roleId}`, { method: "DELETE" });
}
