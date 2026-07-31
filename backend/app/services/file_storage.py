import re
import uuid
from pathlib import Path
from urllib.parse import urlparse

import boto3

from app.config import get_settings
from app.paths import UPLOAD_KB_DIR, UPLOAD_TASKS_DIR

_IMAGE_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
_TASK_EXT = {
    **_IMAGE_EXT,
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
}

# Старые абсолютные базы MinIO → тот же объект через HTTPS-прокси /mes/files
_LEGACY_MINIO_PUBLIC_BASES = (
    "http://172.24.230.140:9000",
    "https://172.24.230.140:9000",
    "http://localhost:9000",
    "https://localhost:9000",
    "http://127.0.0.1:9000",
)


def _is_minio() -> bool:
    return get_settings().storage_backend.strip().lower() == "minio"


def _minio_client():
    s = get_settings()
    parsed = urlparse(s.minio_endpoint)
    secure = parsed.scheme == "https"
    endpoint = f"{parsed.hostname}:{parsed.port}" if parsed.port else (parsed.hostname or "minio:9000")
    return boto3.client(
        "s3",
        endpoint_url=f"{'https' if secure else 'http'}://{endpoint}",
        aws_access_key_id=s.minio_access_key,
        aws_secret_access_key=s.minio_secret_key,
        region_name="us-east-1",
    )


def public_files_base() -> str:
    """База URL файлов для браузера (лучше относительный путь под HTTPS)."""
    s = get_settings()
    if _is_minio():
        return (s.minio_public_base_url or "/mes/files").rstrip("/")
    return ""


def rewrite_stored_media_urls(html: str | None) -> str | None:
    """Заменить старые http://host:9000/... на публичный HTTPS-путь /mes/files/..."""
    if not html or not _is_minio():
        return html
    s = get_settings()
    target = public_files_base()
    out = html
    for old in (*_LEGACY_MINIO_PUBLIC_BASES, s.minio_public_base_url.rstrip("/")):
        if not old or old == target:
            continue
        if "://" in old or old.startswith("http"):
            out = out.replace(old.rstrip("/"), target)
    bucket = re.escape(s.minio_bucket)
    out = re.sub(
        rf"https?://[^\"'\s<>]+?:9000/({bucket}/)",
        rf"{target}/\1",
        out,
    )
    return out


def _store(raw: bytes, content_type: str, prefix: str, local_dir: Path, url_prefix: str) -> str:
    ext = _TASK_EXT.get(content_type) or _IMAGE_EXT.get(content_type) or ".bin"
    name = f"{uuid.uuid4().hex}{ext}"
    key = f"{prefix}/{name}"

    if _is_minio():
        s = get_settings()
        client = _minio_client()
        client.put_object(
            Bucket=s.minio_bucket,
            Key=key,
            Body=raw,
            ContentType=content_type,
        )
        base = public_files_base()
        return f"{base}/{s.minio_bucket}/{key}"

    local_dir.mkdir(parents=True, exist_ok=True)
    path = local_dir / name
    path.write_bytes(raw)
    return f"{url_prefix}/{name}"


def save_kb_image(raw: bytes, content_type: str) -> str:
    return _store(raw, content_type, "kb", UPLOAD_KB_DIR, "/uploads/kb")


def save_task_file(raw: bytes, content_type: str, original_filename: str | None = None) -> str:
    ct = (content_type or "application/octet-stream").split(";")[0].strip().lower()
    if ct == "application/octet-stream" and original_filename:
        suffix = Path(original_filename).suffix.lower()
        if suffix in {
            ".pdf",
            ".txt",
            ".doc",
            ".docx",
            ".xls",
            ".xlsx",
            ".zip",
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".webp",
        }:
            name = f"{uuid.uuid4().hex}{suffix}"
            key = f"tasks/{name}"
            if _is_minio():
                s = get_settings()
                client = _minio_client()
                client.put_object(Bucket=s.minio_bucket, Key=key, Body=raw, ContentType=ct)
                base = public_files_base()
                return f"{base}/{s.minio_bucket}/{key}"
            UPLOAD_TASKS_DIR.mkdir(parents=True, exist_ok=True)
            (UPLOAD_TASKS_DIR / name).write_bytes(raw)
            return f"/uploads/tasks/{name}"
    return _store(raw, ct, "tasks", UPLOAD_TASKS_DIR, "/uploads/tasks")
