import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Filter, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

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
import { EmployeeVacationsPanel } from "../components/EmployeeVacationsPanel";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import {
  examElectricalPassedLabel,
  examElectricalValidityInfo,
  EXAM_NOT_REQUIRED_LABEL,
  summarizeComplianceRows,
  validityInfo,
  type ValidityStatus,
} from "../lib/employeeComplianceStatus";
import {
  canEmployeeDirectoryComplianceEdit,
  canEmployeeDirectoryProfileEdit,
  PERM,
  hasPermission,
} from "../lib/permissions";
import { toastApiError, toastError, toastSuccess } from "../lib/toast";
import { useModalLayer } from "../lib/useModalLayer";
import { useToastQueryError } from "../lib/useToastQueryError";
import { useAuth } from "../context/AuthContext";

function asInputDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function DirectoryNameCell({ row }: { row: EmployeeDirectoryRowOut }) {
  return (
    <>
      <p className="font-medium text-slate-900 dark:text-white">{row.full_name}</p>
      <p className="text-xs text-slate-500">{row.email}</p>
      {row.is_dismissed ? (
        <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          Уволен{row.dismissed_at ? ` ${asInputDate(row.dismissed_at)}` : ""}
        </p>
      ) : null}
    </>
  );
}

/** YYYY-MM-DD → та же дата + 1 год (для 29.02 — 28.02 следующего года). */
function addOneYearDateInput(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime()) || dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return "";
  }
  dt.setFullYear(y + 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatGenderCell(g: string | undefined): string {
  if (g === "female") return "Женский";
  if (g === "male") return "Мужской";
  return "Не указан";
}

function formatScheduleSummary(row: EmployeeDirectoryRowOut): string {
  if (row.work_schedule_kind === "shift") return "Сменный";
  if (row.work_schedule_kind === "two_two") return "2/2";
  const norm = row.gender === "female" ? "7.2 ч" : "8 ч";
  return `5/2 · ${norm}`;
}

type TabId = "compliance" | "profile" | "vacations" | "report";
type SortDir = "asc" | "desc";
type SortKey =
  | "name"
  | "position"
  | "systems"
  | "exam"
  | "examStatus"
  | "pass"
  | "passStatus"
  | "notes"
  | "personnelNumber"
  | "birthDate"
  | "positionAssignedAt"
  | "gender"
  | "schedule"
  | "remote"
  | "workAddress"
  | "fieldWorker"
  | "vacation";

const TAB_SORT_KEYS: Record<TabId, readonly SortKey[]> = {
  compliance: ["name", "position", "systems", "exam", "pass", "notes"],
  report: ["name", "position", "systems", "exam", "examStatus", "pass", "passStatus"],
  profile: [
    "name",
    "personnelNumber",
    "birthDate",
    "position",
    "positionAssignedAt",
    "systems",
    "gender",
    "schedule",
    "remote",
    "workAddress",
    "fieldWorker",
    "vacation",
  ],
  vacations: ["name"],
};

const STATUS_SORT_RANK: Record<ValidityStatus, number> = {
  expired: 0,
  expiring: 1,
  missing: 2,
  none: 3,
  not_required: 4,
  ok: 5,
};

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" });
}

function cmpEmptyLast(a: string, b: string): number {
  const ae = !a.trim();
  const be = !b.trim();
  if (ae && be) return 0;
  if (ae) return 1;
  if (be) return -1;
  return cmpStr(a, b);
}

function nameTie(a: EmployeeDirectoryRowOut, b: EmployeeDirectoryRowOut): number {
  return cmpStr(a.full_name, b.full_name) || cmpStr(a.email, b.email);
}

function compareDirectoryRows(
  a: EmployeeDirectoryRowOut,
  b: EmployeeDirectoryRowOut,
  key: SortKey,
  dir: SortDir,
): number {
  let c = 0;
  switch (key) {
    case "name":
      c = nameTie(a, b);
      break;
    case "position":
      c = cmpEmptyLast(a.position?.name ?? "", b.position?.name ?? "");
      break;
    case "systems":
      c = cmpEmptyLast(
        a.systems.map((s) => s.name).join(", "),
        b.systems.map((s) => s.name).join(", "),
      );
      break;
    case "exam":
      c = Number(Boolean(a.is_remote)) - Number(Boolean(b.is_remote));
      if (!c) c = Number(a.exam_electrical_passed) - Number(b.exam_electrical_passed);
      if (!c) c = cmpEmptyLast(asInputDate(a.exam_electrical_valid_to), asInputDate(b.exam_electrical_valid_to));
      if (!c) c = cmpEmptyLast(a.exam_electrical_group ?? "", b.exam_electrical_group ?? "");
      break;
    case "examStatus": {
      const ea = examElectricalValidityInfo(a);
      const eb = examElectricalValidityInfo(b);
      c = STATUS_SORT_RANK[ea.status] - STATUS_SORT_RANK[eb.status];
      if (!c) c = (ea.daysLeft ?? 99_999) - (eb.daysLeft ?? 99_999);
      break;
    }
    case "pass":
      c = Number(a.pass_has) - Number(b.pass_has);
      if (!c) c = cmpEmptyLast(asInputDate(a.pass_valid_to), asInputDate(b.pass_valid_to));
      if (!c) c = cmpEmptyLast(a.pass_number ?? "", b.pass_number ?? "");
      break;
    case "passStatus": {
      const pa = validityInfo(a.pass_valid_to, a.pass_has);
      const pb = validityInfo(b.pass_valid_to, b.pass_has);
      c = STATUS_SORT_RANK[pa.status] - STATUS_SORT_RANK[pb.status];
      if (!c) c = (pa.daysLeft ?? 99_999) - (pb.daysLeft ?? 99_999);
      break;
    }
    case "notes":
      c = cmpEmptyLast(a.notes ?? "", b.notes ?? "");
      break;
    case "personnelNumber":
      c = cmpEmptyLast(a.personnel_number ?? "", b.personnel_number ?? "");
      break;
    case "birthDate":
      c = cmpEmptyLast(asInputDate(a.birth_date), asInputDate(b.birth_date));
      break;
    case "positionAssignedAt":
      c = cmpEmptyLast(asInputDate(a.position_assigned_at), asInputDate(b.position_assigned_at));
      break;
    case "gender":
      c = cmpStr(formatGenderCell(a.gender), formatGenderCell(b.gender));
      break;
    case "schedule":
      c = cmpStr(formatScheduleSummary(a), formatScheduleSummary(b));
      break;
    case "remote":
      c = Number(Boolean(a.is_remote)) - Number(Boolean(b.is_remote));
      break;
    case "workAddress":
      c = cmpEmptyLast(a.work_address ?? "", b.work_address ?? "");
      break;
    case "fieldWorker":
      c = Number(Boolean(a.is_field_worker)) - Number(Boolean(b.is_field_worker));
      break;
    case "vacation":
      c = (a.vacation_periods?.length ?? 0) - (b.vacation_periods?.length ?? 0);
      break;
  }
  if (!c && key !== "name") c = nameTie(a, b);
  return dir === "asc" ? c : -c;
}

function DirectorySortHeader({
  column,
  label,
  sortKey,
  sortDir,
  onSort,
}: {
  column: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (column: SortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <th
      className="px-3 py-2"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="group inline-flex items-center gap-1 rounded-md px-0.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-700/80 dark:hover:text-white"
        title={
          active
            ? sortDir === "asc"
              ? "Сортировка: по возрастанию (нажмите для убывания)"
              : "Сортировка: по убыванию (нажмите для возрастания)"
            : `Сортировать по: ${label}`
        }
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          )
        ) : (
          <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );
}

/** Трёхпозиционный фильтр да/нет для API (все = параметр не передаётся). */
type YesNoFilter = "all" | "yes" | "no";
type EmploymentFilter = "working" | "dismissed" | "all";

const filterBarSelect =
  "h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

const dateFilterInput =
  "h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

function statusBadgeClass(status: ValidityStatus): string {
  if (status === "expired") {
    return "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200";
  }
  if (status === "expiring") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }
  if (status === "ok") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  }
  if (status === "not_required") {
    return "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export function EmployeeDirectoryPage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canComplianceEdit = !!(user && canEmployeeDirectoryComplianceEdit(user));
  const canProfileEdit = !!(user && canEmployeeDirectoryProfileEdit(user));
  const showProfileTab = canProfileEdit;

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");

  const activeTab: TabId =
    tabParam === "report"
      ? "report"
      : tabParam === "vacations"
        ? "vacations"
        : tabParam === "profile" && showProfileTab
          ? "profile"
          : "compliance";

  useEffect(() => {
    if (tabParam === "profile" && !showProfileTab) {
      setSearchParams({}, { replace: true });
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
  const [filterRemote, setFilterRemote] = useState<YesNoFilter>("all");
  const [filterFieldWorker, setFilterFieldWorker] = useState<YesNoFilter>("all");
  const [filterEmployment, setFilterEmployment] = useState<EmploymentFilter>("working");
  const [examValidFrom, setExamValidFrom] = useState("");
  const [examValidTo, setExamValidTo] = useState("");
  const [passValidFrom, setPassValidFrom] = useState("");
  const [passValidTo, setPassValidTo] = useState("");
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false);
  /** По умолчанию А→Я по ФИО */
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [bulkExpanded, setBulkExpanded] = useState(false);
  const [bulkApplySchedule, setBulkApplySchedule] = useState(false);
  const [bulkScheduleKind, setBulkScheduleKind] = useState<WorkScheduleKind>("five_two");
  const [bulkApplyGender, setBulkApplyGender] = useState(false);
  const [bulkGender, setBulkGender] = useState<EmployeeGender>("unspecified");
  const [bulkPositionMode, setBulkPositionMode] = useState<"off" | "clear" | "set">("off");
  const [bulkPositionId, setBulkPositionId] = useState("");
  const [bulkReplaceSystems, setBulkReplaceSystems] = useState(false);
  const [bulkSystemIds, setBulkSystemIds] = useState<string[]>([]);
  const [bulkApplyRemote, setBulkApplyRemote] = useState(false);
  const [bulkRemote, setBulkRemote] = useState(false);
  const [bulkApplyFieldWorker, setBulkApplyFieldWorker] = useState(false);
  const [bulkFieldWorker, setBulkFieldWorker] = useState(false);
  const [bulkApplyWorkAddress, setBulkApplyWorkAddress] = useState(false);
  const [bulkWorkAddress, setBulkWorkAddress] = useState("");
  const [bulkApplyPositionDate, setBulkApplyPositionDate] = useState(false);
  const [bulkPositionAssignedAt, setBulkPositionAssignedAt] = useState("");

  const [editingCompliance, setEditingCompliance] = useState<EmployeeDirectoryRowOut | null>(null);
  const [complianceForm, setComplianceForm] = useState({
    exam_electrical_passed: false,
    exam_electrical_date: "",
    exam_electrical_valid_to: "",
    exam_electrical_group: "",
    exam_electrical_certificate_number: "",
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
    is_remote: false,
    work_address: "",
    is_field_worker: false,
    position_assigned_at: "",
    personnel_number: "",
    is_dismissed: false,
    dismissed_at: "",
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
      is_remote:
        activeTab === "compliance"
          ? false
          : filterRemote === "all"
            ? undefined
            : filterRemote === "yes",
      is_field_worker: filterFieldWorker === "all" ? undefined : filterFieldWorker === "yes",
      exam_electrical_passed:
        filterExamElectrical === "all" ? undefined : filterExamElectrical === "yes",
      pass_has: filterPassHas === "all" ? undefined : filterPassHas === "yes",
      exam_valid_to_from: activeTab === "report" && examValidFrom ? examValidFrom : undefined,
      exam_valid_to_to: activeTab === "report" && examValidTo ? examValidTo : undefined,
      pass_valid_to_from: activeTab === "report" && passValidFrom ? passValidFrom : undefined,
      pass_valid_to_to: activeTab === "report" && passValidTo ? passValidTo : undefined,
      is_dismissed:
        filterEmployment === "dismissed" ? true : filterEmployment === "working" ? false : undefined,
      include_dismissed: filterEmployment === "all" || undefined,
    }),
    [
      activeTab,
      search,
      filterSystemIds,
      filterPositionIds,
      expiredOnly,
      expiringDays,
      filterGender,
      filterSchedule,
      filterRemote,
      filterFieldWorker,
      filterExamElectrical,
      filterPassHas,
      examValidFrom,
      examValidTo,
      passValidFrom,
      passValidTo,
      filterEmployment,
    ],
  );

  const activeFilterCount = useMemo(() => {
    let n = filterSystemIds.length + filterPositionIds.length;
    if (expiredOnly) n++;
    if (expiringDays.trim()) n++;
    if (filterGender) n++;
    if (filterSchedule) n++;
    if (filterRemote !== "all" && activeTab === "profile") n++;
    if (filterFieldWorker !== "all") n++;
    if (filterExamElectrical !== "all") n++;
    if (filterPassHas !== "all") n++;
    if (examValidFrom) n++;
    if (examValidTo) n++;
    if (passValidFrom) n++;
    if (passValidTo) n++;
    if (filterEmployment !== "working") n++;
    return n;
  }, [
    filterSystemIds,
    filterPositionIds,
    expiredOnly,
    expiringDays,
    filterGender,
    filterSchedule,
    filterRemote,
    filterFieldWorker,
    filterExamElectrical,
    filterPassHas,
    examValidFrom,
    examValidTo,
    passValidFrom,
    passValidTo,
    activeTab,
    filterEmployment,
  ]);

  useEffect(() => {
    if (activeTab === "compliance" || activeTab === "report") {
      setFilterGender("");
      setFilterSchedule("");
      setFilterFieldWorker("all");
      return;
    }
    if (activeTab === "profile" || activeTab === "vacations") {
      setFilterExamElectrical("all");
      setFilterPassHas("all");
      setExpiredOnly(false);
      setExpiringDays("");
      setExamValidFrom("");
      setExamValidTo("");
      setPassValidFrom("");
      setPassValidTo("");
    }
  }, [activeTab]);

  const rowsQuery = useQuery({
    queryKey: ["employee-directory", filters],
    queryFn: () => listEmployeeDirectory(filters),
    enabled: !!user && hasPermission(user, PERM.EMPLOYEE_DIRECTORY_READ),
  });
  const systemsQuery = useQuery({ queryKey: ["systems", "all-for-directory"], queryFn: () => listSystems(false) });
  const positionsQuery = useQuery({ queryKey: ["positions", "all-for-directory"], queryFn: () => listPositions(false) });
  useToastQueryError(rowsQuery.error, "Ошибка загрузки справочника сотрудников");

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
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: ["employee-directory"] });
      await qc.invalidateQueries({ queryKey: ["schedule", "month"] });
      if (vars.body.is_dismissed && filterEmployment === "working") {
        toastSuccess("Сотрудник перенесён в архив уволенных. Откройте фильтр «Уволенные», чтобы увидеть карточку.");
      } else {
        toastSuccess("Кадровые данные сохранены");
      }
      setEditingProfile(null);
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить"),
  });

  const closeComplianceModal = useCallback(() => setEditingCompliance(null), []);
  const closeProfileModal = useCallback(() => setEditingProfile(null), []);

  const { backdropProps: compModalBackdrop, stopPanelPointer: compModalPanelStop } = useModalLayer(
    !!editingCompliance && canComplianceEdit,
    closeComplianceModal,
    {
      closeOnBackdrop: !saveComplianceMut.isPending,
      closeOnEscape: !saveComplianceMut.isPending,
    },
  );
  const { backdropProps: profModalBackdrop, stopPanelPointer: profModalPanelStop } = useModalLayer(
    !!editingProfile && canProfileEdit,
    closeProfileModal,
    {
      closeOnBackdrop: !saveProfileMut.isPending,
      closeOnEscape: !saveProfileMut.isPending,
    },
  );

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

  function clearAllFilters() {
    setSearch("");
    setFilterSystemIds([]);
    setFilterPositionIds([]);
    setExpiredOnly(false);
    setExpiringDays("");
    setFilterGender("");
    setFilterSchedule("");
    setFilterRemote("all");
    setFilterFieldWorker("all");
    setFilterExamElectrical("all");
    setFilterPassHas("all");
    setExamValidFrom("");
    setExamValidTo("");
    setPassValidFrom("");
    setPassValidTo("");
    setFilterEmployment("working");
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
    if (bulkApplyRemote) patch.is_remote = bulkRemote;
    if (bulkApplyFieldWorker) patch.is_field_worker = bulkFieldWorker;
    if (bulkApplyWorkAddress) patch.work_address = bulkWorkAddress.trim() || null;
    if (bulkApplyPositionDate) patch.position_assigned_at = bulkPositionAssignedAt || null;
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
    if (patch.work_schedule_kind) {
      const sk =
        patch.work_schedule_kind === "shift"
          ? "Сменный"
          : patch.work_schedule_kind === "two_two"
            ? "2/2"
            : "5/2";
      lines.push(`график: ${sk}`);
    }
    if (patch.gender !== undefined)
      lines.push(
        `пол: ${patch.gender === "female" ? "женский" : patch.gender === "male" ? "мужской" : "не указан"}`,
      );
    if (patch.position_id === null) lines.push("должность: сбросить");
    if (patch.position_id && patch.position_id.length) lines.push("должность: назначить из списка");
    if (patch.system_ids) lines.push(`системы: заменить на ${patch.system_ids.length} шт.`);
    if (patch.is_remote !== undefined) lines.push(`удалёнщик: ${patch.is_remote ? "да" : "нет"}`);
    if (patch.is_field_worker !== undefined) lines.push(`выездной: ${patch.is_field_worker ? "да" : "нет"}`);
    if (patch.work_address !== undefined) lines.push(`адрес работы: ${patch.work_address?.trim() || "очистить"}`);
    if (patch.position_assigned_at !== undefined) {
      lines.push(`дата должности: ${patch.position_assigned_at || "очистить"}`);
    }
    const ok = window.confirm(
      `Применить к ${rows.length} сотрудникам (текущая таблица с учётом фильтров)?\n\n${lines.join("\n")}`,
    );
    if (!ok) return;
    bulkProfileMut.mutate({ user_ids: rows.map((r) => r.id), patch });
  }

  const rows = rowsQuery.data ?? [];
  const displayRows = useMemo(() => {
    const list = activeTab === "compliance" ? rows.filter((r) => !r.is_remote) : rows;
    return [...list].sort((a, b) => compareDirectoryRows(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir, activeTab]);
  const reportSummary = useMemo(() => summarizeComplianceRows(displayRows), [displayRows]);

  useEffect(() => {
    if (!TAB_SORT_KEYS[activeTab].includes(sortKey)) {
      setSortKey("name");
      setSortDir("asc");
    }
  }, [activeTab, sortKey]);

  function toggleSort(column: SortKey) {
    if (sortKey === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(column);
    setSortDir("asc");
  }

  const sortTh = (column: SortKey, label: string) => (
    <DirectorySortHeader
      column={column}
      label={label}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={toggleSort}
    />
  );

  function openComplianceEdit(row: EmployeeDirectoryRowOut) {
    setEditingCompliance(row);
    setComplianceForm({
      exam_electrical_passed: row.exam_electrical_passed,
      exam_electrical_date: asInputDate(row.exam_electrical_date),
      exam_electrical_valid_to: asInputDate(row.exam_electrical_valid_to),
      exam_electrical_group: row.exam_electrical_group ?? "",
      exam_electrical_certificate_number: row.exam_electrical_certificate_number ?? "",
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
        kind: p.kind ?? "vacation",
      })),
      work_schedule_kind: row.work_schedule_kind ?? "five_two",
      gender: row.gender ?? "unspecified",
      is_remote: row.is_remote ?? false,
      work_address: row.work_address ?? "",
      is_field_worker: row.is_field_worker ?? false,
      position_assigned_at: asInputDate(row.position_assigned_at),
      personnel_number: row.personnel_number ?? "",
      is_dismissed: row.is_dismissed ?? false,
      dismissed_at: asInputDate(row.dismissed_at),
    });
  }

  function setTab(tab: TabId) {
    if (tab === "compliance") setSearchParams({});
    else setSearchParams({ tab });
  }

  const noReadAccess =
    user && !hasPermission(user, PERM.EMPLOYEE_DIRECTORY_READ) && (canComplianceEdit || canProfileEdit);

  const tabBtn = (tab: TabId, label: string) => (
    <button
      type="button"
      onClick={() => setTab(tab)}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
        activeTab === tab
          ? "bg-sky-500 text-white shadow-sm"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <AppShell
      title="Сотрудники"
      subtitle="Экзамены и пропуска, справочник, отпуска и отчётность по срокам. Права на редактирование задаются в роли."
    >
      <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
        {tabBtn("compliance", "Экзамены и пропуска")}
        {showProfileTab && tabBtn("profile", "Справочник сотрудника")}
        {tabBtn("vacations", "Отпуска")}
        {tabBtn("report", "Отчётность")}
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
                placeholder="Поиск: ФИО, email или табельный №"
                className="min-w-[10rem] max-w-sm flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
              <label className="flex shrink-0 flex-col gap-0.5">
                <span className="sr-only">Состав списка</span>
                <select
                  value={filterEmployment}
                  onChange={(e) => setFilterEmployment(e.target.value as EmploymentFilter)}
                  className="h-[2.375rem] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  title="Уволенные скрыты, пока не выберете архив"
                >
                  <option value="working">Работающие</option>
                  <option value="dismissed">Уволенные</option>
                  <option value="all">Все</option>
                </select>
              </label>
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
              {(activeFilterCount > 0 || search.trim()) && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Сбросить фильтры
                </button>
              )}
            </div>
            {filtersPanelOpen && (
              <div className="mt-3 border-t border-slate-200/80 pt-3 dark:border-slate-700/80">
                <p className="mb-2 max-w-xl text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                  Системы и должности: без выбора — все; несколько отмеченных — подходит сотрудник с{" "}
                  <span className="font-medium text-slate-600 dark:text-slate-300">любой</span> из них.
                  {" "}
                  На «Справочник сотрудника»: пол, график, удалёнщик, выездной. На «Отпуска» даты фильтруются в самой
                  вкладке. Экзамен, пропуск и сроки — на «Экзамены и пропуска» и «Отчётность». Удалёнщики на вкладке
                  экзаменов не показываются. Уволенные в обычном списке скрыты — откройте «Уволенные» или «Все».
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

                {(activeTab === "compliance" || activeTab === "report") && (
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
                    {activeTab === "report" && (
                      <>
                        <label className="flex w-[9.5rem] max-w-full shrink-0 flex-col gap-0.5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            ЭБ до с
                          </span>
                          <input
                            type="date"
                            value={examValidFrom}
                            onChange={(e) => setExamValidFrom(e.target.value)}
                            className={dateFilterInput}
                          />
                        </label>
                        <label className="flex w-[9.5rem] max-w-full shrink-0 flex-col gap-0.5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            ЭБ до по
                          </span>
                          <input
                            type="date"
                            value={examValidTo}
                            onChange={(e) => setExamValidTo(e.target.value)}
                            className={dateFilterInput}
                          />
                        </label>
                        <label className="flex w-[9.5rem] max-w-full shrink-0 flex-col gap-0.5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Пропуск до с
                          </span>
                          <input
                            type="date"
                            value={passValidFrom}
                            onChange={(e) => setPassValidFrom(e.target.value)}
                            className={dateFilterInput}
                          />
                        </label>
                        <label className="flex w-[9.5rem] max-w-full shrink-0 flex-col gap-0.5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Пропуск до по
                          </span>
                          <input
                            type="date"
                            value={passValidTo}
                            onChange={(e) => setPassValidTo(e.target.value)}
                            className={dateFilterInput}
                          />
                        </label>
                      </>
                    )}
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
                        <option value="shift">Сменный</option>
                        <option value="two_two">2/2</option>
                      </select>
                    </label>
                    <label className="flex w-[7.5rem] max-w-full shrink-0 flex-col gap-0.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Удалёнщик
                      </span>
                      <select
                        value={filterRemote}
                        onChange={(e) => setFilterRemote(e.target.value as YesNoFilter)}
                        className={filterBarSelect}
                      >
                        <option value="all">Все</option>
                        <option value="yes">Да</option>
                        <option value="no">Нет</option>
                      </select>
                    </label>
                    <label className="flex w-[7.5rem] max-w-full shrink-0 flex-col gap-0.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Выездной
                      </span>
                      <select
                        value={filterFieldWorker}
                        onChange={(e) => setFilterFieldWorker(e.target.value as YesNoFilter)}
                        className={filterBarSelect}
                      >
                        <option value="all">Все</option>
                        <option value="yes">Да</option>
                        <option value="no">Нет</option>
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
                    По текущему списку: {rows.length} чел. (учитываются фильтры выше). Можно менять график, пол,
                    должность, системы, удалёнщика, выездного, адрес и дату должности.
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
                        <option value="shift">Сменный</option>
                        <option value="two_two">2/2</option>
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
                        Пол
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
                    <label className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600 dark:bg-slate-800/80">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                        <input
                          type="checkbox"
                          checked={bulkApplyRemote}
                          onChange={(e) => setBulkApplyRemote(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        Удалёнщик
                      </span>
                      <select
                        value={bulkRemote ? "yes" : "no"}
                        onChange={(e) => setBulkRemote(e.target.value === "yes")}
                        disabled={!bulkApplyRemote}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="yes">Да</option>
                        <option value="no">Нет</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600 dark:bg-slate-800/80">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                        <input
                          type="checkbox"
                          checked={bulkApplyFieldWorker}
                          onChange={(e) => setBulkApplyFieldWorker(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        Выездной
                      </span>
                      <select
                        value={bulkFieldWorker ? "yes" : "no"}
                        onChange={(e) => setBulkFieldWorker(e.target.value === "yes")}
                        disabled={!bulkApplyFieldWorker}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                      >
                        <option value="yes">Да</option>
                        <option value="no">Нет</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600 dark:bg-slate-800/80">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                        <input
                          type="checkbox"
                          checked={bulkApplyWorkAddress}
                          onChange={(e) => setBulkApplyWorkAddress(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        Адрес работы
                      </span>
                      <input
                        value={bulkWorkAddress}
                        onChange={(e) => setBulkWorkAddress(e.target.value)}
                        disabled={!bulkApplyWorkAddress}
                        placeholder="Пусто — очистить адрес"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                      />
                    </label>
                    <label className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-white/90 p-3 dark:border-slate-600 dark:bg-slate-800/80">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                        <input
                          type="checkbox"
                          checked={bulkApplyPositionDate}
                          onChange={(e) => setBulkApplyPositionDate(e.target.checked)}
                          className="rounded border-slate-300"
                        />
                        Дата должности
                      </span>
                      <input
                        type="date"
                        value={bulkPositionAssignedAt}
                        onChange={(e) => setBulkPositionAssignedAt(e.target.value)}
                        disabled={!bulkApplyPositionDate}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
                      />
                      <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                        Пустая дата — сбросить поле.
                      </span>
                    </label>
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
                  } else if (activeTab === "report") {
                    const { downloadEmployeeDirectoryReportExcel } = await import("../lib/exportEmployeeDirectoryExcel");
                    await downloadEmployeeDirectoryReportExcel(displayRows);
                  } else if (activeTab === "vacations") {
                    const { downloadEmployeeDirectoryVacationsExcel } = await import("../lib/exportEmployeeDirectoryExcel");
                    await downloadEmployeeDirectoryVacationsExcel(displayRows);
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

          {activeTab === "compliance" && (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/70">
                  <tr>
                    {sortTh("name", "Сотрудник")}
                    {sortTh("position", "Должность")}
                    {sortTh("systems", "Системы")}
                    {sortTh("exam", "Эл.безопасность")}
                    {sortTh("pass", "Пропуск")}
                    {sortTh("notes", "Примечание")}
                    {canComplianceEdit && <th className="px-3 py-2">Действия</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {displayRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <DirectoryNameCell row={r} />
                      </td>
                      <td className="px-3 py-2">{r.position?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.systems.map((s) => s.name).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {examElectricalPassedLabel(r)}
                        {r.exam_electrical_group ? ` · гр. ${r.exam_electrical_group}` : ""}
                        {r.exam_electrical_certificate_number?.trim()
                          ? ` · № ${r.exam_electrical_certificate_number.trim()}`
                          : ""}
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
                  {!rowsQuery.isPending && displayRows.length === 0 && (
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

          {activeTab === "report" && (
            <>
              <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                {[
                  { label: "Всего", value: reportSummary.total, tone: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
                  { label: "ЭБ просрочен", value: reportSummary.examExpired, tone: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" },
                  { label: "ЭБ ≤3 дн.", value: reportSummary.examExpiring3, tone: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
                  { label: "ЭБ нет/без даты", value: reportSummary.examNone, tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
                  { label: "ЭБ не требуется", value: reportSummary.examNotRequired, tone: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200" },
                  { label: "Пропуск просрочен", value: reportSummary.passExpired, tone: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" },
                  { label: "Пропуск ≤3 дн.", value: reportSummary.passExpiring3, tone: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
                  { label: "Пропуск нет/без даты", value: reportSummary.passNone, tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
                ].map((card) => (
                  <div
                    key={card.label}
                    className={`rounded-2xl border border-slate-200/70 px-3 py-3 shadow-soft dark:border-slate-700 ${card.tone}`}
                  >
                    <p className="text-[10px] font-medium uppercase tracking-wide opacity-80">{card.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/70">
                    <tr>
                      {sortTh("name", "Сотрудник")}
                      {sortTh("position", "Должность")}
                      {sortTh("systems", "Системы")}
                      {sortTh("exam", "Экзамен ЭБ")}
                      {sortTh("examStatus", "Статус ЭБ")}
                      {sortTh("pass", "Пропуск")}
                      {sortTh("passStatus", "Статус пропуска")}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {displayRows.map((r) => {
                      const exam = examElectricalValidityInfo(r);
                      const pass = validityInfo(r.pass_valid_to, r.pass_has);
                      return (
                        <tr key={r.id}>
                          <td className="px-3 py-2">
                            <DirectoryNameCell row={r} />
                          </td>
                          <td className="px-3 py-2">{r.position?.name ?? "—"}</td>
                          <td className="px-3 py-2 text-xs">{r.systems.map((s) => s.name).join(", ") || "—"}</td>
                          <td className="px-3 py-2 text-xs">
                            {r.is_remote ? (
                              <span className="text-sky-800 dark:text-sky-300">{EXAM_NOT_REQUIRED_LABEL}</span>
                            ) : (
                              <>
                                {examElectricalPassedLabel(r)}
                                {r.exam_electrical_group ? ` · гр. ${r.exam_electrical_group}` : ""}
                                {r.exam_electrical_certificate_number?.trim()
                                  ? ` · № ${r.exam_electrical_certificate_number.trim()}`
                                  : ""}
                                <br />
                                до: {r.exam_electrical_valid_to ? asInputDate(r.exam_electrical_valid_to) : "—"}
                              </>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(exam.status)}`}>
                              {exam.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {r.pass_has ? `Есть (${r.pass_number ?? "без №"})` : "Нет"}
                            <br />
                            до: {r.pass_valid_to ? asInputDate(r.pass_valid_to) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(pass.status)}`}>
                              {pass.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {!rowsQuery.isPending && rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">
                          По выбранным фильтрам данных нет.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeTab === "profile" && showProfileTab && (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
              <table className="w-full min-w-[1280px] text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/70">
                  <tr>
                    {sortTh("name", "Сотрудник")}
                    {sortTh("personnelNumber", "Табельный №")}
                    {sortTh("birthDate", "Дата рождения")}
                    {sortTh("position", "Должность")}
                    {sortTh("positionAssignedAt", "Дата должности")}
                    {sortTh("systems", "Системы")}
                    {sortTh("gender", "Пол")}
                    {sortTh("schedule", "График (авто)")}
                    {sortTh("remote", "Удалёнщик")}
                    {sortTh("workAddress", "Адрес работы")}
                    {sortTh("fieldWorker", "Выездной")}
                    {sortTh("vacation", "Отпуск / больничный")}
                    {canProfileEdit && <th className="px-3 py-2">Действия</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {displayRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <DirectoryNameCell row={r} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.personnel_number?.trim() || "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.birth_date ? asInputDate(r.birth_date) : "—"}</td>
                      <td className="px-3 py-2">{r.position?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.position_assigned_at ? asInputDate(r.position_assigned_at) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.systems.map((s) => s.name).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-xs">{formatGenderCell(r.gender)}</td>
                      <td className="px-3 py-2 text-xs">{formatScheduleSummary(r)}</td>
                      <td className="px-3 py-2 text-xs">{r.is_remote ? "Да" : "Нет"}</td>
                      <td className="max-w-[18rem] px-3 py-2 text-xs">
                        <span className="line-clamp-2" title={r.work_address ?? ""}>
                          {r.work_address?.trim() || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.is_field_worker ? "Да" : "Нет"}</td>
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
                      <td colSpan={canProfileEdit ? 13 : 12} className="px-3 py-6 text-center text-sm text-slate-500">
                        По выбранным фильтрам данных нет.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "vacations" && <EmployeeVacationsPanel rows={displayRows} />}
        </>
      )}

      {editingCompliance && canComplianceEdit && (
        <div
          {...compModalBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div
            className="modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-soft-lg"
            role="dialog"
            aria-modal="true"
            onClick={compModalPanelStop}
          >
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{editingCompliance.full_name}</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Раздел контроля: экзамен по электробезопасности и пропуск. График и отпуск — во вкладке «Кадровый
              справочник».
            </p>
            {editingCompliance.is_remote && (
              <p className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100">
                {EXAM_NOT_REQUIRED_LABEL}. Поля экзамена скрыты. Если экзамен всё же нужен — снимите признак
                «Удалёнщик» в кадровом справочнике.
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const examNotRequired = !!editingCompliance.is_remote;
                saveComplianceMut.mutate({
                  id: editingCompliance.id,
                  body: {
                    ...(examNotRequired
                      ? {}
                      : {
                          exam_electrical_passed: complianceForm.exam_electrical_passed,
                          exam_electrical_date: complianceForm.exam_electrical_date || null,
                          exam_electrical_valid_to: complianceForm.exam_electrical_valid_to || null,
                          exam_electrical_group: complianceForm.exam_electrical_group || null,
                          exam_electrical_certificate_number:
                            complianceForm.exam_electrical_certificate_number.trim() || null,
                        }),
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
              {!editingCompliance.is_remote && (
                <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={complianceForm.exam_electrical_passed}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, exam_electrical_passed: e.target.checked }))}
                />
                Экзамен по электробезопасности сдан
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Группа по электробезопасности</span>
                <select
                  value={complianceForm.exam_electrical_group}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, exam_electrical_group: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                >
                  <option value="">Не указана</option>
                  <option value="I">I группа</option>
                  <option value="II">II группа</option>
                  <option value="III">III группа</option>
                  <option value="IV">IV группа</option>
                  <option value="V">V группа</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Номер удостоверения</span>
                <input
                  value={complianceForm.exam_electrical_certificate_number}
                  onChange={(e) =>
                    setComplianceForm((p) => ({ ...p, exam_electrical_certificate_number: e.target.value }))
                  }
                  placeholder="№ удостоверения"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Дата сдачи</span>
                <span>Действителен до</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={complianceForm.exam_electrical_date}
                  onChange={(e) => {
                    const exam_electrical_date = e.target.value;
                    setComplianceForm((p) => ({
                      ...p,
                      exam_electrical_date,
                      exam_electrical_valid_to: exam_electrical_date
                        ? addOneYearDateInput(exam_electrical_date)
                        : "",
                    }));
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <input
                  type="date"
                  value={complianceForm.exam_electrical_valid_to}
                  onChange={(e) => setComplianceForm((p) => ({ ...p, exam_electrical_valid_to: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
                </>
              )}
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
                  onClick={closeComplianceModal}
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
        <div
          {...profModalBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div
            className="modal-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6 shadow-soft-lg"
            role="dialog"
            aria-modal="true"
            onClick={profModalPanelStop}
          >
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{editingProfile.full_name}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (profileForm.is_dismissed && !profileForm.dismissed_at) {
                  toastError("Укажите дату увольнения");
                  return;
                }
                const vacation_periods = profileForm.vacation_periods
                  .filter((p) => p.start.trim() && p.end.trim())
                  .map((p) => ({
                    start: p.start.trim().slice(0, 10),
                    end: p.end.trim().slice(0, 10),
                    kind: p.kind ?? "vacation",
                  }));
                saveProfileMut.mutate({
                  id: editingProfile.id,
                  body: {
                    birth_date: profileForm.birth_date || null,
                    position_id: profileForm.position_id || null,
                    system_ids: [...profileForm.system_ids],
                    vacation_periods,
                    work_schedule_kind: profileForm.work_schedule_kind,
                    gender: profileForm.gender,
                    is_remote: profileForm.is_remote,
                    work_address: profileForm.work_address.trim() || null,
                    is_field_worker: profileForm.is_field_worker,
                    position_assigned_at: profileForm.position_assigned_at || null,
                    personnel_number: profileForm.personnel_number.trim() || null,
                    is_dismissed: profileForm.is_dismissed,
                    dismissed_at: profileForm.is_dismissed ? profileForm.dismissed_at || null : null,
                  },
                });
              }}
              className="space-y-3"
            >
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Табельный номер
                <input
                  type="text"
                  maxLength={64}
                  value={profileForm.personnel_number}
                  onChange={(e) => setProfileForm((p) => ({ ...p, personnel_number: e.target.value }))}
                  placeholder="Например: 00123"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
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
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Дата должности
                <input
                  type="date"
                  value={profileForm.position_assigned_at}
                  onChange={(e) => setProfileForm((p) => ({ ...p, position_assigned_at: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <span className="mt-1 block text-[11px] text-slate-400">Когда сотрудник получил текущую должность</span>
              </label>
              <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 sm:grid-cols-2 dark:border-slate-600 dark:bg-slate-800/40">
                <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={profileForm.is_remote}
                    onChange={(e) => setProfileForm((p) => ({ ...p, is_remote: e.target.checked }))}
                  />
                  Удалёнщик
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={profileForm.is_field_worker}
                    onChange={(e) => setProfileForm((p) => ({ ...p, is_field_worker: e.target.checked }))}
                  />
                  Выездной
                </label>
                <label className="block text-xs text-slate-500 sm:col-span-2 dark:text-slate-400">
                  Адрес работы
                  <input
                    type="text"
                    maxLength={512}
                    value={profileForm.work_address}
                    onChange={(e) => setProfileForm((p) => ({ ...p, work_address: e.target.value }))}
                    placeholder="Например: г. Москва, ул. Примерная, 1"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </label>
              </div>
              <div className="grid gap-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-800/40">
                <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={profileForm.is_dismissed}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setProfileForm((p) => ({
                        ...p,
                        is_dismissed: checked,
                        dismissed_at: checked ? p.dismissed_at || todayLocalDate() : "",
                      }));
                    }}
                  />
                  Уволен
                </label>
                {profileForm.is_dismissed ? (
                  <label className="block text-xs text-slate-500 dark:text-slate-400">
                    Дата увольнения
                    <input
                      type="date"
                      required
                      value={profileForm.dismissed_at}
                      onChange={(e) => setProfileForm((p) => ({ ...p, dismissed_at: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    />
                  </label>
                ) : null}
                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  Уволенный скрывается из обычного списка справочника и не попадает в график и назначения.
                  Учётная запись при этом не блокируется — при необходимости отключите её в админке.
                </p>
              </div>
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
                    <option value="shift">Сменный</option>
                    <option value="two_two">2/2</option>
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
                <div className="rounded-lg border border-slate-200/60 bg-white/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:border-slate-600/60 dark:bg-slate-900/40 dark:text-slate-400">
                  <p>Эти поля используются кнопкой «Автозаполнение» на странице «График».</p>
                  <ul className="mt-2 list-inside list-disc space-y-1">
                    <li>
                      <strong>5/2</strong> — в будни без праздника: женский пол — <span className="font-mono">7.2</span>,
                      мужской или не указан — <span className="font-mono">8</span>; сб, вс и праздники РФ — пустые ячейки
                    </li>
                    <li>
                      <strong>Сменный</strong> — цикл 11-3-8; выходные по смене — пусто, дни отпуска —{" "}
                      <span className="font-mono">о</span>
                    </li>
                    <li>
                      <strong>2/2</strong> — чередование <span className="font-mono">11д</span> / <span className="font-mono">11в</span> и
                      пустых дней
                    </li>
                  </ul>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-800/40">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Отпуск и больничный для графика</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Укажите периоды — при автозаполнении в графике подставятся коды: отпуск —{" "}
                  <span className="font-mono">о</span>, учебный отпуск — <span className="font-mono">у</span>, больничный —{" "}
                  <span className="font-mono">б</span>. Можно добавить несколько интервалов.
                </p>
                <ul className="mt-3 space-y-2">
                  {profileForm.vacation_periods.map((period, idx) => (
                    <li key={idx} className="flex flex-wrap items-center gap-2">
                      <select
                        value={period.kind ?? "vacation"}
                        onChange={(e) =>
                          setProfileForm((p) => ({
                            ...p,
                            vacation_periods: p.vacation_periods.map((x, i) =>
                              i === idx
                                ? { ...x, kind: e.target.value as "vacation" | "study" | "sick" }
                                : x,
                            ),
                          }))
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                      >
                        <option value="vacation">Отпуск (о)</option>
                        <option value="study">Учебный отпуск (у)</option>
                        <option value="sick">Больничный (б)</option>
                      </select>
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
                      vacation_periods: [...p.vacation_periods, { start: "", end: "", kind: "vacation" }],
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
                  onClick={closeProfileModal}
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
