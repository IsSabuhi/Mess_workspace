"""Паттерны для ILIKE: экранируем % и _, чтобы q=\"%\" не сканировал всю таблицу."""

_LIKE_ESCAPE = "\\"


def ilike_contains(value: str) -> str | None:
    needle = value.strip()
    if not needle:
        return None
    escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def ilike_escape_char() -> str:
    return _LIKE_ESCAPE
