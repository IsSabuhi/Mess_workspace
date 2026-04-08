import { formatApiErrorDetail, httpStatusFallbackMessage } from "../lib/apiErrorFormat";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
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

  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    credentials: "include",
    ...options,
    headers,
  });

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
    if (
      res.status === 401 &&
      !retried &&
      !path.includes("/api/v1/auth/login") &&
      !path.includes("/api/v1/auth/refresh") &&
      !path.includes("/api/v1/auth/register")
    ) {
      const rr = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      if (rr.ok) {
        return apiFetch<T>(path, { ...options, _retried: true } as RequestInit);
      }
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

export function setAccessToken(token: string | null) {
  // legacy no-op: auth moved to HttpOnly cookies
  void token;
}
