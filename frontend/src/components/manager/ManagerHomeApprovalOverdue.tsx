import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";

import type { TaskOut } from "../../api/tasks";
import { taskInApprovalColumn } from "../../lib/managerTaskDashboard";
import { formatAssigneesLabel } from "../../lib/taskAssignees";
import { taskIsActiveForDashboard, taskIsOverdueForDashboard } from "../../lib/taskStatus";

const DASH_FILTER_SELECT =
  "h-9 max-w-[11rem] min-w-[6.75rem] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

const PRIORITY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Все приоритеты" },
  { value: "low", label: "Низкий" },
  { value: "normal", label: "Обычный" },
  { value: "high", label: "Высокий" },
  { value: "urgent", label: "Срочный" },
];

function matchesTaskDashboardFilters(
  t: TaskOut,
  filters: { systemId: string; assigneeId: string; priority: string },
): boolean {
  if (filters.systemId) {
    if (filters.systemId === "__none__") {
      if (t.system_id && t.system) return false;
    } else if (t.system_id !== filters.systemId) return false;
  }
  if (filters.assigneeId) {
    const ids = (t.assignees ?? []).map((a) => a.id);
    if (filters.assigneeId === "__unassigned__") {
      if (ids.length > 0) return false;
    } else if (!ids.includes(filters.assigneeId)) return false;
  }
  if (filters.priority && t.priority !== filters.priority) return false;
  return true;
}

type DashSelectOption = { id: string; name: string };

function DashboardTaskFilterToolbar({
  systemId,
  assigneeId,
  priority,
  onSystem,
  onAssignee,
  onPriority,
  systems,
  assignees,
  matched,
  total,
}: {
  systemId: string;
  assigneeId: string;
  priority: string;
  onSystem: (v: string) => void;
  onAssignee: (v: string) => void;
  onPriority: (v: string) => void;
  systems: DashSelectOption[];
  assignees: DashSelectOption[];
  matched: number;
  total: number;
}) {
  const dirty = !!(systemId || assigneeId || priority);
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:max-w-[11rem]">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Система
          </span>
          <select value={systemId} onChange={(e) => onSystem(e.target.value)} className={DASH_FILTER_SELECT}>
            <option value="">Все системы</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:max-w-[11rem]">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Исполнитель
          </span>
          <select value={assigneeId} onChange={(e) => onAssignee(e.target.value)} className={DASH_FILTER_SELECT}>
            <option value="">Все</option>
            <option value="__unassigned__">Не назначен</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 sm:max-w-[11rem]">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Приоритет
          </span>
          <select value={priority} onChange={(e) => onPriority(e.target.value)} className={DASH_FILTER_SELECT}>
            {PRIORITY_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {dirty && (
          <button
            type="button"
            onClick={() => {
              onSystem("");
              onAssignee("");
              onPriority("");
            }}
            className="h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Сбросить
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        По фильтру: <span className="font-semibold text-slate-700 dark:text-slate-200">{matched}</span> из{" "}
        <span className="tabular-nums">{total}</span> в этом блоке
      </p>
    </div>
  );
}

function taskBreakdownBySystem(tasks: TaskOut[]): { name: string; n: number }[] {
  const m = new Map<string, { name: string; n: number }>();
  for (const t of tasks) {
    const id = t.system?.id ?? "__none__";
    const name = t.system?.name ?? "Без системы";
    const cur = m.get(id) ?? { name, n: 0 };
    cur.n += 1;
    m.set(id, cur);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ru"));
}

function priorityShortLabel(p: string): string {
  switch (p) {
    case "urgent":
      return "Срочный";
    case "high":
      return "Высокий";
    case "low":
      return "Низкий";
    case "normal":
      return "Обычный";
    default:
      return p;
  }
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

type Props = {
  tasks: TaskOut[];
  showApproval: boolean;
  showOverdue: boolean;
};

export function ManagerHomeApprovalOverdue({ tasks, showApproval, showOverdue }: Props) {
  const [overdueSys, setOverdueSys] = useState("");
  const [overdueAssignee, setOverdueAssignee] = useState("");
  const [overduePriority, setOverduePriority] = useState("");
  const [overdueShowAll, setOverdueShowAll] = useState(false);
  const [approvalSys, setApprovalSys] = useState("");
  const [approvalAssignee, setApprovalAssignee] = useState("");
  const [approvalPriority, setApprovalPriority] = useState("");
  const [approvalShowAll, setApprovalShowAll] = useState(false);

  const dashboardSystemOptions = useMemo((): DashSelectOption[] => {
    const m = new Map<string, string>();
    let hasNoSystem = false;
    for (const t of tasks) {
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
  }, [tasks]);

  const dashboardAssigneeOptions = useMemo((): DashSelectOption[] => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      if (!taskIsActiveForDashboard(t)) continue;
      for (const a of t.assignees ?? []) {
        if (!m.has(a.id)) m.set(a.id, a.full_name);
      }
    }
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [tasks]);

  const teamOverdueAll = useMemo(() => {
    return tasks
      .filter((t) => taskIsActiveForDashboard(t) && taskIsOverdueForDashboard(t))
      .sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : 0;
        const db = b.due_at ? new Date(b.due_at).getTime() : 0;
        return da - db;
      });
  }, [tasks]);

  const filteredTeamOverdue = useMemo(() => {
    const f = { systemId: overdueSys, assigneeId: overdueAssignee, priority: overduePriority };
    return teamOverdueAll.filter((t) => matchesTaskDashboardFilters(t, f));
  }, [teamOverdueAll, overdueSys, overdueAssignee, overduePriority]);

  const overdueBreakdown = useMemo(
    () => taskBreakdownBySystem(filteredTeamOverdue),
    [filteredTeamOverdue],
  );

  const approvalAll = useMemo(() => {
    return tasks
      .filter((t) => taskIsActiveForDashboard(t) && taskInApprovalColumn(t))
      .sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return da - db;
      });
  }, [tasks]);

  const filteredApprovalTasks = useMemo(() => {
    const f = { systemId: approvalSys, assigneeId: approvalAssignee, priority: approvalPriority };
    return approvalAll.filter((t) => matchesTaskDashboardFilters(t, f));
  }, [approvalAll, approvalSys, approvalAssignee, approvalPriority]);

  const approvalBreakdown = useMemo(
    () => taskBreakdownBySystem(filteredApprovalTasks),
    [filteredApprovalTasks],
  );

  if (!showApproval && !showOverdue) return null;

  return (
    <>
      {showApproval && approvalAll.length > 0 && (
        <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-white to-amber-50/70 p-6 shadow-soft dark:border-amber-900/40 dark:from-slate-900 dark:to-amber-950/20">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">На согласовании</h3>
              </div>
            </div>
            <Link to="/tasks" className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">
              Открыть канбан
            </Link>
          </div>
          <DashboardTaskFilterToolbar
            systemId={approvalSys}
            assigneeId={approvalAssignee}
            priority={approvalPriority}
            onSystem={setApprovalSys}
            onAssignee={setApprovalAssignee}
            onPriority={setApprovalPriority}
            systems={dashboardSystemOptions}
            assignees={dashboardAssigneeOptions}
            matched={filteredApprovalTasks.length}
            total={approvalAll.length}
          />
          {filteredApprovalTasks.length > 0 && approvalBreakdown.length > 0 && (
            <p className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-500 dark:text-slate-400">По системам:</span>
              {approvalBreakdown.map((b, i) => (
                <span key={`${b.name}-${i}`}>
                  {b.name}{" "}
                  <strong className="tabular-nums text-slate-800 dark:text-slate-100">{b.n}</strong>
                </span>
              ))}
            </p>
          )}
          {filteredApprovalTasks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Нет задач по выбранным фильтрам. Измените условия или сбросьте их.
            </p>
          ) : (
            <ul className="space-y-2">
              {(approvalShowAll ? filteredApprovalTasks : filteredApprovalTasks.slice(0, 12)).map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-amber-100/80 bg-white/90 px-3 py-2.5 text-sm dark:border-amber-900/30 dark:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {formatAssigneesLabel(t, 99) || "Не назначен"}
                      {t.system ? ` · ${t.system.name}` : ""}
                      {t.column?.name ? ` · ${t.column.name}` : ""}
                      <span className="text-slate-400 dark:text-slate-500">
                        {" "}
                        · {priorityShortLabel(t.priority)}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-medium ${
                      taskIsOverdueForDashboard(t) ? "text-red-700 dark:text-red-300" : "text-slate-500"
                    }`}
                  >
                    {formatDue(t.due_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {filteredApprovalTasks.length > 12 && (
            <button
              type="button"
              onClick={() => setApprovalShowAll((v) => !v)}
              className="mt-3 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
            >
              {approvalShowAll ? "Свернуть список" : `Показать все (${filteredApprovalTasks.length})`}
            </button>
          )}
        </div>
      )}

      {showOverdue && teamOverdueAll.length > 0 && (
        <div className="rounded-2xl border border-red-200/70 bg-gradient-to-br from-white to-red-50/40 p-6 shadow-soft dark:border-red-900/40 dark:from-slate-900 dark:to-red-950/25">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">Просроченные задачи команды</h3>
              </div>
            </div>
            <Link to="/tasks" className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">
              Открыть канбан
            </Link>
          </div>
          <DashboardTaskFilterToolbar
            systemId={overdueSys}
            assigneeId={overdueAssignee}
            priority={overduePriority}
            onSystem={setOverdueSys}
            onAssignee={setOverdueAssignee}
            onPriority={setOverduePriority}
            systems={dashboardSystemOptions}
            assignees={dashboardAssigneeOptions}
            matched={filteredTeamOverdue.length}
            total={teamOverdueAll.length}
          />
          {filteredTeamOverdue.length > 0 && overdueBreakdown.length > 0 && (
            <p className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-500 dark:text-slate-400">По системам:</span>
              {overdueBreakdown.map((b, i) => (
                <span key={`${b.name}-${i}`}>
                  {b.name}{" "}
                  <strong className="tabular-nums text-slate-800 dark:text-slate-100">{b.n}</strong>
                </span>
              ))}
            </p>
          )}
          {filteredTeamOverdue.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Нет задач по выбранным фильтрам. Измените условия или сбросьте их.
            </p>
          ) : (
            <ul className="space-y-2">
              {(overdueShowAll ? filteredTeamOverdue : filteredTeamOverdue.slice(0, 12)).map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-red-100/80 bg-white/90 px-3 py-2.5 text-sm dark:border-red-900/30 dark:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {formatAssigneesLabel(t, 99) || "Не назначен"}
                      {t.system ? ` · ${t.system.name}` : ""}
                      <span className="text-slate-400 dark:text-slate-500">
                        {" "}
                        · {priorityShortLabel(t.priority)}
                      </span>
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-red-700 dark:text-red-300">
                    {formatDue(t.due_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {filteredTeamOverdue.length > 12 && (
            <button
              type="button"
              onClick={() => setOverdueShowAll((v) => !v)}
              className="mt-3 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
            >
              {overdueShowAll ? "Свернуть список" : `Показать все (${filteredTeamOverdue.length})`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
