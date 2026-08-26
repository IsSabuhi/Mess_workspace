import ExcelJS from "exceljs";

import type { EmployeeDirectoryRowOut } from "../api/employeeDirectory";
import {
  examElectricalPassedLabel,
  examElectricalValidityInfo,
  summarizeComplianceRows,
  validityInfo,
  type ValidityStatus,
} from "./employeeComplianceStatus";

function fmtDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

const REPORT_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0EA5E9" },
};
const REPORT_HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};
const STATUS_FILLS: Record<ValidityStatus, string> = {
  expired: "FFFECACA",
  expiring: "FFFEF3C7",
  missing: "FFE2E8F0",
  none: "FFF1F5F9",
  not_required: "FFE0F2FE",
  ok: "FFDCFCE7",
};

function styleReportHeader(row: ExcelJS.Row): void {
  row.eachCell((cell: any) => {
    cell.fill = REPORT_HEADER_FILL;
    cell.font = REPORT_HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 22;
}

function applyStatusFill(cell: any, status: ValidityStatus): void {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: STATUS_FILLS[status] },
  };
}

function stampFile(): string {
  return new Date().toISOString().slice(0, 10);
}

function addReportDataSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: EmployeeDirectoryRowOut[],
): void {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [
    "ФИО",
    "Email",
    "Уволен",
    "Дата увольнения",
    "Должность",
    "Системы",
    "Экзамен ЭБ",
    "Группа ЭБ",
    "№ удостоверения",
    "Экзамен до",
    "Статус экзамена",
    "Пропуск",
    "№ пропуска",
    "Пропуск до",
    "Статус пропуска",
    "Примечание",
  ];
  styleReportHeader(ws.addRow(headers));

  for (const r of rows) {
    const exam = examElectricalValidityInfo(r);
    const pass = validityInfo(r.pass_valid_to, r.pass_has);
    const remote = !!r.is_remote;
    const row = ws.addRow([
      r.full_name,
      r.email,
      r.is_dismissed ? "Да" : "Нет",
      fmtDate(r.dismissed_at),
      r.position?.name ?? "",
      r.systems.map((s) => s.name).join(", "),
      examElectricalPassedLabel(r),
      remote ? "" : (r.exam_electrical_group ?? ""),
      remote ? "" : (r.exam_electrical_certificate_number ?? ""),
      remote ? "" : fmtDate(r.exam_electrical_valid_to),
      exam.label,
      r.pass_has ? "Есть" : "Нет",
      r.pass_number ?? "",
      fmtDate(r.pass_valid_to),
      pass.label,
      r.notes ?? "",
    ]);
    applyStatusFill(row.getCell(11), exam.status);
    applyStatusFill(row.getCell(15), pass.status);
  }

  [28, 30, 10, 14, 22, 36, 12, 10, 16, 14, 16, 10, 14, 14, 16, 32].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

const COMPLIANCE_HEADERS = [
  "ФИО",
  "Email",
  "Активен",
  "Уволен",
  "Дата увольнения",
  "Должность",
  "Системы",
  "Экзамен ЭБ",
  "Группа ЭБ",
  "№ удостоверения",
  "Дата экзамена",
  "Экзамен действителен до",
  "Пропуск",
  "№ пропуска",
  "Пропуск с",
  "Пропуск до",
  "Примечание",
] as const;

function genderLabel(g: string | undefined): string {
  if (g === "female") return "Женский";
  if (g === "male") return "Мужской";
  return "Не указан";
}

const PROFILE_HEADERS = [
  "ФИО",
  "Email",
  "Табельный номер",
  "Активен",
  "Уволен",
  "Дата увольнения",
  "Дата рождения",
  "Должность",
  "Дата должности",
  "Системы",
  "График работы",
  "Пол",
  "Удалёнщик",
  "Адрес работы",
  "Выездной",
  "Отпуск / больничный (периоды)",
] as const;

export async function downloadEmployeeDirectoryComplianceExcel(rows: EmployeeDirectoryRowOut[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet("Экзамены и пропуска", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.addRow([...COMPLIANCE_HEADERS]);
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };

  for (const r of rows) {
    if (r.is_remote) continue;
    ws.addRow([
      r.full_name,
      r.email,
      r.is_active ? "Да" : "Нет",
      r.is_dismissed ? "Да" : "Нет",
      fmtDate(r.dismissed_at),
      r.position?.name ?? "",
      r.systems.map((s) => s.name).join(", "),
      examElectricalPassedLabel(r),
      r.exam_electrical_group ?? "",
      r.exam_electrical_certificate_number ?? "",
      fmtDate(r.exam_electrical_date),
      fmtDate(r.exam_electrical_valid_to),
      r.pass_has ? "Есть" : "Нет",
      r.pass_number ?? "",
      fmtDate(r.pass_valid_from),
      fmtDate(r.pass_valid_to),
      r.notes ?? "",
    ]);
  }

  const colWidths = [28, 32, 10, 10, 14, 24, 40, 12, 10, 16, 14, 22, 10, 16, 14, 14, 36];
  colWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `kontrol_eb_propuski_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadEmployeeDirectoryProfileExcel(rows: EmployeeDirectoryRowOut[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet("Справочник сотрудника", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.addRow([...PROFILE_HEADERS]);
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };

  for (const r of rows) {
    ws.addRow([
      r.full_name,
      r.email,
      r.personnel_number ?? "",
      r.is_active ? "Да" : "Нет",
      r.is_dismissed ? "Да" : "Нет",
      fmtDate(r.dismissed_at),
      fmtDate(r.birth_date),
      r.position?.name ?? "",
      fmtDate(r.position_assigned_at),
      r.systems.map((s) => s.name).join(", "),
      (r.work_schedule_kind ?? "five_two") === "shift" ? "Сменщик" : "5/2",
      genderLabel(r.gender),
      r.is_remote ? "Да" : "Нет",
      r.work_address ?? "",
      r.is_field_worker ? "Да" : "Нет",
      (r.vacation_periods ?? [])
        .map((p) => {
          const kind =
            p.kind === "study" ? " учебный" : p.kind === "sick" ? " больничный" : "";
          return `${fmtDate(p.start)}–${fmtDate(p.end)}${kind}`;
        })
        .join("; "),
    ]);
  }

  const colWidths = [28, 32, 16, 10, 10, 14, 14, 24, 14, 40, 14, 18, 12, 34, 12, 36];
  colWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `kadrovy_spravochnik_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadEmployeeDirectoryReportExcel(rows: EmployeeDirectoryRowOut[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.creator = "MESS Workspace";

  const summary = summarizeComplianceRows(rows);
  const summaryWs = wb.addWorksheet("Сводка", { views: [{ state: "frozen", ySplit: 3 }] });
  summaryWs.mergeCells("A1:B1");
  const title = summaryWs.getCell("A1");
  title.value = "Отчётность: экзамены и пропуска";
  title.font = { bold: true, size: 16, color: { argb: "FF0F172A" } };
  summaryWs.getCell("A2").value = `Сформировано: ${new Date().toLocaleString("ru-RU")}`;
  summaryWs.getCell("A2").font = { size: 10, color: { argb: "FF64748B" } };

  styleReportHeader(summaryWs.addRow(["Показатель", "Значение"]));
  const kpiRows: Array<[string, number]> = [
    ["Всего сотрудников в выборке", summary.total],
    ["Экзамен ЭБ — просрочен", summary.examExpired],
    ["Экзамен ЭБ — истекает ≤ 3 дн.", summary.examExpiring3],
    ["Экзамен ЭБ — нет / нет даты", summary.examNone],
    ["Экзамен ЭБ — не требуется (удалёнщик)", summary.examNotRequired],
    ["Пропуск — просрочен", summary.passExpired],
    ["Пропуск — истекает ≤ 3 дн.", summary.passExpiring3],
    ["Пропуск — нет / нет даты", summary.passNone],
  ];
  for (const [label, value] of kpiRows) {
    const row = summaryWs.addRow([label, value]);
    row.getCell(2).alignment = { horizontal: "right" };
  }
  summaryWs.getColumn(1).width = 42;
  summaryWs.getColumn(2).width = 14;

  addReportDataSheet(wb, "Все сотрудники", rows);

  const expired = rows.filter((r) => {
    const exam = examElectricalValidityInfo(r);
    const pass = validityInfo(r.pass_valid_to, r.pass_has);
    return exam.status === "expired" || pass.status === "expired";
  });
  addReportDataSheet(wb, "Просрочено", expired);

  const expiring = rows.filter((r) => {
    const exam = examElectricalValidityInfo(r);
    const pass = validityInfo(r.pass_valid_to, r.pass_has);
    return exam.status === "expiring" || pass.status === "expiring";
  });
  addReportDataSheet(wb, "Истекает ≤3 дн.", expiring);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `otchet_eb_propuski_${stampFile()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadEmployeeDirectoryVacationsExcel(rows: EmployeeDirectoryRowOut[]): Promise<void> {
  const { flattenVacationItems, vacationKindLabel, vacationStatusLabel } = await import("./employeeVacations");
  const items = flattenVacationItems(rows);
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet("Отпуска", { views: [{ state: "frozen", ySplit: 1 }] });
  styleReportHeader(
    ws.addRow(["Сотрудник", "Email", "Должность", "Системы", "Вид", "Начало", "Окончание", "Дней", "Статус"]),
  );
  for (const item of items) {
    ws.addRow([
      item.fullName,
      item.email,
      item.position ?? "",
      item.systemsLabel,
      vacationKindLabel(item.kind),
      item.start,
      item.end,
      item.days,
      vacationStatusLabel(item),
    ]);
  }
  [28, 32, 24, 36, 18, 14, 14, 10, 28].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `otpuska_${stampFile()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
