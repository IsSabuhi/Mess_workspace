import type { ScheduleDayInfo, ScheduleGroupOut } from "../api/schedule";

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

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;

const COLORS = {
  bg: "#ffffff",
  title: "#0f172a",
  headerBg: "#f1f5f9",
  headerText: "#475569",
  border: "#cbd5e1",
  text: "#0f172a",
  muted: "#64748b",
  weekend: "#f1f5f9",
  holiday: "#fef3c7",
  coverage: "#ffe4e6",
  systemBg: "#f8fafc",
  hours: "#0f766e",
} as const;

function codeAt(row: { cells: Record<string, string | null> }, day: number): string {
  const v = row.cells[String(day)];
  return v ?? "";
}

function rowColorHex(row: { manual_row_color?: string | null; auto_row_color?: string | null }): string | null {
  const raw = row.manual_row_color ?? row.auto_row_color ?? null;
  if (!raw) return null;
  const s = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

function formatHours(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function weekdayLabel(year: number, month: number, day: number): string {
  return WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()] ?? "";
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = words[0]!;
  for (let i = 1; i < words.length; i += 1) {
    const next = `${cur} ${words[i]!}`;
    if (ctx.measureText(next).width <= maxWidth) {
      cur = next;
    } else {
      lines.push(cur);
      cur = words[i]!;
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines) lines.push(cur);
  if (lines.length > maxLines) {
    const last = lines[maxLines - 1] ?? "";
    lines.length = maxLines;
    lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, Math.max(1, last.length - 1))}…` : "…";
  } else if (lines.length === maxLines) {
    const rest = words.slice(lines.join(" ").split(/\s+/).length);
    if (rest.length > 0) {
      const last = lines[maxLines - 1]!;
      lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, Math.max(1, last.length - 1))}…` : "…";
    }
  }
  return lines;
}

function dayColumnFill(
  day: number,
  dayByNum: Map<number, ScheduleDayInfo>,
  coverageGapDays: Set<number>,
): string {
  if (coverageGapDays.has(day)) return COLORS.coverage;
  const di = dayByNum.get(day);
  if (di?.is_ru_holiday) return COLORS.holiday;
  if (di?.is_weekend) return COLORS.weekend;
  return COLORS.bg;
}

export type ScheduleImageInput = {
  year: number;
  month: number;
  dayNumbers: number[];
  groups: ScheduleGroupOut[];
  days?: ScheduleDayInfo[];
  coverageGapDays?: number[];
  /** Масштаб рендера (2–3 даёт «ретина»-качество). По умолчанию 3. */
  scale?: number;
};

/**
 * Рисует график месяца на canvas и скачивает PNG.
 * PNG предпочтительнее JPG: без потерь, чёткий текст и линии таблицы.
 */
export async function downloadSchedulePng(input: ScheduleImageInput): Promise<void> {
  const {
    year,
    month,
    dayNumbers,
    groups,
    days = [],
    coverageGapDays = [],
    scale: requestedScale = 3,
  } = input;

  const dayByNum = new Map(days.map((d) => [d.day, d]));
  const gapSet = new Set(coverageGapDays);

  const nameW = 220;
  const dayW = 36;
  const hoursW = 56;
  const systemW = 130;
  const pad = 24;
  const titleH = 48;
  const headerH = 52;
  const rowH = 28;

  const userRows = groups.flatMap((g) => g.users);
  const colCount = dayNumbers.length;
  const tableW = nameW + colCount * dayW + hoursW + systemW;
  const tableH = headerH + userRows.length * rowH;
  const logicalW = tableW + pad * 2;
  const logicalH = titleH + tableH + pad * 2;

  const maxSide = 8192;
  let scale = Math.min(3, Math.max(2, requestedScale));
  while (scale > 1 && (logicalW * scale > maxSide || logicalH * scale > maxSide)) {
    scale -= 0.5;
  }
  scale = Math.max(1, scale);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(logicalW * scale);
  canvas.height = Math.ceil(logicalH * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D недоступен");

  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.textBaseline = "middle";

  // Фон
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, logicalW, logicalH);

  // Заголовок
  const monthName = MONTH_NAMES_RU[Math.max(0, Math.min(11, month - 1))] ?? String(month);
  ctx.fillStyle = COLORS.title;
  ctx.font = '700 22px "Segoe UI", system-ui, -apple-system, sans-serif';
  ctx.textAlign = "left";
  ctx.fillText(`График · ${monthName} ${year}`, pad, pad + titleH / 2 - 2);

  ctx.fillStyle = COLORS.muted;
  ctx.font = '400 12px "Segoe UI", system-ui, -apple-system, sans-serif';
  ctx.fillText("о — отпуск · у — учебный · б — больничный", pad, pad + titleH / 2 + 16);

  const ox = pad;
  const oy = pad + titleH;

  // Шапка
  ctx.fillStyle = COLORS.headerBg;
  ctx.fillRect(ox, oy, tableW, headerH);

  // Колонка ФИО
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, nameW - 1, headerH - 1);
  ctx.fillStyle = COLORS.headerText;
  ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("ФИО", ox + 10, oy + headerH / 2);

  // Дни: верх — weekday, низ — число
  for (let i = 0; i < dayNumbers.length; i += 1) {
    const d = dayNumbers[i]!;
    const x = ox + nameW + i * dayW;
    const fill = dayColumnFill(d, dayByNum, gapSet);
    if (fill !== COLORS.bg) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, oy, dayW, headerH);
    }
    ctx.strokeStyle = COLORS.border;
    ctx.strokeRect(x + 0.5, oy + 0.5, dayW - 1, headerH - 1);
    ctx.fillStyle = COLORS.headerText;
    ctx.font = '500 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(weekdayLabel(year, month, d), x + dayW / 2, oy + 14);
    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = COLORS.title;
    ctx.fillText(String(d), x + dayW / 2, oy + 36);
  }

  // Часы
  const hoursX = ox + nameW + colCount * dayW;
  ctx.fillStyle = COLORS.headerBg;
  ctx.fillRect(hoursX, oy, hoursW, headerH);
  ctx.strokeStyle = COLORS.border;
  ctx.strokeRect(hoursX + 0.5, oy + 0.5, hoursW - 1, headerH - 1);
  ctx.fillStyle = COLORS.headerText;
  ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("Часы", hoursX + hoursW / 2, oy + headerH / 2);

  // Система
  const systemX = hoursX + hoursW;
  ctx.fillStyle = COLORS.headerBg;
  ctx.fillRect(systemX, oy, systemW, headerH);
  ctx.strokeStyle = COLORS.border;
  ctx.strokeRect(systemX + 0.5, oy + 0.5, systemW - 1, headerH - 1);
  ctx.fillStyle = COLORS.headerText;
  ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
  ctx.fillText("Система", systemX + systemW / 2, oy + headerH / 2);

  // Строки + объединённая колонка «Система»
  let rowIndex = 0;
  for (const group of groups) {
    const groupStart = rowIndex;
    const groupLen = group.users.length;
    for (let ui = 0; ui < group.users.length; ui += 1) {
      const row = group.users[ui]!;
      const y = oy + headerH + rowIndex * rowH;
      const color = rowColorHex(row);
      const baseFill = color ?? COLORS.bg;

      // ФИО
      ctx.fillStyle = baseFill;
      ctx.fillRect(ox, y, nameW, rowH);
      ctx.strokeStyle = COLORS.border;
      ctx.strokeRect(ox + 0.5, y + 0.5, nameW - 1, rowH - 1);
      ctx.fillStyle = COLORS.text;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "left";
      const name = row.full_name || "—";
      let drawName = name;
      while (ctx.measureText(drawName).width > nameW - 16 && drawName.length > 1) {
        drawName = `${drawName.slice(0, -2)}…`;
      }
      ctx.fillText(drawName, ox + 8, y + rowH / 2);

      // Дни
      for (let i = 0; i < dayNumbers.length; i += 1) {
        const d = dayNumbers[i]!;
        const x = ox + nameW + i * dayW;
        const colTint = dayColumnFill(d, dayByNum, gapSet);
        ctx.fillStyle = color ? baseFill : colTint;
        ctx.fillRect(x, y, dayW, rowH);
        ctx.strokeStyle = COLORS.border;
        ctx.strokeRect(x + 0.5, y + 0.5, dayW - 1, rowH - 1);
        const code = codeAt(row, d);
        ctx.fillStyle = COLORS.text;
        ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.textAlign = "center";
        ctx.fillText(code || "", x + dayW / 2, y + rowH / 2);
      }

      // Часы
      ctx.fillStyle = baseFill;
      ctx.fillRect(hoursX, y, hoursW, rowH);
      ctx.strokeStyle = COLORS.border;
      ctx.strokeRect(hoursX + 0.5, y + 0.5, hoursW - 1, rowH - 1);
      ctx.fillStyle = COLORS.hours;
      ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textAlign = "center";
      ctx.fillText(formatHours(row.hours_total), hoursX + hoursW / 2, y + rowH / 2);

      rowIndex += 1;
    }

    // Система — объединённая ячейка группы
    if (groupLen > 0) {
      const gy = oy + headerH + groupStart * rowH;
      const gh = groupLen * rowH;
      ctx.fillStyle = COLORS.systemBg;
      ctx.fillRect(systemX, gy, systemW, gh);
      ctx.strokeStyle = COLORS.border;
      ctx.strokeRect(systemX + 0.5, gy + 0.5, systemW - 1, gh - 1);
      ctx.fillStyle = COLORS.text;
      ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "center";
      const lines = wrapText(ctx, group.label || "—", systemW - 12, Math.max(1, Math.floor(gh / 14)));
      const blockH = lines.length * 14;
      let ty = gy + (gh - blockH) / 2 + 7;
      for (const line of lines) {
        ctx.fillText(line, systemX + systemW / 2, ty);
        ty += 14;
      }
    }
  }

  // Внешняя рамка таблицы
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox + 0.5, oy + 0.5, tableW - 1, tableH - 1);

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Не удалось сформировать PNG"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `grafik_${String(month).padStart(2, "0")}_${year}.png`;
        a.click();
        URL.revokeObjectURL(url);
        resolve();
      },
      "image/png",
    );
  });
}
