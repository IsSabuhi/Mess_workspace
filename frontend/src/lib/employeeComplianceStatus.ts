export type ValidityStatus = "ok" | "expiring" | "expired" | "missing" | "none" | "not_required";

export type ValidityInfo = {
  status: ValidityStatus;
  label: string;
  daysLeft: number | null;
};

/** Единая подпись для Excel/UI — удобно фильтровать и сортировать. */
export const EXAM_NOT_REQUIRED_LABEL = "Не требуется (удалёнщик)";

function parseDateOnly(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(`${v.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysUntil(validTo: string | null | undefined, today = startOfToday()): number | null {
  const end = parseDateOnly(validTo);
  if (!end) return null;
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

export function validityInfo(
  validTo: string | null | undefined,
  hasDocument: boolean,
  soonDays = 3,
  today = startOfToday(),
): ValidityInfo {
  if (!hasDocument) {
    return { status: "none", label: "Нет", daysLeft: null };
  }
  const days = daysUntil(validTo, today);
  if (days === null) {
    return { status: "missing", label: "Нет даты", daysLeft: null };
  }
  if (days < 0) {
    return { status: "expired", label: "Просрочен", daysLeft: days };
  }
  if (days <= soonDays) {
    return { status: "expiring", label: `Истекает (${days} дн.)`, daysLeft: days };
  }
  return { status: "ok", label: "В норме", daysLeft: days };
}

export function examElectricalValidityInfo(
  row: {
    is_remote?: boolean;
    exam_electrical_passed: boolean;
    exam_electrical_valid_to: string | null;
  },
  soonDays = 3,
  today = startOfToday(),
): ValidityInfo {
  if (row.is_remote) {
    return { status: "not_required", label: EXAM_NOT_REQUIRED_LABEL, daysLeft: null };
  }
  return validityInfo(row.exam_electrical_valid_to, row.exam_electrical_passed, soonDays, today);
}

/** Колонка «Экзамен ЭБ» / краткий статус сдачи. */
export function examElectricalPassedLabel(row: {
  is_remote?: boolean;
  exam_electrical_passed: boolean;
}): string {
  if (row.is_remote) return EXAM_NOT_REQUIRED_LABEL;
  return row.exam_electrical_passed ? "Сдан" : "Нет";
}

export function overallComplianceWorst(
  exam: ValidityInfo,
  pass: ValidityInfo,
): ValidityStatus {
  const rank: Record<ValidityStatus, number> = {
    expired: 0,
    expiring: 1,
    missing: 2,
    none: 3,
    not_required: 4,
    ok: 5,
  };
  return rank[exam.status] <= rank[pass.status] ? exam.status : pass.status;
}

export type ComplianceReportSummary = {
  total: number;
  examExpired: number;
  examExpiring3: number;
  examNone: number;
  examNotRequired: number;
  passExpired: number;
  passExpiring3: number;
  passNone: number;
};

export function summarizeComplianceRows(
  rows: Array<{
    is_remote?: boolean;
    exam_electrical_passed: boolean;
    exam_electrical_valid_to: string | null;
    pass_has: boolean;
    pass_valid_to: string | null;
  }>,
  soonDays = 3,
): ComplianceReportSummary {
  const today = startOfToday();
  const summary: ComplianceReportSummary = {
    total: rows.length,
    examExpired: 0,
    examExpiring3: 0,
    examNone: 0,
    examNotRequired: 0,
    passExpired: 0,
    passExpiring3: 0,
    passNone: 0,
  };
  for (const r of rows) {
    const exam = examElectricalValidityInfo(r, soonDays, today);
    const pass = validityInfo(r.pass_valid_to, r.pass_has, soonDays, today);
    if (exam.status === "not_required") summary.examNotRequired += 1;
    if (exam.status === "expired") summary.examExpired += 1;
    if (exam.status === "expiring") summary.examExpiring3 += 1;
    if (exam.status === "none" || exam.status === "missing") summary.examNone += 1;
    if (pass.status === "expired") summary.passExpired += 1;
    if (pass.status === "expiring") summary.passExpiring3 += 1;
    if (pass.status === "none" || pass.status === "missing") summary.passNone += 1;
  }
  return summary;
}
