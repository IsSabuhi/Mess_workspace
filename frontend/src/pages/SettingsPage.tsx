import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, LayoutDashboard, Moon, Palette, Sun, Monitor, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchLoginHistory, patchProfile } from "../api/auth";
import type { LoginAuditOut } from "../api/auth";
import { HOME_DASHBOARD_BLOCK_IDS, isHomeBlockVisible as isDashboardBlockShown } from "../lib/homeDashboardBlocks";
import { ApiError } from "../api/client";
import { listPositions } from "../api/positions";
import type { PositionOut } from "../api/positions";
import { AppShell } from "../components/AppShell";
import { Switch } from "../components/Switch";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { PERM, canEmployeeDirectoryAccess, hasPermission } from "../lib/permissions";
import { toastApiError, toastSuccess } from "../lib/toast";

const HOME_BLOCK_LABELS: Record<string, string> = {
  employee_expiry: "Контроль сроков сотрудников",
  my_tasks_panel: "Счётчики и блок «Мои задачи и сроки»",
  employee_focus: "Подсказка «Фокус сотрудника»",
  manager_approval: "На согласовании",
  manager_team_overdue: "Просроченные задачи команды",
  manager_by_system: "По системам (проектам)",
  manager_analytics: "Аналитика по сотрудникам",
  manager_own_tasks: "Ваши задачи как исполнителя",
};

const HOME_BLOCK_HINTS: Record<string, string> = {
  employee_expiry: "Сводка по просроченным и истекающим срокам из справочника",
  my_tasks_panel: "Карточки со счётчиками и список ваших задач с дедлайнами",
  employee_focus: "Краткая подсказка по приоритетам на главной",
  manager_approval: "Задачи в колонках согласования",
  manager_team_overdue: "Список просроченных задач по команде",
  manager_by_system: "Распределение активных задач по проектам",
  manager_analytics: "Таблица по исполнителям: активные и просроченные",
  manager_own_tasks: "Ваши задачи в роли исполнителя",
};

const inputClass =
  "w-full rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/15 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100 dark:focus:border-sky-500/50 dark:focus:ring-sky-500/20";

const cardClass =
  "overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 shadow-soft backdrop-blur-sm dark:border-slate-700/80 dark:bg-slate-900/70";

/** Активные должности + текущая должность пользователя, если она снята с учёта (чтобы select не «ломался»). */
function usePositionOptions(
  userPosition: { id: string; name: string; slug: string } | null | undefined,
  activeList: PositionOut[],
) {
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
        user_count: 0,
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
  const [homeBlockVisible, setHomeBlockVisible] = useState<Record<string, boolean>>({});
  const homeBlockVisibleRef = useRef(homeBlockVisible);
  homeBlockVisibleRef.current = homeBlockVisible;

  const isManager = useMemo(
    () =>
      !!user &&
      (hasPermission(user, PERM.TASKS_READ_ALL) ||
        hasPermission(user, PERM.TASKS_UPDATE_ALL) ||
        hasPermission(user, PERM.USERS_MANAGE) ||
        user.is_superuser),
    [user],
  );

  const allowedHomeDashboardBlocks = useMemo(() => {
    if (!user) return [] as string[];
    const ids: string[] = [];
    if (!isManager) {
      ids.push("my_tasks_panel", "employee_focus");
    } else {
      ids.push(
        "manager_approval",
        "manager_team_overdue",
        "manager_by_system",
        "manager_analytics",
        "manager_own_tasks",
      );
    }
    if (canEmployeeDirectoryAccess(user)) {
      ids.push("employee_expiry");
    }
    return ids;
  }, [user, isManager]);

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

  useEffect(() => {
    if (!user) return;
    const next: Record<string, boolean> = {};
    for (const id of HOME_DASHBOARD_BLOCK_IDS) {
      next[id] = isDashboardBlockShown(user.dashboard_preferences, id);
    }
    homeBlockVisibleRef.current = next;
    setHomeBlockVisible(next);
  }, [user]);

  const historyQuery = useQuery({
    queryKey: ["auth", "login-history"],
    queryFn: fetchLoginHistory,
    enabled: !!user,
  });

  const patchDashboardMut = useMutation({
    mutationFn: (home: Record<string, boolean>) =>
      patchProfile({ dashboard_preferences: { home } }),
    onSuccess: (updated) => {
      setAuthenticatedUser(updated);
      toastSuccess("Настройки главной сохранены");
    },
    onError: (e: unknown) => {
      toastApiError(e, "Не удалось сохранить настройки главной");
      if (!user) return;
      const next: Record<string, boolean> = {};
      for (const bid of HOME_DASHBOARD_BLOCK_IDS) {
        next[bid] = isDashboardBlockShown(user.dashboard_preferences, bid);
      }
      homeBlockVisibleRef.current = next;
      setHomeBlockVisible(next);
    },
  });

  function persistHomeBlock(id: string, visible: boolean) {
    const nextVisible = { ...homeBlockVisibleRef.current, [id]: visible };
    homeBlockVisibleRef.current = nextVisible;
    setHomeBlockVisible(nextVisible);
    const home: Record<string, boolean> = {};
    for (const bid of allowedHomeDashboardBlocks) {
      home[bid] = nextVisible[bid] !== false;
    }
    patchDashboardMut.mutate(home);
  }

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

  const themeDescription =
    theme === "system"
      ? `как в системе (сейчас ${resolved === "dark" ? "тёмное" : "светлое"} оформление)`
      : theme === "dark"
        ? "тёмное оформление"
        : "светлое оформление";

  return (
    <AppShell title="Настройки" subtitle="Профиль, внешний вид и безопасность">
      <div className="relative mx-auto max-w-3xl">
        <div className="pointer-events-none absolute -right-24 -top-8 h-56 w-56 rounded-full bg-sky-400/15 blur-3xl dark:bg-sky-500/10" />
        <div className="pointer-events-none absolute -left-20 top-48 h-48 w-48 rounded-full bg-indigo-400/12 blur-3xl dark:bg-indigo-500/10" />

        <div className="relative space-y-8">
          {/* Профиль */}
          <section className={cardClass}>
            <div className="border-b border-slate-100 bg-gradient-to-r from-sky-50/90 via-white to-indigo-50/50 px-6 py-5 dark:border-slate-700/80 dark:from-sky-950/40 dark:via-slate-900/80 dark:to-indigo-950/30 sm:px-8">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/25">
                  <UserRound className="h-6 w-6" strokeWidth={1.75} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">Профиль</h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    ФИО, должность и дата рождения. Системы назначает администратор. Email меняется только у
                    администратора.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 sm:p-8">
              {user && (
                <form onSubmit={onSubmitProfile} className="space-y-5">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">ФИО</label>
                    <input
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                      Должность
                    </label>
                    <select
                      value={positionId}
                      onChange={(e) => setPositionId(e.target.value)}
                      disabled={positionsQuery.isPending}
                      className={inputClass}
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
                    <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                      Производственные системы
                    </p>
                    <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Назначаются администратором.</p>
                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                      {user.systems?.length ? (
                        <ul className="space-y-1.5">
                          {user.systems.map((s) => (
                            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-medium text-slate-800 dark:text-slate-100">{s.name}</span>
                              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">({s.slug})</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">
                          Не назначены — обратитесь к администратору.
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                      Дата рождения
                    </label>
                    <input
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
                    Email:{" "}
                    <span className="break-all font-mono text-slate-800 dark:text-slate-200">{user.email}</span>
                  </div>
                  {err && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      {err}
                    </p>
                  )}
                  {msg && (
                    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      {msg}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={saveMut.isPending}
                    className="rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-500/25 transition hover:from-sky-600 hover:to-indigo-700 disabled:opacity-60"
                  >
                    {saveMut.isPending ? "Сохранение…" : "Сохранить профиль"}
                  </button>
                </form>
              )}
            </div>
          </section>

          {/* Тема */}
          <section className={cardClass}>
            <div className="border-b border-slate-100 px-6 py-5 dark:border-slate-700/80 sm:px-8">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                  <Palette className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">Оформление</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Активно:{" "}
                    <span className="font-medium text-slate-800 dark:text-slate-200">{themeDescription}</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 sm:p-8">
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    { id: "light" as const, label: "Светлая", Icon: Sun },
                    { id: "dark" as const, label: "Тёмная", Icon: Moon },
                    { id: "system" as const, label: "Как в системе", Icon: Monitor },
                  ] as const
                ).map(({ id, label, Icon }) => {
                  const active = theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTheme(id)}
                      className={`flex flex-col items-center gap-3 rounded-2xl border px-4 py-5 text-center transition ${
                        active
                          ? "border-sky-400 bg-sky-50/90 shadow-md shadow-sky-500/10 dark:border-sky-600 dark:bg-sky-950/40"
                          : "border-slate-200/90 bg-slate-50/50 hover:border-slate-300 hover:bg-white dark:border-slate-600 dark:bg-slate-800/40 dark:hover:border-slate-500"
                      }`}
                    >
                      <span
                        className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                          active
                            ? "bg-sky-500 text-white shadow-inner"
                            : "bg-white text-slate-600 shadow-sm dark:bg-slate-700 dark:text-slate-300"
                        }`}
                      >
                        <Icon className="h-6 w-6" strokeWidth={1.5} />
                      </span>
                      <span
                        className={`text-sm font-semibold ${
                          active ? "text-sky-900 dark:text-sky-100" : "text-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Главная */}
          {allowedHomeDashboardBlocks.length > 0 && (
            <section className={cardClass}>
              <div className="border-b border-slate-100 px-6 py-5 dark:border-slate-700/80 sm:px-8">
                <div className="flex items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <LayoutDashboard className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
                      Главная страница
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      Переключатель сохраняется сразу. Отключённые блоки по возможности не запрашивают данные на главной.
                    </p>
                  </div>
                </div>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/80">
                {allowedHomeDashboardBlocks.map((id) => {
                  const labelId = `home-dash-${id}`;
                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8 sm:py-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p id={labelId} className="font-medium text-slate-900 dark:text-slate-100">
                          {HOME_BLOCK_LABELS[id] ?? id}
                        </p>
                        {HOME_BLOCK_HINTS[id] && (
                          <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                            {HOME_BLOCK_HINTS[id]}
                          </p>
                        )}
                      </div>
                      <Switch
                        aria-labelledby={labelId}
                        checked={homeBlockVisible[id] !== false}
                        disabled={patchDashboardMut.isPending}
                        onCheckedChange={(v) => persistHomeBlock(id, v)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* История входов */}
          <section className={cardClass}>
            <div className="border-b border-slate-100 px-6 py-5 dark:border-slate-700/80 sm:px-8">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-200/90 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  <History className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
                    Последние входы
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    IP и браузер при успешной авторизации.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 sm:p-8">
              {historyQuery.isPending && (
                <p className="text-sm text-slate-500 dark:text-slate-400">Загрузка…</p>
              )}
              {historyQuery.isError && (
                <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  Не удалось загрузить историю
                </p>
              )}
              {historyQuery.data && historyQuery.data.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
                  Записей пока нет — отображаются входы после обновления сервера.
                </p>
              )}
              {historyQuery.data && historyQuery.data.length > 0 && (
                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {historyQuery.data.map((row: LoginAuditOut) => (
                    <li
                      key={row.id}
                      className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50/90 px-4 py-3 text-sm dark:border-slate-700 dark:from-slate-800/80 dark:to-slate-900/60"
                    >
                      <div className="text-xs font-medium text-sky-700 dark:text-sky-400">
                        {new Date(row.created_at).toLocaleString("ru-RU")}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-800 dark:text-slate-200">
                        {row.ip_address ?? "—"}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400" title={row.user_agent ?? ""}>
                        {row.user_agent ?? "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
