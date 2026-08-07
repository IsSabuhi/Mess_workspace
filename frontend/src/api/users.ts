import type { UserOut } from "./auth";
import { apiFetch } from "./client";

export type UserCreate = {
  email: string;
  full_name: string;
  password: string;
  is_superuser?: boolean;
  role_ids?: string[];
  /** Производственные системы (видимость задач и канбана) */
  system_ids?: string[];
  position_id?: string | null;
  birth_date?: string | null;
  /** Требовать смену пароля при первом входе (по умолчанию true) */
  must_change_password?: boolean;
};

export type UserUpdate = {
  email?: string;
  full_name?: string;
  password?: string;
  is_active?: boolean;
  is_superuser?: boolean;
  role_ids?: string[] | null;
  /** Полная замена списка систем пользователя */
  system_ids?: string[] | null;
  position_id?: string | null;
  birth_date?: string | null;
  /** Вместе с password: требовать смену при следующем входе */
  must_change_password?: boolean;
};

export type UserListOut = {
  items: UserOut[];
  total: number;
  limit: number;
  offset: number;
};

export type ListUsersParams = {
  limit?: number;
  offset?: number;
  q?: string;
};

export async function listUsers(params?: ListUsersParams): Promise<UserListOut> {
  const sp = new URLSearchParams();
  if (typeof params?.limit === "number") sp.set("limit", String(params.limit));
  if (typeof params?.offset === "number") sp.set("offset", String(params.offset));
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  const qs = sp.toString();
  return apiFetch<UserListOut>(`/api/v1/users${qs ? `?${qs}` : ""}`);
}

/** Кандидаты в исполнители: на системной доске — сотрудники системы ∪ участники доски */
export async function listAssigneeCandidates(boardId?: string | null): Promise<UserOut[]> {
  const q = boardId ? `?board_id=${encodeURIComponent(boardId)}` : "";
  return apiFetch<UserOut[]>(`/api/v1/users/assignee-candidates${q}`);
}

export async function createUser(body: UserCreate): Promise<UserOut> {
  return apiFetch<UserOut>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateUser(userId: string, body: UserUpdate): Promise<UserOut> {
  return apiFetch<UserOut>(`/api/v1/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/users/${userId}`, { method: "DELETE" });
}

export type EmployeeImportRowStatus =
  | "created"
  | "updated"
  | "skipped_duplicate_file"
  | "skipped_exists"
  | "skipped_invalid";

export type EmployeeImportRowDetail = {
  sheet_row: number;
  login: string | null;
  status: EmployeeImportRowStatus;
  user_id: string | null;
  email: string | null;
  message: string | null;
};

export type EmployeeImportOut = {
  created: number;
  updated: number;
  skipped: number;
  rows: EmployeeImportRowDetail[];
};

export async function importUsersFromExcel(file: File): Promise<EmployeeImportOut> {
  const form = new FormData();
  form.set("file", file);
  return apiFetch<EmployeeImportOut>("/api/v1/users/import-excel", {
    method: "POST",
    body: form,
  });
}
