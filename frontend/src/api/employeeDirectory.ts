import { apiFetch } from "./client";

export type VacationPeriod = {
  start: string;
  end: string;
};

export type WorkScheduleKind = "five_two" | "shift" | "two_two";
/** Пол сотрудника: для 5/2 из него считаются 8 ч или 7.2 ч */
export type EmployeeGender = "male" | "female" | "unspecified";

export type EmployeeDirectoryRowOut = {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  birth_date: string | null;
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
  vacation_periods: VacationPeriod[];
  work_schedule_kind: WorkScheduleKind;
  gender: EmployeeGender;
};

export type EmployeeDirectoryFilters = {
  search?: string;
  /** Хотя бы одна из систем (ИЛИ) */
  system_ids?: string[];
  /** Хотя бы одна из должностей (ИЛИ) */
  position_ids?: string[];
  exam_electrical_passed?: boolean;
  pass_has?: boolean;
  expiring_in_days?: number;
  expired_only?: boolean;
  include_inactive_users?: boolean;
  gender?: EmployeeGender;
  work_schedule_kind?: WorkScheduleKind;
};

export type EmployeeDirectoryPatch = {
  birth_date?: string | null;
  position_id?: string | null;
  system_ids?: string[];
  exam_electrical_passed?: boolean;
  exam_electrical_date?: string | null;
  exam_electrical_valid_to?: string | null;
  pass_has?: boolean;
  pass_number?: string | null;
  pass_valid_from?: string | null;
  pass_valid_to?: string | null;
  notes?: string | null;
  vacation_periods?: VacationPeriod[];
  work_schedule_kind?: WorkScheduleKind;
  gender?: EmployeeGender;
};

export async function listEmployeeDirectory(
  filters?: EmployeeDirectoryFilters,
): Promise<EmployeeDirectoryRowOut[]> {
  const sp = new URLSearchParams();
  if (filters?.search) sp.set("search", filters.search);
  if (filters?.system_ids?.length) {
    for (const id of filters.system_ids) sp.append("system_ids", id);
  }
  if (filters?.position_ids?.length) {
    for (const id of filters.position_ids) sp.append("position_ids", id);
  }
  if (filters?.exam_electrical_passed !== undefined) {
    sp.set("exam_electrical_passed", String(filters.exam_electrical_passed));
  }
  if (filters?.pass_has !== undefined) sp.set("pass_has", String(filters.pass_has));
  if (filters?.expiring_in_days !== undefined) sp.set("expiring_in_days", String(filters.expiring_in_days));
  if (filters?.expired_only) sp.set("expired_only", "true");
  if (filters?.include_inactive_users) sp.set("include_inactive_users", "true");
  if (filters?.gender) sp.set("gender", filters.gender);
  if (filters?.work_schedule_kind) sp.set("work_schedule_kind", filters.work_schedule_kind);
  const q = sp.toString();
  return apiFetch<EmployeeDirectoryRowOut[]>(`/api/v1/employee-directory${q ? `?${q}` : ""}`);
}

export async function getEmployeeDirectoryUser(userId: string): Promise<EmployeeDirectoryRowOut> {
  return apiFetch<EmployeeDirectoryRowOut>(`/api/v1/employee-directory/${userId}`);
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

export type EmployeeDirectoryBulkProfilePatch = {
  work_schedule_kind?: WorkScheduleKind;
  gender?: EmployeeGender;
  position_id?: string | null;
  system_ids?: string[];
};

export async function bulkEmployeeDirectoryProfile(body: {
  user_ids: string[];
  patch: EmployeeDirectoryBulkProfilePatch;
}): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>("/api/v1/employee-directory/bulk-profile", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
