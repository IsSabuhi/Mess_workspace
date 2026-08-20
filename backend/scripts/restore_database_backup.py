#!/usr/bin/env python3
"""Восстановление полного дампа PostgreSQL (формат pg_dump custom).

На новой пустой базе:

  python scripts/restore_database_backup.py /backups/<id>.dump

Или с явным URL:

  python scripts/restore_database_backup.py ./mess_db_2026-08-20.dump --database-url postgresql://user:pass@host:5432/mess_todo

Не запускайте на боевой базе без остановки api/worker: restore перезапишет данные.
Картинки БЗ и вложения (MinIO) в дамп не входят.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.engine.url import make_url

from app.config import get_settings


def main() -> int:
    parser = argparse.ArgumentParser(description="Восстановить PostgreSQL из .dump (pg_restore)")
    parser.add_argument("dump_file", type=Path, help="Файл .dump из админки")
    parser.add_argument("--database-url", default="", help="Если пусто — берётся DATABASE_URL")
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Удалить существующие объекты перед восстановлением (опасно на живой БД)",
    )
    args = parser.parse_args()
    dump = args.dump_file.expanduser().resolve()
    if not dump.is_file():
        print(f"Файл не найден: {dump}", file=sys.stderr)
        return 1
    pg_restore = shutil.which("pg_restore")
    if not pg_restore:
        print("Нет pg_restore. Установите postgresql-client.", file=sys.stderr)
        return 1

    raw = args.database_url.strip() or get_settings().database_url
    url = make_url(raw)
    env = os.environ.copy()
    if url.password is not None:
        env["PGPASSWORD"] = url.password
    cmd = [
        pg_restore,
        "--no-owner",
        "--no-acl",
        "--host",
        url.host or "127.0.0.1",
        "--port",
        str(url.port or 5432),
        "--username",
        url.username or "postgres",
        "--dbname",
        url.database or "",
    ]
    if args.clean:
        cmd.extend(["--clean", "--if-exists"])
    cmd.append(str(dump))
    print(" ".join(cmd[:-1]), dump.name)
    proc = subprocess.run(cmd, env=env, check=False)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
