"""Application configuration.

All settings are loaded from environment variables. Never hardcode secrets
here (CLAUDE.md rule). See `.env.example` at the repo root for the full list.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    # Direct Postgres connection (used to open per-request, JWT-scoped
    # connections so RLS is enforced — see app/core/db.py).
    database_url: str = "postgresql://postgres:postgres@localhost:54322/postgres"

    # Redis / queue
    redis_url: str = "redis://localhost:6379/0"

    # Email
    resend_api_key: str = ""
    email_from_address: str = "support@clickfieldai.com"

    # App
    app_url: str = "http://localhost:3000"
    cors_allow_origins: list[str] = ["http://localhost:3000"]

    # Attachments (spec §12, §31). Private bucket created by
    # supabase/migrations/0003_storage_attachments.sql.
    storage_bucket: str = "ticket-attachments"
    attachment_max_bytes: int = 25 * 1024 * 1024
    signed_url_expires_seconds: int = 60

    # Rate limiting defaults (spec §54)
    rate_limit_login_per_minute: int = 5
    rate_limit_ticket_create_per_hour: int = 20
    rate_limit_comment_create_per_hour: int = 60


settings = Settings()
