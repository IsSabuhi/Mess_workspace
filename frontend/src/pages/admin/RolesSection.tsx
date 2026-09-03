import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { PermissionOut, RoleCreate, RoleOut, RoleUpdate } from "../../api/roles";
import {
  createRole,
  deleteRole,
  listPermissionsCatalog,
  listRoles,
  updateRole,
} from "../../api/roles";
import { listUsers } from "../../api/users";
import { NeedPermission, toastInsufficientRights } from "../../components/NeedPermission";
import { PermissionNoteIcon } from "../../components/PermissionNoteIcon";
import { useAuth } from "../../context/AuthContext";
import { parsePermissionText } from "../../lib/permissionText";
import {
  PERM,
  canToggleAdminPermission,
  hasPermission,
} from "../../lib/permissions";
import { invalidateAndRefetch } from "../../lib/queryClient";
import { toastApiError, toastSuccess } from "../../lib/toast";
import { useModalLayer } from "../../lib/useModalLayer";
import { useToastQueryError } from "../../lib/useToastQueryError";
import { AdminLock, groupPermissions, permissionGroupTitle } from "./adminUi";
import { RolesPermissionsBoard } from "./RolesPermissionsBoard";

export function RolesSection() {
  const { state } = useAuth();
  const isSuperuser = state.status === "authenticated" && state.user.is_superuser;
  const currentUser = state.status === "authenticated" ? state.user : null;
  const canRoles = !!(currentUser && hasPermission(currentUser, PERM.ROLES_MANAGE));
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
    const perm = perms.find((p) => p.id === permId);
    if (currentUser && perm && !canToggleAdminPermission(currentUser, perm.code)) return;
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
    <>
    <AdminLock
      allowed={canRoles}
      hint="Нет права менять роли — матрицу можно смотреть, создание и переключатели недоступны."
    >
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
          canManage={canRoles}
          canEditSystemRoles={isSuperuser}
          canTogglePerm={(code) => (currentUser ? canToggleAdminPermission(currentUser, code) : false)}
        />
      )}

      {!loading && (!roles.length || !perms.length) && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Нет данных ролей или справочника прав. Проверьте права доступа и перезагрузите страницу.
        </p>
      )}
    </div>
    </AdminLock>

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
    </>
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
  const { state: authState } = useAuth();
  const actor = authState.status === "authenticated" ? authState.user : null;
  const canSaveRole = !!(actor && hasPermission(actor, PERM.ROLES_MANAGE));

  const { backdropProps: roleFormBackdrop, stopPanelPointer: roleFormPanelStop } = useModalLayer(true, onClose, {
    closeOnBackdrop: !saving,
    closeOnEscape: !saving,
  });

  const toggle = (id: string) => {
    const perm = [...permGroups.values()].flat().find((p) => p.id === id);
    if (actor && perm && !canToggleAdminPermission(actor, perm.code)) return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSaveRole) {
      toastInsufficientRights();
      return;
    }
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
                      {permissionGroupTitle(group)}
                    </p>
                    <div className="space-y-2">
                      {items.map((p) => {
                        const locked = actor ? !canToggleAdminPermission(actor, p.code) : true;
                        const parsed = parsePermissionText(p.code, p.description);
                        return (
                        <label key={p.id} className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            disabled={locked}
                            onChange={() => toggle(p.id)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="inline-flex items-center gap-1 font-medium text-slate-800 dark:text-slate-100">
                              {parsed.title}
                              {parsed.note ? <PermissionNoteIcon note={parsed.note} /> : null}
                            </span>
                            <span className="block text-slate-600 dark:text-slate-400">{parsed.subtitle}</span>
                            <span className="font-mono text-[10px] text-slate-400">{p.code}</span>
                          </span>
                        </label>
                        );
                      })}
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
              <NeedPermission allowed={canSaveRole}>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
              </NeedPermission>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
