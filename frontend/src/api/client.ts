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

function getToken(): string | null {
  return localStorage.getItem("access_token");
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
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
  if (token) {
    localStorage.setItem("access_token", token);
  } else {
    localStorage.removeItem("access_token");
  }
}
