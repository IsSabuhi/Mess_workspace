import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";

import type { UserOut } from "../../api/auth";
import { listPositions, type PositionOut } from "../../api/positions";
import { listRoles, type RoleOut } from "../../api/roles";
import { listSystems, type SystemOut } from "../../api/systems";
import type { UserCreate, UserListOut, UserUpdate } from "../../api/users";
import { createUser, deleteUser, listUsers, updateUser } from "../../api/users";
import { NeedPermission, toastInsufficientRights } from "../../components/NeedPermission";
import { useAuth } from "../../context/AuthContext";
import {
  canAssignRole,
  canCreateUsers,
  canDeleteUsers,
  canModifyUserAccount,
  canResetUserPassword,
  canStaffUsers,
  canUpdateUsers,
} from "../../lib/permissions";
import { toastApiError, toastError, toastSuccess } from "../../lib/toast";
import { useModalLayer } from "../../lib/useModalLayer";
import { useToastQueryError } from "../../lib/useToastQueryError";
import { AdminLock } from "./adminUi";
import { invalidateAndRefetch } from "../../lib/queryClient";

const USERS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function UsersSection() {
  const { state: authState } = useAuth();
  const currentUser = authState.status === "authenticated" ? authState.user : null;
  const currentUserId = currentUser?.id ?? "";
  const staff = !!(currentUser && canStaffUsers(currentUser));
  const allowCreate = !!(currentUser && canCreateUsers(currentUser));
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
    <>
    <AdminLock
      allowed={staff}
      hint="Нет права управлять пользователями — список можно смотреть, создание и изменение недоступны."
    >
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Учётные записи, роли и производственные системы. По системам ограничивается видимость задач на доске (кроме
          ролей с полным доступом к задачам).
        </p>
        <NeedPermission allowed={allowCreate}>
          <button
            type="button"
            disabled={!allowCreate}
            onClick={() => setCreateOpen(true)}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-50"
          >
            + Пользователь
          </button>
        </NeedPermission>
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

    </div>
    </AdminLock>

      {createOpen && allowCreate && (
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
          onDelete={
            async () => {
              await deleteUser(editUser.id);
              setEditUser(null);
              await refreshUsers();
              await qc.invalidateQueries({ queryKey: ["employee-directory"] });
              await qc.invalidateQueries({ queryKey: ["schedule"] });
              await qc.invalidateQueries({ queryKey: ["users", "assignee-candidates"] });
            }
          }
        />
      )}
    </>
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
  const { state: authState } = useAuth();
  const actor = authState.status === "authenticated" ? authState.user : null;
  const superuserLocked = !!(initial?.is_superuser && actor && !canModifyUserAccount(actor, initial));
  const allowUpdate = !!(actor && canUpdateUsers(actor)) && !superuserLocked;
  const allowPassword = !!(actor && canResetUserPassword(actor)) && !superuserLocked;
  const allowDelete = !!(actor && canDeleteUsers(actor)) && !superuserLocked;
  const profileLocked = !!initial && !allowUpdate;
  const passwordLocked = initial ? !allowPassword : false;
  const canWrite = !initial || allowUpdate || allowPassword;
  const canSetSuperuser = !!actor?.is_superuser;

  const { backdropProps: userFormBackdrop, stopPanelPointer: userFormPanelStop } = useModalLayer(true, onClose, {
    closeOnBackdrop: false,
    closeOnEscape: !(saving || deleteBusy),
  });

  const toggleRole = (id: string) => {
    const role = roles.find((r) => r.id === id);
    if (!actor || !role || !canAssignRole(actor, role)) return;
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
    if (!canWrite) {
      toastInsufficientRights();
      return;
    }
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
          is_superuser: canSetSuperuser && isSuperuser,
          role_ids: [...roleIds],
          system_ids: [...systemIds],
          position_id: positionId || null,
          birth_date: birthDate.trim() || null,
          must_change_password: mustChangePassword,
        });
      } else {
        const payload: UserUpdate = {};
        if (!profileLocked) {
          payload.email = email.trim();
          payload.full_name = fullName.trim();
          payload.is_active = isActive;
          payload.is_superuser = canSetSuperuser ? isSuperuser : initial.is_superuser;
          payload.role_ids = [...roleIds];
          payload.system_ids = [...systemIds];
          payload.position_id = positionId || null;
          payload.birth_date = birthDate.trim() || null;
        }
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
          if (passwordLocked) {
            toastError("Нет права сбрасывать пароль");
            setSaving(false);
            return;
          }
          payload.password = password;
          payload.must_change_password = mustChangePassword;
        }
        if (Object.keys(payload).length === 0) {
          toastError("Нет полей, которые вам разрешено менять");
          setSaving(false);
          return;
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
          {superuserLocked && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
              Учётную запись суперпользователя может изменять только суперпользователь.
            </p>
          )}
          {profileLocked && !superuserLocked && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
              Карточка только для чтения. Можно сбросить пароль, если есть это право.
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">ФИО</label>
            <input
              required
              value={fullName}
              disabled={profileLocked}
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
              disabled={profileLocked}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Должность (справочник)</label>
            <select
              value={positionId}
              disabled={profileLocked}
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
                    disabled={profileLocked}
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
              disabled={profileLocked}
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
                disabled={passwordLocked}
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
                disabled={passwordLocked}
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
                disabled={passwordLocked}
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
                  disabled={profileLocked}
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
              disabled={!canSetSuperuser || profileLocked}
              onChange={(e) => setIsSuperuser(e.target.checked)}
            />
            Суперпользователь (все права без ролей)
          </label>
          <div>
            <p className="mb-2 text-sm font-medium">Роли</p>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-600">
              {roles.map((r) => {
                const assignable = actor ? canAssignRole(actor, r) : false;
                return (
                <label key={r.id} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roleIds.has(r.id)}
                    disabled={profileLocked || !assignable}
                    onChange={() => toggleRole(r.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
                    <span className="font-mono text-xs text-slate-500"> {r.slug}</span>
                    {!assignable && (
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        Выше ваших прав — назначить нельзя
                      </span>
                    )}
                  </span>
                </label>
                );
              })}
              {!roles.length && <p className="text-sm text-slate-500">Нет ролей — создайте во вкладке «Роли».</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div>
              {initial && onDelete && initial.id !== currentUserId && (
                <NeedPermission allowed={allowDelete}>
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
                </NeedPermission>
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
              <NeedPermission allowed={canWrite}>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
              </NeedPermission>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
