import ExcelJS from "exceljs";

import type { EmployeeDirectoryRowOut } from "../api/employeeDirectory";

function fmtDate(v: string | null): string {
  return v ? v.slice(0, 10) : "";
}

const HEADERS = [
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

export async function downloadEmployeeDirectoryExcel(rows: EmployeeDirectoryRowOut[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet("Сотрудники", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.addRow([...HEADERS]);
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
  a.download = `spravochnik-sotrudnikov_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
