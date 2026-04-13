import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { BarChart3, ChevronLeft, FolderKanban } from "lucide-react";

import { listTasks, type TaskOut } from "../api/tasks";
import { AppShell } from "../components/AppShell";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { isHomeBlockVisible } from "../lib/homeDashboardBlocks";
import { taskHasAssignee } from "../lib/taskAssignees";
import { canViewManagerTeamDashboard } from "../lib/permissions";
import { taskIsActiveForDashboard, taskIsOverdueForDashboard } from "../lib/taskStatus";

const ManagerSystemsChart = lazy(() => import("../components/charts/ManagerSystemsChart"));
const ManagerWorkloadChart = lazy(() => import("../components/charts/ManagerWorkloadChart"));

function ChartSkeleton({ className = "h-64" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-slate-100/90 dark:bg-slate-800/80 ${className}`}
      aria-hidden
    />
  );
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

/** Фильтр нагрузки: пустой список = все системы; иначе задача подходит, если в любой из выбранных систем (или «Без системы»). */
function taskMatchesWorkloadSystems(t: TaskOut, systemIds: string[]): boolean {
  if (systemIds.length === 0) return true;
  const noSys = !t.system_id || !t.system;
  if (systemIds.includes("__none__") && noSys) return true;
  if (!noSys && t.system_id && systemIds.includes(t.system_id)) return true;
  return false;
}

type DashSelectOption = { id: string; name: string };

export function ManagerTeamDashboardPage() {
  const { resolved: themeResolved } = useTheme();
  const chartDark = themeResolved === "dark";
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canAccess = !!user && canViewManagerTeamDashboard(user);

  const [workloadSystemIds, setWorkloadSystemIds] = useState<string[]>([]);

  const allTasksQuery = useQuery({
    queryKey: ["tasks", user?.id ?? ""],
    queryFn: () => listTasks({ include_archived: false }),
    enabled: canAccess,
  });
  const dashPrefs = user?.dashboard_preferences;
  const showBlock = (id: string) => isHomeBlockVisible(dashPrefs, id);

  const statsByAssignee = useMemo(() => {
    const rows = allTasksQuery.data ?? [];
    const m = new Map<string, { id: string; name: string; total: number; overdue: number }>();
    for (const t of rows) {
      if (!taskIsActiveForDashboard(t)) continue;
      const assignees = t.assignees ?? [];
      if (assignees.length === 0) {
        const key = "none";
        const nm = "Не назначен";
        if (!m.has(key)) m.set(key, { id: key, name: nm, total: 0, overdue: 0 });
        const r = m.get(key)!;
        r.total += 1;
        if (taskIsOverdueForDashboard(t)) r.overdue += 1;
        continue;
      }
      for (const a of assignees) {
        if (!m.has(a.id)) m.set(a.id, { id: a.id, name: a.full_name, total: 0, overdue: 0 });
        const r = m.get(a.id)!;
        r.total += 1;
        if (taskIsOverdueForDashboard(t)) r.overdue += 1;
      }
    }
    return [...m.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  }, [allTasksQuery.data]);

  const statsBySystem = useMemo(() => {
    const rows = allTasksQuery.data ?? [];
    const m = new Map<string, { id: string; name: string; total: number; overdue: number }>();
    for (const t of rows) {
      if (!taskIsActiveForDashboard(t)) continue;
      const key = t.system?.id ?? "none";
      const nm = t.system?.name ?? "Без системы";
      if (!m.has(key)) m.set(key, { id: key, name: nm, total: 0, overdue: 0 });
      const r = m.get(key)!;
      r.total += 1;
      if (taskIsOverdueForDashboard(t)) r.overdue += 1;
    }
    return [...m.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  }, [allTasksQuery.data]);

  const dashboardSystemOptions = useMemo((): DashSelectOption[] => {
    const rows = allTasksQuery.data ?? [];
    const m = new Map<string, string>();
    let hasNoSystem = false;
    for (const t of rows) {
      if (!taskIsActiveForDashboard(t)) continue;
      if (!t.system_id || !t.system) {
        hasNoSystem = true;
        continue;
      }
      m.set(t.system_id, t.system.name);
    }
    const out = [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (hasNoSystem) out.unshift({ id: "__none__", name: "Без системы" });
    return out;
  }, [allTasksQuery.data]);

  function toggleWorkloadSystem(id: string) {
    setWorkloadSystemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const workloadTasksForChart = useMemo(() => {
    return (allTasksQuery.data ?? []).filter(
      (t) => taskIsActiveForDashboard(t) && taskMatchesWorkloadSystems(t, workloadSystemIds),
    );
  }, [allTasksQuery.data, workloadSystemIds]);

  const workloadByAssignee = useMemo(() => {
    const m = new Map<string, { name: string; total: number; overdue: number }>();
    for (const t of workloadTasksForChart) {
      const assignees = t.assignees ?? [];
      if (assignees.length === 0) {
        const key = "__unassigned__";
        const nm = "Не назначен";
        if (!m.has(key)) m.set(key, { name: nm, total: 0, overdue: 0 });
        const r = m.get(key)!;
        r.total += 1;
        if (taskIsOverdueForDashboard(t)) r.overdue += 1;
        continue;
      }
      for (const a of assignees) {
        if (!m.has(a.id)) m.set(a.id, { name: a.full_name, total: 0, overdue: 0 });
        const r = m.get(a.id)!;
        r.total += 1;
        if (taskIsOverdueForDashboard(t)) r.overdue += 1;
      }
    }
    return [...m.values()].sort((a, b) => b.total - a.total || b.overdue - a.overdue);
  }, [workloadTasksForChart]);

  const managerOwnTasks = useMemo(() => {
    return (allTasksQuery.data ?? [])
      .filter((t) => taskIsActiveForDashboard(t) && user && taskHasAssignee(t, user.id))
      .slice()
      .sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return da - db;
      })
      .slice(0, 6);
  }, [allTasksQuery.data, user?.id]);

  const totalActive = (allTasksQuery.data ?? []).filter((t) => taskIsActiveForDashboard(t)).length;
  const totalOverdue = (allTasksQuery.data ?? []).filter((t) => taskIsOverdueForDashboard(t)).length;

  if (state.status !== "authenticated" || !user) return null;
  if (!canViewManagerTeamDashboard(user)) return <Navigate to="/" replace />;

  return (
    <AppShell title="Команда" subtitle="Сводки и графики по задачам команды" wide>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
          >
            <ChevronLeft className="h-4 w-4" />
            К обзору
          </Link>
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
            <span>
              Активных:{" "}
              <strong className="tabular-nums text-slate-900 dark:text-white">
                {allTasksQuery.isPending ? "…" : totalActive}
              </strong>
            </span>
            <span>
              Просрочено:{" "}
              <strong
                className={
                  totalOverdue > 0
                    ? "tabular-nums text-red-700 dark:text-red-300"
                    : "tabular-nums text-slate-900 dark:text-white"
                }
              >
                {allTasksQuery.isPending ? "…" : totalOverdue}
              </strong>
            </span>
          </div>
        </div>

        {showBlock("manager_by_system") && statsBySystem.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
                <div className="mb-4 flex items-center gap-2">
                  <FolderKanban className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <h3 className="font-semibold text-slate-900 dark:text-white">По системам (проектам)</h3>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {statsBySystem.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/40"
                    >
                      <p className="font-medium text-slate-900 dark:text-white">{row.name}</p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        Активных: {row.total}
                        {row.overdue > 0 ? (
                          <span className="text-red-700 dark:text-red-300"> · просрочено: {row.overdue}</span>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 border-t border-slate-200/80 pt-5 dark:border-slate-700/80">
                  <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    Диаграмма: активные задачи по системам
                  </p>
                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                    Синий — в срок (без просрочки), красный — с истёкшим дедлайном
                  </p>
                  <Suspense fallback={<ChartSkeleton className="min-h-[200px] h-[min(28rem,calc(100vh-12rem))]" />}>
                    <ManagerSystemsChart
                      rows={statsBySystem.map((r) => ({ name: r.name, total: r.total, overdue: r.overdue }))}
                      dark={chartDark}
                    />
                  </Suspense>
                </div>
              </div>
            )}

            {showBlock("manager_analytics") && (
            <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/90 p-6 shadow-soft dark:border-emerald-900/50 dark:from-slate-900 dark:to-emerald-950/30">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md">
                    <BarChart3 className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Аналитика по сотрудникам</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      Активных задач: <strong>{allTasksQuery.isPending ? "…" : totalActive}</strong>
                      {totalOverdue > 0 && (
                        <>
                          {" "}
                          · с истёкшим сроком:{" "}
                          <strong className="text-red-700 dark:text-red-300">{totalOverdue}</strong>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </div>
              {allTasksQuery.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
              {!allTasksQuery.isPending && (
                <div className="overflow-x-auto rounded-xl border border-emerald-100/80 dark:border-emerald-900/40">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="border-b border-emerald-100 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                      <tr>
                        <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                          Исполнитель
                        </th>
                        <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                          Активных
                        </th>
                        <th className="px-3 py-2 font-semibold text-red-800 dark:text-red-200">Просрочено</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-50 dark:divide-emerald-900/30">
                      {statsByAssignee.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{row.name}</td>
                          <td className="px-3 py-2">{row.total}</td>
                          <td className="px-3 py-2">
                            {row.overdue > 0 ? (
                              <span className="font-medium text-red-700 dark:text-red-300">{row.overdue}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {statsByAssignee.length === 0 && (
                    <p className="px-3 py-4 text-sm text-slate-500">Нет активных задач для сводки.</p>
                  )}
                </div>
              )}
              {!allTasksQuery.isPending && statsByAssignee.length > 0 && (
                <div className="mt-6 border-t border-emerald-100/80 pt-5 dark:border-emerald-900/40">
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Нагруженность исполнителей
                  </h4>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Те же активные задачи, что и в таблице выше. Без выбора систем — все задачи. Несколько систем —
                    учитываются задачи в <span className="font-medium text-slate-600 dark:text-slate-300">любой</span> из
                    отмеченных (включая «Без системы», если отмечено).
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="w-[10.75rem] max-w-full shrink-0">
                      <MultiSelectDropdown
                        compact
                        className="w-full"
                        label="Системы"
                        items={dashboardSystemOptions.map((s) => ({ id: s.id, name: s.name }))}
                        selectedIds={workloadSystemIds}
                        onToggle={toggleWorkloadSystem}
                        onClear={() => setWorkloadSystemIds([])}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    В выборке: <span className="font-semibold text-slate-700 dark:text-slate-200">{workloadTasksForChart.length}</span>{" "}
                    задач ·{" "}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{workloadByAssignee.length}</span>{" "}
                    исполнителей
                  </p>
                  {workloadByAssignee.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                      Нет задач по выбранным системам. Сбросьте фильтр или отметьте другие системы.
                    </p>
                  ) : (
                    <div className="mt-3">
                      <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
                        Зелёный — без просрочки, красный — просрочено. Ползунок справа — если исполнителей много.
                      </p>
                      <Suspense
                        fallback={<ChartSkeleton className="min-h-[220px] h-[min(32rem,calc(100vh-10rem))]" />}
                      >
                        <ManagerWorkloadChart
                          rows={workloadByAssignee.map((r) => ({
                            name: r.name,
                            total: r.total,
                            overdue: r.overdue,
                          }))}
                          dark={chartDark}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Выполненные — задачи в колонке «выполнено» для отчётов или в колонке со slug{" "}
                <span className="font-mono">done</span>. Архив не входит. «Просрочено» — срок прошёл, задача ещё не в
                «выполнено».{" "}
                <Link to="/tasks" className="text-sky-600 hover:underline dark:text-sky-400">
                  Задачи
                </Link>
              </p>
            </div>
            )}

            {showBlock("manager_own_tasks") && managerOwnTasks.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
                <h3 className="mb-3 font-semibold text-slate-900 dark:text-white">Ваши задачи как исполнителя</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {managerOwnTasks.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/40"
                    >
                      <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
                      <p className="text-xs text-slate-500">{formatDue(t.due_at)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
      </div>
    </AppShell>
  );
}
