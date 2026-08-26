"""Шифрование секретов справочника УСПД (пароли, PIN/PUK) при хранении в Postgres."""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

logger = logging.getLogger(__name__)

_PREFIX = "fernet:"


def _fernet() -> Fernet:
    settings = get_settings()
    raw = (settings.uspd_secrets_key or "").strip() or settings.secret_key
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str | None) -> str | None:
    text = (plain or "").strip()
    if not text:
        return None
    return _PREFIX + _fernet().encrypt(text.encode("utf-8")).decode("ascii")


def decrypt_secret(stored: str | None) -> str:
    if not stored:
        return ""
    raw = stored.strip()
    if not raw:
        return ""
    if not raw.startswith(_PREFIX):
        # Старое/ошибочное значение без префикса не отдаём как пароль.
        logger.warning("Uspd secret is not Fernet-prefixed; treating as empty")
        return ""
    token = raw[len(_PREFIX) :].encode("ascii")
    try:
        return _fernet().decrypt(token).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        logger.warning("Failed to decrypt uspd secret")
        return ""
