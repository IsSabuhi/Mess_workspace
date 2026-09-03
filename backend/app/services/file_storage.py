import logging
import re
import uuid
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import boto3

logger = logging.getLogger(__name__)

from app.config import get_settings
from app.paths import UPLOAD_KB_DIR, UPLOAD_NOTES_DIR, UPLOAD_TASKS_DIR, UPLOAD_USPD_DIR

_IMAGE_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
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
    "application/vnd.ms-outlook": ".msg",
}
_TASK_SUFFIXES = {
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
    ".msg",
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


# kb/notes/tasks/uspd + uuid.hex + расширение — так _store и save_*_file кладут объекты.
_STORED_KEY_RE = re.compile(
    r"(?:^|/)(?P<key>(?:kb|notes|tasks|uspd)/[0-9a-f]{32}\.[A-Za-z0-9]{1,8})",
    re.IGNORECASE,
)

_PREFIX_DIRS = {
    "kb": UPLOAD_KB_DIR,
    "notes": UPLOAD_NOTES_DIR,
    "tasks": UPLOAD_TASKS_DIR,
    "uspd": UPLOAD_USPD_DIR,
}


def stored_key_from_url(url: str | None) -> str | None:
    """Достаёт ключ объекта из публичного URL (MinIO или /uploads/...)."""
    if not url:
        return None
    m = _STORED_KEY_RE.search(str(url).replace("\\", "/"))
    if not m:
        return None
    prefix, name = m.group("key").split("/", 1)
    return f"{prefix.lower()}/{name.lower()}"


def stored_keys_from_text(text: str | None) -> set[str]:
    """Все ключи хранилища, упомянутые в HTML/markdown."""
    if not text:
        return set()
    out: set[str] = set()
    for m in _STORED_KEY_RE.finditer(str(text).replace("\\", "/")):
        prefix, name = m.group("key").split("/", 1)
        out.add(f"{prefix.lower()}/{name.lower()}")
    return out


def delete_stored_files(urls: Iterable[str | None]) -> int:
    keys = {stored_key_from_url(u) for u in urls}
    return delete_stored_keys(k for k in keys if k)


def delete_stored_keys(keys: Iterable[str]) -> int:
    """Удаляет объекты. Ошибки глотаем: лучше сирота, чем 500 после успешного commit в БД."""
    deleted = 0
    uniq = [k for k in dict.fromkeys(keys) if k]
    if not uniq:
        return 0
    if _is_minio():
        s = get_settings()
        client = _minio_client()
        for key in uniq:
            try:
                client.delete_object(Bucket=s.minio_bucket, Key=key)
                deleted += 1
            except Exception:
                logger.warning("Не удалось удалить объект MinIO %s", key, exc_info=True)
        return deleted
    for key in uniq:
        prefix, _, name = key.partition("/")
        folder = _PREFIX_DIRS.get(prefix)
        if not folder or not name or "/" in name or name in {".", ".."}:
            continue
        try:
            (folder / name).unlink(missing_ok=True)
            deleted += 1
        except OSError:
            logger.warning("Не удалось удалить файл %s", key, exc_info=True)
    return deleted


def list_stored_objects() -> list[tuple[str, datetime]]:
    """Объекты наших префиксов: (key, last_modified UTC)."""
    if _is_minio():
        return _list_minio_objects()
    out: list[tuple[str, datetime]] = []
    for prefix, folder in _PREFIX_DIRS.items():
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if not path.is_file():
                continue
            key = stored_key_from_url(f"{prefix}/{path.name}")
            if not key:
                continue
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            out.append((key, mtime))
    return out


def _list_minio_objects() -> list[tuple[str, datetime]]:
    s = get_settings()
    client = _minio_client()
    out: list[tuple[str, datetime]] = []
    for prefix in _PREFIX_DIRS:
        token: str | None = ""
        while token is not None:
            kwargs: dict = {"Bucket": s.minio_bucket, "Prefix": f"{prefix}/"}
            if token:
                kwargs["ContinuationToken"] = token
            resp = client.list_objects_v2(**kwargs)
            for obj in resp.get("Contents") or []:
                key = stored_key_from_url(obj.get("Key") or "")
                if not key:
                    continue
                lm = obj.get("LastModified")
                if lm is None:
                    continue
                if lm.tzinfo is None:
                    lm = lm.replace(tzinfo=timezone.utc)
                out.append((key, lm.astimezone(timezone.utc)))
            token = resp.get("NextContinuationToken") if resp.get("IsTruncated") else None
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


def save_uspd_image(raw: bytes, content_type: str) -> str:
    return _store(raw, content_type, "uspd", UPLOAD_USPD_DIR, "/uploads/uspd")


def save_note_file(raw: bytes, content_type: str, original_filename: str | None = None) -> str:
    ct = (content_type or "application/octet-stream").split(";")[0].strip().lower()
    if ct == "application/octet-stream" and original_filename:
        suffix = Path(original_filename).suffix.lower()
        if suffix in {".pdf", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".doc", ".docx", ".zip"}:
            name = f"{uuid.uuid4().hex}{suffix}"
            key = f"notes/{name}"
            if _is_minio():
                s = get_settings()
                client = _minio_client()
                client.put_object(Bucket=s.minio_bucket, Key=key, Body=raw, ContentType=ct)
                base = public_files_base()
                return f"{base}/{s.minio_bucket}/{key}"
            UPLOAD_NOTES_DIR.mkdir(parents=True, exist_ok=True)
            (UPLOAD_NOTES_DIR / name).write_bytes(raw)
            return f"/uploads/notes/{name}"
    return _store(raw, ct, "notes", UPLOAD_NOTES_DIR, "/uploads/notes")


def save_task_file(raw: bytes, content_type: str, original_filename: str | None = None) -> str:
    ct = (content_type or "application/octet-stream").split(";")[0].strip().lower()
    suffix = Path(original_filename or "").suffix.lower()
    if suffix in _TASK_SUFFIXES:
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
