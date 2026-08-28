import { formatApiErrorDetail, httpStatusFallbackMessage } from "../lib/apiErrorFormat";

export const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "")
  || (import.meta.env.DEV ? "" : "/mes/api");

/** status = 0 — запрос не дошёл до сервера (нет сети, CORS, сервер недоступен). */
export const NETWORK_ERROR_STATUS = 0;

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }

  /** Сервер не ответил: показывать как проблему связи, а не как разлогин. */
  get isNetworkError(): boolean {
    return this.status === NETWORK_ERROR_STATUS;
  }
}

/** Сессия окончательно недействительна — AuthContext переводит UI в анонимное состояние. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

const AUTH_FREE_PATHS = [
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/register",
  "/api/v1/auth/logout",
];

/**
 * Один общий refresh на все параллельные 401: иначе десяток одновременных запросов
 * шлёт десяток /refresh, а с ротацией токенов это выглядит как кража и рвёт сессию.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const retried = (options as RequestInit & { _retried?: boolean })._retried === true;
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...options,
      headers,
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_STATUS, "Нет соединения с сервером — проверьте сеть");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { detail: text };
    }
  }

  if (!res.ok) {
    const authFree = AUTH_FREE_PATHS.some((p) => path.includes(p));
    if (res.status === 401 && !authFree) {
      if (!retried && (await refreshSession())) {
        return apiFetch<T>(path, { ...options, _retried: true } as RequestInit);
      }
      // Сессию продлить не удалось — уводим приложение в анонимное состояние,
      // иначе UI остаётся «авторизованным» и сыпет ошибками до перезагрузки.
      onUnauthorized?.();
    }
    let detail = "";
    if (typeof data === "object" && data !== null && "detail" in data) {
      detail = formatApiErrorDetail((data as { detail: unknown }).detail);
    } else if (data !== null && data !== undefined) {
      detail = formatApiErrorDetail(data);
    }
    if (!detail) {
      detail = res.statusText?.trim() || httpStatusFallbackMessage(res.status);
    }
    throw new ApiError(res.status, detail);
  }

  return data as T;
}
