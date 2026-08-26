import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { toastError } from "../lib/toast";

export const INSUFFICIENT_RIGHTS = "Недостаточно прав";

type Buttonish = {
  disabled?: boolean;
  className?: string;
};

export function toastInsufficientRights() {
  toastError(INSUFFICIENT_RIGHTS);
}

/** Если нет права — toast и выход, иначе выполнить действие. */
export function guardPermission(allowed: boolean, run: () => void) {
  if (!allowed) {
    toastInsufficientRights();
    return;
  }
  run();
}

/**
 * Без права кнопка/чекбокс выглядит disabled; клик по обёртке показывает toast.
 * Нативный disabled не ловит клик, поэтому pointer-events снимаются с ребёнка.
 */
export function NeedPermission({
  allowed,
  message = INSUFFICIENT_RIGHTS,
  className,
  children,
}: {
  allowed: boolean;
  message?: string;
  className?: string;
  children: ReactNode;
}) {
  if (allowed) return <>{children}</>;

  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Buttonish>, {
        disabled: true,
        className: [((children as ReactElement<Buttonish>).props.className ?? "").trim(), "pointer-events-none"]
          .filter(Boolean)
          .join(" "),
      })
    : children;

  return (
    <span
      className={className ?? "inline-flex cursor-not-allowed"}
      title={message}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toastError(message);
      }}
    >
      {child}
    </span>
  );
}
