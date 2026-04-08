import { LogOut, Moon, Sun } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

type Props = {
  title: string;
  subtitle?: string;
};

export function TopBar({ title, subtitle }: Props) {
  const { state, signOut } = useAuth();
  const { resolved, toggle } = useTheme();

  const userLabel =
    state.status === "authenticated"
      ? state.user.full_name || state.user.email
      : "";

  return (
    <header className="glass sticky top-0 z-30 flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-white/50 px-4 py-3 dark:border-slate-700/50">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-sky-500/50 dark:hover:text-sky-200"
          title={resolved === "dark" ? "Светлая тема" : "Тёмная тема"}
        >
          {resolved === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
        {state.status === "authenticated" && (
          <>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{userLabel}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{state.user.email}</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-medium text-white shadow-md shadow-slate-900/15 transition hover:bg-slate-800 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Выйти</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
}
