"""Пути к файлам на диске (относительно каталога backend)."""

from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
UPLOADS_DIR = BACKEND_ROOT / "uploads"
UPLOAD_KB_DIR = UPLOADS_DIR / "kb"
