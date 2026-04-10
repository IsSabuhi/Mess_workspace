import { apiFetch, setAccessToken } from "./client";

/** Производственные системы пользователя (из профиля /me) */
export type SystemBrief = {
  id: string;
  name: string;
  slug: string;
};

export type UserOut = {
  id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  position: { id: string; name: string; slug: string } | null;
  birth_date: string | null;
  schedule_mode: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
  updated_at: string;
  roles: { id: string; slug: string; name: string }[];
  systems: SystemBrief[];
};

/** Текущий пользователь с кодами прав с бэкенда */
export type DashboardPreferences = {
  home?: Record<string, boolean>;
};

export type UserMe = UserOut & {
  permissions: string[];
  dashboard_preferences?: DashboardPreferences | null;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
};

export async function loginJson(email: string, password: string): Promise<TokenResponse> {
  return apiFetch<TokenResponse>("/api/v1/auth/login/json", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchMe(): Promise<UserMe> {
  return apiFetch<UserMe>("/api/v1/auth/me");
}

export type LoginAuditOut = {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type ProfilePatch = {
  full_name?: string;
  birth_date?: string | null;
  position_id?: string | null;
  dashboard_preferences?: DashboardPreferences;
};

export async function patchProfile(body: ProfilePatch): Promise<UserMe> {
  return apiFetch<UserMe>("/api/v1/auth/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function fetchLoginHistory(): Promise<LoginAuditOut[]> {
  return apiFetch<LoginAuditOut[]>("/api/v1/auth/me/login-history");
}

export async function registerUser(
  email: string,
  password: string,
  full_name: string,
): Promise<{ id: string; email: string }> {
  return apiFetch("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, full_name }),
  });
}

export async function logoutRequest(): Promise<void> {
  await apiFetch<void>("/api/v1/auth/logout", { method: "POST" });
}

export function logout() {
  setAccessToken(null);
}

export function saveSession(token: string) {
  setAccessToken(token);
}
