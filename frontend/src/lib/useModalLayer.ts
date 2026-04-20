import { useCallback, useEffect, type MouseEvent as ReactMouseEvent } from "react";

export type ModalLayerOptions = {
  /** @default true */
  closeOnBackdrop?: boolean;
  /** @default true */
  closeOnEscape?: boolean;
  /** @default true */
  lockBodyScroll?: boolean;
};

/**
 * Поведение оверлея модалки: затемнение по клику, Escape, блокировка прокрутки body.
 * Панель контента должна вызывать {@link stopPanelPointer} на onClick, чтобы клики не закрывали окно.
 */
export function useModalLayer(
  open: boolean,
  onClose: () => void,
  {
    closeOnBackdrop = true,
    closeOnEscape = true,
    lockBodyScroll = true,
  }: ModalLayerOptions = {},
) {
  useEffect(() => {
    if (!open || !lockBodyScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, lockBodyScroll]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  const onBackdropClick = useCallback(() => {
    if (closeOnBackdrop) onClose();
  }, [closeOnBackdrop, onClose]);

  const backdropProps = {
    role: "presentation" as const,
    onClick: onBackdropClick,
  };

  const stopPanelPointer = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  return { backdropProps, stopPanelPointer };
}
