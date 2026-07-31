import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";

import { patchProfile } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { toastApiError, toastSuccess } from "../lib/toast";
import { Modal } from "./Modal";

/**
 * Блокирующее окно после входа, если админ сбросил пароль или учётка создана с временным паролем.
 */
export function ForcePasswordChangeModal() {
  const { state, setAuthenticatedUser } = useAuth();
  const mustChange =
    state.status === "authenticated" && !!state.user.must_change_password;

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const mut = useMutation({
    mutationFn: () => patchProfile({ new_password: newPassword }),
    onSuccess: (user) => {
      setAuthenticatedUser(user);
      setNewPassword("");
      setConfirmPassword("");
      toastSuccess("Пароль обновлён");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сменить пароль"),
  });

  if (!mustChange) return null;

  const canSubmit =
    newPassword.length >= 8 && newPassword === confirmPassword && !mut.isPending;

  return (
    <Modal
      open
      onClose={() => {}}
      closeOnBackdrop={false}
      closeOnEscape={false}
      size="sm"
      title={
        <span className="inline-flex items-center gap-2">
          <Lock className="h-5 w-5 text-sky-600 dark:text-sky-400" strokeWidth={2} />
          Смена пароля
        </span>
      }
      description="Нужно задать свой пароль перед продолжением работы (временный пароль после создания или сброса учётной записи)."
      footer={
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => mut.mutate()}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
        >
          {mut.isPending ? "Сохранение…" : "Сохранить пароль"}
        </button>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">Новый пароль</span>
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm dark:border-slate-600 dark:bg-slate-800"
              placeholder="Минимум 8 символов"
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={showNew ? "Скрыть пароль" : "Показать пароль"}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">Повтор пароля</span>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={showConfirm ? "Скрыть пароль" : "Показать пароль"}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        {newPassword.length > 0 && newPassword.length < 8 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">Пароль слишком короткий</p>
        )}
        {confirmPassword.length > 0 && newPassword !== confirmPassword && (
          <p className="text-xs text-red-600 dark:text-red-400">Пароли не совпадают</p>
        )}
      </div>
    </Modal>
  );
}
