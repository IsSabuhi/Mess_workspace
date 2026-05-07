import type { ScheduleUserRow } from "../api/schedule";

/** Нормализация для сравнения «одной смены» в ячейке (как на бэкенде: о/у не считаются сменами). */
export function normalizeScheduleCellForMatch(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "о" || lower === "у") return null;
  return lower;
}

/**
 * Для каждого дня: коды смены, которые стоят у ≥2 сменщиков/2-2 (по таблице), получают индекс цвета 0..3.
 * Ключ: `${day}:${normalizedCode}`.
 */
export function buildSameShiftMatchPhaseMap(
  rows: ScheduleUserRow[],
  dayNumbers: number[],
): Map<string, number> {
  const out = new Map<string, number>();
  const shiftLike = rows.filter((r) => r.work_schedule_kind === "shift" || r.work_schedule_kind === "two_two");

  for (const d of dayNumbers) {
    const byCode = new Map<string, ScheduleUserRow[]>();
    for (const row of shiftLike) {
      const n = normalizeScheduleCellForMatch(row.cells[String(d)] ?? "");
      if (!n) continue;
      if (!byCode.has(n)) byCode.set(n, []);
      byCode.get(n)!.push(row);
    }
    const multi = [...byCode.entries()]
      .filter(([, list]) => list.length >= 2)
      .sort(([a], [b]) => a.localeCompare(b, "ru"));
    multi.forEach(([code], idx) => {
      out.set(`${d}:${code}`, idx % 4);
    });
  }
  return out;
}
