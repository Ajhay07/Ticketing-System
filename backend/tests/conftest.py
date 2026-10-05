from __future__ import annotations

import time
from collections.abc import Iterator

import jwt
import psycopg
import pytest

from app.core.config import settings

TEST_JWT_SECRET = "test-secret-do-not-use-in-production-0123456789"


@pytest.fixture(autouse=True)
def _configure_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_jwt_secret", TEST_JWT_SECRET)


def make_token(
    *,
    user_id: str,
    role: str,
    organization_id: str,
    email: str = "user@example.com",
    expired: bool = False,
    missing_claims: bool = False,
) -> str:
    now = int(time.time())
    payload: dict = {
        "sub": user_id,
        "email": email,
        "aud": "authenticated",
        "iat": now,
        "exp": now - 10 if expired else now + 3600,
    }
    if not missing_claims:
        payload["app_metadata"] = {"role": role, "organization_id": organization_id}
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


def postgres_available() -> bool:
    try:
        conn = psycopg.connect(settings.database_url, connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


@pytest.fixture
def db_available() -> bool:
    return postgres_available()


@pytest.fixture
def service_conn() -> Iterator[psycopg.Connection]:
    """Raw connection with no RLS claims set, used only by tests to seed data
    directly as service_role (never used by application request handlers)."""
    conn = psycopg.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("set role service_role")
        yield conn
        conn.commit()
    finally:
        conn.close()
