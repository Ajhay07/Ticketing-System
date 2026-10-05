"""Shared helpers for integration tests that run against the REAL DEV
Supabase project (same approach as test_phase2_ticketing.py: real Admin-API
users, real GoTrue sign-in, real signed JWTs, real RLS).

Fixtures built with `build_scenario` create clearly-labelled `RLS-TEST`
organizations/users. Teardown soft-deletes tickets (never hard-deletes,
never touches audit_logs), matching the existing suites.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
import pytest

from app.core.config import settings
from tests.conftest import postgres_available
from tests.supabase_admin import create_auth_user, sign_in

INTERNAL_ORG_ID = "00000000-0000-0000-0000-000000000001"
REAL_JWT_SECRET = settings.supabase_jwt_secret

CREDENTIALS_CONFIGURED = bool(
    settings.supabase_url and settings.supabase_service_role_key and settings.supabase_anon_key
)
# Guard: the automated suite must only ever run against DEV (docs/ENVIRONMENTS.md).
POINTS_AT_PROD = "zirvrpejigqwxcscpskf" in (settings.supabase_url + settings.database_url)

requires_dev = pytest.mark.skipif(
    not (CREDENTIALS_CONFIGURED and not POINTS_AT_PROD and postgres_available()),
    reason="Requires the DEV Supabase project (backend/.env) with all migrations applied.",
)


def service_conn() -> psycopg.Connection:
    conn = psycopg.connect(settings.database_url, autocommit=True)
    with conn.cursor() as cur:
        cur.execute("set role service_role")
    return conn


@contextmanager
def scenario(label: str, people: dict[str, tuple[str, str]], orgs: list[str]) -> Iterator[dict[str, Any]]:
    """Create orgs + real auth users. `people` maps key -> (role, org_key)
    where org_key is one of `orgs` or "internal"."""
    run_id = uuid.uuid4().hex[:8]
    password = f"RlsTest!{run_id}"
    data: dict[str, Any] = {"run_id": run_id, "ticket_ids": [], "password": password}
    conn = service_conn()
    try:
        with conn.cursor() as cur:
            for key in orgs:
                org_id = str(uuid.uuid4())
                data[f"{key}"] = org_id
                cur.execute(
                    "insert into organizations (id, name, slug) values (%s, %s, %s)",
                    (org_id, f"RLS-TEST {label} {key} {run_id}", f"rls-test-{label}-{key}-{run_id}".lower()),
                )
        for key, (role, org_key) in people.items():
            org_id = INTERNAL_ORG_ID if org_key == "internal" else data[org_key]
            email = f"rls-test-{label}-{key.replace('_', '-')}-{run_id}@example.com".lower()
            user_id = create_auth_user(email=email, password=password, role=role, organization_id=org_id)
            with conn.cursor() as cur:
                cur.execute(
                    "insert into users (id, organization_id, name, email, role) values (%s, %s, %s, %s, %s)",
                    (user_id, org_id, f"RLS-TEST {label} {key}", email, role),
                )
            data[f"{key}_id"] = user_id
            data[f"{key}_email"] = email
            data[f"{key}_token"] = sign_in(email=email, password=password)
        with conn.cursor() as cur:
            cur.execute("select id from categories where is_active order by name limit 1")
            row = cur.fetchone()
            assert row is not None
            data["category_id"] = str(row[0])
        yield data
    finally:
        if data["ticket_ids"]:
            with conn.cursor() as cur:
                cur.execute(
                    "update tickets set deleted_at = now() where id = any(%s::uuid[]) and deleted_at is null",
                    (data["ticket_ids"],),
                )
        # Disable fixture users/orgs so later runs never pick them up (e.g.
        # as CTO notification recipients). Never hard-deleted.
        user_ids = [v for k, v in data.items() if k.endswith("_id") and k not in ("category_id", "run_id")]
        with conn.cursor() as cur:
            cur.execute("update users set status = 'DISABLED' where id = any(%s::uuid[])", (user_ids,))
            cur.execute(
                "update organizations set status = 'DISABLED' where id = any(%s::uuid[])",
                ([data[k] for k in orgs if k in data],),
            )
        conn.close()


def auth(data: dict[str, Any], who: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {data[f'{who}_token']}"}
