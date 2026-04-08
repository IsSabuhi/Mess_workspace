import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { fetchLoginHistory, patchProfile } from "../api/auth";
import type { LoginAuditOut } from "../api/auth";
import { ApiError } from "../api/client";
import { listPositions } from "../api/positions";
import type { PositionOut } from "../api/positions";
import { toastApiError, toastSuccess } from "../lib/toast";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

/** Активные должности + текущая должность пользователя, если она снята с учёта (чтобы select не «ломался»). */
function usePositionOptions(userPosition: { id: string; name: string; slug: string } | null | undefined, activeList: PositionOut[]) {
  return useMemo(() => {
    const byId = new Map(activeList.map((p) => [p.id, p]));
    const out: PositionOut[] = [...activeList];
    if (userPosition && !byId.has(userPosition.id)) {
      out.unshift({
        id: userPosition.id,
        name: `${userPosition.name} (не в справочнике)`,
        slug: userPosition.slug,
        description: null,
        sort_order: -1,
        is_active: false,
        created_at: "",
      });
    }
    return out;
  }, [userPosition, activeList]);
}

export function SettingsPage() {
  const { theme, setTheme, resolved } = useTheme();
  const { state, setAuthenticatedUser } = useAuth();
  const qc = useQueryClient();
  const user = state.status === "authenticated" ? state.user : null;

  const [fullName, setFullName] = useState("");
  const [positionId, setPositionId] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const positionsQuery = useQuery({
    queryKey: ["positions", "settings"],
    queryFn: () => listPositions(true),
    enabled: !!user,
  });

  const positionOptions = usePositionOptions(user?.position ?? null, positionsQuery.data ?? []);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name);
      setPositionId(user.position?.id ?? "");
      setBirthDate(user.birth_date ? user.birth_date.slice(0, 10) : "");
    }
  }, [user]);

  const historyQuery = useQuery({
    queryKey: ["auth", "login-history"],
    queryFn: fetchLoginHistory,
    enabled: !!user,
  });

  const saveMut = useMutation({
    mutationFn: () =>
      patchProfile({
        full_name: fullName.trim(),
        position_id: positionId.trim() || null,
        birth_date: birthDate.trim() || null,
      }),
    onSuccess: async (updated) => {
      setMsg("Профиль сохранён");
      setErr(null);
      toastSuccess("Профиль сохранён");
      setAuthenticatedUser(updated);
      await qc.invalidateQueries({ queryKey: ["positions", "settings"] });
      await qc.invalidateQueries({ queryKey: ["auth", "login-history"] });
    },
    onError: (e: unknown) => {
      setMsg(null);
      if (e instanceof ApiError) setErr(e.detail);
      else setErr("Не удалось сохранить");
      toastApiError(e, "Не удалось сохранить профиль");
    },
  });

  function onSubmitProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    saveMut.mutate();
  }

  return (
    <AppShell title="Настройки" subtitle="Профиль, тема и последние входы">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          <h2 className="font-semibold text-slate-900 dark:text-white">Профиль</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ФИО, должность и дата рождения. Производственные системы назначает администратор в разделе «Пользователи». Email
            меняется только администратором.
          </p>
          {user && (
            <form onSubmit={onSubmitProfile} className="mt-4 space-y-3">
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
                <label className="mb-1 block text-sm font-medium">Должность</label>
                <select
                  value={positionId}
                  onChange={(e) => setPositionId(e.target.value)}
                  disabled={positionsQuery.isPending}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                >
                  <option value="">— не выбрана —</option>
                  {positionOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">Производственные системы</p>
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                  Назначаются администратором.
                </p>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                  {user.systems?.length ? (
                    <ul className="list-inside list-disc space-y-0.5">
                      {user.systems.map((s) => (
                        <li key={s.id}>
                          {s.name}{" "}
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">({s.slug})</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">Не назначены — обратитесь к администратору.</span>
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
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/80 dark:text-slate-400">
                Email: <span className="font-mono text-slate-800 dark:text-slate-200">{user.email}</span>
              </div>
              {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
              {msg && <p className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</p>}
              <button
                type="submit"
                disabled={saveMut.isPending}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {saveMut.isPending ? "Сохранение…" : "Сохранить профиль"}
              </button>
            </form>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          <h2 className="font-semibold text-slate-900 dark:text-white">Тема</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Сейчас активна: <strong className="text-slate-800 dark:text-slate-200">{resolved}</strong>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  theme === t
                    ? "bg-sky-500 text-white shadow-md"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {t === "light" ? "Светлая" : t === "dark" ? "Тёмная" : "Как в системе"}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          <h2 className="font-semibold text-slate-900 dark:text-white">Последние входы</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            IP и браузер при успешной авторизации.
          </p>
          {historyQuery.isPending && <p className="mt-3 text-sm text-slate-500">Загрузка…</p>}
          {historyQuery.isError && (
            <p className="mt-3 text-sm text-red-600">Не удалось загрузить историю</p>
          )}
          {historyQuery.data && historyQuery.data.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">Записей пока нет (входы после обновления сервера).</p>
          )}
          {historyQuery.data && historyQuery.data.length > 0 && (
            <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto text-sm">
              {historyQuery.data.map((row: LoginAuditOut) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <div className="text-xs text-slate-500">
                    {new Date(row.created_at).toLocaleString("ru-RU")}
                  </div>
                  <div className="font-mono text-xs text-slate-700 dark:text-slate-300">
                    {row.ip_address ?? "—"}
                  </div>
                  <div className="truncate text-xs text-slate-500">{row.user_agent ?? "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
