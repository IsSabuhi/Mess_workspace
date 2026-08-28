import { useMemo, useState } from "react";

import type { EmployeeDirectoryRowOut } from "../api/employeeDirectory";
import {
  compareCurrentVacationFirst,
  compareUpcomingVacationFirst,
  flattenVacationItems,
  formatVacationRange,
  groupVacationsByStartMonth,
  oneVacationPerPerson,
  periodOverlapsYear,
  pluralDays,
  todayLocal,
  vacationKindLabel,
  vacationStatusLabel,
  type VacationKind,
  type VacationListItem,
  type VacationStatus,
} from "../lib/employeeVacations";

type KindFilter = "all" | VacationKind;
type StatusFilter = "all" | VacationStatus;

function kindBadgeClass(kind: VacationKind): string {
  if (kind === "study") return "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200";
  if (kind === "sick") return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  return "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200";
}

function statusBadgeClass(status: VacationStatus): string {
  if (status === "current") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  if (status === "upcoming") return "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

function cardTone(status: VacationStatus): string {
  if (status === "current") {
    return "border-emerald-200/90 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/25";
  }
  if (status === "upcoming") {
    return "border-sky-200/80 bg-white/90 dark:border-slate-700 dark:bg-slate-900/60";
  }
  return "border-slate-200/80 bg-white/70 dark:border-slate-700 dark:bg-slate-900/40";
}

const selectClass =
  "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

export function EmployeeVacationsPanel({ rows }: { rows: EmployeeDirectoryRowOut[] }) {
  const today = useMemo(() => todayLocal(), []);
  const currentYear = today.getFullYear();
  const allItems = useMemo(() => flattenVacationItems(rows, today), [rows, today]);
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const item of allItems) {
      const y1 = Number(item.start.slice(0, 4));
      const y2 = Number(item.end.slice(0, 4));
      if (y1) set.add(y1);
      if (y2) set.add(y2);
    }
    if (!set.has(currentYear)) set.add(currentYear);
    return [...set].sort((a, b) => b - a);
  }, [allItems, currentYear]);

  const [year, setYear] = useState<number | "all">(currentYear);
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    return allItems.filter((item) => {
      if (year !== "all" && !periodOverlapsYear(item, year)) return false;
      if (kind !== "all" && item.kind !== kind) return false;
      if (status !== "all" && item.status !== status) return false;
      return true;
    });
  }, [allItems, year, kind, status]);

  const groups = useMemo(() => groupVacationsByStartMonth(filtered), [filtered]);
  const currentVacation = useMemo(
    () =>
      oneVacationPerPerson(
        allItems.filter((i) => i.status === "current" && i.kind !== "sick"),
        compareCurrentVacationFirst,
      ),
    [allItems],
  );
  const currentSick = useMemo(
    () =>
      oneVacationPerPerson(
        allItems.filter((i) => i.status === "current" && i.kind === "sick"),
        compareCurrentVacationFirst,
      ),
    [allItems],
  );
  const upcomingSoon = useMemo(
    () =>
      oneVacationPerPerson(
        allItems.filter((i) => i.status === "upcoming" && i.kind !== "sick" && i.daysUntilStart <= 30),
        compareUpcomingVacationFirst,
      ),
    [allItems],
  );
  const upcomingLater = useMemo(
    () =>
      oneVacationPerPerson(
        allItems.filter((i) => i.status === "upcoming" && i.kind !== "sick" && i.daysUntilStart > 30),
        compareUpcomingVacationFirst,
      ).slice(0, 8),
    [allItems],
  );
  const sickEmployeesThisYear = useMemo(() => {
    const ids = new Set(
      allItems
        .filter((i) => i.kind === "sick" && periodOverlapsYear(i, currentYear))
        .map((i) => i.userId),
    );
    return ids.size;
  }, [allItems, currentYear]);
  const withoutPeriods = rows.filter((r) => !(r.vacation_periods ?? []).length).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Сейчас в отпуске"
          value={String(currentVacation.length)}
          hint="ежегодный и учебный"
          tone="bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
        />
        <StatCard
          label="Ближайшие 30 дней"
          value={String(upcomingSoon.length)}
          hint="у кого отпуск ещё не начался"
          tone="bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
        />
        <StatCard
          label={`С больничным в ${currentYear}`}
          value={String(sickEmployeesThisYear)}
          hint="сотрудников"
          tone="bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        />
        <StatCard
          label="Без периодов"
          value={String(withoutPeriods)}
          hint="в текущем списке сотрудников"
          tone="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
        />
      </div>

      {currentVacation.length > 0 && (
        <section className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <h3 className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Сейчас в отпуске</h3>
          <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-200/80">
            Сначала те, кто раньше выходит на работу
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {currentVacation.map((item) => (
              <VacationCard key={item.key} item={item} />
            ))}
          </div>
        </section>
      )}

      {upcomingSoon.length > 0 && (
        <section className="rounded-2xl border border-sky-200/80 bg-sky-50/50 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
          <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-100">Скоро в отпуске</h3>
          <p className="mt-0.5 text-xs text-sky-800/80 dark:text-sky-200/80">
            Сначала те, кто раньше уходит · начало в ближайшие 30 дней
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {upcomingSoon.map((item) => (
              <VacationCard key={item.key} item={item} />
            ))}
          </div>
        </section>
      )}

      {upcomingSoon.length === 0 && upcomingLater.length > 0 && (
        <section className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/50">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Следующие отпуска</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            В ближайшие 30 дней никого нет — ближайшие даты дальше
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {upcomingLater.map((item) => (
              <VacationCard key={item.key} item={item} />
            ))}
          </div>
        </section>
      )}

      {currentSick.length > 0 && (
        <section className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
          <h3 className="text-sm font-semibold text-amber-950 dark:text-amber-100">Сейчас на больничном</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {currentSick.map((item) => (
              <VacationCard key={item.key} item={item} />
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Год
          </span>
          <select
            value={year === "all" ? "all" : String(year)}
            onChange={(e) => setYear(e.target.value === "all" ? "all" : Number(e.target.value))}
            className={selectClass}
          >
            <option value="all">Все годы</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Вид
          </span>
          <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} className={selectClass}>
            <option value="all">Все</option>
            <option value="vacation">Отпуск</option>
            <option value="study">Учебный</option>
            <option value="sick">Больничный</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Статус
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className={selectClass}
          >
            <option value="all">Все</option>
            <option value="current">Сейчас</option>
            <option value="upcoming">Предстоит</option>
            <option value="past">Прошедшие</option>
          </select>
        </label>
        <p className="pb-1.5 text-xs text-slate-500 dark:text-slate-400">
          Показано {filtered.length} {filtered.length === 1 ? "период" : "периодов"}
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
          Нет периодов по выбранным фильтрам. Даты задаются в карточке сотрудника или импортом графика отпусков в
          админке.
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{group.label}</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {group.items.length} {group.items.length === 1 ? "запись" : "записей"}
                </span>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {group.items.map((item) => (
                  <VacationCard key={item.key} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200/70 px-3 py-3 shadow-soft dark:border-slate-700 ${tone}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] opacity-70">{hint}</p>
    </div>
  );
}

function VacationCard({ item }: { item: VacationListItem }) {
  return (
    <article className={`rounded-2xl border px-3.5 py-3 shadow-soft ${cardTone(item.status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-white">{item.fullName}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {item.position || "Без должности"}
            {item.systemsLabel ? ` · ${item.systemsLabel}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${kindBadgeClass(item.kind)}`}>
          {vacationKindLabel(item.kind)}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {formatVacationRange(item.start, item.end)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{pluralDays(item.days)}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(item.status)}`}>
          {vacationStatusLabel(item)}
        </span>
      </div>
    </article>
  );
}
