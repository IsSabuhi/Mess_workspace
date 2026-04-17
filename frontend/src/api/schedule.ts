import { apiFetch } from "./client";

export type ScheduleDayInfo = {
  day: number;
  is_weekend: boolean;
  is_ru_holiday: boolean;
};

export type ScheduleUserRow = {
  user_id: string;
  full_name: string;
  email: string;
  schedule_mode: string;
  systems_label: string;
  work_schedule_kind: "five_two" | "shift" | "two_two";
  gender: "male" | "female" | "unspecified";
  row_kind: string;
  cells: Record<string, string | null>;
  /** Сумма числовых ячеек за месяц (8, 7.2, 11…) */
  hours_total: number;
};

export type ScheduleGroupOut = {
  system_id: string | null;
  label: string;
  users: ScheduleUserRow[];
};

export type ShiftStaffingNoteOut = {
  system_id: string;
  system_name: string;
  shift_staff_total: number;
  message: string;
};

export type ShiftCoverageWarningOut = {
  system_id: string;
  system_name: string;
  day: number;
  working_count: number;
  shift_staff_total: number;
  message: string;
};

export type ScheduleMonthOut = {
  year: number;
  month: number;
  days_in_month: number;
  days: ScheduleDayInfo[];
  groups: ScheduleGroupOut[];
  /** Минимум сменщиков «на работе» в день по системе (серверная проверка). */
  min_shift_staff_required: number;
  shift_staffing_notes: ShiftStaffingNoteOut[];
  shift_coverage_warnings: ShiftCoverageWarningOut[];
};

export async function getScheduleMonth(year: number, month: number): Promise<ScheduleMonthOut> {
  const sp = new URLSearchParams({ year: String(year), month: String(month) });
  return apiFetch<ScheduleMonthOut>(`/api/v1/schedule/month?${sp.toString()}`);
}

export async function patchScheduleCell(body: {
  year: number;
  month: number;
  user_id: string;
  day: number;
  code: string | null;
}): Promise<{ year: number; month: number; user_id: string; day: number; code: string | null }> {
  return apiFetch("/api/v1/schedule/cell", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function patchScheduleUserMode(
  userId: string,
  schedule_mode: string,
): Promise<{ user_id: string; schedule_mode: string; row_kind: string }> {
  return apiFetch(`/api/v1/schedule/users/${userId}/mode`, {
    method: "PATCH",
    body: JSON.stringify({ schedule_mode }),
  });
}

export async function postScheduleAutofill(body: {
  year: number;
  month: number;
  only_empty: boolean;
}): Promise<{ cells_written: number }> {
  return apiFetch("/api/v1/schedule/autofill", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function postScheduleRegenerate(body: {
  year: number;
  month: number;
}): Promise<{ cells_written: number }> {
  return apiFetch("/api/v1/schedule/regenerate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
