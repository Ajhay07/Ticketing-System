"""Isolated, audited access to Supabase's service_role privileges.

CLAUDE.md / decision #1: service_role bypasses RLS entirely, so its use must
be narrowly scoped and documented. EVERY function in this module is a
privileged operation. Nothing outside this module may construct a
service-role client or connection. Each function:

  1. States which specific privileged action it performs and why it cannot be
     done under a user's own JWT.
  2. Writes an audit_logs row describing the privileged action taken.

Normal ticket/comment/attachment/notification access must NEVER go through
this module — use app.core.db.user_scoped_connection instead.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx
import psycopg

from app.core.config import settings


@contextmanager
def _service_role_connection() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("set role service_role")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        with conn.cursor() as cur:
            cur.execute("reset role")
        conn.close()


def _write_audit(action: str, metadata: dict[str, Any], *, user_id: str | None = None) -> None:
    """Record that a privileged operation occurred. Audit writes always
    succeed under service_role since audit_logs permits inserts from any
    authenticated context, but we route through here too for consistency and
    so every privileged action is unconditionally logged, even ones that
    don't otherwise touch the DB (e.g. a Supabase Admin API call)."""
    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into audit_logs (user_id, action, new_value, metadata)
                values (%s, %s, %s, %s)
                """,
                (user_id, action, json.dumps(metadata), json.dumps({"privileged": True})),
            )


def provision_user(
    *,
    email: str,
    password: str,
    name: str,
    organization_id: str,
    role: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Create a Supabase Auth user and the matching `public.users` profile,
    setting `app_metadata.role` / `app_metadata.organization_id`.

    Privileged because: setting another user's auth app_metadata and creating
    auth.users rows can only be done with the service_role key (the Supabase
    Admin API), never under an end user's own JWT. Restricted at the API
    layer (app/api/routers/admin.py) to SUPER_ADMIN / ADMIN callers (spec
    §18, decision #7).
    """
    admin_api_url = f"{settings.supabase_url}/auth/v1/admin/users"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "app_metadata": {"role": role, "organization_id": organization_id},
    }
    response = httpx.post(admin_api_url, headers=headers, json=payload, timeout=10.0)
    response.raise_for_status()
    auth_user = response.json()

    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into users (id, organization_id, name, email, role)
                values (%s, %s, %s, %s, %s)
                """,
                (auth_user["id"], organization_id, name, email, role),
            )

    _write_audit(
        "user_provisioned",
        {"new_user_id": auth_user["id"], "email": email, "role": role, "organization_id": organization_id},
        user_id=actor_user_id,
    )
    return auth_user


def update_user_role_or_org(
    *,
    target_user_id: str,
    role: str | None,
    organization_id: str | None,
    actor_user_id: str,
) -> None:
    """Update a user's role and/or organization in both auth.users'
    app_metadata and the public.users profile.

    Privileged because: writing another user's auth app_metadata requires the
    Supabase Admin API (service_role). Restricted to SUPER_ADMIN / ADMIN at
    the API layer.
    """
    admin_api_url = f"{settings.supabase_url}/auth/v1/admin/users/{target_user_id}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    app_metadata: dict[str, Any] = {}
    if role is not None:
        app_metadata["role"] = role
    if organization_id is not None:
        app_metadata["organization_id"] = organization_id

    response = httpx.put(
        admin_api_url, headers=headers, json={"app_metadata": app_metadata}, timeout=10.0
    )
    response.raise_for_status()

    set_clauses = []
    params: list[Any] = []
    if role is not None:
        set_clauses.append("role = %s")
        params.append(role)
    if organization_id is not None:
        set_clauses.append("organization_id = %s")
        params.append(organization_id)
    if set_clauses:
        params.append(target_user_id)
        with _service_role_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"update users set {', '.join(set_clauses)} where id = %s",  # noqa: S608
                    params,
                )

    _write_audit(
        "user_role_or_org_updated",
        {"target_user_id": target_user_id, "role": role, "organization_id": organization_id},
        user_id=actor_user_id,
    )


def allocate_ticket_number() -> str:
    """Allocate the next permanent ticket number (spec §8).

    Privileged because allocation must never collide or be skippable by a
    client-influenced retry; it runs once, atomically, under service_role
    regardless of caller, immediately before the ticket insert (which itself
    happens under the user's own JWT so RLS still governs whether the insert
    is allowed at all).
    """
    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("select next_ticket_number()")
            row = cur.fetchone()
            assert row is not None
            return row[0]


def hard_delete_ticket(*, ticket_id: str, actor_user_id: str, actor_role: str) -> None:
    """Permanently delete a ticket row. Spec §44: only SUPER_ADMIN may ever do
    this, and only if genuinely required. Enforced here AND at the API layer.
    """
    if actor_role != "SUPER_ADMIN":
        raise PermissionError("Only SUPER_ADMIN may permanently delete a ticket")

    _write_audit("ticket_hard_deleted", {"ticket_id": ticket_id}, user_id=actor_user_id)

    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("delete from tickets where id = %s", (ticket_id,))
