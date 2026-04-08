import { useMemo, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Briefcase,
  CalendarClock,
  ChevronRight,
  FolderKanban,
  LayoutGrid,
  Server,
  Settings,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";

import { listTasks } from "../api/tasks";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { canAdminAccess, PERM, hasPermission } from "../lib/permissions";
import { taskIsActiveForDashboard, taskIsOverdueForDashboard } from "../lib/taskStatus";

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

function initialsFromName(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0]![0]! + p[1]![0]!).toUpperCase();
  if (p.length === 1 && p[0]!.length >= 2) return p[0]!.slice(0, 2).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function taskInApprovalColumn(t: { column: { slug: string; name: string } | null }): boolean {
  const slug = (t.column?.slug ?? "").toLowerCase();
  const name = (t.column?.name ?? "").toLowerCase();
  return (
    slug.includes("approval") ||
    slug.includes("approve") ||
    slug.includes("agreement") ||
    name.includes("соглас")
  );
}

export function HomePage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const name = user?.full_name ?? "";
  const positionLabel = user?.position?.name;

  const isManager =
    !!user &&
    (hasPermission(user, PERM.TASKS_READ_ALL) ||
      hasPermission(user, PERM.TASKS_UPDATE_ALL) ||
      hasPermission(user, PERM.USERS_MANAGE) ||
      user.is_superuser);

  const myTasksQuery = useQuery({
    queryKey: ["tasks", "mine", user?.id],
    queryFn: () => listTasks({ assignee_id: user!.id, include_archived: false }),
    enabled: !!user && !isManager,
  });

  const allTasksQuery = useQuery({
    queryKey: ["tasks", user?.id ?? ""],
    queryFn: () => listTasks({ include_archived: false }),
    enabled: !!user && isManager,
  });

  const myTasksSorted = useMemo(() => {
    return (myTasksQuery.data ?? [])
      .filter((t) => taskIsActiveForDashboard(t))
      .slice()
      .sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return da - db;
      });
  }, [myTasksQuery.data]);

  const statsByAssignee = useMemo(() => {
    const rows = allTasksQuery.data ?? [];
    const m = new Map<string, { id: string; name: string; total: number; overdue: number }>();
    for (const t of rows) {
      if (!taskIsActiveForDashboard(t)) continue;
      const key = t.assignee_id ?? "none";
      const nm = t.assignee?.full_name ?? "Не назначен";
      if (!m.has(key)) m.set(key, { id: key, name: nm, total: 0, overdue: 0 });
      const r = m.get(key)!;
      r.total += 1;
      if (taskIsOverdueForDashboard(t)) r.overdue += 1;
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

  const topTeamOverdue = useMemo(() => {
    const rows = allTasksQuery.data ?? [];
    return rows
      .filter((t) => taskIsActiveForDashboard(t) && taskIsOverdueForDashboard(t))
      .sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : 0;
        const db = b.due_at ? new Date(b.due_at).getTime() : 0;
        return da - db;
      })
      .slice(0, 8);
  }, [allTasksQuery.data]);

  const managerOwnTasks = useMemo(() => {
    return (allTasksQuery.data ?? [])
      .filter((t) => taskIsActiveForDashboard(t) && t.assignee_id === user?.id)
      .slice()
      .sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return da - db;
      })
      .slice(0, 6);
  }, [allTasksQuery.data, user?.id]);

  const managerApprovalTasks = useMemo(() => {
    return (allTasksQuery.data ?? [])
      .filter((t) => taskIsActiveForDashboard(t) && taskInApprovalColumn(t))
      .slice()
      .sort((a, b) => {
        const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return da - db;
      })
      .slice(0, 10);
  }, [allTasksQuery.data]);

  const totalActive = (allTasksQuery.data ?? []).filter((t) => taskIsActiveForDashboard(t)).length;
  const totalOverdue = (allTasksQuery.data ?? []).filter((t) => taskIsOverdueForDashboard(t)).length;

  const myActiveCount = myTasksSorted.length;
  const myOverdueCount = myTasksSorted.filter((t) => taskIsOverdueForDashboard(t)).length;

  const showAdmin = user ? canAdminAccess(user) : false;

  const quickLinks: {
    to: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    description: string;
  }[] = [
    { to: "/tasks", label: "Задачи", icon: LayoutGrid, description: "Канбан-доска" },
    { to: "/systems", label: "Системы", icon: Server, description: "Каталог систем" },
    { to: "/knowledge", label: "База знаний", icon: BookOpen, description: "Статьи и процессы" },
    { to: "/positions", label: "Должности", icon: Briefcase, description: "Справочник" },
    { to: "/settings", label: "Настройки", icon: Settings, description: "Профиль и безопасность" },
  ];

  return (
    <AppShell title="Обзор" subtitle="Добро пожаловать в рабочий портал отдела">
      <div className="flex flex-col gap-6">
        {/* Герой: профиль + статистика + быстрые ссылки */}
        {user && (
          <section className="relative overflow-hidden rounded-3xl border border-sky-200/70 bg-gradient-to-br from-white via-sky-50/40 to-indigo-50/50 p-6 shadow-soft dark:border-sky-900/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/40 sm:p-8">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-sky-400/10 blur-3xl dark:bg-sky-500/10" />
            <div className="pointer-events-none absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-indigo-400/10 blur-3xl dark:bg-indigo-500/10" />
            <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
              <div className="flex min-w-0 flex-1 items-start gap-4 sm:gap-5">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-lg font-bold text-white shadow-lg shadow-sky-500/25 sm:h-[4.5rem] sm:w-[4.5rem] sm:text-xl">
                  {name ? initialsFromName(name) : <Sparkles className="h-8 w-8" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-sky-700/90 dark:text-sky-300/90">
                    Ваш профиль
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                    {name ? `Здравствуйте, ${name}!` : "Добро пожаловать"}
                  </h2>
                  {user.email && (
                    <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                  )}
                  {positionLabel && (
                    <p className="mt-2 inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-200/80 dark:bg-slate-800/80 dark:text-slate-200 dark:ring-slate-600/80">
                      {positionLabel}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-3 sm:gap-4 lg:justify-end">
                {isManager ? (
                  <>
                    <div className="flex min-w-[8rem] flex-col rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/80">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">По команде</span>
                      <span className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                        {allTasksQuery.isPending ? "…" : totalActive}
                      </span>
                      <span className="text-[11px] text-slate-500">активных задач</span>
                    </div>
                    <div
                      className={`flex min-w-[8rem] flex-col rounded-2xl border px-4 py-3 shadow-sm ${
                        totalOverdue > 0
                          ? "border-red-200/90 bg-red-50/90 dark:border-red-900/50 dark:bg-red-950/40"
                          : "border-white/80 bg-white/80 dark:border-slate-700/80 dark:bg-slate-800/80"
                      }`}
                    >
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Просрочено</span>
                      <span
                        className={`mt-0.5 text-2xl font-bold tabular-nums ${
                          totalOverdue > 0 ? "text-red-700 dark:text-red-300" : "text-slate-900 dark:text-white"
                        }`}
                      >
                        {allTasksQuery.isPending ? "…" : totalOverdue}
                      </span>
                      <span className="text-[11px] text-slate-500">по сроку</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex min-w-[7.5rem] flex-col rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/80">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Мои активные</span>
                      <span className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                        {myTasksQuery.isPending ? "…" : myActiveCount}
                      </span>
                    </div>
                    <div
                      className={`flex min-w-[7.5rem] flex-col rounded-2xl border px-4 py-3 shadow-sm ${
                        myOverdueCount > 0
                          ? "border-red-200/90 bg-red-50/90 dark:border-red-900/50 dark:bg-red-950/40"
                          : "border-white/80 bg-white/80 dark:border-slate-700/80 dark:bg-slate-800/80"
                      }`}
                    >
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Просрочено</span>
                      <span
                        className={`mt-0.5 text-2xl font-bold tabular-nums ${
                          myOverdueCount > 0 ? "text-red-700 dark:text-red-300" : "text-slate-900 dark:text-white"
                        }`}
                      >
                        {myTasksQuery.isPending ? "…" : myOverdueCount}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="relative mt-8 border-t border-sky-200/50 pt-6 dark:border-slate-700/60">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Быстрый переход
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {quickLinks.map(({ to, label, icon: Icon, description }) => (
                  <Link
                    key={to}
                    to={to}
                    className="group flex flex-col gap-1 rounded-2xl border border-slate-200/90 bg-white/90 px-3 py-3 shadow-sm transition hover:border-sky-300 hover:bg-sky-50/90 hover:shadow-md dark:border-slate-600/80 dark:bg-slate-800/60 dark:hover:border-sky-600 dark:hover:bg-sky-950/40"
                  >
                    <span className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                      <Icon className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                      <span className="text-sm font-semibold">{label}</span>
                    </span>
                    <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{description}</span>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-sky-500 dark:text-slate-500" />
                  </Link>
                ))}
                {showAdmin && (
                  <Link
                    to="/admin"
                    className="group flex flex-col gap-1 rounded-2xl border border-violet-200/90 bg-violet-50/80 px-3 py-3 shadow-sm transition hover:border-violet-400 hover:bg-violet-100/80 hover:shadow-md dark:border-violet-900/50 dark:bg-violet-950/40 dark:hover:border-violet-700"
                  >
                    <span className="flex items-center gap-2 text-violet-900 dark:text-violet-100">
                      <Shield className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-semibold">Админ</span>
                    </span>
                    <span className="text-[11px] leading-snug text-violet-700/90 dark:text-violet-300/90">
                      Пользователи и роли
                    </span>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 text-violet-300 transition group-hover:translate-x-0.5 dark:text-violet-500" />
                  </Link>
                )}
              </div>
            </div>
          </section>
        )}

        {!isManager && user && (
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
            <div className="mb-4 flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-sky-600 dark:text-sky-400" />
              <h3 className="font-semibold text-slate-900 dark:text-white">Мои задачи и сроки</h3>
            </div>
            {myTasksQuery.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
            {!myTasksQuery.isPending && myTasksSorted.length === 0 && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Нет активных задач, назначенных на вас. Откройте{" "}
                <Link to="/tasks" className="font-medium text-sky-600 hover:underline dark:text-sky-400">
                  канбан
                </Link>
                .
              </p>
            )}
            {!myTasksQuery.isPending && myTasksSorted.length > 0 && (
              <ul className="space-y-2">
                {myTasksSorted.slice(0, 10).map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/40"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
                      {t.system && (
                        <p className="text-xs text-sky-700 dark:text-sky-300">{t.system.name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {taskIsOverdueForDashboard(t) && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800 dark:bg-red-950/50 dark:text-red-200">
                          <AlertCircle className="h-3.5 w-3.5" />
                          просрочено
                        </span>
                      )}
                      <span
                        className={
                          taskIsOverdueForDashboard(t) ? "text-red-700 dark:text-red-300" : "text-slate-500"
                        }
                      >
                        {formatDue(t.due_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Link
                to="/tasks"
                className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                Все задачи
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        )}

        {isManager && (
          <>
            {managerApprovalTasks.length > 0 && (
              <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-white to-amber-50/70 p-6 shadow-soft dark:border-amber-900/40 dark:from-slate-900 dark:to-amber-950/20">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <h3 className="font-semibold text-slate-900 dark:text-white">На согласовании</h3>
                  </div>
                  <Link to="/tasks" className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">
                    Открыть канбан
                  </Link>
                </div>
                <ul className="space-y-2">
                  {managerApprovalTasks.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-amber-100/80 bg-white/90 px-3 py-2.5 text-sm dark:border-amber-900/30 dark:bg-slate-800/50"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {t.assignee?.full_name ?? "Не назначен"}
                          {t.system ? ` · ${t.system.name}` : ""}
                          {t.column?.name ? ` · ${t.column.name}` : ""}
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
              </div>
            )}

            {topTeamOverdue.length > 0 && (
              <div className="rounded-2xl border border-red-200/70 bg-gradient-to-br from-white to-red-50/40 p-6 shadow-soft dark:border-red-900/40 dark:from-slate-900 dark:to-red-950/25">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    <h3 className="font-semibold text-slate-900 dark:text-white">Просроченные задачи команды</h3>
                  </div>
                  <Link
                    to="/tasks"
                    className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
                  >
                    Открыть канбан
                  </Link>
                </div>
                <ul className="space-y-2">
                  {topTeamOverdue.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-red-100/80 bg-white/90 px-3 py-2.5 text-sm dark:border-red-900/30 dark:bg-slate-800/50"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {t.assignee?.full_name ?? "Не назначен"}
                          {t.system ? ` · ${t.system.name}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-red-700 dark:text-red-300">
                        {formatDue(t.due_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {statsBySystem.length > 0 && (
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
              </div>
            )}

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
              <p className="mt-3 text-xs text-slate-500">
                Выполненные — задачи в колонке «выполнено» для отчётов или в колонке со slug{" "}
                <span className="font-mono">done</span>. Архив не входит. «Просрочено» — срок прошёл, задача ещё не в
                «выполнено».{" "}
                <Link to="/tasks" className="text-sky-600 hover:underline dark:text-sky-400">
                  Задачи
                </Link>
              </p>
            </div>

            {managerOwnTasks.length > 0 && (
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
          </>
        )}

        {!isManager && user && (
          <div className="rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/50 p-5 dark:border-slate-600 dark:bg-slate-900/40">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
                <Users className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">О доступе</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Вы видите задачи в рамках выданных прав (часто — только назначенные на вас). У руководителя и
                  администратора на этой странице дополнительно показывается сводка по команде.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
