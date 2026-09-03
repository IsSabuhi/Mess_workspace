import type { PermissionOut, RoleOut } from "../../api/roles";
import { NeedPermission } from "../../components/NeedPermission";
import { PermissionNoteIcon } from "../../components/PermissionNoteIcon";
import { parsePermissionText } from "../../lib/permissionText";
import { PermToggle, permissionGroupTitle } from "./adminUi";

export function RolesPermissionsBoard({
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
  canManage,
  canEditSystemRoles,
  canTogglePerm,
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
  canManage: boolean;
  canEditSystemRoles: boolean;
  canTogglePerm: (code: string) => boolean;
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
        <NeedPermission allowed={canManage}>
          <button
            type="button"
            onClick={onCreateRole}
            className="shrink-0 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
          >
            + Создать роль
          </button>
        </NeedPermission>
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
                      <NeedPermission allowed={canManage}>
                      <button
                        type="button"
                        onClick={() => onDeleteRole(selected)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
                      >
                        Удалить роль
                      </button>
                      </NeedPermission>
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
                        const lockedPerm = !canManage || !canTogglePerm(p.code);
                        const disabled = (selected.is_system && !canEditSystemRoles) || lockedPerm;
                        const busy = busyKey === `${selected.id}:${p.id}`;
                        const parsed = parsePermissionText(p.code, p.description);
                        return (
                          <div
                            key={p.id}
                            className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200/90 bg-slate-50/80 px-4 py-3 dark:border-slate-600/80 dark:bg-slate-800/40"
                          >
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                                <span>{parsed.title}</span>
                                {parsed.note ? <PermissionNoteIcon note={parsed.note} /> : null}
                              </p>
                              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                                {parsed.subtitle}
                              </p>
                            </div>
                            <NeedPermission allowed={!disabled}>
                              <PermToggle
                              checked={has}
                              disabled={disabled}
                              busy={busy}
                              onChange={() => {
                                if (!disabled) onToggle(selected, p.id, !has);
                              }}
                              ariaLabel={`${has ? "Отключить" : "Включить"} право ${p.code}`}
                            />
                            </NeedPermission>
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
