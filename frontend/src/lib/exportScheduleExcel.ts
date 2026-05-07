import ExcelJS from "exceljs";

import type { ScheduleDayInfo, ScheduleGroupOut, ScheduleUserRow } from "../api/schedule";

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

const MONTH_NAMES_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const;

function codeAt(row: { cells: Record<string, string | null> }, day: number): string {
  const v = row.cells[String(day)];
  return v ?? "";
}

function rowColorHex(row: ScheduleUserRow): string | null {
  const raw = row.manual_row_color ?? row.auto_row_color ?? null;
  if (!raw) return null;
  const s = raw.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  return s;
}

function toArgb(hex: string): string {
  return `FF${hex.slice(1).toUpperCase()}`;
}

export type ScheduleExcelSheetInput = {
  year: number;
  month: number;
  dayNumbers: number[];
  groups: ScheduleGroupOut[];
};

function buildSheet(wb: ExcelJS.Workbook, sheet: ScheduleExcelSheetInput): void {
  const { year, month, dayNumbers, groups } = sheet;
  const monthName = MONTH_NAMES_RU[Math.max(0, Math.min(11, month - 1))] ?? String(month);
  const ws = wb.addWorksheet(monthName, {
    views: [{ state: "frozen", ySplit: 2, xSplit: 1 }],
  });

  const colCount = 1 + dayNumbers.length + 2;
  const monthTitle = monthLabel(year, month);
  const titleRow = ws.addRow([monthTitle]);
  titleRow.font = { bold: true, size: 14 };
  titleRow.alignment = { horizontal: "center", vertical: "middle" };
  ws.mergeCells(1, 1, 1, colCount);

  const header = ["Сотрудник", ...dayNumbers.map((d) => String(d)), "Часы", "Система"];
  ws.addRow(header);
  ws.getRow(2).font = { bold: true };
  ws.getRow(2).alignment = { vertical: "middle", horizontal: "center", wrapText: true };

  let excelRow = 3;
  for (const group of groups) {
    const groupStart = excelRow;
    for (const row of group.users) {
      ws.addRow([row.full_name, ...dayNumbers.map((d) => codeAt(row, d)), row.hours_total, group.label]);
      const color = rowColorHex(row);
      if (color) {
        const fill = { type: "pattern", pattern: "solid", fgColor: { argb: toArgb(color) } } as const;
        // Как на клиенте: красим строку сотрудника, но не колонку "Система".
        for (let c = 1; c <= colCount - 1; c += 1) {
          ws.getCell(excelRow, c).fill = fill;
        }
      }
      excelRow += 1;
    }
    const groupEnd = excelRow - 1;
    const systemCol = colCount;
    if (groupEnd > groupStart) {
      ws.mergeCells(groupStart, systemCol, groupEnd, systemCol);
    }
    ws.getCell(groupStart, systemCol).value = group.label;
    ws.getCell(groupStart, systemCol).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  ws.columns = [{ width: 30 }, ...dayNumbers.map(() => ({ width: 5.2 })), { width: 10 }, { width: 18 }];

  for (let r = 3; r < excelRow; r += 1) {
    ws.getCell(r, 1).alignment = { horizontal: "left", vertical: "middle" };
    for (let i = 0; i < dayNumbers.length; i += 1) {
      ws.getCell(r, 2 + i).alignment = { horizontal: "center", vertical: "middle" };
    }
    ws.getCell(r, 2 + dayNumbers.length).alignment = { horizontal: "center", vertical: "middle" };
  }
}

export async function downloadScheduleExcel(params: {
  sheets: ScheduleExcelSheetInput[];
  fileBaseName: string;
}): Promise<void> {
  const { sheets, fileBaseName } = params;
  if (sheets.length === 0) return;

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  for (const sheet of sheets) buildSheet(wb, sheet);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileBaseName}_${fileStamp()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

