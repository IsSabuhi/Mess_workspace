import type { EmployeeDirectoryRowOut } from "../api/employeeDirectory";
import type { ValidityStatus } from "./employeeComplianceStatus";

export function asInputDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

export function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addOneYearDateInput(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const src = new Date(y, mo - 1, d);
  if (Number.isNaN(src.getTime()) || src.getFullYear() !== y || src.getMonth() !== mo - 1 || src.getDate() !== d) {
    return "";
  }
  const nextYear = y + 1;
  // Date.setFullYear(2025) для 29.02.2024 даёт 1 марта — клипируем до последнего дня месяца.
  const lastDay = new Date(nextYear, mo, 0).getDate();
  const dt = new Date(nextYear, mo - 1, Math.min(d, lastDay));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function formatGenderCell(g: string | undefined): string {
  if (g === "female") return "Женский";
  if (g === "male") return "Мужской";
  return "Не указан";
}

export function formatScheduleSummary(row: EmployeeDirectoryRowOut): string {
  if (row.work_schedule_kind === "shift") return "Сменный";
  if (row.work_schedule_kind === "two_two") return "2/2";
  const norm = row.gender === "female" ? "7.2 ч" : "8 ч";
  return `5/2 · ${norm}`;
}

export function statusBadgeClass(status: ValidityStatus): string {
  if (status === "expired") {
    return "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200";
  }
  if (status === "expiring") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }
  if (status === "ok") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  }
  if (status === "not_required") {
    return "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}
