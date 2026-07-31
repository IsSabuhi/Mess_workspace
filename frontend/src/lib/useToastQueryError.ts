import { useEffect, useRef } from "react";

import { toastApiError } from "./toast";

/** Один toast при появлении/смене ошибки React Query (без баннера на странице). */
export function useToastQueryError(error: unknown, fallback: string) {
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      lastKey.current = null;
      return;
    }
    const key =
      error instanceof Error
        ? `${error.name}:${error.message}`
        : typeof error === "object" && error !== null && "detail" in error
          ? String((error as { detail: unknown }).detail)
          : String(error);
    if (lastKey.current === key) return;
    lastKey.current = key;
    toastApiError(error, fallback);
  }, [error, fallback]);
}
