import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

import { ApiError } from "../api/client";
import { toastApiError, toastSuccess } from "../lib/toast";
import { registerUser } from "../api/auth";
import { useAuth } from "../context/AuthContext";

export function BootstrapPage() {
  const { state } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  if (state.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await registerUser(email.trim(), password, fullName.trim());
      setDone(true);
      toastSuccess("Учётная запись создана");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail);
      } else {
        setError("Не удалось создать пользователя");
      }
      toastApiError(err, "Не удалось создать пользователя");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="glass max-w-md rounded-2xl p-8 text-center shadow-soft-lg">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Готово</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-300">
            Учётная запись создана. Теперь войдите с этим email и паролем.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-flex rounded-xl bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
          >
            На страницу входа
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass w-full max-w-md rounded-2xl p-8 shadow-soft-lg">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Регистрация пользователя</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Новая учётная запись создаётся неактивной. Вход станет доступен после активации администратором.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">ФИО</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 dark:border-slate-600 dark:bg-slate-800/90"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 dark:border-slate-600 dark:bg-slate-800/90"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Пароль (мин. 8 символов)</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 pr-12 dark:border-slate-600 dark:bg-slate-800/90"
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
          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-sky-500 py-3 font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
          >
            {loading ? "Создание…" : "Зарегистрироваться"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="text-sky-600 hover:underline dark:text-sky-400">
            Уже есть аккаунт — войти
          </Link>
        </p>
      </div>
    </div>
  );
}
