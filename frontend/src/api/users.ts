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
};

export async function listUsers(): Promise<UserOut[]> {
  return apiFetch<UserOut[]>("/api/v1/users");
}

/** Кандидаты в исполнители задачи: все активные (для руководителя) или участники тех же производственных систем */
export async function listAssigneeCandidates(): Promise<UserOut[]> {
  return apiFetch<UserOut[]>("/api/v1/users/assignee-candidates");
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
