"""Application configuration.

All settings are loaded from environment variables. Never hardcode secrets
here (CLAUDE.md rule). See `.env.example` at the repo root for the full list.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve backend/.env by this file's own location rather than the process's
# current working directory, so `uvicorn` run with `--app-dir backend` from
# the repo root (see .claude/launch.json) still finds it.
_BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_BACKEND_ENV_FILE, extra="ignore")

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
    # "noop" | "resend" | "smtp"; empty = auto (resend if key, smtp if host, else noop).
    email_provider: str = ""

    # SMTP (backend-only; never NEXT_PUBLIC_, never logged, never in email_logs).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = "ClickfieldAI Support"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False

    # App
    app_url: str = "http://localhost:3000"
    cors_allow_origins: list[str] = ["http://localhost:3000"]

    # Attachments (spec §12, §31). Private bucket created by
    # supabase/migrations/0003_storage_attachments.sql.
    storage_bucket: str = "ticket-attachments"
    attachment_max_bytes: int = 25 * 1024 * 1024
    # Abuse cap on live attachments per ticket (all uploads, any role). The
    # create-ticket form additionally limits a single submission to 10 files.
    attachment_max_per_ticket: int = 50
    signed_url_expires_seconds: int = 60

    # Rate limiting defaults (spec §54). See app/services/rate_limit.py.
    rate_limit_enabled: bool = True
    rate_limit_backend: str = "memory"  # "memory" (single instance) or "redis" (shared)
    rate_limit_login_per_minute: int = 5  # informational: login is limited by Supabase Auth itself
    rate_limit_ticket_create_per_hour: int = 20
    rate_limit_comment_create_per_hour: int = 60
    rate_limit_attachment_upload_per_hour: int = 60
    rate_limit_password_reset_per_hour: int = 10

    # Email delivery retry (spec §46: at least 3 attempts, backoff between).
    email_max_attempts: int = 3
    email_retry_base_seconds: float = 2.0

    # Logging
    log_level: str = "INFO"


settings = Settings()
