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


def set_user_status(*, target_user_id: str, status: str, actor_user_id: str) -> None:
    """Disable or re-enable a user (spec §18 "Disable user" / "Remove user").

    Privileged because: blocking sign-in requires banning the auth user via
    the Supabase Admin API (service_role); updating only public.users.status
    would leave the account able to obtain fresh JWTs. "Remove user" is
    implemented as a disable (never a hard delete) so ticket/audit history
    keeps a valid author. Restricted to SUPER_ADMIN / ADMIN at the API layer.
    """
    if status not in ("ACTIVE", "DISABLED"):
        raise ValueError("status must be ACTIVE or DISABLED")
    admin_api_url = f"{settings.supabase_url}/auth/v1/admin/users/{target_user_id}"
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    # ~100 years ban == disabled; "none" lifts the ban.
    ban_duration = "876000h" if status == "DISABLED" else "none"
    response = httpx.put(admin_api_url, headers=headers, json={"ban_duration": ban_duration}, timeout=10.0)
    response.raise_for_status()

    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("update users set status = %s where id = %s", (status, target_user_id))

    _write_audit(
        "user_status_changed",
        {"target_user_id": target_user_id, "status": status},
        user_id=actor_user_id,
    )


# ---------------------------------------------------------------------------
# Notification worker (Phase 4). The worker is a background process with no
# end-user JWT, so it cannot use user_scoped_connection. These functions are
# the ONLY database access the worker has; each is read-mostly and scoped to
# exactly what one notification job needs.
# ---------------------------------------------------------------------------


def resolve_notification_context(
    *, ticket_id: str, user_ids: list[str], include_admins: bool
) -> dict[str, Any] | None:
    """Return the ticket summary and the ACTIVE recipients for one job.

    Privileged because: "notify the CTO" (decision #8, spec §19) means every
    ACTIVE ADMIN in the internal organization, and the job is often created
    by a CLIENT, who must never be able to read internal staff rows under
    RLS (users_select). This resolution therefore happens server-side in the
    worker, not in the client's request. Returns only id/name/email/role of
    recipients plus ticket number/subject/status/org name. Audited (one row
    per lookup that includes admins).
    """
    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select t.id, t.ticket_number, t.subject, t.status, t.priority, o.name
                from tickets t join organizations o on o.id = t.organization_id
                where t.id = %s and t.deleted_at is null
                """,
                (ticket_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            ticket = {
                "id": str(row[0]),
                "ticket_number": row[1],
                "subject": row[2],
                "status": row[3],
                "priority": row[4],
                "organization_name": row[5],
            }
            cur.execute(
                """
                select u.id, u.name, u.email, u.role, false as via_cto
                from users u
                where u.id = any(%s::uuid[]) and u.status = 'ACTIVE'
                union
                select u.id, u.name, u.email, u.role, true as via_cto
                from users u join organizations o on o.id = u.organization_id
                where %s and o.is_internal and u.role = 'ADMIN' and u.status = 'ACTIVE'
                """,
                (user_ids, include_admins),
            )
            seen: dict[str, dict[str, Any]] = {}
            for uid, name, email, role, via_cto in cur.fetchall():
                key = str(uid)
                if key in seen:
                    seen[key]["via_cto"] = seen[key]["via_cto"] and via_cto
                    continue
                seen[key] = {"id": key, "name": name, "email": email, "role": role, "via_cto": via_cto}
    if include_admins:
        _write_audit(
            "privileged_cto_recipient_lookup",
            {"ticket_id": ticket_id, "admin_recipients": sum(1 for r in seen.values() if r["via_cto"])},
        )
    return {"ticket": ticket, "recipients": list(seen.values())}


def insert_worker_notifications(rows: list[dict[str, Any]]) -> None:
    """Write in-app notification rows for recipients resolved by the worker
    (the CTO/admins - in-app rows for creator/assignee are already written in
    the request path by commit_then_notify). Privileged because the worker
    has no end-user JWT. Writes only notifications rows."""
    if not rows:
        return
    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            for r in rows:
                cur.execute(
                    """
                    insert into notifications (user_id, ticket_id, type, title, message)
                    values (%s, %s, %s, %s, %s)
                    """,
                    (r["user_id"], r["ticket_id"], r["type"], r["title"], r["message"]),
                )


def create_email_log(
    *, ticket_id: str | None, recipient: str, notification_type: str, provider: str
) -> str:
    """Insert a PENDING email_logs row (spec §20, §46). Privileged because the
    worker has no end-user JWT and email_logs is internal-only."""
    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into email_logs (ticket_id, recipient, notification_type, provider, status)
                values (%s, %s, %s, %s, 'PENDING') returning id
                """,
                (ticket_id, recipient, notification_type, provider),
            )
            row = cur.fetchone()
            assert row is not None
            return str(row[0])


def update_email_log(
    *,
    email_log_id: str,
    status: str,
    attempt_count: int,
    error_message: str | None = None,
    provider_message_id: str | None = None,
) -> None:
    """Record one delivery attempt's outcome on an email_logs row."""
    with _service_role_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update email_logs
                   set status = %s, attempt_count = %s, error_message = coalesce(%s, error_message),
                       provider_message_id = coalesce(%s, provider_message_id),
                       sent_at = case when %s = 'SENT' then now() else sent_at end
                 where id = %s
                """,
                (status, attempt_count, error_message, provider_message_id, status, email_log_id),
            )
