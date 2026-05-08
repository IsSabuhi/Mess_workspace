"""Запуск Alembic при старте приложения (пустая БД → схема создаётся до bootstrap админа)."""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

logger = logging.getLogger(__name__)


def backend_root() -> Path:
    return Path(__file__).resolve().parent.parent


def run_alembic_upgrade() -> None:
    from alembic import command
    from alembic.config import Config

    root = backend_root()
    ini_path = root / "alembic.ini"
    if not ini_path.is_file():
        raise RuntimeError(f"Не найден alembic.ini: {ini_path}")

    cfg = Config(str(ini_path))
    # Не переопределять логгеры uvicorn при вызове Alembic из приложения.
    cfg.attributes["configure_logger"] = False
    # В stderr + flush: видно в консоли uvicorn даже без настройки логгеров приложения.
    msg = "[mess-api] Применяю миграции БД (alembic upgrade head)…"
    print(msg, file=sys.stderr, flush=True)
    logger.info(msg)
    t0 = time.monotonic()
    command.upgrade(cfg, "head")
    dt = time.monotonic() - t0
    done = f"[mess-api] Миграции применены за {dt:.1f} с."
    print(done, file=sys.stderr, flush=True)
    logger.info(done)
