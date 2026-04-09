import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { ApiError } from "../api/client";
import {
  listEmployeeDirectory,
  patchEmployeeDirectory,
  type EmployeeDirectoryRowOut,
} from "../api/employeeDirectory";
import { listPositions } from "../api/positions";
import { listSystems } from "../api/systems";
import { AppShell } from "../components/AppShell";
import { PERM, hasPermission } from "../lib/permissions";
import { toastApiError, toastSuccess } from "../lib/toast";
import { useAuth } from "../context/AuthContext";

function asInputDate(v: string | null): string {
  return v ? v.slice(0, 10) : "";
}

export function EmployeeDirectoryPage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const canManage = !!(user && hasPermission(user, PERM.EMPLOYEE_DIRECTORY_MANAGE));
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [systemId, setSystemId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [expiredOnly, setExpiredOnly] = useState(false);
  /** Пусто = все сотрудники; число = только те, у кого срок экзамена или пропуска истекает в эти N дней */
  const [expiringDays, setExpiringDays] = useState<string>("");
  const [editing, setEditing] = useState<EmployeeDirectoryRowOut | null>(null);
  const [form, setForm] = useState({
    exam_electrical_passed: false,
    exam_electrical_date: "",
    exam_electrical_valid_to: "",
    pass_has: false,
    pass_number: "",
    pass_valid_from: "",
    pass_valid_to: "",
    notes: "",
  });

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      system_id: systemId || undefined,
      position_id: positionId || undefined,
      expired_only: expiredOnly || undefined,
      expiring_in_days: !expiredOnly && expiringDays.trim() ? Number(expiringDays) : undefined,
    }),
    [search, systemId, positionId, expiredOnly, expiringDays],
  );

  const rowsQuery = useQuery({
    queryKey: ["employee-directory", filters],
    queryFn: () => listEmployeeDirectory(filters),
    enabled: !!user,
  });
  const systemsQuery = useQuery({ queryKey: ["systems", "all-for-directory"], queryFn: () => listSystems(false) });
  const positionsQuery = useQuery({ queryKey: ["positions", "all-for-directory"], queryFn: () => listPositions(false) });

  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof patchEmployeeDirectory>[1] }) =>
      patchEmployeeDirectory(id, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["employee-directory"] });
      toastSuccess("Данные сотрудника сохранены");
      setEditing(null);
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить"),
  });

  const rows = rowsQuery.data ?? [];
  const loadError = rowsQuery.error instanceof ApiError ? rowsQuery.error.detail : rowsQuery.isError ? "Ошибка загрузки" : null;

  function openEdit(row: EmployeeDirectoryRowOut) {
    setEditing(row);
    setForm({
      exam_electrical_passed: row.exam_electrical_passed,
      exam_electrical_date: asInputDate(row.exam_electrical_date),
      exam_electrical_valid_to: asInputDate(row.exam_electrical_valid_to),
      pass_has: row.pass_has,
      pass_number: row.pass_number ?? "",
      pass_valid_from: asInputDate(row.pass_valid_from),
      pass_valid_to: asInputDate(row.pass_valid_to),
      notes: row.notes ?? "",
    });
  }

  return (
    <AppShell title="Справочник сотрудников">
      <div className="mb-4 grid gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-soft dark:border-slate-700 dark:bg-slate-900/60 md:grid-cols-5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск: ФИО или email"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <select
          value={systemId}
          onChange={(e) => setSystemId(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">Все системы</option>
          {(systemsQuery.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={positionId}
          onChange={(e) => setPositionId(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">Все должности</option>
          {(positionsQuery.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
          <input type="checkbox" checked={expiredOnly} onChange={(e) => setExpiredOnly(e.target.checked)} />
          Только просроченные
        </label>
        <div className="flex flex-col gap-1">
          <input
            type="number"
            min={0}
            disabled={expiredOnly}
            value={expiringDays}
            onChange={(e) => setExpiringDays(e.target.value)}
            placeholder="Напр. 30"
            title="Оставьте пустым, чтобы показать всех. Число — фильтр по срокам экзамена и пропуска."
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Пусто = все; число = истекает в ближайшие N дней
          </span>
        </div>
      </div>

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          disabled={rowsQuery.isPending}
          onClick={async () => {
            try {
              const { downloadEmployeeDirectoryExcel } = await import("../lib/exportEmployeeDirectoryExcel");
              await downloadEmployeeDirectoryExcel(rows);
              toastSuccess("Файл Excel сформирован");
            } catch (e: unknown) {
              toastApiError(e, "Не удалось сформировать Excel");
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          <Download className="h-4 w-4 shrink-0" aria-hidden />
          Выгрузить в Excel
        </button>
      </div>

      {loadError && (
        <p className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {loadError}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/70">
            <tr>
              <th className="px-3 py-2">Сотрудник</th>
              <th className="px-3 py-2">Должность</th>
              <th className="px-3 py-2">Системы</th>
              <th className="px-3 py-2">Эл.безопасность</th>
              <th className="px-3 py-2">Пропуск</th>
              <th className="px-3 py-2">Примечание</th>
              {canManage && <th className="px-3 py-2">Действия</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-900 dark:text-white">{r.full_name}</p>
                  <p className="text-xs text-slate-500">{r.email}</p>
                </td>
                <td className="px-3 py-2">{r.position?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.systems.map((s) => s.name).join(", ") || "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {r.exam_electrical_passed ? "Сдан" : "Нет"}
                  <br />
                  до: {r.exam_electrical_valid_to ? asInputDate(r.exam_electrical_valid_to) : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.pass_has ? `Есть (${r.pass_number ?? "без №"})` : "Нет"}
                  <br />
                  до: {r.pass_valid_to ? asInputDate(r.pass_valid_to) : "—"}
                </td>
                <td className="px-3 py-2 text-xs">{r.notes || "—"}</td>
                {canManage && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                    >
                      Изменить
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!rowsQuery.isPending && rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-3 py-6 text-center text-sm text-slate-500">
                  По выбранным фильтрам данных нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-xl rounded-2xl p-6 shadow-soft-lg">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{editing.full_name}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveMut.mutate({
                  id: editing.id,
                  body: {
                    exam_electrical_passed: form.exam_electrical_passed,
                    exam_electrical_date: form.exam_electrical_date || null,
                    exam_electrical_valid_to: form.exam_electrical_valid_to || null,
                    pass_has: form.pass_has,
                    pass_number: form.pass_number.trim() || null,
                    pass_valid_from: form.pass_valid_from || null,
                    pass_valid_to: form.pass_valid_to || null,
                    notes: form.notes.trim() || null,
                  },
                });
              }}
              className="space-y-3"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.exam_electrical_passed}
                  onChange={(e) => setForm((p) => ({ ...p, exam_electrical_passed: e.target.checked }))}
                />
                Экзамен по электробезопасности сдан
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={form.exam_electrical_date}
                  onChange={(e) => setForm((p) => ({ ...p, exam_electrical_date: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <input
                  type="date"
                  value={form.exam_electrical_valid_to}
                  onChange={(e) => setForm((p) => ({ ...p, exam_electrical_valid_to: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.pass_has}
                  onChange={(e) => setForm((p) => ({ ...p, pass_has: e.target.checked }))}
                />
                Есть пропуск
              </label>
              <input
                value={form.pass_number}
                onChange={(e) => setForm((p) => ({ ...p, pass_number: e.target.value }))}
                placeholder="Номер пропуска"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={form.pass_valid_from}
                  onChange={(e) => setForm((p) => ({ ...p, pass_valid_from: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
                <input
                  type="date"
                  value={form.pass_valid_to}
                  onChange={(e) => setForm((p) => ({ ...p, pass_valid_to: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                rows={3}
                placeholder="Примечание"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saveMut.isPending}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saveMut.isPending ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
