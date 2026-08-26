import type { EmployeeDirectoryRowOut, VacationPeriod } from "../api/employeeDirectory";

export type VacationKind = "vacation" | "study" | "sick";
export type VacationStatus = "current" | "upcoming" | "past";

export type VacationListItem = {
  key: string;
  userId: string;
  fullName: string;
  email: string;
  position: string | null;
  systemsLabel: string;
  kind: VacationKind;
  start: string;
  end: string;
  days: number;
  status: VacationStatus;
  remainingDays: number;
  daysUntilStart: number;
};

export function parseIsoDate(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").slice(0, 10));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function todayLocal(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function calendarDays(start: string, end: string): number {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (!a || !b || b < a) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

export function vacationKindOf(period: VacationPeriod): VacationKind {
  if (period.kind === "study" || period.kind === "sick") return period.kind;
  return "vacation";
}

export function vacationKindLabel(kind: VacationKind): string {
  if (kind === "study") return "Учебный отпуск";
  if (kind === "sick") return "Больничный";
  return "Отпуск";
}

export function vacationStatusOf(start: string, end: string, today = todayLocal()): VacationStatus {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (!a || !b) return "past";
  if (b < today) return "past";
  if (a > today) return "upcoming";
  return "current";
}

export function vacationStatusLabel(item: VacationListItem): string {
  if (item.status === "current") {
    return item.remainingDays <= 1 ? "сегодня последний день" : `идёт, ещё ${item.remainingDays} дн.`;
  }
  if (item.status === "upcoming") {
    if (item.daysUntilStart <= 0) return "с сегодня";
    if (item.daysUntilStart === 1) return "завтра";
    return `через ${item.daysUntilStart} дн.`;
  }
  return "завершён";
}

export function formatVacationRange(start: string, end: string): string {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (!a || !b) return `${start} — ${end}`;
  const sameYear = a.getFullYear() === b.getFullYear();
  const startFmt = a.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endFmt = b.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  return `${startFmt} — ${endFmt}`;
}

export function pluralDays(n: number): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return `${n} дней`;
  if (d === 1) return `${n} день`;
  if (d >= 2 && d <= 4) return `${n} дня`;
  return `${n} дней`;
}

function dayDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function flattenVacationItems(
  rows: EmployeeDirectoryRowOut[],
  today = todayLocal(),
): VacationListItem[] {
  const items: VacationListItem[] = [];
  for (const row of rows) {
    (row.vacation_periods ?? []).forEach((period, idx) => {
      const start = (period.start ?? "").slice(0, 10);
      const end = (period.end ?? "").slice(0, 10);
      const a = parseIsoDate(start);
      const b = parseIsoDate(end);
      if (!a || !b || b < a) return;
      const status = vacationStatusOf(start, end, today);
      items.push({
        key: `${row.id}-${idx}-${start}`,
        userId: row.id,
        fullName: row.full_name,
        email: row.email,
        position: row.position?.name ?? null,
        systemsLabel: row.systems.map((s) => s.name).join(", "),
        kind: vacationKindOf(period),
        start,
        end,
        days: calendarDays(start, end),
        status,
        remainingDays: status === "current" ? dayDiff(today, b) + 1 : 0,
        daysUntilStart: status === "upcoming" ? dayDiff(today, a) : 0,
      });
    });
  }
  items.sort((x, y) => x.start.localeCompare(y.start) || x.fullName.localeCompare(y.fullName, "ru"));
  return items;
}

export function periodOverlapsYear(item: VacationListItem, year: number): boolean {
  const a = parseIsoDate(item.start);
  const b = parseIsoDate(item.end);
  if (!a || !b) return false;
  return a.getFullYear() <= year && b.getFullYear() >= year;
}

export type VacationMonthGroup = {
  key: string;
  label: string;
  items: VacationListItem[];
};

const MONTH_NAMES = [
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
];

export function groupVacationsByStartMonth(items: VacationListItem[]): VacationMonthGroup[] {
  const map = new Map<string, VacationListItem[]>();
  for (const item of items) {
    const d = parseIsoDate(item.start);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, grouped]) => {
      const [ys, ms] = key.split("-");
      const month = Number(ms) - 1;
      return {
        key,
        label: `${MONTH_NAMES[month] ?? ms} ${ys}`,
        items: grouped.sort((a, b) => a.start.localeCompare(b.start) || a.fullName.localeCompare(b.fullName, "ru")),
      };
    });
}
