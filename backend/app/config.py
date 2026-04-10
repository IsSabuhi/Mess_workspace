from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://dev:devuser1111@localhost:5432/mess_workspace"
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
    minio_public_base_url: str = "http://localhost:9000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
