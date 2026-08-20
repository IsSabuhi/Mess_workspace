import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, Eye, EyeOff, FileSpreadsheet, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import type { UserOut } from "../api/auth";
import { getAuditSettings, listAuditEvents, patchAuditSettings } from "../api/audit";
import {
  deleteSystemBackup,
  downloadSystemBackup,
  getBackupSettings,
  listSystemBackups,
  patchBackupSettings,
  requestSystemBackup,
} from "../api/backups";
import {
  getNotificationSettings,
  patchNotificationSettings,
} from "../api/notifications";
import type { PermissionOut, RoleCreate, RoleOut, RoleUpdate } from "../api/roles";
import {
  createRole,
  deleteRole,
  listPermissionsCatalog,
  listRoles,
  updateRole,
} from "../api/roles";
import type { PositionOut } from "../api/positions";
import { listPositions } from "../api/positions";
import type { SystemOut } from "../api/systems";
import { getTaskArchiveSettings, listSystems, updateTaskArchiveSettings } from "../api/systems";
import { importTasksFromExcel } from "../api/tasks";
import type { TaskExcelImportBatchOut } from "../api/tasks";
import type { UserCreate, UserListOut, UserUpdate } from "../api/users";
import { createUser, deleteUser, importUsersFromExcel, listUsers, updateUser } from "../api/users";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { auditActionLabel, formatAuditDetails } from "../lib/auditFormat";
import { invalidateAndRefetch } from "../lib/queryClient";
import { PERM, canAdminAccess, hasPermission } from "../lib/permissions";
import { toastApiError, toastError, toastSuccess } from "../lib/toast";
import { useToastQueryError } from "../lib/useToastQueryError";
import { useModalLayer } from "../lib/useModalLayer";

type Tab = "users" | "roles" | "system-settings" | "audit-log";

function groupPermissions(perms: PermissionOut[]): Map<string, PermissionOut[]> {
  const m = new Map<string, PermissionOut[]>();
  for (const p of perms) {
    const key = p.code.split(".")[0] || "other";
    const arr = m.get(key) ?? [];
    arr.push(p);
    m.set(key, arr);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.code.localeCompare(b.code));
  }
  return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

const PERM_GROUP_LABELS: Record<string, string> = {
  tasks: "Задачи",
  board: "Структура доски",
  systems: "Производственные системы",
  positions: "Должности",
  users: "Пользователи",
  roles: "Роли",
  knowledge: "База знаний",
  employee_directory: "Справочник сотрудников",
  schedule: "График",
  other: "Прочее",
};

function permissionGroupTitle(prefix: string): string {
  return PERM_GROUP_LABELS[prefix] ?? prefix;
}

function permissionCardTitle(p: PermissionOut): string {
  if (p.description?.trim()) {
    const line = p.description.split(/\r?\n/)[0]?.trim();
    if (line) return line;
  }
  return p.code.replace(/\./g, " · ");
}

function permissionCardSubtitle(p: PermissionOut): string {
  const lines = p.description?.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) ?? [];
  if (lines.length > 1) return lines.slice(1).join(" ");
  return p.code;
}

function PermToggle({
  checked,
  disabled,
  busy,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <label
      className={`relative inline-flex shrink-0 items-center ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled || busy}
        onChange={onChange}
        aria-label={ariaLabel}
        aria-checked={checked}
      />
      <span className="relative h-7 w-12 rounded-full bg-slate-200 transition peer-checked:bg-violet-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-400/60 dark:bg-slate-600">
        <span
          className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform dark:bg-slate-100 ${
            checked ? "translate-x-5" : "translate-x-0"
          } ${busy ? "opacity-70" : ""}`}
        />
      </span>
    </label>
  );
}

function RolesPermissionsBoard({
  roles,
  filteredRoles,
  perms,
  grouped,
  userCount,
  selectedId,
  onSelectRole,
  roleSearch,
  onRoleSearch,
  onCreateRole,
  onEditRole,
  onDeleteRole,
  onToggle,
  busyKey,
  canEditSystemRoles,
}: {
  roles: RoleOut[];
  filteredRoles: RoleOut[];
  perms: PermissionOut[];
  grouped: Map<string, PermissionOut[]>;
  userCount: number;
  selectedId: string | null;
  onSelectRole: (id: string) => void;
  roleSearch: string;
  onRoleSearch: (v: string) => void;
  onCreateRole: () => void;
  onEditRole: (r: RoleOut) => void;
  onDeleteRole: (r: RoleOut) => void;
  onToggle: (role: RoleOut, permId: string, next: boolean) => void;
  busyKey: string | null;
  canEditSystemRoles: boolean;
}) {
  const selected = selectedId ? roles.find((r) => r.id === selectedId) : null;

  return (
    <div className="flex h-[calc(100dvh-13.5rem)] min-h-[32rem] flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Управление ролями и правами
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Настройте права доступа для ролей в системе
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateRole}
          className="shrink-0 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
        >
          + Создать роль
        </button>
      </div>

      <div className="grid shrink-0 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-sky-200/80 bg-sky-50/90 px-4 py-3 dark:border-sky-900/50 dark:bg-sky-950/30">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-lg text-sky-600 dark:text-sky-400">
            ◎
          </span>
          <div>
            <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{roles.length}</p>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Всего ролей</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/90 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-lg text-emerald-600 dark:text-emerald-400">
            ◎
          </span>
          <div>
            <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{userCount}</p>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Пользователей</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-violet-200/80 bg-violet-50/90 px-4 py-3 dark:border-violet-900/50 dark:bg-violet-950/30">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-lg text-violet-600 dark:text-violet-400">
            ◎
          </span>
          <div>
            <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{perms.length}</p>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Всего прав</p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
        <aside className="flex min-h-[16rem] w-full flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-soft dark:border-slate-700 dark:bg-slate-900/60 lg:h-auto lg:w-72 lg:flex-none xl:w-80">
          <div className="shrink-0 border-b border-slate-200/80 px-4 py-3 dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Роли системы</p>
            <input
              type="search"
              value={roleSearch}
              onChange={(e) => onRoleSearch(e.target.value)}
              placeholder="Поиск ролей…"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
            {filteredRoles.map((r) => {
              const active = r.id === selectedId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRole(r.id)}
                    className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      active
                        ? "bg-fuchsia-500/15 ring-1 ring-fuchsia-400/50 dark:bg-fuchsia-500/20"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800/80"
                    }`}
                  >
                    {r.is_system && (
                      <span className="mt-0.5 text-slate-400" title="Системная роль">
                        🔒
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-900 dark:text-white">{r.name}</span>
                      <span className="block font-mono text-xs text-slate-500">{r.slug}</span>
                    </span>
                    <span
                      className="shrink-0 tabular-nums text-xs font-medium text-slate-500 dark:text-slate-400"
                      title="Пользователей с этой ролью"
                    >
                      {r.user_count}
                    </span>
                  </button>
                </li>
              );
            })}
            {!filteredRoles.length && (
              <li className="px-3 py-6 text-center text-sm text-slate-500">Ничего не найдено</li>
            )}
          </ul>
        </aside>

        <section className="flex min-h-[16rem] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          {!selected ? (
            <p className="m-auto p-8 text-center text-slate-500">Выберите роль слева</p>
          ) : (
            <>
              <div className="shrink-0 border-b border-slate-200/80 px-5 py-4 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{selected.name}</h3>
                      {selected.is_system && (
                        <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          Системная
                        </span>
                      )}
                      <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-200">
                        Глобальная
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">{selected.slug}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      Всего прав: {selected.permissions.length}
                    </span>
                    <span
                      className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
                      title="Пользователей с этой ролью"
                    >
                      Пользователей: {selected.user_count}
                    </span>
                    {selected.is_system && !canEditSystemRoles ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                        🔒 Только просмотр
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onEditRole(selected)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-400 dark:hover:bg-slate-700"
                    >
                      Карточка роли
                    </button>
                    {!selected.is_system && (
                      <button
                        type="button"
                        onClick={() => onDeleteRole(selected)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
                      >
                        Удалить роль
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain px-5 py-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Глобальные права
                </p>
                {[...grouped.entries()].map(([prefix, items]) => (
                  <div key={prefix}>
                    <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {permissionGroupTitle(prefix)}
                    </h4>
                    <div className="space-y-3">
                      {items.map((p) => {
                        const has = selected.permissions.some((x) => x.id === p.id);
                        const disabled = selected.is_system && !canEditSystemRoles;
                        const busy = busyKey === `${selected.id}:${p.id}`;
                        return (
                          <div
                            key={p.id}
                            className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200/90 bg-slate-50/80 px-4 py-3 dark:border-slate-600/80 dark:bg-slate-800/40"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 dark:text-white">
                                {permissionCardTitle(p)}
                              </p>
                              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                                {permissionCardSubtitle(p)}
                              </p>
                            </div>
                            <PermToggle
                              checked={has}
                              disabled={disabled}
                              busy={busy}
                              onChange={() => {
                                if (!disabled) onToggle(selected, p.id, !has);
                              }}
                              ariaLabel={`${has ? "Отключить" : "Включить"} право ${p.code}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

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

  const showUsers = hasPermission(user, PERM.USERS_MANAGE);
  const showRoles = hasPermission(user, PERM.ROLES_MANAGE);
  // Настройки системы и журнал аудита — только у тех, кто уже в админке (users/roles).
  const canManageTaskArchive = canAdminAccess(user);

  useEffect(() => {
    const visibleTabs: Tab[] = [];
    if (showUsers) visibleTabs.push("users");
    if (showRoles) visibleTabs.push("roles");
    if (canManageTaskArchive) visibleTabs.push("system-settings");
    if (canManageTaskArchive) visibleTabs.push("audit-log");
    if (!visibleTabs.length) return;
    if (!visibleTabs.includes(tab)) {
      setTab(visibleTabs[0]);
    }
  }, [showUsers, showRoles, canManageTaskArchive, tab, setTab]);

  return (
    <AppShell
      title="Администрирование"
      subtitle="Пользователи, роли и системные настройки"
    >
      {(showUsers || showRoles || canManageTaskArchive) && (
        <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-1.5 dark:border-slate-700 dark:bg-slate-900/50">
          {showUsers && (
            <button
              type="button"
              onClick={() => setTab("users")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === "users"
                  ? "bg-sky-500 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              Пользователи
            </button>
          )}
          {showRoles && (
            <button
              type="button"
              onClick={() => setTab("roles")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === "roles"
                  ? "bg-sky-500 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              Роли и права
            </button>
          )}
          {canManageTaskArchive && (
            <button
              type="button"
              onClick={() => setTab("system-settings")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === "system-settings"
                  ? "bg-sky-500 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              Настройки системы
            </button>
          )}
          {canManageTaskArchive && (
            <button
              type="button"
              onClick={() => setTab("audit-log")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === "audit-log"
                  ? "bg-sky-500 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              Журнал аудита
            </button>
          )}
        </div>
      )}

      {tab === "users" && showUsers && <UsersSection />}
      {tab === "roles" && showRoles && <RolesSection />}
      {tab === "system-settings" && canManageTaskArchive && <SystemSettingsSection />}
      {tab === "audit-log" && canManageTaskArchive && <AuditLogSection />}
    </AppShell>
  );
}

function SystemSettingsSection() {
  const { state } = useAuth();
  const currentUser = state.status === "authenticated" ? state.user : null;
  const canImportUsers = !!(currentUser && hasPermission(currentUser, PERM.USERS_MANAGE));
  const qc = useQueryClient();
  const [autoArchiveDays, setAutoArchiveDays] = useState("60");
  const [auditRetentionDays, setAuditRetentionDays] = useState("180");
  const [notifReadDays, setNotifReadDays] = useState("90");
  const [notifUnreadDays, setNotifUnreadDays] = useState("180");
  const [notifNoteDays, setNotifNoteDays] = useState("30");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResultOpen, setImportResultOpen] = useState(false);
  const [taskImportOpen, setTaskImportOpen] = useState(false);
  const [taskImportFiles, setTaskImportFiles] = useState<File[]>([]);
  const [taskImportSystemId, setTaskImportSystemId] = useState("");
  const [taskImportSheet, setTaskImportSheet] = useState("");
  const [taskImportResult, setTaskImportResult] = useState<TaskExcelImportBatchOut | null>(null);
  const taskArchiveQuery = useQuery({
    queryKey: ["admin", "task-archive-settings"],
    queryFn: getTaskArchiveSettings,
  });
  const auditSettingsQuery = useQuery({
    queryKey: ["admin", "audit-settings"],
    queryFn: getAuditSettings,
  });
  const notificationSettingsQuery = useQuery({
    queryKey: ["admin", "notification-settings"],
    queryFn: getNotificationSettings,
  });
  useToastQueryError(taskArchiveQuery.error, "Не удалось загрузить настройки автоархивации");
  useToastQueryError(auditSettingsQuery.error, "Не удалось загрузить настройки аудита");
  useToastQueryError(notificationSettingsQuery.error, "Не удалось загрузить настройки уведомлений");
  useEffect(() => {
    if (!taskArchiveQuery.data) return;
    setAutoArchiveDays(String(taskArchiveQuery.data.auto_archive_done_days));
  }, [taskArchiveQuery.data]);
  useEffect(() => {
    if (!auditSettingsQuery.data) return;
    setAuditRetentionDays(String(auditSettingsQuery.data.retention_days));
  }, [auditSettingsQuery.data]);
  useEffect(() => {
    if (!notificationSettingsQuery.data) return;
    setNotifReadDays(String(notificationSettingsQuery.data.read_days));
    setNotifUnreadDays(String(notificationSettingsQuery.data.unread_days));
    setNotifNoteDays(String(notificationSettingsQuery.data.note_reminder_days));
  }, [notificationSettingsQuery.data]);
  const taskArchiveMut = useMutation({
    mutationFn: (days: number) => updateTaskArchiveSettings(days),
    onSuccess: async (saved) => {
      setAutoArchiveDays(String(saved.auto_archive_done_days));
      toastSuccess("Период автоархивации сохранён");
      await qc.invalidateQueries({ queryKey: ["admin", "task-archive-settings"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить период автоархивации"),
  });
  const auditSettingsMut = useMutation({
    mutationFn: (body: { enabled?: boolean; retention_days?: number }) => patchAuditSettings(body),
    onSuccess: async (saved) => {
      setAuditRetentionDays(String(saved.retention_days));
      toastSuccess("Настройки аудита сохранены");
      await qc.invalidateQueries({ queryKey: ["admin", "audit-settings"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить настройки аудита"),
  });
  const notificationSettingsMut = useMutation({
    mutationFn: (body: {
      enabled?: boolean;
      read_days?: number;
      unread_days?: number;
      note_reminder_days?: number;
    }) => patchNotificationSettings(body),
    onSuccess: async (saved) => {
      setNotifReadDays(String(saved.read_days));
      setNotifUnreadDays(String(saved.unread_days));
      setNotifNoteDays(String(saved.note_reminder_days));
      toastSuccess("Настройки уведомлений сохранены");
      await qc.invalidateQueries({ queryKey: ["admin", "notification-settings"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить настройки уведомлений"),
  });
  const importUsersMut = useMutation({
    mutationFn: (file: File) => importUsersFromExcel(file),
    onSuccess: async () => {
      toastSuccess("Импорт сотрудников завершён");
      setImportResultOpen(true);
      setImportFile(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      await qc.invalidateQueries({ queryKey: ["users", "assignee-candidates"] });
      await qc.invalidateQueries({ queryKey: ["employee-directory"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось импортировать сотрудников"),
  });

  const systemsForImportQuery = useQuery({
    queryKey: ["systems", "task-import"],
    queryFn: () => listSystems(true),
    enabled: taskImportOpen,
  });

  const importTasksMut = useMutation({
    mutationFn: () => {
      if (!taskImportFiles.length) {
        return Promise.reject(new Error("Выберите файл(ы)"));
      }
      if (taskImportFiles.length === 1 && !taskImportSystemId) {
        // система опциональна — бэкенд попробует сопоставить сам
      }
      return importTasksFromExcel({
        files: taskImportFiles,
        systemId: taskImportFiles.length === 1 ? taskImportSystemId || undefined : undefined,
        sheetName: taskImportSheet || undefined,
      });
    },
    onSuccess: async (data) => {
      setTaskImportResult(data);
      toastSuccess(
        `Файлов: ${data.files_ok}/${data.files_total}, задач создано: ${data.created_total}` +
          (data.files_failed ? `, ошибок: ${data.files_failed}` : ""),
      );
      setTaskImportFiles([]);
      setTaskImportOpen(false);
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось импортировать задачи"),
  });

  const { backdropProps: taskImportBackdrop, stopPanelPointer: taskImportPanelStop } = useModalLayer(
    taskImportOpen,
    () => {
      if (!importTasksMut.isPending) setTaskImportOpen(false);
    },
    {
      closeOnBackdrop: !importTasksMut.isPending,
      closeOnEscape: !importTasksMut.isPending,
    },
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Автоархивация выполненных задач</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Задачи в колонке «выполнено» автоматически переходят в архив после указанного периода.
        </p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = Number(autoArchiveDays);
            if (!Number.isFinite(parsed) || parsed < 1) {
              toastError("Введите число дней от 1");
              return;
            }
            taskArchiveMut.mutate(Math.floor(parsed));
          }}
        >
          <label className="text-sm text-slate-700 dark:text-slate-300">
            Период (дней)
            <input
              type="number"
              min={1}
              max={3650}
              value={autoArchiveDays}
              onChange={(e) => setAutoArchiveDays(e.target.value)}
              disabled={taskArchiveQuery.isPending || taskArchiveMut.isPending}
              className="ml-2 w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <button
            type="submit"
            disabled={taskArchiveQuery.isPending || taskArchiveMut.isPending}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
          >
            {taskArchiveMut.isPending ? "Сохранение…" : "Сохранить"}
          </button>
        </form>
      </div>
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Аудит действий</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Управление настройками аудита по системе: можно отключить запись и настроить срок хранения.
        </p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={auditSettingsQuery.data?.enabled ?? true}
              disabled={auditSettingsQuery.isPending || auditSettingsMut.isPending}
              onChange={(e) => auditSettingsMut.mutate({ enabled: e.target.checked })}
            />
            Включить аудит
          </label>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = Number(auditRetentionDays);
              if (!Number.isFinite(parsed) || parsed < 7) {
                toastError("Введите число дней от 7");
                return;
              }
              auditSettingsMut.mutate({ retention_days: Math.floor(parsed) });
            }}
          >
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Срок хранения (дней)
              <input
                type="number"
                min={7}
                max={3650}
                value={auditRetentionDays}
                onChange={(e) => setAuditRetentionDays(e.target.value)}
                disabled={auditSettingsQuery.isPending || auditSettingsMut.isPending}
                className="ml-2 w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <button
              type="submit"
              disabled={auditSettingsQuery.isPending || auditSettingsMut.isPending}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
            >
              {auditSettingsMut.isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </form>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Хранение уведомлений</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Ротация старых уведомлений. Прочитанные удаляются раньше непрочитанных. Напоминания по личным
          заметкам хранятся отдельно — ежедневные копятся быстрее.
        </p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={notificationSettingsQuery.data?.enabled ?? true}
              disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
              onChange={(e) => notificationSettingsMut.mutate({ enabled: e.target.checked })}
            />
            Включить ротацию
          </label>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const readDays = Number(notifReadDays);
              const unreadDays = Number(notifUnreadDays);
              const noteDays = Number(notifNoteDays);
              if (
                ![readDays, unreadDays, noteDays].every((n) => Number.isFinite(n) && n >= 7)
              ) {
                toastError("Введите число дней от 7");
                return;
              }
              notificationSettingsMut.mutate({
                read_days: Math.floor(readDays),
                unread_days: Math.floor(unreadDays),
                note_reminder_days: Math.floor(noteDays),
              });
            }}
          >
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Прочитанные (дней)
              <input
                type="number"
                min={7}
                max={3650}
                value={notifReadDays}
                onChange={(e) => setNotifReadDays(e.target.value)}
                disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
                className="ml-2 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Непрочитанные (дней)
              <input
                type="number"
                min={7}
                max={3650}
                value={notifUnreadDays}
                onChange={(e) => setNotifUnreadDays(e.target.value)}
                disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
                className="ml-2 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Напоминания по заметкам (дней)
              <input
                type="number"
                min={7}
                max={3650}
                value={notifNoteDays}
                onChange={(e) => setNotifNoteDays(e.target.value)}
                disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
                className="ml-2 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <button
              type="submit"
              disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
            >
              {notificationSettingsMut.isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </form>
        </div>
      </div>
      <DatabaseBackupSection />
      {canImportUsers && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Импорт сотрудников из Excel</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Файл `.xlsx`, первый лист. Обязательные колонки: «УчетнаяЗапись», «ФИО», «Должность». Дополнительно:
            «Подразделение», «Системы» (несколько через запятую). Скачайте шаблон, заполните и загрузите его сюда.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                try {
                  const { downloadEmployeeImportTemplate } = await import("../lib/exportEmployeeImportTemplate");
                  await downloadEmployeeImportTemplate();
                  toastSuccess("Шаблон Excel скачан");
                } catch (e: unknown) {
                  toastApiError(e, "Не удалось сформировать шаблон");
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              Скачать шаблон
            </button>
          </div>
          <form
            className="mt-3 flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!importFile) {
                toastError("Выберите файл Excel");
                return;
              }
              importUsersMut.mutate(importFile);
            }}
          >
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              disabled={importUsersMut.isPending}
              className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="submit"
              disabled={importUsersMut.isPending || !importFile}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
            >
              {importUsersMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Импорт…
                </>
              ) : (
                "Импортировать"
              )}
            </button>
          </form>

          {importUsersMut.data && importResultOpen && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
              <p className="font-medium text-slate-900 dark:text-white">
                Результат: создано {importUsersMut.data.created}, обновлено {importUsersMut.data.updated}, пропущено{" "}
                {importUsersMut.data.skipped}.
              </p>
              <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100/90 dark:bg-slate-800/90">
                    <tr>
                      <th className="px-2 py-1.5">Строка</th>
                      <th className="px-2 py-1.5">Логин</th>
                      <th className="px-2 py-1.5">Статус</th>
                      <th className="px-2 py-1.5">Комментарий</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {importUsersMut.data.rows.map((row) => (
                      <tr key={`${row.sheet_row}-${row.login ?? "empty"}`}>
                        <td className="px-2 py-1.5">{row.sheet_row}</td>
                        <td className="px-2 py-1.5">{row.login ?? "—"}</td>
                        <td className="px-2 py-1.5">{row.status}</td>
                        <td className="px-2 py-1.5">{row.message ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => setImportResultOpen(false)}
                className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Скрыть детали
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Импорт задач из задачника Excel</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Можно загрузить <strong>несколько файлов</strong> сразу (по одному на систему). Система определяется по
          имени файла/листа (например «Задачник СМЗиС.xlsx» → СМЗиС).
        </p>
        <button
          type="button"
          onClick={() => {
            setTaskImportResult(null);
            setTaskImportFiles([]);
            setTaskImportSystemId("");
            setTaskImportOpen(true);
          }}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-200/90 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-emerald-400 hover:via-teal-400 hover:to-cyan-500"
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
          Из Excel…
        </button>
        {taskImportResult && (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <p className="font-medium text-slate-900 dark:text-white">
              Итого: файлов ок {taskImportResult.files_ok}/{taskImportResult.files_total}, создано задач{" "}
              {taskImportResult.created_total}, предупреждений {taskImportResult.warnings_total}
              {taskImportResult.files_failed ? `, ошибок файлов ${taskImportResult.files_failed}` : ""}.
            </p>
            {taskImportResult.files.map((f) => (
              <div
                key={f.filename}
                className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/60"
              >
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  {f.filename}
                  {f.ok && f.result
                    ? ` → ${f.result.system_name} (лист «${f.result.sheet_name}», +${f.result.created})`
                    : null}
                  {!f.ok ? (
                    <span className="font-normal text-red-600 dark:text-red-400"> — {f.error}</span>
                  ) : null}
                </p>
                {f.ok && f.result && f.result.rows.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100/90 dark:bg-slate-800/90">
                        <tr>
                          <th className="px-2 py-1">Строка</th>
                          <th className="px-2 py-1">Задача</th>
                          <th className="px-2 py-1">Статус</th>
                          <th className="px-2 py-1">Комментарий</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {f.result.rows.map((row) => (
                          <tr key={`${f.filename}-${row.row}-${row.task_id ?? row.title}`}>
                            <td className="px-2 py-1">{row.row}</td>
                            <td className="px-2 py-1">{row.title}</td>
                            <td className="px-2 py-1">{row.status}</td>
                            <td className="px-2 py-1">{row.message ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setTaskImportResult(null)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              Скрыть детали
            </button>
          </div>
        )}
      </div>

      {taskImportOpen && (
        <div
          {...taskImportBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
        >
          <div
            className="modal-panel w-full max-w-md overflow-hidden rounded-2xl border border-emerald-200/60 shadow-2xl dark:border-emerald-900/40"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-import-title"
            onClick={taskImportPanelStop}
          >
            <div className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 dark:border-emerald-900/50 dark:from-emerald-950/50 dark:to-teal-950/40">
              <h2
                id="task-import-title"
                className="flex items-center gap-2 text-lg font-semibold text-emerald-950 dark:text-emerald-100"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200">
                  <FileSpreadsheet className="h-5 w-5" aria-hidden />
                </span>
                Импорт задачников
              </h2>
              <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
                Выберите один или несколько .xlsx — система подставится по имени файла/листа.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block text-sm text-slate-700 dark:text-slate-200">
                Файлы .xlsx
                <input
                  key={taskImportFiles.map((f) => f.name).join("|") || "task-empty"}
                  type="file"
                  multiple
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="mt-1.5 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-900 dark:text-slate-300 dark:file:bg-emerald-900/40 dark:file:text-emerald-100"
                  onChange={(e) => setTaskImportFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              {taskImportFiles.length > 0 && (
                <ul className="max-h-28 list-inside list-disc overflow-auto text-xs text-slate-600 dark:text-slate-300">
                  {taskImportFiles.map((f) => (
                    <li key={f.name + f.size}>{f.name}</li>
                  ))}
                </ul>
              )}
              {taskImportFiles.length === 1 && (
                <label className="block text-sm text-slate-700 dark:text-slate-200">
                  Система (если авто-определение не сработает)
                  <select
                    value={taskImportSystemId}
                    onChange={(e) => setTaskImportSystemId(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="">— авто по имени файла/листа —</option>
                    {(systemsForImportQuery.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm text-slate-700 dark:text-slate-200">
                Лист (необязательно, для всех файлов)
                <input
                  value={taskImportSheet}
                  onChange={(e) => setTaskImportSheet(e.target.value)}
                  placeholder="Иначе первый лист с данными в каждом файле"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={() => !importTasksMut.isPending && setTaskImportOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!taskImportFiles.length || importTasksMut.isPending}
                onClick={() => importTasksMut.mutate()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md disabled:opacity-50"
              >
                {importTasksMut.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Загрузка…
                  </>
                ) : (
                  `Импортировать (${taskImportFiles.length || 0})`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBackupSize(n: number | null): string {
  if (n == null || n < 0) return "—";
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

function backupStatusLabel(status: string): string {
  if (status === "pending") return "В очереди";
  if (status === "running") return "Создаётся…";
  if (status === "completed") return "Готов";
  if (status === "failed") return "Ошибка";
  return status;
}

function DatabaseBackupSection() {
  const qc = useQueryClient();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState("10");
  const [backupTime, setBackupTime] = useState("03:00");
  const backupsQuery = useQuery({
    queryKey: ["admin", "system-backups"],
    queryFn: listSystemBackups,
    refetchInterval: (q) => {
      const rows = q.state.data;
      if (rows?.some((r) => r.status === "pending" || r.status === "running")) return 2500;
      return false;
    },
  });
  const settingsQuery = useQuery({
    queryKey: ["admin", "backup-settings"],
    queryFn: getBackupSettings,
  });
  useToastQueryError(backupsQuery.error, "Не удалось загрузить список резервных копий");
  useToastQueryError(settingsQuery.error, "Не удалось загрузить настройки резервных копий");
  useEffect(() => {
    if (!settingsQuery.data) return;
    setRetentionDays(String(settingsQuery.data.retention_days));
    setBackupTime(settingsQuery.data.run_at || "03:00");
  }, [settingsQuery.data]);
  const createMut = useMutation({
    mutationFn: requestSystemBackup,
    onSuccess: async () => {
      toastSuccess("Дамп поставлен в очередь. Обычно занимает от нескольких секунд до нескольких минут.");
      await qc.invalidateQueries({ queryKey: ["admin", "system-backups"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось запустить резервное копирование"),
  });
  const deleteMut = useMutation({
    mutationFn: deleteSystemBackup,
    onSuccess: async () => {
      toastSuccess("Резервная копия удалена");
      await qc.invalidateQueries({ queryKey: ["admin", "system-backups"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить резервную копию"),
  });
  const settingsMut = useMutation({
    mutationFn: (body: { enabled?: boolean; retention_days?: number; run_at?: string }) =>
      patchBackupSettings(body),
    onSuccess: async (saved) => {
      setRetentionDays(String(saved.retention_days));
      setBackupTime(saved.run_at);
      toastSuccess("Настройки резервных копий сохранены");
      await qc.invalidateQueries({ queryKey: ["admin", "backup-settings"] });
      await qc.invalidateQueries({ queryKey: ["admin", "system-backups"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить настройки резервных копий"),
  });
  const rows = backupsQuery.data ?? [];
  const busy = rows.some((r) => r.status === "pending" || r.status === "running");
  const settings = settingsQuery.data;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
        <Database className="h-4 w-4 shrink-0" aria-hidden />
        Резервные копии базы данных
      </h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Полный дамп PostgreSQL (формат pg_dump custom). Картинки базы знаний
        и вложения в дамп не входят.
      </p>
      <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/40">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={settings?.enabled ?? true}
            disabled={settingsQuery.isPending || settingsMut.isPending}
            onChange={(e) => settingsMut.mutate({ enabled: e.target.checked })}
          />
          Ежедневный автоматический бэкап
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Один успешный дамп в сутки. Если сегодня уже есть готовая копия (в том числе ручная), повторно не
          создаётся. Если воркер пропустил время — догонит позже в тот же день. 24-часовой формат по UTC+7:
          07:00 — утро, 19:00 — вечер.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const days = Number(retentionDays);
            const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(backupTime.trim());
            if (!Number.isFinite(days) || days < 1 || days > 365) {
              toastError("Срок хранения: от 1 до 365 дней");
              return;
            }
            if (!match) {
              toastError("Укажите время в формате ЧЧ:ММ, например 07:00 или 19:30");
              return;
            }
            settingsMut.mutate({
              retention_days: Math.floor(days),
              run_at: `${match[1].padStart(2, "0")}:${match[2]}`,
            });
          }}
        >
          <label className="text-sm text-slate-700 dark:text-slate-300">
            Хранить (дней)
            <input
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              disabled={settingsQuery.isPending || settingsMut.isPending}
              className="ml-2 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <label className="text-sm text-slate-700 dark:text-slate-300">
            Время запуска
            <input
              type="time"
              lang="ru"
              step={60}
              value={backupTime}
              onChange={(e) => setBackupTime(e.target.value)}
              disabled={settingsQuery.isPending || settingsMut.isPending}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <button
            type="submit"
            disabled={settingsQuery.isPending || settingsMut.isPending}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
          >
            {settingsMut.isPending ? "Сохранение…" : "Сохранить"}
          </button>
        </form>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Место на диске ≈ число дней × размер одного дампа
          {settings?.estimated_bytes != null
            ? ` (сейчас около ${formatBackupSize(settings.estimated_bytes)})`
            : " — оценка появится после первого успешного дампа"}
          . Ручные копии за эти дни тоже занимают место. Старые удаляются автоматически.
        </p>
      </div>
      <div className="mt-4">
        <button
          type="button"
          disabled={createMut.isPending || busy}
          onClick={() => createMut.mutate()}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
        >
          {createMut.isPending || busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {busy ? "Идёт создание…" : "Запуск…"}
            </>
          ) : (
            "Создать резервную копию"
          )}
        </button>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Файл</th>
              <th className="px-3 py-2">Создан</th>
              <th className="px-3 py-2">Размер</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {backupsQuery.isPending && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-slate-500">
                  Загрузка…
                </td>
              </tr>
            )}
            {!backupsQuery.isPending && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-slate-500">
                  Пока нет резервных копий
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                  <div>{row.filename}</div>
                  {row.created_by_name && (
                    <div className="text-xs font-normal text-slate-500">{row.created_by_name}</div>
                  )}
                  {row.status === "failed" && row.error_message && (
                    <div className="mt-1 max-w-md text-xs font-normal text-rose-600 dark:text-rose-400">
                      {row.error_message}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                  {new Date(row.created_at).toLocaleString("ru-RU")}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                  {formatBackupSize(row.size_bytes)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={
                      row.status === "completed"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : row.status === "failed"
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-sky-700 dark:text-sky-400"
                    }
                  >
                    {backupStatusLabel(row.status)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={row.status !== "completed" || downloadingId === row.id}
                      onClick={async () => {
                        setDownloadingId(row.id);
                        try {
                          await downloadSystemBackup(row.id, row.filename);
                          toastSuccess("Файл скачан");
                        } catch (e: unknown) {
                          toastApiError(e, "Не удалось скачать дамп");
                        } finally {
                          setDownloadingId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {downloadingId === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Скачать
                    </button>
                    <button
                      type="button"
                      disabled={
                        deleteMut.isPending || row.status === "pending" || row.status === "running"
                      }
                      onClick={() => {
                        if (!window.confirm(`Удалить ${row.filename}?`)) return;
                        deleteMut.mutate(row.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:bg-slate-800 dark:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        <p className="font-medium text-slate-800 dark:text-slate-200">Как восстановить на новой установке</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4">
          <li>Поднимите Postgres, создайте пустую базу. Api и worker пока не запускайте (или остановите).</li>
          <li>
            Положите скачанный <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">.dump</code> на
            сервер. Если дамп уже на сервере — том Docker <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">backup_data</code>{" "}
            монтируется в <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">/backups</code>.
          </li>
          <li>
            Восстановление:{" "}
            <code className="break-all rounded bg-slate-200 px-1 dark:bg-slate-700">
              docker compose --profile jobs run --rm api-job scripts/restore_database_backup.py /backups/файл.dump
              --clean
            </code>
          </li>
          <li>Запустите api и worker. Миграции Alembic догонят схему, если дамп чуть старше.</li>
        </ol>
        <p className="mt-2">
          Из интерфейса восстановление специально не делается: команда затирает живую базу. Флаг{" "}
          <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">--clean</code> нужен, если в базе уже есть
          таблицы.
        </p>
      </div>
    </div>
  );
}

function AuditLogSection() {
  const [auditFilterEntityType, setAuditFilterEntityType] = useState("");
  const [auditFilterAction, setAuditFilterAction] = useState("");
  const [auditFilterQuery, setAuditFilterQuery] = useState("");
  /** "" = все, "__system__" = без автора, иначе UUID пользователя */
  const [auditFilterActor, setAuditFilterActor] = useState("");
  const [auditFilterActorQ, setAuditFilterActorQ] = useState("");

  const usersQuery = useQuery({
    queryKey: ["admin", "users", "audit-filter"],
    queryFn: () => listUsers({ limit: 500, offset: 0 }),
  });
  const actorUsers = useMemo(() => {
    const rows = usersQuery.data?.items ?? [];
    return [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
  }, [usersQuery.data]);

  const auditEventsQuery = useQuery({
    queryKey: [
      "admin",
      "audit-events",
      auditFilterEntityType,
      auditFilterAction,
      auditFilterQuery,
      auditFilterActor,
      auditFilterActorQ,
    ],
    queryFn: () =>
      listAuditEvents({
        limit: 200,
        entity_type: auditFilterEntityType || undefined,
        action: auditFilterAction || undefined,
        q: auditFilterQuery || undefined,
        actor_user_id:
          auditFilterActor && auditFilterActor !== "__system__" ? auditFilterActor : undefined,
        system_only: auditFilterActor === "__system__" || undefined,
        actor_q: auditFilterActorQ || undefined,
      }),
  });
  useToastQueryError(auditEventsQuery.error, "Не удалось загрузить журнал аудита");

  const hasAuditFilters =
    !!auditFilterEntityType.trim() ||
    !!auditFilterAction.trim() ||
    !!auditFilterQuery.trim() ||
    !!auditFilterActor ||
    !!auditFilterActorQ.trim();

  return (
    <div className="flex h-[calc(100dvh-13.5rem)] min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="shrink-0 text-base font-semibold text-slate-900 dark:text-white">Журнал аудита</h3>
      <p className="mt-1 shrink-0 text-sm text-slate-600 dark:text-slate-400">
        Общий журнал событий по системе. Используйте фильтры для поиска нужных действий и пользователей.
      </p>
      <div className="mt-4 mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <input
          value={auditFilterEntityType}
          onChange={(e) => setAuditFilterEntityType(e.target.value)}
          placeholder="Тип сущности (например board)"
          className="w-52 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          value={auditFilterAction}
          onChange={(e) => setAuditFilterAction(e.target.value)}
          placeholder="Действие (например board.updated)"
          className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <select
          value={auditFilterActor}
          onChange={(e) => setAuditFilterActor(e.target.value)}
          className="min-w-[14rem] max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          title="Фильтр по столбцу «Кто»"
        >
          <option value="">Кто: все</option>
          <option value="__system__">Кто: Система</option>
          {actorUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name} ({u.email})
            </option>
          ))}
        </select>
        <input
          value={auditFilterActorQ}
          onChange={(e) => setAuditFilterActorQ(e.target.value)}
          placeholder="Кто: поиск по ФИО / email"
          className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          value={auditFilterQuery}
          onChange={(e) => setAuditFilterQuery(e.target.value)}
          placeholder="Поиск по действию/деталям"
          className="min-w-[14rem] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        {hasAuditFilters && (
          <button
            type="button"
            onClick={() => {
              setAuditFilterEntityType("");
              setAuditFilterAction("");
              setAuditFilterQuery("");
              setAuditFilterActor("");
              setAuditFilterActorQ("");
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Сбросить
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Время</th>
              <th className="px-3 py-2">Сущность</th>
              <th className="px-3 py-2">Действие</th>
              <th className="px-3 py-2">Кто</th>
              <th className="px-3 py-2">Детали</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {(auditEventsQuery.data ?? []).map((ev) => (
              <tr key={ev.id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                  {new Date(ev.created_at).toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2 text-xs">
                  {ev.entity_type}
                  {ev.entity_id ? `:${String(ev.entity_id).slice(0, 8)}` : ""}
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{auditActionLabel(ev.action)}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">{ev.action}</p>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{ev.actor_name ?? "Система"}</td>
                <td className="max-w-md px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                  {formatAuditDetails(ev.action, ev.details_json)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!auditEventsQuery.isPending && (auditEventsQuery.data ?? []).length === 0 && (
          <p className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">Событий аудита по фильтрам не найдено.</p>
        )}
        {auditEventsQuery.isPending && (
          <p className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">Загрузка журнала аудита…</p>
        )}
      </div>
    </div>
  );
}

const USERS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function UsersSection() {
  const { state: authState } = useAuth();
  const currentUserId = authState.status === "authenticated" ? authState.user.id : "";
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserOut | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof USERS_PAGE_SIZE_OPTIONS)[number]>(50);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(userSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [userSearch]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, pageSize]);

  const usersQuery = useQuery({
    queryKey: ["admin", "users", page, pageSize, debouncedSearch],
    queryFn: () =>
      listUsers({
        limit: pageSize,
        offset: page * pageSize,
        q: debouncedSearch || undefined,
      }),
    placeholderData: (prev) => prev,
  });
  const rolesQuery = useQuery({ queryKey: ["admin", "roles"], queryFn: listRoles });
  const positionsQuery = useQuery({ queryKey: ["positions", "dropdown"], queryFn: () => listPositions(true) });
  const systemsQuery = useQuery({ queryKey: ["systems", "admin-users"], queryFn: () => listSystems(true) });

  const pageData: UserListOut | undefined = usersQuery.data;
  const users = pageData?.items ?? [];
  const total = pageData?.total ?? 0;
  const roles = rolesQuery.data ?? [];
  const positions = positionsQuery.data ?? [];
  const systems = systemsQuery.data ?? [];
  const bootLoading =
    (usersQuery.isPending && !pageData) ||
    rolesQuery.isPending ||
    positionsQuery.isPending ||
    systemsQuery.isPending;
  useToastQueryError(usersQuery.error, "Не удалось загрузить пользователей");
  useToastQueryError(rolesQuery.error, "Не удалось загрузить роли");
  useToastQueryError(positionsQuery.error, "Не удалось загрузить должности");
  useToastQueryError(systemsQuery.error, "Не удалось загрузить системы");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeFrom = total === 0 ? 0 : page * pageSize + 1;
  const rangeTo = Math.min(total, (page + 1) * pageSize);

  useEffect(() => {
    if (page > 0 && page >= totalPages) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);

  const refreshUsers = async () => {
    await invalidateAndRefetch(qc, ["admin", "users"]);
    await qc.invalidateQueries({ queryKey: ["admin", "users", "audit-filter"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Учётные записи, роли и производственные системы. По системам ограничивается видимость задач на доске (кроме
          ролей с полным доступом к задачам).
        </p>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
        >
          + Пользователь
        </button>
      </div>

      {bootLoading && <p className="text-slate-500">Загрузка…</p>}

      {!bootLoading && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Поиск по ФИО или email…"
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              autoComplete="off"
            />
            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              На странице
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as (typeof USERS_PAGE_SIZE_OPTIONS)[number])}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                {USERS_PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {usersQuery.isFetching && !usersQuery.isPending && (
              <span className="text-xs text-slate-400">Обновление…</span>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 font-semibold">Сотрудник</th>
                  <th className="px-4 py-3 font-semibold">Должность</th>
                  <th className="px-4 py-3 font-semibold">Системы</th>
                  <th className="px-4 py-3 font-semibold">Роли</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-4 py-3 font-semibold text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      {debouncedSearch ? "Ничего не найдено по запросу." : "Пользователей пока нет."}
                    </td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{u.full_name}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {u.position?.name ?? "—"}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {u.systems?.length ? u.systems.map((s) => s.name).join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {u.roles.length ? u.roles.map((r) => r.name).join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.is_active
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                            : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {u.is_active ? "активен" : "выкл"}
                      </span>
                      {u.is_superuser && (
                        <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                          superuser
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setEditUser(u)}
                        className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
                      >
                        Изменить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
            <p>
              {total === 0
                ? "Нет записей"
                : `Показано ${rangeFrom}–${rangeTo} из ${total}`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 0 || usersQuery.isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Назад
              </button>
              <span className="tabular-nums text-xs">
                стр. {Math.min(page + 1, totalPages)} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page + 1 >= totalPages || usersQuery.isFetching}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Вперёд
              </button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <UserFormModal
          title="Новый пользователь"
          roles={roles}
          positions={positions}
          systems={systems}
          onClose={() => setCreateOpen(false)}
          onCreate={async (data) => {
            await createUser(data);
            setCreateOpen(false);
            setPage(0);
            await refreshUsers();
          }}
        />
      )}

      {editUser && (
        <UserFormModal
          title="Редактирование"
          roles={roles}
          positions={positions}
          systems={systems}
          initial={editUser}
          currentUserId={currentUserId}
          onClose={() => setEditUser(null)}
          onUpdate={async (data) => {
            await updateUser(editUser.id, data);
            setEditUser(null);
            await refreshUsers();
          }}
          onDelete={async () => {
            await deleteUser(editUser.id);
            setEditUser(null);
            await refreshUsers();
            await qc.invalidateQueries({ queryKey: ["employee-directory"] });
            await qc.invalidateQueries({ queryKey: ["schedule"] });
            await qc.invalidateQueries({ queryKey: ["users", "assignee-candidates"] });
          }}
        />
      )}
    </div>
  );
}

function UserFormModal({
  title,
  roles,
  positions,
  systems,
  initial,
  currentUserId,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  title: string;
  roles: RoleOut[];
  positions: PositionOut[];
  systems: SystemOut[];
  initial?: UserOut;
  /** Для скрытия удаления «себя» */
  currentUserId?: string;
  onClose: () => void;
  onCreate?: (data: UserCreate) => Promise<void>;
  onUpdate?: (data: UserUpdate) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [positionId, setPositionId] = useState(initial?.position?.id ?? "");
  const [birthDate, setBirthDate] = useState(
    initial?.birth_date ? initial.birth_date.slice(0, 10) : "",
  );
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  /** После сброса/задания пароля — показать модалку смены при входе (по умолчанию да). */
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [isSuperuser, setIsSuperuser] = useState(initial?.is_superuser ?? false);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [roleIds, setRoleIds] = useState<Set<string>>(
    () => new Set(initial?.roles.map((r) => r.id) ?? []),
  );
  const [systemIds, setSystemIds] = useState<Set<string>>(
    () => new Set(initial?.systems?.map((s) => s.id) ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { backdropProps: userFormBackdrop, stopPanelPointer: userFormPanelStop } = useModalLayer(true, onClose, {
    closeOnBackdrop: false,
    closeOnEscape: !(saving || deleteBusy),
  });

  const toggleRole = (id: string) => {
    setRoleIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleSystem = (id: string) => {
    setSystemIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  useEffect(() => {
    if (!initial) return;
    setEmail(initial.email);
    setFullName(initial.full_name);
    setPositionId(initial.position?.id ?? "");
    setBirthDate(initial.birth_date ? initial.birth_date.slice(0, 10) : "");
    setIsSuperuser(initial.is_superuser);
    setIsActive(initial.is_active);
    setRoleIds(new Set(initial.roles.map((r) => r.id)));
    setSystemIds(new Set(initial.systems?.map((s) => s.id) ?? []));
    setPassword("");
    setPasswordConfirm("");
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setMustChangePassword(true);
  }, [initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (!initial) {
        if (password.length < 8) {
          toastError("Пароль минимум 8 символов");
          setSaving(false);
          return;
        }
        if (password !== passwordConfirm) {
          toastError("Пароли не совпадают");
          setSaving(false);
          return;
        }
        await onCreate?.({
          email: email.trim(),
          full_name: fullName.trim(),
          password,
          is_superuser: isSuperuser,
          role_ids: [...roleIds],
          system_ids: [...systemIds],
          position_id: positionId || null,
          birth_date: birthDate.trim() || null,
          must_change_password: mustChangePassword,
        });
      } else {
        const payload: UserUpdate = {
          email: email.trim(),
          full_name: fullName.trim(),
          is_active: isActive,
          is_superuser: isSuperuser,
          role_ids: [...roleIds],
          system_ids: [...systemIds],
          position_id: positionId || null,
          birth_date: birthDate.trim() || null,
        };
        if (password.length > 0) {
          if (password.length < 8) {
            toastError("Новый пароль: минимум 8 символов");
            setSaving(false);
            return;
          }
          if (password !== passwordConfirm) {
              toastError("Пароли не совпадают");
            setSaving(false);
            return;
          }
          payload.password = password;
          payload.must_change_password = mustChangePassword;
        }
        await onUpdate?.(payload);
      }
      toastSuccess(initial ? "Пользователь сохранён" : "Пользователь создан");
    } catch (e2) {
      toastApiError(e2, "Не удалось сохранить пользователя");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      {...userFormBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div
        className="modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-soft-lg"
        role="dialog"
        aria-modal="true"
        onClick={userFormPanelStop}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">ФИО</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Должность (справочник)</label>
            <select
              value={positionId}
              onChange={(e) => setPositionId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              <option value="">— не выбрана —</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Справочник: раздел «Должности» в меню.</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Производственные системы</p>
            <p className="mb-2 text-xs text-slate-500">
              Отмеченные системы определяют, какие задачи пользователь видит на доске (если у него нет права «читать все
              задачи»). Можно выбрать несколько.
            </p>
            <div className="max-h-36 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-600">
              {systems.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={systemIds.has(s.id)}
                    onChange={() => toggleSystem(s.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{s.name}</span>
                    <span className="font-mono text-xs text-slate-500"> {s.slug}</span>
                  </span>
                </label>
              ))}
              {!systems.length && (
                <p className="text-sm text-slate-500">
                  Нет активных систем — добавьте в разделе «Системы» в меню.
                </p>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Дата рождения</label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Пароль {initial && "(оставьте пустым, чтобы не менять)"}
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                minLength={initial ? 0 : 8}
                required={!initial}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-12 dark:border-slate-600 dark:bg-slate-800"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                title={showPassword ? "Скрыть пароль" : "Показать пароль"}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Повтор пароля</label>
            <div className="relative">
              <input
                type={showPasswordConfirm ? "text" : "password"}
                minLength={initial ? 0 : 8}
                required={!initial}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-12 dark:border-slate-600 dark:bg-slate-800"
              />
              <button
                type="button"
                onClick={() => setShowPasswordConfirm((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                title={showPasswordConfirm ? "Скрыть пароль" : "Показать пароль"}
                aria-label={showPasswordConfirm ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPasswordConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {(!initial || password.length > 0) && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={mustChangePassword}
                onChange={(e) => setMustChangePassword(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  Потребовать смену пароля при входе
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Если включено — пользователь увидит окно смены пароля после входа. Если выключено — останется
                  пароль, который задал администратор.
                </span>
              </span>
            </label>
          )}
          {initial && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Активен
              </label>
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isSuperuser}
              onChange={(e) => setIsSuperuser(e.target.checked)}
            />
            Суперпользователь (все права без ролей)
          </label>
          <div>
            <p className="mb-2 text-sm font-medium">Роли</p>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-600">
              {roles.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roleIds.has(r.id)}
                    onChange={() => toggleRole(r.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
                    <span className="font-mono text-xs text-slate-500"> {r.slug}</span>
                  </span>
                </label>
              ))}
              {!roles.length && <p className="text-sm text-slate-500">Нет ролей — создайте во вкладке «Роли».</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {initial && onDelete && initial.id !== currentUserId && (
                <button
                  type="button"
                  disabled={saving || deleteBusy}
                  onClick={async () => {
                    const ok = window.confirm(
                      "Удалить пользователя безвозвратно?\n\n" +
                        "Задачи останутся: с исполнителя и автора ссылка снимется. " +
                        "График, профиль сотрудника, уведомления и членство в базе знаний будут удалены.",
                    );
                    if (!ok) return;
                    setDeleteBusy(true);
                    try {
                      await onDelete();
                      toastSuccess("Пользователь удалён");
                      onClose();
                    } catch (e2) {
                      toastApiError(e2, "Не удалось удалить пользователя");
                    } finally {
                      setDeleteBusy(false);
                    }
                  }}
                  className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
                >
                  {deleteBusy ? "Удаление…" : "Удалить пользователя"}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-800 dark:bg-slate-700 dark:text-white"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function RolesSection() {
  const { state } = useAuth();
  const isSuperuser = state.status === "authenticated" && state.user.is_superuser;
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleOut | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleSearch, setRoleSearch] = useState("");

  const rolesQuery = useQuery({ queryKey: ["admin", "roles"], queryFn: listRoles });
  const permsQuery = useQuery({ queryKey: ["admin", "permissions"], queryFn: listPermissionsCatalog });
  const usersCountQuery = useQuery({
    queryKey: ["admin", "users", "count"],
    queryFn: () => listUsers({ limit: 1, offset: 0 }),
  });

  const roles = rolesQuery.data ?? [];
  const perms = permsQuery.data ?? [];
  const userCount = usersCountQuery.data?.total ?? 0;
  const loading = rolesQuery.isPending || permsQuery.isPending;
  useToastQueryError(rolesQuery.error, "Не удалось загрузить роли");
  useToastQueryError(permsQuery.error, "Не удалось загрузить права");

  const grouped = useMemo(() => groupPermissions(perms), [perms]);

  const filteredRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(
      (r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q),
    );
  }, [roles, roleSearch]);

  useEffect(() => {
    if (!roles.length) return;
    if (!selectedRoleId || !roles.some((r) => r.id === selectedRoleId)) {
      setSelectedRoleId(roles[0].id);
      return;
    }
    if (
      roleSearch.trim() &&
      filteredRoles.length > 0 &&
      !filteredRoles.some((r) => r.id === selectedRoleId)
    ) {
      setSelectedRoleId(filteredRoles[0].id);
    }
  }, [roles, selectedRoleId, filteredRoles, roleSearch]);

  const invalidateRoles = async () => {
    await invalidateAndRefetch(qc, ["admin", "roles"]);
  };

  async function handleDeleteRole(role: RoleOut) {
    if (role.is_system) return;
    if (
      !window.confirm(
        `Удалить роль «${role.name}»? Пользователи потеряют эту роль; действие необратимо.`,
      )
    ) {
      return;
    }
    try {
      await deleteRole(role.id);
      if (selectedRoleId === role.id) setSelectedRoleId(null);
      setEditRole((prev) => (prev?.id === role.id ? null : prev));
      await invalidateRoles();
      toastSuccess("Роль удалена");
    } catch (e) {
      toastApiError(e, "Не удалось удалить роль");
    }
  }

  async function handleToggle(role: RoleOut, permId: string, next: boolean) {
    if (role.is_system && !isSuperuser) return;
    const ids = new Set(role.permissions.map((x) => x.id));
    if (next) ids.add(permId);
    else ids.delete(permId);
    setBusyKey(`${role.id}:${permId}`);
    try {
      await updateRole(role.id, {
        name: role.name,
        description: role.description,
        permission_ids: [...ids],
      });
      await invalidateRoles();
      toastSuccess("Сохранено");
    } catch (e) {
      toastApiError(e, "Не удалось обновить роль");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {loading && <p className="text-slate-500">Загрузка…</p>}

      {!loading && roles.length > 0 && perms.length > 0 && (
        <RolesPermissionsBoard
          roles={roles}
          filteredRoles={filteredRoles}
          perms={perms}
          grouped={grouped}
          userCount={userCount}
          selectedId={selectedRoleId}
          onSelectRole={setSelectedRoleId}
          roleSearch={roleSearch}
          onRoleSearch={setRoleSearch}
          onCreateRole={() => setCreateOpen(true)}
          onEditRole={(r) => setEditRole(r)}
          onDeleteRole={handleDeleteRole}
          onToggle={handleToggle}
          busyKey={busyKey}
          canEditSystemRoles={isSuperuser}
        />
      )}

      {!loading && (!roles.length || !perms.length) && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Нет данных ролей или справочника прав. Проверьте права доступа и перезагрузите страницу.
        </p>
      )}

      {createOpen && (
        <RoleFormModal
          title="Новая роль"
          permGroups={grouped}
          onClose={() => setCreateOpen(false)}
          onCreate={async (data) => {
            await createRole(data);
            setCreateOpen(false);
            await invalidateRoles();
          }}
        />
      )}

      {editRole && (
        <RoleFormModal
          title="Редактирование роли"
          permGroups={grouped}
          initial={editRole}
          isSuperuser={isSuperuser}
          onClose={() => setEditRole(null)}
          onUpdate={async (data) => {
            await updateRole(editRole.id, data);
            setEditRole(null);
            await invalidateRoles();
          }}
        />
      )}
    </div>
  );
}

function RoleFormModal({
  title,
  permGroups,
  initial,
  isSuperuser = false,
  onClose,
  onCreate,
  onUpdate,
}: {
  title: string;
  permGroups: Map<string, PermissionOut[]>;
  initial?: RoleOut;
  /** Нужен для редактирования системных ролей (название, описание, права). */
  isSuperuser?: boolean;
  onClose: () => void;
  onCreate?: (data: RoleCreate) => Promise<void>;
  onUpdate?: (data: RoleUpdate) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial?.permissions.map((p) => p.id) ?? []),
  );
  const [saving, setSaving] = useState(false);

  const { backdropProps: roleFormBackdrop, stopPanelPointer: roleFormPanelStop } = useModalLayer(true, onClose, {
    closeOnBackdrop: !saving,
    closeOnEscape: !saving,
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (initial?.is_system && !isSuperuser) return;
    setSaving(true);
    try {
      if (!initial) {
        await onCreate?.({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || null,
          permission_ids: [...selected],
        });
      } else if (initial.is_system) {
        await onUpdate?.({
          name: name.trim(),
          description: description.trim() || null,
          permission_ids: [...selected],
        });
      } else {
        await onUpdate?.({
          name: name.trim(),
          description: description.trim() || null,
          permission_ids: [...selected],
        });
      }
      toastSuccess(initial ? "Роль сохранена" : "Роль создана");
    } catch (e2) {
      toastApiError(e2, "Не удалось сохранить роль");
    } finally {
      setSaving(false);
    }
  }

  const systemLocked = Boolean(initial?.is_system && !isSuperuser);
  const readOnlyPerms = Boolean(initial?.is_system && !isSuperuser);

  return (
    <div
      {...roleFormBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div
        className="modal-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6 shadow-soft-lg"
        role="dialog"
        aria-modal="true"
        onClick={roleFormPanelStop}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {systemLocked && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Системную роль может изменять только суперпользователь. Доступен просмотр.
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">Название</label>
            <input
              required
              disabled={systemLocked}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Slug (латиница, дефис)</label>
            <input
              required
              disabled={!!initial}
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Описание</label>
            <textarea
              disabled={systemLocked}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Права</p>
            {readOnlyPerms ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Набор прав системной роли может менять только суперпользователь.
              </p>
            ) : (
              <div className="max-h-64 space-y-4 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-600">
                {[...permGroups.entries()].map(([group, items]) => (
                  <div key={group}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {group}
                    </p>
                    <div className="space-y-2">
                      {items.map((p) => (
                        <label key={p.id} className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            onChange={() => toggle(p.id)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-mono text-xs text-sky-700 dark:text-sky-300"> {p.code}</span>
                            {p.description && (
                              <span className="block text-slate-600 dark:text-slate-400">{p.description}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-800 dark:bg-slate-700 dark:text-white"
            >
              {systemLocked ? "Закрыть" : "Отмена"}
            </button>
            {!systemLocked && (
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
