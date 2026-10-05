"""Test-only helpers for talking to a real Supabase project's Auth Admin API.

Used exclusively by integration tests (tests/test_tenant_isolation.py) to
create/sign-in/delete real auth.users rows the same way production code does
(app/core/privileged.py) - never by raw SQL into auth.users, which a real
hosted Supabase project rejects even for service_role (see Phase 1 Part 2
report: this was discovered the hard way).
"""

from __future__ import annotations

import httpx

from app.core.config import settings


def _headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


def create_auth_user(*, email: str, password: str, role: str, organization_id: str) -> str:
    url = f"{settings.supabase_url}/auth/v1/admin/users"
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "app_metadata": {"role": role, "organization_id": organization_id},
    }
    response = httpx.post(url, headers=_headers(), json=payload, timeout=15.0)
    response.raise_for_status()
    return response.json()["id"]


def delete_auth_user(user_id: str) -> None:
    url = f"{settings.supabase_url}/auth/v1/admin/users/{user_id}"
    httpx.delete(url, headers=_headers(), timeout=15.0)


def sign_in(*, email: str, password: str) -> str:
    """Real email/password sign-in against GoTrue. Returns a genuine,
    cryptographically signed access token (JWT) - used so at least part of
    the tenant-isolation suite exercises the FULL chain: real sign-in -> real
    signed JWT -> our app.core.security verification -> RLS, not just RLS in
    isolation."""
    url = f"{settings.supabase_url}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": settings.supabase_anon_key,
        "Content-Type": "application/json",
    }
    response = httpx.post(url, headers=headers, json={"email": email, "password": password}, timeout=15.0)
    response.raise_for_status()
    return response.json()["access_token"]
