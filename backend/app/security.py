from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import get_settings

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def create_access_token(subject: str, token_version: int, expires_delta: timedelta | None = None) -> str:
    """Access-токен. `tv` — поколение токенов пользователя (см. User.token_version)."""
    settings = get_settings()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode = {"sub": subject, "exp": expire, "type": TOKEN_TYPE_ACCESS, "tv": token_version}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def create_refresh_token(subject: str, jti: str, expires_at: datetime) -> str:
    """Refresh-токен. `jti` — id строки refresh_sessions, без неё токен нерабочий."""
    settings = get_settings()
    to_encode = {"sub": subject, "exp": expires_at, "type": TOKEN_TYPE_REFRESH, "jti": jti}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_token_payload(token: str, *, expected_type: str) -> dict | None:
    """Проверяет подпись, срок и назначение токена.

    `expected_type` обязателен: без него refresh-токен принимался бы вместо access
    и жил бы как полноценный доступ к API все свои 14 дней.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload
