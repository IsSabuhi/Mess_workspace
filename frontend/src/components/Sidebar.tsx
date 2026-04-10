import {
  BookOpen,
  Briefcase,
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
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { canAdminAccess, PERM, hasPermission } from "../lib/permissions";

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

export function Sidebar({ collapsed, onToggleCollapse }: Props) {
  const { state } = useAuth();
  const showAdmin = state.status === "authenticated" && canAdminAccess(state.user);
  const showSchedule =
    state.status === "authenticated" && hasPermission(state.user, PERM.SCHEDULE_READ);
  const showEmployeeDirectory =
    state.status === "authenticated" &&
    (hasPermission(state.user, PERM.EMPLOYEE_DIRECTORY_READ) ||
      hasPermission(state.user, PERM.EMPLOYEE_DIRECTORY_MANAGE));

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
          <NavLink
            key={to}
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
        ))}
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
            title={collapsed ? "Справочник сотрудников" : undefined}
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
            {!collapsed && <span>Справочник сотрудников</span>}
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
