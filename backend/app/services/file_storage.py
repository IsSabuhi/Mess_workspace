import uuid
from urllib.parse import urlparse

import boto3

from app.config import get_settings
from app.paths import UPLOAD_KB_DIR

_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}


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


def save_kb_image(raw: bytes, content_type: str) -> str:
    ext = _EXT.get(content_type, ".bin")
    name = f"{uuid.uuid4().hex}{ext}"
    key = f"kb/{name}"

    if _is_minio():
        s = get_settings()
        client = _minio_client()
        client.put_object(
            Bucket=s.minio_bucket,
            Key=key,
            Body=raw,
            ContentType=content_type,
        )
        base = s.minio_public_base_url.rstrip("/")
        return f"{base}/{s.minio_bucket}/{key}"

    path = UPLOAD_KB_DIR / name
    path.write_bytes(raw)
    return f"/uploads/kb/{name}"

