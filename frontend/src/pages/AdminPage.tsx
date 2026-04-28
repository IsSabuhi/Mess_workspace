import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import type { UserOut } from "../api/auth";
import { ApiError } from "../api/client";
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
import type { UserCreate, UserUpdate } from "../api/users";
import { createUser, deleteUser, listUsers, updateUser } from "../api/users";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { invalidateAndRefetch } from "../lib/queryClient";
import { PERM, canAdminAccess, hasPermission } from "../lib/permissions";
import { toastApiError, toastError, toastSuccess } from "../lib/toast";
import { useModalLayer } from "../lib/useModalLayer";

type Tab = "users" | "roles" | "system-settings";

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
  board: "Доска и колонки",
  systems: "Системные настройки",
  positions: "Должности",
  users: "Управление пользователями",
  roles: "Роли и права доступа",
  knowledge: "База знаний",
  employee_directory: "Сотрудники",
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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

      <div className="grid gap-3 sm:grid-cols-3">
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

      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <aside className="w-full shrink-0 rounded-2xl border border-slate-200/80 bg-white/90 shadow-soft dark:border-slate-700 dark:bg-slate-900/60 lg:w-[min(100%,280px)]">
          <div className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Роли системы</p>
            <input
              type="search"
              value={roleSearch}
              onChange={(e) => onRoleSearch(e.target.value)}
              placeholder="Поиск ролей…"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <ul className="max-h-[min(420px,50vh)] space-y-1 overflow-y-auto p-2">
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

        <section className="min-w-0 flex-1 rounded-2xl border border-slate-200/80 bg-white/90 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          {!selected ? (
            <p className="p-8 text-center text-slate-500">Выберите роль слева</p>
          ) : (
            <>
              <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-700">
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

              <div className="max-h-[min(560px,60vh)] space-y-8 overflow-y-auto px-5 py-5">
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
  const canManageTaskArchive = hasPermission(user, PERM.SYSTEMS_MANAGE);

  useEffect(() => {
    const visibleTabs: Tab[] = [];
    if (showUsers) visibleTabs.push("users");
    if (showRoles) visibleTabs.push("roles");
    if (canManageTaskArchive) visibleTabs.push("system-settings");
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
        </div>
      )}

      {tab === "users" && showUsers && <UsersSection />}
      {tab === "roles" && showRoles && <RolesSection />}
      {tab === "system-settings" && canManageTaskArchive && <SystemSettingsSection />}
    </AppShell>
  );
}

function SystemSettingsSection() {
  const qc = useQueryClient();
  const [autoArchiveDays, setAutoArchiveDays] = useState("60");
  const taskArchiveQuery = useQuery({
    queryKey: ["admin", "task-archive-settings"],
    queryFn: getTaskArchiveSettings,
  });
  useEffect(() => {
    if (!taskArchiveQuery.data) return;
    setAutoArchiveDays(String(taskArchiveQuery.data.auto_archive_done_days));
  }, [taskArchiveQuery.data]);
  const taskArchiveMut = useMutation({
    mutationFn: (days: number) => updateTaskArchiveSettings(days),
    onSuccess: async (saved) => {
      setAutoArchiveDays(String(saved.auto_archive_done_days));
      toastSuccess("Период автоархивации сохранён");
      await qc.invalidateQueries({ queryKey: ["admin", "task-archive-settings"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить период автоархивации"),
  });

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
    </div>
  );
}

function UsersSection() {
  const { state: authState } = useAuth();
  const currentUserId = authState.status === "authenticated" ? authState.user.id : "";
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: listUsers });
  const rolesQuery = useQuery({ queryKey: ["admin", "roles"], queryFn: listRoles });
  const positionsQuery = useQuery({ queryKey: ["positions", "dropdown"], queryFn: () => listPositions(true) });
  const systemsQuery = useQuery({ queryKey: ["systems", "admin-users"], queryFn: () => listSystems(true) });

  const users = usersQuery.data ?? null;
  const roles = rolesQuery.data ?? [];
  const positions = positionsQuery.data ?? [];
  const systems = systemsQuery.data ?? [];
  const loading =
    usersQuery.isPending || rolesQuery.isPending || positionsQuery.isPending || systemsQuery.isPending;
  const error =
    (usersQuery.error instanceof ApiError && usersQuery.error.detail) ||
    (rolesQuery.error instanceof ApiError && rolesQuery.error.detail) ||
    (systemsQuery.error instanceof ApiError && systemsQuery.error.detail) ||
    (usersQuery.isError || rolesQuery.isError || systemsQuery.isError ? "Ошибка загрузки" : null);

  const editUser = useMemo(() => users?.find((x) => x.id === editId) ?? null, [users, editId]);

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = (u.full_name ?? "").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, userSearch]);

  const mergeUserIntoListCache = (u: UserOut) => {
    qc.setQueryData<UserOut[]>(["admin", "users"], (prev) => {
      if (!prev) return [u];
      const i = prev.findIndex((x) => x.id === u.id);
      if (i === -1) return [...prev, u].sort((a, b) => a.email.localeCompare(b.email));
      const next = [...prev];
      next[i] = u;
      return next;
    });
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

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && <p className="text-slate-500">Загрузка…</p>}

      {!loading && users && (
        <div className="space-y-2">
          <input
            type="search"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Поиск по ФИО или email…"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            autoComplete="off"
          />
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
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    Ничего не найдено по запросу.
                  </td>
                </tr>
              )}
              {filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-white">{u.full_name}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                    {u.position?.name ?? "—"}
                  </td>
                  <td className="max-w-[14rem] px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                    {u.systems?.length
                      ? u.systems.map((s) => s.name).join(", ")
                      : "—"}
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
                      onClick={() => setEditId(u.id)}
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
            const created = await createUser(data);
            setCreateOpen(false);
            mergeUserIntoListCache(created);
            await invalidateAndRefetch(qc, ["admin", "users"]);
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
          onClose={() => setEditId(null)}
          onUpdate={async (data) => {
            const updated = await updateUser(editUser.id, data);
            setEditId(null);
            mergeUserIntoListCache(updated);
            await invalidateAndRefetch(qc, ["admin", "users"]);
          }}
          onDelete={async () => {
            await deleteUser(editUser.id);
            setEditId(null);
            qc.setQueryData<UserOut[]>(["admin", "users"], (prev) => prev?.filter((x) => x.id !== editUser.id) ?? []);
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
  const [isSuperuser, setIsSuperuser] = useState(initial?.is_superuser ?? false);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [roleIds, setRoleIds] = useState<Set<string>>(
    () => new Set(initial?.roles.map((r) => r.id) ?? []),
  );
  const [systemIds, setSystemIds] = useState<Set<string>>(
    () => new Set(initial?.systems?.map((s) => s.id) ?? []),
  );
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { backdropProps: userFormBackdrop, stopPanelPointer: userFormPanelStop } = useModalLayer(true, onClose, {
    closeOnBackdrop: !(saving || deleteBusy),
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
  }, [initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      if (!initial) {
        if (password.length < 8) {
          setErr("Пароль минимум 8 символов");
          toastError("Пароль минимум 8 символов");
          setSaving(false);
          return;
        }
        if (password !== passwordConfirm) {
          setErr("Пароли не совпадают");
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
            setErr("Новый пароль: минимум 8 символов");
            toastError("Новый пароль: минимум 8 символов");
            setSaving(false);
            return;
          }
          if (password !== passwordConfirm) {
            setErr("Пароли не совпадают");
            toastError("Пароли не совпадают");
            setSaving(false);
            return;
          }
          payload.password = password;
        }
        await onUpdate?.(payload);
      }
      toastSuccess(initial ? "Пользователь сохранён" : "Пользователь создан");
    } catch (e2) {
      if (e2 instanceof ApiError) setErr(e2.detail);
      else setErr("Ошибка сохранения");
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
        className="glass max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-soft-lg"
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
            <input
              type="password"
              minLength={initial ? 0 : 8}
              required={!initial}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Повтор пароля</label>
            <input
              type="password"
              minLength={initial ? 0 : 8}
              required={!initial}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
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
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
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
                    setErr(null);
                    setDeleteBusy(true);
                    try {
                      await onDelete();
                      toastSuccess("Пользователь удалён");
                      onClose();
                    } catch (e2) {
                      if (e2 instanceof ApiError) setErr(e2.detail);
                      else setErr("Не удалось удалить");
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
  const [matrixErr, setMatrixErr] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleSearch, setRoleSearch] = useState("");

  const rolesQuery = useQuery({ queryKey: ["admin", "roles"], queryFn: listRoles });
  const permsQuery = useQuery({ queryKey: ["admin", "permissions"], queryFn: listPermissionsCatalog });
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: listUsers });

  const roles = rolesQuery.data ?? [];
  const perms = permsQuery.data ?? [];
  const userCount = usersQuery.data?.length ?? 0;
  const loading = rolesQuery.isPending || permsQuery.isPending;
  const error =
    (rolesQuery.error instanceof ApiError && rolesQuery.error.detail) ||
    (permsQuery.error instanceof ApiError && permsQuery.error.detail) ||
    (rolesQuery.isError || permsQuery.isError ? "Ошибка загрузки" : null);

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
      setMatrixErr(null);
      await deleteRole(role.id);
      if (selectedRoleId === role.id) setSelectedRoleId(null);
      setEditRole((prev) => (prev?.id === role.id ? null : prev));
      await invalidateRoles();
      toastSuccess("Роль удалена");
    } catch (e) {
      if (e instanceof ApiError) setMatrixErr(e.detail);
      else setMatrixErr("Не удалось удалить роль");
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
      setMatrixErr(null);
      await updateRole(role.id, {
        name: role.name,
        description: role.description,
        permission_ids: [...ids],
      });
      await invalidateRoles();
      toastSuccess("Сохранено");
    } catch (e) {
      if (e instanceof ApiError) setMatrixErr(e.detail);
      else setMatrixErr("Не удалось обновить роль");
      toastApiError(e, "Не удалось обновить роль");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
      {matrixErr && (
        <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {matrixErr}
        </p>
      )}
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
  const [err, setErr] = useState<string | null>(null);
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
    setErr(null);
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
      if (e2 instanceof ApiError) setErr(e2.detail);
      else setErr("Ошибка сохранения");
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
        className="glass max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-6 shadow-soft-lg"
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

          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
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
