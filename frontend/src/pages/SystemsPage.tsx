import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { createSystem, listSystems, updateSystem } from "../api/systems";
import type { SystemOut } from "../api/systems";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { invalidateAndRefetch } from "../lib/queryClient";
import { PERM, hasPermission } from "../lib/permissions";
import { toastApiError, toastSuccess } from "../lib/toast";

export function SystemsPage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canManage = user && hasPermission(user, PERM.SYSTEMS_MANAGE);
  const qc = useQueryClient();

  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const systemsQuery = useQuery({
    queryKey: ["systems", showInactive],
    queryFn: () => listSystems(!showInactive),
  });

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
      setFormError(null);
      toastSuccess("Система создана");
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) setFormError(e.detail);
      toastApiError(e, "Не удалось создать систему");
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateSystem>[1] }) =>
      updateSystem(id, body),
    onSuccess: async () => {
      await invalidateAndRefetch(qc, ["systems"]);
      toastSuccess("Статус системы обновлён");
    },
    onError: (e: unknown) => {
      toastApiError(e, "Не удалось обновить систему");
    },
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    createMut.mutate({
      name: name.trim(),
      slug: slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""),
      description: description.trim() || null,
      sort_order: items.length,
    });
  }

  function toggleActive(s: SystemOut) {
    if (!canManage) return;
    updateMut.mutate({ id: s.id, body: { is_active: !s.is_active } });
  }

  return (
    <AppShell title="Системы" subtitle="Производственные системы отдела">
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
              {canManage && (
                <button
                  type="button"
                  onClick={() => toggleActive(s)}
                  disabled={updateMut.isPending}
                  className="mt-3 text-xs font-medium text-sky-600 hover:underline disabled:opacity-50 dark:text-sky-400"
                >
                  {s.is_active ? "Деактивировать" : "Активировать"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg">
            <h2 className="mb-4 text-lg font-semibold">Новая система</h2>
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
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModal(false)}
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
    </AppShell>
  );
}
