import { AlertTriangle, Info, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import { Modal } from "./Modal";

export type ConfirmDialogVariant = "danger" | "warning" | "neutral";

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** Основной текст; можно передать JSX */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  pending?: boolean;
  /** Запретить закрытие по Escape и клику снаружи, пока pending */
  lockWhilePending?: boolean;
};

const variantStyles: Record<
  ConfirmDialogVariant,
  { icon: LucideIcon; wrap: string; iconColor: string }
> = {
  danger: {
    icon: AlertTriangle,
    wrap: "bg-red-50 dark:bg-red-950/35",
    iconColor: "text-red-600 dark:text-red-400",
  },
  warning: {
    icon: AlertTriangle,
    wrap: "bg-amber-50 dark:bg-amber-950/35",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  neutral: {
    icon: Info,
    wrap: "bg-sky-50/80 dark:bg-sky-950/25",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
};

const confirmButtonClass: Record<ConfirmDialogVariant, string> = {
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/40 disabled:bg-red-600/70",
  warning:
    "bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-500/40 disabled:bg-amber-600/70",
  neutral:
    "bg-sky-600 text-white hover:bg-sky-700 focus-visible:ring-sky-500/40 disabled:bg-sky-600/70",
};

/**
 * Готовое подтверждение с действием (удаление, сброс и т.д.). Собрано на базе {@link Modal}.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  variant = "neutral",
  pending = false,
  lockWhilePending = true,
}: ConfirmDialogProps) {
  const locked = pending && lockWhilePending;
  const v = variantStyles[variant];
  const Icon = v.icon;
  const titleId = useId();
  const descId = useId();

  return (
    <Modal
      open={open}
      onClose={() => !locked && onClose()}
      size="sm"
      closeOnBackdrop={!locked}
      closeOnEscape={!locked}
      className="overflow-hidden"
      labelledBy={titleId}
      describedBy={descId}
      footer={
        <>
          <button
            type="button"
            disabled={locked}
            onClick={onClose}
            className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:ring-offset-slate-900 ${confirmButtonClass[variant]}`}
          >
            {pending ? "Подождите…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${v.wrap}`}
          aria-hidden
        >
          <Icon className={`h-6 w-6 ${v.iconColor}`} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id={titleId} className="text-lg font-semibold leading-snug text-slate-900 dark:text-white">
            {title}
          </h2>
          <div id={descId} className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {message}
          </div>
        </div>
      </div>
    </Modal>
  );
}
