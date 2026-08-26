"""Дождаться PostgreSQL перед alembic/uvicorn. Печатает понятную ошибку в docker logs."""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

# Как `python scripts/foo.py`: в sys.path попадает scripts/, а пакет app лежит на уровень выше.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sqlalchemy import create_engine, text

from app.config import get_settings

_RETRY_SECONDS = 60
_SLEEP = 3


def _safe_url(url: str) -> str:
    return re.sub(r":([^:@/]+)@", ":****@", url)


def _sync_url(url: str) -> str:
    if "+asyncpg" in url:
        url = url.replace("+asyncpg", "+psycopg", 1)
    if "connect_timeout" not in url:
        url += ("&" if "?" in url else "?") + "connect_timeout=8"
    return url


def _host_looks_like_unix_socket(url: str) -> bool:
    parsed = urlparse(url.replace("postgresql+asyncpg", "postgresql", 1).replace("postgresql+psycopg", "postgresql", 1))
    host = (parsed.hostname or "").strip().lower()
    return host in ("", "localhost")


def main() -> int:
    raw = get_settings().database_url
    print(f"[mess-api] DATABASE_URL={_safe_url(raw)}", flush=True)
    if _host_looks_like_unix_socket(raw):
        print(
            "[mess-api] В DATABASE_URL нет TCP-хоста (пусто или localhost).\n"
            "  libpq тогда ходит в Unix-сокет /var/run/postgresql внутри контейнера — там Postgres нет.\n"
            "  Исправьте корневой .env, например:\n"
            "  DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@host.docker.internal:5432/DBNAME\n"
            "  (Postgres на другом сервере — его IP вместо host.docker.internal.)",
            file=sys.stderr,
            flush=True,
        )
        return 1
    url = _sync_url(raw)
    deadline = time.time() + _RETRY_SECONDS
    last: BaseException | None = None
    while time.time() < deadline:
        try:
            engine = create_engine(url)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            engine.dispose()
            print("[mess-api] PostgreSQL доступен.", flush=True)
            return 0
        except Exception as exc:  # noqa: BLE001 — нужен полный текст для docker logs
            last = exc
            print(f"[mess-api] Нет соединения с БД: {exc}", flush=True)
            time.sleep(_SLEEP)
    print(
        "[mess-api] PostgreSQL недоступен из контейнера.\n"
        "  • В DATABASE_URL не используйте localhost — из Docker это сам контейнер, не хост.\n"
        "  • Нужен IP сервера БД или host.docker.internal (в compose extra_hosts уже есть).\n"
        "  • База должна существовать; Postgres слушать не только 127.0.0.1; в pg_hba.conf\n"
        "    разрешите подключения с docker-моста (часто 172.16.0.0/12).\n"
        f"  Последняя ошибка: {last}",
        file=sys.stderr,
        flush=True,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
