import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileSpreadsheet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

function scheduleRowTitle(row: {
  full_name: string;
  email: string;
  systems_label: string;
  work_schedule_kind: string;
  gender: string;
}): string {
  const graph = isShiftKind(row.work_schedule_kind)
    ? row.work_schedule_kind === "two_two"
      ? "2/2"
      : "Сменный"
    : `5/2 · ${row.gender === "female" ? "7.2 ч" : "8 ч"} (будни)`;
  return `${row.full_name}\n${row.email}\nСистемы: ${row.systems_label}\nГрафик: ${graph}`;
}

import {
  getScheduleMonth,
  patchScheduleCell,
  patchScheduleRowColor,
  postScheduleAutofill,
  postScheduleImportExcel,
  postScheduleRegenerate,
  type ScheduleDayInfo,
  type ScheduleUserRow,
} from "../api/schedule";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { PERM, canViewSchedule, hasPermission } from "../lib/permissions";
import { toastApiError, toastSuccess } from "../lib/toast";
import { useModalLayer } from "../lib/useModalLayer";

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

function rowBgClass(_kind: string): string {
  return "bg-white dark:bg-slate-900/90";
}

function hexToRgba(hex: string, alpha: number): string | null {
  const s = String(hex ?? "").trim().toLowerCase();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return null;
  const p = m[1]!;
  const full = p.length === 3 ? p.split("").map((c) => c + c).join("") : p;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isShiftKind(kind: string): boolean {
  return kind === "shift" || kind === "two_two";
}

function cellForScheduleDay(row: ScheduleUserRow, day: number): unknown {
  const c: unknown = row.cells;
  if (c == null) return null;
  if (Array.isArray(c)) {
    const i = day - 1;
    return i >= 0 && i < c.length ? c[i] : null;
  }
  if (typeof c !== "object") return null;
  const rec = c as Record<string, unknown>;
  const s = String(day);
  if (Object.hasOwn(rec, s)) return rec[s];
  const pad2 = s.length === 1 ? `0${s}` : s;
  if (pad2 !== s && Object.hasOwn(rec, pad2)) return rec[pad2];
  return null;
}

function scheduleTableRowBgStyle(color: string | null | undefined): { backgroundColor: string } | undefined {
  if (!color) return undefined;
  const bg = hexToRgba(color, 0.24);
  return bg ? { backgroundColor: bg } : undefined;
}

function formatHoursTotal(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1).replace(/\.0$/, "");
}

function dayHeaderClass(d: ScheduleDayInfo | undefined, coverageGap?: boolean): string {
  const gap =
    coverageGap === true
      ? " ring-2 ring-inset ring-rose-400/80 dark:ring-rose-500/55"
      : "";
  if (!d) return gap.trimStart();
  if (d.is_ru_holiday) {
    return `bg-amber-100/95 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-800/50${gap}`;
  }
  if (d.is_weekend) {
    return `bg-slate-100/90 text-slate-600 dark:bg-slate-700/90 dark:text-slate-200 dark:ring-1 dark:ring-inset dark:ring-slate-600/40${gap}`;
  }
  return `text-slate-600 dark:text-slate-400${gap}`;
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
  /** Пустой массив — все системы. Значение `__none__` — блок без производственной системы. */
  const [filterSystemIds, setFilterSystemIds] = useState<string[]>([]);
  /** Пустой массив — все графики (work_schedule_kind). */
  const [filterGraphKinds, setFilterGraphKinds] = useState<string[]>([]);
  const [showScheduleHelp, setShowScheduleHelp] = useState(false);
  const [rowColorPickerOpen, setRowColorPickerOpen] = useState(false);
  const [rowColorPickerTarget, setRowColorPickerTarget] = useState<{
    user_id: string;
    full_name: string;
    color: string | null;
  } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSheetName, setImportSheetName] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  /** Сотрудник, для чьей строки вызывается «Перегенерировать» (последняя сохранённая ячейка в этом месяце). */
  const [regenerateTargetUserId, setRegenerateTargetUserId] = useState<string | null>(null);

  const closeImportExcelModal = useCallback(() => {
    setImportModalOpen(false);
    setImportSheetName("");
    setImportFile(null);
  }, []);
  const closeRowColorPicker = useCallback(() => {
    setRowColorPickerOpen(false);
    setRowColorPickerTarget(null);
  }, []);

  const qc = useQueryClient();

  const scheduleQuery = useQuery({
    queryKey: ["schedule", "month", year, month],
    queryFn: () => getScheduleMonth(year, month),
    enabled: canView,
  });

  useEffect(() => {
    setRegenerateTargetUserId(null);
  }, [year, month]);

  const dayByNum = useMemo(() => {
    const days = scheduleQuery.data?.days ?? [];
    const m = new Map<number, ScheduleDayInfo>();
    for (const x of days) m.set(x.day, x);
    return m;
  }, [scheduleQuery.data?.days]);

  const coverageGapDays = useMemo(() => {
    const ws = scheduleQuery.data?.shift_coverage_warnings ?? [];
    return new Set(ws.map((w) => w.day));
  }, [scheduleQuery.data?.shift_coverage_warnings]);

  const systemFilterOptions = useMemo(() => {
    const groups = scheduleQuery.data?.groups ?? [];
    const seen = new Set<string>();
    const out: { id: string; label: string }[] = [];
    for (const g of groups) {
      const id = g.system_id ?? "__none__";
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label: g.label });
    }
    return out;
  }, [scheduleQuery.data?.groups]);

  const filteredGroups = useMemo(() => {
    const groups = scheduleQuery.data?.groups ?? [];
    return groups
      .map((g) => ({
        ...g,
        users: g.users.filter((row) => {
          if (filterGraphKinds.length > 0 && !filterGraphKinds.includes(row.work_schedule_kind)) return false;
          return true;
        }),
      }))
      .filter((g) => {
        if (filterSystemIds.length > 0) {
          const sid = g.system_id ?? "__none__";
          if (!filterSystemIds.includes(sid)) return false;
        }
        return g.users.length > 0;
      });
  }, [scheduleQuery.data?.groups, filterSystemIds, filterGraphKinds]);

  const filtersActive = filterSystemIds.length > 0 || filterGraphKinds.length > 0;

  const toggleSystemFilter = useCallback((id: string) => {
    setFilterSystemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleGraphFilter = useCallback((kind: string) => {
    setFilterGraphKinds((prev) => (prev.includes(kind) ? prev.filter((x) => x !== kind) : [...prev, kind]));
  }, []);

  const selectAllSystemFilters = useCallback(() => {
    setFilterSystemIds(systemFilterOptions.map((o) => o.id));
  }, [systemFilterOptions]);

  const selectAllGraphFilters = useCallback(() => {
    setFilterGraphKinds(["five_two", "shift", "two_two"]);
  }, []);

  const totalRowsShown = useMemo(
    () => filteredGroups.reduce((acc, g) => acc + g.users.length, 0),
    [filteredGroups],
  );
  const totalRowsAll = useMemo(
    () => (scheduleQuery.data?.groups ?? []).reduce((acc, g) => acc + g.users.length, 0),
    [scheduleQuery.data?.groups],
  );

  const patchMut = useMutation({
    mutationFn: patchScheduleCell,
    onSuccess: async (_data, variables) => {
      setRegenerateTargetUserId(variables.user_id);
      await qc.invalidateQueries({ queryKey: ["schedule", "month", year, month] });
    },
    onError: (e) => toastApiError(e, "Не удалось сохранить ячейку"),
  });

  const rowColorMut = useMutation({
    mutationFn: patchScheduleRowColor,
    onSuccess: async () => {
      toastSuccess("Цвет строки сохранён");
      await qc.invalidateQueries({ queryKey: ["schedule", "month", year, month] });
    },
    onError: (e) => toastApiError(e, "Не удалось сохранить цвет строки"),
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
  const regenerateMut = useMutation({
    mutationFn: (userId: string) =>
      postScheduleRegenerate({
        year,
        month,
        user_id: userId,
      }),
    onSuccess: async (data) => {
      toastSuccess(
        data.cells_written > 0
          ? `Перегенерация выполнена: ${data.cells_written} ячеек`
          : "Записей в БД не менялось (данные уже совпадали с расчётом)",
      );
      await qc.invalidateQueries({ queryKey: ["schedule", "month", year, month] });
    },
    onError: (e) => toastApiError(e, "Перегенерация не выполнена"),
  });

  const importExcelMut = useMutation({
    mutationFn: (file: File) =>
      postScheduleImportExcel({
        year,
        month,
        file,
        sheet_name: importSheetName.trim() || undefined,
      }),
    onSuccess: async (data) => {
      const extra =
        data.unmatched_names.length > 0
          ? ` Не сопоставлено ФИО: ${data.unmatched_names.length}.`
          : "";
      toastSuccess(
        `Импорт: ${data.cells_imported} ячеек, сотрудников: ${data.users_matched} (лист «${data.sheet_used || "—"}»).${extra}`,
      );
      closeImportExcelModal();
      await qc.invalidateQueries({ queryKey: ["schedule", "month", year, month] });
    },
    onError: (e) => toastApiError(e, "Импорт из Excel не выполнен"),
  });

  const { backdropProps: importBackdropProps, stopPanelPointer: importStopPanelPointer } = useModalLayer(
    !!(canManage && importModalOpen),
    closeImportExcelModal,
    {
      closeOnBackdrop: !importExcelMut.isPending,
      closeOnEscape: !importExcelMut.isPending,
    },
  );
  const { backdropProps: rowColorBackdropProps, stopPanelPointer: rowColorStopPanelPointer } = useModalLayer(
    !!(canManage && rowColorPickerOpen),
    closeRowColorPicker,
    {
      closeOnBackdrop: !rowColorMut.isPending,
      closeOnEscape: !rowColorMut.isPending,
    },
  );
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
          <div className="flex flex-wrap items-center gap-2">
            <details className="relative">
              <summary className="marker:content-none list-none cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm hover:border-sky-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-600 [&::-webkit-details-marker]:hidden">
                Системы
                {filterSystemIds.length > 0 ? (
                  <span className="ml-1 font-semibold text-sky-600 dark:text-sky-400">({filterSystemIds.length})</span>
                ) : (
                  <span className="ml-1 text-slate-400">· все</span>
                )}
              </summary>
              <div className="absolute left-0 z-50 mt-1 min-w-[16rem] max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                <div className="mb-2 flex flex-wrap gap-1 border-b border-slate-100 pb-2 dark:border-slate-700">
                  <button
                    type="button"
                    className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                    onClick={() => setFilterSystemIds([])}
                  >
                    Сбросить
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 hover:bg-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:hover:bg-sky-900/80"
                    onClick={selectAllSystemFilters}
                  >
                    Все системы
                  </button>
                </div>
                {systemFilterOptions.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/80"
                  >
                    <input
                      type="checkbox"
                      checked={filterSystemIds.includes(o.id)}
                      onChange={() => toggleSystemFilter(o.id)}
                      className="rounded border-slate-300 dark:border-slate-500"
                    />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))}
              </div>
            </details>
            <details className="relative">
              <summary className="marker:content-none list-none cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm hover:border-sky-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-600 [&::-webkit-details-marker]:hidden">
                Графики
                {filterGraphKinds.length > 0 ? (
                  <span className="ml-1 font-semibold text-sky-600 dark:text-sky-400">({filterGraphKinds.length})</span>
                ) : (
                  <span className="ml-1 text-slate-400">· все</span>
                )}
              </summary>
              <div className="absolute left-0 z-50 mt-1 min-w-[12rem] rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800">
                <div className="mb-2 flex flex-wrap gap-1 border-b border-slate-100 pb-2 dark:border-slate-700">
                  <button
                    type="button"
                    className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                    onClick={() => setFilterGraphKinds([])}
                  >
                    Сбросить
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 hover:bg-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:hover:bg-sky-900/80"
                    onClick={selectAllGraphFilters}
                  >
                    Все типы
                  </button>
                </div>
                {(
                  [
                    { value: "five_two", label: "5/2" },
                    { value: "shift", label: "Сменный" },
                    { value: "two_two", label: "2/2" },
                  ] as const
                ).map((o) => (
                  <label
                    key={o.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/80"
                  >
                    <input
                      type="checkbox"
                      checked={filterGraphKinds.includes(o.value)}
                      onChange={() => toggleGraphFilter(o.value)}
                      className="rounded border-slate-300 dark:border-slate-500"
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </details>
            {filtersActive && totalRowsAll > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Показано: {totalRowsShown} из {totalRowsAll}
              </span>
            )}
          </div>
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
              <button
                type="button"
                disabled={regenerateMut.isPending || !regenerateTargetUserId}
                onClick={() => {
                  if (regenerateTargetUserId) regenerateMut.mutate(regenerateTargetUserId);
                }}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-violet-700 disabled:opacity-60 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
                title={
                  regenerateTargetUserId
                    ? "Достроить эту строку месяца по циклу от ваших поштучных правок (не затрагивает других сотрудников)"
                    : "Сначала сохраните хотя бы одну ячейку в строке сотрудника в этом месяце"
                }
              >
                {regenerateMut.isPending ? "Перегенерация…" : "Перегенерировать по ручным"}
              </button>
              <button
                type="button"
                disabled={importExcelMut.isPending}
                onClick={() => setImportModalOpen(true)}
                className="group inline-flex items-center gap-2 rounded-xl border border-emerald-200/90 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-900/15 ring-1 ring-white/25 transition hover:from-emerald-400 hover:via-teal-400 hover:to-cyan-500 hover:shadow-lg disabled:opacity-60 dark:border-emerald-400/30 dark:from-emerald-600 dark:via-teal-600 dark:to-cyan-700 dark:ring-white/10 dark:hover:from-emerald-500 dark:hover:via-teal-500 dark:hover:to-cyan-600"
                title="Загрузить месяц из файла Excel (как «График_смен»)"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 opacity-95 group-hover:scale-105" aria-hidden />
                Из Excel
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
                ФИО. Для сменщиков по каждой системе считается покрытие: в день должно быть не меньше двух человек «на работе»;
                отпуск <span className="font-mono">о</span>, учёба <span className="font-mono">у</span> и пустые ячейки в расчёт не входят — см. блок предупреждений над таблицей и розовую обводку дат.
              </p>
              <p className="mt-1 text-xs">
                <span className="font-mono">о</span> только отпуск (из справочника) · <span className="font-mono">у</span> учёба ·{" "}
                <span className="font-mono">8</span>/<span className="font-mono">11</span>/<span className="font-mono">3</span> смены ·{" "}
                <span className="font-mono">7.2</span> · <span className="font-mono">11д</span>/<span className="font-mono">11в</span>
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-100">Автозаполнение</p>
              <p className="mt-1 text-xs">
                5/2 — часы из пола в кадровом справочнике; праздники РФ и сб/вс — пустые ячейки. Отпуск — только «о», периоды в справочнике.
                Подсветка: автоматически красим только сотрудников с типом графика «Сменный» (shift), если есть связь
                «одинаковый день+код 11/3/8» или «совпавшая фаза цикла». Ручной цвет по клику на ФИО имеет приоритет.
                Если ручной цвет в новом месяце не задан, берётся цвет из прошлого месяца.
                «о»/«у» не смена. Наведите на ФИО — email, системы и тип графика.
              </p>
              <p className="mt-1 text-xs">
                «Перегенерировать по ручным» действует только на строку сотрудника, у которого вы последним сохранили
                ячейку в этом месяце (другие строки не меняются). Поштучные правки задают фрагмент; пустые после очистки
                сохраняются; «пачки» автозаполнения не мешают достройке хвоста по 11-3-8 / 2/2 или 5/2. Смена месяца
                сбрасывает выбор — снова сохраните ячейку у нужного человека.
              </p>
              <p className="mt-1 text-xs">
                «Из Excel» — загрузка листа месяца из .xlsx: строки по ФИО сопоставляются с сотрудниками в системе.
              </p>
            </div>
          </div>
        )}
      </div>

      {canManage && importModalOpen && (
        <div
          {...importBackdropProps}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-emerald-200/60 bg-white shadow-2xl dark:border-emerald-900/40 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-import-title"
            onClick={importStopPanelPointer}
          >
            <div className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 dark:border-emerald-900/50 dark:from-emerald-950/50 dark:to-teal-950/40">
              <h2 id="schedule-import-title" className="flex items-center gap-2 text-lg font-semibold text-emerald-950 dark:text-emerald-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200">
                  <FileSpreadsheet className="h-5 w-5" aria-hidden />
                </span>
                Импорт из Excel
              </h2>
              <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
                Месяц: <span className="font-medium">{MONTH_NAMES[month - 1]} {year}</span> — данные подставятся в текущую таблицу.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block text-sm text-slate-700 dark:text-slate-200">
                Лист (необязательно)
                <input
                  value={importSheetName}
                  onChange={(e) => setImportSheetName(e.target.value)}
                  placeholder={`Например: ${MONTH_NAMES[month - 1]} — иначе по названию месяца`}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <label className="block text-sm text-slate-700 dark:text-slate-200">
                Файл .xlsx
                <input
                  key={importFile?.name ?? "empty"}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="mt-1.5 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-900 hover:file:bg-emerald-200 dark:text-slate-300 dark:file:bg-emerald-900/40 dark:file:text-emerald-100 dark:hover:file:bg-emerald-800/50"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={closeImportExcelModal}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!importFile || importExcelMut.isPending}
                onClick={() => {
                  if (importFile) importExcelMut.mutate(importFile);
                }}
                className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 dark:from-emerald-500 dark:to-teal-500 dark:hover:from-emerald-400 dark:hover:to-teal-400"
              >
                {importExcelMut.isPending ? "Загрузка…" : "Загрузить расписание"}
              </button>
            </div>
          </div>
        </div>
      )}
      {canManage && rowColorPickerOpen && rowColorPickerTarget && (
        <div
          {...rowColorBackdropProps}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-sky-200/60 bg-white shadow-2xl dark:border-sky-900/40 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-row-color-title"
            onClick={rowColorStopPanelPointer}
          >
            <div className="border-b border-sky-100 bg-gradient-to-r from-sky-50 to-indigo-50 px-5 py-4 dark:border-sky-900/50 dark:from-sky-950/50 dark:to-indigo-950/40">
              <h2 id="schedule-row-color-title" className="text-lg font-semibold text-sky-950 dark:text-sky-100">
                Цвет строки
              </h2>
              <p className="mt-1 truncate text-sm text-sky-900/80 dark:text-sky-200/80">{rowColorPickerTarget.full_name}</p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
                Выберите цвет
                <input
                  type="color"
                  value={rowColorPickerTarget.color ?? "#ffffff"}
                  className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-transparent p-0"
                  onChange={(e) =>
                    setRowColorPickerTarget((prev) => (prev ? { ...prev, color: e.target.value } : prev))
                  }
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={closeRowColorPicker}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={rowColorMut.isPending}
                className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-60 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                onClick={() => {
                  rowColorMut.mutate({
                    year,
                    month,
                    user_id: rowColorPickerTarget.user_id,
                    color: null,
                  });
                  closeRowColorPicker();
                }}
              >
                Сбросить
              </button>
              <button
                type="button"
                disabled={rowColorMut.isPending}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-700 disabled:opacity-60"
                onClick={() => {
                  rowColorMut.mutate({
                    year,
                    month,
                    user_id: rowColorPickerTarget.user_id,
                    color: rowColorPickerTarget.color ?? "#ffffff",
                  });
                  closeRowColorPicker();
                }}
              >
                {rowColorMut.isPending ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduleQuery.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
      {scheduleQuery.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">Не удалось загрузить расписание.</p>
      )}

      {scheduleQuery.data &&
        (scheduleQuery.data.shift_staffing_notes.length > 0 ||
          scheduleQuery.data.shift_coverage_warnings.length > 0) && (
          <div className="mb-3 space-y-2 rounded-2xl border border-slate-200/90 bg-white/90 px-4 py-3 text-sm shadow-soft dark:border-slate-600/70 dark:bg-slate-900/85 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Покрытие сменщиков (≥{scheduleQuery.data.min_shift_staff_required ?? 2} в день по системе)
            </p>
            {scheduleQuery.data.shift_staffing_notes.map((n) => (
              <p key={`note-${n.system_id}`} className="text-xs text-sky-800 dark:text-sky-200/95">
                {n.message}
              </p>
            ))}
            {scheduleQuery.data.shift_coverage_warnings.length > 0 && (
              <ul className="max-h-40 list-inside list-disc space-y-1 overflow-y-auto text-xs text-rose-800 dark:text-rose-200/90">
                {scheduleQuery.data.shift_coverage_warnings.map((w) => (
                  <li key={`${w.system_id}-${w.day}`}>{w.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

      {scheduleQuery.data && filteredGroups.length === 0 && (
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Нет строк по выбранным фильтрам. Сбросьте фильтры или измените критерии.
        </p>
      )}

      {scheduleQuery.data && filteredGroups.length > 0 && (
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
                      className={`w-[2.35rem] min-w-[2.35rem] max-w-[2.35rem] px-0 py-0.5 text-center text-[9px] font-medium leading-none ${dayHeaderClass(di, coverageGapDays.has(d))}`}
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
                      className={`w-[2.35rem] min-w-[2.35rem] px-0 py-0.5 text-center text-[10px] font-semibold leading-none ${dayHeaderClass(di, coverageGapDays.has(d))} ${!di?.is_ru_holiday && !di?.is_weekend ? "text-slate-700 dark:text-slate-300" : ""}`}
                    >
                      {d}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((group, groupIndex) =>
                group.users.map((row, rowInGroup) => {
                  const effectiveRowColor = row.manual_row_color ?? row.auto_row_color ?? null;
                  const rowBgStyle = scheduleTableRowBgStyle(effectiveRowColor);
                  const rowBgClassName = effectiveRowColor ? "" : rowBgClass(row.row_kind);
                  return (
                  <tr
                    key={row.user_id}
                    className={`border-b border-slate-100 dark:border-slate-700/80 ${
                      groupIndex > 0 && rowInGroup === 0
                        ? "border-t-2 border-t-slate-300 dark:border-t-slate-500/80"
                        : ""
                    }`}
                  >
                    <td
                      style={rowBgStyle}
                      className={`sticky left-0 z-10 w-[10.5rem] min-w-[9rem] max-w-[12rem] border-r border-slate-200 px-1.5 py-0.5 shadow-[4px_0_12px_-4px_rgba(15,23,42,0.08)] dark:border-slate-600/70 dark:shadow-[4px_0_14px_-4px_rgba(0,0,0,0.5)] ${rowBgClassName}`}
                      title={scheduleRowTitle(row)}
                    >
                      <button
                        type="button"
                        disabled={!canManage}
                        className={`w-full truncate text-left font-medium leading-tight text-slate-900 dark:text-slate-50 ${
                          canManage ? "hover:underline" : ""
                        }`}
                        onClick={() => {
                          if (!canManage) return;
                          setRowColorPickerTarget({
                            user_id: row.user_id,
                            full_name: row.full_name,
                            color: row.manual_row_color ?? null,
                          });
                          setRowColorPickerOpen(true);
                        }}
                      >
                        {row.full_name}
                      </button>
                    </td>
                    {dayNumbers.map((d) => {
                      const key = String(d);
                      const val = String(cellForScheduleDay(row, d) ?? "");
                      const di = dayByNum.get(d);
                      const isColoredRow = !!effectiveRowColor;
                      const headTint = isColoredRow
                        ? ""
                        : di?.is_ru_holiday
                          ? "bg-amber-100/45 dark:bg-amber-950/35"
                          : di?.is_weekend
                            ? "bg-slate-100/55 dark:bg-slate-800/70"
                            : "";
                      return (
                        <td key={key} style={rowBgStyle} className={`p-0 ${rowBgClassName} ${headTint}`}>
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
                      style={rowBgStyle}
                      className={`w-[3.75rem] min-w-[3.75rem] border-l border-slate-200 px-0.5 py-0.5 text-center font-mono text-[11px] font-semibold tabular-nums text-slate-900 dark:border-slate-600/70 dark:text-teal-200/95 ${rowBgClassName}`}
                    >
                      {formatHoursTotal(row.hours_total)}
                    </td>
                    {rowInGroup === 0 ? (
                      <td
                        rowSpan={Math.max(1, group.users.length)}
                        className="min-w-[7.5rem] max-w-[10rem] border-l border-slate-200 bg-white px-2 py-2 align-middle text-center text-xs font-semibold leading-snug text-slate-800 dark:border-slate-600/70 dark:bg-slate-900/90 dark:text-violet-200/95"
                      >
                        {group.label}
                      </td>
                    ) : null}
                  </tr>
                  );
                })
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
