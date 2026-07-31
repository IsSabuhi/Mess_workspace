import type { TaskOut, TaskPriority } from "../api/tasks";
import { taskInDoneColumn, taskIsActiveForDashboard, taskIsOverdueForDashboard } from "./taskStatus";

export type DueStatusFilter = "overdue" | "due_soon" | "no_due" | "on_track";

/** Срез по доске: основная, все, или конкретная кастомная (`board` + customBoardId). */
export type BoardAnalyticsScope = "main" | "all" | "board";

export type TaskAnalyticsFilters = {
  boardScope: BoardAnalyticsScope;
  /** Id кастомной доски при boardScope === "board" */
  customBoardId: string | null;
  systemIds: string[];
  columnIds: string[];
  assigneeIds: string[];
  priorities: TaskPriority[];
  dueStatuses: DueStatusFilter[];
  tagIds: string[];
  includeArchived: boolean;
  dueFrom: string;
  dueTo: string;
  query: string;
  onlyUnassigned: boolean;
};

export const DEFAULT_TASK_ANALYTICS_FILTERS: TaskAnalyticsFilters = {
  boardScope: "main",
  customBoardId: null,
  systemIds: [],
  columnIds: [],
  assigneeIds: [],
  priorities: [],
  dueStatuses: [],
  tagIds: [],
  includeArchived: false,
  dueFrom: "",
  dueTo: "",
  query: "",
  onlyUnassigned: false,
};

type BoardScopeRef = { id: string; scope: "global" | "system"; is_default: boolean };

export function filterTasksByBoardScope(
  tasks: TaskOut[],
  scope: BoardAnalyticsScope,
  boards: BoardScopeRef[],
  customBoardId: string | null = null,
): TaskOut[] {
  if (scope === "all") return tasks;
  if (scope === "board") {
    if (!customBoardId) return [];
    return tasks.filter((t) => t.board_id === customBoardId);
  }
  const mainIds = new Set(
    boards.filter((b) => b.is_default || b.scope === "global").map((b) => b.id),
  );
  return tasks.filter((t) => mainIds.has(t.board_id));
}

type TaskKpiSummary = {
  total: number;
  active: number;
  overdue: number;
  dueSoon: number;
  unassigned: number;
  highPriority: number;
};

export type TaskKpiTotals = TaskKpiSummary & { archived: number };

export type TaskGroupedStat = {
  id: string;
  name: string;
  total: number;
  active: number;
  overdue: number;
};

export type OverdueTaskRow = {
  id: string;
  title: string;
  systemName: string;
  assigneesLabel: string;
  dueAt: string;
  priority: TaskPriority;
  columnName: string;
  overdueHours: number;
};

export function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dueSoonBoundary(days: number): number {
  const n = new Date();
  n.setDate(n.getDate() + days);
  return n.getTime();
}

function includesQuery(t: TaskOut, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const assignees = (t.assignees ?? []).map((a) => a.full_name.toLowerCase()).join(" ");
  const tags = (t.tags ?? []).map((x) => x.name.toLowerCase()).join(" ");
  const hay = `${t.title} ${t.description ?? ""} ${t.system?.name ?? ""} ${t.column?.name ?? ""} ${assignees} ${tags}`.toLowerCase();
  return hay.includes(needle);
}

export function taskDueStatus(t: TaskOut, nowTs = Date.now()): DueStatusFilter {
  if (!t.due_at) return "no_due";
  const due = new Date(t.due_at).getTime();
  if (!Number.isFinite(due)) return "no_due";
  if (taskIsOverdueForDashboard(t)) return "overdue";
  if (due <= dueSoonBoundary(3) && due >= nowTs) return "due_soon";
  return "on_track";
}

export function filterTasksForAnalytics(tasks: TaskOut[], filters: TaskAnalyticsFilters): TaskOut[] {
  const nowTs = Date.now();
  const dueFromTs = filters.dueFrom ? new Date(`${filters.dueFrom}T00:00:00`).getTime() : null;
  const dueToTs = filters.dueTo ? new Date(`${filters.dueTo}T23:59:59`).getTime() : null;

  return tasks.filter((t) => {
    if (!filters.includeArchived && t.archived_at) return false;
    if (filters.systemIds.length > 0) {
      const key = t.system_id || "__none__";
      if (!filters.systemIds.includes(key)) return false;
    }
    if (filters.columnIds.length > 0 && !filters.columnIds.includes(t.column_id)) return false;
    if (filters.assigneeIds.length > 0) {
      const ids = (t.assignees ?? []).map((a) => a.id);
      if (!filters.assigneeIds.some((id) => ids.includes(id))) return false;
    }
    if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
    if (filters.onlyUnassigned && (t.assignees ?? []).length > 0) return false;
    if (filters.tagIds.length > 0) {
      const taskTagIds = new Set((t.tags ?? []).map((x) => x.id));
      if (!filters.tagIds.some((id) => taskTagIds.has(id))) return false;
    }
    if (!includesQuery(t, filters.query)) return false;

    if (dueFromTs != null || dueToTs != null) {
      if (!t.due_at) return false;
      const due = new Date(t.due_at).getTime();
      if (!Number.isFinite(due)) return false;
      if (dueFromTs != null && due < dueFromTs) return false;
      if (dueToTs != null && due > dueToTs) return false;
    }

    if (filters.dueStatuses.length > 0) {
      const status = taskDueStatus(t, nowTs);
      if (!filters.dueStatuses.includes(status)) return false;
    }
    return true;
  });
}

function initKpi(): TaskKpiSummary {
  return { total: 0, active: 0, overdue: 0, dueSoon: 0, unassigned: 0, highPriority: 0 };
}

export function computeTaskKpis(tasks: TaskOut[]): TaskKpiTotals {
  const kpi = initKpi();
  let archived = 0;
  for (const t of tasks) {
    if (t.archived_at) archived += 1;
    kpi.total += 1;
    if (taskIsActiveForDashboard(t)) kpi.active += 1;
    if (taskIsOverdueForDashboard(t)) kpi.overdue += 1;
    if (taskDueStatus(t) === "due_soon") kpi.dueSoon += 1;
    if ((t.assignees ?? []).length === 0) kpi.unassigned += 1;
    if (t.priority === "high" || t.priority === "urgent") kpi.highPriority += 1;
  }
  return { ...kpi, archived };
}

export function groupTasksBySystem(tasks: TaskOut[]): TaskGroupedStat[] {
  const map = new Map<string, TaskGroupedStat>();
  for (const t of tasks) {
    const id = t.system?.id ?? "__none__";
    const name = t.system?.name ?? "Без системы";
    if (!map.has(id)) map.set(id, { id, name, total: 0, active: 0, overdue: 0 });
    const row = map.get(id)!;
    row.total += 1;
    if (taskIsActiveForDashboard(t)) row.active += 1;
    if (taskIsOverdueForDashboard(t)) row.overdue += 1;
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

export function groupTasksByColumn(tasks: TaskOut[]): TaskGroupedStat[] {
  const map = new Map<string, TaskGroupedStat>();
  for (const t of tasks) {
    const id = t.column?.id ?? "__none__";
    const name = t.column?.name ?? "Без колонки";
    if (!map.has(id)) map.set(id, { id, name, total: 0, active: 0, overdue: 0 });
    const row = map.get(id)!;
    row.total += 1;
    if (taskIsActiveForDashboard(t)) row.active += 1;
    if (taskIsOverdueForDashboard(t)) row.overdue += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.overdue - a.overdue);
}

export function groupTasksByAssignee(tasks: TaskOut[]): TaskGroupedStat[] {
  const map = new Map<string, TaskGroupedStat>();
  for (const t of tasks) {
    const assignees = t.assignees ?? [];
    if (assignees.length === 0) {
      if (!map.has("__none__")) {
        map.set("__none__", { id: "__none__", name: "Не назначен", total: 0, active: 0, overdue: 0 });
      }
      const row = map.get("__none__")!;
      row.total += 1;
      if (taskIsActiveForDashboard(t)) row.active += 1;
      if (taskIsOverdueForDashboard(t)) row.overdue += 1;
      continue;
    }
    for (const a of assignees) {
      if (!map.has(a.id)) map.set(a.id, { id: a.id, name: a.full_name, total: 0, active: 0, overdue: 0 });
      const row = map.get(a.id)!;
      row.total += 1;
      if (taskIsActiveForDashboard(t)) row.active += 1;
      if (taskIsOverdueForDashboard(t)) row.overdue += 1;
    }
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

export function overdueTaskRows(tasks: TaskOut[]): OverdueTaskRow[] {
  const nowTs = Date.now();
  return tasks
    .filter((t) => taskIsOverdueForDashboard(t))
    .map((t) => {
      const dueTs = t.due_at ? new Date(t.due_at).getTime() : nowTs;
      const overdueHours = Math.max(0, Math.floor((nowTs - dueTs) / (1000 * 60 * 60)));
      const assigneesLabel =
        (t.assignees ?? []).length > 0
          ? (t.assignees ?? []).map((a) => a.full_name).join(", ")
          : "Не назначен";
      return {
        id: t.id,
        title: t.title,
        systemName: t.system?.name ?? "Без системы",
        assigneesLabel,
        dueAt: t.due_at ?? "",
        priority: t.priority,
        columnName: t.column?.name ?? "—",
        overdueHours,
      };
    })
    .sort((a, b) => b.overdueHours - a.overdueHours || b.priority.localeCompare(a.priority));
}

export function tasksDueSoonRows(tasks: TaskOut[]): TaskOut[] {
  return tasks
    .filter((t) => taskDueStatus(t) === "due_soon")
    .sort((a, b) => {
      const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return da - db;
    });
}

export type ClosedPeriod = "week" | "month" | "year";

export type ClosedByAssigneeRow = {
  id: string;
  name: string;
  closed: number;
};

/** Момент «закрытия»: архив или попадание в колонку «Выполнено» (updated_at). */
export function taskClosedAtIso(t: TaskOut): string | null {
  if (t.archived_at) return t.archived_at;
  if (taskInDoneColumn(t)) return t.updated_at;
  return null;
}

function startOfWeekMondayLocal(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function closedPeriodBounds(period: ClosedPeriod, now = new Date()): { fromTs: number; toTs: number; label: string } {
  if (period === "week") {
    const from = startOfWeekMondayLocal(now);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const end = new Date(to);
    end.setDate(end.getDate() - 1);
    const fmt = (v: Date) =>
      v.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    return { fromTs: from.getTime(), toTs: to.getTime(), label: `${fmt(from)}–${fmt(end)}` };
  }
  if (period === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const label = from.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    return { fromTs: from.getTime(), toTs: to.getTime(), label };
  }
  const from = new Date(now.getFullYear(), 0, 1);
  const to = new Date(now.getFullYear() + 1, 0, 1);
  return { fromTs: from.getTime(), toTs: to.getTime(), label: String(now.getFullYear()) };
}

/** Сколько задач закрыл каждый исполнитель за период (задача с несколькими исполнителями учитывается у каждого). */
export function closedTasksByAssignee(tasks: TaskOut[], period: ClosedPeriod, now = new Date()): ClosedByAssigneeRow[] {
  const { fromTs, toTs } = closedPeriodBounds(period, now);
  const map = new Map<string, ClosedByAssigneeRow>();

  for (const t of tasks) {
    const closedIso = taskClosedAtIso(t);
    if (!closedIso) continue;
    const ts = new Date(closedIso).getTime();
    if (!Number.isFinite(ts) || ts < fromTs || ts >= toTs) continue;

    const assignees = t.assignees ?? [];
    if (assignees.length === 0) {
      if (!map.has("__none__")) {
        map.set("__none__", { id: "__none__", name: "Не назначен", closed: 0 });
      }
      map.get("__none__")!.closed += 1;
      continue;
    }
    for (const a of assignees) {
      if (!map.has(a.id)) map.set(a.id, { id: a.id, name: a.full_name, closed: 0 });
      map.get(a.id)!.closed += 1;
    }
  }

  return [...map.values()].sort((a, b) => b.closed - a.closed || a.name.localeCompare(b.name, "ru"));
}
