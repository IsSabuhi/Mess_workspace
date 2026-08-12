import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

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
 *
 * Закрытие по фону только если pointerdown и click оба были на самом оверлее
 * (не закрываем при выделении текста с отпусканием кнопки за пределами панели).
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
  const backdropPointerDown = useRef(false);

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

  useEffect(() => {
    if (!open) backdropPointerDown.current = false;
  }, [open]);

  const onBackdropPointerDown = useCallback((e: ReactMouseEvent) => {
    backdropPointerDown.current = e.target === e.currentTarget;
  }, []);

  const onBackdropClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!closeOnBackdrop) return;
      if (!backdropPointerDown.current) return;
      if (e.target !== e.currentTarget) return;
      onClose();
    },
    [closeOnBackdrop, onClose],
  );

  const backdropProps = {
    role: "presentation" as const,
    onMouseDown: onBackdropPointerDown,
    onClick: onBackdropClick,
  };

  const stopPanelPointer = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  return { backdropProps, stopPanelPointer };
}
