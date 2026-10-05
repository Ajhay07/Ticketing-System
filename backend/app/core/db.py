"""Per-request, JWT-scoped Postgres connections.

This is the mechanism that makes decision #1 ("RLS must actually run") real:
for every normal request we open a connection, set the Postgres session's
`request.jwt.claims` GUC to the caller's verified JWT payload, and `SET ROLE
authenticated`. This mirrors exactly what Supabase's own PostgREST/pooler
layer does, so the `auth.jwt()` / `auth.uid()` / `auth.role()` helpers used by
our RLS policies (supabase/migrations/0002_rls.sql) behave identically to a
request made through Supabase's REST API — RLS is enforced by Postgres
itself, not emulated in application code.

The service_role path (privileged.py) is the ONLY other way the backend talks
to Postgres, and it is isolated there deliberately.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg

from app.core.config import settings
from app.core.security import Principal


@contextmanager
def user_scoped_connection(principal: Principal) -> Iterator[psycopg.Connection]:
    """Open a connection scoped to `principal`'s JWT, with RLS enforced.

    Usage:
        with user_scoped_connection(principal) as conn:
            with conn.cursor() as cur:
                cur.execute("select * from tickets")
    """
    conn = psycopg.connect(settings.database_url)
    try:
        claims = {
            "sub": principal.user_id,
            "role": "authenticated",
            "email": principal.email,
            "app_metadata": {
                "role": principal.role.value,
                "organization_id": principal.organization_id,
            },
        }
        with conn.cursor() as cur:
            cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps(claims),))
            cur.execute("set role authenticated")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        with conn.cursor() as cur:
            cur.execute("reset role")
        conn.close()


@contextmanager
def anon_connection() -> Iterator[psycopg.Connection]:
    """Connection with no authenticated claims (for truly public reads, if any)."""
    conn = psycopg.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("set role anon")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        with conn.cursor() as cur:
            cur.execute("reset role")
        conn.close()
