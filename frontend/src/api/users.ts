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
