import type { EmployeeDirectoryRowOut } from "../api/employeeDirectory";
import { examElectricalValidityInfo, validityInfo, type ValidityStatus } from "./employeeComplianceStatus";
import { asInputDate, formatGenderCell, formatScheduleSummary } from "./employeeDirectoryFormat";

export type TabId = "compliance" | "profile" | "vacations" | "report";
export type SortDir = "asc" | "desc";
export type SortKey =
  | "name"
  | "position"
  | "systems"
  | "exam"
  | "examStatus"
  | "pass"
  | "passStatus"
  | "notes"
  | "personnelNumber"
  | "birthDate"
  | "positionAssignedAt"
  | "gender"
  | "schedule"
  | "remote"
  | "workAddress"
  | "fieldWorker"
  | "vacation";

export const TAB_SORT_KEYS: Record<TabId, readonly SortKey[]> = {
  compliance: ["name", "position", "systems", "exam", "pass", "notes"],
  report: ["name", "position", "systems", "exam", "examStatus", "pass", "passStatus"],
  profile: [
    "name",
    "personnelNumber",
    "birthDate",
    "position",
    "positionAssignedAt",
    "systems",
    "gender",
    "schedule",
    "remote",
    "workAddress",
    "fieldWorker",
    "vacation",
  ],
  vacations: ["name"],
};

const STATUS_SORT_RANK: Record<ValidityStatus, number> = {
  expired: 0,
  expiring: 1,
  missing: 2,
  none: 3,
  not_required: 4,
  ok: 5,
};

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" });
}

function cmpEmptyLast(a: string, b: string): number {
  const ae = !a.trim();
  const be = !b.trim();
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  return cmpStr(a, b);
}

function nameTie(a: EmployeeDirectoryRowOut, b: EmployeeDirectoryRowOut): number {
  return cmpStr(a.full_name, b.full_name) || cmpStr(a.email, b.email);
}

export function compareDirectoryRows(
  a: EmployeeDirectoryRowOut,
  b: EmployeeDirectoryRowOut,
  key: SortKey,
  dir: SortDir,
): number {
  let c = 0;
  switch (key) {
    case "name":
      c = nameTie(a, b);
      break;
    case "position":
      c = cmpEmptyLast(a.position?.name ?? "", b.position?.name ?? "");
      break;
    case "systems":
      c = cmpEmptyLast(
        a.systems.map((s) => s.name).join(", "),
        b.systems.map((s) => s.name).join(", "),
      );
      break;
    case "exam":
      c = Number(Boolean(a.is_remote)) - Number(Boolean(b.is_remote));
      if (!c) c = Number(a.exam_electrical_passed) - Number(b.exam_electrical_passed);
      if (!c) c = cmpEmptyLast(asInputDate(a.exam_electrical_valid_to), asInputDate(b.exam_electrical_valid_to));
      if (!c) c = cmpEmptyLast(a.exam_electrical_group ?? "", b.exam_electrical_group ?? "");
      break;
    case "examStatus": {
      const ea = examElectricalValidityInfo(a);
      const eb = examElectricalValidityInfo(b);
      c = STATUS_SORT_RANK[ea.status] - STATUS_SORT_RANK[eb.status];
      if (!c) c = (ea.daysLeft ?? 99_999) - (eb.daysLeft ?? 99_999);
      break;
    }
    case "pass":
      c = Number(a.pass_has) - Number(b.pass_has);
      if (!c) c = cmpEmptyLast(asInputDate(a.pass_valid_to), asInputDate(b.pass_valid_to));
      if (!c) c = cmpEmptyLast(a.pass_number ?? "", b.pass_number ?? "");
      break;
    case "passStatus": {
      const pa = validityInfo(a.pass_valid_to, a.pass_has);
      const pb = validityInfo(b.pass_valid_to, b.pass_has);
      c = STATUS_SORT_RANK[pa.status] - STATUS_SORT_RANK[pb.status];
      if (!c) c = (pa.daysLeft ?? 99_999) - (pb.daysLeft ?? 99_999);
      break;
    }
    case "notes":
      c = cmpEmptyLast(a.notes ?? "", b.notes ?? "");
      break;
    case "personnelNumber":
      c = cmpEmptyLast(a.personnel_number ?? "", b.personnel_number ?? "");
      break;
    case "birthDate":
      c = cmpEmptyLast(asInputDate(a.birth_date), asInputDate(b.birth_date));
      break;
    case "positionAssignedAt":
      c = cmpEmptyLast(asInputDate(a.position_assigned_at), asInputDate(b.position_assigned_at));
      break;
    case "gender":
      c = cmpStr(formatGenderCell(a.gender), formatGenderCell(b.gender));
      break;
    case "schedule":
      c = cmpStr(formatScheduleSummary(a), formatScheduleSummary(b));
      break;
    case "remote":
      c = Number(Boolean(a.is_remote)) - Number(Boolean(b.is_remote));
      break;
    case "workAddress":
      c = cmpEmptyLast(a.work_address ?? "", b.work_address ?? "");
      break;
    case "fieldWorker":
      c = Number(Boolean(a.is_field_worker)) - Number(Boolean(b.is_field_worker));
      break;
    case "vacation":
      c = (a.vacation_periods?.length ?? 0) - (b.vacation_periods?.length ?? 0);
      break;
  }
  if (!c && key !== "name") c = nameTie(a, b);
  return dir === "asc" ? c : -c;
}
