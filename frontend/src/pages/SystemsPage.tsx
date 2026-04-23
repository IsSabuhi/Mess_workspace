import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { ApiError } from "../api/client";
import { createSystem, deleteSystem, listSystemMembers, listSystems, updateSystem } from "../api/systems";
import type { SystemOut } from "../api/systems";
import { AppShell } from "../components/AppShell";
import { EmployeeDirectoryViewModal } from "../components/EmployeeDirectoryViewModal";
import { useAuth } from "../context/AuthContext";
import { invalidateAndRefetch } from "../lib/queryClient";
import { PERM, hasPermission } from "../lib/permissions";
import { toastApiError, toastSuccess } from "../lib/toast";
import { useModalLayer } from "../lib/useModalLayer";

export function SystemsPage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canManage = user && hasPermission(user, PERM.SYSTEMS_MANAGE);
  const canViewEmployeeDirectory = !!(user && hasPermission(user, PERM.EMPLOYEE_DIRECTORY_READ));
  const qc = useQueryClient();

  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState(false);
  const [membersModalSystem, setMembersModalSystem] = useState<SystemOut | null>(null);
  const [editingSystem, setEditingSystem] = useState<SystemOut | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [systemMembersSearchQ, setSystemMembersSearchQ] = useState("");
  const [employeeDetailUserId, setEmployeeDetailUserId] = useState<string | null>(null);

  const systemsQuery = useQuery({
    queryKey: ["systems", showInactive],
    queryFn: () => listSystems(!showInactive),
  });
  const membersQuery = useQuery({
    queryKey: ["systems", "members", membersModalSystem?.id ?? ""],
    queryFn: () => listSystemMembers(membersModalSystem!.id),
    enabled: !!membersModalSystem,
  });

  const filteredSystemMembers = useMemo(() => {
    const rows = membersQuery.data ?? [];
    const q = systemMembersSearchQ.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => {
      const pos = m.position?.name?.toLowerCase() ?? "";
      return (
        m.full_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        pos.includes(q)
      );
    });
  }, [membersQuery.data, systemMembersSearchQ]);

  useEffect(() => {
    if (!membersModalSystem) setSystemMembersSearchQ("");
  }, [membersModalSystem]);

  const items = systemsQuery.data ?? [];
  const loading = systemsQuery.isPending;
  const error =
    systemsQuery.error instanceof ApiError
      ? systemsQuery.error.detail
      : systemsQuery.isError
        ? "Ошибка загрузки"
        : null;

  const createMut = useMutation({
    mutationFn: createSystem,
    onSuccess: async () => {
      await invalidateAndRefetch(qc, ["systems"]);
      setModal(false);
      setName("");
      setSlug("");
      setDescription("");
      setSortOrder(0);
      setFormError(null);
      toastSuccess("Система создана");
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) setFormError(e.detail);
      toastApiError(e, "Не удалось создать систему");
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteSystem,
    onSuccess: async () => {
      await invalidateAndRefetch(qc, ["systems"]);
      toastSuccess("Система удалена");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить систему"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateSystem>[1] }) =>
      updateSystem(id, body),
    onSuccess: async () => {
      await invalidateAndRefetch(qc, ["systems"]);
      toastSuccess("Система обновлена");
    },
    onError: (e: unknown) => {
      toastApiError(e, "Не удалось обновить систему");
    },
  });

  const closeSystemFormModal = useCallback(() => {
    setModal(false);
    setEditingSystem(null);
    setSortOrder(0);
  }, []);
  const closeMembersModal = useCallback(() => {
    setMembersModalSystem(null);
    setSystemMembersSearchQ("");
    setEmployeeDetailUserId(null);
  }, []);

  const { backdropProps: systemFormBackdrop, stopPanelPointer: systemFormPanelStop } = useModalLayer(
    !!(modal && canManage),
    closeSystemFormModal,
    {
      closeOnBackdrop: !(createMut.isPending || updateMut.isPending),
      closeOnEscape: !(createMut.isPending || updateMut.isPending),
    },
  );
  const { backdropProps: systemMembersBackdrop, stopPanelPointer: systemMembersPanelStop } = useModalLayer(
    !!membersModalSystem,
    closeMembersModal,
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const normalizedSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (editingSystem) {
      const payload: Parameters<typeof updateSystem>[1] = {
        name: name.trim(),
        description: description.trim() || null,
        sort_order: sortOrder,
      };
      if (normalizedSlug) {
        payload.slug = normalizedSlug;
      }
      try {
        await updateMut.mutateAsync({ id: editingSystem.id, body: payload });
        closeSystemFormModal();
        setName("");
        setSlug("");
        setDescription("");
      } catch {
        // handled by mutation
      }
      return;
    }
    if (!normalizedSlug) {
      setFormError("Slug обязателен и должен содержать только a-z, 0-9 и '-'");
      return;
    }
    const payload = {
      name: name.trim(),
      slug: normalizedSlug,
      description: description.trim() || null,
      sort_order: sortOrder,
    };
    createMut.mutate(payload);
  }

  function toggleActive(s: SystemOut) {
    if (!canManage) return;
    updateMut.mutate({ id: s.id, body: { is_active: !s.is_active } });
  }

  function openCreateModal() {
    setEditingSystem(null);
    setName("");
    setSlug("");
    setDescription("");
    const maxSo = items.reduce((acc, s) => Math.max(acc, s.sort_order), 0);
    setSortOrder(maxSo + 10);
    setFormError(null);
    setModal(true);
  }

  function openEditModal(s: SystemOut) {
    setEditingSystem(s);
    setName(s.name);
    setSlug(s.slug);
    setDescription(s.description ?? "");
    setSortOrder(s.sort_order);
    setFormError(null);
    setModal(true);
  }

  return (
    <AppShell
      title="Системы"
      subtitle="Порядок поля «В расписании» задаёт блоки строк на странице «Расписание» (меньше — выше). У сотрудника несколько систем — в группу попадает по системе с наименьшим порядком."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Показать неактивные
        </label>
        {canManage && (
          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
          >
            + Система
          </button>
        )}
      </div>

      {(error || formError) && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {formError ?? error}
        </p>
      )}
      {loading && <p className="text-slate-500">Загрузка…</p>}

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <div
              key={s.id}
              className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">{s.name}</h3>
                  <p className="font-mono text-xs text-slate-500">{s.slug}</p>
                </div>
                {!s.is_active && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">off</span>
                )}
              </div>
              {s.description && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{s.description}</p>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Сотрудников: <span className="font-semibold">{s.user_count}</span>
                <span className="mx-1 text-slate-400">·</span>
                №: <span className="font-semibold">{s.sort_order}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setSystemMembersSearchQ("");
                  setMembersModalSystem(s);
                }}
                className="mt-2 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                Показать сотрудников
              </button>
              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEditModal(s)}
                    className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Редактировать
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(s)}
                    disabled={updateMut.isPending}
                    className="rounded-lg bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50 dark:bg-sky-950/30 dark:text-sky-300"
                  >
                    {s.is_active ? "Деактивировать" : "Активировать"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Удалить систему «${s.name}»?`)) {
                        void deleteMut.mutateAsync(s.id).catch(() => {});
                      }
                    }}
                    disabled={deleteMut.isPending}
                    className="rounded-lg bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300"
                  >
                    Удалить
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && canManage && (
        <div
          {...systemFormBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div
            className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg"
            role="dialog"
            aria-modal="true"
            onClick={systemFormPanelStop}
          >
            <h2 className="mb-4 text-lg font-semibold">
              {editingSystem ? "Редактировать систему" : "Новая система"}
            </h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm">Название</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm">Slug (латиница)</label>
                <input
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm">Описание</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm">Порядок в расписании</label>
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Чем меньше число, тем выше блок этой системы на странице «Расписание» (как колонка систем в Excel).
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeSystemFormModal}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending || updateMut.isPending}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {editingSystem
                    ? updateMut.isPending
                      ? "Сохранение…"
                      : "Сохранить"
                    : createMut.isPending
                      ? "Создание…"
                      : "Создать"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {membersModalSystem && (
        <div
          {...systemMembersBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div
            className="glass flex max-h-[min(90vh,56rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-soft-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="system-members-title"
            onClick={systemMembersPanelStop}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-slate-600/60">
              <div className="min-w-0">
                <h2
                  id="system-members-title"
                  className="text-lg font-semibold text-slate-900 dark:text-white"
                >
                  Сотрудники системы: {membersModalSystem.name}
                </h2>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{membersModalSystem.slug}</p>
              </div>
              <button
                type="button"
                onClick={closeMembersModal}
                className="shrink-0 rounded-lg px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden px-5 pb-5 pt-3">
              {membersQuery.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
              {membersQuery.isError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {membersQuery.error instanceof ApiError
                    ? membersQuery.error.detail
                    : "Не удалось загрузить сотрудников"}
                </p>
              )}
              {!membersQuery.isPending && !membersQuery.isError && (
                <>
                  {(membersQuery.data ?? []).length === 0 ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      В этой системе пока нет активных сотрудников.
                    </p>
                  ) : (
                    <>
                      <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Поиск
                        <input
                          type="search"
                          value={systemMembersSearchQ}
                          onChange={(e) => setSystemMembersSearchQ(e.target.value)}
                          placeholder="Имя, должность или email…"
                          autoComplete="off"
                          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </label>
                      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                        Показано: {filteredSystemMembers.length} из {(membersQuery.data ?? []).length}
                        {canViewEmployeeDirectory ? (
                          <span className="text-slate-400"> · строка — открыть карточку</span>
                        ) : null}
                      </p>
                      <div className="max-h-[min(60vh,28rem)] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                        <table className="w-full min-w-[24rem] text-left text-sm">
                          <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm dark:bg-slate-800/95 dark:shadow-[0_1px_0_0_rgba(51,65,85,0.6)]">
                            <tr>
                              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                                Сотрудник
                              </th>
                              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                                Должность
                              </th>
                              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Email</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {filteredSystemMembers.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={3}
                                  className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400"
                                >
                                  Никого не найдено по запросу.
                                </td>
                              </tr>
                            ) : (
                              filteredSystemMembers.map((m) => {
                                const interactive = canViewEmployeeDirectory;
                                return (
                                  <tr
                                    key={m.id}
                                    className={
                                      interactive
                                        ? "cursor-pointer bg-white/80 hover:bg-sky-50/90 dark:bg-slate-900/40 dark:hover:bg-sky-950/35"
                                        : "bg-white/80 dark:bg-slate-900/40"
                                    }
                                    {...(interactive
                                      ? {
                                          role: "button" as const,
                                          tabIndex: 0,
                                          onClick: () => setEmployeeDetailUserId(m.id),
                                          onKeyDown: (e: KeyboardEvent) => {
                                            if (e.key === "Enter" || e.key === " ") {
                                              e.preventDefault();
                                              setEmployeeDetailUserId(m.id);
                                            }
                                          },
                                        }
                                      : {})}
                                  >
                                    <td className="px-3 py-2 text-slate-900 dark:text-white">{m.full_name}</td>
                                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                      {m.position?.name ?? "—"}
                                    </td>
                                    <td className="break-all px-3 py-2 text-slate-500 dark:text-slate-400">{m.email}</td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <EmployeeDirectoryViewModal
        userId={employeeDetailUserId}
        onClose={() => setEmployeeDetailUserId(null)}
      />
    </AppShell>
  );
}
