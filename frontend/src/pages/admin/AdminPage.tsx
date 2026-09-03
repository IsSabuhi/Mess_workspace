import { useCallback } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { AppShell } from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import { canAdminAccess } from "../../lib/permissions";
import { AuditLogSection } from "./AuditLogSection";
import { RolesSection } from "./RolesSection";
import { SystemSettingsSection } from "./SystemSettingsSection";
import { UsersSection } from "./UsersSection";

type Tab = "users" | "roles" | "system-settings" | "audit-log";

export function AdminPage() {
  const { state } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab =
    tabParam === "roles"
      ? "roles"
      : tabParam === "system-settings"
        ? "system-settings"
        : tabParam === "audit-log"
          ? "audit-log"
        : "users";

  const setTab = useCallback(
    (t: Tab) => {
      setParams({ tab: t }, { replace: true });
    },
    [setParams],
  );

  if (state.status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  const user = state.user;
  if (!canAdminAccess(user)) {
    return <Navigate to="/" replace />;
  }

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
        tab === id
          ? "bg-sky-500 text-white shadow-md"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <AppShell
      title="Администрирование"
      subtitle="Пользователи, роли и системные настройки"
    >
      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-1.5 dark:border-slate-700 dark:bg-slate-900/50">
        {tabBtn("users", "Пользователи")}
        {tabBtn("roles", "Роли и права")}
        {tabBtn("system-settings", "Настройки системы")}
        {tabBtn("audit-log", "Журнал аудита")}
      </div>

      {tab === "users" && <UsersSection />}
      {tab === "roles" && <RolesSection />}
      {tab === "system-settings" && <SystemSettingsSection />}
      {tab === "audit-log" && <AuditLogSection />}
    </AppShell>
  );
}
