import ExcelJS from "exceljs";

import type { EmployeeDirectoryRowOut } from "../api/employeeDirectory";

function fmtDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

const COMPLIANCE_HEADERS = [
  "ФИО",
  "Email",
  "Активен",
  "Должность",
  "Системы",
  "Экзамен ЭБ",
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
  "Активен",
  "Дата рождения",
  "Должность",
  "Системы",
  "График работы",
  "Пол",
  "Отпуск (периоды)",
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
    ws.addRow([
      r.full_name,
      r.email,
      r.is_active ? "Да" : "Нет",
      r.position?.name ?? "",
      r.systems.map((s) => s.name).join(", "),
      r.exam_electrical_passed ? "Сдан" : "Нет",
      fmtDate(r.exam_electrical_date),
      fmtDate(r.exam_electrical_valid_to),
      r.pass_has ? "Есть" : "Нет",
      r.pass_number ?? "",
      fmtDate(r.pass_valid_from),
      fmtDate(r.pass_valid_to),
      r.notes ?? "",
    ]);
  }

  const colWidths = [28, 32, 10, 24, 40, 12, 14, 22, 10, 16, 14, 14, 36];
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
  const ws = wb.addWorksheet("Кадровый справочник", {
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
      r.is_active ? "Да" : "Нет",
      fmtDate(r.birth_date),
      r.position?.name ?? "",
      r.systems.map((s) => s.name).join(", "),
      (r.work_schedule_kind ?? "five_two") === "shift" ? "Сменщик" : "5/2",
      genderLabel(r.gender),
      (r.vacation_periods ?? [])
        .map((p) => `${fmtDate(p.start)}–${fmtDate(p.end)}`)
        .join("; "),
    ]);
  }

  const colWidths = [28, 32, 10, 14, 24, 40, 14, 18, 36];
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
