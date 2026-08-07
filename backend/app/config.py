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
    worker_max_jobs: int = Field(default=2, ge=1, le=32)
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
