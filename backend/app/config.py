from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    _backend_dir = Path(__file__).resolve().parents[1]
    model_config = SettingsConfigDict(env_file=str(_backend_dir / ".env"), env_file_encoding="utf-8", extra="ignore")

    database_url: str
    # SQLAlchemy asyncpg pool: общий предел соединений = API workers × (size + overflow) + worker pool.
    db_pool_size: int = Field(default=5, ge=1, le=100)
    db_max_overflow: int = Field(default=5, ge=0, le=100)
    db_pool_timeout_seconds: int = Field(default=30, ge=1, le=300)
    db_pool_recycle_seconds: int = Field(default=1800, ge=0)
    api_workers: int = Field(default=1, ge=1, le=16)
    redis_url: str = "redis://redis:6379/0"
    notification_sync_minutes: int = Field(default=10, ge=1, le=60)
    # Ротация уведомлений (воркер, не чаще раза в сутки).
    notification_retention_read_days: int = Field(default=90, ge=7, le=3650)
    notification_retention_unread_days: int = Field(default=180, ge=7, le=3650)
    notification_retention_note_reminder_days: int = Field(default=30, ge=7, le=3650)
    worker_max_jobs: int = Field(default=2, ge=1, le=32)
    # Каталог файлов pg_dump. В Docker — том /backups.
    backup_dir: str = ""
    # Жёсткий потолок числа файлов (защита, если за дни накопилось много ручных дампов).
    backup_keep: int = Field(default=40, ge=1, le=200)
    backup_auto_enabled: bool = True
    backup_retention_days: int = Field(default=10, ge=1, le=365)
    backup_hour: int = Field(default=3, ge=0, le=23)
    backup_minute: int = Field(default=0, ge=0, le=59)
    backup_tz: str = "Asia/Krasnoyarsk"
    # При старте API выполняется alembic upgrade head (удобно для новой пустой БД). В проде при желании отключите.
    auto_migrate_on_startup: bool = True
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 14
    algorithm: str = "HS256"
    cors_origins: str = "http://localhost:5173"
    auth_cookie_secure: bool = False
    auth_cookie_samesite: str = "lax"
    initial_admin_email: str = ""
    initial_admin_password: str = ""
    initial_admin_full_name: str = "Администратор"
    storage_backend: str = "local"  # local | minio
    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "mess-workspace"
    minio_public_base_url: str = "/mes/files"
    # Публичный base path фронта (BrowserRouter basename) для ссылок в HTML статей
    public_app_base: str = "/mes"
    # Сбор сирот MinIO/uploads. false = только посчитать в лог воркера, ничего не удалять.
    storage_gc_enabled: bool = False
    storage_gc_min_age_days: int = Field(default=14, ge=1, le=365)
    # Ключ Fernet для паролей УСПД. Если пусто — берётся SHA-256 от SECRET_KEY.
    uspd_secrets_key: str = ""
    # Кому верить X-Real-IP (nginx). Локальный uvicorn: loopback.
    # Docker: сеть compose (см. TRUSTED_PROXY_IPS в .env.template), иначе в аудите IP контейнера web.
    trusted_proxy_ips: str = "127.0.0.1,::1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
