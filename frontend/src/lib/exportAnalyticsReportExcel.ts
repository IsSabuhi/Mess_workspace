import type { EChartsOption } from "echarts";
import ExcelJS from "exceljs";

import type { TaskOut } from "../api/tasks";
import { echarts } from "./echartsCore";
import type {
  BoardAnalyticsScope,
  ClosedByAssigneeRow,
  ClosedPeriod,
  OverdueTaskRow,
  TaskGroupedStat,
  TaskKpiTotals,
} from "./taskAnalyticsFilters";
import { closedPeriodBounds } from "./taskAnalyticsFilters";

export type AnalyticsReportInput = {
  generatedAt?: Date;
  boardScope: BoardAnalyticsScope;
  boardLabel: string;
  kpis: TaskKpiTotals;
  bySystem: TaskGroupedStat[];
  byAssignee: TaskGroupedStat[];
  overdueRows: OverdueTaskRow[];
  weeklyFlow: Array<{ label: string; created: number; closed: number }>;
  closedPeriod: ClosedPeriod;
  closedByAssignee: ClosedByAssigneeRow[];
  tasks: TaskOut[];
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0EA5E9" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 16, color: { argb: "FF0F172A" } };
const SUB_FONT: Partial<ExcelJS.Font> = { size: 10, color: { argb: "FF64748B" } };
const KPI_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF0F9FF" },
};

function stamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });
  row.height = 22;
}

function setColWidths(ws: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

async function renderChartPng(option: EChartsOption, width: number, height: number): Promise<Uint8Array> {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.position = "fixed";
  el.style.left = "-10000px";
  el.style.top = "0";
  document.body.appendChild(el);
  const chart = echarts.init(el, undefined, { renderer: "canvas", width, height });
  try {
    chart.setOption({
      ...option,
      animation: false,
      backgroundColor: "#ffffff",
    });
    // Дать canvas отрисоваться
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dataUrl = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
    const base64 = dataUrl.split(",")[1] ?? "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } finally {
    chart.dispose();
    el.remove();
  }
}

function addImage(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  png: Uint8Array,
  col: number,
  row: number,
  widthPx: number,
  heightPx: number,
): void {
  const id = wb.addImage({ buffer: png, extension: "png" });
  // ExcelJS: ширина/высота в условных единицах ~ px * 0.75 для EMU-подобных значений;
  // используем tl/ext в пикселях через native.
  ws.addImage(id, {
    tl: { col, row },
    ext: { width: widthPx, height: heightPx },
  });
}

function boardScopeLabel(scope: BoardAnalyticsScope, boardLabel: string): string {
  if (scope === "main") return "Основная доска";
  if (scope === "all") return "Все доски";
  return boardLabel || "Другая доска";
}

function closedPeriodRu(p: ClosedPeriod): string {
  return p === "week" ? "Неделя" : p === "month" ? "Месяц" : "Год";
}

export async function downloadAnalyticsReportExcel(input: AnalyticsReportInput): Promise<void> {
  const now = input.generatedAt ?? new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Портал MES";
  wb.created = now;
  wb.title = "Отчёт аналитики задач";

  const scopeText = boardScopeLabel(input.boardScope, input.boardLabel);
  const closedMeta = closedPeriodBounds(input.closedPeriod, now);

  // —— Сводка ——
  const summary = wb.addWorksheet("Сводка", { views: [{ showGridLines: false }] });
  setColWidths(summary, [28, 18, 18, 18, 18, 18]);
  summary.mergeCells("A1:F1");
  summary.getCell("A1").value = "Отчёт аналитики задач — Портал MES";
  summary.getCell("A1").font = TITLE_FONT;
  summary.mergeCells("A2:F2");
  summary.getCell("A2").value =
    `Сформирован: ${now.toLocaleString("ru-RU")} · Срез: ${scopeText}`;
  summary.getCell("A2").font = SUB_FONT;

  const kpiLabels: Array<[string, number]> = [
    ["Всего задач", input.kpis.total],
    ["Активные", input.kpis.active],
    ["Просрочено", input.kpis.overdue],
    ["Срок до 3 дней", input.kpis.dueSoon],
    ["Без исполнителя", input.kpis.unassigned],
    ["Высокий/срочный", input.kpis.highPriority],
  ];
  summary.getRow(4).values = ["Показатель", "Значение"];
  styleHeaderRow(summary.getRow(4));
  kpiLabels.forEach(([label, value], i) => {
    const r = summary.getRow(5 + i);
    r.values = [label, value];
    r.getCell(1).fill = KPI_FILL;
    r.getCell(2).font = { bold: true, size: 12 };
  });

  summary.getCell("A12").value = "Поток создано / закрыто (8 недель)";
  summary.getCell("A12").font = { bold: true, size: 12 };

  const weeklyChart = await renderChartPng(
    {
      tooltip: { trigger: "axis" },
      legend: { data: ["Создано", "Закрыто"], bottom: 0 },
      grid: { left: 48, right: 24, top: 24, bottom: 48 },
      xAxis: {
        type: "category",
        data: input.weeklyFlow.map((x) => x.label),
        axisLabel: { rotate: 30, fontSize: 10 },
      },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        {
          name: "Создано",
          type: "line",
          smooth: true,
          data: input.weeklyFlow.map((x) => x.created),
          itemStyle: { color: "#0ea5e9" },
        },
        {
          name: "Закрыто",
          type: "line",
          smooth: true,
          data: input.weeklyFlow.map((x) => x.closed),
          itemStyle: { color: "#10b981" },
        },
      ],
    },
    900,
    360,
  );
  addImage(wb, summary, weeklyChart, 0, 12.3, 640, 260);

  // —— Системы ——
  const systems = wb.addWorksheet("По системам");
  setColWidths(systems, [36, 12, 12, 12]);
  systems.getCell("A1").value = "Задачи по системам";
  systems.getCell("A1").font = TITLE_FONT;
  systems.getRow(3).values = ["Система", "Всего", "Активные", "Просрочено"];
  styleHeaderRow(systems.getRow(3));
  input.bySystem.forEach((r, i) => {
    systems.getRow(4 + i).values = [r.name, r.total, r.active, r.overdue];
    if (r.overdue > 0) systems.getRow(4 + i).getCell(4).font = { color: { argb: "FFB91C1C" }, bold: true };
  });

  const topSystems = input.bySystem.slice(0, 12);
  if (topSystems.length) {
    const sysChart = await renderChartPng(
      {
        tooltip: { trigger: "axis" },
        legend: { data: ["Всего", "Просрочено"], bottom: 0 },
        grid: { left: 120, right: 24, top: 16, bottom: 40, containLabel: false },
        xAxis: { type: "value", minInterval: 1 },
        yAxis: {
          type: "category",
          data: topSystems.map((r) => r.name).reverse(),
          axisLabel: { width: 110, overflow: "truncate", fontSize: 10 },
        },
        series: [
          {
            name: "Всего",
            type: "bar",
            data: topSystems.map((r) => r.total).reverse(),
            itemStyle: { color: "#38bdf8" },
          },
          {
            name: "Просрочено",
            type: "bar",
            data: topSystems.map((r) => r.overdue).reverse(),
            itemStyle: { color: "#f43f5e" },
          },
        ],
      },
      880,
      Math.max(280, topSystems.length * 28 + 80),
    );
    const chartRow = 5 + input.bySystem.length + 1;
    systems.getCell(`A${chartRow}`).value = "Диаграмма (топ систем)";
    systems.getCell(`A${chartRow}`).font = { bold: true, size: 12 };
    addImage(wb, systems, sysChart, 0, chartRow + 0.3, 620, Math.max(220, topSystems.length * 22 + 60));
  }

  // —— Исполнители ——
  const assignees = wb.addWorksheet("Исполнители");
  setColWidths(assignees, [36, 12, 12, 12]);
  assignees.getCell("A1").value = "Нагрузка по исполнителям";
  assignees.getCell("A1").font = TITLE_FONT;
  assignees.getRow(3).values = ["Исполнитель", "Всего", "Активные", "Просрочено"];
  styleHeaderRow(assignees.getRow(3));
  input.byAssignee.forEach((r, i) => {
    assignees.getRow(4 + i).values = [r.name, r.total, r.active, r.overdue];
    if (r.overdue > 0) assignees.getRow(4 + i).getCell(4).font = { color: { argb: "FFB91C1C" }, bold: true };
  });

  const topAssignees = [...input.byAssignee].sort((a, b) => b.total - a.total).slice(0, 14);
  if (topAssignees.length) {
    const loadChart = await renderChartPng(
      {
        tooltip: { trigger: "axis" },
        legend: { data: ["В срок", "Просрочено"], bottom: 0 },
        grid: { left: 120, right: 24, top: 16, bottom: 40 },
        xAxis: { type: "value", minInterval: 1 },
        yAxis: {
          type: "category",
          data: topAssignees.map((r) => r.name).reverse(),
          axisLabel: { width: 110, overflow: "truncate", fontSize: 10 },
        },
        series: [
          {
            name: "В срок",
            type: "bar",
            stack: "t",
            data: topAssignees.map((r) => Math.max(0, r.total - r.overdue)).reverse(),
            itemStyle: { color: "#34d399" },
          },
          {
            name: "Просрочено",
            type: "bar",
            stack: "t",
            data: topAssignees.map((r) => r.overdue).reverse(),
            itemStyle: { color: "#f43f5e" },
          },
        ],
      },
      880,
      Math.max(280, topAssignees.length * 28 + 80),
    );
    const chartRow = 5 + input.byAssignee.length + 1;
    assignees.getCell(`A${chartRow}`).value = "Диаграмма нагрузки";
    assignees.getCell(`A${chartRow}`).font = { bold: true, size: 12 };
    addImage(wb, assignees, loadChart, 0, chartRow + 0.3, 620, Math.max(220, topAssignees.length * 22 + 60));
  }

  // —— Просрочки ——
  const overdue = wb.addWorksheet("Просрочки");
  setColWidths(overdue, [40, 22, 28, 14, 18, 16, 14]);
  overdue.getCell("A1").value = "Просроченные задачи";
  overdue.getCell("A1").font = TITLE_FONT;
  overdue.getCell("A2").value = `Всего: ${input.overdueRows.length}`;
  overdue.getCell("A2").font = SUB_FONT;
  overdue.getRow(4).values = [
    "Задача",
    "Система",
    "Исполнители",
    "Приоритет",
    "Срок",
    "Колонка",
    "Часов просрочки",
  ];
  styleHeaderRow(overdue.getRow(4));
  input.overdueRows.forEach((r, i) => {
    overdue.getRow(5 + i).values = [
      r.title,
      r.systemName,
      r.assigneesLabel,
      r.priority,
      r.dueAt ? new Date(r.dueAt).toLocaleString("ru-RU") : "",
      r.columnName,
      r.overdueHours,
    ];
  });

  // —— Закрытия ——
  const closed = wb.addWorksheet("Закрытия");
  setColWidths(closed, [36, 12, 12]);
  const closedTotal = input.closedByAssignee.reduce((s, r) => s + r.closed, 0);
  closed.getCell("A1").value = "Закрытые задачи по сотрудникам";
  closed.getCell("A1").font = TITLE_FONT;
  closed.getCell("A2").value =
    `Период: ${closedPeriodRu(input.closedPeriod)} (${closedMeta.label}) · Всего закрыто: ${closedTotal}`;
  closed.getCell("A2").font = SUB_FONT;
  closed.getRow(4).values = ["Сотрудник", "Закрыто", "% от всех"];
  styleHeaderRow(closed.getRow(4));
  input.closedByAssignee.forEach((r, i) => {
    const share = closedTotal > 0 ? Math.round((r.closed / closedTotal) * 100) : 0;
    closed.getRow(5 + i).values = [r.name, r.closed, share];
  });

  if (input.closedByAssignee.length) {
    const closedChart = await renderChartPng(
      {
        tooltip: { trigger: "axis" },
        grid: { left: 120, right: 24, top: 16, bottom: 24 },
        xAxis: { type: "value", minInterval: 1 },
        yAxis: {
          type: "category",
          data: input.closedByAssignee
            .slice(0, 14)
            .map((r) => r.name)
            .reverse(),
          axisLabel: { width: 110, overflow: "truncate", fontSize: 10 },
        },
        series: [
          {
            type: "bar",
            data: input.closedByAssignee
              .slice(0, 14)
              .map((r) => r.closed)
              .reverse(),
            itemStyle: { color: "#10b981" },
            label: { show: true, position: "right", fontSize: 10 },
          },
        ],
      },
      880,
      Math.max(260, Math.min(14, input.closedByAssignee.length) * 28 + 60),
    );
    const chartRow = 6 + input.closedByAssignee.length;
    closed.getCell(`A${chartRow}`).value = "Диаграмма закрытий";
    closed.getCell(`A${chartRow}`).font = { bold: true, size: 12 };
    addImage(wb, closed, closedChart, 0, chartRow + 0.3, 620, Math.max(200, Math.min(14, input.closedByAssignee.length) * 22 + 50));
  }

  // —— Задачи (детализация) ——
  const tasksSheet = wb.addWorksheet("Задачи");
  setColWidths(tasksSheet, [40, 22, 18, 12, 18, 28, 14]);
  tasksSheet.getCell("A1").value = "Детализация задач (текущие фильтры)";
  tasksSheet.getCell("A1").font = TITLE_FONT;
  tasksSheet.getCell("A2").value = `Строк: ${input.tasks.length}`;
  tasksSheet.getCell("A2").font = SUB_FONT;
  tasksSheet.getRow(4).values = [
    "Задача",
    "Система",
    "Колонка",
    "Приоритет",
    "Срок",
    "Исполнители",
    "Архив",
  ];
  styleHeaderRow(tasksSheet.getRow(4));
  // Ограничим детализацию, чтобы файл не раздувался
  const taskRows = input.tasks.slice(0, 5000);
  taskRows.forEach((t, i) => {
    tasksSheet.getRow(5 + i).values = [
      t.title,
      t.system?.name ?? "Без системы",
      t.column?.name ?? "—",
      t.priority,
      t.due_at ? new Date(t.due_at).toLocaleString("ru-RU") : "",
      (t.assignees ?? []).map((a) => a.full_name).join(", "),
      t.archived_at ? "да" : "",
    ];
  });
  if (input.tasks.length > taskRows.length) {
    tasksSheet.getCell(`A${6 + taskRows.length}`).value =
      `… показаны первые ${taskRows.length} из ${input.tasks.length}`;
    tasksSheet.getCell(`A${6 + taskRows.length}`).font = SUB_FONT;
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analitika_zadach_${stamp(now)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
