import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Filter, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "../api/client";
import {
  bulkEmployeeDirectoryProfile,
  listEmployeeDirectory,
  patchEmployeeDirectory,
  type EmployeeDirectoryBulkProfilePatch,
  type EmployeeDirectoryRowOut,
  type EmployeeGender,
  type VacationPeriod,
  type WorkScheduleKind,
} from "../api/employeeDirectory";
import { listPositions } from "../api/positions";
import { listSystems } from "../api/systems";
import { AppShell } from "../components/AppShell";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import {
  canEmployeeDirectoryComplianceEdit,
  canEmployeeDirectoryProfileEdit,
  PERM,
  hasPermission,
} from "../lib/permissions";
import { shiftWorkerRowClass } from "../lib/shiftWorkerRowStyle";
import { toastApiError, toastError, toastSuccess } from "../lib/toast";
import { useAuth } from "../context/AuthContext";

function asInputDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

function formatGenderCell(g: string | undefined): string {
  if (g === "female") return "Женский";
  if (g === "male") return "Мужской";
  return "Не указан";
}

function employeeDirectoryShiftRowClass(row: EmployeeDirectoryRowOut): string | undefined {
  if (row.work_schedule_kind === "shift") return shiftWorkerRowClass(row.id);
  return undefined;
}

function formatScheduleSummary(row: EmployeeDirectoryRowOut): string {
  if (row.work_schedule_kind === "shift") return "Сменщик";
  const norm = row.gender === "female" ? "7.2 ч" : "8 ч";
  return `5/2 · ${norm}`;
}

/** Сортировка таблицы: по строке систем (А→Я), без систем — в конце; при равенстве — ФИО. */
function compareDirectoryRowsBySystems(a: EmployeeDirectoryRowOut, b: EmployeeDirectoryRowOut): number {
  const na = a.systems?.length ?? 0;
  const nb = b.systems?.length ?? 0;
  if (na === 0 && nb > 0) return 1;
  if (nb === 0 && na > 0) return -1;
  if (na === 0 && nb === 0) return a.full_name.localeCompare(b.full_name, "ru");
  const sa = [...a.systems]
    .map((s) => s.name)
    .sort((x, y) => x.localeCompare(y, "ru"))
    .join(" · ");
  const sb = [...b.systems]
    .map((s) => s.name)
    .sort((x, y) => x.localeCompare(y, "ru"))
    .join(" · ");
  const c = sa.localeCompare(sb, "ru");
  if (c !== 0) return c;
  return a.full_name.localeCompare(b.full_name, "ru");
}

type TabId = "compliance" | "profile";

/** Трёхпозиционный фильтр да/нет для API (все = параметр не передаётся). */
type YesNoFilter = "all" | "yes" | "no";

const filterBarSelect =
  "h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

export function EmployeeDirectoryPage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canComplianceEdit = !!(user && canEmployeeDirectoryComplianceEdit(user));
  const canProfileEdit = !!(user && canEmployeeDirectoryProfileEdit(user));
  const showProfileTab = canProfileEdit;

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");

  const activeTab: TabId =
    tabParam === "profile" && showProfileTab ? "profile" : "compliance";

  useEffect(() => {
    if (tabParam === "profile" && !showProfileTab) {
      setSearchParams({ tab: "compliance" }, { replace: true });
    }
  }, [tabParam, showProfileTab, setSearchParams]);

  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterSystemIds, setFilterSystemIds] = useState<string[]>([]);
  const [filterPositionIds, setFilterPositionIds] = useState<string[]>([]);
  const [expiredOnly, setExpiredOnly] = useState(false);
  const [expiringDays, setExpiringDays] = useState<string>("");
  const [filterGender, setFilterGender] = useState<"" | EmployeeGender>("");
  const [filterSchedule, setFilterSchedule] = useState<"" | WorkScheduleKind>("");
  const [filterExamElectrical, setFilterExamElectrical] = useState<YesNoFilter>("all");
  const [filterPassHas, setFilterPassHas] = useState<YesNoFilter>("all");
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false);

  const [bulkExpanded, setBulkExpanded] = useState(false);
  const [bulkApplySchedule, setBulkApplySchedule] = useState(false);
  const [bulkScheduleKind, setBulkScheduleKind] = useState<WorkScheduleKind>("five_two");
  const [bulkApplyGender, setBulkApplyGender] = useState(false);
  const [bulkGender, setBulkGender] = useState<EmployeeGender>("unspecified");
  const [bulkPositionMode, setBulkPositionMode] = useState<"off" | "clear" | "set">("off");
  const [bulkPositionId, setBulkPositionId] = useState("");
  const [bulkReplaceSystems, setBulkReplaceSystems] = useState(false);
  const [bulkSystemIds, setBulkSystemIds] = useState<string[]>([]);

  const [editingCompliance, setEditingCompliance] = useState<EmployeeDirectoryRowOut | null>(null);
  const [complianceForm, setComplianceForm] = useState({
    exam_electrical_passed: false,
    exam_electrical_date: "",
    exam_electrical_valid_to: "",
    pass_has: false,
    pass_number: "",
    pass_valid_from: "",
    pass_valid_to: "",
    notes: "",
  });

  const [editingProfile, setEditingProfile] = useState<EmployeeDirectoryRowOut | null>(null);
  const [profileForm, setProfileForm] = useState({
    birth_date: "",
    position_id: "",
    system_ids: new Set<string>(),
    vacation_periods: [] as VacationPeriod[],
    work_schedule_kind: "five_two" as WorkScheduleKind,
    gender: "unspecified" as EmployeeGender,
  });

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      system_ids: filterSystemIds.length ? filterSystemIds : undefined,
      position_ids: filterPositionIds.length ? filterPositionIds : undefined,
      expired_only: expiredOnly || undefined,
      expiring_in_days: !expiredOnly && expiringDays.trim() ? Number(expiringDays) : undefined,
      gender: filterGender || undefined,
      work_schedule_kind: filterSchedule || undefined,
      exam_electrical_passed:
        filterExamElectrical === "all" ? undefined : filterExamElectrical === "yes",
      pass_has: filterPassHas === "all" ? undefined : filterPassHas === "yes",
    }),
    [
      search,
      filterSystemIds,
      filterPositionIds,
      expiredOnly,
      expiringDays,
      filterGender,
      filterSchedule,
      filterExamElectrical,
      filterPassHas,
    ],
  );

  const activeFilterCount = useMemo(() => {
    let n = filterSystemIds.length + filterPositionIds.length;
    if (expiredOnly) n++;
    if (expiringDays.trim()) n++;
    if (filterGender) n++;
    if (filterSchedule) n++;
    if (filterExamElectrical !== "all") n++;
    if (filterPassHas !== "all") n++;
    return n;
  }, [
    filterSystemIds,
    filterPositionIds,
    expiredOnly,
    expiringDays,
    filterGender,
    filterSchedule,
    filterExamElectrical,
    filterPassHas,
  ]);

  useEffect(() => {
    if (!showProfileTab) return;
    if (activeTab === "compliance") {
      setFilterGender("");
      setFilterSchedule("");
    } else {
      setFilterExamElectrical("all");
      setFilterPassHas("all");
      setExpiredOnly(false);
      setExpiringDays("");
    }
  }, [activeTab, showProfileTab]);

  const rowsQuery = useQuery({
    queryKey: ["employee-directory", filters],
    queryFn: () => listEmployeeDirectory(filters),
    enabled: !!user && hasPermission(user, PERM.EMPLOYEE_DIRECTORY_READ),
  });
  const systemsQuery = useQuery({ queryKey: ["systems", "all-for-directory"], queryFn: () => listSystems(false) });
  const positionsQuery = useQuery({ queryKey: ["positions", "all-for-directory"], queryFn: () => listPositions(false) });

  const saveComplianceMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof patchEmployeeDirectory>[1] }) =>
      patchEmployeeDirectory(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["employee-directory"] });
      toastSuccess("Данные сохранены");
      setEditingCompliance(null);
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить"),
  });

  const saveProfileMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof patchEmployeeDirectory>[1] }) =>
      patchEmployeeDirectory(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["employee-directory"] });
      await qc.invalidateQueries({ queryKey: ["schedule", "month"] });
      toastSuccess("Кадровые данные сохранены");
      setEditingProfile(null);
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить"),
  });

  const bulkProfileMut = useMutation({
    mutationFn: (body: { user_ids: string[]; patch: EmployeeDirectoryBulkProfilePatch }) =>
      bulkEmployeeDirectoryProfile(body),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["employee-directory"] });
      await qc.invalidateQueries({ queryKey: ["schedule", "month"] });
      toastSuccess(`Обновлено сотрудников: ${data.updated}`);
    },
    onError: (e: unknown) => toastApiError(e, "Массовое обновление не выполнено"),
  });

  function toggleFilterSystem(id: string) {
    setFilterSystemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleFilterPosition(id: string) {
    setFilterPositionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleBulkSystem(id: string) {
    setBulkSystemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function buildBulkPatch(): EmployeeDirectoryBulkProfilePatch | null {
    const patch: EmployeeDirectoryBulkProfilePatch = {};
    if (bulkApplySchedule) patch.work_schedule_kind = bulkScheduleKind;
    if (bulkApplyGender) patch.gender = bulkGender;
    if (bulkPositionMode === "clear") patch.position_id = null;
    if (bulkPositionMode === "set") {
      if (!bulkPositionId) return null;
      patch.position_id = bulkPositionId;
    }
    if (bulkReplaceSystems) patch.system_ids = [...bulkSystemIds];
    if (Object.keys(patch).length === 0) return null;
    return patch;
  }

  function runBulkApply() {
    if (!rows.length) {
      toastError("Нет сотрудников в текущем списке");
      return;
    }
    if (bulkPositionMode === "set" && !bulkPositionId) {
      toastError("Выберите должность или отключите назначение должности");
      return;
    }
    const patch = buildBulkPatch();
    if (!patch) {
      toastError("Отметьте хотя бы одно поле для изменения");
      return;
    }
    const lines: string[] = [];
    if (patch.work_schedule_kind) lines.push(`график: ${patch.work_schedule_kind === "shift" ? "сменщик" : "5/2"}`);
    if (patch.gender !== undefined)
      lines.push(
        `пол: ${patch.gender === "female" ? "женский" : patch.gender === "male" ? "мужской" : "не указан"}`,
      );
    if (patch.position_id === null) lines.push("должность: сбросить");
    if (patch.position_id && patch.position_id.length) lines.push("должность: назначить из списка");
    if (patch.system_ids) lines.push(`системы: заменить на ${patch.system_ids.length} шт.`);
    const ok = window.confirm(
      `Применить к ${rows.length} сотрудникам (текущая таблица с учётом фильтров)?\n\n${lines.join("\n")}`,
    );
    if (!ok) return;
    bulkProfileMut.mutate({ user_ids: rows.map((r) => r.id), patch });
  }

  const rows = rowsQuery.data ?? [];
  const displayRows = useMemo(() => [...rows].sort(compareDirectoryRowsBySystems), [rows]);
  const loadError = rowsQuery.error instanceof ApiError ? rowsQuery.error.detail : rowsQuery.isError ? "Ошибка загрузки" : null;

  function openComplianceEdit(row: EmployeeDirectoryRowOut) {
    setEditingCompliance(row);
    setComplianceForm({
      exam_electrical_passed: row.exam_electrical_passed,
      exam_electrical_date: asInputDate(row.exam_electrical_date),
      exam_electrical_valid_to: asInputDate(row.exam_electrical_valid_to),
      pass_has: row.pass_has,
      pass_number: row.pass_number ?? "",
      pass_valid_from: asInputDate(row.pass_valid_from),
      pass_valid_to: asInputDate(row.pass_valid_to),
      notes: row.notes ?? "",
    });
  }

  function openProfileEdit(row: EmployeeDirectoryRowOut) {
    setEditingProfile(row);
    setProfileForm({
      birth_date: asInputDate(row.birth_date),
      position_id: row.position?.id ?? "",
      system_ids: new Set(row.systems.map((s) => s.id)),
      vacation_periods: (row.vacation_periods ?? []).map((p) => ({
        start: asInputDate(p.start),
        end: asInputDate(p.end),
      })),
      work_schedule_kind: row.work_schedule_kind ?? "five_two",
      gender: row.gender ?? "unspecified",
    });
  }

  function setTab(tab: TabId) {
    setSearchParams(tab === "compliance" ? {} : { tab: "profile" });
  }

  const noReadAccess =
    user && !hasPermission(user, PERM.EMPLOYEE_DIRECTORY_READ) && (canComplianceEdit || canProfileEdit);

  return (
    <AppShell
      title="Сотрудники"
      subtitle="Две вкладки: контроль экзамена по ЭБ и пропусков; кадровый справочник (график, отпуск, система, должность, дата рождения). Права на вкладки задаются отдельно в роли."
    >
      <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setTab("compliance")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "compliance"
              ? "bg-sky-500 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          Экзамены и пропуска
        </button>
        {showProfileTab && (
          <button
            type="button"
            onClick={() => setTab("profile")}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === "profile"
                ? "bg-sky-500 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            Кадровый справочник
          </button>
        )}
      </div>

      {noReadAccess && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Нет права «Чтение справочника сотрудников» — список недоступен. Добавьте право{" "}
          <span className="font-mono">employee_directory.read</span> к роли или откройте раздел под учётной записью с
          этим правом.
        </p>
      )}

      {!noReadAccess && (
        <>
          <div className="mb-4 rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск: ФИО или email"
                className="min-w-[10rem] max-w-sm flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
              <button
                type="button"
                onClick={() => setFiltersPanelOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                aria-expanded={filtersPanelOpen}
              >
                <Filter className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                {filtersPanelOpen ? "Скрыть фильтры" : "Фильтры"}
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
            {filtersPanelOpen && (
              <div className="mt-3 border-t border-slate-200/80 pt-3 dark:border-slate-700/80">
                <p className="mb-2 max-w-xl text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                  Системы и должности: без выбора — все; несколько отмеченных — подходит сотрудник с{" "}
                  <span className="font-medium text-slate-600 dark:text-slate-300">любой</span> из них.
                  {showProfileTab && (
                    <>
                      {" "}
                      Пол и график — на вкладке «Кадровый справочник»; экзамен, пропуск и сроки — на «Экзамены и
                      пропуска».
                    </>
                  )}
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-[10.75rem] max-w-full shrink-0">
                    <MultiSelectDropdown
                      compact
                      className="w-full"
                      label="Системы"
                      items={(systemsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
                      selectedIds={filterSystemIds}
                      onToggle={toggleFilterSystem}
                      onClear={() => setFilterSystemIds([])}
                    />
                  </div>
                  <div className="w-[10.75rem] max-w-full shrink-0">
                    <MultiSelectDropdown
                      compact
                      className="w-full"
                      label="Должности"
                      items={(positionsQuery.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
                      selectedIds={filterPositionIds}
                      onToggle={toggleFilterPosition}
                      onClear={() => setFilterPositionIds([])}
                    />
                  </div>
                </div>

                {activeTab === "compliance" && (
                  <div className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-dashed border-slate-200/90 pt-2.5 dark:border-slate-600/80">
                    <label
                      className="flex w-[7.5rem] max-w-full shrink-0 flex-col gap-0.5"
                      title="Экзамен по электробезопасности: сдан или нет"
                    >
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Экзамен ЭБ
                      </span>
                      <select
                        value={filterExamElectrical}
                        onChange={(e) => setFilterExamElectrical(e.target.value as YesNoFilter)}
                        className={filterBarSelect}
                      >
                        <option value="all">Все</option>
                        <option value="yes">Сдан</option>
                        <option value="no">Не сдан</option>
                      </select>
                    </label>
                    <label
                      className="flex w-[7.5rem] max-w-full shrink-0 flex-col gap-0.5"
                      title="Оформлен ли пропуск"
                    >
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Пропуск
                      </span>
                      <select
                        value={filterPassHas}
                        onChange={(e) => setFilterPassHas(e.target.value as YesNoFilter)}
                        className={filterBarSelect}
                      >
                        <option value="all">Все</option>
                        <option value="yes">Есть</option>
                        <option value="no">Нет</option>
                      </select>
                    </label>
                    <label className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      <input
                        type="checkbox"
                        checked={expiredOnly}
                        onChange={(e) => setExpiredOnly(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-600"
                      />
                      Просрочено
                    </label>
                    <div
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 dark:border-slate-600 dark:bg-slate-800"
                      title="Пусто — без фильтра по сроку. Число — экзамен или пропуск истекает в ближайшие N дней."
                    >
                      <span className="whitespace-nowrap text-[10px] text-slate-500 dark:text-slate-400">≤ дней</span>
                      <input
                        type="number"
                        min={0}
                        disabled={expiredOnly}
                        value={expiringDays}
                        onChange={(e) => setExpiringDays(e.target.value)}
                        placeholder="—"
                        className="w-12 border-0 bg-transparent p-0 text-center text-xs tabular-nums text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-50 dark:text-slate-100"
                      />
                    </div>
                  </div>
                )}

                {activeTab === "profile" && showProfileTab && (
                  <div className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-dashed border-slate-200/90 pt-2.5 dark:border-slate-600/80">
                    <label className="flex w-[7.5rem] max-w-full shrink-0 flex-col gap-0.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Пол
                      </span>
                      <select
                        value={filterGender}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFilterGender(v === "" ? "" : (v as EmployeeGender));
                        }}
                        className={filterBarSelect}
                      >
                        <option value="">Все</option>
                        <option value="male">Мужской</option>
                        <option value="female">Женский</option>
                        <option value="unspecified">Не указан</option>
                      </select>
                    </label>
                    <label className="flex w-[8.5rem] max-w-full shrink-0 flex-col gap-0.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        График
                      </span>
                      <select
                        value={filterSchedule}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFilterSchedule(v === "" ? "" : (v as WorkScheduleKind));
                        }}
                        className={filterBarSelect}
                      >
                        <option value="">Все</option>
                        <option value="five_two">5/2</option>
                        <option value="shift">Сменщик</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {activeTab === "profile" && showProfileTab && canProfileEdit && (
            <div className="mb-4 overflow-hidden rounded-2xl border border-violet-200/90 bg-gradient-to-br from-violet-50/95 via-white to-sky-50/80 shadow-soft dark:border-violet-900/40 dark:from-violet-950/35 dark:via-slate-900/80 dark:to-slate-900/60">
              <button
                type="button"
                onClick={() => setBulkExpanded((v) => !v)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/50 dark:hover:bg-slate-800/50"
              >
                <SlidersHorizontal className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">Массовое изменение кадровых полей</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    По текущему списку: {rows.length} чел. (учитываются фильтры выше). Отметьте, что менять, и одно
                    действие для всех.
                  </p>
                </div>
                <span className="text-xs font-medium text-violet-700 dark:text-violet-300">{bulkExpanded ? "▼" : "▶"}</span>
              </button>
              {bulkExpanded && (
                <div className="space-y-4 border-t border-violet-200/60 px-4 py-4 dark:border-violet-900/40">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600 dark:bg-slate-800/80">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                        <input
                          type="checkbox"
                          checked={bulkApplySchedule}
                          onChange={(e) => setBulkApplySchedule(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        График (авто)
                      </span>
                      <select
                        value={bulkScheduleKind}
                        onChange={(e) => setBulkScheduleKind(e.target.value as WorkScheduleKind)}
                        disabled={!bulkApplySchedule}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="five_two">5/2</option>
                        <option value="shift">Сменщик</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600 dark:bg-slate-800/80">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                        <input
                          type="checkbox"
                          checked={bulkApplyGender}
                          onChange={(e) => setBulkApplyGender(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        Пол (5/2)
                      </span>
                      <select
                        value={bulkGender}
                        onChange={(e) => setBulkGender(e.target.value as EmployeeGender)}
                        disabled={!bulkApplyGender}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="male">Мужской</option>
                        <option value="female">Женский</option>
                        <option value="unspecified">Не указан</option>
                      </select>
                    </label>
                    <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600 dark:bg-slate-800/80">
                      <p className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">Должность</p>
                      <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="bulk-pos"
                            checked={bulkPositionMode === "off"}
                            onChange={() => setBulkPositionMode("off")}
                          />
                          Не менять
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="bulk-pos"
                            checked={bulkPositionMode === "clear"}
                            onChange={() => setBulkPositionMode("clear")}
                          />
                          Сбросить должность
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="bulk-pos"
                            checked={bulkPositionMode === "set"}
                            onChange={() => setBulkPositionMode("set")}
                          />
                          Назначить
                        </label>
                        <select
                          value={bulkPositionId}
                          onChange={(e) => setBulkPositionId(e.target.value)}
                          disabled={bulkPositionMode !== "set"}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                        >
                          <option value="">— выберите —</option>
                          {(positionsQuery.data ?? []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600 dark:bg-slate-800/80 sm:col-span-2 lg:col-span-1">
                      <label className="flex items-start gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                        <input
                          type="checkbox"
                          checked={bulkReplaceSystems}
                          onChange={(e) => setBulkReplaceSystems(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300"
                        />
                        <span>
                          Заменить производственные системы
                          <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">
                            Полная замена списка (можно оставить пустым — снять все системы).
                          </span>
                        </span>
                      </label>
                      <div className="mt-2">
                        <MultiSelectDropdown
                          label="Системы"
                          disabled={!bulkReplaceSystems}
                          items={(systemsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
                          selectedIds={bulkSystemIds}
                          onToggle={toggleBulkSystem}
                          onClear={() => setBulkSystemIds([])}
                          emptyLabel="Нет (снять все)"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={bulkProfileMut.isPending || !rows.length}
                      onClick={runBulkApply}
                      className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
                    >
                      {bulkProfileMut.isPending ? "Применение…" : `Применить к ${rows.length} сотрудникам`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mb-4 flex justify-end">
            <button
              type="button"
              disabled={rowsQuery.isPending}
              onClick={async () => {
                try {
                  if (activeTab === "compliance") {
                    const { downloadEmployeeDirectoryComplianceExcel } = await import("../lib/exportEmployeeDirectoryExcel");
                    await downloadEmployeeDirectoryComplianceExcel(displayRows);
                  } else {
                    const { downloadEmployeeDirectoryProfileExcel } = await import("../lib/exportEmployeeDirectoryExcel");
                    await downloadEmployeeDirectoryProfileExcel(displayRows);
                  }
                  toastSuccess("Файл Excel сформирован");
                } catch (e: unknown) {
                  toastApiError(e, "Не удалось сформировать Excel");
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              Выгрузить в Excel
            </button>
          </div>

          {loadError && (
            <p className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {loadError}
            </p>
          )}

          {activeTab === "compliance" && (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/70">
                  <tr>
                    <th className="px-3 py-2">Сотрудник</th>
                    <th className="px-3 py-2">Должность</th>
                    <th className="px-3 py-2">Системы</th>
                    <th className="px-3 py-2">Эл.безопасность</th>
                    <th className="px-3 py-2">Пропуск</th>
                    <th className="px-3 py-2">Примечание</th>
                    {canComplianceEdit && <th className="px-3 py-2">Действия</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {displayRows.map((r) => (
                    <tr key={r.id} className={employeeDirectoryShiftRowClass(r)}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900 dark:text-white">{r.full_name}</p>
                        <p className="text-xs text-slate-500">{r.email}</p>
                      </td>
                      <td className="px-3 py-2">{r.position?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.systems.map((s) => s.name).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.exam_electrical_passed ? "Сдан" : "Нет"}
                        <br />
                        до: {r.exam_electrical_valid_to ? asInputDate(r.exam_electrical_valid_to) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.pass_has ? `Есть (${r.pass_number ?? "без №"})` : "Нет"}
                        <br />
                        до: {r.pass_valid_to ? asInputDate(r.pass_valid_to) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.notes || "—"}</td>
                      {canComplianceEdit && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => openComplianceEdit(r)}
                            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                          >
                            Изменить
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!rowsQuery.isPending && rows.length === 0 && (
                    <tr>
                      <td colSpan={canComplianceEdit ? 7 : 6} className="px-3 py-6 text-center text-sm text-slate-500">
                        По выбранным фильтрам данных нет.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "profile" && showProfileTab && (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/70">
                  <tr>
                    <th className="px-3 py-2">Сотрудник</th>
                    <th className="px-3 py-2">Дата рождения</th>
                    <th className="px-3 py-2">Должность</th>
                    <th className="px-3 py-2">Системы</th>
                    <th className="px-3 py-2">Пол</th>
                    <th className="px-3 py-2">График (авто)</th>
                    <th className="px-3 py-2">Отпуск в графике</th>
                    {canProfileEdit && <th className="px-3 py-2">Действия</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {displayRows.map((r) => (
                    <tr key={r.id} className={employeeDirectoryShiftRowClass(r)}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900 dark:text-white">{r.full_name}</p>
                        <p className="text-xs text-slate-500">{r.email}</p>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.birth_date ? asInputDate(r.birth_date) : "—"}</td>
                      <td className="px-3 py-2">{r.position?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.systems.map((s) => s.name).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-xs">{formatGenderCell(r.gender)}</td>
                      <td className="px-3 py-2 text-xs">{formatScheduleSummary(r)}</td>
                      <td className="px-3 py-2 text-xs">
                        {(r.vacation_periods?.length ?? 0) > 0
                          ? `${r.vacation_periods!.length} период(ов)`
                          : "—"}
                      </td>
                      {canProfileEdit && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => openProfileEdit(r)}
                            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                          >
                            Изменить
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!rowsQuery.isPending && rows.length === 0 && (
                    <tr>
                      <td colSpan={canProfileEdit ? 8 : 7} className="px-3 py-6 text-center text-sm text-slate-500">
                        По выбранным фильтрам данных нет.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editingCompliance && canComplianceEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-soft-lg">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{editingCompliance.full_name}</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Раздел контроля: экзамен по электробезопасности и пропуск. График и отпуск — во вкладке «Кадровый
              справочник».
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveComplianceMut.mutate({
                  id: editingCompliance.id,
                  body: {
                    exam_electrical_passed: complianceForm.exam_electrical_passed,
                    exam_electrical_date: complianceForm.exam_electrical_date || null,
                    exam_electrical_valid_to: complianceForm.exam_electrical_valid_to || null,
                    pass_has: complianceForm.pass_has,
                    pass_number: complianceForm.pass_number.trim() || null,
                    pass_valid_from: complianceForm.pass_valid_from || null,
                    pass_valid_to: complianceForm.pass_valid_to || null,
                    notes: complianceForm.notes.trim() || null,
                  },
                });
              }}
              className="space-y-3"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={complianceForm.exam_electrical_passed}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, exam_electrical_passed: e.target.checked }))}
                />
                Экзамен по электробезопасности сдан
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Дата сдачи</span>
                <span>Действителен до</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={complianceForm.exam_electrical_date}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, exam_electrical_date: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <input
                  type="date"
                  value={complianceForm.exam_electrical_valid_to}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, exam_electrical_valid_to: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={complianceForm.pass_has}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, pass_has: e.target.checked }))}
                />
                Есть пропуск
              </label>
              <input
                value={complianceForm.pass_number}
                onChange={(e) => setComplianceForm((p) => ({ ...p, pass_number: e.target.value }))}
                placeholder="Номер пропуска"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Пропуск с</span>
                <span>Пропуск до</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={complianceForm.pass_valid_from}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, pass_valid_from: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <input
                  type="date"
                  value={complianceForm.pass_valid_to}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, pass_valid_to: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <textarea
                value={complianceForm.notes}
                onChange={(e) => setComplianceForm((p) => ({ ...p, notes: e.target.value }))}
                rows={3}
                placeholder="Примечание"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingCompliance(null)}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saveComplianceMut.isPending}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saveComplianceMut.isPending ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingProfile && canProfileEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6 shadow-soft-lg">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{editingProfile.full_name}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const vacation_periods = profileForm.vacation_periods
                  .filter((p) => p.start.trim() && p.end.trim())
                  .map((p) => ({ start: p.start.trim().slice(0, 10), end: p.end.trim().slice(0, 10) }));
                saveProfileMut.mutate({
                  id: editingProfile.id,
                  body: {
                    birth_date: profileForm.birth_date || null,
                    position_id: profileForm.position_id || null,
                    system_ids: [...profileForm.system_ids],
                    vacation_periods,
                    work_schedule_kind: profileForm.work_schedule_kind,
                    gender: profileForm.gender,
                  },
                });
              }}
              className="space-y-3"
            >
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Дата рождения
                <input
                  type="date"
                  value={profileForm.birth_date}
                  onChange={(e) => setProfileForm((p) => ({ ...p, birth_date: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Должность
                <select
                  value={profileForm.position_id}
                  onChange={(e) => setProfileForm((p) => ({ ...p, position_id: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                >
                  <option value="">— не выбрана —</option>
                  {(positionsQuery.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-800/40">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Производственные системы</p>
                <div className="mt-2 flex max-h-40 flex-col gap-2 overflow-y-auto">
                  {(systemsQuery.data ?? []).map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={profileForm.system_ids.has(s.id)}
                        onChange={() => {
                          setProfileForm((prev) => {
                            const n = new Set(prev.system_ids);
                            if (n.has(s.id)) n.delete(s.id);
                            else n.add(s.id);
                            return { ...prev, system_ids: n };
                          });
                        }}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-800/40">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">График для автозаполнения</p>
                <label className="block text-xs text-slate-500 dark:text-slate-400">
                  Тип графика
                  <select
                    value={profileForm.work_schedule_kind}
                    onChange={(e) =>
                      setProfileForm((p) => ({
                        ...p,
                        work_schedule_kind: e.target.value as WorkScheduleKind,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="five_two">Пятидневка (5/2)</option>
                    <option value="shift">Сменщик (смены заполняются вручную, позже — авто)</option>
                  </select>
                </label>
                <label className="block text-xs text-slate-500 dark:text-slate-400">
                  Пол сотрудника
                  <select
                    value={profileForm.gender}
                    onChange={(e) =>
                      setProfileForm((p) => ({
                        ...p,
                        gender: e.target.value as EmployeeGender,
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="male">Мужской</option>
                    <option value="female">Женский</option>
                    <option value="unspecified">Не указан</option>
                  </select>
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  При пятидневке в будни без праздника часы подставляются автоматически: женский — 7.2 ч, мужской или не
                  указан — 8 ч. Праздники РФ (будни) — «о»; сб/вс при автозаполнении остаются пустыми. Отпуск — из
                  периодов ниже. Для сменщиков сейчас учитывается только отпуск.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-800/40">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Отпуск для графика</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Интервалы дат — при автозаполнении расписания подставится «о» (с учётом опции «только пустые»).
                </p>
                <ul className="mt-3 space-y-2">
                  {profileForm.vacation_periods.map((period, idx) => (
                    <li key={idx} className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={period.start}
                        onChange={(e) =>
                          setProfileForm((p) => ({
                            ...p,
                            vacation_periods: p.vacation_periods.map((x, i) =>
                              i === idx ? { ...x, start: e.target.value } : x,
                            ),
                          }))
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                      />
                      <span className="text-slate-400">—</span>
                      <input
                        type="date"
                        value={period.end}
                        onChange={(e) =>
                          setProfileForm((p) => ({
                            ...p,
                            vacation_periods: p.vacation_periods.map((x, i) =>
                              i === idx ? { ...x, end: e.target.value } : x,
                            ),
                          }))
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setProfileForm((p) => ({
                            ...p,
                            vacation_periods: p.vacation_periods.filter((_, i) => i !== idx),
                          }))
                        }
                        className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        Удалить
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    setProfileForm((p) => ({
                      ...p,
                      vacation_periods: [...p.vacation_periods, { start: "", end: "" }],
                    }))
                  }
                  disabled={profileForm.vacation_periods.length >= 24}
                  className="mt-2 text-sm font-medium text-sky-600 hover:underline disabled:opacity-40 dark:text-sky-400"
                >
                  + Добавить период
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingProfile(null)}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saveProfileMut.isPending}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saveProfileMut.isPending ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
