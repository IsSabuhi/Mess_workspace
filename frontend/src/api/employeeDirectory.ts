import { apiFetch } from "./client";

export type EmployeeDirectoryRowOut = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  position: { id: string; name: string; slug: string } | null;
  systems: { id: string; name: string; slug: string }[];
  exam_electrical_passed: boolean;
  exam_electrical_date: string | null;
  exam_electrical_valid_to: string | null;
  pass_has: boolean;
  pass_number: string | null;
  pass_valid_from: string | null;
  pass_valid_to: string | null;
  notes: string | null;
};

export type EmployeeDirectoryFilters = {
  search?: string;
  system_id?: string;
  position_id?: string;
  exam_electrical_passed?: boolean;
  pass_has?: boolean;
  expiring_in_days?: number;
  expired_only?: boolean;
  include_inactive_users?: boolean;
};

export type EmployeeDirectoryPatch = {
  exam_electrical_passed?: boolean;
  exam_electrical_date?: string | null;
  exam_electrical_valid_to?: string | null;
  pass_has?: boolean;
  pass_number?: string | null;
  pass_valid_from?: string | null;
  pass_valid_to?: string | null;
  notes?: string | null;
};

export async function listEmployeeDirectory(
  filters?: EmployeeDirectoryFilters,
): Promise<EmployeeDirectoryRowOut[]> {
  const sp = new URLSearchParams();
  if (filters?.search) sp.set("search", filters.search);
  if (filters?.system_id) sp.set("system_id", filters.system_id);
  if (filters?.position_id) sp.set("position_id", filters.position_id);
  if (filters?.exam_electrical_passed !== undefined) {
    sp.set("exam_electrical_passed", String(filters.exam_electrical_passed));
  }
  if (filters?.pass_has !== undefined) sp.set("pass_has", String(filters.pass_has));
  if (filters?.expiring_in_days !== undefined) sp.set("expiring_in_days", String(filters.expiring_in_days));
  if (filters?.expired_only) sp.set("expired_only", "true");
  if (filters?.include_inactive_users) sp.set("include_inactive_users", "true");
  const q = sp.toString();
  return apiFetch<EmployeeDirectoryRowOut[]>(`/api/v1/employee-directory${q ? `?${q}` : ""}`);
}

export async function patchEmployeeDirectory(
  userId: string,
  body: EmployeeDirectoryPatch,
): Promise<EmployeeDirectoryRowOut> {
  return apiFetch<EmployeeDirectoryRowOut>(`/api/v1/employee-directory/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
