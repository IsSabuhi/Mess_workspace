import { toast as sonner } from "sonner";

import { ApiError } from "../api/client";
import { formatApiErrorDetail, httpStatusFallbackMessage } from "./apiErrorFormat";

export function toastSuccess(message: string) {
  sonner.success(message);
}

/** Показать ошибку и вернуть текст (удобно для setState). */
export function toastError(message: string): string {
  sonner.error(message);
  return message;
}

export function toastApiMessage(err: unknown, fallback = "Произошла ошибка"): string {
  if (err instanceof ApiError) {
    if (err.detail) return err.detail;
    return httpStatusFallbackMessage(err.status);
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

/** Если ошибка пришла как сырой JSON (не через apiFetch), попробовать разобрать. */
export function messageFromUnknownApiPayload(err: unknown, fallback = "Произошла ошибка"): string {
  if (err instanceof ApiError) return toastApiMessage(err, fallback);
  if (typeof err === "object" && err !== null && "detail" in err) {
    const d = formatApiErrorDetail((err as { detail: unknown }).detail);
    if (d) return d;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

/** Toast по ошибке API или сети. */
export function toastApiError(err: unknown, fallback = "Произошла ошибка") {
  sonner.error(toastApiMessage(err, fallback));
}
