import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  getScheduleMonth,
  patchScheduleCell,
  patchScheduleUserMode,
  postScheduleAutofill,
  type ScheduleDayInfo,
} from "../api/schedule";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { PERM, hasPermission } from "../lib/permissions";
import { toastApiError, toastSuccess } from "../lib/toast";

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

const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const SCHEDULE_MODES: { value: string; label: string }[] = [
  { value: "manual", label: "Вручную" },
  { value: "five_two", label: "Пятидневка (8, выходные и праздники РФ)" },
  { value: "shift_11_3_8", label: "Смены 11 → 3 → 8" },
  { value: "shift_11d_11v", label: "Смены 11д / 11в" },
  { value: "everyday_72", label: "Подряд 7.2" },
];

function weekdayLabel(year: number, month: number, day: number): string {
  return WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()] ?? "";
}

function rowBgClass(kind: string): string {
  if (kind === "shift") return "bg-amber-50/95 dark:bg-amber-950/35";
  if (kind === "fixed") return "bg-sky-50/90 dark:bg-sky-950/30";
  if (kind === "five_two") return "bg-white dark:bg-slate-900/40";
  return "bg-slate-50/80 dark:bg-slate-900/50";
}

function dayHeaderClass(d: ScheduleDayInfo | undefined): string {
  if (!d) return "";
  if (d.is_ru_holiday) return "bg-amber-100/95 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
  if (d.is_weekend) return "bg-slate-100/90 text-slate-600 dark:bg-slate-800/80 dark:text-slate-300";
  return "";
}

export function SchedulePage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canRead = !!(user && hasPermission(user, PERM.SCHEDULE_READ));
  const canManage = !!(user && hasPermission(user, PERM.SCHEDULE_MANAGE));

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [onlyEmptyAutofill, setOnlyEmptyAutofill] = useState(true);

  const qc = useQueryClient();

  const scheduleQuery = useQuery({
    queryKey: ["schedule", "month", year, month],
    queryFn: () => getScheduleMonth(year, month),
    enabled: canRead,
  });

  const dayByNum = useMemo(() => {
    const days = scheduleQuery.data?.days ?? [];
    const m = new Map<number, ScheduleDayInfo>();
    for (const x of days) m.set(x.day, x);
    return m;
  }, [scheduleQuery.data?.days]);

  const patchMut = useMutation({
    mutationFn: patchScheduleCell,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["schedule", "month", year, month] });
    },
    onError: (e) => toastApiError(e, "Не удалось сохранить ячейку"),
  });

  const modeMut = useMutation({
    mutationFn: ({ userId, mode }: { userId: string; mode: string }) =>
      patchScheduleUserMode(userId, mode),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["schedule", "month", year, month] });
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (e) => toastApiError(e, "Не удалось сохранить режим"),
  });

  const autofillMut = useMutation({
    mutationFn: () => postScheduleAutofill({ year, month, only_empty: onlyEmptyAutofill }),
    onSuccess: async (data) => {
      toastSuccess(`Заполнено ячеек: ${data.cells_written}`);
      await qc.invalidateQueries({ queryKey: ["schedule", "month", year, month] });
    },
    onError: (e) => toastApiError(e, "Автозаполнение не выполнено"),
  });

  const daysInMonth = scheduleQuery.data?.days_in_month ?? new Date(year, month, 0).getDate();
  const dayNumbers = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  const saveCell = useCallback(
    (userId: string, day: number, raw: string) => {
      const trimmed = raw.trim();
      const code = trimmed === "" ? null : trimmed;
      patchMut.mutate({
        year,
        month,
        user_id: userId,
        day,
        code,
      });
    },
    [patchMut, year, month],
  );

  function shiftMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  if (!canRead) {
    return (
      <AppShell title="Расписание" subtitle="График смен">
        <p className="rounded-2xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          У вас нет права на просмотр расписания. Обратитесь к администратору (право «schedule.read»).
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Расписание"
      subtitle="Отметьте отпуск (о) и учёбу (у), выберите режим строки, затем автозаполнение для сменщиков и пятидневки. Праздники РФ подсвечены в шапке."
      wide
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-sky-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            title="Предыдущий месяц"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[12rem] text-center text-lg font-semibold text-slate-900 dark:text-white">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-sky-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            title="Следующий месяц"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManage && (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={onlyEmptyAutofill}
                  onChange={(e) => setOnlyEmptyAutofill(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Только пустые ячейки
              </label>
              <button
                type="button"
                disabled={autofillMut.isPending}
                onClick={() => autofillMut.mutate()}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-sky-700 disabled:opacity-60 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
              >
                {autofillMut.isPending ? "Заполнение…" : "Автозаполнение"}
              </button>
            </>
          )}
          {!canManage && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Только просмотр. Редактирование: «schedule.manage».</p>
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-2 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-soft dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 sm:grid-cols-2">
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">Коды</p>
          <p className="mt-1 text-xs">
            <span className="font-mono">о</span> отпуск / выходной по графику · <span className="font-mono">у</span> учёба ·{" "}
            <span className="font-mono">8</span>/<span className="font-mono">11</span>/<span className="font-mono">3</span> смены ·{" "}
            <span className="font-mono">7.2</span> подряд
          </p>
        </div>
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">Подсветка</p>
          <p className="mt-1 text-xs">
            Строка янтарная — сменщики (11/3/8 или 11д/11в). Голубая — подряд 7.2. В шапке: праздники РФ, серым — сб/вс.
          </p>
        </div>
      </div>

      {scheduleQuery.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
      {scheduleQuery.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">Не удалось загрузить расписание.</p>
      )}

      {scheduleQuery.data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/90 shadow-soft dark:border-slate-700 dark:bg-slate-900/50">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-800/50">
                <th className="sticky left-0 z-20 min-w-[14rem] border-r border-slate-200 bg-slate-50/95 px-2 py-2 text-left text-xs font-semibold uppercase text-slate-500 dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-400">
                  Сотрудник / система
                </th>
                {dayNumbers.map((d) => {
                  const di = dayByNum.get(d);
                  return (
                    <th
                      key={d}
                      className={`min-w-[2.75rem] px-0.5 py-1 text-center text-[10px] font-medium ${dayHeaderClass(di)}`}
                    >
                      {weekdayLabel(year, month, d)}
                    </th>
                  );
                })}
              </tr>
              <tr className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/80">
                <th className="sticky left-0 z-20 border-r border-slate-200 bg-white px-2 py-1 text-left text-xs text-slate-400 dark:border-slate-600 dark:bg-slate-900">
                  Режим
                </th>
                {dayNumbers.map((d) => {
                  const di = dayByNum.get(d);
                  return (
                    <th
                      key={d}
                      className={`min-w-[2.75rem] px-0.5 py-1 text-center text-xs font-semibold ${dayHeaderClass(di)} text-slate-700 dark:text-slate-200`}
                    >
                      {d}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {scheduleQuery.data.users.map((row) => (
                <tr key={row.user_id} className={`border-b border-slate-100 dark:border-slate-800 ${rowBgClass(row.row_kind)}`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 bg-inherit px-2 py-1.5 dark:border-slate-600">
                    <div className="font-medium leading-tight text-slate-900 dark:text-slate-100">{row.full_name}</div>
                    <div className="mt-0.5 text-[11px] text-sky-700 dark:text-sky-300">{row.systems_label}</div>
                    <div className="truncate text-[10px] text-slate-400">{row.email}</div>
                    {canManage && (
                      <select
                        value={row.schedule_mode}
                        disabled={modeMut.isPending}
                        onChange={(e) =>
                          modeMut.mutate({ userId: row.user_id, mode: e.target.value })
                        }
                        className="mt-1 w-full max-w-[13rem] rounded-lg border border-slate-200 bg-white/90 px-1.5 py-1 text-[11px] text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {SCHEDULE_MODES.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {!canManage && (
                      <p className="mt-1 text-[10px] text-slate-500">
                        {SCHEDULE_MODES.find((x) => x.value === row.schedule_mode)?.label ?? row.schedule_mode}
                      </p>
                    )}
                  </td>
                  {dayNumbers.map((d) => {
                    const key = String(d);
                    const val = row.cells[key] ?? "";
                    const di = dayByNum.get(d);
                    const headTint = di?.is_ru_holiday
                      ? "bg-amber-100/40 dark:bg-amber-900/20"
                      : di?.is_weekend
                        ? "bg-slate-100/50 dark:bg-slate-800/40"
                        : "";
                    return (
                      <td key={key} className={`p-0 ${headTint}`}>
                        {canManage ? (
                          <ScheduleCellInput
                            initialValue={val}
                            cellKey={`${row.user_id}-${year}-${month}-${d}-${val}`}
                            onCommit={(next) => saveCell(row.user_id, d, next)}
                            disabled={patchMut.isPending}
                          />
                        ) : (
                          <div className="flex h-9 min-w-[2.5rem] items-center justify-center text-center font-mono text-xs text-slate-800 dark:text-slate-100">
                            {val || "—"}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function ScheduleCellInput({
  initialValue,
  cellKey,
  onCommit,
  disabled,
}: {
  initialValue: string;
  cellKey: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      key={cellKey}
      defaultValue={initialValue}
      disabled={disabled}
      maxLength={8}
      className="h-9 w-full min-w-[2.5rem] border-0 bg-transparent text-center font-mono text-xs text-slate-900 outline-none ring-inset focus:ring-2 focus:ring-sky-400/60 dark:text-slate-100"
      onBlur={(e) => {
        const v = e.target.value;
        if (v.trim() !== (initialValue || "").trim()) {
          onCommit(v);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
