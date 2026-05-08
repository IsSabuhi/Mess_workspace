import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, FolderKanban } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

import { listTasks, type TaskOut, type TaskPriority } from "../api/tasks";
import { AppShell } from "../components/AppShell";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import {
  DEFAULT_TASK_ANALYTICS_FILTERS,
  computeTaskKpis,
  filterTasksForAnalytics,
  groupTasksByAssignee,
  groupTasksBySystem,
  overdueTaskRows,
  tasksDueSoonRows,
  type DueStatusFilter,
  type TaskAnalyticsFilters,
} from "../lib/taskAnalyticsFilters";
import { canViewManagerTeamDashboard } from "../lib/permissions";
import { taskHasAssignee } from "../lib/taskAssignees";
import { taskInDoneColumn, taskIsActiveForDashboard } from "../lib/taskStatus";

const ManagerSystemsChart = lazy(() => import("../components/charts/ManagerSystemsChart"));
const ManagerWorkloadChart = lazy(() => import("../components/charts/ManagerWorkloadChart"));
const ManagerCreatedClosedChart = lazy(() => import("../components/charts/ManagerCreatedClosedChart"));

type AnalyticsTab = "summary" | "overdue" | "workload" | "risk";
type SystemTableSort = "overdue_desc" | "total_desc" | "name_asc";
type WeeklyFlowRow = { label: string; created: number; closed: number };
type AgingColumnRow = { id: string; name: string; total: number; b0_3: number; b4_7: number; b8_14: number; b15p: number };

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function weekLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (v: Date) =>
    v.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
    });
  return `${fmt(start)}–${fmt(end)}`;
}

function createdVsClosedWeekly(tasks: TaskOut[], weeks = 8): WeeklyFlowRow[] {
  const now = new Date();
  const currentWeek = startOfWeekMonday(now);
  const starts: Date[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const s = new Date(currentWeek);
    s.setDate(s.getDate() - i * 7);
    starts.push(s);
  }
  const buckets = starts.map((s) => ({
    startTs: s.getTime(),
    endTs: s.getTime() + 7 * 24 * 60 * 60 * 1000,
    label: weekLabel(s),
    created: 0,
    closed: 0,
  }));

  const bucketIndex = (iso: string | null | undefined): number => {
    if (!iso) return -1;
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return -1;
    return buckets.findIndex((b) => ts >= b.startTs && ts < b.endTs);
  };

  for (const t of tasks) {
    const createdIdx = bucketIndex(t.created_at);
    if (createdIdx >= 0) buckets[createdIdx]!.created += 1;

    const closedAt = t.archived_at ?? (taskInDoneColumn(t) ? t.updated_at : null);
    const closedIdx = bucketIndex(closedAt);
    if (closedIdx >= 0) buckets[closedIdx]!.closed += 1;
  }

  return buckets.map((b) => ({ label: b.label, created: b.created, closed: b.closed }));
}

function agingByColumn(tasks: TaskOut[]): AgingColumnRow[] {
  const nowTs = Date.now();
  const map = new Map<string, AgingColumnRow>();
  for (const t of tasks) {
    if (!taskIsActiveForDashboard(t)) continue;
    const id = t.column?.id ?? "__none__";
    const name = t.column?.name ?? "Без колонки";
    if (!map.has(id)) {
      map.set(id, { id, name, total: 0, b0_3: 0, b4_7: 0, b8_14: 0, b15p: 0 });
    }
    const row = map.get(id)!;
    row.total += 1;
    const createdTs = new Date(t.created_at).getTime();
    const days = Number.isFinite(createdTs) ? Math.floor((nowTs - createdTs) / (1000 * 60 * 60 * 24)) : 0;
    if (days <= 3) row.b0_3 += 1;
    else if (days <= 7) row.b4_7 += 1;
    else if (days <= 14) row.b8_14 += 1;
    else row.b15p += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.b15p - a.b15p || a.name.localeCompare(b.name, "ru"));
}

function ChartSkeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-100/90 dark:bg-slate-800/80 ${className}`} aria-hidden />;
}

function formatDue(iso: string | null): string {
  if (!iso) return "без срока";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function toggleInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function taskToCsv(rows: TaskOut[]): string {
  const escape = (v: string) => `"${v.replaceAll("\"", "\"\"")}"`;
  const lines = [
    ["Задача", "Система", "Колонка", "Приоритет", "Срок", "Исполнители"].map(escape).join(";"),
    ...rows.map((t) =>
      [
        t.title,
        t.system?.name ?? "Без системы",
        t.column?.name ?? "—",
        t.priority,
        t.due_at ?? "",
        (t.assignees ?? []).map((a) => a.full_name).join(", "),
      ]
        .map(escape)
        .join(";"),
    ),
  ];
  return lines.join("\n");
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ManagerTeamDashboardPage() {
  const { resolved: themeResolved } = useTheme();
  const chartDark = themeResolved === "dark";
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canAccess = !!user && canViewManagerTeamDashboard(user);

  const [tab, setTab] = useState<AnalyticsTab>("summary");
  const [filters, setFilters] = useState<TaskAnalyticsFilters>(DEFAULT_TASK_ANALYTICS_FILTERS);
  const [systemSearch, setSystemSearch] = useState("");
  const [systemSort, setSystemSort] = useState<SystemTableSort>("overdue_desc");

  const allTasksQuery = useQuery({
    queryKey: ["tasks", user?.id ?? "", "manager-analytics"],
    queryFn: () => listTasks({ include_archived: true }),
    enabled: canAccess,
  });

  const allTasks = allTasksQuery.data ?? [];
  const filtered = useMemo(() => filterTasksForAnalytics(allTasks, filters), [allTasks, filters]);
  const kpis = useMemo(() => computeTaskKpis(filtered), [filtered]);
  const bySystem = useMemo(() => groupTasksBySystem(filtered), [filtered]);
  const byAssignee = useMemo(() => groupTasksByAssignee(filtered), [filtered]);
  const overdueRows = useMemo(() => overdueTaskRows(filtered), [filtered]);
  const dueSoonRows = useMemo(() => tasksDueSoonRows(filtered), [filtered]);
  const topSystems = useMemo(() => bySystem.slice(0, 10), [bySystem]);
  const systemsChartRows = useMemo(() => {
    if (bySystem.length <= 10) return bySystem;
    const top = bySystem.slice(0, 10);
    const rest = bySystem.slice(10).reduce(
      (acc, row) => {
        acc.total += row.total;
        acc.active += row.active;
        acc.overdue += row.overdue;
        return acc;
      },
      { total: 0, active: 0, overdue: 0 },
    );
    return [
      ...top,
      {
        id: "__others__",
        name: `Прочие (${bySystem.length - 10})`,
        total: rest.total,
        active: rest.active,
        overdue: rest.overdue,
      },
    ];
  }, [bySystem]);
  const systemsTableRows = useMemo(() => {
    const q = systemSearch.trim().toLowerCase();
    const filteredRows = q ? bySystem.filter((r) => r.name.toLowerCase().includes(q)) : bySystem;
    const sorted = [...filteredRows];
    if (systemSort === "name_asc") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "ru"));
      return sorted;
    }
    if (systemSort === "total_desc") {
      sorted.sort((a, b) => b.total - a.total || b.overdue - a.overdue || a.name.localeCompare(b.name, "ru"));
      return sorted;
    }
    sorted.sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.name.localeCompare(b.name, "ru"));
    return sorted;
  }, [bySystem, systemSearch, systemSort]);
  const systemsWithOverdue = useMemo(() => bySystem.filter((r) => r.overdue > 0).length, [bySystem]);
  const assigneesWithOverdue = useMemo(() => byAssignee.filter((r) => r.overdue > 0).length, [byAssignee]);
  const weeklyFlowRows = useMemo(() => createdVsClosedWeekly(filtered, 8), [filtered]);
  const agingRows = useMemo(() => agingByColumn(filtered), [filtered]);

  const systemOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTasks) {
      const id = t.system?.id ?? "__none__";
      const name = t.system?.name ?? "Без системы";
      m.set(id, name);
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [allTasks]);

  const assigneeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTasks) for (const a of t.assignees ?? []) m.set(a.id, a.full_name);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [allTasks]);

  const columnOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTasks) if (t.column?.id) m.set(t.column.id, t.column.name);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [allTasks]);

  const tagOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTasks) for (const tg of t.tags ?? []) m.set(tg.id, `#${tg.name}`);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [allTasks]);

  const managerOwnTasks = useMemo(() => {
    return allTasks
      .filter((t) => taskIsActiveForDashboard(t) && user && taskHasAssignee(t, user.id))
      .slice()
      .sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return da - db;
      })
      .slice(0, 6);
  }, [allTasks, user]);

  if (state.status !== "authenticated" || !user) return null;
  if (!canViewManagerTeamDashboard(user)) return <Navigate to="/" replace />;

  return (
    <AppShell title="Аналитика задач" subtitle="Сводка по Kanban для руководителя" wide>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">
            <ChevronLeft className="h-4 w-4" />
            К обзору
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {(["summary", "overdue", "workload", "risk"] as AnalyticsTab[]).map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setTab(x)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  tab === x
                    ? "bg-sky-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {x === "summary" ? "Сводка" : x === "overdue" ? "Просрочки" : x === "workload" ? "Нагрузка" : "Риски сроков"}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <MultiSelectDropdown
              compact
              label="Системы"
              items={systemOptions}
              selectedIds={filters.systemIds}
              onToggle={(id) => setFilters((f) => ({ ...f, systemIds: toggleInList(f.systemIds, id) }))}
              onClear={() => setFilters((f) => ({ ...f, systemIds: [] }))}
            />
            <MultiSelectDropdown
              compact
              label="Колонки"
              items={columnOptions}
              selectedIds={filters.columnIds}
              onToggle={(id) => setFilters((f) => ({ ...f, columnIds: toggleInList(f.columnIds, id) }))}
              onClear={() => setFilters((f) => ({ ...f, columnIds: [] }))}
            />
            <MultiSelectDropdown
              compact
              label="Исполнители"
              items={assigneeOptions}
              selectedIds={filters.assigneeIds}
              onToggle={(id) => setFilters((f) => ({ ...f, assigneeIds: toggleInList(f.assigneeIds, id) }))}
              onClear={() => setFilters((f) => ({ ...f, assigneeIds: [] }))}
            />
            <MultiSelectDropdown
              compact
              label="Теги"
              items={tagOptions}
              selectedIds={filters.tagIds}
              onToggle={(id) => setFilters((f) => ({ ...f, tagIds: toggleInList(f.tagIds, id) }))}
              onClear={() => setFilters((f) => ({ ...f, tagIds: [] }))}
            />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Приоритет</p>
              <div className="flex flex-wrap gap-2">
                {([
                  ["low", "Низкий"],
                  ["normal", "Обычный"],
                  ["high", "Высокий"],
                  ["urgent", "Срочный"],
                ] as Array<[TaskPriority, string]>).map(([p, label]) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, priorities: toggleInList(f.priorities, p) as TaskPriority[] }))}
                    className={`rounded-lg px-2.5 py-1 text-xs ${
                      filters.priorities.includes(p)
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Срок выполнения</p>
              <div className="flex flex-wrap gap-2">
                {(["overdue", "due_soon", "no_due", "on_track"] as DueStatusFilter[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, dueStatuses: toggleInList(f.dueStatuses, s) as DueStatusFilter[] }))}
                    className={`rounded-lg px-2.5 py-1 text-xs ${
                      filters.dueStatuses.includes(s)
                        ? "bg-emerald-600 text-white"
                        : "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
                    }`}
                  >
                    {s === "overdue" ? "Просрочено" : s === "due_soon" ? "Скоро срок" : s === "no_due" ? "Без срока" : "В срок"}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Дополнительно</p>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={filters.onlyUnassigned}
                  onChange={(e) => setFilters((f) => ({ ...f, onlyUnassigned: e.target.checked }))}
                />
                Только без исполнителя
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  От
                  <input
                    type="date"
                    value={filters.dueFrom}
                    onChange={(e) => setFilters((f) => ({ ...f, dueFrom: e.target.value }))}
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-600 dark:bg-slate-800"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  До
                  <input
                    type="date"
                    value={filters.dueTo}
                    onChange={(e) => setFilters((f) => ({ ...f, dueTo: e.target.value }))}
                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-600 dark:bg-slate-800"
                  />
                </label>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Поиск по задачам, тегам, сотрудникам"
              className="min-w-[15rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_TASK_ANALYTICS_FILTERS)}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              Сбросить
            </button>
            <button
              type="button"
              onClick={() => downloadCsv("tasks_filtered.csv", taskToCsv(filtered))}
              className="rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
            >
              Экспорт CSV
            </button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <button type="button" onClick={() => setTab("summary")} className="rounded-xl border border-slate-200 bg-white p-3 text-left dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-xs text-slate-500">Всего</p>
            <p className="text-xl font-semibold">{kpis.total}</p>
          </button>
          <button type="button" onClick={() => setTab("summary")} className="rounded-xl border border-slate-200 bg-white p-3 text-left dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-xs text-slate-500">Активные</p>
            <p className="text-xl font-semibold">{kpis.active}</p>
          </button>
          <button type="button" onClick={() => { setTab("overdue"); setFilters((f)=>({...f,dueStatuses:["overdue"]})); }} className="rounded-xl border border-red-200 bg-red-50/70 p-3 text-left dark:border-red-900/40 dark:bg-red-950/20">
            <p className="text-xs text-red-600">Просрочено</p>
            <p className="text-xl font-semibold text-red-700 dark:text-red-300">{kpis.overdue}</p>
          </button>
          <button type="button" onClick={() => { setTab("risk"); setFilters((f)=>({...f,dueStatuses:["due_soon"]})); }} className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-left dark:border-amber-900/40 dark:bg-amber-950/20">
            <p className="text-xs text-amber-700">Срок до 3 дней</p>
            <p className="text-xl font-semibold text-amber-700 dark:text-amber-300">{kpis.dueSoon}</p>
          </button>
          <button type="button" onClick={() => setFilters((f)=>({...f,onlyUnassigned:true}))} className="rounded-xl border border-violet-200 bg-violet-50/80 p-3 text-left dark:border-violet-900/40 dark:bg-violet-950/20">
            <p className="text-xs text-violet-700">Без исполнителя</p>
            <p className="text-xl font-semibold text-violet-700 dark:text-violet-300">{kpis.unassigned}</p>
          </button>
          <button type="button" onClick={() => setFilters((f)=>({...f,priorities:["high","urgent"]}))} className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-left dark:border-rose-900/40 dark:bg-rose-950/20">
            <p className="text-xs text-rose-700">Высокий/срочный</p>
            <p className="text-xl font-semibold text-rose-700 dark:text-rose-300">{kpis.highPriority}</p>
          </button>
        </div>

        {allTasksQuery.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}

        {!allTasksQuery.isPending && tab === "summary" && (
          <div className="grid gap-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 dark:border-slate-700 dark:bg-slate-900/60">
              <div className="mb-3 flex items-center gap-2">
                <FolderKanban className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-semibold">По системам</h3>
              </div>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                График показывает топ-10 систем по задачам; остальные агрегируются в строку «Прочие».
                {bySystem.length > 12 ? " Для длинного списка используйте ползунок справа у графика." : ""}
              </p>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                  <p className="text-slate-500">Систем в выборке</p>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">{bySystem.length}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                  <p className="text-slate-500">С просрочками</p>
                  <p className="text-base font-semibold text-red-700 dark:text-red-300">{systemsWithOverdue}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                  <p className="text-slate-500">Задач по фильтрам</p>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">{kpis.total}</p>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                {topSystems.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1 dark:bg-slate-800/60">
                    <span>{r.name}</span>
                    <span className="text-xs text-slate-500">всего {r.total} · проср. {r.overdue}</span>
                  </div>
                ))}
                {bySystem.length > topSystems.length && (
                  <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">
                    и еще {bySystem.length - topSystems.length} систем (войдут в «Прочие»)
                  </p>
                )}
              </div>
              <div className="mt-4">
                <Suspense fallback={<ChartSkeleton className="h-52" />}>
                  <ManagerSystemsChart rows={systemsChartRows.map((r) => ({ name: r.name, total: r.total, overdue: r.overdue }))} dark={chartDark} />
                </Suspense>
              </div>
            </div>
          </div>
        )}
        {!allTasksQuery.isPending && tab === "summary" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 dark:border-slate-700 dark:bg-slate-900/60">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900 dark:text-white">Все системы (таблица)</h3>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={systemSearch}
                  onChange={(e) => setSystemSearch(e.target.value)}
                  placeholder="Поиск системы"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
                />
                <select
                  value={systemSort}
                  onChange={(e) => setSystemSort(e.target.value as SystemTableSort)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
                >
                  <option value="overdue_desc">Сначала просроченные</option>
                  <option value="total_desc">Сначала по объему задач</option>
                  <option value="name_asc">По названию (А-Я)</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">Система</th>
                    <th className="px-2 py-2">Всего задач</th>
                    <th className="px-2 py-2">Активные</th>
                    <th className="px-2 py-2">Просрочено</th>
                    <th className="px-2 py-2">% просрочки</th>
                  </tr>
                </thead>
                <tbody>
                  {systemsTableRows.map((r) => {
                    const pct = r.total > 0 ? Math.round((r.overdue / r.total) * 100) : 0;
                    return (
                      <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-2">{r.name}</td>
                        <td className="px-2 py-2">{r.total}</td>
                        <td className="px-2 py-2">{r.active}</td>
                        <td className="px-2 py-2 text-red-700 dark:text-red-300">{r.overdue}</td>
                        <td className="px-2 py-2">{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {systemsTableRows.length === 0 && (
                <p className="py-6 text-sm text-slate-500 dark:text-slate-400">Нет систем по текущему поиску/фильтрам.</p>
              )}
            </div>
          </div>
        )}
        {!allTasksQuery.isPending && tab === "summary" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 dark:border-slate-700 dark:bg-slate-900/60">
              <h3 className="mb-2 font-semibold text-slate-900 dark:text-white">Создано vs закрыто (8 недель)</h3>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Закрыто = задача в архиве или в колонке «Выполнено» (по дате обновления).
              </p>
              <Suspense fallback={<ChartSkeleton className="h-56" />}>
                <ManagerCreatedClosedChart rows={weeklyFlowRows} dark={chartDark} />
              </Suspense>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 dark:border-slate-700 dark:bg-slate-900/60">
              <h3 className="mb-2 font-semibold text-slate-900 dark:text-white">Период задач по колонкам (активные)</h3>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Показывает, как долго активные задачи находятся в каждой колонке: 0-3, 4-7, 8-14 и 15+ дней.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-2 py-2">Колонка</th>
                      <th className="px-2 py-2">Всего</th>
                      <th className="px-2 py-2">0-3 дн</th>
                      <th className="px-2 py-2">4-7 дн</th>
                      <th className="px-2 py-2">8-14 дн</th>
                      <th className="px-2 py-2">15+ дн</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agingRows.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-2">{r.name}</td>
                        <td className="px-2 py-2 font-medium">{r.total}</td>
                        <td className="px-2 py-2">{r.b0_3}</td>
                        <td className="px-2 py-2">{r.b4_7}</td>
                        <td className="px-2 py-2">{r.b8_14}</td>
                        <td className="px-2 py-2 text-amber-700 dark:text-amber-300">{r.b15p}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {agingRows.length === 0 && (
                  <p className="py-6 text-sm text-slate-500 dark:text-slate-400">Нет активных задач по текущим фильтрам.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {!allTasksQuery.isPending && tab === "overdue" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 dark:border-slate-700 dark:bg-slate-900/60">
            <h3 className="mb-3 font-semibold">Просроченные задачи ({overdueRows.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Задача</th>
                    <th className="px-2 py-2">Система</th>
                    <th className="px-2 py-2">Исполнители</th>
                    <th className="px-2 py-2">Колонка</th>
                    <th className="px-2 py-2">Приоритет</th>
                    <th className="px-2 py-2">Просрочка</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueRows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-2">{r.title}</td>
                      <td className="px-2 py-2">{r.systemName}</td>
                      <td className="px-2 py-2">{r.assigneesLabel}</td>
                      <td className="px-2 py-2">{r.columnName}</td>
                      <td className="px-2 py-2">{r.priority}</td>
                      <td className="px-2 py-2 text-red-700 dark:text-red-300">{r.overdueHours} ч</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {overdueRows.length === 0 && <p className="py-6 text-sm text-slate-500">Просрочек по текущим фильтрам нет.</p>}
            </div>
          </div>
        )}

        {!allTasksQuery.isPending && tab === "workload" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 dark:border-slate-700 dark:bg-slate-900/60">
            <h3 className="mb-2 font-semibold">Нагрузка по сотрудникам</h3>
            <p className="mb-3 text-xs text-slate-500">
              Учитываются текущие фильтры; красная часть показывает просроченные задачи.
              {byAssignee.length > 14 ? " При большом списке используйте ползунок справа у графика." : ""}
            </p>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                <p className="text-slate-500">Исполнителей в выборке</p>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{byAssignee.length}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                <p className="text-slate-500">С просрочками</p>
                <p className="text-base font-semibold text-red-700 dark:text-red-300">{assigneesWithOverdue}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                <p className="text-slate-500">Всего задач по фильтрам</p>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{kpis.total}</p>
              </div>
            </div>
            <Suspense fallback={<ChartSkeleton className="h-[min(32rem,calc(100vh-10rem))]" />}>
              <ManagerWorkloadChart
                rows={byAssignee.map((r) => ({ name: r.name, total: r.total, overdue: r.overdue }))}
                dark={chartDark}
              />
            </Suspense>
          </div>
        )}

        {!allTasksQuery.isPending && tab === "risk" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-5 dark:border-amber-900/40 dark:bg-amber-950/15">
              <h3 className="mb-2 font-semibold text-amber-900 dark:text-amber-200">Срок до 3 дней ({dueSoonRows.length})</h3>
              <ul className="space-y-1 text-sm">
                {dueSoonRows.slice(0, 12).map((t) => (
                  <li key={t.id} className="rounded-md bg-white/70 px-2 py-1 dark:bg-slate-900/40">
                    <span className="font-medium">{t.title}</span>
                    <span className="ml-2 text-xs text-slate-600 dark:text-slate-300">{formatDue(t.due_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-violet-200/80 bg-violet-50/50 p-5 dark:border-violet-900/40 dark:bg-violet-950/15">
              <h3 className="mb-2 font-semibold text-violet-900 dark:text-violet-200">
                Ваши задачи как исполнителя ({managerOwnTasks.length})
              </h3>
              <ul className="space-y-1 text-sm">
                {managerOwnTasks.map((t) => (
                  <li key={t.id} className="rounded-md bg-white/70 px-2 py-1 dark:bg-slate-900/40">
                    <span className="font-medium">{t.title}</span>
                    <span className="ml-2 text-xs text-slate-600 dark:text-slate-300">{formatDue(t.due_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
