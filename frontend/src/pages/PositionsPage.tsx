import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { ApiError } from "../api/client";
import { toastApiError, toastSuccess } from "../lib/toast";
import {
  createPosition,
  deletePosition,
  listPositionMembers,
  listPositions,
  updatePosition,
} from "../api/positions";
import type { PositionOut } from "../api/positions";
import { AppShell } from "../components/AppShell";
import { EmployeeDirectoryViewModal } from "../components/EmployeeDirectoryViewModal";
import { useAuth } from "../context/AuthContext";
import { invalidateAndRefetch } from "../lib/queryClient";
import { PERM, hasPermission } from "../lib/permissions";
import { useModalLayer } from "../lib/useModalLayer";

export function PositionsPage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canManage = user && hasPermission(user, PERM.POSITIONS_MANAGE);
  const canViewEmployeeDirectory = !!(user && hasPermission(user, PERM.EMPLOYEE_DIRECTORY_READ));
  const qc = useQueryClient();

  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [membersModalPosition, setMembersModalPosition] = useState<PositionOut | null>(null);
  const [membersSearchQ, setMembersSearchQ] = useState("");
  const [employeeDetailUserId, setEmployeeDetailUserId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["positions", showInactive],
    queryFn: () => listPositions(!showInactive),
  });

  const membersQuery = useQuery({
    queryKey: ["positions", "members", membersModalPosition?.id ?? ""],
    queryFn: () => listPositionMembers(membersModalPosition!.id),
    enabled: !!membersModalPosition,
  });

  const filteredPositionMembers = useMemo(() => {
    const rows = membersQuery.data ?? [];
    const q = membersSearchQ.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q),
    );
  }, [membersQuery.data, membersSearchQ]);

  useEffect(() => {
    if (!membersModalPosition) setMembersSearchQ("");
  }, [membersModalPosition]);

  const createMut = useMutation({
    mutationFn: createPosition,
    onSuccess: async () => {
      await invalidateAndRefetch(qc, ["positions"]);
      setModal(false);
      setName("");
      setSlug("");
      setDescription("");
      setFormError(null);
      toastSuccess("Должность создана");
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) setFormError(e.detail);
      else setFormError("Ошибка");
      toastApiError(e, "Не удалось создать должность");
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updatePosition>[1] }) =>
      updatePosition(id, body),
    onSuccess: async () => {
      await invalidateAndRefetch(qc, ["positions"]);
      toastSuccess("Изменения сохранены");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить"),
  });

  const deleteMut = useMutation({
    mutationFn: deletePosition,
    onSuccess: async () => {
      await invalidateAndRefetch(qc, ["positions"]);
      toastSuccess("Должность удалена");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить"),
  });

  const closeCreateModal = useCallback(() => setModal(false), []);
  const { backdropProps: positionModalBackdrop, stopPanelPointer: positionModalPanelStop } = useModalLayer(
    !!(modal && canManage),
    closeCreateModal,
    {
      closeOnBackdrop: !createMut.isPending,
      closeOnEscape: !createMut.isPending,
    },
  );

  const closeMembersModal = useCallback(() => {
    setMembersModalPosition(null);
    setMembersSearchQ("");
    setEmployeeDetailUserId(null);
  }, []);
  const { backdropProps: positionMembersBackdrop, stopPanelPointer: positionMembersPanelStop } = useModalLayer(
    !!membersModalPosition,
    closeMembersModal,
  );

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    createMut.mutate({
      name: name.trim(),
      slug: slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "position",
      description: description.trim() || null,
      sort_order: q.data?.length ?? 0,
    });
  }

  async function toggleActive(p: PositionOut) {
    if (!canManage) return;
    try {
      await updateMut.mutateAsync({ id: p.id, body: { is_active: !p.is_active } });
    } catch (e) {
      if (e instanceof ApiError) setFormError(e.detail);
    }
  }

  const items = q.data ?? [];
  const loading = q.isPending;
  const loadError = q.error instanceof ApiError ? q.error.detail : q.isError ? "Ошибка загрузки" : null;

  return (
    <AppShell title="Должности" subtitle="Справочник должностей для назначения сотрудникам">
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
            onClick={() => setModal(true)}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
          >
            + Должность
          </button>
        )}
      </div>

      {(loadError || formError) && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {formError ?? loadError}
        </p>
      )}
      {loading && <p className="text-slate-500">Загрузка…</p>}

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                  <p className="font-mono text-xs text-slate-500">{p.slug}</p>
                </div>
                {!p.is_active && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">off</span>
                )}
              </div>
              {p.description && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{p.description}</p>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Сотрудников с должностью: <span className="font-semibold">{p.user_count}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setMembersSearchQ("");
                  setMembersModalPosition(p);
                }}
                className="mt-2 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                Показать сотрудников
              </button>
              {canManage && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleActive(p)}
                    className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {p.is_active ? "Деактивировать" : "Активировать"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Удалить должность? У пользователей поле будет очищено.")) {
                        void deleteMut.mutateAsync(p.id).catch(() => {});
                      }
                    }}
                    className="rounded-lg bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300"
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
          {...positionModalBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div
            className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg"
            role="dialog"
            aria-modal="true"
            onClick={positionModalPanelStop}
          >
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Новая должность</h2>
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
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono dark:border-slate-600 dark:bg-slate-800"
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
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {createMut.isPending ? "Создание…" : "Создать"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {membersModalPosition && (
        <div
          {...positionMembersBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div
            className="glass flex max-h-[min(90vh,56rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-soft-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="position-members-title"
            onClick={positionMembersPanelStop}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-slate-600/60">
              <div className="min-w-0">
                <h2
                  id="position-members-title"
                  className="text-lg font-semibold text-slate-900 dark:text-white"
                >
                  Сотрудники: {membersModalPosition.name}
                </h2>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{membersModalPosition.slug}</p>
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
                      Нет активных сотрудников с этой должностью.
                    </p>
                  ) : (
                    <>
                      <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Поиск
                        <input
                          type="search"
                          value={membersSearchQ}
                          onChange={(e) => setMembersSearchQ(e.target.value)}
                          placeholder="Имя или email…"
                          autoComplete="off"
                          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </label>
                      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                        Показано: {filteredPositionMembers.length} из {(membersQuery.data ?? []).length}
                        {canViewEmployeeDirectory ? (
                          <span className="text-slate-400"> · строка — открыть карточку</span>
                        ) : null}
                      </p>
                      <div className="max-h-[min(60vh,28rem)] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                        <table className="w-full min-w-[20rem] text-left text-sm">
                          <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm dark:bg-slate-800/95 dark:shadow-[0_1px_0_0_rgba(51,65,85,0.6)]">
                            <tr>
                              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                                Сотрудник
                              </th>
                              <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Email</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {filteredPositionMembers.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={2}
                                  className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400"
                                >
                                  Никого не найдено по запросу.
                                </td>
                              </tr>
                            ) : (
                              filteredPositionMembers.map((m) => {
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
