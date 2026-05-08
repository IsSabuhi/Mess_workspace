import {
  BarChart3,
  BookOpen,
  Briefcase,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Bell,
  IdCard,
  LayoutDashboard,
  PanelLeft,
  Settings,
  Shield,
  Kanban,
  CalendarDays,
  PlusCircle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { listBoards } from "../api/boards";
import { useAuth } from "../context/AuthContext";
import {
  canAdminAccess,
  canViewManagerTeamDashboard,
  canViewSchedule,
  PERM,
  hasPermission,
} from "../lib/permissions";

const nav = [
  { to: "/", label: "Обзор", icon: LayoutDashboard, end: true },
  { to: "/tasks", label: "Задачи", icon: Kanban },
  { to: "/systems", label: "Системы", icon: Cpu },
  { to: "/positions", label: "Должности", icon: Briefcase },
  { to: "/knowledge", label: "База знаний", icon: BookOpen },
  { to: "/notifications", label: "Уведомления", icon: Bell },
];

type Props = {
  collapsed: boolean;
  onToggleCollapse: () => void;
};

const TASK_BOARDS_OPEN_KEY = "mess-sidebar-task-boards-open";

export function Sidebar({ collapsed, onToggleCollapse }: Props) {
  const { state } = useAuth();
  const location = useLocation();
  const [taskBoardsOpen, setTaskBoardsOpen] = useState(() => localStorage.getItem(TASK_BOARDS_OPEN_KEY) !== "0");
  const boardsQuery = useQuery({
    queryKey: ["boards", "sidebar"],
    queryFn: listBoards,
    enabled: state.status === "authenticated",
  });
  const showAdmin = state.status === "authenticated" && canAdminAccess(state.user);
  const showSchedule = state.status === "authenticated" && canViewSchedule(state.user);
  const showEmployeeDirectory =
    state.status === "authenticated" &&
    (hasPermission(state.user, PERM.EMPLOYEE_DIRECTORY_READ) ||
      hasPermission(state.user, PERM.EMPLOYEE_DIRECTORY_MANAGE) ||
      hasPermission(state.user, PERM.EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE) ||
      hasPermission(state.user, PERM.EMPLOYEE_DIRECTORY_PROFILE_MANAGE));
  const showManagerTeamDashboard =
    state.status === "authenticated" && canViewManagerTeamDashboard(state.user);
  const visibleTaskBoards = boardsQuery.data ?? [];
  const activeTaskBoardId = useMemo(() => {
    if (location.pathname !== "/tasks") return null;
    return new URLSearchParams(location.search).get("board");
  }, [location.pathname, location.search]);
  const isCreateBoardActionActive = useMemo(() => {
    if (location.pathname !== "/tasks") return false;
    return new URLSearchParams(location.search).get("createBoard") === "1";
  }, [location.pathname, location.search]);
  useEffect(() => {
    localStorage.setItem(TASK_BOARDS_OPEN_KEY, taskBoardsOpen ? "1" : "0");
  }, [taskBoardsOpen]);

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-slate-200/80 bg-white/90 shadow-soft transition-[width] duration-300 ease-out dark:border-slate-700/80 dark:bg-slate-900/90 ${
        collapsed ? "w-[4.5rem]" : "w-64"
      }`}
    >
      <div
        className={`flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/80 px-3 dark:border-slate-700/80 ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-md shadow-sky-500/25">
            <PanelLeft className="h-5 w-5" aria-hidden />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Mess Workspace</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Отдел</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Свернуть панель"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center border-b border-slate-200/80 py-2 dark:border-slate-700/80">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Развернуть панель"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        <p
          className={`mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 ${
            collapsed ? "sr-only" : ""
          }`}
        >
          Меню
        </p>
        {nav.map(({ to, label, icon: Icon, end }) => (
          <div key={to}>
            <NavLink
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                [
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  collapsed ? "justify-center" : "",
                  isActive
                    ? "bg-sky-500/15 text-sky-700 shadow-sm dark:bg-sky-400/10 dark:text-sky-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")
              }
            >
              <Icon className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
              {!collapsed && <span>{label}</span>}
            </NavLink>
            {to === "/tasks" && !collapsed && state.status === "authenticated" && (
              <div className="-mt-1 mb-1 ml-11 space-y-1">
                <button
                  type="button"
                  onClick={() => setTaskBoardsOpen((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <span>Доски</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition ${taskBoardsOpen ? "" : "-rotate-90"}`} />
                </button>
                {taskBoardsOpen && (
                  <>
                    {state.user.is_superuser && (
                      <NavLink
                        to={{ pathname: "/tasks", search: "?createBoard=1" }}
                        className={[
                          "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition",
                          isCreateBoardActionActive
                            ? "bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300"
                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                        ].join(" ")}
                      >
                        <PlusCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>Новая доска</span>
                      </NavLink>
                    )}
                    {visibleTaskBoards.map((b) => (
                      <NavLink
                        key={b.id}
                        to={{ pathname: "/tasks", search: `?board=${b.id}` }}
                        className={() =>
                          [
                            "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-all",
                            activeTaskBoardId === b.id
                              ? "bg-sky-500/15 text-sky-700 shadow-sm ring-1 ring-sky-200 dark:bg-sky-400/15 dark:text-sky-300 dark:ring-sky-800"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                          ].join(" ")
                        }
                      >
                        <span className="min-w-0 flex-1 truncate">{b.name}</span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          {b.scope === "system" ? (b.system_name ?? "Системная") : "Общая"}
                        </span>
                      </NavLink>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {showManagerTeamDashboard && (
          <NavLink
            to="/team-dashboard"
            title={collapsed ? "Отчеты" : undefined}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                collapsed ? "justify-center" : "",
                isActive
                  ? "bg-sky-500/15 text-sky-700 shadow-sm dark:bg-sky-400/10 dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              ].join(" ")
            }
          >
            <BarChart3 className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
            {!collapsed && <span>Отчеты</span>}
          </NavLink>
        )}
        {showSchedule && (
          <NavLink
            to="/schedule"
            title={collapsed ? "Расписание" : undefined}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                collapsed ? "justify-center" : "",
                isActive
                  ? "bg-sky-500/15 text-sky-700 shadow-sm dark:bg-sky-400/10 dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              ].join(" ")
            }
          >
            <CalendarDays className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
            {!collapsed && <span>Расписание</span>}
          </NavLink>
        )}
        {showEmployeeDirectory && (
          <NavLink
            to="/employee-directory"
            title={collapsed ? "Сотрудники" : undefined}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                collapsed ? "justify-center" : "",
                isActive
                  ? "bg-sky-500/15 text-sky-700 shadow-sm dark:bg-sky-400/10 dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              ].join(" ")
            }
          >
            <IdCard className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
            {!collapsed && <span>Сотрудники</span>}
          </NavLink>
        )}

        {showAdmin && (
          <>
            <p
              className={`mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 ${
                collapsed ? "sr-only" : ""
              }`}
            >
              Админ
            </p>
            <NavLink
              to="/admin"
              title={collapsed ? "Администрирование" : undefined}
              className={({ isActive }) =>
                [
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  collapsed ? "justify-center" : "",
                  isActive
                    ? "bg-sky-500/15 text-sky-700 shadow-sm dark:bg-sky-400/10 dark:text-sky-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                ].join(" ")
              }
            >
              <Shield className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
              {!collapsed && <span>Администрирование</span>}
            </NavLink>
          </>
        )}
      </nav>

      <div className="border-t border-slate-200/80 p-2 dark:border-slate-700/80">
        <NavLink
          to="/settings"
          title={collapsed ? "Настройки" : undefined}
          className={({ isActive }) =>
            [
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              collapsed ? "justify-center" : "",
              isActive
                ? "bg-slate-200/80 text-slate-900 dark:bg-slate-800 dark:text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
            ].join(" ")
          }
        >
          <Settings className="h-5 w-5 shrink-0" aria-hidden />
          {!collapsed && <span>Настройки</span>}
        </NavLink>
      </div>
    </aside>
  );
}
