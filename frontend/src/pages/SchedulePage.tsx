import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

function scheduleRowTitle(row: {
  full_name: string;
  email: string;
  systems_label: string;
  work_schedule_kind: string;
  gender: string;
}): string {
  const graph =
    row.work_schedule_kind === "shift"
      ? "Сменщик"
      : `5/2 · ${row.gender === "female" ? "7.2 ч" : "8 ч"} (будни)`;
  return `${row.full_name}\n${row.email}\nСистемы: ${row.systems_label}\nГрафик: ${graph}`;
}

import { getScheduleMonth, patchScheduleCell, postScheduleAutofill, type ScheduleDayInfo, type ScheduleUserRow } from "../api/schedule";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { shiftWorkerRowClass } from "../lib/shiftWorkerRowStyle";
import { PERM, canViewSchedule, hasPermission } from "../lib/permissions";
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

function weekdayLabel(year: number, month: number, day: number): string {
  return WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()] ?? "";
}

function rowBgClass(kind: string): string {
  if (kind === "shift") {
    return "bg-amber-50/95 dark:bg-amber-950/40 dark:text-slate-100";
  }
  if (kind === "fixed") {
    return "bg-sky-50/90 dark:bg-sky-950/45 dark:text-slate-100";
  }
  if (kind === "five_two") {
    return "bg-white dark:bg-slate-900/70 dark:text-slate-100";
  }
  return "bg-slate-50/80 dark:bg-slate-900/90 dark:text-slate-100";
}

/** Подсветка строки: сменщики из справочника — палитра как в Excel; остальное — по виду ячеек. */
function scheduleTableRowClass(row: ScheduleUserRow): string {
  if (row.work_schedule_kind === "shift") {
    return shiftWorkerRowClass(row.user_id);
  }
  return rowBgClass(row.row_kind);
}

function formatHoursTotal(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1).replace(/\.0$/, "");
}

function dayHeaderClass(d: ScheduleDayInfo | undefined): string {
  if (!d) return "";
  if (d.is_ru_holiday) {
    return "bg-amber-100/95 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-800/50";
  }
  if (d.is_weekend) {
    return "bg-slate-100/90 text-slate-600 dark:bg-slate-700/90 dark:text-slate-200 dark:ring-1 dark:ring-inset dark:ring-slate-600/40";
  }
  return "text-slate-600 dark:text-slate-400";
}

export function SchedulePage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canView = !!(user && canViewSchedule(user));
  const canManage = !!(user && hasPermission(user, PERM.SCHEDULE_MANAGE));

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [onlyEmptyAutofill, setOnlyEmptyAutofill] = useState(true);
  const [showScheduleHelp, setShowScheduleHelp] = useState(false);

  const qc = useQueryClient();

  const scheduleQuery = useQuery({
    queryKey: ["schedule", "month", year, month],
    queryFn: () => getScheduleMonth(year, month),
    enabled: canView,
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

  const autofillMut = useMutation({
    mutationFn: () =>
      postScheduleAutofill({
        year,
        month,
        only_empty: onlyEmptyAutofill,
      }),
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

  return (
    <AppShell
      title="Расписание"
      subtitle="Таблица как в Excel: только ФИО в первой колонке; система — справа. Порядок блоков систем задаётся в справочнике «Системы». Подсказки по кодам — в блоке «Справка» ниже."
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
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Только просмотр. Редактирование — право «schedule.manage».
            </p>
          )}
        </div>
      </div>

      <div className="mb-3">
        <button
          type="button"
          onClick={() => setShowScheduleHelp((v) => !v)}
          className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
        >
          {showScheduleHelp ? "Скрыть справку по кодам" : "Справка по кодам и автозаполнению"}
        </button>
        {showScheduleHelp && (
          <div className="mt-2 grid gap-2 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-soft dark:border-slate-600/60 dark:bg-slate-900/80 dark:text-slate-300 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] sm:grid-cols-2">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-100">Коды</p>
              <p className="mt-1 text-xs">
                Колонка «Часы» — сумма только числовых ячеек (8, 7.2, 11, 3…); буквы не входят. «Часы» и «Система»
                не закреплены — прокрутите таблицу вправо, чтобы увидеть конец месяца без перекрытий; слева закреплено только
                ФИО.
              </p>
              <p className="mt-1 text-xs">
                <span className="font-mono">о</span> отпуск / праздник РФ (будни) · <span className="font-mono">у</span> учёба ·{" "}
                <span className="font-mono">8</span>/<span className="font-mono">11</span>/<span className="font-mono">3</span> смены ·{" "}
                <span className="font-mono">7.2</span> · <span className="font-mono">11д</span>/<span className="font-mono">11в</span>
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-100">Автозаполнение</p>
              <p className="mt-1 text-xs">
                5/2 — часы из пола в кадровом справочнике; праздники РФ — «о»; сб/вс пустые. Отпуск — периоды в справочнике.
                Сменщики — пока только отпуск «о»; строки подсвечены цветом (как в «График_смен»). Наведите на ФИО —
                email, системы и тип графика.
              </p>
            </div>
          </div>
        )}
      </div>

      {scheduleQuery.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
      {scheduleQuery.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">Не удалось загрузить расписание.</p>
      )}

      {scheduleQuery.data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/90 shadow-soft dark:border-slate-600/70 dark:bg-slate-950 dark:shadow-[0_0_0_1px_rgba(148,163,184,0.08),inset_0_1px_0_0_rgba(255,255,255,0.04)]">
          <table className="w-max min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 dark:border-slate-600/60 dark:bg-slate-800">
                <th className="sticky left-0 z-20 w-[10.5rem] min-w-[9rem] max-w-[12rem] border-r border-slate-200 bg-slate-50/95 px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase text-slate-500 shadow-[4px_0_12px_-4px_rgba(15,23,42,0.12)] dark:border-slate-600/80 dark:bg-slate-800 dark:text-slate-300 dark:shadow-[4px_0_16px_-4px_rgba(0,0,0,0.45)]">
                  ФИО
                </th>
                {dayNumbers.map((d) => {
                  const di = dayByNum.get(d);
                  return (
                    <th
                      key={d}
                      className={`w-[2.35rem] min-w-[2.35rem] max-w-[2.35rem] px-0 py-0.5 text-center text-[9px] font-medium leading-none ${dayHeaderClass(di)}`}
                    >
                      {weekdayLabel(year, month, d)}
                    </th>
                  );
                })}
                <th
                  rowSpan={2}
                  className="w-[3.75rem] min-w-[3.75rem] border-l border-slate-200 bg-slate-50/95 px-0.5 py-1 text-center text-[9px] font-semibold uppercase leading-tight text-slate-500 dark:border-slate-600/80 dark:bg-slate-800 dark:text-slate-300"
                >
                  Часы
                </th>
                <th
                  rowSpan={2}
                  className="min-w-[7.5rem] max-w-[10rem] border-l border-slate-200 bg-slate-50/95 px-2 py-2 text-center text-xs font-semibold uppercase text-slate-500 dark:border-slate-600/80 dark:bg-slate-800 dark:text-slate-300"
                >
                  Система
                </th>
              </tr>
              <tr className="border-b border-slate-200 bg-white dark:border-slate-600/60 dark:bg-slate-800/95">
                <th
                  className="sticky left-0 z-20 border-r border-slate-200 bg-white px-1.5 py-0.5 shadow-[4px_0_12px_-4px_rgba(15,23,42,0.1)] dark:border-slate-600/80 dark:bg-slate-800 dark:shadow-[4px_0_16px_-4px_rgba(0,0,0,0.45)]"
                  aria-hidden
                />
                {dayNumbers.map((d) => {
                  const di = dayByNum.get(d);
                  return (
                    <th
                      key={d}
                      className={`w-[2.35rem] min-w-[2.35rem] px-0 py-0.5 text-center text-[10px] font-semibold leading-none ${dayHeaderClass(di)} ${!di?.is_ru_holiday && !di?.is_weekend ? "text-slate-700 dark:text-slate-300" : ""}`}
                    >
                      {d}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {scheduleQuery.data.groups.map((group, groupIndex) =>
                group.users.map((row, rowInGroup) => (
                  <tr
                    key={row.user_id}
                    className={`border-b border-slate-100 dark:border-slate-700/80 ${scheduleTableRowClass(row)} ${
                      groupIndex > 0 && rowInGroup === 0
                        ? "border-t-2 border-t-slate-300 dark:border-t-slate-500/80"
                        : ""
                    }`}
                  >
                    <td
                      className="sticky left-0 z-10 w-[10.5rem] min-w-[9rem] max-w-[12rem] border-r border-slate-200 bg-inherit px-1.5 py-0.5 shadow-[4px_0_12px_-4px_rgba(15,23,42,0.08)] dark:border-slate-600/70 dark:bg-slate-900/92 dark:shadow-[4px_0_14px_-4px_rgba(0,0,0,0.5)]"
                      title={scheduleRowTitle(row)}
                    >
                      <div className="truncate font-medium leading-tight text-slate-900 dark:text-slate-50">
                        {row.full_name}
                      </div>
                    </td>
                    {dayNumbers.map((d) => {
                      const key = String(d);
                      const val = row.cells[key] ?? "";
                      const di = dayByNum.get(d);
                      const headTint = di?.is_ru_holiday
                        ? "bg-amber-100/45 dark:bg-amber-950/35"
                        : di?.is_weekend
                          ? "bg-slate-100/55 dark:bg-slate-800/70"
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
                            <div className="flex h-7 min-w-[2.35rem] items-center justify-center text-center font-mono text-[11px] text-slate-800 dark:text-slate-200">
                              {val || <span className="text-slate-400 dark:text-slate-600">—</span>}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td
                      className="w-[3.75rem] min-w-[3.75rem] border-l border-slate-200 bg-inherit px-0.5 py-0.5 text-center font-mono text-[11px] font-semibold tabular-nums text-slate-900 dark:border-slate-600/70 dark:text-teal-200/95"
                    >
                      {formatHoursTotal(row.hours_total)}
                    </td>
                    {rowInGroup === 0 ? (
                      <td
                        rowSpan={Math.max(1, group.users.length)}
                        className="min-w-[7.5rem] max-w-[10rem] border-l border-slate-200 bg-inherit px-2 py-2 align-middle text-center text-xs font-semibold leading-snug text-slate-800 dark:border-slate-600/70 dark:text-violet-200/95"
                      >
                        {group.label}
                      </td>
                    ) : null}
                  </tr>
                )),
              )}
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
      className="h-7 w-full min-w-[2.35rem] border-0 bg-transparent text-center font-mono text-[11px] text-slate-900 outline-none ring-inset transition-colors placeholder:text-slate-400 focus:bg-sky-50/80 focus:ring-2 focus:ring-sky-400/60 dark:text-slate-100 dark:placeholder:text-slate-600 dark:hover:bg-slate-800/50 dark:focus:bg-slate-800/70 dark:focus:ring-sky-500/45"
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
