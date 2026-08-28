import ExcelJS from "exceljs";

import { SIM_ISSUE_LABEL, type GsmGapRow, type SimReportRow } from "./uspdSimReport";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0284C7" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const WARN_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFEF3C7" },
};

function stampFile(): string {
  return new Date().toISOString().slice(0, 10);
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell: any) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 22;
}

function yesNo(v: boolean): string {
  return v ? "задан" : "";
}

export async function downloadUspdSimExcel(params: {
  rows: SimReportRow[];
  gaps: GsmGapRow[];
}): Promise<void> {
  const { rows, gaps } = params;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const ws = wb.addWorksheet("SIM-карты", { views: [{ state: "frozen", ySplit: 1 }] });
  styleHeader(
    ws.addRow([
      "Объект УСПД",
      "Раздел",
      "Устройство",
      "IP устройства",
      "SIM",
      "Номер",
      "IP SIM",
      "ICCID",
      "PIN",
      "PUK",
      "Комментарий",
      "Проблемы",
    ]),
  );
  for (const r of rows) {
    const excelRow = ws.addRow([
      r.siteName,
      r.section,
      r.parentObject,
      r.parentIp,
      r.simLabel,
      r.simNumber,
      r.simIp,
      r.simIccid,
      yesNo(r.hasPin),
      yesNo(r.hasPuk),
      r.comment,
      r.issues.map((i) => SIM_ISSUE_LABEL[i]).join(", "),
    ]);
    if (r.issues.length) {
      excelRow.eachCell((cell: any) => {
        cell.fill = WARN_FILL;
      });
    }
  }
  ws.columns = [
    { width: 28 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 12 },
    { width: 18 },
    { width: 16 },
    { width: 22 },
    { width: 10 },
    { width: 10 },
    { width: 28 },
    { width: 28 },
  ];
  ws.autoFilter = { from: "A1", to: "L1" };

  const gapWs = wb.addWorksheet("GSM без SIM", { views: [{ state: "frozen", ySplit: 1 }] });
  styleHeader(gapWs.addRow(["Объект УСПД", "Раздел", "Устройство", "IP", "Комментарий"]));
  for (const g of gaps) {
    gapWs.addRow([g.siteName, g.section, g.object, g.ip, g.comment]);
  }
  gapWs.columns = [{ width: 28 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 32 }];
  gapWs.autoFilter = { from: "A1", to: "E1" };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `uspd_sim_${stampFile()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
