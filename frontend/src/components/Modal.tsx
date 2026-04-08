import { useEffect, useId, useRef, type ReactNode } from "react";

export type ModalSize = "sm" | "md" | "lg";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** Закрытие по клику на затемнение (по умолчанию true) */
  closeOnBackdrop?: boolean;
  /** Не закрывать по Escape (например, пока идёт сохранение) */
  closeOnEscape?: boolean;
  className?: string;
  /** Если заголовок/описание только в children — передайте id для aria-* */
  labelledBy?: string;
  describedBy?: string;
};

const sizeClass: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

/**
 * Универсальное модальное окно: затемнение, клик вне, Escape, блокировка прокрутки body.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  closeOnEscape = true,
  className = "",
  labelledBy: labelledByProp,
  describedBy: describedByProp,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const ariaLabelledBy = title ? titleId : labelledByProp;
  const ariaDescribedBy = description ? descId : describedByProp;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => closeOnBackdrop && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={`glass w-full ${sizeClass[size]} rounded-2xl border border-white/60 p-0 shadow-soft-lg outline-none dark:border-slate-700/60 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-700/80">
            {title ? (
              <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-white">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p id={descId} className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {description}
              </p>
            ) : null}
          </div>
        )}
        {children ? <div className="px-5 py-4">{children}</div> : null}
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 px-5 py-4 dark:border-slate-700/80">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
