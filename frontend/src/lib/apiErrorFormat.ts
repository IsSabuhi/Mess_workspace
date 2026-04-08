/**
 * Разбор тела ошибки FastAPI: detail может быть строкой, массивом ошибок валидации или вложенным объектом.
 */
export function formatApiErrorDetail(payload: unknown): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") {
    const t = payload.trim();
    return t;
  }
  if (Array.isArray(payload)) {
    const parts: string[] = [];
    for (const item of payload) {
      if (typeof item === "object" && item !== null && "msg" in item) {
        const o = item as { msg?: string; loc?: (string | number)[] };
        let s = String(o.msg ?? "");
        if (Array.isArray(o.loc) && o.loc.length > 0) {
          const path = o.loc
            .filter((x) => x !== "body" && x !== "query" && x !== "path")
            .map(String)
            .join(".");
          if (path) s = `${path}: ${s}`;
        }
        if (s) parts.push(s);
      } else {
        parts.push(String(item));
      }
    }
    return parts.filter(Boolean).join(" · ") || "";
  }
  if (typeof payload === "object" && payload !== null && "detail" in payload) {
    return formatApiErrorDetail((payload as { detail: unknown }).detail);
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

export function httpStatusFallbackMessage(status: number): string {
  switch (status) {
    case 400:
      return "Неверный запрос";
    case 401:
      return "Требуется авторизация";
    case 403:
      return "Доступ запрещён";
    case 404:
      return "Не найдено";
    case 409:
      return "Конфликт данных";
    case 422:
      return "Ошибка проверки введённых данных";
    case 429:
      return "Слишком много запросов";
    case 500:
      return "Ошибка сервера";
    case 502:
    case 503:
      return "Сервис временно недоступен";
    default:
      return "Ошибка запроса";
  }
}
